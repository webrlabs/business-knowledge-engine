/**
 * Tests for Semantic Chunker
 *
 * Features:
 * - F4.1.1: Topic Detection - Uses embeddings to detect topic boundaries
 * - F4.1.2: Semantic Chunk Splitter - Split documents at topic boundaries
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

const { SemanticChunker, DEFAULT_CONFIG } = require('../semantic-chunker');
const { getOpenAIService } = require('../../services/openai-service');

describe('SemanticChunker', () => {
  let chunker;
  let mockOpenAI;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenAI = {
      getEmbeddings: jest.fn().mockResolvedValue([]),
    };
    getOpenAIService.mockReturnValue(mockOpenAI);
    chunker = new SemanticChunker();
  });

  describe('_splitIntoSentences', () => {
    it('should split text into sentences on period followed by capital', () => {
      const text = 'This is sentence one. This is sentence two. And this is three.';
      const sentences = chunker._splitIntoSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe('This is sentence one.');
      expect(sentences[1]).toBe('This is sentence two.');
      expect(sentences[2]).toBe('And this is three.');
    });

    it('should handle abbreviations correctly', () => {
      // Test that common abbreviations don't incorrectly split sentences
      const text = 'Dr. Smith and Mr. Jones met Prof. Lee at the conference.';
      const sentences = chunker._splitIntoSentences(text);

      // Should be kept as single sentence since Dr., Mr., Prof. are abbreviations
      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe('Dr. Smith and Mr. Jones met Prof. Lee at the conference.');
    });

    it('should split after abbreviation when followed by new sentence', () => {
      // When an abbreviation is followed by a clear sentence start, it should split
      const text = 'I met Dr. Smith. She is a doctor. He met Prof. Lee.';
      const sentences = chunker._splitIntoSentences(text);

      expect(sentences).toHaveLength(3);
    });

    it('should handle exclamation and question marks', () => {
      const text = 'What is this? It is amazing! I agree.';
      const sentences = chunker._splitIntoSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toBe('What is this?');
      expect(sentences[1]).toBe('It is amazing!');
      expect(sentences[2]).toBe('I agree.');
    });

    it('should return empty array for empty text', () => {
      expect(chunker._splitIntoSentences('')).toEqual([]);
      expect(chunker._splitIntoSentences(null)).toEqual([]);
      expect(chunker._splitIntoSentences(undefined)).toEqual([]);
    });

    it('should handle single sentence', () => {
      const text = 'This is a single sentence without ending period';
      const sentences = chunker._splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe(text);
    });
  });

  describe('_createCombinedSentences', () => {
    it('should combine sentences with buffer context', () => {
      const sentences = ['A.', 'B.', 'C.', 'D.', 'E.'];

      const combined = chunker._createCombinedSentences(sentences, 1);

      expect(combined).toHaveLength(5);
      expect(combined[0]).toBe('A. B.');
      expect(combined[2]).toBe('B. C. D.');
      expect(combined[4]).toBe('D. E.');
    });

    it('should handle buffer size of 0', () => {
      const sentences = ['A.', 'B.', 'C.'];

      const combined = chunker._createCombinedSentences(sentences, 0);

      expect(combined).toHaveLength(3);
      expect(combined[0]).toBe('A.');
      expect(combined[1]).toBe('B.');
      expect(combined[2]).toBe('C.');
    });
  });

  describe('_cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const vec = [1, 2, 3, 4, 5];
      expect(chunker._cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
      const vec1 = [1, 0, 0];
      const vec2 = [0, 1, 0];
      expect(chunker._cosineSimilarity(vec1, vec2)).toBeCloseTo(0, 5);
    });

    it('should handle zero vectors', () => {
      const vec1 = [0, 0, 0];
      const vec2 = [1, 2, 3];
      expect(chunker._cosineSimilarity(vec1, vec2)).toBe(0);
    });
  });

  describe('_calculateDistances', () => {
    it('should calculate distances between adjacent embeddings', () => {
      const embeddings = [
        [1, 0, 0],
        [0.9, 0.1, 0],
        [0, 0, 1],
      ];

      const distances = chunker._calculateDistances(embeddings);

      expect(distances).toHaveLength(2);
      expect(distances[0]).toBeLessThan(0.2);
      expect(distances[1]).toBeGreaterThan(0.8);
    });

    it('should return empty array for single embedding', () => {
      const distances = chunker._calculateDistances([[1, 2, 3]]);
      expect(distances).toEqual([]);
    });
  });

  describe('_findBreakpoints', () => {
    it('should find breakpoints at high distance indices', () => {
      // Create a clear outlier that should be detected
      const distances = [0.1, 0.15, 0.9, 0.12];

      // Use a lower percentile to ensure the outlier is caught
      const breakpoints = chunker._findBreakpoints(distances, 75);

      expect(breakpoints).toContain(2);
    });

    it('should return empty for uniform distances', () => {
      const distances = [0.5, 0.5, 0.5, 0.5];

      const breakpoints = chunker._findBreakpoints(distances, 95);

      expect(breakpoints).toHaveLength(0);
    });

    it('should find breakpoints with very high threshold', () => {
      // Even with 95th percentile, a huge outlier should be found
      const distances = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.95];

      const breakpoints = chunker._findBreakpoints(distances, 95);

      // The 0.95 distance (at index 9) should be found
      expect(breakpoints).toContain(9);
    });
  });

  describe('_createChunksFromBreakpoints', () => {
    it('should create chunks between breakpoints', () => {
      const sentences = ['A.', 'B.', 'C.', 'D.', 'E.'];
      const breakpoints = [1, 3];

      const chunks = chunker._createChunksFromBreakpoints(sentences, breakpoints);

      expect(chunks).toHaveLength(3);
      expect(chunks[0].content).toBe('A. B.');
      expect(chunks[1].content).toBe('C. D.');
      expect(chunks[2].content).toBe('E.');
    });

    it('should handle no breakpoints (single chunk)', () => {
      const sentences = ['A.', 'B.', 'C.'];
      const breakpoints = [];

      const chunks = chunker._createChunksFromBreakpoints(sentences, breakpoints);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('A. B. C.');
    });
  });

  describe('_calculateStats', () => {
    it('should calculate correct statistics', () => {
      const distances = [0.1, 0.2, 0.3, 0.4, 0.5];

      const stats = chunker._calculateStats(distances);

      expect(stats.min).toBe(0.1);
      expect(stats.max).toBe(0.5);
      expect(stats.mean).toBeCloseTo(0.3, 4);
      expect(stats.median).toBe(0.3);
    });

    it('should handle empty array', () => {
      const stats = chunker._calculateStats([]);

      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.mean).toBe(0);
    });
  });

  describe('chunkText', () => {
    it('should return single chunk for very short text', async () => {
      const text = 'Short text.';

      const result = await chunker.chunkText(text);

      expect(result.chunks).toHaveLength(1);
      expect(result.metadata.method).toBe('single_chunk');
    });

    it('should use semantic chunking for longer text', async () => {
      const sentences = [
        'Machine learning is a branch of artificial intelligence.',
        'It allows computers to learn from data.',
        'Deep learning is a subset of machine learning.',
        'It uses neural networks with many layers.',
        'Now lets talk about cooking.',
        'Cooking is the art of preparing food.',
        'Recipes provide instructions for dishes.',
        'Chefs are trained in culinary arts.',
      ];
      const text = sentences.join(' ');

      const mlEmbedding = [1, 0, 0];
      const cookingEmbedding = [0, 1, 0];

      mockOpenAI.getEmbeddings.mockResolvedValue([
        mlEmbedding,
        mlEmbedding,
        mlEmbedding,
        mlEmbedding,
        cookingEmbedding,
        cookingEmbedding,
        cookingEmbedding,
        cookingEmbedding,
      ]);

      // Use a lower percentile so the clear topic change is detected
      const result = await chunker.chunkText(text, {
        breakpointPercentileThreshold: 75,
      });

      expect(result.metadata.method).toBe('semantic');
      // The topic change between ML and cooking should be detected
      expect(result.metadata.breakpoints.length).toBeGreaterThan(0);
    });

    it('should include processing metadata', async () => {
      const text = 'Sentence one. Sentence two. Sentence three. Sentence four.';

      mockOpenAI.getEmbeddings.mockResolvedValue([
        [1, 0, 0],
        [0.99, 0.01, 0],
        [0.98, 0.02, 0],
        [0.97, 0.03, 0],
      ]);

      const result = await chunker.chunkText(text);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.totalSentences).toBe(4);
      expect(result.metadata.distanceStats).toBeDefined();
      expect(result.metadata.processingTimeMs).toBeDefined();
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.breakpointPercentileThreshold).toBe(95);
      expect(DEFAULT_CONFIG.bufferSize).toBe(1);
      expect(DEFAULT_CONFIG.maxChunkWords).toBe(800);
      expect(DEFAULT_CONFIG.minChunkWords).toBe(50);
      expect(DEFAULT_CONFIG.minSentencesForSemantic).toBe(3);
      expect(DEFAULT_CONFIG.embeddingBatchSize).toBe(16);
    });
  });
});
