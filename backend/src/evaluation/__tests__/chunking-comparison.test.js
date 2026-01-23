/**
 * Unit tests for A/B Chunking Comparison Service
 * Feature: F4.1.4
 */

const {
  createFixedChunks,
  cosineSimilarity,
  retrieveTopK,
  determineRelevantChunks,
  calculateChunkStats,
  determineWinner,
  calculateImprovements,
  DEFAULT_FIXED_CONFIG,
  DEFAULT_SEMANTIC_CONFIG,
} = require('../chunking-comparison');

describe('A/B Chunking Comparison Service', () => {
  describe('createFixedChunks', () => {
    it('should create chunks with default settings', () => {
      const text = Array(600).fill('word').join(' ');
      const chunks = createFixedChunks(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty('id');
      expect(chunks[0]).toHaveProperty('content');
      expect(chunks[0]).toHaveProperty('method', 'fixed');
      expect(chunks[0]).toHaveProperty('wordCount');
    });

    it('should respect chunkSize parameter', () => {
      const text = Array(100).fill('word').join(' ');
      const chunks = createFixedChunks(text, 50, 10);

      // 100 words with 50-word chunks and 10-word overlap
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].wordCount).toBeLessThanOrEqual(50);
    });

    it('should handle overlap correctly', () => {
      const text = 'one two three four five six seven eight nine ten';
      const chunks = createFixedChunks(text, 5, 2);

      // With overlap, later chunks should share some words with previous
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle empty text', () => {
      const chunks = createFixedChunks('');
      expect(chunks).toEqual([]);
    });

    it('should handle text smaller than chunk size', () => {
      const text = 'short text';
      const chunks = createFixedChunks(text, 500, 50);

      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe('short text');
    });

    it('should assign sequential chunk indices', () => {
      const text = Array(200).fill('word').join(' ');
      const chunks = createFixedChunks(text, 50, 10);

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].chunkIndex).toBe(i);
      }
    });
  });

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = [1, 2, 3, 4, 5];
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vecA = [1, 0, 0];
      const vecB = [0, 1, 0];
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
      const vecA = [1, 2, 3];
      const vecB = [-1, -2, -3];
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(-1.0, 5);
    });

    it('should handle zero vectors', () => {
      const vecA = [0, 0, 0];
      const vecB = [1, 2, 3];
      expect(cosineSimilarity(vecA, vecB)).toBe(0);
    });

    it('should handle null or undefined inputs', () => {
      expect(cosineSimilarity(null, [1, 2, 3])).toBe(0);
      expect(cosineSimilarity([1, 2, 3], undefined)).toBe(0);
    });

    it('should handle vectors of different lengths', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it('should calculate correctly for known values', () => {
      const vecA = [1, 2, 3];
      const vecB = [4, 5, 6];
      // cos(theta) = (1*4 + 2*5 + 3*6) / (sqrt(14) * sqrt(77))
      // = 32 / (3.742 * 8.775) = 32 / 32.83 = 0.9746
      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.9746, 3);
    });
  });

  describe('retrieveTopK', () => {
    const mockChunks = [
      { id: 'chunk_0', embedding: [1, 0, 0] },
      { id: 'chunk_1', embedding: [0.9, 0.1, 0] },
      { id: 'chunk_2', embedding: [0.1, 0.9, 0] },
      { id: 'chunk_3', embedding: [0, 1, 0] },
      { id: 'chunk_4', embedding: [0, 0, 1] },
    ];

    it('should return top K most similar chunks', () => {
      const queryEmbedding = [1, 0, 0];
      const results = retrieveTopK(queryEmbedding, mockChunks, 3);

      expect(results.length).toBe(3);
      expect(results[0].id).toBe('chunk_0'); // Most similar
      expect(results[1].id).toBe('chunk_1'); // Second most similar
    });

    it('should include similarity scores', () => {
      const queryEmbedding = [1, 0, 0];
      const results = retrieveTopK(queryEmbedding, mockChunks, 2);

      expect(results[0].similarity).toBeCloseTo(1.0, 5);
      expect(results[1]).toHaveProperty('similarity');
      expect(results[1].similarity).toBeLessThan(1.0);
    });

    it('should handle K larger than chunk count', () => {
      const queryEmbedding = [1, 0, 0];
      const results = retrieveTopK(queryEmbedding, mockChunks, 100);

      expect(results.length).toBe(mockChunks.length);
    });

    it('should return empty array for empty chunks', () => {
      const results = retrieveTopK([1, 0, 0], [], 5);
      expect(results).toEqual([]);
    });

    it('should sort by descending similarity', () => {
      const queryEmbedding = [0.5, 0.5, 0];
      const results = retrieveTopK(queryEmbedding, mockChunks, 5);

      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });
  });

  describe('determineRelevantChunks', () => {
    const mockChunks = [
      { id: 'chunk_0', content: 'The quick brown fox jumps over the lazy dog' },
      { id: 'chunk_1', content: 'Machine learning algorithms are complex' },
      { id: 'chunk_2', content: 'The fox and the dog became friends' },
      { id: 'chunk_3', content: 'Data science is a growing field' },
    ];

    it('should find chunks containing keywords', () => {
      const relevant = determineRelevantChunks(mockChunks, ['fox']);
      expect(relevant).toContain('chunk_0');
      expect(relevant).toContain('chunk_2');
      expect(relevant.length).toBe(2);
    });

    it('should be case insensitive', () => {
      const relevant = determineRelevantChunks(mockChunks, ['FOX', 'DOG']);
      expect(relevant).toContain('chunk_0');
      expect(relevant).toContain('chunk_2');
    });

    it('should return empty array for no matches', () => {
      const relevant = determineRelevantChunks(mockChunks, ['elephant']);
      expect(relevant).toEqual([]);
    });

    it('should handle empty keywords', () => {
      const relevant = determineRelevantChunks(mockChunks, []);
      expect(relevant).toEqual([]);
    });

    it('should handle null keywords', () => {
      const relevant = determineRelevantChunks(mockChunks, null);
      expect(relevant).toEqual([]);
    });

    it('should find chunks with multiple keyword matches', () => {
      const relevant = determineRelevantChunks(mockChunks, ['machine', 'data']);
      expect(relevant).toContain('chunk_1');
      expect(relevant).toContain('chunk_3');
    });
  });

  describe('calculateChunkStats', () => {
    it('should calculate statistics correctly', () => {
      const chunks = [
        { content: 'one two three' },
        { content: 'four five six seven' },
        { content: 'eight nine' },
      ];

      const stats = calculateChunkStats(chunks);

      expect(stats.count).toBe(3);
      expect(stats.minWords).toBe(2);
      expect(stats.maxWords).toBe(4);
      expect(stats.avgWords).toBe(3); // (3 + 4 + 2) / 3 = 3
      expect(stats.totalWords).toBe(9);
    });

    it('should handle chunks with wordCount property', () => {
      const chunks = [
        { wordCount: 100 },
        { wordCount: 200 },
        { wordCount: 300 },
      ];

      const stats = calculateChunkStats(chunks);

      expect(stats.count).toBe(3);
      expect(stats.avgWords).toBe(200);
      expect(stats.totalWords).toBe(600);
    });

    it('should handle empty chunks array', () => {
      const stats = calculateChunkStats([]);

      expect(stats.count).toBe(0);
      expect(stats.avgWords).toBe(0);
    });

    it('should calculate standard deviation', () => {
      const chunks = [
        { content: Array(100).fill('w').join(' ') },
        { content: Array(100).fill('w').join(' ') },
        { content: Array(100).fill('w').join(' ') },
      ];

      const stats = calculateChunkStats(chunks);

      // All same size, so stdDev should be 0
      expect(stats.stdDev).toBe(0);
    });
  });

  describe('determineWinner', () => {
    it('should determine semantic winner when it has better metrics', () => {
      const fixedMetrics = {
        mrr: 0.5,
        map: 0.4,
        metrics: {
          '@5': { recall: 0.6, ndcg: 0.5 },
        },
      };

      const semanticMetrics = {
        mrr: 0.7,
        map: 0.6,
        metrics: {
          '@5': { recall: 0.8, ndcg: 0.7 },
        },
      };

      const result = determineWinner(fixedMetrics, semanticMetrics);

      expect(result.winner).toBe('semantic');
      expect(result.scores.semantic).toBeGreaterThan(result.scores.fixed);
    });

    it('should determine fixed winner when it has better metrics', () => {
      const fixedMetrics = {
        mrr: 0.8,
        map: 0.7,
        metrics: {
          '@5': { recall: 0.9, ndcg: 0.85 },
        },
      };

      const semanticMetrics = {
        mrr: 0.5,
        map: 0.4,
        metrics: {
          '@5': { recall: 0.6, ndcg: 0.5 },
        },
      };

      const result = determineWinner(fixedMetrics, semanticMetrics);

      expect(result.winner).toBe('fixed');
      expect(result.scores.fixed).toBeGreaterThan(result.scores.semantic);
    });

    it('should determine tie when metrics are equal', () => {
      const metrics = {
        mrr: 0.5,
        map: 0.5,
        metrics: {
          '@5': { recall: 0.5, ndcg: 0.5 },
        },
      };

      const result = determineWinner(metrics, metrics);

      expect(result.winner).toBe('tie');
      expect(result.scores.fixed).toBe(result.scores.semantic);
    });

    it('should include reasoning in result', () => {
      const fixedMetrics = { mrr: 0.5, map: 0.5, metrics: {} };
      const semanticMetrics = { mrr: 0.7, map: 0.7, metrics: {} };

      const result = determineWinner(fixedMetrics, semanticMetrics);

      expect(result).toHaveProperty('reasoning');
      expect(typeof result.reasoning).toBe('string');
    });
  });

  describe('calculateImprovements', () => {
    it('should calculate positive improvement for better semantic', () => {
      const fixedMetrics = { mrr: 0.5, map: 0.5, metrics: {} };
      const semanticMetrics = { mrr: 0.6, map: 0.6, metrics: {} };

      const improvements = calculateImprovements(fixedMetrics, semanticMetrics, []);

      expect(improvements.mrr).toBe(20); // 20% improvement
      expect(improvements.map).toBe(20);
    });

    it('should calculate negative improvement for worse semantic', () => {
      const fixedMetrics = { mrr: 0.6, map: 0.6, metrics: {} };
      const semanticMetrics = { mrr: 0.5, map: 0.5, metrics: {} };

      const improvements = calculateImprovements(fixedMetrics, semanticMetrics, []);

      expect(improvements.mrr).toBeCloseTo(-16.67, 1); // ~16.67% worse
      expect(improvements.map).toBeCloseTo(-16.67, 1);
    });

    it('should calculate per-K improvements', () => {
      const fixedMetrics = {
        mrr: 0.5,
        map: 0.5,
        metrics: {
          '@5': { precision: 0.5, recall: 0.5, f1: 0.5, ndcg: 0.5, hitRate: 0.5 },
        },
      };

      const semanticMetrics = {
        mrr: 0.6,
        map: 0.6,
        metrics: {
          '@5': { precision: 0.6, recall: 0.6, f1: 0.6, ndcg: 0.6, hitRate: 0.6 },
        },
      };

      const improvements = calculateImprovements(fixedMetrics, semanticMetrics, [5]);

      expect(improvements.byK['@5']).toBeDefined();
      expect(improvements.byK['@5'].precision).toBe(20);
      expect(improvements.byK['@5'].recall).toBe(20);
    });

    it('should handle zero baseline', () => {
      const fixedMetrics = { mrr: 0, map: 0, metrics: {} };
      const semanticMetrics = { mrr: 0.5, map: 0.5, metrics: {} };

      const improvements = calculateImprovements(fixedMetrics, semanticMetrics, []);

      expect(improvements.mrr).toBe(100); // 100% improvement from 0
    });

    it('should handle both zeros', () => {
      const fixedMetrics = { mrr: 0, map: 0, metrics: {} };
      const semanticMetrics = { mrr: 0, map: 0, metrics: {} };

      const improvements = calculateImprovements(fixedMetrics, semanticMetrics, []);

      expect(improvements.mrr).toBe(0);
      expect(improvements.map).toBe(0);
    });
  });

  describe('DEFAULT_FIXED_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_FIXED_CONFIG.chunkSize).toBe(500);
      expect(DEFAULT_FIXED_CONFIG.overlap).toBe(50);
    });
  });

  describe('DEFAULT_SEMANTIC_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_SEMANTIC_CONFIG.breakpointPercentileThreshold).toBe(95);
      expect(DEFAULT_SEMANTIC_CONFIG.bufferSize).toBe(1);
      expect(DEFAULT_SEMANTIC_CONFIG.maxChunkWords).toBe(800);
      expect(DEFAULT_SEMANTIC_CONFIG.minChunkWords).toBe(50);
    });
  });
});
