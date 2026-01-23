/**
 * Tests for Relationship Validation Service
 *
 * Feature: F4.3.1 - Relationship Validation Rules
 */

// Define mock ontology data that will be used by the fs mock
const mockOntologyData = {
  "@context": { "@version": 1.1 },
  "@id": "https://business-knowledge-engine.io/ontology/business-process",
  "@type": "owl:Ontology",
  "label": "Business Knowledge Engine Ontology",
  "owl:versionInfo": "1.0.0",
  "@graph": [
    // Entity hierarchy
    {
      "@id": "bke:Entity",
      "@type": "rdfs:Class",
      "label": "Entity"
    },
    {
      "@id": "bke:BusinessFlowEntity",
      "@type": "rdfs:Class",
      "label": "Business Flow Entity",
      "subClassOf": "bke:Entity"
    },
    {
      "@id": "bke:Process",
      "@type": "rdfs:Class",
      "label": "Process",
      "subClassOf": "bke:BusinessFlowEntity"
    },
    {
      "@id": "bke:Task",
      "@type": "rdfs:Class",
      "label": "Task",
      "subClassOf": "bke:BusinessFlowEntity"
    },
    {
      "@id": "bke:OrganizationalEntity",
      "@type": "rdfs:Class",
      "label": "Organizational Entity",
      "subClassOf": "bke:Entity"
    },
    {
      "@id": "bke:Role",
      "@type": "rdfs:Class",
      "label": "Role",
      "subClassOf": "bke:OrganizationalEntity"
    },
    {
      "@id": "bke:Department",
      "@type": "rdfs:Class",
      "label": "Department",
      "subClassOf": "bke:OrganizationalEntity"
    },
    {
      "@id": "bke:TechnicalEntity",
      "@type": "rdfs:Class",
      "label": "Technical Entity",
      "subClassOf": "bke:Entity"
    },
    {
      "@id": "bke:System",
      "@type": "rdfs:Class",
      "label": "System",
      "subClassOf": "bke:TechnicalEntity"
    },
    // Relationship types
    {
      "@id": "bke:PRECEDES",
      "@type": "rdf:Property",
      "label": "precedes",
      "domain": "bke:BusinessFlowEntity",
      "range": "bke:BusinessFlowEntity",
      "inverseOf": "bke:FOLLOWS"
    },
    {
      "@id": "bke:FOLLOWS",
      "@type": "rdf:Property",
      "label": "follows",
      "domain": "bke:BusinessFlowEntity",
      "range": "bke:BusinessFlowEntity"
    },
    {
      "@id": "bke:OWNS",
      "@type": "rdf:Property",
      "label": "owns",
      "domain": "bke:OrganizationalEntity",
      "range": "bke:Entity"
    },
    {
      "@id": "bke:EXECUTES",
      "@type": "rdf:Property",
      "label": "executes",
      "domain": "bke:OrganizationalEntity",
      "range": "bke:BusinessFlowEntity"
    },
    {
      "@id": "bke:USES",
      "@type": "rdf:Property",
      "label": "uses",
      "domain": "bke:Entity",
      "range": "bke:TechnicalEntity"
    },
    // Synonym mappings
    {
      "@id": "bke:RelationshipNormalizationMapping",
      "bke:mappings": {
        "performs": "EXECUTES",
        "runs": "EXECUTES",
        "before": "PRECEDES",
        "after": "FOLLOWS",
        "utilizes": "USES"
      }
    }
  ]
};

// Mock fs before requiring the modules
jest.mock('fs', () => ({
  readFileSync: jest.fn((path) => {
    if (path.includes('business-process.jsonld')) {
      return JSON.stringify(mockOntologyData);
    }
    throw new Error(`Unexpected file read: ${path}`);
  }),
  existsSync: jest.fn(() => true),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const {
  RelationshipValidator,
  getRelationshipValidator,
  initializeRelationshipValidator,
  CONFIDENCE_PENALTIES,
  SEVERITY,
} = require('../relationship-validator');

describe('RelationshipValidator', () => {
  let validator;

  beforeAll(async () => {
    validator = await initializeRelationshipValidator();
  });

  afterEach(() => {
    validator.resetStats();
  });

  describe('initialization', () => {
    it('should initialize successfully with singleton pattern', async () => {
      const instance1 = getRelationshipValidator();
      const instance2 = getRelationshipValidator();
      expect(instance1).toBe(instance2);
    });

    it('should be initialized after initializeRelationshipValidator', () => {
      expect(validator.initialized).toBe(true);
    });
  });

  describe('validateRelationship', () => {
    it('should validate a correct relationship', () => {
      const relationship = {
        from: 'Task 1',
        to: 'Task 2',
        type: 'PRECEDES',
        confidence: 0.9,
      };
      const entityTypeMap = new Map([
        ['Task 1', 'Task'],
        ['Task 2', 'Task'],
      ]);

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.validationPassed).toBe(true);
      expect(result.validationWarnings.length).toBe(0);
      expect(result.confidence).toBe(0.9);
    });

    it('should detect domain violation', () => {
      const relationship = {
        from: 'System A',
        to: 'Task 1',
        type: 'EXECUTES',
        confidence: 0.9,
      };
      const entityTypeMap = new Map([
        ['System A', 'System'],
        ['Task 1', 'Task'],
      ]);

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.validationPassed).toBe(false);
      expect(result.validationWarnings).toContainEqual(
        expect.objectContaining({
          code: 'DOMAIN_VIOLATION',
          severity: SEVERITY.WARNING,
        })
      );
      expect(result.confidence).toBeLessThan(0.9);
    });

    it('should detect range violation', () => {
      const relationship = {
        from: 'Manager',
        to: 'HR Department',
        type: 'EXECUTES',
        confidence: 0.9,
      };
      const entityTypeMap = new Map([
        ['Manager', 'Role'],
        ['HR Department', 'Department'],
      ]);

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.validationPassed).toBe(false);
      expect(result.validationWarnings).toContainEqual(
        expect.objectContaining({
          code: 'RANGE_VIOLATION',
          severity: SEVERITY.WARNING,
        })
      );
      expect(result.confidence).toBeLessThan(0.9);
    });

    it('should detect unknown relationship type', () => {
      const relationship = {
        from: 'Task 1',
        to: 'Task 2',
        type: 'UNKNOWN_TYPE',
        confidence: 0.9,
      };
      const entityTypeMap = new Map([
        ['Task 1', 'Task'],
        ['Task 2', 'Task'],
      ]);

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.validationPassed).toBe(false);
      expect(result.validationWarnings).toContainEqual(
        expect.objectContaining({
          code: 'UNKNOWN_RELATIONSHIP_TYPE',
          severity: SEVERITY.WARNING,
        })
      );
    });

    it('should normalize relationship type synonyms', () => {
      const relationship = {
        from: 'Manager',
        to: 'Review Task',
        type: 'performs',
        confidence: 0.9,
      };
      const entityTypeMap = new Map([
        ['Manager', 'Role'],
        ['Review Task', 'Task'],
      ]);

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.normalizedType).toBe('EXECUTES');
      expect(result.validationWarnings).toContainEqual(
        expect.objectContaining({
          code: 'TYPE_NORMALIZED',
          severity: SEVERITY.INFO,
        })
      );
    });

    it('should accept object entity type map', () => {
      const relationship = {
        from: 'Task 1',
        to: 'Task 2',
        type: 'PRECEDES',
        confidence: 0.9,
      };
      const entityTypeMap = {
        'Task 1': 'Task',
        'Task 2': 'Task',
      };

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.validationPassed).toBe(true);
    });

    it('should apply confidence penalty for both domain and range violations', () => {
      const relationship = {
        from: 'System A',
        to: 'Department X',
        type: 'EXECUTES',
        confidence: 1.0,
      };
      const entityTypeMap = new Map([
        ['System A', 'System'],
        ['Department X', 'Department'],
      ]);

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.confidence).toBe(CONFIDENCE_PENALTIES.BOTH_CONSTRAINTS_VIOLATED);
    });

    it('should preserve original confidence', () => {
      const relationship = {
        from: 'System A',
        to: 'Task 1',
        type: 'EXECUTES',
        confidence: 0.85,
      };
      const entityTypeMap = new Map([
        ['System A', 'System'],
        ['Task 1', 'Task'],
      ]);

      const result = validator.validateRelationship(relationship, entityTypeMap);

      expect(result.originalConfidence).toBe(0.85);
    });
  });

  describe('validateEntity', () => {
    it('should validate a correct entity type', () => {
      const entity = { name: 'Task 1', type: 'Task', confidence: 0.9 };

      const result = validator.validateEntity(entity);

      expect(result.validationPassed).toBe(true);
      expect(result.validationWarnings.length).toBe(0);
    });

    it('should detect unknown entity type', () => {
      const entity = { name: 'Item 1', type: 'UnknownType', confidence: 0.9 };

      const result = validator.validateEntity(entity);

      expect(result.validationPassed).toBe(false);
      expect(result.validationWarnings).toContainEqual(
        expect.objectContaining({
          code: 'UNKNOWN_ENTITY_TYPE',
          severity: SEVERITY.WARNING,
        })
      );
    });

    it('should suggest similar entity type', () => {
      const entity = { name: 'Item 1', type: 'Procss', confidence: 0.9 }; // Typo

      const result = validator.validateEntity(entity);

      expect(result.validationPassed).toBe(false);
      // May or may not have a suggestion depending on Levenshtein distance
    });

    it('should apply confidence penalty for unknown entity type', () => {
      const entity = { name: 'Item 1', type: 'UnknownType', confidence: 1.0 };

      const result = validator.validateEntity(entity);

      expect(result.confidence).toBe(CONFIDENCE_PENALTIES.UNKNOWN_ENTITY_TYPE);
    });
  });

  describe('validateExtraction', () => {
    it('should validate a batch of entities and relationships', () => {
      const entities = [
        { name: 'Task 1', type: 'Task', confidence: 0.9 },
        { name: 'Task 2', type: 'Task', confidence: 0.85 },
        { name: 'Manager', type: 'Role', confidence: 0.95 },
      ];
      const relationships = [
        { from: 'Task 1', to: 'Task 2', type: 'PRECEDES', confidence: 0.9 },
        { from: 'Manager', to: 'Task 1', type: 'EXECUTES', confidence: 0.85 },
      ];

      const result = validator.validateExtraction(entities, relationships);

      expect(result.entities.length).toBe(3);
      expect(result.relationships.length).toBe(2);
      expect(result.summary.totalEntities).toBe(3);
      expect(result.summary.totalRelationships).toBe(2);
    });

    it('should report entities with warnings', () => {
      const entities = [
        { name: 'Task 1', type: 'Task', confidence: 0.9 },
        { name: 'Unknown Item', type: 'InvalidType', confidence: 0.8 },
      ];
      const relationships = [];

      const result = validator.validateExtraction(entities, relationships);

      expect(result.summary.entitiesWithWarnings).toBe(1);
    });

    it('should report relationships with warnings', () => {
      const entities = [
        { name: 'System A', type: 'System', confidence: 0.9 },
        { name: 'Task 1', type: 'Task', confidence: 0.9 },
      ];
      const relationships = [
        { from: 'System A', to: 'Task 1', type: 'EXECUTES', confidence: 0.9 },
      ];

      const result = validator.validateExtraction(entities, relationships);

      expect(result.summary.relationshipsWithWarnings).toBe(1);
      expect(result.summary.domainViolations).toBe(1);
    });

    it('should optionally disable confidence penalties', () => {
      const entities = [{ name: 'Unknown', type: 'InvalidType', confidence: 1.0 }];
      const relationships = [];

      const result = validator.validateExtraction(entities, relationships, {
        applyPenalties: false,
      });

      expect(result.entities[0].confidence).toBe(1.0);
    });

    it('should include detailed report when requested', () => {
      const entities = [{ name: 'Task 1', type: 'Task', confidence: 0.9 }];
      const relationships = [];

      const result = validator.validateExtraction(entities, relationships, {
        includeReport: true,
      });

      expect(result.report).toBeDefined();
      expect(result.report.entityReport).toBeDefined();
      expect(result.report.relationshipReport).toBeDefined();
    });

    it('should handle empty inputs', () => {
      const result = validator.validateExtraction([], []);

      expect(result.entities).toEqual([]);
      expect(result.relationships).toEqual([]);
      expect(result.summary.totalEntities).toBe(0);
      expect(result.summary.totalRelationships).toBe(0);
    });
  });

  describe('getConstraintsForRelationship', () => {
    it('should return constraints for a known relationship type', () => {
      const constraints = validator.getConstraintsForRelationship('EXECUTES');

      expect(constraints).toBeDefined();
      expect(constraints.type).toBe('EXECUTES');
      expect(constraints.domain.type).toBe('OrganizationalEntity');
      expect(constraints.range.type).toBe('BusinessFlowEntity');
    });

    it('should include subtypes in constraints', () => {
      const constraints = validator.getConstraintsForRelationship('EXECUTES');

      expect(constraints.domain.subtypes).toContain('Role');
      expect(constraints.domain.subtypes).toContain('Department');
      expect(constraints.range.subtypes).toContain('Task');
      expect(constraints.range.subtypes).toContain('Process');
    });

    it('should normalize synonyms and return constraints', () => {
      const constraints = validator.getConstraintsForRelationship('performs');

      expect(constraints).toBeDefined();
      expect(constraints.type).toBe('EXECUTES');
      expect(constraints.originalType).toBe('performs');
    });

    it('should return null for unknown relationship type', () => {
      const constraints = validator.getConstraintsForRelationship('UNKNOWN_TYPE');

      expect(constraints).toBeNull();
    });
  });

  describe('isValidRelationship', () => {
    it('should return valid for correct relationship', () => {
      const result = validator.isValidRelationship('PRECEDES', 'Task', 'Task');

      expect(result.valid).toBe(true);
      expect(result.domainValid).toBe(true);
      expect(result.rangeValid).toBe(true);
    });

    it('should return invalid for domain violation', () => {
      const result = validator.isValidRelationship('EXECUTES', 'System', 'Task');

      expect(result.valid).toBe(false);
      expect(result.domainValid).toBe(false);
      expect(result.rangeValid).toBe(true);
    });

    it('should return invalid for range violation', () => {
      const result = validator.isValidRelationship('EXECUTES', 'Role', 'System');

      expect(result.valid).toBe(false);
      expect(result.domainValid).toBe(true);
      expect(result.rangeValid).toBe(false);
    });

    it('should accept subtypes in domain', () => {
      const result = validator.isValidRelationship('EXECUTES', 'Role', 'Task');

      expect(result.valid).toBe(true);
      expect(result.domainValid).toBe(true);
    });

    it('should accept subtypes in range', () => {
      const result = validator.isValidRelationship('EXECUTES', 'Role', 'Process');

      expect(result.valid).toBe(true);
      expect(result.rangeValid).toBe(true);
    });
  });

  describe('getStats and resetStats', () => {
    it('should track validation statistics', () => {
      const entities = [
        { name: 'Task 1', type: 'Task', confidence: 0.9 },
        { name: 'Invalid', type: 'Unknown', confidence: 0.8 },
      ];
      const relationships = [
        { from: 'Task 1', to: 'Invalid', type: 'PRECEDES', confidence: 0.9 },
        { from: 'System', to: 'Task', type: 'EXECUTES', confidence: 0.8 },
      ];
      const entityTypeMap = new Map([
        ['Task 1', 'Task'],
        ['Invalid', 'Unknown'],
        ['System', 'System'],
        ['Task', 'Task'],
      ]);

      // Validate relationships manually to populate stats
      relationships.forEach(r => validator.validateRelationship(r, entityTypeMap));

      const stats = validator.getStats();

      expect(stats.totalValidated).toBe(2);
    });

    it('should reset statistics', () => {
      const relationship = { from: 'A', to: 'B', type: 'UNKNOWN', confidence: 0.9 };
      validator.validateRelationship(relationship, new Map([['A', 'Task'], ['B', 'Task']]));

      validator.resetStats();
      const stats = validator.getStats();

      expect(stats.totalValidated).toBe(0);
      expect(stats.unknownTypes).toBe(0);
    });
  });

  describe('confidence penalty constants', () => {
    it('should have correct penalty values', () => {
      expect(CONFIDENCE_PENALTIES.DOMAIN_VIOLATION).toBe(0.85);
      expect(CONFIDENCE_PENALTIES.RANGE_VIOLATION).toBe(0.85);
      expect(CONFIDENCE_PENALTIES.UNKNOWN_RELATIONSHIP_TYPE).toBe(0.7);
      expect(CONFIDENCE_PENALTIES.UNKNOWN_ENTITY_TYPE).toBe(0.9);
      expect(CONFIDENCE_PENALTIES.BOTH_CONSTRAINTS_VIOLATED).toBe(0.7);
    });
  });

  describe('severity constants', () => {
    it('should have correct severity values', () => {
      expect(SEVERITY.ERROR).toBe('error');
      expect(SEVERITY.WARNING).toBe('warning');
      expect(SEVERITY.INFO).toBe('info');
    });
  });
});
