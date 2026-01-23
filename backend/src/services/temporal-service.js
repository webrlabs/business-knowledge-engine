/**
 * Temporal Service
 *
 * Feature: F2.3.1 - Temporal Schema Fields
 *
 * Provides validation, computation, and helper functions for temporal entity versioning.
 * Supports:
 * - Temporal field validation
 * - Status computation
 * - Time range queries
 * - Version chain analysis
 */

const TEMPORAL_STATUS = {
  CURRENT: 'current',
  EXPIRED: 'expired',
  PENDING: 'pending',
  SUPERSEDED: 'superseded',
};

const TEMPORAL_FIELDS = [
  'validFrom',
  'validTo',
  'supersededBy',
  'supersedes',
  'temporalStatus',
  'versionSequence',
];

/**
 * Validate temporal fields on an entity.
 * Returns validation result with errors if invalid.
 *
 * @param {Object} entity - Entity to validate
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateTemporalFields(entity) {
  const errors = [];

  // Validate validFrom
  if (entity.validFrom) {
    if (!isValidISODateTime(entity.validFrom)) {
      errors.push(`validFrom must be a valid ISO 8601 datetime, got: ${entity.validFrom}`);
    }
  }

  // Validate validTo
  if (entity.validTo) {
    if (!isValidISODateTime(entity.validTo)) {
      errors.push(`validTo must be a valid ISO 8601 datetime, got: ${entity.validTo}`);
    }
  }

  // Validate temporal ordering: validFrom must be before validTo
  if (entity.validFrom && entity.validTo) {
    const from = new Date(entity.validFrom);
    const to = new Date(entity.validTo);
    if (from >= to) {
      errors.push(`validFrom (${entity.validFrom}) must be before validTo (${entity.validTo})`);
    }
  }

  // Validate temporalStatus
  if (entity.temporalStatus) {
    const validStatuses = Object.values(TEMPORAL_STATUS);
    if (!validStatuses.includes(entity.temporalStatus)) {
      errors.push(`temporalStatus must be one of [${validStatuses.join(', ')}], got: ${entity.temporalStatus}`);
    }
  }

  // Validate versionSequence
  if (entity.versionSequence !== undefined && entity.versionSequence !== null) {
    if (!Number.isInteger(entity.versionSequence) || entity.versionSequence < 1) {
      errors.push(`versionSequence must be a positive integer, got: ${entity.versionSequence}`);
    }
  }

  // Validate supersededBy/supersedes consistency
  if (entity.supersededBy && entity.temporalStatus === TEMPORAL_STATUS.CURRENT) {
    errors.push(`Entity with supersededBy cannot have temporalStatus='current'`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a string is a valid ISO 8601 datetime.
 *
 * @param {string} dateString - String to check
 * @returns {boolean} True if valid ISO datetime
 */
function isValidISODateTime(dateString) {
  if (typeof dateString !== 'string') return false;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return false;

  // Check if it's actually ISO format (should contain T and/or Z or timezone)
  // Allow various ISO formats
  const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?)?$/;
  return isoPattern.test(dateString);
}

/**
 * Compute the temporal status based on entity temporal fields.
 *
 * @param {Object} entity - Entity with temporal fields
 * @param {Date|string} [referenceTime] - Time to use for computation (default: now)
 * @returns {string} Computed temporal status
 */
function computeTemporalStatus(entity, referenceTime = null) {
  const now = referenceTime ? new Date(referenceTime) : new Date();

  // If entity has been superseded
  if (entity.supersededBy) {
    return TEMPORAL_STATUS.SUPERSEDED;
  }

  // Parse validFrom
  const validFrom = entity.validFrom ? new Date(entity.validFrom) : new Date(0);

  // If validFrom is in the future
  if (validFrom > now) {
    return TEMPORAL_STATUS.PENDING;
  }

  // If validTo is set and has passed
  if (entity.validTo) {
    const validTo = new Date(entity.validTo);
    if (validTo < now) {
      return TEMPORAL_STATUS.EXPIRED;
    }
  }

  return TEMPORAL_STATUS.CURRENT;
}

/**
 * Check if an entity is valid at a specific point in time.
 *
 * @param {Object} entity - Entity to check
 * @param {Date|string} pointInTime - Time to check
 * @returns {boolean} True if entity is valid at the given time
 */
function isValidAt(entity, pointInTime) {
  const targetTime = new Date(pointInTime);

  // Check supersededBy - if superseded, check when
  if (entity.supersededBy) {
    // If validTo is set, entity was valid until validTo
    if (entity.validTo) {
      const validTo = new Date(entity.validTo);
      if (targetTime >= validTo) return false;
    } else {
      // No validTo means we can't determine when it was superseded
      // Conservatively consider it invalid
      return false;
    }
  }

  // Check validFrom
  const validFrom = entity.validFrom ? new Date(entity.validFrom) : new Date(0);
  if (targetTime < validFrom) return false;

  // Check validTo
  if (entity.validTo) {
    const validTo = new Date(entity.validTo);
    if (targetTime >= validTo) return false;
  }

  return true;
}

/**
 * Get the effective date range for an entity.
 *
 * @param {Object} entity - Entity with temporal fields
 * @returns {Object} { validFrom: Date, validTo: Date|null, durationMs: number|null }
 */
function getEffectiveDateRange(entity) {
  const validFrom = entity.validFrom ? new Date(entity.validFrom) : null;
  const validTo = entity.validTo ? new Date(entity.validTo) : null;

  let durationMs = null;
  if (validFrom && validTo) {
    durationMs = validTo.getTime() - validFrom.getTime();
  }

  return {
    validFrom,
    validTo,
    durationMs,
    durationDays: durationMs ? Math.floor(durationMs / (1000 * 60 * 60 * 24)) : null,
    isOpenEnded: validTo === null,
    isCurrent: computeTemporalStatus(entity) === TEMPORAL_STATUS.CURRENT,
  };
}

/**
 * Create temporal fields with defaults for a new entity.
 *
 * @param {Object} [overrides] - Optional overrides for temporal fields
 * @returns {Object} Temporal fields for a new entity
 */
function createDefaultTemporalFields(overrides = {}) {
  const now = new Date().toISOString();

  return {
    validFrom: overrides.validFrom || now,
    validTo: overrides.validTo || null,
    supersededBy: overrides.supersededBy || null,
    supersedes: overrides.supersedes || null,
    temporalStatus: overrides.temporalStatus || TEMPORAL_STATUS.CURRENT,
    versionSequence: overrides.versionSequence || 1,
  };
}

/**
 * Prepare an entity for versioning (when creating a new version).
 *
 * @param {Object} currentEntity - Current entity being superseded
 * @param {Object} updates - Updates for the new version
 * @returns {{ newVersion: Object, currentUpdates: Object }} Prepared data
 */
function prepareEntityVersion(currentEntity, updates) {
  const now = new Date().toISOString();
  const newVersionSequence = (currentEntity.versionSequence || 1) + 1;

  // Prepare new version
  const newVersion = {
    ...currentEntity,
    ...updates,
    id: null, // Will be generated
    supersedes: currentEntity.id,
    supersededBy: null,
    validFrom: now,
    validTo: null,
    temporalStatus: TEMPORAL_STATUS.CURRENT,
    versionSequence: newVersionSequence,
    createdAt: now,
    updatedAt: now,
  };

  // Remove old id
  delete newVersion.id;

  // Prepare updates for current entity
  const currentUpdates = {
    validTo: now,
    temporalStatus: TEMPORAL_STATUS.SUPERSEDED,
    updatedAt: now,
    // supersededBy will be set after new version is created
  };

  return { newVersion, currentUpdates };
}

/**
 * Validate a version chain for consistency.
 *
 * @param {Array} versionChain - Array of entity versions, oldest first
 * @returns {Object} Validation result { valid: boolean, errors: string[], warnings: string[] }
 */
function validateVersionChain(versionChain) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(versionChain) || versionChain.length === 0) {
    return { valid: true, errors: [], warnings: ['Empty version chain'] };
  }

  // Check version sequence is monotonically increasing
  for (let i = 1; i < versionChain.length; i++) {
    const prev = versionChain[i - 1];
    const curr = versionChain[i];

    // Version sequence should increase
    if (curr.versionSequence <= prev.versionSequence) {
      errors.push(
        `Version sequence not increasing at index ${i}: ` +
        `${prev.versionSequence} -> ${curr.versionSequence}`
      );
    }

    // supersedes/supersededBy should form a chain
    if (curr.supersedes !== prev.id) {
      warnings.push(
        `Version at index ${i} does not reference previous version: ` +
        `expected supersedes=${prev.id}, got ${curr.supersedes}`
      );
    }

    if (prev.supersededBy !== curr.id) {
      warnings.push(
        `Version at index ${i - 1} does not reference next version: ` +
        `expected supersededBy=${curr.id}, got ${prev.supersededBy}`
      );
    }

    // validFrom should increase
    if (curr.validFrom && prev.validFrom) {
      const currFrom = new Date(curr.validFrom);
      const prevFrom = new Date(prev.validFrom);
      if (currFrom < prevFrom) {
        warnings.push(
          `validFrom not monotonically increasing at index ${i}: ` +
          `${prev.validFrom} -> ${curr.validFrom}`
        );
      }
    }
  }

  // Only the last version should be current
  for (let i = 0; i < versionChain.length - 1; i++) {
    if (versionChain[i].temporalStatus === TEMPORAL_STATUS.CURRENT) {
      errors.push(
        `Non-final version at index ${i} has status 'current'. ` +
        `Only the last version should be current.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Filter entities by temporal status.
 *
 * @param {Array} entities - Array of entities
 * @param {string|string[]} statuses - Status or array of statuses to filter by
 * @returns {Array} Filtered entities
 */
function filterByTemporalStatus(entities, statuses) {
  const statusList = Array.isArray(statuses) ? statuses : [statuses];
  return entities.filter((e) => statusList.includes(e.temporalStatus));
}

/**
 * Filter entities valid at a specific time.
 *
 * @param {Array} entities - Array of entities
 * @param {Date|string} pointInTime - Time to check validity
 * @returns {Array} Entities valid at the given time
 */
function filterValidAt(entities, pointInTime) {
  return entities.filter((e) => isValidAt(e, pointInTime));
}

/**
 * Sort entities by version sequence.
 *
 * @param {Array} entities - Array of entities
 * @param {boolean} [descending=false] - Sort descending (newest first)
 * @returns {Array} Sorted entities
 */
function sortByVersionSequence(entities, descending = false) {
  return [...entities].sort((a, b) => {
    const seqA = a.versionSequence || 1;
    const seqB = b.versionSequence || 1;
    return descending ? seqB - seqA : seqA - seqB;
  });
}

/**
 * Get summary statistics for temporal fields in a collection of entities.
 *
 * @param {Array} entities - Array of entities
 * @returns {Object} Summary statistics
 */
function getTemporalSummary(entities) {
  const summary = {
    total: entities.length,
    byStatus: {
      current: 0,
      expired: 0,
      pending: 0,
      superseded: 0,
      unknown: 0,
    },
    withValidFrom: 0,
    withValidTo: 0,
    withSupersededBy: 0,
    withSupersedes: 0,
    maxVersionSequence: 0,
    averageVersionSequence: 0,
    versionSequenceDistribution: {},
  };

  let totalVersionSequence = 0;

  for (const entity of entities) {
    // Count by status
    const status = entity.temporalStatus || 'unknown';
    if (status in summary.byStatus) {
      summary.byStatus[status]++;
    } else {
      summary.byStatus.unknown++;
    }

    // Count fields
    if (entity.validFrom) summary.withValidFrom++;
    if (entity.validTo) summary.withValidTo++;
    if (entity.supersededBy) summary.withSupersededBy++;
    if (entity.supersedes) summary.withSupersedes++;

    // Version sequence stats
    const seq = entity.versionSequence || 1;
    if (seq > summary.maxVersionSequence) {
      summary.maxVersionSequence = seq;
    }
    totalVersionSequence += seq;

    // Distribution
    summary.versionSequenceDistribution[seq] =
      (summary.versionSequenceDistribution[seq] || 0) + 1;
  }

  if (entities.length > 0) {
    summary.averageVersionSequence = totalVersionSequence / entities.length;
  }

  return summary;
}

// Singleton service class
class TemporalService {
  constructor() {
    this.TEMPORAL_STATUS = TEMPORAL_STATUS;
    this.TEMPORAL_FIELDS = TEMPORAL_FIELDS;
  }

  validate(entity) {
    return validateTemporalFields(entity);
  }

  computeStatus(entity, referenceTime) {
    return computeTemporalStatus(entity, referenceTime);
  }

  isValidAt(entity, pointInTime) {
    return isValidAt(entity, pointInTime);
  }

  getDateRange(entity) {
    return getEffectiveDateRange(entity);
  }

  createDefaults(overrides) {
    return createDefaultTemporalFields(overrides);
  }

  prepareVersion(currentEntity, updates) {
    return prepareEntityVersion(currentEntity, updates);
  }

  validateChain(versionChain) {
    return validateVersionChain(versionChain);
  }

  filterByStatus(entities, statuses) {
    return filterByTemporalStatus(entities, statuses);
  }

  filterValidAt(entities, pointInTime) {
    return filterValidAt(entities, pointInTime);
  }

  sortByVersion(entities, descending) {
    return sortByVersionSequence(entities, descending);
  }

  getSummary(entities) {
    return getTemporalSummary(entities);
  }
}

// Singleton instance
let instance = null;

function getTemporalService() {
  if (!instance) {
    instance = new TemporalService();
  }
  return instance;
}

module.exports = {
  TemporalService,
  getTemporalService,
  TEMPORAL_STATUS,
  TEMPORAL_FIELDS,
  validateTemporalFields,
  computeTemporalStatus,
  isValidAt,
  isValidISODateTime,
  getEffectiveDateRange,
  createDefaultTemporalFields,
  prepareEntityVersion,
  validateVersionChain,
  filterByTemporalStatus,
  filterValidAt,
  sortByVersionSequence,
  getTemporalSummary,
};
