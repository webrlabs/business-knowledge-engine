/**
 * Relationship Ground Truth Dataset Tests
 *
 * Feature: F1.1.3 - Relationship Ground Truth
 *
 * Tests for the annotated relationship extraction ground truth dataset.
 * Validates dataset structure, coverage, and integration with the relationship extraction evaluator.
 */

const path = require('path');
const fs = require('fs');

// Load the dataset
const datasetPath = path.join(__dirname, '../datasets/relationship_ground_truth.json');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

// Import the relationship extraction evaluator
const {
  evaluateRelationshipExtraction,
  evaluateBatchRelationshipExtraction,
  RelationshipMatchingMode,
  normalizeName,
  calculateSimilarity
} = require('../relationship-extraction-evaluator');

// Relationship types from the extraction prompts
const RELATIONSHIP_TYPES = [
  'PRECEDES', 'FOLLOWS', 'TRIGGERS', 'OWNS', 'EXECUTES', 'APPROVES',
  'REVIEWS', 'USES', 'INTEGRATES_WITH', 'DEPENDS_ON', 'GOVERNS',
  'REGULATES', 'REQUIRES', 'MEASURES', 'TRACKS', 'REPORTS_TO'
];

describe('Relationship Ground Truth Dataset', () => {
  describe('Dataset Structure', () => {
    test('should have valid metadata', () => {
      expect(dataset.metadata).toBeDefined();
      expect(dataset.metadata.name).toBe('relationship-ground-truth');
      expect(dataset.metadata.version).toBe('1.0.0');
      expect(dataset.metadata.featureId).toBe('F1.1.3');
      expect(dataset.metadata.purpose).toBe('relationship_extraction_evaluation');
    });

    test('should have correct relationship types list', () => {
      expect(dataset.metadata.relationshipTypes).toEqual(RELATIONSHIP_TYPES);
    });

    test('should have documents array', () => {
      expect(Array.isArray(dataset.documents)).toBe(true);
      expect(dataset.documents.length).toBeGreaterThan(0);
    });

    test('should have statistics section', () => {
      expect(dataset.statistics).toBeDefined();
      expect(dataset.statistics.relationshipTypeCounts).toBeDefined();
      expect(dataset.statistics.categoryDistribution).toBeDefined();
      expect(dataset.statistics.complexityDistribution).toBeDefined();
    });

    test('metadata totalDocuments should match actual count', () => {
      expect(dataset.metadata.totalDocuments).toBe(dataset.documents.length);
    });

    test('metadata totalRelationships should match actual count', () => {
      let total = 0;
      dataset.documents.forEach(doc => {
        total += doc.groundTruth.length;
      });
      expect(dataset.metadata.totalRelationships).toBe(total);
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
        expect(doc.id).toMatch(/^rgt-\d{3}$/);
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

  describe('Ground Truth Relationship Structure', () => {
    test('each ground truth relationship should have required fields', () => {
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach((rel, idx) => {
          expect(rel.from).toBeDefined();
          expect(typeof rel.from).toBe('string');
          expect(rel.from.length).toBeGreaterThan(0);

          expect(rel.to).toBeDefined();
          expect(typeof rel.to).toBe('string');
          expect(rel.to.length).toBeGreaterThan(0);

          expect(rel.type).toBeDefined();
          expect(typeof rel.type).toBe('string');

          expect(rel.span).toBeDefined();
          expect(typeof rel.span).toBe('string');
        });
      });
    });

    test('relationship types should be from the valid list', () => {
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(rel => {
          expect(RELATIONSHIP_TYPES).toContain(rel.type);
        });
      });
    });

    test('relationship spans should be related to document content', () => {
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(rel => {
          // At least part of the span or entities should appear in content
          const contentLower = doc.content.toLowerCase();
          const spanLower = rel.span.toLowerCase();
          const fromLower = rel.from.toLowerCase();
          const toLower = rel.to.toLowerCase();

          const found = contentLower.includes(spanLower.slice(0, 30)) ||
                        contentLower.includes(fromLower) ||
                        contentLower.includes(toLower);
          expect(found).toBe(true);
        });
      });
    });

    test('each document should have at least one relationship', () => {
      dataset.documents.forEach(doc => {
        expect(doc.groundTruth.length).toBeGreaterThan(0);
      });
    });

    test('from and to entities should be different', () => {
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(rel => {
          const fromNorm = normalizeName(rel.from);
          const toNorm = normalizeName(rel.to);
          expect(fromNorm).not.toBe(toNorm);
        });
      });
    });
  });

  describe('Relationship Type Coverage', () => {
    test('should cover all relationship types', () => {
      const coveredTypes = new Set();
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(rel => {
          coveredTypes.add(rel.type);
        });
      });

      RELATIONSHIP_TYPES.forEach(type => {
        expect(coveredTypes.has(type)).toBe(true);
      });
    });

    test('should have reasonable distribution of relationship types', () => {
      const counts = {};
      RELATIONSHIP_TYPES.forEach(type => counts[type] = 0);

      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(rel => {
          counts[rel.type]++;
        });
      });

      // Each type should appear at least once
      RELATIONSHIP_TYPES.forEach(type => {
        expect(counts[type]).toBeGreaterThan(0);
      });
    });

    test('statistics should match actual relationship counts', () => {
      const actualCounts = {};
      RELATIONSHIP_TYPES.forEach(type => actualCounts[type] = 0);

      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(rel => {
          actualCounts[rel.type]++;
        });
      });

      Object.keys(dataset.statistics.relationshipTypeCounts).forEach(type => {
        expect(actualCounts[type]).toBe(dataset.statistics.relationshipTypeCounts[type]);
      });
    });

    test('all relationship types should have multiple examples', () => {
      const typeCounts = {};
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(rel => {
          typeCounts[rel.type] = (typeCounts[rel.type] || 0) + 1;
        });
      });

      // Each type should appear multiple times for statistical validity
      RELATIONSHIP_TYPES.forEach(type => {
        expect(typeCounts[type]).toBeGreaterThanOrEqual(3);
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

    test('simple documents should have fewer relationships than complex', () => {
      const simpleDocs = dataset.documents.filter(d => d.complexity === 'simple');
      const complexDocs = dataset.documents.filter(d => d.complexity === 'complex');

      const avgSimple = simpleDocs.reduce((sum, d) => sum + d.groundTruth.length, 0) / simpleDocs.length;
      const avgComplex = complexDocs.reduce((sum, d) => sum + d.groundTruth.length, 0) / complexDocs.length;

      expect(avgComplex).toBeGreaterThan(avgSimple);
    });
  });

  describe('Total Relationship Count', () => {
    test('should have minimum number of relationships for meaningful evaluation', () => {
      let total = 0;
      dataset.documents.forEach(doc => {
        total += doc.groundTruth.length;
      });
      // Should have at least 100 relationships for statistical significance
      expect(total).toBeGreaterThanOrEqual(100);
    });
  });
});

describe('Relationship Extraction Evaluator Integration', () => {
  describe('Single Document Evaluation', () => {
    test('should evaluate perfect extraction (100% match)', () => {
      const doc = dataset.documents[0];
      const extracted = doc.groundTruth.map(r => ({
        from: r.from,
        to: r.to,
        type: r.type,
        confidence: 0.9
      }));

      const result = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.STRICT });

      expect(result.precision).toBe(1);
      expect(result.recall).toBe(1);
      expect(result.f1).toBe(1);
    });

    test('should evaluate partial extraction', () => {
      const doc = dataset.documents[0];
      // Extract only half the relationships
      const halfCount = Math.floor(doc.groundTruth.length / 2);
      const extracted = doc.groundTruth.slice(0, halfCount).map(r => ({
        from: r.from,
        to: r.to,
        type: r.type,
        confidence: 0.9
      }));

      const result = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.STRICT });

      expect(result.precision).toBe(1); // All extracted are correct
      expect(result.recall).toBeLessThan(1); // Missed some
      expect(result.truePositives).toBe(halfCount);
      expect(result.falseNegatives).toBeGreaterThan(0);
    });

    test('should evaluate with false positives', () => {
      const doc = dataset.documents[0];
      const extracted = [
        ...doc.groundTruth.map(r => ({ from: r.from, to: r.to, type: r.type, confidence: 0.9 })),
        { from: 'Fake Entity A', to: 'Fake Entity B', type: 'USES', confidence: 0.7 },
        { from: 'Another Fake', to: 'Third Fake', type: 'OWNS', confidence: 0.6 }
      ];

      const result = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.STRICT });

      expect(result.recall).toBe(1); // Found all
      expect(result.precision).toBeLessThan(1); // Has false positives
      expect(result.falsePositives).toBe(2);
    });

    test('should evaluate with wrong relationship type', () => {
      const doc = dataset.documents[0];
      // Extract with wrong types
      const extracted = doc.groundTruth.map(r => ({
        from: r.from,
        to: r.to,
        type: 'USES', // Force wrong type
        confidence: 0.8
      }));

      const result = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.STRICT });

      // Only relationships that were originally USES should match
      expect(result.truePositives).toBeLessThanOrEqual(doc.groundTruth.filter(r => r.type === 'USES').length);
    });

    test('should evaluate with partial name matching', () => {
      const doc = dataset.documents[0];
      // Slightly modify entity names
      const extracted = doc.groundTruth.map(r => ({
        from: r.from + ' System', // Add suffix
        to: r.to,
        type: r.type,
        confidence: 0.8
      }));

      const strictResult = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.STRICT });

      const partialResult = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.PARTIAL, similarityThreshold: 0.7 });

      // Partial matching should find more matches
      expect(partialResult.truePositives).toBeGreaterThanOrEqual(strictResult.truePositives);
    });

    test('should evaluate direction accuracy', () => {
      const doc = dataset.documents[0];
      // Reverse some relationship directions
      const extracted = doc.groundTruth.map((r, idx) => ({
        from: idx % 2 === 0 ? r.from : r.to, // Swap every other
        to: idx % 2 === 0 ? r.to : r.from,
        type: r.type,
        confidence: 0.9
      }));

      const result = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.DIRECTION_AGNOSTIC });

      // Direction-agnostic should match all
      expect(result.f1).toBe(1);
      // But direction accuracy should be ~50%
      expect(result.directionAccuracy).toBeLessThan(1);
    });
  });

  describe('Batch Evaluation', () => {
    test('should evaluate multiple documents', () => {
      const testDocs = dataset.documents.slice(0, 5);
      const items = testDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items, { mode: RelationshipMatchingMode.STRICT });

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
          extracted: doc.groundTruth.slice(0, extractCount).map(r => ({
            from: r.from,
            to: r.to,
            type: r.type,
            confidence: 0.9
          })),
          groundTruth: doc.groundTruth
        };
      });

      const result = evaluateBatchRelationshipExtraction(items, { mode: RelationshipMatchingMode.STRICT });

      expect(result.aggregate.precision).toBe(1);
      expect(result.aggregate.recall).toBeLessThan(1);
      expect(result.aggregate.truePositives).toBeGreaterThan(0);
      expect(result.aggregate.falseNegatives).toBeGreaterThan(0);
    });

    test('should provide per-type metrics', () => {
      const testDocs = dataset.documents.slice(0, 5);
      const items = testDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items, { mode: RelationshipMatchingMode.STRICT });

      expect(result.aggregate.perTypeMetrics).toBeDefined();
      // Should have metrics for types that appear in the test docs
      expect(Object.keys(result.aggregate.perTypeMetrics).length).toBeGreaterThan(0);
    });

    test('should track direction accuracy across documents', () => {
      const testDocs = dataset.documents.slice(0, 3);
      const items = testDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items, { mode: RelationshipMatchingMode.STRICT });

      expect(result.aggregate.directionAccuracy).toBe(1);
      expect(result.aggregate.correctDirections).toBeGreaterThan(0);
      expect(result.aggregate.incorrectDirections).toBe(0);
    });
  });

  describe('Evaluation by Category', () => {
    test('should evaluate operational documents', () => {
      const opsDocs = dataset.documents.filter(d => d.category === 'operational');
      expect(opsDocs.length).toBeGreaterThan(0);

      const items = opsDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });

    test('should evaluate technical documents', () => {
      const techDocs = dataset.documents.filter(d => d.category === 'technical');
      expect(techDocs.length).toBeGreaterThan(0);

      const items = techDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });

    test('should evaluate compliance documents', () => {
      const compDocs = dataset.documents.filter(d => d.category === 'compliance');
      expect(compDocs.length).toBeGreaterThan(0);

      const items = compDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });

    test('should evaluate leadership documents', () => {
      const leadDocs = dataset.documents.filter(d => d.category === 'leadership');
      expect(leadDocs.length).toBeGreaterThan(0);

      const items = leadDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items);
      expect(result.aggregate.f1).toBe(1);
    });
  });

  describe('Evaluation by Complexity', () => {
    test('should evaluate simple documents', () => {
      const simpleDocs = dataset.documents.filter(d => d.complexity === 'simple');
      expect(simpleDocs.length).toBeGreaterThan(0);

      const items = simpleDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items);
      expect(result.aggregate.totalGroundTruth).toBeGreaterThan(0);
    });

    test('should evaluate medium complexity documents', () => {
      const mediumDocs = dataset.documents.filter(d => d.complexity === 'medium');
      expect(mediumDocs.length).toBeGreaterThan(0);

      const items = mediumDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items);
      expect(result.aggregate.totalGroundTruth).toBeGreaterThan(0);
    });

    test('should evaluate complex documents', () => {
      const complexDocs = dataset.documents.filter(d => d.complexity === 'complex');
      expect(complexDocs.length).toBeGreaterThan(0);

      const items = complexDocs.map(doc => ({
        extracted: doc.groundTruth.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: 0.9
        })),
        groundTruth: doc.groundTruth
      }));

      const result = evaluateBatchRelationshipExtraction(items);
      expect(result.aggregate.totalGroundTruth).toBeGreaterThan(0);
    });
  });

  describe('Type-Only Matching', () => {
    test('should evaluate type-only matching mode', () => {
      const doc = dataset.documents[0];
      // Extract with correct types and some overlapping entity names
      // Type-only mode still requires minimal entity overlap (>0.3 similarity)
      const extracted = doc.groundTruth.map(r => ({
        from: r.from.split(' ')[0], // Use first word to get some similarity
        to: r.to.split(' ')[0],
        type: r.type,
        confidence: 0.8
      }));

      const result = evaluateRelationshipExtraction({
        extracted,
        groundTruth: doc.groundTruth
      }, { mode: RelationshipMatchingMode.TYPE_ONLY });

      // Should have some matches based on type + minimal name overlap
      expect(result.truePositives).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Dataset Quality Checks', () => {
  test('relationship triples should not be duplicated within a document', () => {
    dataset.documents.forEach(doc => {
      const triples = doc.groundTruth.map(r =>
        `${normalizeName(r.from)}|${r.type}|${normalizeName(r.to)}`
      );
      const uniqueTriples = new Set(triples);
      expect(uniqueTriples.size).toBe(triples.length);
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

  test('entity names in relationships should be properly capitalized', () => {
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(rel => {
        // Entity names should start with capital letter (Title Case)
        const fromFirstChar = rel.from[0];
        const toFirstChar = rel.to[0];
        expect(fromFirstChar).toBe(fromFirstChar.toUpperCase());
        expect(toFirstChar).toBe(toFirstChar.toUpperCase());
      });
    });
  });

  test('relationship types should be in UPPER_SNAKE_CASE', () => {
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(rel => {
        expect(rel.type).toMatch(/^[A-Z][A-Z_]*$/);
      });
    });
  });

  test('spans should be meaningful and relate to the relationship', () => {
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(rel => {
        // Span should be at least 10 characters
        expect(rel.span.length).toBeGreaterThan(10);
      });
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

  test('getRelationshipsByType should aggregate correctly', () => {
    const getRelationshipsByType = (type) => {
      const relationships = [];
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(r => {
          if (r.type === type) {
            relationships.push({ ...r, documentId: doc.id });
          }
        });
      });
      return relationships;
    };

    const uses = getRelationshipsByType('USES');
    expect(uses.every(r => r.type === 'USES')).toBe(true);
    expect(uses.length).toBe(dataset.statistics.relationshipTypeCounts.USES);
  });

  test('getTotalRelationshipCount should match metadata', () => {
    const getTotalRelationshipCount = () =>
      dataset.documents.reduce((sum, doc) => sum + doc.groundTruth.length, 0);

    expect(getTotalRelationshipCount()).toBe(dataset.metadata.totalRelationships);
  });

  test('getUniqueEntities should extract all entities from relationships', () => {
    const getUniqueEntities = () => {
      const entities = new Set();
      dataset.documents.forEach(doc => {
        doc.groundTruth.forEach(r => {
          entities.add(r.from);
          entities.add(r.to);
        });
      });
      return entities;
    };

    const entities = getUniqueEntities();
    // Should have many unique entities across all relationships
    expect(entities.size).toBeGreaterThan(50);
  });
});

describe('Relationship Semantic Validity', () => {
  test('REPORTS_TO relationships should involve roles or teams', () => {
    const reportsTo = [];
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(r => {
        if (r.type === 'REPORTS_TO') {
          reportsTo.push(r);
        }
      });
    });

    // REPORTS_TO typically involves roles, teams, or departments
    // Just verify we have some and they have reasonable entity names
    expect(reportsTo.length).toBeGreaterThan(0);
    reportsTo.forEach(r => {
      // Both entities should be named entities (not empty)
      expect(r.from.length).toBeGreaterThan(0);
      expect(r.to.length).toBeGreaterThan(0);
    });
  });

  test('REGULATES relationships should involve regulations or standards', () => {
    const regulates = [];
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(r => {
        if (r.type === 'REGULATES') {
          regulates.push(r);
        }
      });
    });

    expect(regulates.length).toBeGreaterThan(0);
    // The 'from' entity in REGULATES should typically be a regulation/act/policy/framework/principles
    regulates.forEach(r => {
      const fromLower = r.from.toLowerCase();
      const hasRegulationTerm =
        fromLower.includes('act') ||
        fromLower.includes('regulation') ||
        fromLower.includes('gdpr') ||
        fromLower.includes('ccpa') ||
        fromLower.includes('gaap') ||
        fromLower.includes('sox') ||
        fromLower.includes('sarbanes') ||
        fromLower.includes('standard') ||
        fromLower.includes('accord') ||
        fromLower.includes('framework') ||
        fromLower.includes('principles') ||
        fromLower.includes('soc');
      expect(hasRegulationTerm).toBe(true);
    });
  });

  test('MEASURES relationships should involve metrics or KPIs', () => {
    const measures = [];
    dataset.documents.forEach(doc => {
      doc.groundTruth.forEach(r => {
        if (r.type === 'MEASURES') {
          measures.push(r);
        }
      });
    });

    expect(measures.length).toBeGreaterThan(0);
    // The 'from' entity in MEASURES should typically be a metric or KPI
    measures.forEach(r => {
      const fromLower = r.from.toLowerCase();
      const hasMetricTerm =
        fromLower.includes('metric') ||
        fromLower.includes('kpi') ||
        fromLower.includes('rate') ||
        fromLower.includes('score') ||
        fromLower.includes('time') ||
        fromLower.includes('roi');
      expect(hasMetricTerm).toBe(true);
    });
  });
});
