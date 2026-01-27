/**
 * Persona-Based Filtering Tests (F6.3.6)
 *
 * Tests for filtering GraphRAG results based on persona relevance.
 * This feature hides irrelevant entities and relationships from specific personas,
 * e.g., hiding technical details from executives.
 */

const {
  PersonaService,
  getPersonaService,
  resetPersonaService,
  PERSONA_IDS,
  FILTERING_DEFAULTS,
} = require('../index');

describe('PersonaService - Filtering (F6.3.6)', () => {
  let personaService;

  beforeEach(() => {
    resetPersonaService();
    personaService = getPersonaService();
  });

  afterEach(() => {
    resetPersonaService();
  });

  describe('getFilteringConfig', () => {
    it('should return filtering config for ops persona', () => {
      const config = personaService.getFilteringConfig(PERSONA_IDS.OPS);

      expect(config).toBeDefined();
      expect(config.enabled).toBe(true);
      expect(config.minEntityRelevance).toBeDefined();
      expect(config.hiddenEntityTypes).toBeInstanceOf(Array);
      expect(config.hiddenRelationshipTypes).toBeInstanceOf(Array);
    });

    it('should return filtering config for leadership persona with hidden technical types', () => {
      const config = personaService.getFilteringConfig(PERSONA_IDS.LEADERSHIP);

      expect(config.enabled).toBe(true);
      expect(config.hiddenEntityTypes).toContain('Database');
      expect(config.hiddenEntityTypes).toContain('Application');
      expect(config.hiddenRelationshipTypes).toContain('INTEGRATES_WITH');
      expect(config.hiddenRelationshipTypes).toContain('STORES_IN');
    });

    it('should return filtering disabled for default persona', () => {
      const config = personaService.getFilteringConfig(PERSONA_IDS.DEFAULT);

      expect(config.enabled).toBe(false);
      expect(config.hiddenEntityTypes).toEqual([]);
    });

    it('should merge with defaults for missing properties', () => {
      const config = personaService.getFilteringConfig(PERSONA_IDS.IT);

      expect(config.showLowRelevanceCount).toBeDefined();
      expect(typeof config.minEntityRelevance).toBe('number');
    });
  });

  describe('isFilteringEnabled', () => {
    it('should return true for personas with filtering enabled', () => {
      expect(personaService.isFilteringEnabled(PERSONA_IDS.OPS)).toBe(true);
      expect(personaService.isFilteringEnabled(PERSONA_IDS.IT)).toBe(true);
      expect(personaService.isFilteringEnabled(PERSONA_IDS.LEADERSHIP)).toBe(true);
      expect(personaService.isFilteringEnabled(PERSONA_IDS.COMPLIANCE)).toBe(true);
    });

    it('should return false for default persona', () => {
      expect(personaService.isFilteringEnabled(PERSONA_IDS.DEFAULT)).toBe(false);
    });
  });

  describe('shouldShowEntityType', () => {
    it('should hide Database from leadership persona', () => {
      expect(personaService.shouldShowEntityType(PERSONA_IDS.LEADERSHIP, 'Database')).toBe(false);
      expect(personaService.shouldShowEntityType(PERSONA_IDS.LEADERSHIP, 'database')).toBe(false);
    });

    it('should hide Application from leadership persona', () => {
      expect(personaService.shouldShowEntityType(PERSONA_IDS.LEADERSHIP, 'Application')).toBe(false);
    });

    it('should show Process to leadership persona', () => {
      expect(personaService.shouldShowEntityType(PERSONA_IDS.LEADERSHIP, 'Process')).toBe(true);
    });

    it('should show all entity types to IT persona', () => {
      expect(personaService.shouldShowEntityType(PERSONA_IDS.IT, 'Database')).toBe(true);
      expect(personaService.shouldShowEntityType(PERSONA_IDS.IT, 'Application')).toBe(true);
      expect(personaService.shouldShowEntityType(PERSONA_IDS.IT, 'System')).toBe(true);
    });

    it('should show all entity types to default persona', () => {
      expect(personaService.shouldShowEntityType(PERSONA_IDS.DEFAULT, 'Database')).toBe(true);
      expect(personaService.shouldShowEntityType(PERSONA_IDS.DEFAULT, 'Application')).toBe(true);
    });

    it('should handle case insensitivity', () => {
      expect(personaService.shouldShowEntityType(PERSONA_IDS.LEADERSHIP, 'DATABASE')).toBe(false);
      expect(personaService.shouldShowEntityType(PERSONA_IDS.LEADERSHIP, 'DaTaBaSe')).toBe(false);
    });
  });

  describe('shouldShowRelationshipType', () => {
    it('should hide INTEGRATES_WITH from leadership persona', () => {
      expect(personaService.shouldShowRelationshipType(PERSONA_IDS.LEADERSHIP, 'INTEGRATES_WITH')).toBe(false);
    });

    it('should hide STORES_IN from leadership persona', () => {
      expect(personaService.shouldShowRelationshipType(PERSONA_IDS.LEADERSHIP, 'STORES_IN')).toBe(false);
    });

    it('should show RESPONSIBLE_FOR to leadership persona', () => {
      expect(personaService.shouldShowRelationshipType(PERSONA_IDS.LEADERSHIP, 'RESPONSIBLE_FOR')).toBe(true);
    });

    it('should show all relationship types to IT persona', () => {
      expect(personaService.shouldShowRelationshipType(PERSONA_IDS.IT, 'INTEGRATES_WITH')).toBe(true);
      expect(personaService.shouldShowRelationshipType(PERSONA_IDS.IT, 'STORES_IN')).toBe(true);
    });

    it('should handle case insensitivity', () => {
      expect(personaService.shouldShowRelationshipType(PERSONA_IDS.LEADERSHIP, 'integrates_with')).toBe(false);
    });
  });

  describe('filterEntitiesByRelevance', () => {
    const mockEntities = [
      { name: 'CRM System', type: 'System', importance: 0.8, similarity: 0.9 },
      { name: 'User Database', type: 'Database', importance: 0.7, similarity: 0.85 },
      { name: 'Sales Process', type: 'Process', importance: 0.9, similarity: 0.95 },
      { name: 'Mobile App', type: 'Application', importance: 0.6, similarity: 0.7 },
      { name: 'Revenue KPI', type: 'KPI', importance: 0.95, similarity: 0.8 },
      { name: 'Low Priority Task', type: 'Task', importance: 0.1, similarity: 0.2 },
    ];

    it('should filter out hidden entity types for leadership persona', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.LEADERSHIP, mockEntities);

      expect(result.metadata.filtered).toBe(true);
      expect(result.entities.some(e => e.type === 'Database')).toBe(false);
      expect(result.entities.some(e => e.type === 'Application')).toBe(false);
      expect(result.entities.some(e => e.type === 'KPI')).toBe(true);
      expect(result.entities.some(e => e.type === 'Process')).toBe(true);
    });

    it('should filter out entities below relevance threshold', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.LEADERSHIP, mockEntities);

      // Low Priority Task should be filtered due to low relevance
      expect(result.entities.some(e => e.name === 'Low Priority Task')).toBe(false);
      expect(result.metadata.removedCount).toBeGreaterThan(0);
    });

    it('should not filter when filtering is disabled for persona', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.DEFAULT, mockEntities);

      expect(result.metadata.filtered).toBe(false);
      expect(result.entities.length).toBe(mockEntities.length);
    });

    it('should force filter when forceFilter option is true', () => {
      const result = personaService.filterEntitiesByRelevance(
        PERSONA_IDS.DEFAULT,
        mockEntities,
        { forceFilter: true }
      );

      expect(result.metadata.filtered).toBe(true);
    });

    it('should respect custom minRelevance threshold', () => {
      const highThresholdResult = personaService.filterEntitiesByRelevance(
        PERSONA_IDS.IT,
        mockEntities,
        { minRelevance: 0.9 }
      );

      expect(highThresholdResult.entities.length).toBeLessThan(mockEntities.length);
    });

    it('should add personaRelevance score to filtered entities', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.IT, mockEntities);

      result.entities.forEach(entity => {
        expect(entity.personaRelevance).toBeDefined();
        expect(typeof entity.personaRelevance).toBe('number');
      });
    });

    it('should sort filtered entities by relevance', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.IT, mockEntities);

      for (let i = 1; i < result.entities.length; i++) {
        expect(result.entities[i - 1].personaRelevance).toBeGreaterThanOrEqual(
          result.entities[i].personaRelevance
        );
      }
    });

    it('should include removed entities in result when requested', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.LEADERSHIP, mockEntities);

      expect(result.removed).toBeDefined();
      expect(result.removed.length).toBeGreaterThan(0);
      expect(result.removed.some(r => r.reason === 'hidden_type')).toBe(true);
    });

    it('should handle empty entities array', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.LEADERSHIP, []);

      expect(result.entities).toEqual([]);
      expect(result.metadata.originalCount).toBe(0);
    });

    it('should handle null entities array', () => {
      const result = personaService.filterEntitiesByRelevance(PERSONA_IDS.LEADERSHIP, null);

      expect(result.entities).toBeNull();
      expect(result.metadata.filtered).toBe(false);
    });
  });

  describe('filterRelationshipsByRelevance', () => {
    const mockRelationships = [
      { from: 'CRM', to: 'Database', type: 'STORES_IN' },
      { from: 'User', to: 'CRM', type: 'USES' },
      { from: 'CRM', to: 'ERP', type: 'INTEGRATES_WITH' },
      { from: 'Manager', to: 'Process', type: 'RESPONSIBLE_FOR' },
      { from: 'System', to: 'Database', type: 'READS_FROM' },
    ];

    it('should filter out hidden relationship types for leadership persona', () => {
      const result = personaService.filterRelationshipsByRelevance(
        PERSONA_IDS.LEADERSHIP,
        mockRelationships
      );

      expect(result.metadata.filtered).toBe(true);
      expect(result.relationships.some(r => r.type === 'STORES_IN')).toBe(false);
      expect(result.relationships.some(r => r.type === 'INTEGRATES_WITH')).toBe(false);
      expect(result.relationships.some(r => r.type === 'RESPONSIBLE_FOR')).toBe(true);
    });

    it('should not filter when filtering is disabled', () => {
      const result = personaService.filterRelationshipsByRelevance(
        PERSONA_IDS.DEFAULT,
        mockRelationships
      );

      expect(result.metadata.filtered).toBe(false);
      expect(result.relationships.length).toBe(mockRelationships.length);
    });

    it('should filter by allowed entity names when specified', () => {
      const allowedEntities = new Set(['CRM', 'ERP', 'Manager', 'Process']);
      const result = personaService.filterRelationshipsByRelevance(
        PERSONA_IDS.IT,
        mockRelationships,
        { allowedEntityNames: allowedEntities }
      );

      // Relationships with Database or System should be filtered out
      result.relationships.forEach(rel => {
        expect(allowedEntities.has(rel.from)).toBe(true);
        expect(allowedEntities.has(rel.to)).toBe(true);
      });
    });

    it('should add personaRelevance score to filtered relationships', () => {
      const result = personaService.filterRelationshipsByRelevance(
        PERSONA_IDS.OPS,
        mockRelationships
      );

      result.relationships.forEach(rel => {
        expect(rel.personaRelevance).toBeDefined();
      });
    });

    it('should track removal reasons in metadata when showLowRelevanceCount is true', () => {
      // Use OPS persona which has showLowRelevanceCount: true
      const result = personaService.filterRelationshipsByRelevance(
        PERSONA_IDS.OPS,
        mockRelationships
      );

      expect(result.metadata.removedByReason).toBeDefined();
    });

    it('should not include removal reasons when showLowRelevanceCount is false', () => {
      // Leadership has showLowRelevanceCount: false
      const result = personaService.filterRelationshipsByRelevance(
        PERSONA_IDS.LEADERSHIP,
        mockRelationships
      );

      expect(result.metadata.removedByReason).toBeUndefined();
    });
  });

  describe('filterResultsByPersona', () => {
    const mockResults = {
      entities: [
        { name: 'CRM System', type: 'System', importance: 0.8 },
        { name: 'User Database', type: 'Database', importance: 0.7 },
        { name: 'Sales Process', type: 'Process', importance: 0.9 },
        { name: 'Revenue KPI', type: 'KPI', importance: 0.95 },
      ],
      relationships: [
        { from: 'CRM System', to: 'User Database', type: 'STORES_IN' },
        { from: 'Sales Process', to: 'Revenue KPI', type: 'MEASURES' },
        { from: 'CRM System', to: 'Sales Process', type: 'SUPPORTS' },
      ],
    };

    it('should filter both entities and relationships for leadership persona', () => {
      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.LEADERSHIP,
        mockResults
      );

      expect(result.filteringMetadata.applied).toBe(true);
      expect(result.entities.some(e => e.type === 'Database')).toBe(false);
      // Relationships with Database endpoint should also be filtered
      expect(result.relationships.some(r =>
        r.from === 'User Database' || r.to === 'User Database'
      )).toBe(false);
    });

    it('should not filter for default persona', () => {
      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.DEFAULT,
        mockResults
      );

      expect(result.filteringMetadata.applied).toBe(false);
      expect(result.entities.length).toBe(mockResults.entities.length);
    });

    it('should include filtering metadata with counts', () => {
      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.LEADERSHIP,
        mockResults
      );

      expect(result.filteringMetadata.entity.originalCount).toBe(mockResults.entities.length);
      expect(result.filteringMetadata.entity.removedCount).toBeGreaterThan(0);
      expect(result.filteringMetadata.totalRemoved).toBeGreaterThan(0);
    });

    it('should preserve other result properties', () => {
      const resultsWithExtras = {
        ...mockResults,
        context: 'Some context',
        metadata: { test: true },
      };

      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.LEADERSHIP,
        resultsWithExtras
      );

      expect(result.context).toBe('Some context');
      expect(result.metadata).toEqual({ test: true });
    });

    it('should force filter when option is set', () => {
      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.DEFAULT,
        mockResults,
        { forceFilter: true }
      );

      expect(result.filteringMetadata.applied).toBe(true);
    });
  });

  describe('getFilteringSummary', () => {
    it('should return human-readable summary for leadership persona', () => {
      const summary = personaService.getFilteringSummary(PERSONA_IDS.LEADERSHIP);

      expect(summary.personaId).toBe(PERSONA_IDS.LEADERSHIP);
      expect(summary.personaName).toBe('Leadership / Executive');
      expect(summary.filteringEnabled).toBe(true);
      expect(summary.entityFiltering.hiddenTypes).toContain('Database');
      expect(summary.description).toContain('will be hidden');
    });

    it('should indicate filtering disabled for default persona', () => {
      const summary = personaService.getFilteringSummary(PERSONA_IDS.DEFAULT);

      expect(summary.filteringEnabled).toBe(false);
      expect(summary.description).toContain('disabled');
    });

    it('should include threshold values', () => {
      const summary = personaService.getFilteringSummary(PERSONA_IDS.OPS);

      expect(summary.entityFiltering.minRelevanceThreshold).toBeGreaterThan(0);
      expect(summary.relationshipFiltering.minRelevanceThreshold).toBeGreaterThan(0);
    });
  });

  describe('FILTERING_DEFAULTS', () => {
    it('should have all required default properties', () => {
      expect(FILTERING_DEFAULTS.enabled).toBeDefined();
      expect(FILTERING_DEFAULTS.minEntityRelevance).toBeDefined();
      expect(FILTERING_DEFAULTS.minRelationshipRelevance).toBeDefined();
      expect(FILTERING_DEFAULTS.hiddenEntityTypes).toBeDefined();
      expect(FILTERING_DEFAULTS.hiddenRelationshipTypes).toBeDefined();
      expect(FILTERING_DEFAULTS.showLowRelevanceCount).toBeDefined();
    });
  });
});

describe('Persona Filtering Integration', () => {
  let personaService;

  beforeEach(() => {
    resetPersonaService();
    personaService = getPersonaService();
  });

  afterEach(() => {
    resetPersonaService();
  });

  describe('Executive filtering use case', () => {
    it('should hide technical details from executives', () => {
      // Simulate a technical-heavy result set
      const technicalResults = {
        entities: [
          { name: 'PostgreSQL', type: 'Database', importance: 0.9 },
          { name: 'Redis Cache', type: 'Database', importance: 0.8 },
          { name: 'Mobile App', type: 'Application', importance: 0.85 },
          { name: 'API Gateway', type: 'Application', importance: 0.75 },
          { name: 'Q4 Revenue', type: 'Metric', importance: 0.95 },
          { name: 'Customer Growth', type: 'KPI', importance: 0.92 },
          { name: 'Sales Pipeline', type: 'Process', importance: 0.88 },
        ],
        relationships: [
          { from: 'API Gateway', to: 'PostgreSQL', type: 'READS_FROM' },
          { from: 'API Gateway', to: 'Redis Cache', type: 'STORES_IN' },
          { from: 'Sales Pipeline', to: 'Q4 Revenue', type: 'MEASURES' },
        ],
      };

      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.LEADERSHIP,
        technicalResults
      );

      // Executives should see metrics/KPIs/processes but not databases/apps
      const entityTypes = result.entities.map(e => e.type);
      expect(entityTypes).not.toContain('Database');
      expect(entityTypes).not.toContain('Application');
      expect(entityTypes).toContain('Metric');
      expect(entityTypes).toContain('KPI');
      expect(entityTypes).toContain('Process');

      // Technical relationships should be filtered
      expect(result.relationships.some(r => r.type === 'READS_FROM')).toBe(false);
      expect(result.relationships.some(r => r.type === 'STORES_IN')).toBe(false);
      expect(result.relationships.some(r => r.type === 'MEASURES')).toBe(true);
    });
  });

  describe('IT persona technical focus', () => {
    it('should preserve technical details for IT persona', () => {
      const technicalResults = {
        entities: [
          { name: 'PostgreSQL', type: 'Database', importance: 0.9 },
          { name: 'Mobile App', type: 'Application', importance: 0.85 },
          { name: 'Q4 Revenue', type: 'Metric', importance: 0.95 },
        ],
        relationships: [
          { from: 'Mobile App', to: 'PostgreSQL', type: 'READS_FROM' },
          { from: 'Mobile App', to: 'PostgreSQL', type: 'WRITES_TO' },
        ],
      };

      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.IT,
        technicalResults
      );

      // IT should see everything (no hidden types)
      expect(result.entities.some(e => e.type === 'Database')).toBe(true);
      expect(result.entities.some(e => e.type === 'Application')).toBe(true);
      expect(result.relationships.some(r => r.type === 'READS_FROM')).toBe(true);
    });
  });

  describe('Operations persona workflow focus', () => {
    it('should hide integration details but show workflows', () => {
      const mixedResults = {
        entities: [
          { name: 'Onboarding Process', type: 'Process', importance: 0.9 },
          { name: 'Submit Form', type: 'Task', importance: 0.85 },
          { name: 'HR System', type: 'System', importance: 0.7 },
        ],
        relationships: [
          { from: 'Submit Form', to: 'Onboarding Process', type: 'PART_OF' },
          { from: 'HR System', to: 'Database', type: 'STORES_IN' },
          { from: 'HR System', to: 'ERP', type: 'INTEGRATES_WITH' },
        ],
      };

      const result = personaService.filterResultsByPersona(
        PERSONA_IDS.OPS,
        mixedResults
      );

      // Operations should see process relationships
      expect(result.relationships.some(r => r.type === 'PART_OF')).toBe(true);
      // But not technical integration details
      expect(result.relationships.some(r => r.type === 'INTEGRATES_WITH')).toBe(false);
    });
  });
});
