/**
 * Tests for Temporal Service
 *
 * Feature: F2.3.1 - Temporal Schema Fields
 */

const {
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
} = require('../temporal-service');

describe('Temporal Service', () => {
  describe('TEMPORAL_STATUS constants', () => {
    it('should have all expected status values', () => {
      expect(TEMPORAL_STATUS.CURRENT).toBe('current');
      expect(TEMPORAL_STATUS.EXPIRED).toBe('expired');
      expect(TEMPORAL_STATUS.PENDING).toBe('pending');
      expect(TEMPORAL_STATUS.SUPERSEDED).toBe('superseded');
    });
  });

  describe('TEMPORAL_FIELDS', () => {
    it('should contain all expected fields', () => {
      expect(TEMPORAL_FIELDS).toContain('validFrom');
      expect(TEMPORAL_FIELDS).toContain('validTo');
      expect(TEMPORAL_FIELDS).toContain('supersededBy');
      expect(TEMPORAL_FIELDS).toContain('supersedes');
      expect(TEMPORAL_FIELDS).toContain('temporalStatus');
      expect(TEMPORAL_FIELDS).toContain('versionSequence');
      expect(TEMPORAL_FIELDS).toHaveLength(6);
    });
  });

  describe('isValidISODateTime', () => {
    it('should accept valid ISO datetime strings', () => {
      expect(isValidISODateTime('2026-01-23T10:30:00.000Z')).toBe(true);
      expect(isValidISODateTime('2026-01-23T10:30:00Z')).toBe(true);
      expect(isValidISODateTime('2026-01-23T10:30:00+05:30')).toBe(true);
      expect(isValidISODateTime('2026-01-23')).toBe(true);
    });

    it('should reject invalid datetime strings', () => {
      expect(isValidISODateTime('not a date')).toBe(false);
      expect(isValidISODateTime('')).toBe(false);
      expect(isValidISODateTime(null)).toBe(false);
      expect(isValidISODateTime(undefined)).toBe(false);
      expect(isValidISODateTime(12345)).toBe(false);
      expect(isValidISODateTime('2026/01/23')).toBe(false);
    });
  });

  describe('validateTemporalFields', () => {
    it('should validate entity with all valid temporal fields', () => {
      const entity = {
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2026-12-31T23:59:59Z',
        temporalStatus: 'current',
        versionSequence: 1,
      };

      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate entity with minimal fields', () => {
      const entity = {};
      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid validFrom', () => {
      const entity = {
        validFrom: 'not-a-date',
      };

      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('validFrom must be a valid ISO 8601 datetime')
      );
    });

    it('should reject invalid validTo', () => {
      const entity = {
        validTo: 'invalid',
      };

      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('validTo must be a valid ISO 8601 datetime')
      );
    });

    it('should reject validFrom >= validTo', () => {
      const entity = {
        validFrom: '2026-12-31T23:59:59Z',
        validTo: '2026-01-01T00:00:00Z',
      };

      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('validFrom')
      );
    });

    it('should reject invalid temporalStatus', () => {
      const entity = {
        temporalStatus: 'invalid-status',
      };

      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('temporalStatus must be one of')
      );
    });

    it('should reject invalid versionSequence', () => {
      const entity = {
        versionSequence: 0,
      };

      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('versionSequence must be a positive integer')
      );

      const entity2 = {
        versionSequence: -1,
      };
      expect(validateTemporalFields(entity2).valid).toBe(false);

      const entity3 = {
        versionSequence: 1.5,
      };
      expect(validateTemporalFields(entity3).valid).toBe(false);
    });

    it('should reject supersededBy with current status', () => {
      const entity = {
        supersededBy: 'some-id',
        temporalStatus: 'current',
      };

      const result = validateTemporalFields(entity);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.stringContaining('supersededBy cannot have temporalStatus=\'current\'')
      );
    });
  });

  describe('computeTemporalStatus', () => {
    it('should return superseded when supersededBy is set', () => {
      const entity = {
        supersededBy: 'other-entity-id',
        validFrom: '2020-01-01T00:00:00Z',
      };

      expect(computeTemporalStatus(entity)).toBe('superseded');
    });

    it('should return pending when validFrom is in the future', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const entity = {
        validFrom: futureDate.toISOString(),
      };

      expect(computeTemporalStatus(entity)).toBe('pending');
    });

    it('should return expired when validTo is in the past', () => {
      const entity = {
        validFrom: '2020-01-01T00:00:00Z',
        validTo: '2020-12-31T23:59:59Z',
      };

      expect(computeTemporalStatus(entity)).toBe('expired');
    });

    it('should return current for valid entity with no expiration', () => {
      const entity = {
        validFrom: '2020-01-01T00:00:00Z',
        validTo: null,
      };

      expect(computeTemporalStatus(entity)).toBe('current');
    });

    it('should return current for valid entity within date range', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const entity = {
        validFrom: '2020-01-01T00:00:00Z',
        validTo: futureDate.toISOString(),
      };

      expect(computeTemporalStatus(entity)).toBe('current');
    });

    it('should compute status relative to reference time', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
        validTo: '2025-12-31T23:59:59Z',
      };

      // Before valid range
      expect(computeTemporalStatus(entity, '2024-06-01T00:00:00Z')).toBe('pending');

      // Within valid range
      expect(computeTemporalStatus(entity, '2025-06-01T00:00:00Z')).toBe('current');

      // After valid range
      expect(computeTemporalStatus(entity, '2026-06-01T00:00:00Z')).toBe('expired');
    });
  });

  describe('isValidAt', () => {
    it('should return true for entity valid at given time', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
        validTo: '2025-12-31T23:59:59Z',
      };

      expect(isValidAt(entity, '2025-06-15T12:00:00Z')).toBe(true);
    });

    it('should return false for entity before validFrom', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
      };

      expect(isValidAt(entity, '2024-06-15T12:00:00Z')).toBe(false);
    });

    it('should return false for entity after validTo', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
        validTo: '2025-12-31T23:59:59Z',
      };

      expect(isValidAt(entity, '2026-06-15T12:00:00Z')).toBe(false);
    });

    it('should return false for superseded entity without validTo', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
        supersededBy: 'new-version',
      };

      expect(isValidAt(entity, '2025-06-15T12:00:00Z')).toBe(false);
    });

    it('should handle edge cases at boundary times', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
        validTo: '2025-12-31T23:59:59Z',
      };

      // Exactly at validFrom - should be valid
      expect(isValidAt(entity, '2025-01-01T00:00:00Z')).toBe(true);

      // Exactly at validTo - should not be valid (exclusive)
      expect(isValidAt(entity, '2025-12-31T23:59:59Z')).toBe(false);
    });
  });

  describe('getEffectiveDateRange', () => {
    it('should return date range for entity with both validFrom and validTo', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
        validTo: '2025-12-31T00:00:00Z',
      };

      const range = getEffectiveDateRange(entity);

      expect(range.validFrom).toEqual(new Date('2025-01-01T00:00:00Z'));
      expect(range.validTo).toEqual(new Date('2025-12-31T00:00:00Z'));
      expect(range.isOpenEnded).toBe(false);
      expect(range.durationDays).toBe(364);
    });

    it('should handle open-ended entities', () => {
      const entity = {
        validFrom: '2025-01-01T00:00:00Z',
        validTo: null,
      };

      const range = getEffectiveDateRange(entity);

      expect(range.validFrom).toEqual(new Date('2025-01-01T00:00:00Z'));
      expect(range.validTo).toBeNull();
      expect(range.isOpenEnded).toBe(true);
      expect(range.durationMs).toBeNull();
    });
  });

  describe('createDefaultTemporalFields', () => {
    it('should create defaults with current timestamp', () => {
      const before = new Date();
      const fields = createDefaultTemporalFields();
      const after = new Date();

      expect(new Date(fields.validFrom).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(new Date(fields.validFrom).getTime()).toBeLessThanOrEqual(after.getTime());
      expect(fields.validTo).toBeNull();
      expect(fields.supersededBy).toBeNull();
      expect(fields.supersedes).toBeNull();
      expect(fields.temporalStatus).toBe('current');
      expect(fields.versionSequence).toBe(1);
    });

    it('should allow overrides', () => {
      const fields = createDefaultTemporalFields({
        validFrom: '2025-01-01T00:00:00Z',
        versionSequence: 5,
      });

      expect(fields.validFrom).toBe('2025-01-01T00:00:00Z');
      expect(fields.versionSequence).toBe(5);
    });
  });

  describe('prepareEntityVersion', () => {
    it('should prepare new version with incremented sequence', () => {
      const current = {
        id: 'entity-v1',
        name: 'Test Entity',
        versionSequence: 2,
        validFrom: '2024-01-01T00:00:00Z',
      };

      const updates = {
        description: 'Updated description',
      };

      const result = prepareEntityVersion(current, updates);

      expect(result.newVersion.name).toBe('Test Entity');
      expect(result.newVersion.description).toBe('Updated description');
      expect(result.newVersion.supersedes).toBe('entity-v1');
      expect(result.newVersion.supersededBy).toBeNull();
      expect(result.newVersion.temporalStatus).toBe('current');
      expect(result.newVersion.versionSequence).toBe(3);
      expect(result.newVersion.id).toBeUndefined();

      expect(result.currentUpdates.temporalStatus).toBe('superseded');
      expect(result.currentUpdates.validTo).toBeDefined();
    });
  });

  describe('validateVersionChain', () => {
    it('should validate correct version chain', () => {
      const chain = [
        { id: 'v1', versionSequence: 1, supersededBy: 'v2', temporalStatus: 'superseded' },
        { id: 'v2', versionSequence: 2, supersedes: 'v1', supersededBy: 'v3', temporalStatus: 'superseded' },
        { id: 'v3', versionSequence: 3, supersedes: 'v2', temporalStatus: 'current' },
      ];

      const result = validateVersionChain(chain);
      expect(result.valid).toBe(true);
    });

    it('should detect non-increasing version sequence', () => {
      const chain = [
        { id: 'v1', versionSequence: 2, temporalStatus: 'superseded' },
        { id: 'v2', versionSequence: 1, temporalStatus: 'current' },
      ];

      const result = validateVersionChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('not increasing'))).toBe(true);
    });

    it('should detect non-final current status', () => {
      const chain = [
        { id: 'v1', versionSequence: 1, temporalStatus: 'current' },
        { id: 'v2', versionSequence: 2, temporalStatus: 'current' },
      ];

      const result = validateVersionChain(chain);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Non-final version'))).toBe(true);
    });

    it('should handle empty chain', () => {
      const result = validateVersionChain([]);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContainEqual(expect.stringContaining('Empty'));
    });
  });

  describe('filterByTemporalStatus', () => {
    const entities = [
      { id: 'a', temporalStatus: 'current' },
      { id: 'b', temporalStatus: 'expired' },
      { id: 'c', temporalStatus: 'current' },
      { id: 'd', temporalStatus: 'superseded' },
    ];

    it('should filter by single status', () => {
      const result = filterByTemporalStatus(entities, 'current');
      expect(result).toHaveLength(2);
      expect(result.every(e => e.temporalStatus === 'current')).toBe(true);
    });

    it('should filter by multiple statuses', () => {
      const result = filterByTemporalStatus(entities, ['current', 'superseded']);
      expect(result).toHaveLength(3);
    });
  });

  describe('filterValidAt', () => {
    it('should filter entities valid at a specific time', () => {
      const entities = [
        { id: 'a', validFrom: '2025-01-01T00:00:00Z', validTo: '2025-06-30T00:00:00Z' },
        { id: 'b', validFrom: '2025-04-01T00:00:00Z', validTo: '2025-12-31T00:00:00Z' },
        { id: 'c', validFrom: '2025-07-01T00:00:00Z' },
      ];

      // In May, only a and b are valid
      const may = filterValidAt(entities, '2025-05-15T00:00:00Z');
      expect(may).toHaveLength(2);
      expect(may.map(e => e.id).sort()).toEqual(['a', 'b']);

      // In August, only b and c are valid
      const aug = filterValidAt(entities, '2025-08-15T00:00:00Z');
      expect(aug).toHaveLength(2);
      expect(aug.map(e => e.id).sort()).toEqual(['b', 'c']);
    });
  });

  describe('sortByVersionSequence', () => {
    const entities = [
      { id: 'c', versionSequence: 3 },
      { id: 'a', versionSequence: 1 },
      { id: 'b', versionSequence: 2 },
    ];

    it('should sort ascending by default', () => {
      const result = sortByVersionSequence(entities);
      expect(result.map(e => e.id)).toEqual(['a', 'b', 'c']);
    });

    it('should sort descending when specified', () => {
      const result = sortByVersionSequence(entities, true);
      expect(result.map(e => e.id)).toEqual(['c', 'b', 'a']);
    });

    it('should handle entities without versionSequence', () => {
      const entitiesWithMissing = [
        { id: 'a' },
        { id: 'b', versionSequence: 2 },
      ];

      const result = sortByVersionSequence(entitiesWithMissing);
      expect(result[0].id).toBe('a'); // defaults to 1
      expect(result[1].id).toBe('b'); // explicit 2
    });
  });

  describe('getTemporalSummary', () => {
    it('should summarize temporal fields correctly', () => {
      const entities = [
        { temporalStatus: 'current', validFrom: '2025-01-01', versionSequence: 1 },
        { temporalStatus: 'current', validFrom: '2025-01-01', validTo: '2025-12-31', versionSequence: 2 },
        { temporalStatus: 'superseded', validFrom: '2024-01-01', supersededBy: 'x', versionSequence: 1 },
        { temporalStatus: 'expired', validFrom: '2023-01-01', validTo: '2023-12-31', versionSequence: 3 },
      ];

      const summary = getTemporalSummary(entities);

      expect(summary.total).toBe(4);
      expect(summary.byStatus.current).toBe(2);
      expect(summary.byStatus.superseded).toBe(1);
      expect(summary.byStatus.expired).toBe(1);
      expect(summary.withValidFrom).toBe(4);
      expect(summary.withValidTo).toBe(2);
      expect(summary.withSupersededBy).toBe(1);
      expect(summary.maxVersionSequence).toBe(3);
    });

    it('should handle empty array', () => {
      const summary = getTemporalSummary([]);
      expect(summary.total).toBe(0);
      expect(summary.averageVersionSequence).toBe(0);
    });
  });

  describe('TemporalService class', () => {
    it('should be a singleton', () => {
      const service1 = getTemporalService();
      const service2 = getTemporalService();
      expect(service1).toBe(service2);
    });

    it('should expose constants', () => {
      const service = getTemporalService();
      expect(service.TEMPORAL_STATUS).toBe(TEMPORAL_STATUS);
      expect(service.TEMPORAL_FIELDS).toBe(TEMPORAL_FIELDS);
    });

    it('should provide all service methods', () => {
      const service = getTemporalService();
      expect(typeof service.validate).toBe('function');
      expect(typeof service.computeStatus).toBe('function');
      expect(typeof service.isValidAt).toBe('function');
      expect(typeof service.getDateRange).toBe('function');
      expect(typeof service.createDefaults).toBe('function');
      expect(typeof service.prepareVersion).toBe('function');
      expect(typeof service.validateChain).toBe('function');
      expect(typeof service.filterByStatus).toBe('function');
      expect(typeof service.filterValidAt).toBe('function');
      expect(typeof service.sortByVersion).toBe('function');
      expect(typeof service.getSummary).toBe('function');
    });
  });
});
