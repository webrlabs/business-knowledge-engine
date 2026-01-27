/**
 * Entity Ground Truth Dataset Tests
 *
 * Feature: F1.1.2 - Entity Ground Truth
 *
 * Tests for the annotated entity extraction ground truth dataset.
 * Validates dataset structure, coverage, and integration with the entity extraction evaluator.
 */

const path = require('path');
const fs = require('fs');

// Load the dataset
const datasetPath = path.join(__dirname, '../datasets/entity_ground_truth.json');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

// Import the entity extraction evaluator
const {
  evaluateEntityExtraction,
  evaluateBatchEntityExtraction,
  MatchingMode,
  normalizeName,
  calculateSimilarity
} = require('../entity-extraction-evaluator');

// Entity types from the extraction prompts
const ENTITY_TYPES = [
  'Process', 'Task', 'Activity', 'Decision', 'Role', 'Department', 'Stakeholder',
  'System', 'Application', 'Database', 'Document', 'Form', 'Template',
  'Policy', 'Regulation', 'Standard', 'Metric', 'KPI'
];

describe('Entity Ground Truth Dataset', () => {
  describe('Dataset Structure', () => {
    test('should have valid metadata', () => {
      expect(dataset.metadata).toBeDefined();
      expect(dataset.metadata.name).toBe('entity-ground-truth');
      expect(dataset.metadata.version).toBe('1.0.0');
      expect(dataset.metadata.featureId).toBe('F1.1.2');
      expect(dataset.metadata.purpose).toBe('entity_extraction_evaluation');
    });

    test('should have correct entity types list', () => {
      expect(dataset.metadata.entityTypes).toEqual(ENTITY_TYPES);
    });

    test('should have documents array', () => {
      expect(Array.isArray(dataset.documents)).toBe(true);
      expect(dataset.documents.length).toBeGreaterThan(0);
    });

    test('should have statistics section', () => {
      expect(dataset.statistics).toBeDefined();
      expect(dataset.statistics.entityTypeCounts).toBeDefined();
      expect(dataset.statistics.categoryDistribution).toBeDefined();
      expect(dataset.statistics.complexityDistribution).toBeDefined();
    });

    test('metadata totalDocuments should match actual count', () => {
      expect(dataset.metadata.totalDocuments).toBe(dataset.documents.length);
    });
  });

  describe('Document Structure', () => {
    test('each document should have required fields', () => {
      dataset.documents.forEach((doc, index) => {
        expect(doc.id).toBeDefined();
        expect(doc.title).toBeDefined();
        expect(doc.category).toBeDefined();
        expect(doc.complexity).toBeDefined();
        expect(doc.content).toBeDefined();
        expect(Array.isArray(doc.groundTruth)).toBe(true);
      });
    });

    test('each document should have unique id', () => {
      const ids = dataset.documents.map(d => d.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    test('document ids should follow naming convention', () => {
      dataset.documents.forEach(doc => {
        expect(doc.id).toMatch(/^egt-\d{3}$/);
      });
    });

    test('categories should be valid', () => {
      const validCategories = ['operational', 'technical', 'compliance', 'leadership', 'mixed'];
      dataset.documents.forEach(doc => {
        expect(validCategories).toContain(doc.category);
      });
    });

    test('complexity levels should be valid', () => {
      const validComplexity = ['simple', 'medium', 'complex'];
      dataset.documents.forEach(doc => {
        expect(validComplexity).toContain(doc.complexity);
      });
    });
  });

  describe('Ground Truth Entity Structure', () => {
    test('each ground truth entity should have required fields', () => {
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach((entity, idx) => {
          expect(entity.name).toBeDefined();
          expect(typeof entity.name).toBe('string');
          expect(entity.name.length).toBeGreaterThan(0);

          expect(entity.type).toBeDefined();
          expect(typeof entity.type).toBe('string');

          expect(entity.span).toBeDefined();
          expect(typeof entity.span).toBe('string');
        });
      });
    });

    test('entity types should be from the valid list', () => {
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(entity => {
          expect(ENTITY_TYPES).toContain(entity.type);
        });
      });
    });

    test('entity spans should appear in document content', () => {
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(entity => {
          // Span might be a slight variation - just verify it exists or is related
          const contentLower = doc.content.toLowerCase();
          const spanLower = entity.span.toLowerCase();
          const found = contentLower.includes(spanLower) ||
                        contentLower.includes(entity.name.toLowerCase());
          expect(found).toBe(true);
        });
      });
    });

    test('each document should have at least one entity', () => {
      dataset.documents.forEach(doc => {
        expect(doc.groundTruth.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Entity Type Coverage', () => {
    test('should cover all entity types', () => {
      const coveredTypes = new Set();
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(entity => {
          coveredTypes.add(entity.type);
        });
      });

      ENTITY_TYPES.forEach(type => {
        expect(coveredTypes.has(type)).toBe(true);
      });
    });

    test('should have reasonable distribution of entity types', () => {
      const counts = {};
      ENTITY_TYPES.forEach(type => counts[type] = 0);

      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(entity => {
          counts[entity.type]++;
        });
      });

      // Each type should appear at least once
      ENTITY_TYPES.forEach(type => {
        expect(counts[type]).toBeGreaterThan(0);
      });
    });

    test('statistics should match actual entity counts', () => {
      const actualCounts = {};
      ENTITY_TYPES.forEach(type => actualCounts[type] = 0);

      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(entity => {
          actualCounts[entity.type]++;
        });
      });

      Object.keys(dataset.statistics.entityTypeCounts).forEach(type => {
        expect(actualCounts[type]).toBe(dataset.statistics.entityTypeCounts[type]);
      });
    });
  });

  describe('Category Coverage', () => {
    test('should have documents in all categories', () => {
      const categories = new Set(dataset.documents.map(d => d.category));
      expect(categories.has('operational')).toBe(true);
      expect(categories.has('technical')).toBe(true);
      expect(categories.has('compliance')).toBe(true);
      expect(categories.has('leadership')).toBe(true);
    });

    test('statistics should match actual category counts', () => {
      const actualCounts = {};
      dataset.documents.forEach(doc => {
        actualCounts[doc.category] = (actualCounts[doc.category] || 0) + 1;
      });

      Object.keys(dataset.statistics.categoryDistribution).forEach(category => {
        expect(actualCounts[category]).toBe(dataset.statistics.categoryDistribution[category]);
      });
    });
  });

  describe('Complexity Coverage', () => {
    test('should have documents at all complexity levels', () => {
      const complexities = new Set(dataset.documents.map(d => d.complexity));
      expect(complexities.has('simple')).toBe(true);
      expect(complexities.has('medium')).toBe(true);
      expect(complexities.has('complex')).toBe(true);
    });

    test('statistics should match actual complexity counts', () => {
      const actualCounts = {};
      dataset.documents.forEach(doc => {
        actualCounts[doc.complexity] = (actualCounts[doc.complexity] || 0) + 1;
      });

      Object.keys(dataset.statistics.complexityDistribution).forEach(complexity => {
        expect(actualCounts[complexity]).toBe(dataset.statistics.complexityDistribution[complexity]);
      });
    });

    test('simple documents should have fewer entities than complex', () => {
      const simpleDocs = dataset.documents.filter(d => d.complexity === 'simple');
      const complexDocs = dataset.documents.filter(d => d.complexity === 'complex');

      const avgSimple = simpleDocs.reduce((sum, d) => sum + d.groundTruth.length, 0) / simpleDocs.length;
      const avgComplex = complexDocs.reduce((sum, d) => sum + d.groundTruth.length, 0) / complexDocs.length;

      expect(avgComplex).toBeGreaterThan(avgSimple);
    });
  });

  describe('Total Entity Count', () => {
    test('metadata totalEntities should match actual count', () => {
      let total = 0;
      dataset.documents.forEach(doc => {
        total += doc.groundTruth.length;
      });
      expect(dataset.metadata.totalEntities).toBe(total);
    });

    test('should have minimum number of entities for meaningful evaluation', () => {
      let total = 0;
      dataset.documents.forEach(doc => {
        total += doc.groundTruth.length;
      });
      // Should have at least 100 entities for statistical significance
      expect(total).toBeGreaterThanOrEqual(100);
    });
  });
});

describe('Entity Extraction Evaluator Integration', () => {
  describe('Single Document Evaluation', () => {
    test('should evaluate perfect extraction (100% match)', () => {
      const doc = dataset.documents[0];
      const extracted = doc.groundTruth.map(e => ({
        name: e.name,
        type: e.type,
        confidence: 0.9
      }));

      const result = evaluateEntityExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: MatchingMode.STRICT });

      expect(result.precision).toBe(1);
      expect(result.recall).toBe(1);
      expect(result.f1).toBe(1);
    });

    test('should evaluate partial extraction', () => {
      const doc = dataset.documents[0];
      // Extract only half the entities
      const halfCount = Math.floor(doc.groundTruth.length / 2);
      const extracted = doc.groundTruth.slice(0, halfCount).map(e => ({
        name: e.name,
        type: e.type,
        confidence: 0.9
      }));

      const result = evaluateEntityExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: MatchingMode.STRICT });

      expect(result.precision).toBe(1); // All extracted are correct
      expect(result.recall).toBeLessThan(1); // Missed some
      expect(result.truePositives).toBe(halfCount);
      expect(result.falseNegatives).toBeGreaterThan(0);
    });

    test('should evaluate with false positives', () => {
      const doc = dataset.documents[0];
      const extracted = [
        ...doc.groundTruth.map(e => ({ name: e.name, type: e.type, confidence: 0.9 })),
        { name: 'Fake Entity', type: 'Process', confidence: 0.7 },
        { name: 'Another Fake', type: 'System', confidence: 0.6 }
      ];

      const result = evaluateEntityExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: MatchingMode.STRICT });

      expect(result.recall).toBe(1); // Found all
      expect(result.precision).toBeLessThan(1); // Has false positives
      expect(result.falsePositives).toBe(2);
    });

    test('should evaluate with partial name matching', () => {
      const doc = dataset.documents[0];
      // Slightly modify entity names
      const extracted = doc.groundTruth.map(e => ({
        name: e.name + ' Process', // Add suffix
        type: e.type,
        confidence: 0.8
      }));

      const strictResult = evaluateEntityExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: MatchingMode.STRICT });

      const partialResult = evaluateEntityExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: MatchingMode.PARTIAL, similarityThreshold: 0.7 });

      // Partial matching should find more matches
      expect(partialResult.truePositives).toBeGreaterThanOrEqual(strictResult.truePositives);
    });
  });

  describe('Batch Evaluation', () => {
    test('should evaluate multiple documents', () => {
      const testDocs = dataset.documents.slice(0, 5);
      const items = testDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items, { mode: MatchingMode.STRICT });

      expect(result.documentCount).toBe(5);
      expect(result.aggregate.precision).toBe(1);
      expect(result.aggregate.recall).toBe(1);
      expect(result.aggregate.f1).toBe(1);
      expect(result.documents.length).toBe(5);
    });

    test('should calculate aggregate metrics across documents', () => {
      const testDocs = dataset.documents.slice(0, 3);
      const items = testDocs.map((doc, idx) => {
        // Extract different amounts from each doc
        const extractCount = Math.max(1, Math.floor(doc.groundTruth.length * (idx + 1) / 4));
        return {
          extracted: doc.groundTruth.slice(0, extractCount).map(e => ({
            name: e.name,
            type: e.type,
            confidence: 0.9
          })),
          groundTruth: doc.groundTruth
        };
      });

      const result = evaluateBatchEntityExtraction(items, { mode: MatchingMode.STRICT });

      expect(result.aggregate.precision).toBe(1);
      expect(result.aggregate.recall).toBeLessThan(1);
      expect(result.aggregate.truePositives).toBeGreaterThan(0);
      expect(result.aggregate.falseNegatives).toBeGreaterThan(0);
    });

    test('should provide per-type metrics', () => {
      const testDocs = dataset.documents.slice(0, 5);
      const items = testDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items, { mode: MatchingMode.STRICT });

      expect(result.aggregate.perTypeMetrics).toBeDefined();
      // Should have metrics for types that appear in the test docs
      expect(Object.keys(result.aggregate.perTypeMetrics).length).toBeGreaterThan(0);
    });
  });

  describe('Evaluation by Category', () => {
    test('should evaluate operational documents', () => {
      const opsDocs = dataset.documents.filter(d => d.category === 'operational');
      expect(opsDocs.length).toBeGreaterThan(0);

      const items = opsDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });

    test('should evaluate technical documents', () => {
      const techDocs = dataset.documents.filter(d => d.category === 'technical');
      expect(techDocs.length).toBeGreaterThan(0);

      const items = techDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });

    test('should evaluate compliance documents', () => {
      const compDocs = dataset.documents.filter(d => d.category === 'compliance');
      expect(compDocs.length).toBeGreaterThan(0);

      const items = compDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });

    test('should evaluate leadership documents', () => {
      const leadDocs = dataset.documents.filter(d => d.category === 'leadership');
      expect(leadDocs.length).toBeGreaterThan(0);

      const items = leadDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });
  });

  describe('Evaluation by Complexity', () => {
    test('should evaluate simple documents', () => {
      const simpleDocs = dataset.documents.filter(d => d.complexity === 'simple');
      expect(simpleDocs.length).toBeGreaterThan(0);

      const items = simpleDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items);
      expect(result.aggregate.totalGroundTruth).toBeGreaterThan(0);
    });

    test('should evaluate medium complexity documents', () => {
      const mediumDocs = dataset.documents.filter(d => d.complexity === 'medium');
      expect(mediumDocs.length).toBeGreaterThan(0);

      const items = mediumDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items);
      expect(result.aggregate.totalGroundTruth).toBeGreaterThan(0);
    });

    test('should evaluate complex documents', () => {
      const complexDocs = dataset.documents.filter(d => d.complexity === 'complex');
      expect(complexDocs.length).toBeGreaterThan(0);

      const items = complexDocs.map(doc => ({
        extracted: doc.groundTruth.map(e => ({
          name: e.name,
          type: e.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchEntityExtraction(items);
      expect(result.aggregate.totalGroundTruth).toBeGreaterThan(0);
    });
  });
});

describe('Dataset Quality Checks', () => {
  test('entity names should not be duplicated within a document', () => {
    dataset.documents.forEach(doc => {
      const names = doc.groundTruth.map(e => normalizeName(e.name));
      const uniqueNames = new Set(names);
      // Allow some duplicates for abbreviations (e.g., "GDPR" and "General Data Protection Regulation")
      // but flag if more than 20% are duplicates
      const duplicateRatio = 1 - (uniqueNames.size / names.length);
      expect(duplicateRatio).toBeLessThan(0.2);
    });
  });

  test('document content should be substantial', () => {
    dataset.documents.forEach(doc => {
      // Each document should have meaningful content
      expect(doc.content.length).toBeGreaterThan(100);
      // Should have multiple sentences
      const sentences = doc.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      expect(sentences.length).toBeGreaterThan(2);
    });
  });

  test('entity names should be properly capitalized', () => {
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(entity => {
        // Entity names should start with capital letter (Title Case)
        // Allow acronyms and special cases
        const firstChar = entity.name[0];
        expect(firstChar).toBe(firstChar.toUpperCase());
      });
    });
  });

  test('all entity types should have multiple examples', () => {
    const typeCounts = {};
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(entity => {
        typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1;
      });
    });

    // Each type should appear multiple times for statistical validity
    ENTITY_TYPES.forEach(type => {
      expect(typeCounts[type]).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('Dataset Helper Functions', () => {
  test('getDocumentsByCategory should filter correctly', () => {
    const getDocumentsByCategory = (category) =>
      dataset.documents.filter(d => d.category === category);

    const operational = getDocumentsByCategory('operational');
    expect(operational.every(d => d.category === 'operational')).toBe(true);

    const technical = getDocumentsByCategory('technical');
    expect(technical.every(d => d.category === 'technical')).toBe(true);
  });

  test('getDocumentsByComplexity should filter correctly', () => {
    const getDocumentsByComplexity = (complexity) =>
      dataset.documents.filter(d => d.complexity === complexity);

    const simple = getDocumentsByComplexity('simple');
    expect(simple.every(d => d.complexity === 'simple')).toBe(true);

    const complex = getDocumentsByComplexity('complex');
    expect(complex.every(d => d.complexity === 'complex')).toBe(true);
  });

  test('getEntitiesByType should aggregate correctly', () => {
    const getEntitiesByType = (type) => {
      const entities = [];
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(e => {
          if (e.type === type) {
            entities.push({ ...e, documentId: doc.id });
          }
        });
      });
      return entities;
    };

    const processes = getEntitiesByType('Process');
    expect(processes.every(e => e.type === 'Process')).toBe(true);
    expect(processes.length).toBe(dataset.statistics.entityTypeCounts.Process);
  });

  test('getTotalEntityCount should match metadata', () => {
    const getTotalEntityCount = () =>
      dataset.documents.reduce((sum, doc) => sum + doc.groundTruth.length, 0);

    expect(getTotalEntityCount()).toBe(dataset.metadata.totalEntities);
  });
});
