/**
 * Chunk Coherence Score Calculator
 *
 * F4.1.3: Measure semantic coherence within each chunk
 *
 * Implements multiple coherence scoring methods:
 * 1. Centroid-based coherence: Average cosine similarity of sentences to the chunk centroid
 * 2. Pairwise coherence: Average pairwise cosine similarity between sentences
 * 3. Variance-based measure: Lower variance in sentence distances indicates higher coherence
 *
 * Research basis:
 * - Centroid coherence measures how well sentences cluster around a central topic
 * - Pairwise coherence captures direct semantic relationships between sentences
 * - WCSS (Within-Cluster Sum of Squares) concept from clustering evaluation
 *
 * References:
 * - Chroma Research: "Evaluating Chunking" (Token-wise IoU, ClusterSemanticChunker)
 * - Max-Min semantic chunking (Springer, 2025) - AMI scores for coherence
 * - NVIDIA chunking evaluation - Page-level accuracy benchmarks
 */

const { getOpenAIService } = require('../services/openai-service');
const { log } = require('../utils/logger');

// Configuration for coherence scoring
const DEFAULT_CONFIG = {
  // Minimum sentences required to calculate meaningful coherence
  minSentencesForCoherence: 2,

  // Maximum sentences to use for pairwise calculation (O(n²) complexity)
  maxSentencesForPairwise: 50,

  // Weights for combined score calculation
  weights: {
    centroid: 0.5,    // Weight for centroid-based coherence
    pairwise: 0.3,    // Weight for pairwise coherence
    variance: 0.2,    // Weight for variance-based measure (inverted)
  },

  // Embedding batch size
  embeddingBatchSize: 16,
};

// Common abbreviations that don't end sentences (shared with semantic-chunker)
const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr',
  'vs', 'etc', 'Inc', 'Ltd', 'Corp',
  'St', 'Ave', 'Blvd', 'Rd', 'Dept', 'Fig', 'No',
];

/**
 * Coherence score result structure
 * @typedef {Object} CoherenceScoreResult
 * @property {number} overallScore - Combined coherence score (0-1, higher = more coherent)
 * @property {number} centroidCoherence - Average similarity to centroid (0-1)
 * @property {number} pairwiseCoherence - Average pairwise similarity (0-1)
 * @property {number} varianceScore - Inverted variance measure (0-1, higher = lower variance)
 * @property {Object} details - Detailed breakdown
 * @property {number} details.sentenceCount - Number of sentences analyzed
 * @property {number} details.centroidDistanceStdDev - Standard deviation of distances from centroid
 * @property {number} details.minSimilarity - Minimum pairwise similarity found
 * @property {number} details.maxSimilarity - Maximum pairwise similarity found
 * @property {string} method - Method used ('embedding_based' or 'insufficient_data')
 */

class ChunkCoherenceScorer {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.openai = getOpenAIService();
  }

  /**
   * Calculate coherence score for a single chunk.
   *
   * @param {string|Object} chunk - Chunk content string or chunk object with 'content' property
   * @param {Object} options - Optional configuration overrides
   * @returns {Promise<CoherenceScoreResult>} Coherence score result
   */
  async calculateCoherence(chunk, options = {}) {
    const config = { ...this.config, ...options };
    const content = typeof chunk === 'string' ? chunk : chunk.content;

    if (!content || typeof content !== 'string') {
      return this._createInsufficientDataResult('Empty or invalid content');
    }

    const startTime = Date.now();

    // Split into sentences
    const sentences = this._splitIntoSentences(content);

    if (sentences.length < config.minSentencesForCoherence) {
      return this._createInsufficientDataResult(
        `Only ${sentences.length} sentence(s), need at least ${config.minSentencesForCoherence}`,
        sentences.length
      );
    }

    try {
      // Generate embeddings for all sentences
      const embeddings = await this._generateEmbeddings(sentences, config);

      // Calculate centroid (mean embedding)
      const centroid = this._calculateCentroid(embeddings);

      // Calculate centroid-based coherence
      const centroidResult = this._calculateCentroidCoherence(embeddings, centroid);

      // Calculate pairwise coherence (if sentence count is manageable)
      const pairwiseResult = sentences.length <= config.maxSentencesForPairwise
        ? this._calculatePairwiseCoherence(embeddings)
        : { score: centroidResult.score, skipped: true }; // Fallback to centroid if too many sentences

      // Calculate variance-based score
      const varianceScore = this._calculateVarianceScore(centroidResult.distances);

      // Combine scores
      const overallScore = this._combineScores(
        centroidResult.score,
        pairwiseResult.score,
        varianceScore,
        config.weights
      );

      const processingTimeMs = Date.now() - startTime;

      log.debug('Chunk coherence calculated', {
        sentenceCount: sentences.length,
        overallScore: overallScore.toFixed(4),
        centroidCoherence: centroidResult.score.toFixed(4),
        pairwiseCoherence: pairwiseResult.score.toFixed(4),
        varianceScore: varianceScore.toFixed(4),
        processingTimeMs,
      });

      return {
        overallScore,
        centroidCoherence: centroidResult.score,
        pairwiseCoherence: pairwiseResult.score,
        varianceScore,
        details: {
          sentenceCount: sentences.length,
          centroidDistanceStdDev: centroidResult.stdDev,
          minSimilarity: pairwiseResult.min ?? centroidResult.min,
          maxSimilarity: pairwiseResult.max ?? centroidResult.max,
          pairwiseSkipped: pairwiseResult.skipped || false,
        },
        method: 'embedding_based',
        processingTimeMs,
      };
    } catch (error) {
      log.error('Error calculating chunk coherence', {
        error: error.message,
        sentenceCount: sentences.length,
      });
      throw error;
    }
  }

  /**
   * Calculate coherence scores for multiple chunks.
   *
   * @param {Array<string|Object>} chunks - Array of chunk content strings or chunk objects
   * @param {Object} options - Optional configuration overrides
   * @returns {Promise<Object>} Batch result with individual and aggregate scores
   */
  async calculateBatchCoherence(chunks, options = {}) {
    if (!chunks || chunks.length === 0) {
      return {
        results: [],
        aggregate: null,
        summary: 'No chunks provided',
      };
    }

    const startTime = Date.now();
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const result = await this.calculateCoherence(chunk, options);
      results.push({
        chunkIndex: i,
        ...result,
      });
    }

    // Calculate aggregate statistics
    const validResults = results.filter(r => r.method === 'embedding_based');

    const aggregate = validResults.length > 0 ? {
      meanCoherence: this._mean(validResults.map(r => r.overallScore)),
      medianCoherence: this._median(validResults.map(r => r.overallScore)),
      minCoherence: Math.min(...validResults.map(r => r.overallScore)),
      maxCoherence: Math.max(...validResults.map(r => r.overallScore)),
      stdDevCoherence: this._stdDev(validResults.map(r => r.overallScore)),
      validChunks: validResults.length,
      totalChunks: chunks.length,
    } : null;

    const processingTimeMs = Date.now() - startTime;

    log.info('Batch chunk coherence calculated', {
      totalChunks: chunks.length,
      validChunks: validResults.length,
      meanCoherence: aggregate?.meanCoherence?.toFixed(4),
      processingTimeMs,
    });

    return {
      results,
      aggregate,
      summary: this._generateBatchSummary(results, aggregate),
      processingTimeMs,
    };
  }

  /**
   * Quick coherence check without full analysis.
   * Uses sampling for faster results on large chunks.
   *
   * @param {string|Object} chunk - Chunk content
   * @param {number} sampleSize - Number of sentences to sample (default: 5)
   * @returns {Promise<Object>} Quick coherence estimate
   */
  async quickCoherenceCheck(chunk, sampleSize = 5) {
    const content = typeof chunk === 'string' ? chunk : chunk.content;
    const sentences = this._splitIntoSentences(content);

    if (sentences.length < 2) {
      return {
        estimate: 1.0,
        confidence: 'low',
        reason: 'Too few sentences for meaningful coherence',
      };
    }

    // Sample sentences if there are many
    const sampled = sentences.length <= sampleSize
      ? sentences
      : this._sampleSentences(sentences, sampleSize);

    const embeddings = await this._generateEmbeddings(sampled);
    const centroid = this._calculateCentroid(embeddings);
    const { score } = this._calculateCentroidCoherence(embeddings, centroid);

    return {
      estimate: score,
      confidence: sentences.length <= sampleSize ? 'high' : 'medium',
      sampledSentences: sampled.length,
      totalSentences: sentences.length,
    };
  }

  /**
   * Split text into sentences (adapted from semantic-chunker).
   * @private
   */
  _splitIntoSentences(text) {
    if (!text || typeof text !== 'string') {
      return [];
    }

    const normalized = text.replace(/\s+/g, ' ').trim();

    // Protect abbreviations
    let protectedText = normalized;
    const protectedMatches = [];
    let matchIndex = 0;

    ABBREVIATIONS.forEach((abbr) => {
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

    return sentences.filter(s => s && s.length > 0);
  }

  /**
   * Generate embeddings for sentences using OpenAI service.
   * @private
   */
  async _generateEmbeddings(sentences, config = this.config) {
    const batchSize = config.embeddingBatchSize || 16;
    const embeddings = [];

    for (let i = 0; i < sentences.length; i += batchSize) {
      const batch = sentences.slice(i, i + batchSize);
      const batchEmbeddings = await this.openai.getEmbeddings(batch);
      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  /**
   * Calculate the centroid (mean) of embedding vectors.
   * @private
   */
  _calculateCentroid(embeddings) {
    if (!embeddings || embeddings.length === 0) {
      return null;
    }

    const dimensions = embeddings[0].length;
    const centroid = new Array(dimensions).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += embedding[i];
      }
    }

    for (let i = 0; i < dimensions; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  /**
   * Calculate centroid-based coherence score.
   * Higher score means sentences are more similar to the central topic.
   * @private
   */
  _calculateCentroidCoherence(embeddings, centroid) {
    const similarities = embeddings.map(emb => this._cosineSimilarity(emb, centroid));
    const distances = similarities.map(sim => 1 - sim);

    const score = this._mean(similarities);
    const stdDev = this._stdDev(distances);

    return {
      score,
      stdDev,
      distances,
      min: Math.min(...similarities),
      max: Math.max(...similarities),
    };
  }

  /**
   * Calculate pairwise coherence score.
   * Average cosine similarity between all sentence pairs.
   * @private
   */
  _calculatePairwiseCoherence(embeddings) {
    if (embeddings.length < 2) {
      return { score: 1.0, min: 1.0, max: 1.0 };
    }

    const similarities = [];

    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        similarities.push(this._cosineSimilarity(embeddings[i], embeddings[j]));
      }
    }

    return {
      score: this._mean(similarities),
      min: Math.min(...similarities),
      max: Math.max(...similarities),
    };
  }

  /**
   * Calculate variance-based coherence score.
   * Lower variance in distances means higher coherence.
   * Inverted and normalized to 0-1 scale.
   * @private
   */
  _calculateVarianceScore(distances) {
    if (!distances || distances.length < 2) {
      return 1.0;
    }

    const variance = this._variance(distances);

    // Convert variance to coherence score
    // Use exponential decay: exp(-k * variance) where k controls sensitivity
    // This maps variance -> [0, 1] where lower variance = higher score
    const k = 10; // Sensitivity factor
    return Math.exp(-k * variance);
  }

  /**
   * Combine individual scores into overall coherence score.
   * @private
   */
  _combineScores(centroidScore, pairwiseScore, varianceScore, weights) {
    const totalWeight = weights.centroid + weights.pairwise + weights.variance;

    return (
      (weights.centroid * centroidScore +
        weights.pairwise * pairwiseScore +
        weights.variance * varianceScore) /
      totalWeight
    );
  }

  /**
   * Calculate cosine similarity between two vectors.
   * @private
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
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Sample sentences evenly distributed across the chunk.
   * @private
   */
  _sampleSentences(sentences, sampleSize) {
    if (sentences.length <= sampleSize) {
      return sentences;
    }

    const step = sentences.length / sampleSize;
    const sampled = [];

    for (let i = 0; i < sampleSize; i++) {
      const index = Math.min(Math.floor(i * step), sentences.length - 1);
      sampled.push(sentences[index]);
    }

    return sampled;
  }

  /**
   * Create result for insufficient data scenarios.
   * @private
   */
  _createInsufficientDataResult(reason, sentenceCount = 0) {
    return {
      overallScore: sentenceCount === 1 ? 1.0 : null,
      centroidCoherence: null,
      pairwiseCoherence: null,
      varianceScore: null,
      details: {
        sentenceCount,
        reason,
      },
      method: 'insufficient_data',
    };
  }

  /**
   * Generate summary text for batch results.
   * @private
   */
  _generateBatchSummary(results, aggregate) {
    if (!aggregate) {
      return 'No valid chunks to analyze';
    }

    const quality = aggregate.meanCoherence >= 0.8
      ? 'excellent'
      : aggregate.meanCoherence >= 0.6
        ? 'good'
        : aggregate.meanCoherence >= 0.4
          ? 'moderate'
          : 'low';

    return `Analyzed ${aggregate.validChunks}/${aggregate.totalChunks} chunks. ` +
      `Mean coherence: ${aggregate.meanCoherence.toFixed(3)} (${quality}). ` +
      `Range: ${aggregate.minCoherence.toFixed(3)} - ${aggregate.maxCoherence.toFixed(3)}`;
  }

  // Statistical helper functions
  _mean(arr) {
    return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  _median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  _variance(arr) {
    if (arr.length < 2) return 0;
    const mean = this._mean(arr);
    return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  }

  _stdDev(arr) {
    return Math.sqrt(this._variance(arr));
  }
}

/**
 * Format coherence score result for display.
 *
 * @param {CoherenceScoreResult} result - Coherence score result
 * @returns {string} Formatted display string
 */
function formatCoherenceScore(result) {
  if (result.method === 'insufficient_data') {
    return `Coherence: N/A (${result.details.reason})`;
  }

  const quality = result.overallScore >= 0.8
    ? 'Excellent'
    : result.overallScore >= 0.6
      ? 'Good'
      : result.overallScore >= 0.4
        ? 'Moderate'
        : 'Low';

  return [
    `Coherence Score: ${result.overallScore.toFixed(3)} (${quality})`,
    `  - Centroid coherence: ${result.centroidCoherence.toFixed(3)}`,
    `  - Pairwise coherence: ${result.pairwiseCoherence.toFixed(3)}${result.details.pairwiseSkipped ? ' (estimated)' : ''}`,
    `  - Variance score: ${result.varianceScore.toFixed(3)}`,
    `  - Sentences analyzed: ${result.details.sentenceCount}`,
    `  - Similarity range: ${result.details.minSimilarity.toFixed(3)} - ${result.details.maxSimilarity.toFixed(3)}`,
  ].join('\n');
}

/**
 * Format batch coherence results for display.
 *
 * @param {Object} batchResult - Batch coherence result
 * @returns {string} Formatted display string
 */
function formatBatchCoherence(batchResult) {
  const lines = [batchResult.summary, ''];

  if (batchResult.aggregate) {
    lines.push('Aggregate Statistics:');
    lines.push(`  Mean: ${batchResult.aggregate.meanCoherence.toFixed(3)}`);
    lines.push(`  Median: ${batchResult.aggregate.medianCoherence.toFixed(3)}`);
    lines.push(`  Std Dev: ${batchResult.aggregate.stdDevCoherence.toFixed(3)}`);
    lines.push(`  Range: ${batchResult.aggregate.minCoherence.toFixed(3)} - ${batchResult.aggregate.maxCoherence.toFixed(3)}`);
    lines.push('');
  }

  // Show low coherence chunks as warnings
  const lowCoherence = batchResult.results.filter(
    r => r.method === 'embedding_based' && r.overallScore < 0.4
  );

  if (lowCoherence.length > 0) {
    lines.push('Low Coherence Chunks (< 0.4):');
    lowCoherence.forEach(r => {
      lines.push(`  Chunk ${r.chunkIndex}: ${r.overallScore.toFixed(3)}`);
    });
  }

  return lines.join('\n');
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance of ChunkCoherenceScorer.
 *
 * @param {Object} options - Optional configuration
 * @returns {ChunkCoherenceScorer} Scorer instance
 */
function getChunkCoherenceScorer(options = {}) {
  if (!instance || Object.keys(options).length > 0) {
    instance = new ChunkCoherenceScorer(options);
  }
  return instance;
}

module.exports = {
  ChunkCoherenceScorer,
  getChunkCoherenceScorer,
  formatCoherenceScore,
  formatBatchCoherence,
  DEFAULT_CONFIG,
};
