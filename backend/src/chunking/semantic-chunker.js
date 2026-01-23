/**
 * Semantic Chunker Service
 *
 * Implements semantic chunking based on the LlamaIndex SemanticSplitter approach.
 * Instead of splitting text at fixed token boundaries, this chunker:
 * 1. Splits text into sentences
 * 2. Generates embeddings for sentence groups (with buffer context)
 * 3. Calculates cosine similarity between adjacent groups
 * 4. Identifies topic boundaries using percentile-based thresholds
 * 5. Creates chunks between semantic breakpoints
 *
 * Features:
 * - F4.1.1: Topic Detection - Uses embeddings to detect topic boundaries
 * - F4.1.2: Semantic Chunk Splitter - Split documents at topic boundaries
 *
 * Reference: https://docs.llamaindex.ai/en/stable/module_guides/loading/node_parsers/modules/
 */

const { getOpenAIService } = require('../services/openai-service');
const { log } = require('../utils/logger');
const { getChunkCoherenceScorer } = require('./chunk-coherence-score');

// Default configuration parameters
const DEFAULT_CONFIG = {
  // The percentile of cosine dissimilarity that must be exceeded to create a breakpoint
  // Higher values = fewer breakpoints = larger chunks
  // Lower values = more breakpoints = smaller chunks
  breakpointPercentileThreshold: 95,

  // Number of sentences to include on each side when computing embeddings
  // This provides context and helps with more accurate similarity measurements
  bufferSize: 1,

  // Maximum words in a single chunk (fallback to prevent extremely large chunks)
  maxChunkWords: 800,

  // Minimum words in a chunk (merge small chunks with neighbors)
  minChunkWords: 50,

  // Minimum sentences required to apply semantic chunking
  // Below this threshold, return the whole text as a single chunk
  minSentencesForSemantic: 3,

  // Embedding batch size to limit memory usage
  embeddingBatchSize: 16,
};

class SemanticChunker {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.openai = getOpenAIService();
  }

  /**
   * Split text into semantically coherent chunks using topic detection.
   *
   * @param {string} text - The text content to chunk
   * @param {Object} options - Optional configuration overrides
   * @returns {Promise<Object>} Chunking results with chunks and metadata
   */
  async chunkText(text, options = {}) {
    const config = { ...this.config, ...options };
    const startTime = Date.now();

    // Step 1: Split into sentences
    const sentences = this._splitIntoSentences(text);

    log.debug('Semantic chunking: sentence segmentation', {
      totalSentences: sentences.length,
      totalChars: text.length,
    });

    // If too few sentences, return as single chunk
    if (sentences.length < config.minSentencesForSemantic) {
      return {
        chunks: [{
          content: text.trim(),
          sentences: sentences.length,
          startSentence: 0,
          endSentence: sentences.length - 1,
          method: 'single_chunk',
        }],
        metadata: {
          method: 'single_chunk',
          totalSentences: sentences.length,
          breakpoints: [],
          processingTimeMs: Date.now() - startTime,
        },
      };
    }

    // Step 2: Generate distances between adjacent sentence groups (streamed batches)
    const distances = await this._calculateDistancesStreaming(sentences, config);

    // Step 3: Find breakpoints using percentile threshold
    const breakpoints = this._findBreakpoints(distances, config.breakpointPercentileThreshold);

    log.debug('Semantic chunking: topic detection', {
      breakpointsFound: breakpoints.length,
      percentileThreshold: config.breakpointPercentileThreshold,
      distanceStats: this._calculateStats(distances),
    });

    // Step 4: Create chunks from breakpoints
    const rawChunks = this._createChunksFromBreakpoints(sentences, breakpoints);

    // Step 5: Post-process chunks (merge small, split large)
    const chunks = this._postProcessChunks(rawChunks, config);

    const processingTimeMs = Date.now() - startTime;

    log.info('Semantic chunking completed', {
      totalSentences: sentences.length,
      breakpointsFound: breakpoints.length,
      chunksCreated: chunks.length,
      processingTimeMs,
    });

    return {
      chunks,
      metadata: {
        method: 'semantic',
        totalSentences: sentences.length,
        breakpoints: breakpoints.map(bp => ({
          index: bp,
          distance: distances[bp],
        })),
        distanceStats: this._calculateStats(distances),
        processingTimeMs,
        config: {
          breakpointPercentileThreshold: config.breakpointPercentileThreshold,
          bufferSize: config.bufferSize,
          embeddingBatchSize: config.embeddingBatchSize,
        },
      },
    };
  }

  /**
   * Split text into sentences using regex-based tokenization.
   * Handles common abbreviations and edge cases.
   *
   * @param {string} text - Text to split
   * @returns {string[]} Array of sentences
   */
  _splitIntoSentences(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // Normalize whitespace
    const normalized = text.replace(/\s+/g, ' ').trim();

    // Common abbreviations that don't end sentences
    const abbreviations = [
      'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr',
      'vs', 'etc', 'Inc', 'Ltd', 'Corp',
      'St', 'Ave', 'Blvd', 'Rd', 'Dept', 'Fig', 'No',
    ];

    // Protect abbreviations by replacing with placeholder
    let protectedText = normalized;
    const protectedMatches = [];
    let matchIndex = 0;

    abbreviations.forEach((abbr) => {
      const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
      protectedText = protectedText.replace(regex, (match) => {
        const placeholder = `__ABBR${matchIndex}__`;
        protectedMatches.push({ placeholder, original: match });
        matchIndex++;
        return placeholder;
      });
    });

    // Also protect e.g. and i.e.
    protectedText = protectedText.replace(/\be\.g\./gi, (match) => {
      const placeholder = `__ABBR${matchIndex}__`;
      protectedMatches.push({ placeholder, original: match });
      matchIndex++;
      return placeholder;
    });
    protectedText = protectedText.replace(/\bi\.e\./gi, (match) => {
      const placeholder = `__ABBR${matchIndex}__`;
      protectedMatches.push({ placeholder, original: match });
      matchIndex++;
      return placeholder;
    });

    // Split on sentence-ending punctuation followed by space and capital letter
    // Also split on newlines that look like paragraph breaks
    const sentenceRegex = /(?<=[.!?])\s+(?=[A-Z])|(?<=\n)\s*(?=\n)|(?<=\n\n)/g;
    let sentences = protectedText.split(sentenceRegex);

    // Restore abbreviations
    sentences = sentences.map(sentence => {
      let restored = sentence;
      protectedMatches.forEach(({ placeholder, original }) => {
        restored = restored.replace(new RegExp(placeholder, 'g'), original);
      });
      return restored.trim();
    });

    // Filter out empty sentences
    return sentences.filter(s => s && s.length > 0);
  }

  /**
   * Create combined sentences with buffer context for better embeddings.
   * Each combined sentence includes neighboring sentences for context.
   *
   * @param {string[]} sentences - Array of sentences
   * @param {number} bufferSize - Number of sentences to include on each side
   * @returns {string[]} Array of combined sentences
   */
  _createCombinedSentences(sentences, bufferSize) {
    const combined = [];

    for (let i = 0; i < sentences.length; i++) {
      combined.push(this._buildCombinedSentence(sentences, i, bufferSize));
    }

    return combined;
  }

  /**
   * Build a combined sentence with buffer context without allocating extra arrays.
   *
   * @param {string[]} sentences - Array of sentences
   * @param {number} index - Sentence index to build around
   * @param {number} bufferSize - Number of sentences to include on each side
   * @returns {string} Combined sentence text
   */
  _buildCombinedSentence(sentences, index, bufferSize) {
    const safeBuffer = Math.max(0, bufferSize || 0);
    const start = Math.max(0, index - safeBuffer);
    const end = Math.min(sentences.length - 1, index + safeBuffer);

    let combined = '';
    for (let i = start; i <= end; i++) {
      combined += (combined.length > 0 ? ' ' : '') + sentences[i];
    }

    return combined;
  }

  /**
   * Generate embeddings for combined sentences.
   * Uses batch processing for efficiency.
   *
   * @param {string[]} combinedSentences - Array of combined sentence texts
   * @returns {Promise<number[][]>} Array of embedding vectors
   */
  async _generateSentenceEmbeddings(combinedSentences) {
    // Use batch embedding for efficiency
    const embeddings = await this.openai.getEmbeddings(combinedSentences);
    return embeddings;
  }

  /**
   * Generate distances between adjacent sentences using streamed embedding batches.
   * Avoids retaining all embeddings in memory at once.
   *
   * @param {string[]} sentences - Array of sentences
   * @param {Object} config - Chunker configuration
   * @returns {Promise<number[]>} Array of distances
   */
  async _calculateDistancesStreaming(sentences, config) {
    const distances = [];
    const batchSize = Math.max(1, config.embeddingBatchSize || 16);
    let previousEmbedding = null;

    for (let start = 0; start < sentences.length; start += batchSize) {
      const batchTexts = [];
      const batchEnd = Math.min(sentences.length, start + batchSize);

      for (let i = start; i < batchEnd; i++) {
        batchTexts.push(this._buildCombinedSentence(sentences, i, config.bufferSize));
      }

      const embeddings = await this._generateSentenceEmbeddings(batchTexts);
      if (!embeddings || embeddings.length !== batchTexts.length) {
        throw new Error(`Embedding batch size mismatch: expected ${batchTexts.length}, received ${embeddings?.length || 0}`);
      }

      for (const embedding of embeddings) {
        if (previousEmbedding) {
          distances.push(1 - this._cosineSimilarity(previousEmbedding, embedding));
        }
        previousEmbedding = embedding;
      }
    }

    return distances;
  }

  /**
   * Calculate cosine distances between adjacent sentence embeddings.
   * Distance = 1 - similarity (higher distance = more dissimilar = topic change)
   *
   * @param {number[][]} embeddings - Array of embedding vectors
   * @returns {number[]} Array of distances between adjacent embeddings
   */
  _calculateDistances(embeddings) {
    const distances = [];

    for (let i = 0; i < embeddings.length - 1; i++) {
      const similarity = this._cosineSimilarity(embeddings[i], embeddings[i + 1]);
      const distance = 1 - similarity;
      distances.push(distance);
    }

    return distances;
  }

  /**
   * Calculate cosine similarity between two vectors.
   *
   * @param {number[]} vecA - First vector
   * @param {number[]} vecB - Second vector
   * @returns {number} Cosine similarity (0 to 1)
   */
  _cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * Find breakpoint indices using percentile threshold.
   * A breakpoint occurs when the distance between adjacent sentences
   * exceeds the Nth percentile of all distances.
   *
   * @param {number[]} distances - Array of distances
   * @param {number} percentileThreshold - Percentile threshold (0-100)
   * @returns {number[]} Array of breakpoint indices
   */
  _findBreakpoints(distances, percentileThreshold) {
    if (distances.length === 0) {
      return [];
    }

    // Calculate the percentile threshold value
    const sortedDistances = [...distances].sort((a, b) => a - b);

    // For small arrays, use a more lenient approach
    // Calculate the index just before the percentile cutoff
    const percentileIndex = Math.floor((percentileThreshold / 100) * (sortedDistances.length - 1));
    const thresholdValue = sortedDistances[percentileIndex];

    // Find indices where distance is strictly greater than threshold
    // OR is at the maximum if we want to ensure at least one breakpoint for clear topic changes
    const breakpoints = [];
    for (let i = 0; i < distances.length; i++) {
      if (distances[i] > thresholdValue) {
        breakpoints.push(i);
      }
    }

    return breakpoints;
  }

  /**
   * Create chunks from sentences using breakpoint indices.
   *
   * @param {string[]} sentences - Array of sentences
   * @param {number[]} breakpoints - Array of breakpoint indices
   * @returns {Object[]} Array of chunk objects
   */
  _createChunksFromBreakpoints(sentences, breakpoints) {
    const chunks = [];

    // Add end as final breakpoint
    const allBreakpoints = [...breakpoints, sentences.length - 1];

    let startIdx = 0;
    for (const breakpoint of allBreakpoints) {
      // Sentences from startIdx to breakpoint (inclusive)
      const endIdx = breakpoint + 1;
      const chunkSentences = sentences.slice(startIdx, endIdx);

      if (chunkSentences.length > 0) {
        chunks.push({
          content: chunkSentences.join(' ').trim(),
          sentences: chunkSentences.length,
          startSentence: startIdx,
          endSentence: endIdx - 1,
          method: 'semantic',
        });
      }

      startIdx = endIdx;
    }

    return chunks;
  }

  /**
   * Post-process chunks to handle edge cases:
   * - Merge chunks that are too small
   * - Split chunks that are too large
   *
   * @param {Object[]} chunks - Array of chunk objects
   * @param {Object} config - Configuration with min/max chunk sizes
   * @returns {Object[]} Processed chunks
   */
  _postProcessChunks(chunks, config) {
    const processed = [];
    let currentChunk = null;

    for (const chunk of chunks) {
      const wordCount = chunk.content.split(/\s+/).length;

      if (currentChunk) {
        const currentWords = currentChunk.content.split(/\s+/).length;

        // If current accumulated chunk is still small, merge
        if (currentWords < config.minChunkWords) {
          currentChunk = {
            content: currentChunk.content + ' ' + chunk.content,
            sentences: currentChunk.sentences + chunk.sentences,
            startSentence: currentChunk.startSentence,
            endSentence: chunk.endSentence,
            method: 'semantic_merged',
          };
          continue;
        } else {
          processed.push(currentChunk);
          currentChunk = null;
        }
      }

      // If chunk is too small, start accumulating
      if (wordCount < config.minChunkWords) {
        currentChunk = { ...chunk };
        continue;
      }

      // If chunk is too large, split it
      if (wordCount > config.maxChunkWords) {
        const splitChunks = this._splitLargeChunk(chunk, config.maxChunkWords);
        processed.push(...splitChunks);
        continue;
      }

      // Normal-sized chunk
      processed.push(chunk);
    }

    // Don't forget the last accumulated chunk
    if (currentChunk) {
      processed.push(currentChunk);
    }

    return processed;
  }

  /**
   * Split a chunk that exceeds max word limit.
   * Falls back to word-based splitting with overlap.
   *
   * @param {Object} chunk - Chunk to split
   * @param {number} maxWords - Maximum words per chunk
   * @returns {Object[]} Array of smaller chunks
   */
  _splitLargeChunk(chunk, maxWords) {
    const words = chunk.content.split(/\s+/);
    const chunks = [];
    const overlap = 30; // Words of overlap between split chunks

    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + maxWords, words.length);
      const content = words.slice(start, end).join(' ');

      chunks.push({
        content,
        sentences: -1, // Unknown after word-based split
        startSentence: chunk.startSentence,
        endSentence: chunk.endSentence,
        method: 'semantic_split',
      });

      start = end - overlap;
      if (start <= 0 || start >= words.length) break;
    }

    return chunks;
  }

  /**
   * Calculate statistics for distance array.
   *
   * @param {number[]} distances - Array of distances
   * @returns {Object} Statistics object
   */
  _calculateStats(distances) {
    if (distances.length === 0) {
      return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
    }

    const sorted = [...distances].sort((a, b) => a - b);
    const sum = distances.reduce((a, b) => a + b, 0);
    const mean = sum / distances.length;

    const squaredDiffs = distances.map(d => Math.pow(d - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / distances.length;
    const stdDev = Math.sqrt(variance);

    const medianIdx = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[medianIdx - 1] + sorted[medianIdx]) / 2
      : sorted[medianIdx];

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Number(mean.toFixed(4)),
      median: Number(median.toFixed(4)),
      stdDev: Number(stdDev.toFixed(4)),
    };
  }

  /**
   * Calculate coherence scores for chunks.
   * F4.1.3: Measure semantic coherence within each chunk.
   *
   * @param {Object[]} chunks - Array of chunk objects with 'content' property
   * @param {Object} options - Optional configuration for coherence scorer
   * @returns {Promise<Object>} Batch coherence result with individual and aggregate scores
   */
  async calculateChunkCoherence(chunks, options = {}) {
    const scorer = getChunkCoherenceScorer(options);
    return scorer.calculateBatchCoherence(chunks, options);
  }

  /**
   * Chunk text with coherence scoring.
   * Combines semantic chunking with quality measurement.
   *
   * @param {string} text - The text content to chunk
   * @param {Object} options - Optional configuration overrides
   * @returns {Promise<Object>} Chunking results with chunks, metadata, and coherence scores
   */
  async chunkTextWithCoherence(text, options = {}) {
    // First, perform semantic chunking
    const result = await this.chunkText(text, options);

    // Then calculate coherence scores for all chunks
    const coherenceResult = await this.calculateChunkCoherence(result.chunks, options);

    // Merge coherence scores into individual chunks
    const chunksWithCoherence = result.chunks.map((chunk, idx) => {
      const coherence = coherenceResult.results[idx];
      return {
        ...chunk,
        coherenceScore: coherence.overallScore,
        coherenceDetails: {
          centroidCoherence: coherence.centroidCoherence,
          pairwiseCoherence: coherence.pairwiseCoherence,
          varianceScore: coherence.varianceScore,
          method: coherence.method,
        },
      };
    });

    return {
      chunks: chunksWithCoherence,
      metadata: {
        ...result.metadata,
        coherence: coherenceResult.aggregate,
        coherenceSummary: coherenceResult.summary,
      },
    };
  }
}

// Singleton instance
let instance = null;

function getSemanticChunker(options = {}) {
  if (!instance || Object.keys(options).length > 0) {
    instance = new SemanticChunker(options);
  }
  return instance;
}

module.exports = {
  SemanticChunker,
  getSemanticChunker,
  DEFAULT_CONFIG,
};
