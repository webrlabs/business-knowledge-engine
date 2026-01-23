/**
 * Unit tests for Entity Extraction Evaluator
 * Feature: F1.2.5
 */

const {
  evaluateEntityExtraction,
  evaluateBatchEntityExtraction,
  formatEntityEvaluation,
  formatBatchEntityEvaluation,
  MatchingMode,
  normalizeName,
  calculateSimilarity,
  entitiesMatch,
  calculateMetrics,
  DEFAULT_SIMILARITY_THRESHOLD
} = require('../entity-extraction-evaluator');

describe('Entity Extraction Evaluator', () => {
  describe('normalizeName', () => {
    it('should lowercase and trim names', () => {
      expect(normalizeName('  Purchase Order Process  ')).toBe('purchase order process');
    });

    it('should remove articles', () => {
      expect(normalizeName('The Purchase Order')).toBe('purchase order');
      expect(normalizeName('A Decision Point')).toBe('decision point');
      expect(normalizeName('An Application')).toBe('application');
    });

    it('should collapse whitespace', () => {
      expect(normalizeName('Purchase   Order    Process')).toBe('purchase order process');
    });

    it('should remove punctuation', () => {
      expect(normalizeName('Purchase-Order (Process)')).toBe('purchaseorder process');
    });

    it('should handle empty/null inputs', () => {
      expect(normalizeName('')).toBe('');
      expect(normalizeName(null)).toBe('');
      expect(normalizeName(undefined)).toBe('');
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1.0 for identical strings', () => {
      expect(calculateSimilarity('Purchase Order', 'Purchase Order')).toBe(1);
    });

    it('should return 1.0 for strings that normalize to the same value', () => {
      expect(calculateSimilarity('The Purchase Order', 'purchase order')).toBe(1);
    });

    it('should return high similarity for minor differences', () => {
      const similarity = calculateSimilarity('Purchase Order Process', 'Purchase Order Proces');
      expect(similarity).toBeGreaterThan(0.9);
    });

    it('should return low similarity for very different strings', () => {
      const similarity = calculateSimilarity('Purchase Order', 'Invoice System');
      expect(similarity).toBeLessThan(0.5);
    });

    it('should return 0 for empty inputs', () => {
      expect(calculateSimilarity('', 'test')).toBe(0);
      expect(calculateSimilarity('test', '')).toBe(0);
      expect(calculateSimilarity(null, 'test')).toBe(0);
    });
  });

  describe('entitiesMatch', () => {
    const extractedEntity = { name: 'Purchase Order Process', type: 'Process' };
    const groundTruthExact = { name: 'Purchase Order Process', type: 'Process' };
    const groundTruthSimilar = { name: 'Purchase Order Proces', type: 'Process' };
    const groundTruthDifferentType = { name: 'Purchase Order Process', type: 'Task' };
    const groundTruthDifferentName = { name: 'Invoice Processing', type: 'Process' };

    describe('STRICT mode', () => {
      it('should match entities with exact name and type', () => {
        const result = entitiesMatch(extractedEntity, groundTruthExact, MatchingMode.STRICT);
        expect(result.matches).toBe(true);
        expect(result.typeMatch).toBe(true);
        expect(result.similarity).toBe(1);
      });

      it('should not match entities with different type', () => {
        const result = entitiesMatch(extractedEntity, groundTruthDifferentType, MatchingMode.STRICT);
        expect(result.matches).toBe(false);
        expect(result.typeMatch).toBe(false);
      });

      it('should not match entities with similar but not exact name', () => {
        const result = entitiesMatch(extractedEntity, groundTruthSimilar, MatchingMode.STRICT);
        expect(result.matches).toBe(false);
        expect(result.similarity).toBeGreaterThan(0.9);
      });
    });

    describe('PARTIAL mode', () => {
      it('should match entities with similar name and same type', () => {
        const result = entitiesMatch(extractedEntity, groundTruthSimilar, MatchingMode.PARTIAL);
        expect(result.matches).toBe(true);
        expect(result.typeMatch).toBe(true);
      });

      it('should not match entities with very different names', () => {
        const result = entitiesMatch(extractedEntity, groundTruthDifferentName, MatchingMode.PARTIAL);
        expect(result.matches).toBe(false);
      });

      it('should respect custom threshold', () => {
        const result = entitiesMatch(extractedEntity, groundTruthSimilar, MatchingMode.PARTIAL, 0.99);
        expect(result.matches).toBe(false); // Similarity is ~0.96, below 0.99
      });
    });

    describe('TYPE_ONLY mode', () => {
      it('should match entities with same type and some name overlap', () => {
        const result = entitiesMatch(extractedEntity, groundTruthSimilar, MatchingMode.TYPE_ONLY);
        expect(result.matches).toBe(true);
        expect(result.typeMatch).toBe(true);
      });

      it('should not match entities with different type', () => {
        const result = entitiesMatch(extractedEntity, groundTruthDifferentType, MatchingMode.TYPE_ONLY);
        expect(result.matches).toBe(false);
      });
    });
  });

  describe('calculateMetrics', () => {
    it('should calculate precision correctly', () => {
      const metrics = calculateMetrics(8, 2, 0); // 8 TP, 2 FP
      expect(metrics.precision).toBe(0.8); // 8 / (8 + 2)
    });

    it('should calculate recall correctly', () => {
      const metrics = calculateMetrics(8, 0, 2); // 8 TP, 2 FN
      expect(metrics.recall).toBe(0.8); // 8 / (8 + 2)
    });

    it('should calculate F1 correctly', () => {
      const metrics = calculateMetrics(8, 2, 2); // P = 0.8, R = 0.8
      expect(metrics.f1).toBeCloseTo(0.8, 5); // 2 * 0.8 * 0.8 / (0.8 + 0.8)
    });

    it('should return 0 when TP + FP is 0', () => {
      const metrics = calculateMetrics(0, 0, 5);
      expect(metrics.precision).toBe(0);
    });

    it('should return 0 when TP + FN is 0', () => {
      const metrics = calculateMetrics(0, 5, 0);
      expect(metrics.recall).toBe(0);
    });

    it('should return 0 F1 when precision and recall are 0', () => {
      const metrics = calculateMetrics(0, 0, 0);
      expect(metrics.f1).toBe(0);
    });
  });

  describe('evaluateEntityExtraction', () => {
    const groundTruth = [
      { name: 'Purchase Order Process', type: 'Process' },
      { name: 'Finance Department', type: 'Department' },
      { name: 'Invoice Approval', type: 'Task' },
      { name: 'SAP ERP', type: 'System' }
    ];

    describe('perfect extraction', () => {
      it('should return all 1.0 metrics for perfect match', () => {
        const extracted = [...groundTruth];
        const result = evaluateEntityExtraction({ extracted, groundTruth });

        expect(result.precision).toBe(1);
        expect(result.recall).toBe(1);
        expect(result.f1).toBe(1);
        expect(result.truePositives).toBe(4);
        expect(result.falsePositives).toBe(0);
        expect(result.falseNegatives).toBe(0);
      });
    });

    describe('partial extraction', () => {
      it('should handle extraction with missing entities', () => {
        const extracted = [
          { name: 'Purchase Order Process', type: 'Process' },
          { name: 'Finance Department', type: 'Department' }
        ];
        const result = evaluateEntityExtraction({ extracted, groundTruth });

        expect(result.truePositives).toBe(2);
        expect(result.falsePositives).toBe(0);
        expect(result.falseNegatives).toBe(2);
        expect(result.precision).toBe(1); // 2/2
        expect(result.recall).toBe(0.5); // 2/4
      });

      it('should handle extraction with extra entities', () => {
        const extracted = [
          ...groundTruth,
          { name: 'Extra Entity', type: 'Process' }
        ];
        const result = evaluateEntityExtraction({ extracted, groundTruth });

        expect(result.truePositives).toBe(4);
        expect(result.falsePositives).toBe(1);
        expect(result.falseNegatives).toBe(0);
        expect(result.precision).toBe(0.8); // 4/5
        expect(result.recall).toBe(1); // 4/4
      });
    });

    describe('no matches', () => {
      it('should return zeros when no matches found', () => {
        const extracted = [
          { name: 'Completely Different', type: 'Role' },
          { name: 'Another One', type: 'Application' }
        ];
        const result = evaluateEntityExtraction({ extracted, groundTruth });

        expect(result.truePositives).toBe(0);
        expect(result.falsePositives).toBe(2);
        expect(result.falseNegatives).toBe(4);
        expect(result.precision).toBe(0);
        expect(result.recall).toBe(0);
        expect(result.f1).toBe(0);
      });
    });

    describe('per-type metrics', () => {
      it('should calculate per-type metrics correctly', () => {
        const extracted = [
          { name: 'Purchase Order Process', type: 'Process' },
          { name: 'Wrong Process', type: 'Process' } // False positive
        ];
        const result = evaluateEntityExtraction({ extracted, groundTruth });

        expect(result.perTypeMetrics['Process']).toBeDefined();
        expect(result.perTypeMetrics['Process'].truePositives).toBe(1);
        expect(result.perTypeMetrics['Process'].falsePositives).toBe(1);
        expect(result.perTypeMetrics['Process'].precision).toBe(0.5);
      });
    });

    describe('matching modes', () => {
      const gtWithTypo = [
        { name: 'Purchase Ordr Process', type: 'Process' } // Typo in "Order"
      ];

      it('should fail strict match with typos', () => {
        const extracted = [{ name: 'Purchase Order Process', type: 'Process' }];
        const result = evaluateEntityExtraction(
          { extracted, groundTruth: gtWithTypo },
          { mode: MatchingMode.STRICT }
        );

        expect(result.truePositives).toBe(0);
      });

      it('should pass partial match with typos', () => {
        const extracted = [{ name: 'Purchase Order Process', type: 'Process' }];
        const result = evaluateEntityExtraction(
          { extracted, groundTruth: gtWithTypo },
          { mode: MatchingMode.PARTIAL }
        );

        expect(result.truePositives).toBe(1);
      });
    });

    describe('greedy matching', () => {
      it('should use greedy matching to find best pairs', () => {
        const extracted = [
          { name: 'Process A', type: 'Process' },
          { name: 'Process B', type: 'Process' }
        ];
        const groundTruthLocal = [
          { name: 'Process A', type: 'Process' },
          { name: 'Process B', type: 'Process' }
        ];

        const result = evaluateEntityExtraction({ extracted, groundTruth: groundTruthLocal });
        expect(result.truePositives).toBe(2);
        expect(result.matches).toHaveLength(2);
      });
    });

    describe('edge cases', () => {
      it('should handle empty extracted array', () => {
        const result = evaluateEntityExtraction({ extracted: [], groundTruth });

        expect(result.precision).toBe(0);
        expect(result.recall).toBe(0);
        expect(result.falseNegatives).toBe(4);
      });

      it('should handle empty ground truth array', () => {
        const extracted = [{ name: 'Test', type: 'Process' }];
        const result = evaluateEntityExtraction({ extracted, groundTruth: [] });

        expect(result.precision).toBe(0);
        expect(result.recall).toBe(0);
        expect(result.falsePositives).toBe(1);
      });

      it('should handle null/undefined inputs gracefully', () => {
        const result = evaluateEntityExtraction({ extracted: null, groundTruth: null });

        expect(result.precision).toBe(0);
        expect(result.recall).toBe(0);
        expect(result.f1).toBe(0);
      });
    });

    describe('result metadata', () => {
      it('should include evaluation metadata', () => {
        const result = evaluateEntityExtraction({ extracted: [], groundTruth: [] });

        expect(result.mode).toBe(MatchingMode.STRICT);
        expect(result.similarityThreshold).toBe(DEFAULT_SIMILARITY_THRESHOLD);
        expect(result.evaluatedAt).toBeDefined();
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('evaluateBatchEntityExtraction', () => {
    const documents = [
      {
        extracted: [
          { name: 'Entity A', type: 'Process' },
          { name: 'Entity B', type: 'Task' }
        ],
        groundTruth: [
          { name: 'Entity A', type: 'Process' },
          { name: 'Entity B', type: 'Task' }
        ]
      },
      {
        extracted: [
          { name: 'Entity C', type: 'Process' }
        ],
        groundTruth: [
          { name: 'Entity C', type: 'Process' },
          { name: 'Entity D', type: 'System' }
        ]
      }
    ];

    it('should calculate aggregate micro-averaged metrics', () => {
      const result = evaluateBatchEntityExtraction(documents);

      // Doc 1: 2 TP, 0 FP, 0 FN
      // Doc 2: 1 TP, 0 FP, 1 FN
      // Total: 3 TP, 0 FP, 1 FN
      expect(result.aggregate.truePositives).toBe(3);
      expect(result.aggregate.falsePositives).toBe(0);
      expect(result.aggregate.falseNegatives).toBe(1);
      expect(result.aggregate.precision).toBe(1); // 3 / 3
      expect(result.aggregate.recall).toBe(0.75); // 3 / 4
    });

    it('should calculate macro-averaged metrics', () => {
      const result = evaluateBatchEntityExtraction(documents);

      // Should average F1 across entity types that have support
      expect(result.aggregate.macroF1).toBeGreaterThan(0);
    });

    it('should return per-document results', () => {
      const result = evaluateBatchEntityExtraction(documents);

      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].f1).toBe(1); // Perfect match
      expect(result.documents[1].f1).toBeLessThan(1); // Partial match
    });

    it('should aggregate per-type metrics across documents', () => {
      const result = evaluateBatchEntityExtraction(documents);

      expect(result.aggregate.perTypeMetrics['Process']).toBeDefined();
      expect(result.aggregate.perTypeMetrics['Process'].support).toBe(2);
      expect(result.aggregate.perTypeMetrics['Process'].truePositives).toBe(2);
    });

    it('should handle empty batch', () => {
      const result = evaluateBatchEntityExtraction([]);

      expect(result.documentCount).toBe(0);
      expect(result.aggregate.f1).toBe(0);
    });

    it('should handle null input', () => {
      const result = evaluateBatchEntityExtraction(null);

      expect(result.documentCount).toBe(0);
    });

    it('should include batch metadata', () => {
      const result = evaluateBatchEntityExtraction(documents);

      expect(result.documentCount).toBe(2);
      expect(result.mode).toBe(MatchingMode.STRICT);
      expect(result.evaluatedAt).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatEntityEvaluation', () => {
    it('should format single evaluation results', () => {
      const result = {
        precision: 0.8,
        recall: 0.75,
        f1: 0.774,
        truePositives: 6,
        falsePositives: 2,
        falseNegatives: 2,
        totalExtracted: 8,
        totalGroundTruth: 8,
        mode: MatchingMode.STRICT,
        similarityThreshold: 0.85,
        perTypeMetrics: {
          'Process': { precision: 0.9, recall: 0.8, f1: 0.85, support: 5, predicted: 5 },
          'Task': { precision: 0.7, recall: 0.7, f1: 0.7, support: 3, predicted: 3 }
        },
        unmatchedExtracted: [{ name: 'Extra', type: 'Process' }],
        unmatchedGroundTruth: [{ name: 'Missing', type: 'Task' }],
        evaluatedAt: new Date().toISOString(),
        latencyMs: 10
      };

      const formatted = formatEntityEvaluation(result);

      expect(formatted).toContain('Entity Extraction Evaluation');
      expect(formatted).toContain('Precision: 80.00%');
      expect(formatted).toContain('Recall:    75.00%');
      expect(formatted).toContain('F1 Score:  77.40%');
      expect(formatted).toContain('True Positives:  6');
      expect(formatted).toContain('Per-Type Metrics');
      expect(formatted).toContain('Process');
      expect(formatted).toContain('False Positives (sample)');
      expect(formatted).toContain('False Negatives (sample)');
    });

    it('should handle null result', () => {
      const formatted = formatEntityEvaluation(null);
      expect(formatted).toContain('No evaluation results available');
    });
  });

  describe('formatBatchEntityEvaluation', () => {
    it('should format batch evaluation results', () => {
      const result = {
        aggregate: {
          precision: 0.85,
          recall: 0.8,
          f1: 0.824,
          macroPrecision: 0.82,
          macroRecall: 0.78,
          macroF1: 0.8,
          truePositives: 17,
          falsePositives: 3,
          falseNegatives: 4,
          totalExtracted: 20,
          totalGroundTruth: 21,
          perTypeMetrics: {
            'Process': { precision: 0.9, recall: 0.85, f1: 0.87, support: 10, predicted: 10 }
          }
        },
        documents: [],
        documentCount: 5,
        mode: MatchingMode.PARTIAL,
        similarityThreshold: 0.85,
        evaluatedAt: new Date().toISOString(),
        latencyMs: 50
      };

      const formatted = formatBatchEntityEvaluation(result);

      expect(formatted).toContain('Batch Entity Extraction Evaluation');
      expect(formatted).toContain('Documents Evaluated: 5');
      expect(formatted).toContain('Micro-averaged');
      expect(formatted).toContain('Macro-averaged');
      expect(formatted).toContain('Precision: 85.00%');
    });

    it('should handle null result', () => {
      const formatted = formatBatchEntityEvaluation(null);
      expect(formatted).toContain('No batch evaluation results available');
    });
  });

  describe('MatchingMode constants', () => {
    it('should export matching mode constants', () => {
      expect(MatchingMode.STRICT).toBe('strict');
      expect(MatchingMode.PARTIAL).toBe('partial');
      expect(MatchingMode.TYPE_ONLY).toBe('type_only');
    });
  });

  describe('DEFAULT_SIMILARITY_THRESHOLD', () => {
    it('should export default threshold', () => {
      expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.85);
    });
  });
});
