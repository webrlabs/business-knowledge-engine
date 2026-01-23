/**
 * Tests for Chunk Coherence Score Calculator
 *
 * Feature: F4.1.3 - Measure semantic coherence within each chunk
 *
 * Tests cover:
 * - Centroid-based coherence calculation
 * - Pairwise coherence calculation
 * - Variance-based scoring
 * - Combined score calculation
 * - Batch processing
 * - Edge cases (insufficient data, empty content)
 */

// Mock dependencies before requiring the module
jest.mock('../../services/openai-service', () => ({
  getOpenAIService: jest.fn(() => ({
    getEmbeddings: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const {
  ChunkCoherenceScorer,
  getChunkCoherenceScorer,
  formatCoherenceScore,
  formatBatchCoherence,
  DEFAULT_CONFIG,
} = require('../chunk-coherence-score');
const { getOpenAIService } = require('../../services/openai-service');

describe('ChunkCoherenceScorer', () => {
  let scorer;
  let mockOpenAI;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenAI = {
      getEmbeddings: jest.fn().mockResolvedValue([]),
    };
    getOpenAIService.mockReturnValue(mockOpenAI);
    scorer = new ChunkCoherenceScorer();
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.minSentencesForCoherence).toBe(2);
      expect(DEFAULT_CONFIG.maxSentencesForPairwise).toBe(50);
      expect(DEFAULT_CONFIG.embeddingBatchSize).toBe(16);
      expect(DEFAULT_CONFIG.weights).toEqual({
        centroid: 0.5,
        pairwise: 0.3,
        variance: 0.2,
      });
    });
  });

  describe('_splitIntoSentences', () => {
    it('should split text into sentences', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const sentences = scorer._splitIntoSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe('First sentence.');
      expect(sentences[1]).toBe('Second sentence.');
      expect(sentences[2]).toBe('Third sentence.');
    });

    it('should handle abbreviations correctly', () => {
      const text = 'Dr. Smith met Mr. Jones at the Inc. headquarters.';
      const sentences = scorer._splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
    });

    it('should return empty array for empty input', () => {
      expect(scorer._splitIntoSentences('')).toEqual([]);
      expect(scorer._splitIntoSentences(null)).toEqual([]);
    });
  });

  describe('_cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = [0.5, 0.5, 0.5, 0.5];
      expect(scorer._cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0, 0];
      const vec2 = [0, 1, 0, 0];
      expect(scorer._cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
    });

    it('should handle zero vectors', () => {
      const zeroVec = [0, 0, 0];
      const normalVec = [1, 2, 3];
      expect(scorer._cosineSimilarity(zeroVec, normalVec)).toBe(0);
    });

    it('should return high similarity for similar vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0.95, 0.05, 0];
      const similarity = scorer._cosineSimilarity(vec1, vec2);
      expect(similarity).toBeGreaterThan(0.9);
    });
  });

  describe('_calculateCentroid', () => {
    it('should calculate mean of embedding vectors', () => {
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const centroid = scorer._calculateCentroid(embeddings);

      expect(centroid[0]).toBeCloseTo(1 / 3, 5);
      expect(centroid[1]).toBeCloseTo(1 / 3, 5);
      expect(centroid[2]).toBeCloseTo(1 / 3, 5);
    });

    it('should handle single embedding', () => {
      const embeddings = [[1, 2, 3]];
      const centroid = scorer._calculateCentroid(embeddings);

      expect(centroid).toEqual([1, 2, 3]);
    });

    it('should return null for empty array', () => {
      expect(scorer._calculateCentroid([])).toBeNull();
    });
  });

  describe('_calculateCentroidCoherence', () => {
    it('should return high score for coherent embeddings', () => {
      // Similar embeddings cluster around a centroid
      const embeddings = [
        [1, 0.1, 0],
        [0.95, 0.15, 0],
        [0.98, 0.12, 0],
      ];
      const centroid = scorer._calculateCentroid(embeddings);
      const result = scorer._calculateCentroidCoherence(embeddings, centroid);

      expect(result.score).toBeGreaterThan(0.9);
      expect(result.stdDev).toBeLessThan(0.1);
    });

    it('should return lower score for diverse embeddings', () => {
      // Orthogonal embeddings are far from any centroid
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const centroid = scorer._calculateCentroid(embeddings);
      const result = scorer._calculateCentroidCoherence(embeddings, centroid);

      expect(result.score).toBeLessThan(0.7);
    });
  });

  describe('_calculatePairwiseCoherence', () => {
    it('should return high score for similar embeddings', () => {
      const embeddings = [
        [1, 0, 0],
        [0.99, 0.01, 0],
        [0.98, 0.02, 0],
      ];
      const result = scorer._calculatePairwiseCoherence(embeddings);

      expect(result.score).toBeGreaterThan(0.95);
    });

    it('should return lower score for diverse embeddings', () => {
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const result = scorer._calculatePairwiseCoherence(embeddings);

      expect(result.score).toBeLessThan(0.5);
    });

    it('should return 1 for single embedding', () => {
      const embeddings = [[1, 2, 3]];
      const result = scorer._calculatePairwiseCoherence(embeddings);

      expect(result.score).toBe(1.0);
    });
  });

  describe('_calculateVarianceScore', () => {
    it('should return high score for low variance', () => {
      const distances = [0.1, 0.11, 0.09, 0.1];
      const score = scorer._calculateVarianceScore(distances);

      expect(score).toBeGreaterThan(0.9);
    });

    it('should return lower score for high variance', () => {
      const distances = [0.1, 0.5, 0.2, 0.8];
      const score = scorer._calculateVarianceScore(distances);

      expect(score).toBeLessThan(0.5);
    });

    it('should return 1 for empty or single element', () => {
      expect(scorer._calculateVarianceScore([])).toBe(1.0);
      expect(scorer._calculateVarianceScore([0.5])).toBe(1.0);
    });
  });

  describe('_combineScores', () => {
    it('should weight scores according to config', () => {
      const weights = { centroid: 0.5, pairwise: 0.3, variance: 0.2 };
      const combined = scorer._combineScores(0.8, 0.6, 0.9, weights);

      // Expected: (0.5 * 0.8 + 0.3 * 0.6 + 0.2 * 0.9) / 1.0 = 0.76
      expect(combined).toBeCloseTo(0.76, 5);
    });

    it('should return average when all weights are equal', () => {
      const weights = { centroid: 1, pairwise: 1, variance: 1 };
      const combined = scorer._combineScores(0.6, 0.6, 0.6, weights);

      expect(combined).toBeCloseTo(0.6, 5);
    });
  });

  describe('calculateCoherence', () => {
    it('should return insufficient_data for empty content', async () => {
      const result = await scorer.calculateCoherence('');

      expect(result.method).toBe('insufficient_data');
      expect(result.details.reason).toContain('Empty or invalid');
    });

    it('should return insufficient_data for single sentence', async () => {
      const result = await scorer.calculateCoherence('Just one sentence.');

      expect(result.method).toBe('insufficient_data');
      expect(result.overallScore).toBe(1.0);
    });

    it('should calculate coherence for valid multi-sentence content', async () => {
      const content = 'First sentence about topic A. Second sentence also about topic A. Third sentence continuing topic A.';

      // Mock embeddings that are similar (coherent)
      mockOpenAI.getEmbeddings.mockResolvedValue([
        [1, 0, 0],
        [0.98, 0.02, 0],
        [0.96, 0.04, 0],
      ]);

      const result = await scorer.calculateCoherence(content);

      expect(result.method).toBe('embedding_based');
      expect(result.overallScore).toBeGreaterThan(0.5);
      expect(result.centroidCoherence).toBeDefined();
      expect(result.pairwiseCoherence).toBeDefined();
      expect(result.varianceScore).toBeDefined();
      expect(result.details.sentenceCount).toBe(3);
    });

    it('should detect low coherence for diverse content', async () => {
      const content = 'Machine learning is AI. Cooking requires skill. Basketball is popular.';

      // Mock embeddings that are orthogonal (low coherence)
      mockOpenAI.getEmbeddings.mockResolvedValue([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]);

      const result = await scorer.calculateCoherence(content);

      expect(result.method).toBe('embedding_based');
      expect(result.overallScore).toBeLessThan(0.7);
    });

    it('should handle chunk object input', async () => {
      const chunk = { content: 'Sentence one. Sentence two.' };

      mockOpenAI.getEmbeddings.mockResolvedValue([
        [1, 0, 0],
        [0.99, 0.01, 0],
      ]);

      const result = await scorer.calculateCoherence(chunk);

      expect(result.method).toBe('embedding_based');
      expect(result.details.sentenceCount).toBe(2);
    });
  });

  describe('calculateBatchCoherence', () => {
    it('should return empty result for empty array', async () => {
      const result = await scorer.calculateBatchCoherence([]);

      expect(result.results).toEqual([]);
      expect(result.aggregate).toBeNull();
    });

    it('should calculate coherence for multiple chunks', async () => {
      const chunks = [
        'First chunk sentence one. First chunk sentence two.',
        'Second chunk sentence one. Second chunk sentence two.',
      ];

      mockOpenAI.getEmbeddings
        .mockResolvedValueOnce([[1, 0, 0], [0.99, 0.01, 0]])
        .mockResolvedValueOnce([[0, 1, 0], [0.01, 0.99, 0]]);

      const result = await scorer.calculateBatchCoherence(chunks);

      expect(result.results).toHaveLength(2);
      expect(result.aggregate).toBeDefined();
      expect(result.aggregate.validChunks).toBe(2);
      expect(result.aggregate.meanCoherence).toBeDefined();
      expect(result.summary).toContain('Analyzed');
    });

    it('should include aggregate statistics', async () => {
      const chunks = [
        'A coherent chunk. About one topic.',
        'Another chunk. Same structure.',
      ];

      mockOpenAI.getEmbeddings
        .mockResolvedValueOnce([[1, 0, 0], [0.9, 0.1, 0]])
        .mockResolvedValueOnce([[0.8, 0.2, 0], [0.85, 0.15, 0]]);

      const result = await scorer.calculateBatchCoherence(chunks);

      expect(result.aggregate.meanCoherence).toBeGreaterThan(0);
      expect(result.aggregate.medianCoherence).toBeGreaterThan(0);
      expect(result.aggregate.stdDevCoherence).toBeDefined();
      expect(result.aggregate.minCoherence).toBeLessThanOrEqual(result.aggregate.maxCoherence);
    });
  });

  describe('quickCoherenceCheck', () => {
    it('should return low confidence for single sentence', async () => {
      const result = await scorer.quickCoherenceCheck('Single sentence.');

      expect(result.confidence).toBe('low');
      expect(result.estimate).toBe(1.0);
    });

    it('should sample sentences for large chunks', async () => {
      const sentences = Array(20).fill('Sentence about topic.').join(' ');

      mockOpenAI.getEmbeddings.mockResolvedValue([
        [1, 0, 0],
        [0.98, 0.02, 0],
        [0.96, 0.04, 0],
        [0.94, 0.06, 0],
        [0.92, 0.08, 0],
      ]);

      const result = await scorer.quickCoherenceCheck(sentences, 5);

      expect(result.sampledSentences).toBe(5);
      expect(result.confidence).toBe('medium');
    });

    it('should return high confidence for small chunks', async () => {
      const content = 'First. Second. Third.';

      mockOpenAI.getEmbeddings.mockResolvedValue([
        [1, 0, 0],
        [0.99, 0.01, 0],
        [0.98, 0.02, 0],
      ]);

      const result = await scorer.quickCoherenceCheck(content, 5);

      expect(result.confidence).toBe('high');
    });
  });

  describe('formatCoherenceScore', () => {
    it('should format insufficient_data result', () => {
      const result = {
        method: 'insufficient_data',
        details: { reason: 'Too few sentences' },
      };

      const formatted = formatCoherenceScore(result);

      expect(formatted).toContain('N/A');
      expect(formatted).toContain('Too few sentences');
    });

    it('should format valid coherence result', () => {
      const result = {
        method: 'embedding_based',
        overallScore: 0.85,
        centroidCoherence: 0.9,
        pairwiseCoherence: 0.8,
        varianceScore: 0.85,
        details: {
          sentenceCount: 5,
          minSimilarity: 0.7,
          maxSimilarity: 0.95,
          pairwiseSkipped: false,
        },
      };

      const formatted = formatCoherenceScore(result);

      expect(formatted).toContain('0.850');
      expect(formatted).toContain('Excellent');
      expect(formatted).toContain('Centroid coherence');
      expect(formatted).toContain('5');
    });

    it('should label quality levels correctly', () => {
      const createResult = (score) => ({
        method: 'embedding_based',
        overallScore: score,
        centroidCoherence: score,
        pairwiseCoherence: score,
        varianceScore: score,
        details: { sentenceCount: 3, minSimilarity: score, maxSimilarity: score, pairwiseSkipped: false },
      });

      expect(formatCoherenceScore(createResult(0.85))).toContain('Excellent');
      expect(formatCoherenceScore(createResult(0.65))).toContain('Good');
      expect(formatCoherenceScore(createResult(0.45))).toContain('Moderate');
      expect(formatCoherenceScore(createResult(0.25))).toContain('Low');
    });
  });

  describe('formatBatchCoherence', () => {
    it('should format batch results with summary', () => {
      const batchResult = {
        results: [
          { chunkIndex: 0, method: 'embedding_based', overallScore: 0.8 },
          { chunkIndex: 1, method: 'embedding_based', overallScore: 0.3 },
        ],
        aggregate: {
          meanCoherence: 0.55,
          medianCoherence: 0.55,
          stdDevCoherence: 0.25,
          minCoherence: 0.3,
          maxCoherence: 0.8,
          validChunks: 2,
          totalChunks: 2,
        },
        summary: 'Analyzed 2/2 chunks. Mean coherence: 0.550 (good).',
      };

      const formatted = formatBatchCoherence(batchResult);

      expect(formatted).toContain('Analyzed 2/2');
      expect(formatted).toContain('Mean: 0.550');
      expect(formatted).toContain('Low Coherence Chunks');
      expect(formatted).toContain('Chunk 1');
    });

    it('should handle no aggregate data', () => {
      const batchResult = {
        results: [],
        aggregate: null,
        summary: 'No valid chunks to analyze',
      };

      const formatted = formatBatchCoherence(batchResult);

      expect(formatted).toContain('No valid chunks');
    });
  });

  describe('getChunkCoherenceScorer', () => {
    it('should return singleton instance', () => {
      const scorer1 = getChunkCoherenceScorer();
      const scorer2 = getChunkCoherenceScorer();

      expect(scorer1).toBe(scorer2);
    });

    it('should create new instance with options', () => {
      const scorer1 = getChunkCoherenceScorer();
      const scorer2 = getChunkCoherenceScorer({ minSentencesForCoherence: 3 });

      expect(scorer2.config.minSentencesForCoherence).toBe(3);
    });
  });

  describe('statistical helpers', () => {
    it('should calculate mean correctly', () => {
      expect(scorer._mean([1, 2, 3, 4, 5])).toBe(3);
      expect(scorer._mean([])).toBe(0);
    });

    it('should calculate median correctly', () => {
      expect(scorer._median([1, 2, 3, 4, 5])).toBe(3);
      expect(scorer._median([1, 2, 3, 4])).toBe(2.5);
      expect(scorer._median([])).toBe(0);
    });

    it('should calculate variance correctly', () => {
      expect(scorer._variance([1, 1, 1, 1])).toBe(0);
      expect(scorer._variance([1, 2])).toBeCloseTo(0.25, 5);
    });

    it('should calculate stdDev correctly', () => {
      expect(scorer._stdDev([1, 1, 1, 1])).toBe(0);
      expect(scorer._stdDev([1, 2])).toBeCloseTo(0.5, 5);
    });
  });

  describe('_sampleSentences', () => {
    it('should return all sentences if count is below sample size', () => {
      const sentences = ['A.', 'B.', 'C.'];
      const sampled = scorer._sampleSentences(sentences, 5);

      expect(sampled).toEqual(sentences);
    });

    it('should sample evenly distributed sentences', () => {
      const sentences = ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.', 'I.', 'J.'];
      const sampled = scorer._sampleSentences(sentences, 3);

      expect(sampled).toHaveLength(3);
      // Should include first, middle, and later sentences
      expect(sampled[0]).toBe('A.');
    });
  });
});
