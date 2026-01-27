/**
 * Unit tests for PromptTuningService
 *
 * Tests A/B testing of extraction prompts including:
 * - Experiment lifecycle management
 * - Variant assignment and tracking
 * - Result recording and analysis
 * - Comparison report generation
 *
 * Feature: F4.3.6 - Extraction Prompt Tuning
 */

const {
  PromptTuningService,
  getPromptTuningService,
  ExperimentStatus,
  DEFAULT_EXPERIMENT_CONFIG
} = require('../prompt-tuning-service');

const {
  PromptVariantId,
  PROMPT_VARIANTS,
  getPromptVariant,
  getAllPromptVariants,
  getPromptVariantList,
  isValidVariant,
  ENTITY_TYPE_DEFINITIONS
} = require('../../prompts/prompt-variants');

describe('Prompt Variants', () => {
  describe('PromptVariantId', () => {
    test('defines all expected variant IDs', () => {
      expect(PromptVariantId.BASELINE).toBe('baseline');
      expect(PromptVariantId.FEW_SHOT).toBe('few_shot');
      expect(PromptVariantId.CHAIN_OF_THOUGHT).toBe('chain_of_thought');
      expect(PromptVariantId.STRUCTURED_GUIDELINES).toBe('structured_guidelines');
      expect(PromptVariantId.CONCISE).toBe('concise');
    });

    test('has 5 variants', () => {
      expect(Object.keys(PromptVariantId)).toHaveLength(5);
    });
  });

  describe('PROMPT_VARIANTS', () => {
    test('has all variants defined', () => {
      expect(PROMPT_VARIANTS[PromptVariantId.BASELINE]).toBeDefined();
      expect(PROMPT_VARIANTS[PromptVariantId.FEW_SHOT]).toBeDefined();
      expect(PROMPT_VARIANTS[PromptVariantId.CHAIN_OF_THOUGHT]).toBeDefined();
      expect(PROMPT_VARIANTS[PromptVariantId.STRUCTURED_GUIDELINES]).toBeDefined();
      expect(PROMPT_VARIANTS[PromptVariantId.CONCISE]).toBeDefined();
    });

    test.each(Object.values(PromptVariantId))('variant %s has required properties', (variantId) => {
      const variant = PROMPT_VARIANTS[variantId];

      expect(variant.id).toBe(variantId);
      expect(variant.name).toBeDefined();
      expect(typeof variant.name).toBe('string');
      expect(variant.description).toBeDefined();
      expect(variant.hypothesis).toBeDefined();
      expect(variant.entitySystemPrompt).toBeDefined();
      expect(typeof variant.entitySystemPrompt).toBe('string');
      expect(variant.relationshipSystemPrompt).toBeDefined();
      expect(typeof variant.relationshipSystemPrompt).toBe('string');
      expect(typeof variant.buildEntityPrompt).toBe('function');
      expect(typeof variant.buildRelationshipPrompt).toBe('function');
    });

    test('baseline variant has standard instructions', () => {
      const baseline = PROMPT_VARIANTS[PromptVariantId.BASELINE];
      expect(baseline.entitySystemPrompt).toContain('ENTITY TYPES');
      expect(baseline.entitySystemPrompt).toContain('OUTPUT FORMAT');
      expect(baseline.relationshipSystemPrompt).toContain('RELATIONSHIP TYPES');
    });

    test('few-shot variant has examples', () => {
      const fewShot = PROMPT_VARIANTS[PromptVariantId.FEW_SHOT];
      expect(fewShot.entitySystemPrompt).toContain('EXAMPLES');
      expect(fewShot.entitySystemPrompt).toContain('Example 1');
      expect(fewShot.relationshipSystemPrompt).toContain('EXAMPLES');
    });

    test('chain-of-thought variant has reasoning instructions', () => {
      const cot = PROMPT_VARIANTS[PromptVariantId.CHAIN_OF_THOUGHT];
      expect(cot.entitySystemPrompt).toContain('EXTRACTION PROCESS');
      expect(cot.entitySystemPrompt).toContain('step-by-step');
      expect(cot.entitySystemPrompt).toContain('reasoning');
      expect(cot.parseEntityResponse).toBeDefined();
      expect(cot.parseRelationshipResponse).toBeDefined();
    });

    test('structured-guidelines variant has detailed definitions', () => {
      const structured = PROMPT_VARIANTS[PromptVariantId.STRUCTURED_GUIDELINES];
      expect(structured.entitySystemPrompt).toContain('ENTITY TYPES WITH DEFINITIONS');
      expect(structured.entitySystemPrompt).toContain('Process:');
      expect(structured.entitySystemPrompt).toContain('CRITICAL GUIDELINES');
      expect(structured.relationshipSystemPrompt).toContain('RELATIONSHIP TYPES WITH DEFINITIONS');
    });

    test('concise variant has minimal instructions', () => {
      const concise = PROMPT_VARIANTS[PromptVariantId.CONCISE];
      expect(concise.entitySystemPrompt.length).toBeLessThan(500);
      expect(concise.relationshipSystemPrompt.length).toBeLessThan(500);
    });
  });

  describe('getPromptVariant', () => {
    test('returns variant for valid ID', () => {
      const variant = getPromptVariant(PromptVariantId.BASELINE);
      expect(variant).toBeDefined();
      expect(variant.id).toBe(PromptVariantId.BASELINE);
    });

    test('returns null for invalid ID', () => {
      expect(getPromptVariant('invalid')).toBeNull();
      expect(getPromptVariant(undefined)).toBeNull();
    });
  });

  describe('getAllPromptVariants', () => {
    test('returns all variants', () => {
      const variants = getAllPromptVariants();
      expect(Object.keys(variants)).toHaveLength(5);
      expect(variants[PromptVariantId.BASELINE]).toBeDefined();
    });
  });

  describe('getPromptVariantList', () => {
    test('returns array of variant metadata', () => {
      const list = getPromptVariantList();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(5);

      for (const item of list) {
        expect(item.id).toBeDefined();
        expect(item.name).toBeDefined();
        expect(item.description).toBeDefined();
      }
    });
  });

  describe('isValidVariant', () => {
    test('returns true for valid variants', () => {
      expect(isValidVariant(PromptVariantId.BASELINE)).toBe(true);
      expect(isValidVariant(PromptVariantId.FEW_SHOT)).toBe(true);
    });

    test('returns false for invalid variants', () => {
      expect(isValidVariant('invalid')).toBe(false);
      expect(isValidVariant('')).toBe(false);
      expect(isValidVariant(null)).toBe(false);
    });
  });

  describe('ENTITY_TYPE_DEFINITIONS', () => {
    test('has definitions for all entity types', () => {
      const expectedTypes = [
        'Process', 'Task', 'Activity', 'Decision',
        'Role', 'Department', 'Stakeholder',
        'System', 'Application', 'Database',
        'Document', 'Form', 'Template',
        'Policy', 'Regulation', 'Standard',
        'Metric', 'KPI'
      ];

      for (const type of expectedTypes) {
        expect(ENTITY_TYPE_DEFINITIONS[type]).toBeDefined();
        expect(typeof ENTITY_TYPE_DEFINITIONS[type]).toBe('string');
      }
    });
  });

  describe('buildEntityPrompt', () => {
    test.each(Object.values(PromptVariantId))('variant %s builds entity prompt', (variantId) => {
      const variant = PROMPT_VARIANTS[variantId];
      const text = 'The Finance Manager reviews purchase orders.';
      const context = { title: 'Test Doc', section: 'Overview' };

      const prompt = variant.buildEntityPrompt(text, context);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('baseline includes context in prompt', () => {
      const variant = PROMPT_VARIANTS[PromptVariantId.BASELINE];
      const prompt = variant.buildEntityPrompt('Test text', { title: 'My Doc', section: 'Intro' });

      expect(prompt).toContain('My Doc');
      expect(prompt).toContain('Intro');
    });
  });

  describe('buildRelationshipPrompt', () => {
    const testEntities = [
      { name: 'Finance Manager', type: 'Role' },
      { name: 'Purchase Order', type: 'Document' }
    ];

    test.each(Object.values(PromptVariantId))('variant %s builds relationship prompt', (variantId) => {
      const variant = PROMPT_VARIANTS[variantId];
      const text = 'The Finance Manager reviews purchase orders.';

      const prompt = variant.buildRelationshipPrompt(text, testEntities);
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('prompts include entity names', () => {
      const variant = PROMPT_VARIANTS[PromptVariantId.BASELINE];
      const prompt = variant.buildRelationshipPrompt('Test text', testEntities);

      expect(prompt).toContain('Finance Manager');
      expect(prompt).toContain('Purchase Order');
    });
  });
});

describe('PromptTuningService', () => {
  let service;

  beforeEach(() => {
    service = new PromptTuningService();
    service._resetForTesting();
  });

  describe('getAvailableVariants', () => {
    test('returns all available variants', () => {
      const variants = service.getAvailableVariants();
      expect(variants).toHaveLength(5);
    });
  });

  describe('getVariantInfo', () => {
    test('returns variant info without full prompts', () => {
      const info = service.getVariantInfo(PromptVariantId.BASELINE);

      expect(info).toBeDefined();
      expect(info.id).toBe(PromptVariantId.BASELINE);
      expect(info.name).toBeDefined();
      expect(info.description).toBeDefined();
      expect(info.promptLength).toBeDefined();
      expect(info.promptLength.entitySystem).toBeGreaterThan(0);
      expect(info.entitySystemPrompt).toBeUndefined(); // Should not include full prompt
    });

    test('returns null for invalid variant', () => {
      expect(service.getVariantInfo('invalid')).toBeNull();
    });
  });

  describe('createExperiment', () => {
    test('creates experiment with default configuration', () => {
      const exp = service.createExperiment({ name: 'Test Experiment' });

      expect(exp).toBeDefined();
      expect(exp.id).toMatch(/^exp_/);
      expect(exp.name).toBe('Test Experiment');
      expect(exp.status).toBe(ExperimentStatus.DRAFT);
      expect(exp.variants).toHaveLength(2);
      expect(exp.variants).toContain(PromptVariantId.BASELINE);
      expect(exp.variants).toContain(PromptVariantId.FEW_SHOT);
    });

    test('creates experiment with custom variants', () => {
      const exp = service.createExperiment({
        name: 'Custom Variants',
        variants: [PromptVariantId.BASELINE, PromptVariantId.CHAIN_OF_THOUGHT, PromptVariantId.CONCISE]
      });

      expect(exp.variants).toHaveLength(3);
      expect(exp.variants).toContain(PromptVariantId.CHAIN_OF_THOUGHT);
    });

    test('creates experiment with custom allocation', () => {
      const allocation = {
        [PromptVariantId.BASELINE]: 70,
        [PromptVariantId.FEW_SHOT]: 30
      };
      const exp = service.createExperiment({
        name: 'Custom Allocation',
        allocation
      });

      expect(exp.allocation[PromptVariantId.BASELINE]).toBe(70);
      expect(exp.allocation[PromptVariantId.FEW_SHOT]).toBe(30);
    });

    test('calculates equal allocation when not provided', () => {
      const exp = service.createExperiment({
        name: 'Equal Allocation',
        variants: [PromptVariantId.BASELINE, PromptVariantId.FEW_SHOT, PromptVariantId.CONCISE]
      });

      // Should be 33, 33, 34 to sum to 100
      const values = Object.values(exp.allocation);
      expect(values.reduce((a, b) => a + b, 0)).toBe(100);
    });

    test('throws error for invalid variant', () => {
      expect(() => {
        service.createExperiment({
          name: 'Invalid',
          variants: ['invalid_variant']
        });
      }).toThrow('Invalid variant ID');
    });

    test('throws error for less than 2 variants', () => {
      expect(() => {
        service.createExperiment({
          name: 'Single Variant',
          variants: [PromptVariantId.BASELINE]
        });
      }).toThrow('at least 2 variants');
    });

    test('throws error for allocation not summing to 100', () => {
      expect(() => {
        service.createExperiment({
          name: 'Bad Allocation',
          allocation: {
            [PromptVariantId.BASELINE]: 60,
            [PromptVariantId.FEW_SHOT]: 30
          }
        });
      }).toThrow('sum to 100');
    });

    test('initializes results tracking for each variant', () => {
      const exp = service.createExperiment({ name: 'Test' });

      for (const variantId of exp.variants) {
        expect(exp.results[variantId]).toBeDefined();
        expect(exp.results[variantId].totalDocuments).toBe(0);
        expect(exp.results[variantId].totalEntities).toBe(0);
      }
    });
  });

  describe('Experiment Lifecycle', () => {
    let experimentId;

    beforeEach(() => {
      const exp = service.createExperiment({ name: 'Lifecycle Test' });
      experimentId = exp.id;
    });

    test('starts experiment', () => {
      const exp = service.startExperiment(experimentId);

      expect(exp.status).toBe(ExperimentStatus.RUNNING);
      expect(exp.startedAt).toBeDefined();
      expect(service.activeExperiment).toBe(experimentId);
    });

    test('cannot start already running experiment', () => {
      service.startExperiment(experimentId);

      expect(() => {
        service.startExperiment(experimentId);
      }).toThrow('already running');
    });

    test('cannot start experiment when another is running', () => {
      service.startExperiment(experimentId);

      const exp2 = service.createExperiment({ name: 'Second' });

      expect(() => {
        service.startExperiment(exp2.id);
      }).toThrow('Another experiment is already running');
    });

    test('pauses running experiment', () => {
      service.startExperiment(experimentId);
      const exp = service.pauseExperiment(experimentId);

      expect(exp.status).toBe(ExperimentStatus.PAUSED);
      expect(service.activeExperiment).toBeNull();
    });

    test('cannot pause non-running experiment', () => {
      expect(() => {
        service.pauseExperiment(experimentId);
      }).toThrow('Can only pause a running experiment');
    });

    test('completes experiment', () => {
      service.startExperiment(experimentId);
      const exp = service.completeExperiment(experimentId);

      expect(exp.status).toBe(ExperimentStatus.COMPLETED);
      expect(exp.completedAt).toBeDefined();
      expect(exp.finalAnalysis).toBeDefined();
      expect(service.activeExperiment).toBeNull();
    });

    test('cannot complete already completed experiment', () => {
      service.startExperiment(experimentId);
      service.completeExperiment(experimentId);

      expect(() => {
        service.completeExperiment(experimentId);
      }).toThrow('already completed');
    });

    test('cannot start completed experiment', () => {
      service.startExperiment(experimentId);
      service.completeExperiment(experimentId);

      expect(() => {
        service.startExperiment(experimentId);
      }).toThrow('Cannot start a completed experiment');
    });
  });

  describe('getExperiment', () => {
    test('returns experiment by ID', () => {
      const created = service.createExperiment({ name: 'Test' });
      const retrieved = service.getExperiment(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
    });

    test('returns null for unknown ID', () => {
      expect(service.getExperiment('unknown')).toBeNull();
    });
  });

  describe('listExperiments', () => {
    beforeEach(() => {
      service.createExperiment({ name: 'Draft 1' });
      const exp2 = service.createExperiment({ name: 'Running 1' });
      service.startExperiment(exp2.id);
      const exp3 = service.createExperiment({ name: 'Completed 1' });
      service.pauseExperiment(exp2.id);
      service.startExperiment(exp3.id);
      service.completeExperiment(exp3.id);
    });

    test('lists all experiments', () => {
      const experiments = service.listExperiments();
      expect(experiments).toHaveLength(3);
    });

    test('filters by status', () => {
      const draft = service.listExperiments({ status: ExperimentStatus.DRAFT });
      expect(draft).toHaveLength(1);
      expect(draft[0].name).toBe('Draft 1');

      const completed = service.listExperiments({ status: ExperimentStatus.COMPLETED });
      expect(completed).toHaveLength(1);
    });

    test('respects limit', () => {
      const experiments = service.listExperiments({ limit: 2 });
      expect(experiments).toHaveLength(2);
    });

    test('sorts by creation date descending', () => {
      const experiments = service.listExperiments();
      // Verify all experiments are returned and sorted (order may vary due to fast creation)
      expect(experiments).toHaveLength(3);
      // All dates should be defined
      for (const exp of experiments) {
        expect(exp.createdAt).toBeDefined();
      }
      // Verify sort order: each createdAt should be >= next one (newest first)
      for (let i = 0; i < experiments.length - 1; i++) {
        expect(new Date(experiments[i].createdAt).getTime())
          .toBeGreaterThanOrEqual(new Date(experiments[i + 1].createdAt).getTime());
      }
    });
  });

  describe('getActiveExperiment', () => {
    test('returns null when no experiment is active', () => {
      expect(service.getActiveExperiment()).toBeNull();
    });

    test('returns active experiment', () => {
      const exp = service.createExperiment({ name: 'Active Test' });
      service.startExperiment(exp.id);

      const active = service.getActiveExperiment();
      expect(active).toBeDefined();
      expect(active.id).toBe(exp.id);
    });
  });

  describe('deleteExperiment', () => {
    test('deletes draft experiment', () => {
      const exp = service.createExperiment({ name: 'To Delete' });
      service.deleteExperiment(exp.id);

      expect(service.getExperiment(exp.id)).toBeNull();
    });

    test('deletes completed experiment', () => {
      const exp = service.createExperiment({ name: 'To Delete' });
      service.startExperiment(exp.id);
      service.completeExperiment(exp.id);
      service.deleteExperiment(exp.id);

      expect(service.getExperiment(exp.id)).toBeNull();
    });

    test('cannot delete running experiment', () => {
      const exp = service.createExperiment({ name: 'Running' });
      service.startExperiment(exp.id);

      expect(() => {
        service.deleteExperiment(exp.id);
      }).toThrow('Cannot delete a running experiment');
    });

    test('throws error for unknown experiment', () => {
      expect(() => {
        service.deleteExperiment('unknown');
      }).toThrow('not found');
    });
  });

  describe('assignVariant', () => {
    test('returns baseline when no active experiment', () => {
      const variant = service.assignVariant('doc123');
      expect(variant).toBe(PromptVariantId.BASELINE);
    });

    test('assigns variant based on document ID hash', () => {
      const exp = service.createExperiment({
        name: 'Assignment Test',
        allocation: {
          [PromptVariantId.BASELINE]: 50,
          [PromptVariantId.FEW_SHOT]: 50
        }
      });
      service.startExperiment(exp.id);

      // Test deterministic assignment
      const variant1 = service.assignVariant('doc123');
      const variant2 = service.assignVariant('doc123');
      expect(variant1).toBe(variant2); // Same doc ID should get same variant

      // Different doc IDs may get different variants
      const assignments = {};
      for (let i = 0; i < 100; i++) {
        const v = service.assignVariant(`doc_${i}`);
        assignments[v] = (assignments[v] || 0) + 1;
      }

      // With 50/50 split, both should have some assignments
      expect(assignments[PromptVariantId.BASELINE]).toBeGreaterThan(0);
      expect(assignments[PromptVariantId.FEW_SHOT]).toBeGreaterThan(0);
    });
  });

  describe('recordExtractionResult', () => {
    let experimentId;

    beforeEach(() => {
      const exp = service.createExperiment({ name: 'Recording Test' });
      experimentId = exp.id;
      service.startExperiment(exp.id);
    });

    test('records extraction result', () => {
      service.recordExtractionResult({
        experimentId,
        documentId: 'doc1',
        variantId: PromptVariantId.BASELINE,
        entityResult: {
          entities: [{ name: 'Test', type: 'Process' }],
          latencyMs: 500
        },
        relationshipResult: {
          relationships: [],
          latencyMs: 200
        }
      });

      const exp = service.getExperiment(experimentId);
      const results = exp.results[PromptVariantId.BASELINE];

      expect(results.totalDocuments).toBe(1);
      expect(results.totalEntities).toBe(1);
      expect(results.avgEntityLatencyMs).toBe(500);
    });

    test('updates running averages', () => {
      service.recordExtractionResult({
        experimentId,
        documentId: 'doc1',
        variantId: PromptVariantId.BASELINE,
        entityResult: { entities: [{ name: 'E1' }], latencyMs: 100 },
        relationshipResult: { relationships: [], latencyMs: 50 }
      });

      service.recordExtractionResult({
        experimentId,
        documentId: 'doc2',
        variantId: PromptVariantId.BASELINE,
        entityResult: { entities: [{ name: 'E2' }, { name: 'E3' }], latencyMs: 200 },
        relationshipResult: { relationships: [{ from: 'E2', to: 'E3' }], latencyMs: 100 }
      });

      const exp = service.getExperiment(experimentId);
      const results = exp.results[PromptVariantId.BASELINE];

      expect(results.totalDocuments).toBe(2);
      expect(results.totalEntities).toBe(3);
      expect(results.avgEntitiesPerDoc).toBe(1.5);
      expect(results.avgEntityLatencyMs).toBe(150);
    });
  });

  describe('getExtractionResults', () => {
    let experimentId;

    beforeEach(() => {
      const exp = service.createExperiment({ name: 'Results Test' });
      experimentId = exp.id;
      service.startExperiment(exp.id);

      // Record some results
      for (let i = 0; i < 5; i++) {
        service.recordExtractionResult({
          experimentId,
          documentId: `doc${i}`,
          variantId: i % 2 === 0 ? PromptVariantId.BASELINE : PromptVariantId.FEW_SHOT,
          entityResult: { entities: [], latencyMs: 100 },
          relationshipResult: { relationships: [], latencyMs: 50 }
        });
      }
    });

    test('returns all results for experiment', () => {
      const results = service.getExtractionResults(experimentId);
      expect(results).toHaveLength(5);
    });

    test('filters by variant', () => {
      const results = service.getExtractionResults(experimentId, { variantId: PromptVariantId.BASELINE });
      expect(results).toHaveLength(3); // doc0, doc2, doc4
    });

    test('respects limit', () => {
      const results = service.getExtractionResults(experimentId, { limit: 2 });
      expect(results).toHaveLength(2);
    });
  });

  describe('analyzeExperiment', () => {
    let experimentId;

    beforeEach(() => {
      const exp = service.createExperiment({
        name: 'Analysis Test',
        primaryMetric: 'avgEntitiesPerDoc'
      });
      experimentId = exp.id;
      service.startExperiment(exp.id);

      // Record results for baseline (lower performance)
      for (let i = 0; i < 5; i++) {
        service.recordExtractionResult({
          experimentId,
          documentId: `baseline_${i}`,
          variantId: PromptVariantId.BASELINE,
          entityResult: { entities: [{ name: 'E1' }], latencyMs: 300 },
          relationshipResult: { relationships: [], latencyMs: 100 }
        });
      }

      // Record results for few_shot (better performance)
      for (let i = 0; i < 5; i++) {
        service.recordExtractionResult({
          experimentId,
          documentId: `fewshot_${i}`,
          variantId: PromptVariantId.FEW_SHOT,
          entityResult: { entities: [{ name: 'E1' }, { name: 'E2' }, { name: 'E3' }], latencyMs: 400 },
          relationshipResult: { relationships: [], latencyMs: 150 }
        });
      }
    });

    test('calculates metrics for each variant', () => {
      const analysis = service.analyzeExperiment(experimentId);

      expect(analysis.variantMetrics[PromptVariantId.BASELINE]).toBeDefined();
      expect(analysis.variantMetrics[PromptVariantId.FEW_SHOT]).toBeDefined();

      expect(analysis.variantMetrics[PromptVariantId.BASELINE].totalDocuments).toBe(5);
      expect(analysis.variantMetrics[PromptVariantId.FEW_SHOT].totalDocuments).toBe(5);
    });

    test('determines winner based on primary metric', () => {
      const analysis = service.analyzeExperiment(experimentId);

      // Few-shot has more entities per doc, so should win
      expect(analysis.winner).toBe(PromptVariantId.FEW_SHOT);
    });

    test('calculates improvement percentage', () => {
      const analysis = service.analyzeExperiment(experimentId);

      // Few-shot: 3 entities/doc, Baseline: 1 entity/doc
      // Improvement = (3-1)/1 * 100 = 200%
      expect(analysis.improvementPercent).toBe(200);
    });

    test('checks minimum samples', () => {
      const analysis = service.analyzeExperiment(experimentId);
      expect(analysis.hasMinSamples).toBe(false); // Default min is 10, we have 5
    });
  });

  describe('generateComparisonReport', () => {
    let experimentId;

    beforeEach(() => {
      const exp = service.createExperiment({ name: 'Report Test' });
      experimentId = exp.id;
      service.startExperiment(exp.id);

      service.recordExtractionResult({
        experimentId,
        documentId: 'doc1',
        variantId: PromptVariantId.BASELINE,
        entityResult: { entities: [{ name: 'E1' }], latencyMs: 100 },
        relationshipResult: { relationships: [], latencyMs: 50 }
      });
    });

    test('generates JSON report', () => {
      const report = service.generateComparisonReport(experimentId, 'json');

      expect(report.experiment).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.variants).toBeInstanceOf(Array);
      expect(report.generatedAt).toBeDefined();
    });

    test('generates markdown report', () => {
      const report = service.generateComparisonReport(experimentId, 'markdown');

      expect(typeof report).toBe('string');
      expect(report).toContain('# Prompt Tuning Experiment Report');
      expect(report).toContain('## Summary');
      expect(report).toContain('## Variant Comparison');
    });

    test('generates text report', () => {
      const report = service.generateComparisonReport(experimentId, 'text');

      expect(typeof report).toBe('string');
      expect(report).toContain('PROMPT TUNING EXPERIMENT REPORT');
      expect(report).toContain('SUMMARY');
    });
  });

  describe('getStats', () => {
    test('returns service statistics', () => {
      service.createExperiment({ name: 'Draft' });
      const exp2 = service.createExperiment({ name: 'Running' });
      service.startExperiment(exp2.id);

      const stats = service.getStats();

      expect(stats.totalExperiments).toBe(2);
      expect(stats.activeExperiment).toBe(exp2.id);
      expect(stats.experimentsByStatus.draft).toBe(1);
      expect(stats.experimentsByStatus.running).toBe(1);
      expect(stats.availableVariants).toBe(5);
    });
  });

  describe('Singleton', () => {
    test('getPromptTuningService returns singleton', () => {
      const service1 = getPromptTuningService();
      const service2 = getPromptTuningService();

      expect(service1).toBe(service2);
    });
  });
});

describe('ExperimentStatus', () => {
  test('defines all status values', () => {
    expect(ExperimentStatus.DRAFT).toBe('draft');
    expect(ExperimentStatus.RUNNING).toBe('running');
    expect(ExperimentStatus.PAUSED).toBe('paused');
    expect(ExperimentStatus.COMPLETED).toBe('completed');
    expect(ExperimentStatus.ARCHIVED).toBe('archived');
  });
});

describe('DEFAULT_EXPERIMENT_CONFIG', () => {
  test('has sensible defaults', () => {
    expect(DEFAULT_EXPERIMENT_CONFIG.minSamplesPerVariant).toBeGreaterThan(0);
    expect(DEFAULT_EXPERIMENT_CONFIG.maxDurationDays).toBeGreaterThan(0);
    expect(DEFAULT_EXPERIMENT_CONFIG.confidenceLevel).toBeGreaterThan(0);
    expect(DEFAULT_EXPERIMENT_CONFIG.confidenceLevel).toBeLessThanOrEqual(1);
    expect(DEFAULT_EXPERIMENT_CONFIG.primaryMetric).toBe('f1');
  });
});
