/**
 * Security Trimming Service
 *
 * Filters query results based on user permissions, roles, and group memberships.
 * Implements row-level security for search results and graph traversal.
 *
 * Usage:
 *   const { getSecurityTrimmingService } = require('./security-trimming-service');
 *   const securityService = getSecurityTrimmingService();
 *   const filteredResults = securityService.filterResults(results, user);
 */

// Default role hierarchy (higher index = more permissions)
const DEFAULT_ROLE_HIERARCHY = ['Reader', 'Contributor', 'Reviewer', 'Admin'];

// Document classification levels
const CLASSIFICATION_LEVELS = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

// Role to minimum classification level mapping
const ROLE_CLASSIFICATION_ACCESS = {
  Reader: 'internal',       // Can access public and internal
  Contributor: 'internal',  // Can access public and internal
  Reviewer: 'confidential', // Can access up to confidential
  Admin: 'restricted',      // Full access
};

class SecurityTrimmingService {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.roleHierarchy = options.roleHierarchy || DEFAULT_ROLE_HIERARCHY;
    this.strictMode = options.strictMode || false; // If true, deny access when permissions unclear
    this.auditDenials = options.auditDenials || true;
    this.denialLog = [];
  }

  /**
   * Filter search results based on user permissions
   * @param {Array} results - Search results to filter
   * @param {Object} user - User object with roles and groups
   * @param {Object} options - Additional filter options
   * @returns {Object} - { filteredResults, denied, accessSummary }
   */
  filterSearchResults(results, user, options = {}) {
    if (!this.enabled) {
      return {
        filteredResults: results,
        denied: [],
        accessSummary: { total: results.length, allowed: results.length, denied: 0 },
      };
    }

    if (!Array.isArray(results)) {
      return {
        filteredResults: [],
        denied: [],
        accessSummary: { total: 0, allowed: 0, denied: 0 },
      };
    }

    const userPermissions = this._getUserPermissions(user);
    const filteredResults = [];
    const denied = [];

    for (const result of results) {
      const accessDecision = this._checkAccess(result, userPermissions, options);

      if (accessDecision.allowed) {
        // Apply field-level filtering if needed
        const trimmedResult = this._trimSensitiveFields(result, userPermissions);
        filteredResults.push(trimmedResult);
      } else {
        denied.push({
          id: result.id || result.documentId,
          reason: accessDecision.reason,
          requiredPermission: accessDecision.requiredPermission,
        });

        if (this.auditDenials) {
          this._logDenial(result, user, accessDecision);
        }
      }
    }

    return {
      filteredResults,
      denied,
      accessSummary: {
        total: results.length,
        allowed: filteredResults.length,
        denied: denied.length,
      },
    };
  }

  /**
   * Filter graph entities based on user permissions
   * @param {Array} entities - Graph entities to filter
   * @param {Object} user - User object with roles and groups
   * @returns {Object} - { filteredEntities, denied }
   */
  filterGraphEntities(entities, user) {
    if (!this.enabled || !Array.isArray(entities)) {
      return { filteredEntities: entities || [], denied: [] };
    }

    const userPermissions = this._getUserPermissions(user);
    const filteredEntities = [];
    const denied = [];

    for (const entity of entities) {
      const accessDecision = this._checkEntityAccess(entity, userPermissions);

      if (accessDecision.allowed) {
        filteredEntities.push(entity);
      } else {
        denied.push({
          id: entity.id,
          name: entity.name,
          reason: accessDecision.reason,
        });
      }
    }

    return { filteredEntities, denied };
  }

  /**
   * Filter graph relationships based on user permissions
   * @param {Array} relationships - Graph relationships to filter
   * @param {Array} allowedEntityIds - IDs of entities user can access
   * @returns {Array} - Filtered relationships
   */
  filterGraphRelationships(relationships, allowedEntityIds) {
    if (!this.enabled || !Array.isArray(relationships)) {
      return relationships || [];
    }

    const allowedSet = new Set(allowedEntityIds);

    // Only include relationships where both endpoints are accessible
    return relationships.filter((rel) => {
      const sourceAllowed = allowedSet.has(rel.from) || allowedSet.has(rel.source);
      const targetAllowed = allowedSet.has(rel.to) || allowedSet.has(rel.target);
      return sourceAllowed && targetAllowed;
    });
  }

  /**
   * Build OData filter for pre-query security trimming
   * @param {Object} user - User object with roles and groups
   * @returns {string} - OData filter string to append to search queries
   */
  buildSearchFilter(user) {
    if (!this.enabled) {
      return null;
    }

    const userPermissions = this._getUserPermissions(user);
    const filters = [];

    // Classification level filter
    const maxClassification = this._getMaxClassificationLevel(userPermissions);
    if (maxClassification < CLASSIFICATION_LEVELS.restricted) {
      const allowedClassifications = Object.entries(CLASSIFICATION_LEVELS)
        .filter(([_, level]) => level <= maxClassification)
        .map(([name]) => `classification eq '${name}'`);

      // Include documents without classification (default to internal)
      filters.push(`(classification eq null or ${allowedClassifications.join(' or ')})`);
    }

    // Group membership filter
    if (userPermissions.groups && userPermissions.groups.length > 0) {
      const groupFilters = userPermissions.groups.map(
        (group) => `allowedGroups/any(g: g eq '${this._escapeOData(group)}')`
      );
      // Include documents without group restrictions
      filters.push(`(allowedGroups eq null or ${groupFilters.join(' or ')})`);
    }

    // Department filter (if user has department)
    if (userPermissions.department) {
      filters.push(
        `(department eq null or department eq '${this._escapeOData(userPermissions.department)}')`
      );
    }

    return filters.length > 0 ? filters.join(' and ') : null;
  }

  /**
   * Check if user has access to a specific document
   * @param {Object} document - Document metadata
   * @param {Object} user - User object
   * @returns {Object} - { allowed, reason }
   */
  checkDocumentAccess(document, user) {
    const userPermissions = this._getUserPermissions(user);
    return this._checkAccess(document, userPermissions, {});
  }

  /**
   * Get user permissions from user object
   */
  _getUserPermissions(user) {
    if (!user) {
      return {
        roles: [],
        groups: [],
        department: null,
        highestRole: null,
        isAdmin: false,
      };
    }

    const roles = user.roles || [];
    const groups = user.groups || [];
    const department = user.department || null;

    // Find highest role in hierarchy
    let highestRoleIndex = -1;
    for (const role of roles) {
      const index = this.roleHierarchy.indexOf(role);
      if (index > highestRoleIndex) {
        highestRoleIndex = index;
      }
    }

    return {
      roles,
      groups,
      department,
      highestRole: highestRoleIndex >= 0 ? this.roleHierarchy[highestRoleIndex] : null,
      highestRoleIndex,
      isAdmin: roles.includes('Admin'),
    };
  }

  /**
   * Check access for a search result
   */
  _checkAccess(result, userPermissions, options) {
    // Admins have full access
    if (userPermissions.isAdmin) {
      return { allowed: true, reason: 'admin_access' };
    }

    // Check classification level
    const docClassification = result.classification || 'internal';
    const classificationLevel = CLASSIFICATION_LEVELS[docClassification] || 0;
    const userMaxLevel = this._getMaxClassificationLevel(userPermissions);

    if (classificationLevel > userMaxLevel) {
      return {
        allowed: false,
        reason: 'classification_denied',
        requiredPermission: `classification:${docClassification}`,
      };
    }

    // Check group restrictions
    if (result.allowedGroups && result.allowedGroups.length > 0) {
      const hasGroupAccess = result.allowedGroups.some((group) =>
        userPermissions.groups.includes(group)
      );

      if (!hasGroupAccess) {
        return {
          allowed: false,
          reason: 'group_denied',
          requiredPermission: `group:${result.allowedGroups.join(',')}`,
        };
      }
    }

    // Check owner access
    if (result.owner && result.owner !== userPermissions.userId) {
      // Check if user is in allowed viewers
      if (result.allowedViewers && !result.allowedViewers.includes(userPermissions.userId)) {
        // Not owner and not in allowed viewers - check if public
        if (result.visibility !== 'public') {
          return {
            allowed: false,
            reason: 'ownership_denied',
            requiredPermission: 'owner_or_allowed',
          };
        }
      }
    }

    // Check department restrictions
    if (result.restrictedToDepartment) {
      if (userPermissions.department !== result.restrictedToDepartment) {
        return {
          allowed: false,
          reason: 'department_denied',
          requiredPermission: `department:${result.restrictedToDepartment}`,
        };
      }
    }

    return { allowed: true, reason: 'granted' };
  }

  /**
   * Check access for a graph entity
   */
  _checkEntityAccess(entity, userPermissions) {
    // Admins have full access
    if (userPermissions.isAdmin) {
      return { allowed: true };
    }

    // Check entity status - pending entities may be restricted
    if (entity.status === 'pending_review' || entity.status === 'rejected') {
      // Only reviewers and above can see pending/rejected entities
      if (!['Reviewer', 'Admin'].some((r) => userPermissions.roles.includes(r))) {
        return {
          allowed: false,
          reason: 'status_restricted',
        };
      }
    }

    // Check if entity has access restrictions
    if (entity.accessRestriction) {
      const requiredRole = entity.accessRestriction.requiredRole;
      if (requiredRole && !userPermissions.roles.includes(requiredRole)) {
        return {
          allowed: false,
          reason: 'role_required',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Get maximum classification level user can access
   */
  _getMaxClassificationLevel(userPermissions) {
    if (userPermissions.isAdmin) {
      return CLASSIFICATION_LEVELS.restricted;
    }

    const roleAccess = ROLE_CLASSIFICATION_ACCESS[userPermissions.highestRole] || 'internal';
    return CLASSIFICATION_LEVELS[roleAccess] || CLASSIFICATION_LEVELS.internal;
  }

  /**
   * Remove sensitive fields from result based on user permissions
   */
  _trimSensitiveFields(result, userPermissions) {
    // Admins see everything
    if (userPermissions.isAdmin) {
      return result;
    }

    const trimmed = { ...result };

    // Remove internal metadata for non-reviewers
    if (!userPermissions.roles.includes('Reviewer')) {
      delete trimmed.internalNotes;
      delete trimmed.reviewerComments;
      delete trimmed.processingMetadata;
    }

    // Remove owner info if not admin
    if (!userPermissions.isAdmin) {
      delete trimmed.uploadedBy;
      delete trimmed.allowedViewers;
      delete trimmed.allowedGroups;
    }

    return trimmed;
  }

  /**
   * Log access denial for audit
   */
  _logDenial(result, user, decision) {
    const denial = {
      timestamp: new Date().toISOString(),
      documentId: result.id || result.documentId,
      userId: user?.id || user?.email || 'unknown',
      reason: decision.reason,
      requiredPermission: decision.requiredPermission,
    };

    this.denialLog.push(denial);

    // Keep only last 1000 denials in memory
    if (this.denialLog.length > 1000) {
      this.denialLog = this.denialLog.slice(-1000);
    }
  }

  /**
   * Get denial log (for audit purposes)
   */
  getDenialLog() {
    return [...this.denialLog];
  }

  /**
   * Clear denial log
   */
  clearDenialLog() {
    this.denialLog = [];
  }

  /**
   * Escape string for OData filter
   */
  _escapeOData(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/'/g, "''");
  }

  /**
   * Check if security trimming is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Enable/disable security trimming
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

// Singleton instance
let instance = null;

function getSecurityTrimmingService(options = {}) {
  if (!instance) {
    instance = new SecurityTrimmingService(options);
  }
  return instance;
}

// Factory function for testing
function createSecurityTrimmingService(options = {}) {
  return new SecurityTrimmingService(options);
}

module.exports = {
  SecurityTrimmingService,
  getSecurityTrimmingService,
  createSecurityTrimmingService,
  CLASSIFICATION_LEVELS,
  ROLE_CLASSIFICATION_ACCESS,
};
