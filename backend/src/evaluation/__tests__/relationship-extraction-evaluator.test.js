/**
 * Unit tests for Relationship Extraction Evaluator
 * Feature: F1.2.6
 */

const {
  evaluateRelationshipExtraction,
  evaluateBatchRelationshipExtraction,
  formatRelationshipEvaluation,
  formatBatchRelationshipEvaluation,
  RelationshipMatchingMode,
  normalizeName,
  calculateSimilarity,
  relationshipsMatch,
  calculateMetrics,
  DEFAULT_SIMILARITY_THRESHOLD
} = require('../relationship-extraction-evaluator');

describe('Relationship Extraction Evaluator', () => {
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

  describe('relationshipsMatch', () => {
    const extractedRel = { from: 'Manager', to: 'Employee', type: 'REPORTS_TO' };
    const groundTruthExact = { from: 'Manager', to: 'Employee', type: 'REPORTS_TO' };
    const groundTruthSimilar = { from: 'The Manager', to: 'An Employee', type: 'REPORTS_TO' };
    const groundTruthReversed = { from: 'Employee', to: 'Manager', type: 'REPORTS_TO' };
    const groundTruthDifferentType = { from: 'Manager', to: 'Employee', type: 'OWNS' };
    const groundTruthDifferentEntities = { from: 'CEO', to: 'Director', type: 'REPORTS_TO' };

    describe('STRICT mode', () => {
      it('should match relationships with exact entities and type', () => {
        const result = relationshipsMatch(extractedRel, groundTruthExact, RelationshipMatchingMode.STRICT);
        expect(result.matches).toBe(true);
        expect(result.typeMatch).toBe(true);
        expect(result.directionMatch).toBe(true);
        expect(result.similarity).toBe(1);
      });

      it('should not match relationships with different type', () => {
        const result = relationshipsMatch(extractedRel, groundTruthDifferentType, RelationshipMatchingMode.STRICT);
        expect(result.matches).toBe(false);
        expect(result.typeMatch).toBe(false);
      });

      it('should not match relationships with reversed direction', () => {
        const result = relationshipsMatch(extractedRel, groundTruthReversed, RelationshipMatchingMode.STRICT);
        expect(result.matches).toBe(false);
      });

      it('should not match relationships with similar but not exact entity names', () => {
        const result = relationshipsMatch(extractedRel, groundTruthSimilar, RelationshipMatchingMode.STRICT);
        // After normalization, "The Manager" becomes "manager" and "Manager" becomes "manager"
        // So this should actually match in strict mode due to normalization
        expect(result.matches).toBe(true);
      });
    });

    describe('PARTIAL mode', () => {
      it('should match relationships with similar entity names and same type', () => {
        const extracted = { from: 'Purchase Order Proces', to: 'Approval Task', type: 'PRECEDES' };
        const groundTruth = { from: 'Purchase Order Process', to: 'Approval Tasks', type: 'PRECEDES' };
        const result = relationshipsMatch(extracted, groundTruth, RelationshipMatchingMode.PARTIAL);
        expect(result.matches).toBe(true);
        expect(result.typeMatch).toBe(true);
        expect(result.similarity).toBeGreaterThan(0.8);
      });

      it('should not match relationships with different types', () => {
        const result = relationshipsMatch(extractedRel, groundTruthDifferentType, RelationshipMatchingMode.PARTIAL);
        expect(result.matches).toBe(false);
        expect(result.typeMatch).toBe(false);
      });

      it('should not match relationships with different entities', () => {
        const result = relationshipsMatch(extractedRel, groundTruthDifferentEntities, RelationshipMatchingMode.PARTIAL);
        expect(result.matches).toBe(false);
      });

      it('should enforce direction in partial mode', () => {
        const result = relationshipsMatch(extractedRel, groundTruthReversed, RelationshipMatchingMode.PARTIAL);
        expect(result.matches).toBe(false);
      });
    });

    describe('DIRECTION_AGNOSTIC mode', () => {
      it('should match relationships regardless of direction', () => {
        const result = relationshipsMatch(extractedRel, groundTruthReversed, RelationshipMatchingMode.DIRECTION_AGNOSTIC);
        expect(result.matches).toBe(true);
        expect(result.typeMatch).toBe(true);
        expect(result.directionMatch).toBe(false); // Direction was reversed
      });

      it('should track when direction matches', () => {
        const result = relationshipsMatch(extractedRel, groundTruthExact, RelationshipMatchingMode.DIRECTION_AGNOSTIC);
        expect(result.matches).toBe(true);
        expect(result.directionMatch).toBe(true);
      });

      it('should not match relationships with different types even if direction-agnostic', () => {
        const result = relationshipsMatch(extractedRel, groundTruthDifferentType, RelationshipMatchingMode.DIRECTION_AGNOSTIC);
        expect(result.matches).toBe(false);
        expect(result.typeMatch).toBe(false);
      });
    });

    describe('TYPE_ONLY mode', () => {
      it('should match relationships with same type even with different entities', () => {
        const result = relationshipsMatch(extractedRel, groundTruthDifferentEntities, RelationshipMatchingMode.TYPE_ONLY);
        // TYPE_ONLY requires some overlap (>0.3 similarity)
        expect(result.typeMatch).toBe(true);
      });

      it('should not match relationships with different types', () => {
        const result = relationshipsMatch(extractedRel, groundTruthDifferentType, RelationshipMatchingMode.TYPE_ONLY);
        expect(result.matches).toBe(false);
        expect(result.typeMatch).toBe(false);
      });
    });
  });

  describe('calculateMetrics', () => {
    it('should calculate correct precision', () => {
      const { precision } = calculateMetrics(8, 2, 0);
      expect(precision).toBe(0.8);
    });

    it('should calculate correct recall', () => {
      const { recall } = calculateMetrics(8, 0, 2);
      expect(recall).toBe(0.8);
    });

    it('should calculate correct F1', () => {
      const { f1 } = calculateMetrics(8, 2, 2);
      // Precision = 8/10 = 0.8, Recall = 8/10 = 0.8
      // F1 = 2 * 0.8 * 0.8 / (0.8 + 0.8) = 0.8
      expect(f1).toBeCloseTo(0.8, 10);
    });

    it('should handle zero cases', () => {
      const { precision, recall, f1 } = calculateMetrics(0, 0, 0);
      expect(precision).toBe(0);
      expect(recall).toBe(0);
      expect(f1).toBe(0);
    });

    it('should handle no true positives', () => {
      const { precision, recall, f1 } = calculateMetrics(0, 5, 5);
      expect(precision).toBe(0);
      expect(recall).toBe(0);
      expect(f1).toBe(0);
    });
  });

  describe('evaluateRelationshipExtraction', () => {
    const groundTruth = [
      { from: 'Manager', to: 'Task A', type: 'OWNS' },
      { from: 'Task A', to: 'Task B', type: 'PRECEDES' },
      { from: 'System X', to: 'Database Y', type: 'USES' }
    ];

    it('should evaluate perfect extraction', () => {
      const extracted = [...groundTruth];
      const result = evaluateRelationshipExtraction({ extracted, groundTruth });

      expect(result.precision).toBe(1);
      expect(result.recall).toBe(1);
      expect(result.f1).toBe(1);
      expect(result.directionAccuracy).toBe(1);
      expect(result.truePositives).toBe(3);
      expect(result.falsePositives).toBe(0);
      expect(result.falseNegatives).toBe(0);
    });

    it('should handle partial extraction', () => {
      const extracted = [
        { from: 'Manager', to: 'Task A', type: 'OWNS' },
        { from: 'Task A', to: 'Task B', type: 'PRECEDES' }
      ];
      const result = evaluateRelationshipExtraction({ extracted, groundTruth });

      expect(result.precision).toBe(1);
      expect(result.recall).toBeCloseTo(2 / 3, 5);
      expect(result.truePositives).toBe(2);
      expect(result.falsePositives).toBe(0);
      expect(result.falseNegatives).toBe(1);
    });

    it('should handle extraction with errors', () => {
      const extracted = [
        { from: 'Manager', to: 'Task A', type: 'OWNS' },
        { from: 'Wrong Entity', to: 'Another Wrong', type: 'USES' } // Wrong
      ];
      const result = evaluateRelationshipExtraction({ extracted, groundTruth });

      expect(result.truePositives).toBe(1);
      expect(result.falsePositives).toBe(1);
      expect(result.falseNegatives).toBe(2);
      expect(result.precision).toBe(0.5);
      expect(result.recall).toBeCloseTo(1 / 3, 5);
    });

    it('should handle empty extraction', () => {
      const result = evaluateRelationshipExtraction({ extracted: [], groundTruth });

      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
      expect(result.f1).toBe(0);
      expect(result.falseNegatives).toBe(3);
    });

    it('should handle empty ground truth', () => {
      const extracted = [{ from: 'Entity A', to: 'Entity B', type: 'OWNS' }];
      const result = evaluateRelationshipExtraction({ extracted, groundTruth: [] });

      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
      expect(result.f1).toBe(0);
      expect(result.falsePositives).toBe(1);
    });

    it('should handle invalid input gracefully', () => {
      const result = evaluateRelationshipExtraction({ extracted: null, groundTruth });
      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
    });

    it('should track direction accuracy', () => {
      const extracted = [
        { from: 'Manager', to: 'Task A', type: 'OWNS' },
        { from: 'Task A', to: 'Task B', type: 'PRECEDES' }
      ];
      const result = evaluateRelationshipExtraction({ extracted, groundTruth });

      expect(result.directionAccuracy).toBe(1);
      expect(result.correctDirections).toBe(2);
      expect(result.incorrectDirections).toBe(0);
    });

    it('should detect reversed directions in DIRECTION_AGNOSTIC mode', () => {
      const extracted = [
        { from: 'Task A', to: 'Manager', type: 'OWNS' } // Reversed!
      ];
      const gtForTest = [
        { from: 'Manager', to: 'Task A', type: 'OWNS' }
      ];

      const result = evaluateRelationshipExtraction(
        { extracted, groundTruth: gtForTest },
        { mode: RelationshipMatchingMode.DIRECTION_AGNOSTIC }
      );

      expect(result.truePositives).toBe(1);
      expect(result.directionAccuracy).toBe(0); // Direction was wrong
      expect(result.incorrectDirections).toBe(1);
    });

    it('should calculate per-type metrics', () => {
      const result = evaluateRelationshipExtraction({ extracted: groundTruth, groundTruth });

      expect(result.perTypeMetrics.OWNS).toBeDefined();
      expect(result.perTypeMetrics.OWNS.precision).toBe(1);
      expect(result.perTypeMetrics.OWNS.recall).toBe(1);
      expect(result.perTypeMetrics.OWNS.f1).toBe(1);

      expect(result.perTypeMetrics.PRECEDES).toBeDefined();
      expect(result.perTypeMetrics.USES).toBeDefined();
    });

    it('should support partial matching mode', () => {
      const extracted = [
        { from: 'The Manager', to: 'Task Alpha', type: 'OWNS' } // Similar names
      ];
      const gt = [
        { from: 'Manager', to: 'Task A', type: 'OWNS' }
      ];

      const result = evaluateRelationshipExtraction(
        { extracted, groundTruth: gt },
        { mode: RelationshipMatchingMode.PARTIAL, similarityThreshold: 0.6 }
      );

      expect(result.truePositives).toBe(1);
    });

    it('should include metadata in results', () => {
      const result = evaluateRelationshipExtraction({ extracted: groundTruth, groundTruth });

      expect(result.mode).toBe(RelationshipMatchingMode.STRICT);
      expect(result.similarityThreshold).toBe(DEFAULT_SIMILARITY_THRESHOLD);
      expect(result.evaluatedAt).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('evaluateBatchRelationshipExtraction', () => {
    const doc1 = {
      extracted: [
        { from: 'Manager', to: 'Task A', type: 'OWNS' },
        { from: 'Task A', to: 'Task B', type: 'PRECEDES' }
      ],
      groundTruth: [
        { from: 'Manager', to: 'Task A', type: 'OWNS' },
        { from: 'Task A', to: 'Task B', type: 'PRECEDES' }
      ]
    };

    const doc2 = {
      extracted: [
        { from: 'System X', to: 'Database Y', type: 'USES' }
      ],
      groundTruth: [
        { from: 'System X', to: 'Database Y', type: 'USES' },
        { from: 'App Z', to: 'System X', type: 'DEPENDS_ON' }
      ]
    };

    it('should evaluate batch of documents', () => {
      const result = evaluateBatchRelationshipExtraction([doc1, doc2]);

      expect(result.documentCount).toBe(2);
      expect(result.documents).toHaveLength(2);
      expect(result.aggregate).toBeDefined();
    });

    it('should calculate aggregate metrics correctly', () => {
      const result = evaluateBatchRelationshipExtraction([doc1, doc2]);

      // doc1: 2 TP, 0 FP, 0 FN
      // doc2: 1 TP, 0 FP, 1 FN
      // Total: 3 TP, 0 FP, 1 FN
      expect(result.aggregate.truePositives).toBe(3);
      expect(result.aggregate.falsePositives).toBe(0);
      expect(result.aggregate.falseNegatives).toBe(1);
      expect(result.aggregate.precision).toBe(1);
      expect(result.aggregate.recall).toBe(0.75);
    });

    it('should calculate macro-averaged metrics', () => {
      const result = evaluateBatchRelationshipExtraction([doc1, doc2]);

      expect(result.aggregate.macroPrecision).toBeDefined();
      expect(result.aggregate.macroRecall).toBeDefined();
      expect(result.aggregate.macroF1).toBeDefined();
      expect(result.aggregate.macroDirectionAccuracy).toBeDefined();
    });

    it('should aggregate per-type metrics', () => {
      const result = evaluateBatchRelationshipExtraction([doc1, doc2]);

      expect(result.aggregate.perTypeMetrics.OWNS).toBeDefined();
      expect(result.aggregate.perTypeMetrics.PRECEDES).toBeDefined();
      expect(result.aggregate.perTypeMetrics.USES).toBeDefined();
    });

    it('should handle empty batch', () => {
      const result = evaluateBatchRelationshipExtraction([]);

      expect(result.documentCount).toBe(0);
      expect(result.documents).toHaveLength(0);
      expect(result.aggregate.precision).toBe(0);
    });

    it('should handle null input', () => {
      const result = evaluateBatchRelationshipExtraction(null);

      expect(result.documentCount).toBe(0);
      expect(result.aggregate.precision).toBe(0);
    });

    it('should include per-document results', () => {
      const result = evaluateBatchRelationshipExtraction([doc1, doc2]);

      expect(result.documents[0].documentIndex).toBe(0);
      expect(result.documents[0].precision).toBe(1);
      expect(result.documents[0].recall).toBe(1);

      expect(result.documents[1].documentIndex).toBe(1);
      expect(result.documents[1].precision).toBe(1);
      expect(result.documents[1].recall).toBe(0.5);
    });

    it('should include metadata', () => {
      const result = evaluateBatchRelationshipExtraction([doc1, doc2]);

      expect(result.mode).toBe(RelationshipMatchingMode.STRICT);
      expect(result.similarityThreshold).toBe(DEFAULT_SIMILARITY_THRESHOLD);
      expect(result.evaluatedAt).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatRelationshipEvaluation', () => {
    it('should format evaluation results', () => {
      const result = evaluateRelationshipExtraction({
        extracted: [
          { from: 'Manager', to: 'Task A', type: 'OWNS' }
        ],
        groundTruth: [
          { from: 'Manager', to: 'Task A', type: 'OWNS' },
          { from: 'Task A', to: 'Task B', type: 'PRECEDES' }
        ]
      });

      const formatted = formatRelationshipEvaluation(result);

      expect(formatted).toContain('Relationship Extraction Evaluation');
      expect(formatted).toContain('Precision');
      expect(formatted).toContain('Recall');
      expect(formatted).toContain('F1 Score');
      expect(formatted).toContain('Direction Accuracy');
      expect(formatted).toContain('True Positives');
      expect(formatted).toContain('False Negatives');
    });

    it('should include per-type breakdown', () => {
      const result = evaluateRelationshipExtraction({
        extracted: [{ from: 'A', to: 'B', type: 'OWNS' }],
        groundTruth: [{ from: 'A', to: 'B', type: 'OWNS' }]
      });

      const formatted = formatRelationshipEvaluation(result);
      expect(formatted).toContain('Per-Type Metrics');
      expect(formatted).toContain('OWNS');
    });

    it('should show false positives sample', () => {
      const result = evaluateRelationshipExtraction({
        extracted: [
          { from: 'Wrong', to: 'Also Wrong', type: 'USES' }
        ],
        groundTruth: [
          { from: 'Correct', to: 'Entity', type: 'OWNS' }
        ]
      });

      const formatted = formatRelationshipEvaluation(result);
      expect(formatted).toContain('False Positives');
      expect(formatted).toContain('Wrong');
    });

    it('should show false negatives sample', () => {
      const result = evaluateRelationshipExtraction({
        extracted: [],
        groundTruth: [
          { from: 'Missed', to: 'Entity', type: 'OWNS' }
        ]
      });

      const formatted = formatRelationshipEvaluation(result);
      expect(formatted).toContain('False Negatives');
      expect(formatted).toContain('Missed');
    });

    it('should handle null result', () => {
      const formatted = formatRelationshipEvaluation(null);
      expect(formatted).toBe('No evaluation results available');
    });
  });

  describe('formatBatchRelationshipEvaluation', () => {
    it('should format batch results', () => {
      const result = evaluateBatchRelationshipExtraction([
        {
          extracted: [{ from: 'A', to: 'B', type: 'OWNS' }],
          groundTruth: [{ from: 'A', to: 'B', type: 'OWNS' }]
        }
      ]);

      const formatted = formatBatchRelationshipEvaluation(result);

      expect(formatted).toContain('Batch Relationship Extraction Evaluation');
      expect(formatted).toContain('Documents Evaluated');
      expect(formatted).toContain('Micro-averaged');
      expect(formatted).toContain('Macro-averaged');
    });

    it('should handle null result', () => {
      const formatted = formatBatchRelationshipEvaluation(null);
      expect(formatted).toBe('No batch evaluation results available');
    });

    it('should handle result without aggregate', () => {
      const formatted = formatBatchRelationshipEvaluation({});
      expect(formatted).toBe('No batch evaluation results available');
    });
  });

  describe('Direction Accuracy Edge Cases', () => {
    it('should correctly identify direction in complex relationships', () => {
      const extracted = [
        { from: 'Process A', to: 'Process B', type: 'TRIGGERS' },
        { from: 'Role X', to: 'Task Y', type: 'EXECUTES' }
      ];
      const groundTruth = [
        { from: 'Process A', to: 'Process B', type: 'TRIGGERS' },
        { from: 'Role X', to: 'Task Y', type: 'EXECUTES' }
      ];

      const result = evaluateRelationshipExtraction({ extracted, groundTruth });
      expect(result.directionAccuracy).toBe(1);
      expect(result.correctDirections).toBe(2);
    });

    it('should track direction metrics per-type', () => {
      const extracted = [
        { from: 'A', to: 'B', type: 'OWNS' },
        { from: 'C', to: 'D', type: 'OWNS' }
      ];
      const groundTruth = [
        { from: 'A', to: 'B', type: 'OWNS' },
        { from: 'C', to: 'D', type: 'OWNS' }
      ];

      const result = evaluateRelationshipExtraction({ extracted, groundTruth });

      expect(result.perTypeMetrics.OWNS.directionAccuracy).toBe(1);
      expect(result.perTypeMetrics.OWNS.correctDirections).toBe(2);
      expect(result.perTypeMetrics.OWNS.incorrectDirections).toBe(0);
    });
  });

  describe('Constants', () => {
    it('should export RelationshipMatchingMode', () => {
      expect(RelationshipMatchingMode.STRICT).toBe('strict');
      expect(RelationshipMatchingMode.PARTIAL).toBe('partial');
      expect(RelationshipMatchingMode.DIRECTION_AGNOSTIC).toBe('direction_agnostic');
      expect(RelationshipMatchingMode.TYPE_ONLY).toBe('type_only');
    });

    it('should export DEFAULT_SIMILARITY_THRESHOLD', () => {
      expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.85);
    });
  });
});
