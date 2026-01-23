/**
 * Unit tests for Type Deprecation Support (F2.2.3)
 *
 * Tests the deprecation functionality in OntologyService including:
 * - Deprecation detection and info retrieval
 * - Replacement type mapping
 * - Migration path calculation
 * - Validation with deprecation warnings
 * - Runtime deprecation/undeprecation
 */

const { OntologyService, getOntologyService, initializeOntologyService } = require('../ontology-service');

describe('Type Deprecation Support (F2.2.3)', () => {
  let service;

  beforeAll(async () => {
    service = await initializeOntologyService();
  });

  describe('Deprecation Detection', () => {
    test('isTypeDeprecated returns false for non-deprecated types', () => {
      expect(service.isTypeDeprecated('Process')).toBe(false);
      expect(service.isTypeDeprecated('Task')).toBe(false);
      expect(service.isTypeDeprecated('Role')).toBe(false);
    });

    test('isTypeDeprecated returns false for null/undefined', () => {
      expect(service.isTypeDeprecated(null)).toBe(false);
      expect(service.isTypeDeprecated(undefined)).toBe(false);
      expect(service.isTypeDeprecated('')).toBe(false);
    });

    test('getDeprecationInfo returns null for non-deprecated types', () => {
      expect(service.getDeprecationInfo('Process')).toBeNull();
      expect(service.getDeprecationInfo('Task')).toBeNull();
    });
  });

  describe('Runtime Deprecation', () => {
    const testType = 'Process';

    afterEach(() => {
      // Clean up - undeprecate the test type
      service.undeprecateType(testType);
    });

    test('deprecateType marks a type as deprecated', () => {
      const result = service.deprecateType(testType, {
        replacedBy: 'Task',
        reason: 'Test deprecation'
      });

      expect(result.success).toBe(true);
      expect(service.isTypeDeprecated(testType)).toBe(true);
    });

    test('deprecateType stores all deprecation info', () => {
      service.deprecateType(testType, {
        replacedBy: 'Task',
        reason: 'Process is too generic',
        removalVersion: '2.0.0',
        migrationGuide: 'Use Task for specific work items'
      });

      const info = service.getDeprecationInfo(testType);
      expect(info.deprecated).toBe(true);
      expect(info.replacedBy).toBe('Task');
      expect(info.reason).toBe('Process is too generic');
      expect(info.removalVersion).toBe('2.0.0');
      expect(info.migrationGuide).toBe('Use Task for specific work items');
    });

    test('deprecateType fails for non-existent types', () => {
      const result = service.deprecateType('NonExistentType', {
        replacedBy: 'Task'
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not defined in the ontology');
    });

    test('deprecateType fails for non-existent replacement type', () => {
      const result = service.deprecateType(testType, {
        replacedBy: 'NonExistentReplacement'
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Replacement type');
    });

    test('deprecateType without replacement succeeds', () => {
      const result = service.deprecateType(testType, {
        reason: 'To be removed without replacement'
      });

      expect(result.success).toBe(true);
      expect(service.getReplacementType(testType)).toBeNull();
    });

    test('undeprecateType removes deprecation', () => {
      service.deprecateType(testType, { reason: 'Test' });
      expect(service.isTypeDeprecated(testType)).toBe(true);

      const result = service.undeprecateType(testType);
      expect(result.success).toBe(true);
      expect(service.isTypeDeprecated(testType)).toBe(false);
    });

    test('undeprecateType fails for non-deprecated types', () => {
      const result = service.undeprecateType('Role');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not deprecated');
    });
  });

  describe('Replacement Type', () => {
    afterEach(() => {
      service.undeprecateType('Process');
    });

    test('getReplacementType returns the replacement', () => {
      service.deprecateType('Process', { replacedBy: 'Task' });
      expect(service.getReplacementType('Process')).toBe('Task');
    });

    test('getReplacementType returns null for no replacement', () => {
      service.deprecateType('Process', { reason: 'No replacement' });
      expect(service.getReplacementType('Process')).toBeNull();
    });

    test('getReplacementType returns null for non-deprecated types', () => {
      expect(service.getReplacementType('Role')).toBeNull();
    });
  });

  describe('Deprecation Warning', () => {
    afterEach(() => {
      service.undeprecateType('Process');
    });

    test('getDeprecationWarning returns descriptive message', () => {
      service.deprecateType('Process', {
        replacedBy: 'Task',
        reason: 'Too generic',
        removalVersion: '2.0.0'
      });

      const warning = service.getDeprecationWarning('Process');
      expect(warning).toContain('Process');
      expect(warning).toContain('deprecated');
      expect(warning).toContain('Task');
      expect(warning).toContain('Too generic');
      expect(warning).toContain('2.0.0');
    });

    test('getDeprecationWarning returns null for non-deprecated', () => {
      expect(service.getDeprecationWarning('Role')).toBeNull();
    });
  });

  describe('Get All Deprecated Types', () => {
    beforeEach(() => {
      service.deprecateType('Process', { replacedBy: 'Task', reason: 'Test 1' });
      service.deprecateType('Department', { reason: 'Test 2' });
    });

    afterEach(() => {
      service.undeprecateType('Process');
      service.undeprecateType('Department');
    });

    test('getDeprecatedTypes returns all deprecated types', () => {
      const types = service.getDeprecatedTypes();
      expect(types.length).toBeGreaterThanOrEqual(2);

      const typeNames = types.map(t => t.type);
      expect(typeNames).toContain('Process');
      expect(typeNames).toContain('Department');
    });

    test('getDeprecatedTypes filters by category', () => {
      const entityTypes = service.getDeprecatedTypes({ category: 'entity' });
      const processEntry = entityTypes.find(t => t.type === 'Process');
      expect(processEntry).toBeDefined();
      expect(processEntry.category).toBe('entity');
    });

    test('getDeprecatedTypes filters by withReplacement', () => {
      const withReplacement = service.getDeprecatedTypes({ withReplacement: true });
      const typeNames = withReplacement.map(t => t.type);

      expect(typeNames).toContain('Process'); // has replacement
      expect(typeNames).not.toContain('Department'); // no replacement
    });
  });

  describe('Migration Path', () => {
    afterEach(() => {
      service.undeprecateType('Process');
      service.undeprecateType('Task');
      service.undeprecateType('Activity');
    });

    test('getMigrationPath returns simple path', () => {
      service.deprecateType('Process', { replacedBy: 'Task' });

      const path = service.getMigrationPath('Process');
      expect(path.path).toEqual(['Process', 'Task']);
      expect(path.currentType).toBe('Task');
      expect(path.isDeprecationChain).toBe(false);
    });

    test('getMigrationPath follows deprecation chain', () => {
      service.deprecateType('Process', { replacedBy: 'Task' });
      service.deprecateType('Task', { replacedBy: 'Activity' });

      const path = service.getMigrationPath('Process');
      expect(path.path).toEqual(['Process', 'Task', 'Activity']);
      expect(path.currentType).toBe('Activity');
      expect(path.isDeprecationChain).toBe(true);
    });

    test('getMigrationPath handles no replacement', () => {
      service.deprecateType('Process', { reason: 'No replacement' });

      const path = service.getMigrationPath('Process');
      expect(path.path).toEqual(['Process']);
      expect(path.currentType).toBe('Process');
    });

    test('getMigrationPath handles non-deprecated types', () => {
      const path = service.getMigrationPath('Role');
      expect(path.path).toEqual(['Role']);
      expect(path.currentType).toBe('Role');
    });

    test('getMigrationPath collects migration guides', () => {
      service.deprecateType('Process', {
        replacedBy: 'Task',
        migrationGuide: 'Convert Process entities to Task'
      });
      service.deprecateType('Task', {
        replacedBy: 'Activity',
        migrationGuide: 'Rename Task to Activity'
      });

      const path = service.getMigrationPath('Process');
      expect(path.migrationGuides).toHaveLength(2);
      expect(path.migrationGuides[0].from).toBe('Process');
      expect(path.migrationGuides[0].to).toBe('Task');
    });
  });

  describe('Validation with Deprecation', () => {
    afterEach(() => {
      service.undeprecateType('Process');
    });

    test('validateEntityType includes deprecation warning', () => {
      service.deprecateType('Process', {
        replacedBy: 'Task',
        reason: 'Too generic'
      });

      const result = service.validateEntityType('Process');
      expect(result.valid).toBe(true);
      expect(result.deprecated).toBe(true);
      expect(result.deprecationWarning).toContain('Process');
      expect(result.deprecationWarning).toContain('deprecated');
      expect(result.replacement).toBe('Task');
    });

    test('validateEntityType can suppress deprecation warning', () => {
      service.deprecateType('Process', { replacedBy: 'Task' });

      const result = service.validateEntityType('Process', { warnOnDeprecated: false });
      expect(result.valid).toBe(true);
      expect(result.deprecated).toBeUndefined();
    });

    test('validateRelationship warns on deprecated types', () => {
      service.deprecateType('Process', { replacedBy: 'Task' });

      const result = service.validateRelationship('CONTAINS', 'Process', 'Task');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('Process') && w.includes('deprecated'))).toBe(true);
    });
  });

  describe('Validation Report with Deprecation', () => {
    beforeEach(() => {
      service.deprecateType('Process', { replacedBy: 'Task' });
    });

    afterEach(() => {
      service.undeprecateType('Process');
    });

    test('generateValidationReport includes deprecation report', () => {
      const entities = [
        { name: 'Test Process', type: 'Process' },
        { name: 'Test Role', type: 'Role' }
      ];
      const relationships = [];

      const report = service.generateValidationReport(entities, relationships);

      expect(report.deprecationReport).toBeDefined();
      expect(report.deprecationReport.entityTypes.length).toBeGreaterThan(0);
      expect(report.summary.deprecatedEntityTypes).toBeGreaterThan(0);
    });

    test('validation report tracks deprecation warnings', () => {
      const entities = [
        { name: 'Process 1', type: 'Process' },
        { name: 'Process 2', type: 'Process' }
      ];

      const report = service.generateValidationReport(entities, []);

      // Both entities use deprecated type
      expect(report.deprecationReport.warnings.length).toBe(2);
      // But only one unique deprecated type
      expect(report.deprecationReport.entityTypes.length).toBe(1);
    });
  });

  describe('Deprecation Validation', () => {
    afterEach(() => {
      service.undeprecateType('Process');
      service.undeprecateType('Task');
    });

    test('validateDeprecations returns valid for no issues', () => {
      service.deprecateType('Process', {
        replacedBy: 'Task',
        reason: 'Test reason'
      });

      const result = service.validateDeprecations();
      expect(result.valid).toBe(true);
    });

    test('validateDeprecations warns about missing replacement type', () => {
      // Manually add invalid deprecation (bypassing validation)
      service.deprecatedTypes.set('TestType', {
        deprecated: true,
        replacedBy: 'NonExistent',
        reason: 'Test'
      });

      const result = service.validateDeprecations();
      expect(result.valid).toBe(false);
      expect(result.issues.some(i => i.issue.includes('does not exist'))).toBe(true);

      // Clean up
      service.deprecatedTypes.delete('TestType');
    });

    test('validateDeprecations warns about missing reason', () => {
      service.deprecateType('Process', { replacedBy: 'Task' }); // No reason

      const result = service.validateDeprecations();
      const warningIssues = result.issues.filter(i => i.severity === 'warning');
      expect(warningIssues.some(i => i.issue.includes('Missing deprecation reason'))).toBe(true);
    });

    test('validateDeprecations reports total deprecated count', () => {
      service.deprecateType('Process', { reason: 'Test 1' });
      service.deprecateType('Task', { reason: 'Test 2' });

      const result = service.validateDeprecations();
      expect(result.totalDeprecated).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Edge Cases', () => {
    afterEach(() => {
      service.undeprecateType('Process');
      service.undeprecateType('MANAGES');
    });

    test('can deprecate relationship types', () => {
      const result = service.deprecateType('MANAGES', {
        replacedBy: 'OWNS',
        reason: 'MANAGES is being replaced by OWNS'
      });

      expect(result.success).toBe(true);
      expect(service.isTypeDeprecated('MANAGES')).toBe(true);
    });

    test('deprecation with date sets correct date format', () => {
      service.deprecateType('Process', { reason: 'Test' });
      const info = service.getDeprecationInfo('Process');

      // Should be ISO date format YYYY-MM-DD
      expect(info.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('handles empty type name gracefully', () => {
      const deprecateResult = service.deprecateType('', { reason: 'Test' });
      expect(deprecateResult.success).toBe(false);

      const undeprecateResult = service.undeprecateType('');
      expect(undeprecateResult.success).toBe(false);
    });
  });
});

describe('OntologyService Initialization with Deprecations', () => {
  test('service initializes and loads deprecations', async () => {
    const service = new OntologyService();
    await service.initialize();

    expect(service.initialized).toBe(true);
    expect(service.deprecatedTypes).toBeDefined();
    expect(service.deprecatedTypes instanceof Map).toBe(true);
  });
});
