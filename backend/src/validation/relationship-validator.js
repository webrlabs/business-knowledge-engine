/**
 * Relationship Validation Service
 *
 * Enforces domain/range constraints during entity/relationship extraction.
 * Validates extracted relationships against the formal JSON-LD ontology and
 * adds validation warnings without rejecting non-conforming extractions.
 *
 * Feature: F4.3.1 - Relationship Validation Rules
 * @see /ontology/business-process.jsonld
 * @see /backend/src/services/ontology-service.js
 */

const { initializeOntologyService, getOntologyService } = require('../services/ontology-service');
const { log } = require('../utils/logger');

/**
 * Confidence penalty factors for different types of constraint violations.
 * Penalties are applied multiplicatively (e.g., 0.8 = 20% reduction).
 */
const CONFIDENCE_PENALTIES = {
  DOMAIN_VIOLATION: 0.85,        // Source entity type violates domain constraint
  RANGE_VIOLATION: 0.85,         // Target entity type violates range constraint
  UNKNOWN_RELATIONSHIP_TYPE: 0.7, // Relationship type not in ontology
  UNKNOWN_ENTITY_TYPE: 0.9,      // Entity type not in ontology
  BOTH_CONSTRAINTS_VIOLATED: 0.7, // Both domain and range violated
};

/**
 * Validation warning severity levels
 */
const SEVERITY = {
  ERROR: 'error',     // Critical validation failure
  WARNING: 'warning', // Constraint violation (still usable)
  INFO: 'info',       // Informational (e.g., normalized type)
};

class RelationshipValidator {
  constructor() {
    this.ontologyService = null;
    this.initialized = false;
    this.stats = {
      totalValidated: 0,
      valid: 0,
      domainViolations: 0,
      rangeViolations: 0,
      unknownTypes: 0,
      normalized: 0,
    };
  }

  /**
   * Initialize the validator by loading the ontology service
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.ontologyService = await initializeOntologyService();
      this.initialized = true;
      log.info('[RelationshipValidator] Initialized successfully');
    } catch (error) {
      log.error('[RelationshipValidator] Failed to initialize:', { error: error.message });
      throw new Error(`RelationshipValidator initialization failed: ${error.message}`);
    }
  }

  /**
   * Validate a single relationship against ontology constraints.
   * Does NOT reject invalid relationships - adds warnings and applies confidence penalty.
   *
   * @param {Object} relationship - The relationship to validate
   * @param {string} relationship.from - Source entity name
   * @param {string} relationship.to - Target entity name
   * @param {string} relationship.type - Relationship type
   * @param {number} [relationship.confidence] - Confidence score (0-1)
   * @param {Map|Object} entityTypeMap - Map of entity names to their types
   * @returns {Object} Validated relationship with warnings and adjusted confidence
   */
  validateRelationship(relationship, entityTypeMap) {
    this._ensureInitialized();

    const result = {
      ...relationship,
      validationWarnings: [],
      validationPassed: true,
      originalConfidence: relationship.confidence,
      normalizedType: relationship.type,
    };

    // Get entity types from the map
    const typeMap = entityTypeMap instanceof Map ? entityTypeMap : new Map(Object.entries(entityTypeMap));
    const sourceType = typeMap.get(relationship.from);
    const targetType = typeMap.get(relationship.to);

    // Validate using ontology service
    const validation = this.ontologyService.validateRelationship(
      relationship.type,
      sourceType,
      targetType
    );

    // Track normalized type
    if (validation.normalizedType !== relationship.type) {
      result.normalizedType = validation.normalizedType;
      result.validationWarnings.push({
        severity: SEVERITY.INFO,
        code: 'TYPE_NORMALIZED',
        message: `Relationship type normalized: "${relationship.type}" -> "${validation.normalizedType}"`,
      });
      this.stats.normalized++;
    }

    // Apply the normalized type
    result.type = validation.normalizedType;

    // Handle unknown relationship type
    if (!validation.valid && validation.warnings.some(w => w.includes('not defined'))) {
      result.validationPassed = false;
      result.validationWarnings.push({
        severity: SEVERITY.WARNING,
        code: 'UNKNOWN_RELATIONSHIP_TYPE',
        message: `Relationship type "${relationship.type}" is not defined in the ontology`,
        suggestion: 'Consider using a standard relationship type from the ontology',
      });
      result.confidence = this._applyPenalty(result.confidence, CONFIDENCE_PENALTIES.UNKNOWN_RELATIONSHIP_TYPE);
      this.stats.unknownTypes++;
    }

    // Handle domain violation
    if (!validation.domainValid) {
      result.validationPassed = false;
      const expectedDomain = this.ontologyService.getDomainForRelationship(validation.normalizedType);
      result.validationWarnings.push({
        severity: SEVERITY.WARNING,
        code: 'DOMAIN_VIOLATION',
        message: `Source entity type "${sourceType}" violates domain constraint for ${validation.normalizedType}`,
        expected: expectedDomain,
        actual: sourceType,
        from: relationship.from,
      });
      this.stats.domainViolations++;
    }

    // Handle range violation
    if (!validation.rangeValid) {
      result.validationPassed = false;
      const expectedRange = this.ontologyService.getRangeForRelationship(validation.normalizedType);
      result.validationWarnings.push({
        severity: SEVERITY.WARNING,
        code: 'RANGE_VIOLATION',
        message: `Target entity type "${targetType}" violates range constraint for ${validation.normalizedType}`,
        expected: expectedRange,
        actual: targetType,
        to: relationship.to,
      });
      this.stats.rangeViolations++;
    }

    // Apply confidence penalties based on violations
    if (!validation.domainValid && !validation.rangeValid) {
      result.confidence = this._applyPenalty(result.confidence, CONFIDENCE_PENALTIES.BOTH_CONSTRAINTS_VIOLATED);
    } else if (!validation.domainValid) {
      result.confidence = this._applyPenalty(result.confidence, CONFIDENCE_PENALTIES.DOMAIN_VIOLATION);
    } else if (!validation.rangeValid) {
      result.confidence = this._applyPenalty(result.confidence, CONFIDENCE_PENALTIES.RANGE_VIOLATION);
    }

    this.stats.totalValidated++;
    if (result.validationPassed) {
      this.stats.valid++;
    }

    return result;
  }

  /**
   * Validate a single entity type against the ontology.
   *
   * @param {Object} entity - The entity to validate
   * @param {string} entity.name - Entity name
   * @param {string} entity.type - Entity type
   * @param {number} [entity.confidence] - Confidence score (0-1)
   * @returns {Object} Validated entity with warnings and adjusted confidence
   */
  validateEntity(entity) {
    this._ensureInitialized();

    const result = {
      ...entity,
      validationWarnings: [],
      validationPassed: true,
      originalConfidence: entity.confidence,
    };

    const validation = this.ontologyService.validateEntityType(entity.type);

    if (!validation.valid) {
      result.validationPassed = false;
      result.validationWarnings.push({
        severity: SEVERITY.WARNING,
        code: 'UNKNOWN_ENTITY_TYPE',
        message: validation.message,
        suggestion: validation.suggestion,
        type: entity.type,
      });
      result.confidence = this._applyPenalty(result.confidence, CONFIDENCE_PENALTIES.UNKNOWN_ENTITY_TYPE);

      // Apply suggested type if available
      if (validation.suggestion) {
        result.suggestedType = validation.suggestion;
      }
    }

    return result;
  }

  /**
   * Validate a batch of entities and relationships from document extraction.
   * This is the main entry point for the document processor integration.
   *
   * @param {Array} entities - Array of extracted entities
   * @param {Array} relationships - Array of extracted relationships
   * @param {Object} [options] - Validation options
   * @param {boolean} [options.applyPenalties=true] - Whether to apply confidence penalties
   * @param {boolean} [options.includeReport=false] - Include detailed validation report
   * @returns {Object} Validation results with validated entities and relationships
   */
  validateExtraction(entities, relationships, options = {}) {
    this._ensureInitialized();

    const applyPenalties = options.applyPenalties !== false;
    const includeReport = options.includeReport === true;

    // Reset stats for this batch
    this.stats = {
      totalValidated: 0,
      valid: 0,
      domainViolations: 0,
      rangeViolations: 0,
      unknownTypes: 0,
      normalized: 0,
    };

    // Validate entities and build type map
    const entityTypeMap = new Map();
    const validatedEntities = entities.map(entity => {
      const validated = this.validateEntity(entity);
      entityTypeMap.set(entity.name, entity.type);

      // Revert confidence if penalties disabled
      if (!applyPenalties && validated.originalConfidence !== undefined) {
        validated.confidence = validated.originalConfidence;
      }

      return validated;
    });

    // Validate relationships
    const validatedRelationships = relationships.map(relationship => {
      const validated = this.validateRelationship(relationship, entityTypeMap);

      // Revert confidence if penalties disabled
      if (!applyPenalties && validated.originalConfidence !== undefined) {
        validated.confidence = validated.originalConfidence;
      }

      return validated;
    });

    // Compile validation summary
    const entityWarnings = validatedEntities.filter(e => e.validationWarnings.length > 0);
    const relationshipWarnings = validatedRelationships.filter(r => r.validationWarnings.length > 0);

    const result = {
      entities: validatedEntities,
      relationships: validatedRelationships,
      summary: {
        totalEntities: entities.length,
        totalRelationships: relationships.length,
        entitiesWithWarnings: entityWarnings.length,
        relationshipsWithWarnings: relationshipWarnings.length,
        domainViolations: this.stats.domainViolations,
        rangeViolations: this.stats.rangeViolations,
        unknownRelationshipTypes: this.stats.unknownTypes,
        normalizedRelationships: this.stats.normalized,
        overallValid: entityWarnings.length === 0 && relationshipWarnings.length === 0,
      },
    };

    // Include detailed report if requested
    if (includeReport) {
      result.report = this.ontologyService.generateValidationReport(entities, relationships);
    }

    log.info('[RelationshipValidator] Extraction validation completed', {
      entities: entities.length,
      relationships: relationships.length,
      entitiesWithWarnings: entityWarnings.length,
      relationshipsWithWarnings: relationshipWarnings.length,
      domainViolations: this.stats.domainViolations,
      rangeViolations: this.stats.rangeViolations,
    });

    return result;
  }

  /**
   * Get validation statistics for the current session.
   * @returns {Object} Current validation statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset validation statistics.
   */
  resetStats() {
    this.stats = {
      totalValidated: 0,
      valid: 0,
      domainViolations: 0,
      rangeViolations: 0,
      unknownTypes: 0,
      normalized: 0,
    };
  }

  /**
   * Get domain/range constraints for a relationship type.
   * Useful for UI display and documentation.
   *
   * @param {string} relationshipType - The relationship type
   * @returns {Object|null} Constraint information or null if type unknown
   */
  getConstraintsForRelationship(relationshipType) {
    this._ensureInitialized();

    const normalized = this.ontologyService.normalizeRelationshipType(relationshipType);
    const domain = this.ontologyService.getDomainForRelationship(normalized);
    const range = this.ontologyService.getRangeForRelationship(normalized);

    if (!domain && !range) {
      return null;
    }

    return {
      type: normalized,
      originalType: relationshipType !== normalized ? relationshipType : undefined,
      domain: {
        type: domain,
        subtypes: domain ? this.ontologyService.getSubtypes(domain) : [],
      },
      range: {
        type: range,
        subtypes: range ? this.ontologyService.getSubtypes(range) : [],
      },
    };
  }

  /**
   * Check if a specific relationship is valid between two entity types.
   * Quick check without modifying the relationship object.
   *
   * @param {string} relationshipType - The relationship type
   * @param {string} sourceEntityType - Source entity type
   * @param {string} targetEntityType - Target entity type
   * @returns {Object} Validation result with valid flag and reasons
   */
  isValidRelationship(relationshipType, sourceEntityType, targetEntityType) {
    this._ensureInitialized();

    const validation = this.ontologyService.validateRelationship(
      relationshipType,
      sourceEntityType,
      targetEntityType
    );

    return {
      valid: validation.valid,
      domainValid: validation.domainValid,
      rangeValid: validation.rangeValid,
      normalizedType: validation.normalizedType,
      warnings: validation.warnings,
    };
  }

  /**
   * Apply a confidence penalty multiplicatively.
   * @private
   */
  _applyPenalty(confidence, penalty) {
    if (typeof confidence !== 'number') {
      return confidence;
    }
    return Math.max(0, Math.min(1, confidence * penalty));
  }

  /**
   * Ensure the validator is initialized.
   * @private
   */
  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('RelationshipValidator not initialized. Call initialize() first.');
    }
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton RelationshipValidator instance.
 * @returns {RelationshipValidator}
 */
function getRelationshipValidator() {
  if (!instance) {
    instance = new RelationshipValidator();
  }
  return instance;
}

/**
 * Initialize and get the RelationshipValidator.
 * @returns {Promise<RelationshipValidator>}
 */
async function initializeRelationshipValidator() {
  const validator = getRelationshipValidator();
  await validator.initialize();
  return validator;
}

module.exports = {
  RelationshipValidator,
  getRelationshipValidator,
  initializeRelationshipValidator,
  CONFIDENCE_PENALTIES,
  SEVERITY,
};
