/**
 * Tests for Ontology Validation Service
 *
 * Feature: F2.1.4 - Ontology Validation Service
 */

// Define mock ontology data that will be used by the fs mock
const mockOntologyData = {
  "@context": { "@version": 1.1 },
  "@id": "https://business-knowledge-engine.io/ontology/business-process",
  "@type": "owl:Ontology",
  "label": "Business Knowledge Engine Ontology",
  "owl:versionInfo": "1.2.3",
  "owl:versionIRI": "https://business-knowledge-engine.io/ontology/business-process/1.2.3",
  "owl:priorVersion": "https://business-knowledge-engine.io/ontology/business-process/1.2.2",
  "owl:backwardCompatibleWith": "https://business-knowledge-engine.io/ontology/business-process/1.0.0",
  "owl:incompatibleWith": null,
  "schema:version": "1.2.3",
  "schema:dateCreated": "2026-01-01",
  "schema:dateModified": "2026-01-22",
  "schema:author": { "@type": "schema:Organization", "schema:name": "Test Team" },
  "pav:version": "1.2.3",
  "pav:previousVersion": "1.2.2",
  "pav:createdOn": "2026-01-01",
  "pav:lastUpdateOn": "2026-01-22",
  "bke:versionMetadata": {
    "@type": "bke:VersionInfo",
    "bke:major": 1,
    "bke:minor": 2,
    "bke:patch": 3,
    "bke:preRelease": null,
    "bke:buildMetadata": null,
    "bke:releaseNotes": "Test release notes",
    "bke:breakingChanges": false,
    "bke:deprecations": ["OldType"]
  },
  "bke:versionHistory": [
    {
      "@type": "bke:VersionRecord",
      "bke:version": "1.0.0",
      "bke:versionIRI": "https://business-knowledge-engine.io/ontology/business-process/1.0.0",
      "bke:releaseDate": "2026-01-01",
      "bke:description": "Initial release",
      "bke:changes": ["Initial entity types", "Initial relationship types"],
      "bke:addedTypes": ["Process", "Task"],
      "bke:removedTypes": [],
      "bke:deprecatedTypes": [],
      "bke:modifiedTypes": []
    },
    {
      "@type": "bke:VersionRecord",
      "bke:version": "1.2.3",
      "bke:versionIRI": "https://business-knowledge-engine.io/ontology/business-process/1.2.3",
      "bke:releaseDate": "2026-01-22",
      "bke:description": "Added Role type",
      "bke:changes": ["Added Role type"],
      "bke:addedTypes": ["Role"],
      "bke:removedTypes": [],
      "bke:deprecatedTypes": [],
      "bke:modifiedTypes": []
    }
  ],
  "@graph": [
    {
      "@id": "bke:Entity",
      "@type": "rdfs:Class",
      "label": "Entity",
      "comment": "Base class for all knowledge graph entities"
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
      "comment": "Major organizational processes",
      "subClassOf": "bke:BusinessFlowEntity"
    },
    {
      "@id": "bke:Task",
      "@type": "rdfs:Class",
      "label": "Task",
      "comment": "Individual tasks within a process",
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
      "comment": "Job roles or positions",
      "subClassOf": "bke:OrganizationalEntity"
    },
    {
      "@id": "bke:Department",
      "@type": "rdfs:Class",
      "label": "Department",
      "comment": "Organizational units",
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
      "comment": "Software or business systems",
      "subClassOf": "bke:TechnicalEntity"
    },
    {
      "@id": "bke:PRECEDES",
      "@type": "rdf:Property",
      "label": "precedes",
      "comment": "Temporal ordering",
      "domain": "bke:BusinessFlowEntity",
      "range": "bke:BusinessFlowEntity",
      "inverseOf": "bke:FOLLOWS"
    },
    {
      "@id": "bke:FOLLOWS",
      "@type": "rdf:Property",
      "label": "follows",
      "domain": "bke:BusinessFlowEntity",
      "range": "bke:BusinessFlowEntity",
      "inverseOf": "bke:PRECEDES"
    },
    {
      "@id": "bke:OWNS",
      "@type": "rdf:Property",
      "label": "owns",
      "comment": "Ownership or responsibility",
      "domain": "bke:OrganizationalEntity",
      "range": "bke:Entity"
    },
    {
      "@id": "bke:EXECUTES",
      "@type": "rdf:Property",
      "label": "executes",
      "comment": "Performs a task or activity",
      "domain": "bke:OrganizationalEntity",
      "range": "bke:BusinessFlowEntity"
    },
    {
      "@id": "bke:USES",
      "@type": "rdf:Property",
      "label": "uses",
      "comment": "Consumption or utilization",
      "domain": "bke:Entity",
      "range": "bke:TechnicalEntity"
    },
    {
      "@id": "bke:INTEGRATES_WITH",
      "@type": "rdf:Property",
      "label": "integrates with",
      "domain": "bke:TechnicalEntity",
      "range": "bke:TechnicalEntity"
    },
    {
      "@id": "bke:DEPENDS_ON",
      "@type": "rdf:Property",
      "label": "depends on",
      "domain": "bke:Entity",
      "range": "bke:Entity"
    },
    {
      "@id": "bke:RelationshipNormalizationMapping",
      "@type": "rdfs:Class",
      "bke:mappings": {
        "manages": "MANAGES",
        "supervises": "MANAGES",
        "uses": "USES",
        "utilizes": "USES",
        "executes": "EXECUTES",
        "performs": "EXECUTES",
        "precedes": "PRECEDES",
        "before": "PRECEDES",
        "follows": "FOLLOWS",
        "after": "FOLLOWS"
      }
    }
  ]
};

const mockOntologyString = JSON.stringify(mockOntologyData);

describe('OntologyService', () => {
  let OntologyService, getOntologyService, initializeOntologyService;

  beforeEach(() => {
    jest.resetModules();

    // Setup the mock before requiring the module
    jest.doMock('fs', () => {
      const actualFs = jest.requireActual('fs');
      return {
        ...actualFs,
        readFileSync: jest.fn((filePath) => {
          if (filePath.includes('business-process.jsonld')) {
            return mockOntologyString;
          }
          return actualFs.readFileSync(filePath);
        }),
      };
    });

    // Import fresh module after mock is set up
    const ontologyModule = require('../ontology-service');
    OntologyService = ontologyModule.OntologyService;
    getOntologyService = ontologyModule.getOntologyService;
    initializeOntologyService = ontologyModule.initializeOntologyService;
  });

  describe('initialization', () => {
    it('should initialize successfully with valid ontology', async () => {
      const service = new OntologyService();
      await service.initialize();

      expect(service.initialized).toBe(true);
    });

    it('should load entity types from ontology', async () => {
      const service = new OntologyService();
      await service.initialize();

      const entityTypes = service.getValidEntityTypes();
      const typeNames = entityTypes.map(t => t.name);

      expect(typeNames).toContain('Process');
      expect(typeNames).toContain('Task');
      expect(typeNames).toContain('Role');
      expect(typeNames).toContain('System');
    });

    it('should load relationship types from ontology', async () => {
      const service = new OntologyService();
      await service.initialize();

      const relationshipTypes = service.getValidRelationshipTypes();
      const typeNames = relationshipTypes.map(t => t.name);

      expect(typeNames).toContain('PRECEDES');
      expect(typeNames).toContain('FOLLOWS');
      expect(typeNames).toContain('OWNS');
      expect(typeNames).toContain('EXECUTES');
      expect(typeNames).toContain('USES');
    });

    it('should throw if not initialized before use', () => {
      const service = new OntologyService();

      expect(() => service.validateEntityType('Process')).toThrow('not initialized');
    });

    it('should only initialize once', async () => {
      const service = new OntologyService();

      await service.initialize();
      const firstInitialized = service.initialized;
      await service.initialize();

      expect(firstInitialized).toBe(true);
      expect(service.initialized).toBe(true);
    });
  });

  describe('validateEntityType', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return valid for defined entity types', () => {
      const result = service.validateEntityType('Process');
      expect(result.valid).toBe(true);
    });

    it('should return invalid for undefined entity types', () => {
      const result = service.validateEntityType('InvalidType');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('not defined');
    });

    it('should suggest correct type for case mismatch', () => {
      const result = service.validateEntityType('process');
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe('Process');
    });

    it('should find similar types for typos', () => {
      const result = service.validateEntityType('Procss');
      expect(result.valid).toBe(false);
      expect(result.suggestion).toBe('Process');
    });

    it('should handle null type', () => {
      const result = service.validateEntityType(null);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('required');
    });

    it('should handle empty string', () => {
      const result = service.validateEntityType('');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateRelationship', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return valid for correct relationship with matching domain/range', () => {
      const result = service.validateRelationship('EXECUTES', 'Role', 'Task');

      expect(result.valid).toBe(true);
      expect(result.domainValid).toBe(true);
      expect(result.rangeValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect domain constraint violation', () => {
      const result = service.validateRelationship('EXECUTES', 'System', 'Task');

      expect(result.valid).toBe(false);
      expect(result.domainValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('domain');
    });

    it('should detect range constraint violation', () => {
      const result = service.validateRelationship('EXECUTES', 'Role', 'System');

      expect(result.valid).toBe(false);
      expect(result.rangeValid).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('range');
    });

    it('should accept generic Entity constraints for any type', () => {
      const result = service.validateRelationship('DEPENDS_ON', 'System', 'Role');

      expect(result.valid).toBe(true);
      expect(result.domainValid).toBe(true);
      expect(result.rangeValid).toBe(true);
    });

    it('should return invalid for unknown relationship type', () => {
      const result = service.validateRelationship('UNKNOWN_REL', 'Process', 'Task');

      expect(result.valid).toBe(false);
      expect(result.warnings.some(w => w.includes('not defined'))).toBe(true);
    });

    it('should validate subtypes correctly against parent constraints', () => {
      const result = service.validateRelationship('INTEGRATES_WITH', 'System', 'System');

      expect(result.valid).toBe(true);
    });

    it('should handle null relationship type', () => {
      const result = service.validateRelationship(null, 'Process', 'Task');

      expect(result.valid).toBe(false);
      expect(result.warnings).toContain('Relationship type is required');
    });
  });

  describe('normalizeRelationshipType', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return canonical type for synonym', () => {
      expect(service.normalizeRelationshipType('utilizes')).toBe('USES');
      expect(service.normalizeRelationshipType('supervises')).toBe('MANAGES');
      expect(service.normalizeRelationshipType('performs')).toBe('EXECUTES');
    });

    it('should uppercase already valid types', () => {
      expect(service.normalizeRelationshipType('uses')).toBe('USES');
      expect(service.normalizeRelationshipType('USES')).toBe('USES');
    });

    it('should handle types not in mappings', () => {
      expect(service.normalizeRelationshipType('random')).toBe('RANDOM');
    });

    it('should handle null input', () => {
      expect(service.normalizeRelationshipType(null)).toBeNull();
    });
  });

  describe('type hierarchy', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return ancestors for a type', () => {
      const ancestors = service.getTypeAncestors('Process');

      expect(ancestors).toContain('BusinessFlowEntity');
      expect(ancestors).toContain('Entity');
    });

    it('should return empty array for root type', () => {
      const ancestors = service.getTypeAncestors('Entity');

      expect(ancestors).toHaveLength(0);
    });

    it('should correctly determine subtype relationships', () => {
      expect(service.isSubtypeOf('Process', 'BusinessFlowEntity')).toBe(true);
      expect(service.isSubtypeOf('Process', 'Entity')).toBe(true);
      expect(service.isSubtypeOf('Process', 'Process')).toBe(true);
      expect(service.isSubtypeOf('Process', 'OrganizationalEntity')).toBe(false);
    });

    it('should get subtypes of a parent type', () => {
      const subtypes = service.getSubtypes('BusinessFlowEntity');

      expect(subtypes).toContain('Process');
      expect(subtypes).toContain('Task');
    });
  });

  describe('domain/range queries', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return domain for relationship', () => {
      expect(service.getDomainForRelationship('EXECUTES')).toBe('OrganizationalEntity');
      expect(service.getDomainForRelationship('PRECEDES')).toBe('BusinessFlowEntity');
    });

    it('should return range for relationship', () => {
      expect(service.getRangeForRelationship('EXECUTES')).toBe('BusinessFlowEntity');
      expect(service.getRangeForRelationship('USES')).toBe('TechnicalEntity');
    });

    it('should return null for unknown relationship', () => {
      expect(service.getDomainForRelationship('UNKNOWN')).toBeNull();
      expect(service.getRangeForRelationship('UNKNOWN')).toBeNull();
    });

    it('should return inverse relationship', () => {
      expect(service.getInverseRelationship('PRECEDES')).toBe('FOLLOWS');
      expect(service.getInverseRelationship('FOLLOWS')).toBe('PRECEDES');
    });
  });

  describe('generateValidationReport', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should generate report for valid entities and relationships', () => {
      const entities = [
        { name: 'Order Processing', type: 'Process' },
        { name: 'Finance Manager', type: 'Role' },
        { name: 'Review Order', type: 'Task' }
      ];
      const relationships = [
        { from: 'Finance Manager', to: 'Review Order', type: 'EXECUTES' },
        { from: 'Order Processing', to: 'Review Order', type: 'PRECEDES' }
      ];

      const report = service.generateValidationReport(entities, relationships);

      expect(report.valid).toBe(true);
      expect(report.entityReport.valid).toBe(3);
      expect(report.entityReport.invalid).toBe(0);
      expect(report.relationshipReport.valid).toBe(2);
      expect(report.summary.totalIssues).toBe(0);
    });

    it('should detect invalid entity types', () => {
      const entities = [
        { name: 'Valid Process', type: 'Process' },
        { name: 'Invalid Thing', type: 'InvalidType' }
      ];

      const report = service.generateValidationReport(entities, []);

      expect(report.valid).toBe(false);
      expect(report.entityReport.valid).toBe(1);
      expect(report.entityReport.invalid).toBe(1);
      expect(report.entityReport.issues).toHaveLength(1);
      expect(report.entityReport.issues[0].entity).toBe('Invalid Thing');
    });

    it('should detect relationship constraint violations', () => {
      const entities = [
        { name: 'SAP System', type: 'System' },
        { name: 'Order Process', type: 'Process' }
      ];
      const relationships = [
        { from: 'SAP System', to: 'Order Process', type: 'EXECUTES' }
      ];

      const report = service.generateValidationReport(entities, relationships);

      expect(report.valid).toBe(false);
      expect(report.relationshipReport.domainViolations).toBe(1);
      expect(report.relationshipReport.issues).toHaveLength(1);
    });

    it('should count unknown relationship types', () => {
      const entities = [
        { name: 'Entity A', type: 'Process' },
        { name: 'Entity B', type: 'Task' }
      ];
      const relationships = [
        { from: 'Entity A', to: 'Entity B', type: 'UNKNOWN_RELATIONSHIP' }
      ];

      const report = service.generateValidationReport(entities, relationships);

      expect(report.relationshipReport.unknownTypes).toBe(1);
    });

    it('should provide summary statistics', () => {
      const entities = [
        { name: 'E1', type: 'Process' },
        { name: 'E2', type: 'InvalidType' },
        { name: 'E3', type: 'Role' }
      ];
      const relationships = [
        { from: 'E1', to: 'E3', type: 'UNKNOWN' },
        { from: 'E3', to: 'E1', type: 'EXECUTES' }
      ];

      const report = service.generateValidationReport(entities, relationships);

      expect(report.summary).toBeDefined();
      expect(report.summary.totalIssues).toBeGreaterThan(0);
      expect(report.summary.entityTypeIssues).toBe(1);
    });
  });

  describe('getOntologyMetadata', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return ontology metadata', () => {
      const metadata = service.getOntologyMetadata();

      expect(metadata.version).toBe('1.2.3');
      expect(metadata.label).toBe('Business Knowledge Engine Ontology');
      expect(metadata.entityTypeCount).toBeGreaterThan(0);
      expect(metadata.relationshipTypeCount).toBeGreaterThan(0);
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance from getOntologyService', () => {
      const instance1 = getOntologyService();
      const instance2 = getOntologyService();

      expect(instance1).toBe(instance2);
    });

    it('initializeOntologyService should initialize and return service', async () => {
      const service = await initializeOntologyService();

      expect(service.initialized).toBe(true);
      expect(service).toBe(getOntologyService());
    });
  });

  // ==================== F2.1.2 - Polymorphic Query Tests ====================

  describe('expandTypeWithSubtypes (F2.1.2)', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should expand parent type to include all subtypes', () => {
      const result = service.expandTypeWithSubtypes('BusinessFlowEntity');

      expect(result.types).toContain('BusinessFlowEntity');
      expect(result.types).toContain('Process');
      expect(result.types).toContain('Task');
      expect(result.types.length).toBeGreaterThanOrEqual(3);
    });

    it('should return just the type for leaf types with no subtypes', () => {
      const result = service.expandTypeWithSubtypes('Process');

      expect(result.types).toContain('Process');
      expect(result.types.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect includeParent option', () => {
      const resultWithParent = service.expandTypeWithSubtypes('BusinessFlowEntity', { includeParent: true });
      const resultWithoutParent = service.expandTypeWithSubtypes('BusinessFlowEntity', { includeParent: false });

      expect(resultWithParent.types).toContain('BusinessFlowEntity');
      expect(resultWithoutParent.types).not.toContain('BusinessFlowEntity');
      expect(resultWithoutParent.types).toContain('Process');
    });

    it('should include hierarchy information', () => {
      const result = service.expandTypeWithSubtypes('BusinessFlowEntity');

      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy['BusinessFlowEntity']).toBeDefined();
      expect(result.hierarchy['BusinessFlowEntity'].isRoot).toBe(true);
      expect(result.hierarchy['BusinessFlowEntity'].depth).toBe(0);
    });

    it('should return warning for unknown type', () => {
      const result = service.expandTypeWithSubtypes('UnknownType');

      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('not found');
    });

    it('should handle case-insensitive type matching', () => {
      const result = service.expandTypeWithSubtypes('businessflowentity');

      expect(result.types).toContain('BusinessFlowEntity');
      expect(result.types).toContain('Process');
    });

    it('should handle null type gracefully', () => {
      const result = service.expandTypeWithSubtypes(null);

      expect(result.types).toHaveLength(0);
      expect(result.hierarchy).toEqual({});
    });

    it('should handle empty type gracefully', () => {
      const result = service.expandTypeWithSubtypes('');

      expect(result.types).toHaveLength(0);
    });

    it('should work with OrganizationalEntity hierarchy', () => {
      const result = service.expandTypeWithSubtypes('OrganizationalEntity');

      expect(result.types).toContain('OrganizationalEntity');
      expect(result.types).toContain('Role');
      expect(result.types).toContain('Department');
    });

    it('should provide correct depth information for nested types', () => {
      const result = service.expandTypeWithSubtypes('Entity');

      // Entity -> BusinessFlowEntity -> Process should have depth 2
      expect(result.hierarchy['BusinessFlowEntity']).toBeDefined();
      expect(result.hierarchy['Process']).toBeDefined();

      // Direct children should have depth 1
      expect(result.hierarchy['BusinessFlowEntity'].depth).toBe(1);

      // Grandchildren should have depth 2
      expect(result.hierarchy['Process'].depth).toBe(2);
    });
  });

  describe('getTypeTree (F2.1.2)', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return tree structure for parent type', () => {
      const tree = service.getTypeTree('BusinessFlowEntity');

      expect(tree).toBeDefined();
      expect(tree.name).toBe('BusinessFlowEntity');
      expect(tree.children).toBeDefined();
      expect(tree.children.length).toBeGreaterThan(0);

      const childNames = tree.children.map(c => c.name);
      expect(childNames).toContain('Process');
      expect(childNames).toContain('Task');
    });

    it('should return tree with label and comment', () => {
      const tree = service.getTypeTree('Process');

      expect(tree.label).toBe('Process');
      expect(tree.comment).toBeDefined();
    });

    it('should return null for unknown type', () => {
      const tree = service.getTypeTree('UnknownType');

      expect(tree).toBeNull();
    });

    it('should return tree with empty children for leaf type', () => {
      const tree = service.getTypeTree('System');

      expect(tree).toBeDefined();
      expect(tree.name).toBe('System');
      expect(tree.children).toHaveLength(0);
    });

    it('should handle null type', () => {
      const tree = service.getTypeTree(null);

      expect(tree).toBeNull();
    });

    it('should build nested tree for multi-level hierarchy', () => {
      const tree = service.getTypeTree('Entity');

      expect(tree).toBeDefined();
      expect(tree.name).toBe('Entity');

      // Entity should have BusinessFlowEntity, OrganizationalEntity, TechnicalEntity as children
      const childNames = tree.children.map(c => c.name);
      expect(childNames).toContain('BusinessFlowEntity');
      expect(childNames).toContain('OrganizationalEntity');
      expect(childNames).toContain('TechnicalEntity');

      // Check that grandchildren are nested properly
      const businessFlowEntity = tree.children.find(c => c.name === 'BusinessFlowEntity');
      if (businessFlowEntity) {
        const grandchildNames = businessFlowEntity.children.map(c => c.name);
        expect(grandchildNames).toContain('Process');
        expect(grandchildNames).toContain('Task');
      }
    });
  });

  // ==================== Versioning Tests (F2.2.1) ====================

  describe('getVersionInfo', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return complete version information', () => {
      const versionInfo = service.getVersionInfo();

      expect(versionInfo.version).toBe('1.2.3');
      expect(versionInfo.versionIRI).toBe('https://business-knowledge-engine.io/ontology/business-process/1.2.3');
      expect(versionInfo.priorVersion).toBe('https://business-knowledge-engine.io/ontology/business-process/1.2.2');
    });

    it('should include parsed version components', () => {
      const versionInfo = service.getVersionInfo();

      expect(versionInfo.parsed.major).toBe(1);
      expect(versionInfo.parsed.minor).toBe(2);
      expect(versionInfo.parsed.patch).toBe(3);
      expect(versionInfo.parsed.valid).toBe(true);
    });

    it('should include version metadata', () => {
      const versionInfo = service.getVersionInfo();

      expect(versionInfo.metadata.releaseNotes).toBe('Test release notes');
      expect(versionInfo.metadata.breakingChanges).toBe(false);
      expect(versionInfo.metadata.deprecations).toContain('OldType');
    });

    it('should include date information', () => {
      const versionInfo = service.getVersionInfo();

      expect(versionInfo.dates.created).toBeDefined();
      expect(versionInfo.dates.modified).toBeDefined();
    });
  });

  describe('parseVersion', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should parse simple semantic versions', () => {
      const result = service.parseVersion('1.2.3');

      expect(result.major).toBe(1);
      expect(result.minor).toBe(2);
      expect(result.patch).toBe(3);
      expect(result.preRelease).toBeNull();
      expect(result.buildMetadata).toBeNull();
      expect(result.valid).toBe(true);
    });

    it('should parse versions with pre-release', () => {
      const result = service.parseVersion('2.0.0-beta.1');

      expect(result.major).toBe(2);
      expect(result.minor).toBe(0);
      expect(result.patch).toBe(0);
      expect(result.preRelease).toBe('beta.1');
      expect(result.valid).toBe(true);
    });

    it('should parse versions with build metadata', () => {
      const result = service.parseVersion('1.0.0+build.123');

      expect(result.major).toBe(1);
      expect(result.minor).toBe(0);
      expect(result.patch).toBe(0);
      expect(result.buildMetadata).toBe('build.123');
      expect(result.valid).toBe(true);
    });

    it('should parse versions with both pre-release and build metadata', () => {
      const result = service.parseVersion('1.0.0-alpha.1+build.456');

      expect(result.preRelease).toBe('alpha.1');
      expect(result.buildMetadata).toBe('build.456');
      expect(result.valid).toBe(true);
    });

    it('should return invalid for malformed versions', () => {
      expect(service.parseVersion('invalid').valid).toBe(false);
      expect(service.parseVersion('1.2').valid).toBe(false);
      expect(service.parseVersion('v1.2.3').valid).toBe(false);
      expect(service.parseVersion('').valid).toBe(false);
      expect(service.parseVersion(null).valid).toBe(false);
    });
  });

  describe('compareVersions', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return 0 for equal versions', () => {
      expect(service.compareVersions('1.0.0', '1.0.0')).toBe(0);
      expect(service.compareVersions('2.5.10', '2.5.10')).toBe(0);
    });

    it('should compare major versions correctly', () => {
      expect(service.compareVersions('2.0.0', '1.0.0')).toBe(1);
      expect(service.compareVersions('1.0.0', '2.0.0')).toBe(-1);
    });

    it('should compare minor versions correctly', () => {
      expect(service.compareVersions('1.2.0', '1.1.0')).toBe(1);
      expect(service.compareVersions('1.1.0', '1.2.0')).toBe(-1);
    });

    it('should compare patch versions correctly', () => {
      expect(service.compareVersions('1.0.2', '1.0.1')).toBe(1);
      expect(service.compareVersions('1.0.1', '1.0.2')).toBe(-1);
    });

    it('should consider pre-release versions lower than release', () => {
      expect(service.compareVersions('1.0.0', '1.0.0-beta')).toBe(1);
      expect(service.compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
    });

    it('should compare pre-release identifiers', () => {
      expect(service.compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1);
      expect(service.compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    });
  });

  describe('isVersionCompatible', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should consider same major version compatible for >= 1.0.0', () => {
      const result = service.isVersionCompatible('1.5.0', '1.0.0');
      expect(result.compatible).toBe(true);
    });

    it('should consider different major version incompatible', () => {
      const result = service.isVersionCompatible('2.0.0', '1.0.0');
      expect(result.compatible).toBe(false);
    });

    it('should require exact minor version match for 0.x.x versions', () => {
      const compatible = service.isVersionCompatible('0.2.0', '0.2.0');
      expect(compatible.compatible).toBe(true);

      const incompatible = service.isVersionCompatible('0.3.0', '0.2.0');
      expect(incompatible.compatible).toBe(false);
    });

    it('should handle invalid versions', () => {
      const result = service.isVersionCompatible('invalid', '1.0.0');
      expect(result.compatible).toBe(false);
    });
  });

  describe('getVersionChangeType', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should detect major version changes as breaking', () => {
      const result = service.getVersionChangeType('1.0.0', '2.0.0');
      expect(result.type).toBe('major');
      expect(result.breaking).toBe(true);
    });

    it('should detect minor version changes as non-breaking', () => {
      const result = service.getVersionChangeType('1.0.0', '1.1.0');
      expect(result.type).toBe('minor');
      expect(result.breaking).toBe(false);
    });

    it('should detect patch version changes as non-breaking', () => {
      const result = service.getVersionChangeType('1.0.0', '1.0.1');
      expect(result.type).toBe('patch');
      expect(result.breaking).toBe(false);
    });

    it('should detect pre-release changes', () => {
      const result = service.getVersionChangeType('1.0.0-alpha', '1.0.0');
      expect(result.type).toBe('prerelease');
    });

    it('should detect no change for identical versions', () => {
      const result = service.getVersionChangeType('1.0.0', '1.0.0');
      expect(result.type).toBe('none');
    });

    it('should treat 0.x minor bumps as potentially breaking', () => {
      const result = service.getVersionChangeType('0.1.0', '0.2.0');
      expect(result.type).toBe('minor');
      expect(result.breaking).toBe(true);
    });
  });

  describe('getVersionHistory', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return version history array', () => {
      const history = service.getVersionHistory();

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });

    it('should include version records with changes', () => {
      const history = service.getVersionHistory();
      const firstRecord = history[0];

      expect(firstRecord.version).toBeDefined();
      expect(firstRecord.releaseDate).toBeDefined();
      expect(Array.isArray(firstRecord.changes)).toBe(true);
    });

    it('should include added types information', () => {
      const history = service.getVersionHistory();
      const recordWithTypes = history.find(h => h.addedTypes.length > 0);

      expect(recordWithTypes).toBeDefined();
      expect(recordWithTypes.addedTypes.length).toBeGreaterThan(0);
    });
  });

  describe('formatVersion', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should format version as short', () => {
      const result = service.formatVersion('1.2.3', 'short');
      expect(result).toBe('v1.2');
    });

    it('should format version as semantic', () => {
      const result = service.formatVersion('1.2.3-beta.1', 'semantic');
      expect(result).toBe('1.2.3-beta.1');
    });

    it('should format version as IRI', () => {
      const result = service.formatVersion('1.2.3', 'iri');
      expect(result).toContain('1.2.3');
      expect(result).toContain('business-process');
    });

    it('should return input for invalid versions', () => {
      const result = service.formatVersion('invalid', 'short');
      expect(result).toBe('invalid');
    });
  });

  describe('validateVersion', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should validate correct semantic versions', () => {
      const result = service.validateVersion('1.2.3');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized).toBe('1.2.3');
    });

    it('should validate versions with pre-release', () => {
      const result = service.validateVersion('1.0.0-beta.1');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid versions', () => {
      const result = service.validateVersion('invalid');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject empty string', () => {
      const result = service.validateVersion('');
      expect(result.valid).toBe(false);
    });

    it('should reject null', () => {
      const result = service.validateVersion(null);
      expect(result.valid).toBe(false);
    });
  });

  describe('getNextVersion', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should calculate next patch version', () => {
      const next = service.getNextVersion('patch');
      const current = service.parseVersion(service.getVersionInfo().version);

      expect(service.parseVersion(next).patch).toBe(current.patch + 1);
    });

    it('should calculate next minor version and reset patch', () => {
      const next = service.getNextVersion('minor');
      const parsed = service.parseVersion(next);
      const current = service.parseVersion(service.getVersionInfo().version);

      expect(parsed.minor).toBe(current.minor + 1);
      expect(parsed.patch).toBe(0);
    });

    it('should calculate next major version and reset minor/patch', () => {
      const next = service.getNextVersion('major');
      const parsed = service.parseVersion(next);
      const current = service.parseVersion(service.getVersionInfo().version);

      expect(parsed.major).toBe(current.major + 1);
      expect(parsed.minor).toBe(0);
      expect(parsed.patch).toBe(0);
    });

    it('should add pre-release identifier if provided', () => {
      const next = service.getNextVersion('minor', 'beta.1');
      expect(next).toContain('-beta.1');
    });
  });

  describe('getChangesFromVersion', () => {
    let service;

    beforeEach(async () => {
      service = new OntologyService();
      await service.initialize();
    });

    it('should return changes summary', () => {
      const changes = service.getChangesFromVersion('1.0.0');

      expect(changes).toBeDefined();
      expect(changes.from).toBe('1.0.0');
      expect(changes.to).toBeDefined();
    });

    it('should return initial release info when no prior version', () => {
      const changes = service.getChangesFromVersion(null);

      expect(changes).toBeDefined();
      expect(changes.to).toBeDefined();
    });
  });
});
