/**
 * Unit tests for Retrieval Metrics Service
 * Feature: F1.2.1
 */

const {
  precisionAtK,
  recallAtK,
  f1AtK,
  reciprocalRank,
  meanReciprocalRank,
  dcg,
  idcg,
  ndcg,
  ndcgAtK,
  averagePrecision,
  meanAveragePrecision,
  hitAtK,
  meanHitRate,
  computeAllMetrics,
  formatMetrics
} = require('../metrics');

describe('Retrieval Metrics Service', () => {
  describe('precisionAtK', () => {
    it('should calculate precision correctly with all relevant items', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['a', 'b', 'c', 'd', 'e']);
      expect(precisionAtK(retrieved, relevant, 5)).toBe(1.0);
    });

    it('should calculate precision correctly with no relevant items', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['x', 'y', 'z']);
      expect(precisionAtK(retrieved, relevant, 5)).toBe(0);
    });

    it('should calculate precision correctly with partial relevance', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['a', 'c', 'e']); // 3 out of 5
      expect(precisionAtK(retrieved, relevant, 5)).toBe(0.6);
    });

    it('should handle K smaller than retrieved list', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['a', 'b', 'c']);
      // Top 3: a, b, c - all relevant
      expect(precisionAtK(retrieved, relevant, 3)).toBe(1.0);
    });

    it('should handle K larger than retrieved list', () => {
      const retrieved = ['a', 'b'];
      const relevant = new Set(['a', 'b', 'c']);
      // Only 2 items retrieved, 2 relevant
      expect(precisionAtK(retrieved, relevant, 5)).toBe(0.4); // 2/5
    });

    it('should accept array for relevant items', () => {
      const retrieved = ['a', 'b', 'c'];
      const relevant = ['a', 'c']; // Array instead of Set
      expect(precisionAtK(retrieved, relevant, 3)).toBeCloseTo(0.667, 2);
    });

    it('should return 0 for empty inputs', () => {
      expect(precisionAtK([], new Set(['a']), 5)).toBe(0);
      expect(precisionAtK(['a'], new Set(['a']), 0)).toBe(0);
      expect(precisionAtK(null, new Set(['a']), 5)).toBe(0);
    });
  });

  describe('recallAtK', () => {
    it('should calculate recall correctly with all relevant items retrieved', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['a', 'b', 'c']);
      expect(recallAtK(retrieved, relevant, 5)).toBe(1.0);
    });

    it('should calculate recall correctly with partial retrieval', () => {
      const retrieved = ['a', 'b', 'x', 'y', 'z'];
      const relevant = new Set(['a', 'b', 'c', 'd']);
      // Retrieved 2 out of 4 relevant
      expect(recallAtK(retrieved, relevant, 5)).toBe(0.5);
    });

    it('should handle K that limits recall', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['c', 'd', 'e']);
      // Top 2: a, b - neither relevant
      expect(recallAtK(retrieved, relevant, 2)).toBe(0);
    });

    it('should return 0 for empty relevant set', () => {
      const retrieved = ['a', 'b', 'c'];
      const relevant = new Set();
      expect(recallAtK(retrieved, relevant, 3)).toBe(0);
    });

    it('should return 0 for empty retrieved list', () => {
      const retrieved = [];
      const relevant = new Set(['a', 'b']);
      expect(recallAtK(retrieved, relevant, 5)).toBe(0);
    });
  });

  describe('f1AtK', () => {
    it('should calculate F1 as harmonic mean of precision and recall', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['a', 'b', 'x', 'y']); // 2 in retrieved
      // Precision@5 = 2/5 = 0.4
      // Recall@5 = 2/4 = 0.5
      // F1 = 2 * 0.4 * 0.5 / (0.4 + 0.5) = 0.4 / 0.9 ≈ 0.444
      expect(f1AtK(retrieved, relevant, 5)).toBeCloseTo(0.444, 2);
    });

    it('should return 0 when precision and recall are both 0', () => {
      const retrieved = ['a', 'b'];
      const relevant = new Set(['x', 'y']);
      expect(f1AtK(retrieved, relevant, 2)).toBe(0);
    });

    it('should return 1 when precision and recall are both 1', () => {
      const retrieved = ['a', 'b', 'c'];
      const relevant = new Set(['a', 'b', 'c']);
      expect(f1AtK(retrieved, relevant, 3)).toBe(1.0);
    });
  });

  describe('reciprocalRank', () => {
    it('should return 1 when first item is relevant', () => {
      const retrieved = ['a', 'b', 'c'];
      const relevant = new Set(['a']);
      expect(reciprocalRank(retrieved, relevant)).toBe(1.0);
    });

    it('should return 0.5 when first relevant is at position 2', () => {
      const retrieved = ['x', 'a', 'c'];
      const relevant = new Set(['a']);
      expect(reciprocalRank(retrieved, relevant)).toBe(0.5);
    });

    it('should return 0.333... when first relevant is at position 3', () => {
      const retrieved = ['x', 'y', 'a'];
      const relevant = new Set(['a']);
      expect(reciprocalRank(retrieved, relevant)).toBeCloseTo(0.333, 2);
    });

    it('should return 0 when no relevant items found', () => {
      const retrieved = ['x', 'y', 'z'];
      const relevant = new Set(['a', 'b']);
      expect(reciprocalRank(retrieved, relevant)).toBe(0);
    });

    it('should return 0 for empty inputs', () => {
      expect(reciprocalRank([], new Set(['a']))).toBe(0);
      expect(reciprocalRank(null, new Set(['a']))).toBe(0);
    });
  });

  describe('meanReciprocalRank', () => {
    it('should average reciprocal ranks across queries', () => {
      const queries = [
        { retrieved: ['a', 'b', 'c'], relevant: new Set(['a']) }, // RR = 1
        { retrieved: ['x', 'a', 'c'], relevant: new Set(['a']) }, // RR = 0.5
        { retrieved: ['x', 'y', 'a'], relevant: new Set(['a']) }  // RR = 0.333
      ];
      // MRR = (1 + 0.5 + 0.333) / 3 ≈ 0.611
      expect(meanReciprocalRank(queries)).toBeCloseTo(0.611, 2);
    });

    it('should return 0 for empty queries', () => {
      expect(meanReciprocalRank([])).toBe(0);
      expect(meanReciprocalRank(null)).toBe(0);
    });
  });

  describe('dcg', () => {
    it('should calculate DCG correctly', () => {
      // Relevance scores: [3, 2, 3, 0, 1, 2]
      // DCG = 3/log2(2) + 2/log2(3) + 3/log2(4) + 0/log2(5) + 1/log2(6) + 2/log2(7)
      // DCG = 3/1 + 2/1.585 + 3/2 + 0 + 1/2.585 + 2/2.807
      // DCG ≈ 3 + 1.262 + 1.5 + 0 + 0.387 + 0.712 ≈ 6.861
      const scores = [3, 2, 3, 0, 1, 2];
      expect(dcg(scores)).toBeCloseTo(6.861, 2);
    });

    it('should calculate DCG@K correctly', () => {
      const scores = [3, 2, 3, 0, 1, 2];
      // DCG@3 = 3/1 + 2/1.585 + 3/2 ≈ 5.762
      expect(dcg(scores, 3)).toBeCloseTo(5.762, 2);
    });

    it('should return 0 for empty scores', () => {
      expect(dcg([])).toBe(0);
      expect(dcg(null)).toBe(0);
    });
  });

  describe('idcg', () => {
    it('should calculate IDCG with sorted scores', () => {
      const scores = [2, 3, 1, 3, 0]; // Sorted: [3, 3, 2, 1, 0]
      // IDCG = 3/1 + 3/1.585 + 2/2 + 1/2.322 + 0 ≈ 6.322
      expect(idcg(scores)).toBeCloseTo(6.322, 2);
    });
  });

  describe('ndcg', () => {
    it('should calculate NDCG as DCG/IDCG', () => {
      const scores = [3, 2, 3, 0, 1, 2]; // Already optimal: [3, 3, 2, 2, 1, 0]
      // For this case, sorted would give higher DCG
      const ndcgScore = ndcg(scores);
      expect(ndcgScore).toBeGreaterThan(0);
      expect(ndcgScore).toBeLessThanOrEqual(1);
    });

    it('should return 1 for optimal ranking', () => {
      const scores = [3, 2, 1, 0]; // Already sorted descending
      expect(ndcg(scores)).toBeCloseTo(1.0, 5);
    });

    it('should return 0 when all scores are 0', () => {
      const scores = [0, 0, 0, 0];
      expect(ndcg(scores)).toBe(0);
    });
  });

  describe('ndcgAtK', () => {
    it('should calculate NDCG@K with binary relevance', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['a', 'c', 'e']);
      // Relevance: [1, 0, 1, 0, 1]
      const score = ndcgAtK(retrieved, relevant, 5);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should return 1 for perfect ranking', () => {
      const retrieved = ['a', 'b', 'c', 'x', 'y'];
      const relevant = new Set(['a', 'b', 'c']);
      // All relevant items at top
      expect(ndcgAtK(retrieved, relevant, 5)).toBeCloseTo(1.0, 5);
    });

    it('should return lower score for poor ranking', () => {
      const retrieved = ['x', 'y', 'z', 'a', 'b'];
      const relevant = new Set(['a', 'b', 'c']);
      // Relevant items at bottom
      const score = ndcgAtK(retrieved, relevant, 5);
      expect(score).toBeLessThan(1);
    });

    it('should return 0 when no relevant items retrieved', () => {
      const retrieved = ['x', 'y', 'z'];
      const relevant = new Set(['a', 'b', 'c']);
      expect(ndcgAtK(retrieved, relevant, 3)).toBe(0);
    });
  });

  describe('averagePrecision', () => {
    it('should calculate AP correctly', () => {
      const retrieved = ['a', 'x', 'b', 'y', 'c'];
      const relevant = new Set(['a', 'b', 'c']);
      // Positions of relevant: 1, 3, 5
      // Precision at pos 1: 1/1 = 1
      // Precision at pos 3: 2/3 = 0.667
      // Precision at pos 5: 3/5 = 0.6
      // AP = (1 + 0.667 + 0.6) / 3 ≈ 0.756
      expect(averagePrecision(retrieved, relevant)).toBeCloseTo(0.756, 2);
    });

    it('should return 1 for perfect retrieval at top', () => {
      const retrieved = ['a', 'b', 'c', 'x', 'y'];
      const relevant = new Set(['a', 'b', 'c']);
      // Precision at pos 1: 1/1 = 1
      // Precision at pos 2: 2/2 = 1
      // Precision at pos 3: 3/3 = 1
      // AP = (1 + 1 + 1) / 3 = 1
      expect(averagePrecision(retrieved, relevant)).toBe(1.0);
    });

    it('should return 0 when no relevant items retrieved', () => {
      const retrieved = ['x', 'y', 'z'];
      const relevant = new Set(['a', 'b', 'c']);
      expect(averagePrecision(retrieved, relevant)).toBe(0);
    });

    it('should return 0 for empty relevant set', () => {
      const retrieved = ['a', 'b', 'c'];
      const relevant = new Set();
      expect(averagePrecision(retrieved, relevant)).toBe(0);
    });
  });

  describe('meanAveragePrecision', () => {
    it('should average AP across queries', () => {
      const queries = [
        { retrieved: ['a', 'b', 'c'], relevant: new Set(['a', 'b', 'c']) }, // AP = 1
        { retrieved: ['x', 'y', 'z'], relevant: new Set(['a', 'b', 'c']) }  // AP = 0
      ];
      expect(meanAveragePrecision(queries)).toBe(0.5);
    });

    it('should return 0 for empty queries', () => {
      expect(meanAveragePrecision([])).toBe(0);
    });
  });

  describe('hitAtK', () => {
    it('should return 1 when relevant item found in top K', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['c']);
      expect(hitAtK(retrieved, relevant, 5)).toBe(1);
      expect(hitAtK(retrieved, relevant, 3)).toBe(1);
    });

    it('should return 0 when no relevant item in top K', () => {
      const retrieved = ['a', 'b', 'c', 'd', 'e'];
      const relevant = new Set(['e']);
      expect(hitAtK(retrieved, relevant, 3)).toBe(0); // e is at position 5
    });

    it('should return 0 for empty inputs', () => {
      expect(hitAtK([], new Set(['a']), 5)).toBe(0);
      expect(hitAtK(['a'], new Set(['a']), 0)).toBe(0);
    });
  });

  describe('meanHitRate', () => {
    it('should average hit rate across queries', () => {
      const queries = [
        { retrieved: ['a', 'b', 'c'], relevant: new Set(['a']) },   // Hit
        { retrieved: ['x', 'y', 'z'], relevant: new Set(['a']) },   // Miss
        { retrieved: ['a', 'x', 'y'], relevant: new Set(['a']) }    // Hit
      ];
      expect(meanHitRate(queries, 3)).toBeCloseTo(0.667, 2);
    });

    it('should return 0 for empty queries', () => {
      expect(meanHitRate([], 5)).toBe(0);
    });
  });

  describe('computeAllMetrics', () => {
    it('should compute all metrics for a batch of queries', () => {
      const queries = [
        { retrieved: ['a', 'b', 'c', 'd', 'e'], relevant: new Set(['a', 'c']) },
        { retrieved: ['x', 'a', 'y', 'b', 'z'], relevant: new Set(['a', 'b']) }
      ];

      const result = computeAllMetrics(queries, [1, 3, 5]);

      expect(result.queryCount).toBe(2);
      expect(result.mrr).toBeGreaterThan(0);
      expect(result.map).toBeGreaterThan(0);

      expect(result.metrics['@1']).toBeDefined();
      expect(result.metrics['@3']).toBeDefined();
      expect(result.metrics['@5']).toBeDefined();

      expect(result.metrics['@5'].precision).toBeGreaterThan(0);
      expect(result.metrics['@5'].recall).toBeGreaterThan(0);
      expect(result.metrics['@5'].f1).toBeGreaterThan(0);
      expect(result.metrics['@5'].ndcg).toBeGreaterThan(0);
      expect(result.metrics['@5'].hitRate).toBeGreaterThan(0);
    });

    it('should return zeros for empty queries', () => {
      const result = computeAllMetrics([]);

      expect(result.queryCount).toBe(0);
      expect(result.mrr).toBe(0);
      expect(result.map).toBe(0);
    });

    it('should use default K values if not specified', () => {
      const queries = [
        { retrieved: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], relevant: new Set(['a']) }
      ];

      const result = computeAllMetrics(queries);

      expect(result.metrics['@1']).toBeDefined();
      expect(result.metrics['@3']).toBeDefined();
      expect(result.metrics['@5']).toBeDefined();
      expect(result.metrics['@10']).toBeDefined();
    });
  });

  describe('formatMetrics', () => {
    it('should format metrics as readable string', () => {
      const metrics = {
        mrr: 0.75,
        map: 0.65,
        queryCount: 10,
        metrics: {
          '@5': {
            precision: 0.6,
            recall: 0.8,
            f1: 0.685,
            ndcg: 0.72,
            hitRate: 0.9
          }
        }
      };

      const formatted = formatMetrics(metrics);

      expect(formatted).toContain('MRR: 0.7500');
      expect(formatted).toContain('MAP: 0.6500');
      expect(formatted).toContain('10 queries');
      expect(formatted).toContain('@5');
      expect(formatted).toContain('Precision: 0.6000');
    });

    it('should handle empty metrics', () => {
      const formatted = formatMetrics({ queryCount: 0 });
      expect(formatted).toContain('No metrics available');
    });

    it('should handle null metrics', () => {
      const formatted = formatMetrics(null);
      expect(formatted).toContain('No metrics available');
    });
  });
});
