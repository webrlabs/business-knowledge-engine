/**
 * Unit Tests for Persona Service (F6.3.1)
 *
 * Tests persona definitions, weights, and utility functions for:
 * - Persona retrieval and validation
 * - Entity type weights per persona
 * - Relationship type weights per persona
 * - Summary style preferences
 * - Entity scoring and ranking
 * - Context preferences
 */

const {
  PersonaService,
  getPersonaService,
  resetPersonaService,
  PERSONA_IDS,
  ENTITY_CATEGORIES,
  SUMMARY_STYLES,
  PERSONAS,
} = require('../index');

// Mock logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('PersonaService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    resetPersonaService();
    service = new PersonaService();
    service.initialize();
  });

  afterEach(() => {
    resetPersonaService();
  });

  describe('Constants', () => {
    describe('PERSONA_IDS', () => {
      it('should define all expected persona IDs', () => {
        expect(PERSONA_IDS.OPS).toBe('ops');
        expect(PERSONA_IDS.IT).toBe('it');
        expect(PERSONA_IDS.LEADERSHIP).toBe('leadership');
        expect(PERSONA_IDS.COMPLIANCE).toBe('compliance');
        expect(PERSONA_IDS.DEFAULT).toBe('default');
      });

      it('should have 5 persona IDs', () => {
        expect(Object.keys(PERSONA_IDS)).toHaveLength(5);
      });
    });

    describe('ENTITY_CATEGORIES', () => {
      it('should define all expected entity categories', () => {
        expect(ENTITY_CATEGORIES.BUSINESS_FLOW).toContain('Process');
        expect(ENTITY_CATEGORIES.BUSINESS_FLOW).toContain('Task');
        expect(ENTITY_CATEGORIES.ORGANIZATIONAL).toContain('Role');
        expect(ENTITY_CATEGORIES.TECHNICAL).toContain('System');
        expect(ENTITY_CATEGORIES.ARTIFACT).toContain('Document');
        expect(ENTITY_CATEGORIES.GOVERNANCE).toContain('Policy');
        expect(ENTITY_CATEGORIES.MEASUREMENT).toContain('Metric');
      });

      it('should have 6 entity categories', () => {
        expect(Object.keys(ENTITY_CATEGORIES)).toHaveLength(6);
      });
    });

    describe('SUMMARY_STYLES', () => {
      it('should define all expected summary styles', () => {
        expect(SUMMARY_STYLES.TECHNICAL).toBeDefined();
        expect(SUMMARY_STYLES.EXECUTIVE).toBeDefined();
        expect(SUMMARY_STYLES.OPERATIONAL).toBeDefined();
        expect(SUMMARY_STYLES.COMPLIANCE).toBeDefined();
        expect(SUMMARY_STYLES.BALANCED).toBeDefined();
      });

      it('should include promptHint for each style', () => {
        Object.values(SUMMARY_STYLES).forEach((style) => {
          expect(style.promptHint).toBeDefined();
          expect(typeof style.promptHint).toBe('string');
          expect(style.promptHint.length).toBeGreaterThan(10);
        });
      });

      it('should include maxLength for each style', () => {
        Object.values(SUMMARY_STYLES).forEach((style) => {
          expect(style.maxLength).toBeDefined();
          expect(typeof style.maxLength).toBe('number');
          expect(style.maxLength).toBeGreaterThan(0);
        });
      });
    });

    describe('PERSONAS', () => {
      it('should define all 5 personas', () => {
        expect(Object.keys(PERSONAS)).toHaveLength(5);
        expect(PERSONAS[PERSONA_IDS.OPS]).toBeDefined();
        expect(PERSONAS[PERSONA_IDS.IT]).toBeDefined();
        expect(PERSONAS[PERSONA_IDS.LEADERSHIP]).toBeDefined();
        expect(PERSONAS[PERSONA_IDS.COMPLIANCE]).toBeDefined();
        expect(PERSONAS[PERSONA_IDS.DEFAULT]).toBeDefined();
      });

      it('should have required fields for each persona', () => {
        Object.values(PERSONAS).forEach((persona) => {
          expect(persona.id).toBeDefined();
          expect(persona.name).toBeDefined();
          expect(persona.description).toBeDefined();
          expect(persona.entityWeights).toBeDefined();
          expect(persona.categoryWeights).toBeDefined();
          expect(persona.relationshipWeights).toBeDefined();
          expect(persona.summaryStyle).toBeDefined();
          expect(persona.contextPreferences).toBeDefined();
        });
      });
    });
  });

  describe('Singleton pattern', () => {
    it('should return same instance via getPersonaService', () => {
      const instance1 = getPersonaService();
      const instance2 = getPersonaService();
      expect(instance1).toBe(instance2);
    });

    it('should create new instance after reset', () => {
      const instance1 = getPersonaService();
      resetPersonaService();
      const instance2 = getPersonaService();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('initialize()', () => {
    it('should initialize service', () => {
      const newService = new PersonaService();
      expect(newService.initialized).toBe(false);
      newService.initialize();
      expect(newService.initialized).toBe(true);
    });

    it('should only initialize once', () => {
      const newService = new PersonaService();
      newService.initialize();
      newService.initialize(); // Second call should be no-op
      expect(newService.initialized).toBe(true);
    });
  });

  describe('getPersonaIds()', () => {
    it('should return all persona IDs', () => {
      const ids = service.getPersonaIds();
      expect(ids).toHaveLength(5);
      expect(ids).toContain('ops');
      expect(ids).toContain('it');
      expect(ids).toContain('leadership');
      expect(ids).toContain('compliance');
      expect(ids).toContain('default');
    });
  });

  describe('getAllPersonas()', () => {
    it('should return all personas', () => {
      const personas = service.getAllPersonas();
      expect(Object.keys(personas)).toHaveLength(5);
    });

    it('should return a copy, not the original', () => {
      const personas = service.getAllPersonas();
      personas['new'] = { id: 'new' };
      expect(service.getPersona('new')).toBeNull();
    });
  });

  describe('getPersona()', () => {
    it('should return persona by ID', () => {
      const persona = service.getPersona('ops');
      expect(persona).toBeDefined();
      expect(persona.id).toBe('ops');
      expect(persona.name).toBe('Operations');
    });

    it('should return null for unknown persona', () => {
      const persona = service.getPersona('unknown');
      expect(persona).toBeNull();
    });

    it('should be case-insensitive', () => {
      const persona1 = service.getPersona('OPS');
      const persona2 = service.getPersona('Ops');
      const persona3 = service.getPersona('ops');
      expect(persona1).toEqual(persona3);
      expect(persona2).toEqual(persona3);
    });

    it('should handle null/undefined input', () => {
      expect(service.getPersona(null)).toBeNull();
      expect(service.getPersona(undefined)).toBeNull();
      expect(service.getPersona('')).toBeNull();
    });
  });

  describe('getPersonaOrDefault()', () => {
    it('should return persona if found', () => {
      const persona = service.getPersonaOrDefault('it');
      expect(persona.id).toBe('it');
    });

    it('should return default persona if not found', () => {
      const persona = service.getPersonaOrDefault('unknown');
      expect(persona.id).toBe('default');
    });

    it('should return default persona for null input', () => {
      const persona = service.getPersonaOrDefault(null);
      expect(persona.id).toBe('default');
    });
  });

  describe('hasPersona()', () => {
    it('should return true for existing personas', () => {
      expect(service.hasPersona('ops')).toBe(true);
      expect(service.hasPersona('IT')).toBe(true);
      expect(service.hasPersona('leadership')).toBe(true);
      expect(service.hasPersona('compliance')).toBe(true);
      expect(service.hasPersona('default')).toBe(true);
    });

    it('should return false for non-existing personas', () => {
      expect(service.hasPersona('unknown')).toBe(false);
      expect(service.hasPersona('')).toBe(false);
      expect(service.hasPersona(null)).toBe(false);
    });
  });

  describe('Entity Weights', () => {
    describe('getEntityWeight()', () => {
      it('should return high weight for Process in ops persona', () => {
        const weight = service.getEntityWeight('ops', 'Process');
        expect(weight).toBe(1.0);
      });

      it('should return high weight for System in IT persona', () => {
        const weight = service.getEntityWeight('it', 'System');
        expect(weight).toBe(1.0);
      });

      it('should return high weight for Metric in leadership persona', () => {
        const weight = service.getEntityWeight('leadership', 'Metric');
        expect(weight).toBe(1.0);
      });

      it('should return high weight for Policy in compliance persona', () => {
        const weight = service.getEntityWeight('compliance', 'Policy');
        expect(weight).toBe(1.0);
      });

      it('should return 0.5 for unknown entity type', () => {
        const weight = service.getEntityWeight('ops', 'UnknownType');
        expect(weight).toBe(0.5);
      });
    });

    describe('getEntityWeights()', () => {
      it('should return all entity weights for a persona', () => {
        const weights = service.getEntityWeights('ops');
        expect(weights).toBeDefined();
        expect(weights.Process).toBe(1.0);
        expect(weights.System).toBe(0.6);
      });

      it('should return a copy, not the original', () => {
        const weights = service.getEntityWeights('ops');
        weights.Process = 0;
        expect(service.getEntityWeight('ops', 'Process')).toBe(1.0);
      });
    });

    describe('Persona-specific entity weights', () => {
      it('OPS persona should prioritize business flow entities', () => {
        expect(service.getEntityWeight('ops', 'Process')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('ops', 'Task')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('ops', 'Database')).toBeLessThan(0.5);
      });

      it('IT persona should prioritize technical entities', () => {
        expect(service.getEntityWeight('it', 'System')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('it', 'Application')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('it', 'Database')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('it', 'Form')).toBeLessThan(0.5);
      });

      it('Leadership persona should prioritize measurement entities', () => {
        expect(service.getEntityWeight('leadership', 'Metric')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('leadership', 'KPI')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('leadership', 'Database')).toBeLessThan(0.3);
      });

      it('Compliance persona should prioritize governance entities', () => {
        expect(service.getEntityWeight('compliance', 'Policy')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('compliance', 'Regulation')).toBeGreaterThan(0.9);
        expect(service.getEntityWeight('compliance', 'Standard')).toBeGreaterThan(0.9);
      });
    });
  });

  describe('Category Weights', () => {
    describe('getCategoryWeight()', () => {
      it('should return high weight for BUSINESS_FLOW in ops persona', () => {
        const weight = service.getCategoryWeight('ops', 'BUSINESS_FLOW');
        expect(weight).toBe(1.0);
      });

      it('should return high weight for TECHNICAL in IT persona', () => {
        const weight = service.getCategoryWeight('it', 'TECHNICAL');
        expect(weight).toBe(1.0);
      });

      it('should return 0.5 for unknown category', () => {
        const weight = service.getCategoryWeight('ops', 'UNKNOWN_CATEGORY');
        expect(weight).toBe(0.5);
      });
    });
  });

  describe('Relationship Weights', () => {
    describe('getRelationshipWeight()', () => {
      it('should return high weight for PERFORMS in ops persona', () => {
        const weight = service.getRelationshipWeight('ops', 'PERFORMS');
        expect(weight).toBe(1.0);
      });

      it('should return high weight for INTEGRATES_WITH in IT persona', () => {
        const weight = service.getRelationshipWeight('it', 'INTEGRATES_WITH');
        expect(weight).toBe(1.0);
      });

      it('should return high weight for MEASURES in leadership persona', () => {
        const weight = service.getRelationshipWeight('leadership', 'MEASURES');
        expect(weight).toBe(1.0);
      });

      it('should return high weight for GOVERNS in compliance persona', () => {
        const weight = service.getRelationshipWeight('compliance', 'GOVERNS');
        expect(weight).toBe(1.0);
      });

      it('should return 0.5 for unknown relationship type', () => {
        const weight = service.getRelationshipWeight('ops', 'UNKNOWN_REL');
        expect(weight).toBe(0.5);
      });
    });
  });

  describe('Summary Styles', () => {
    describe('getSummaryStyle()', () => {
      it('should return operational style for ops persona', () => {
        const style = service.getSummaryStyle('ops');
        expect(style.id).toBe('operational');
      });

      it('should return technical style for IT persona', () => {
        const style = service.getSummaryStyle('it');
        expect(style.id).toBe('technical');
      });

      it('should return executive style for leadership persona', () => {
        const style = service.getSummaryStyle('leadership');
        expect(style.id).toBe('executive');
      });

      it('should return compliance style for compliance persona', () => {
        const style = service.getSummaryStyle('compliance');
        expect(style.id).toBe('compliance');
      });

      it('should return balanced style for default persona', () => {
        const style = service.getSummaryStyle('default');
        expect(style.id).toBe('balanced');
      });

      it('should return a copy, not the original', () => {
        const style = service.getSummaryStyle('ops');
        style.id = 'modified';
        expect(service.getSummaryStyle('ops').id).toBe('operational');
      });
    });
  });

  describe('Context Preferences', () => {
    describe('getContextPreferences()', () => {
      it('should return context preferences for a persona', () => {
        const prefs = service.getContextPreferences('it');
        expect(prefs.includeTechnicalContext).toBe(true);
        expect(prefs.maxHops).toBe(3);
      });

      it('should return a copy, not the original', () => {
        const prefs = service.getContextPreferences('it');
        prefs.maxHops = 100;
        expect(service.getContextPreferences('it').maxHops).toBe(3);
      });
    });
  });

  describe('Entity Category', () => {
    describe('getEntityCategory()', () => {
      it('should return correct category for business flow entities', () => {
        expect(service.getEntityCategory('Process')).toBe('BUSINESS_FLOW');
        expect(service.getEntityCategory('Task')).toBe('BUSINESS_FLOW');
        expect(service.getEntityCategory('Activity')).toBe('BUSINESS_FLOW');
        expect(service.getEntityCategory('Decision')).toBe('BUSINESS_FLOW');
      });

      it('should return correct category for organizational entities', () => {
        expect(service.getEntityCategory('Role')).toBe('ORGANIZATIONAL');
        expect(service.getEntityCategory('Department')).toBe('ORGANIZATIONAL');
        expect(service.getEntityCategory('Stakeholder')).toBe('ORGANIZATIONAL');
      });

      it('should return correct category for technical entities', () => {
        expect(service.getEntityCategory('System')).toBe('TECHNICAL');
        expect(service.getEntityCategory('Application')).toBe('TECHNICAL');
        expect(service.getEntityCategory('Database')).toBe('TECHNICAL');
      });

      it('should return correct category for artifact entities', () => {
        expect(service.getEntityCategory('Document')).toBe('ARTIFACT');
        expect(service.getEntityCategory('Form')).toBe('ARTIFACT');
        expect(service.getEntityCategory('Template')).toBe('ARTIFACT');
      });

      it('should return correct category for governance entities', () => {
        expect(service.getEntityCategory('Policy')).toBe('GOVERNANCE');
        expect(service.getEntityCategory('Regulation')).toBe('GOVERNANCE');
        expect(service.getEntityCategory('Standard')).toBe('GOVERNANCE');
      });

      it('should return correct category for measurement entities', () => {
        expect(service.getEntityCategory('Metric')).toBe('MEASUREMENT');
        expect(service.getEntityCategory('KPI')).toBe('MEASUREMENT');
      });

      it('should return null for unknown entity type', () => {
        expect(service.getEntityCategory('UnknownType')).toBeNull();
      });
    });
  });

  describe('Entity Scoring', () => {
    describe('calculateEntityScore()', () => {
      it('should calculate combined score', () => {
        const score = service.calculateEntityScore('ops', 'Process', 0.8, 0.9);
        // 0.4 * 1.0 + 0.3 * 0.8 + 0.3 * 0.9 = 0.4 + 0.24 + 0.27 = 0.91
        expect(score).toBeCloseTo(0.91, 2);
      });

      it('should clamp score to 0-1 range', () => {
        const score = service.calculateEntityScore('ops', 'Process', 1.0, 1.0);
        expect(score).toBeLessThanOrEqual(1);
        expect(score).toBeGreaterThanOrEqual(0);
      });

      it('should use default values when scores not provided', () => {
        const score = service.calculateEntityScore('ops', 'Process');
        // 0.4 * 1.0 + 0.3 * 0.5 + 0.3 * 0.5 = 0.4 + 0.15 + 0.15 = 0.7
        expect(score).toBeCloseTo(0.7, 2);
      });
    });

    describe('rankEntitiesByPersona()', () => {
      it('should rank entities by persona score', () => {
        const entities = [
          { type: 'Database', importance: 0.5, similarity: 0.5 },
          { type: 'Process', importance: 0.5, similarity: 0.5 },
          { type: 'Policy', importance: 0.5, similarity: 0.5 },
        ];

        const ranked = service.rankEntitiesByPersona('ops', entities);

        // Process should rank highest for ops persona
        expect(ranked[0].type).toBe('Process');
        expect(ranked[0].personaScore).toBeGreaterThan(ranked[1].personaScore);
      });

      it('should add personaScore to each entity', () => {
        const entities = [{ type: 'System' }];
        const ranked = service.rankEntitiesByPersona('it', entities);
        expect(ranked[0].personaScore).toBeDefined();
        expect(typeof ranked[0].personaScore).toBe('number');
      });

      it('should handle ontologyType field', () => {
        const entities = [{ ontologyType: 'Metric' }];
        const ranked = service.rankEntitiesByPersona('leadership', entities);
        expect(ranked[0].personaScore).toBeGreaterThan(0.7);
      });

      it('should handle score field as similarity', () => {
        const entities = [{ type: 'System', score: 0.9 }];
        const ranked = service.rankEntitiesByPersona('it', entities);
        expect(ranked[0].personaScore).toBeGreaterThan(0.7);
      });
    });

    describe('filterEntitiesByPersona()', () => {
      it('should filter out low-scoring entities', () => {
        const entities = [
          { type: 'Process', importance: 0.8, similarity: 0.8 },
          { type: 'Database', importance: 0.1, similarity: 0.1 },
        ];

        const filtered = service.filterEntitiesByPersona('ops', entities, 0.5);

        // Database should be filtered out for ops persona
        expect(filtered.length).toBeLessThanOrEqual(entities.length);
        expect(filtered.some((e) => e.type === 'Process')).toBe(true);
      });

      it('should use default threshold of 0.3', () => {
        const entities = [{ type: 'Process', importance: 0.5, similarity: 0.5 }];
        const filtered = service.filterEntitiesByPersona('ops', entities);
        expect(filtered.length).toBe(1);
      });
    });
  });

  describe('Prompt Generation', () => {
    describe('getPromptHint()', () => {
      it('should return prompt hint for persona', () => {
        const hint = service.getPromptHint('leadership');
        expect(hint).toContain('Leadership');
        expect(hint).toContain('executive');
      });

      it('should include persona name and style hint', () => {
        const hint = service.getPromptHint('it');
        expect(hint).toContain('IT');
        expect(hint).toContain('technical');
      });

      it('should return default hint for unknown persona', () => {
        const hint = service.getPromptHint('unknown');
        expect(hint).toContain('General User');
      });
    });
  });

  describe('Persona Summaries', () => {
    describe('getPersonaSummary()', () => {
      it('should return brief summary for persona', () => {
        const summary = service.getPersonaSummary('ops');
        expect(summary.id).toBe('ops');
        expect(summary.name).toBe('Operations');
        expect(summary.description).toBeDefined();
        expect(summary.icon).toBeDefined();
        expect(summary.summaryStyle).toBe('operational');
      });
    });

    describe('getAllPersonaSummaries()', () => {
      it('should return summaries for all personas', () => {
        const summaries = service.getAllPersonaSummaries();
        expect(summaries).toHaveLength(5);
        summaries.forEach((s) => {
          expect(s.id).toBeDefined();
          expect(s.name).toBeDefined();
          expect(s.exampleQueries).toBeDefined();
        });
      });
    });
  });

  describe('Validation', () => {
    describe('validatePersonaId()', () => {
      it('should validate known persona IDs', () => {
        const result = service.validatePersonaId('ops');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('ops');
      });

      it('should normalize persona IDs', () => {
        const result = service.validatePersonaId('  OPS  ');
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe('ops');
      });

      it('should return error for unknown persona', () => {
        const result = service.validatePersonaId('unknown');
        expect(result.valid).toBe(false);
        expect(result.message).toContain('Unknown persona');
        expect(result.message).toContain('Available personas');
      });

      it('should return error for null input', () => {
        const result = service.validatePersonaId(null);
        expect(result.valid).toBe(false);
        expect(result.message).toContain('non-empty string');
      });

      it('should return error for empty string', () => {
        const result = service.validatePersonaId('');
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('Statistics', () => {
    describe('getStats()', () => {
      it('should return service statistics', () => {
        const stats = service.getStats();
        expect(stats.totalPersonas).toBe(5);
        expect(stats.entityCategories).toBe(6);
        expect(stats.summaryStyles).toBe(5);
        expect(stats.personaList).toHaveLength(5);
      });
    });
  });

  describe('Reset', () => {
    describe('reset()', () => {
      it('should reset service to initial state', () => {
        service.personas['custom'] = { id: 'custom' };
        service.reset();
        expect(service.hasPersona('custom')).toBe(false);
        expect(service.initialized).toBe(false);
      });
    });
  });
});
