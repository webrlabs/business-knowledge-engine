/**
 * Retrieval Metrics Service
 *
 * Implements standard information retrieval evaluation metrics:
 * - Precision@K
 * - Recall@K
 * - MRR (Mean Reciprocal Rank)
 * - NDCG (Normalized Discounted Cumulative Gain)
 *
 * Feature: F1.2.1 - Retrieval Metrics Service
 */

const { log } = require('../utils/logger');

/**
 * Calculate Precision@K
 * Measures what fraction of the top K retrieved items are relevant
 *
 * @param {string[]} retrieved - Array of retrieved item IDs in ranked order
 * @param {Set<string>|string[]} relevant - Set or array of relevant item IDs
 * @param {number} k - Number of top items to consider
 * @returns {number} Precision score between 0 and 1
 */
function precisionAtK(retrieved, relevant, k) {
  if (!retrieved || retrieved.length === 0 || k <= 0) {
    return 0;
  }

  const relevantSet = relevant instanceof Set ? relevant : new Set(relevant);
  const topK = retrieved.slice(0, k);

  let relevantCount = 0;
  for (const item of topK) {
    if (relevantSet.has(item)) {
      relevantCount++;
    }
  }

  return relevantCount / k;
}

/**
 * Calculate Recall@K
 * Measures what fraction of all relevant items appear in the top K results
 *
 * @param {string[]} retrieved - Array of retrieved item IDs in ranked order
 * @param {Set<string>|string[]} relevant - Set or array of relevant item IDs
 * @param {number} k - Number of top items to consider
 * @returns {number} Recall score between 0 and 1
 */
function recallAtK(retrieved, relevant, k) {
  if (!retrieved || retrieved.length === 0 || k <= 0) {
    return 0;
  }

  const relevantSet = relevant instanceof Set ? relevant : new Set(relevant);
  if (relevantSet.size === 0) {
    return 0; // No relevant items to recall
  }

  const topK = retrieved.slice(0, k);

  let relevantCount = 0;
  for (const item of topK) {
    if (relevantSet.has(item)) {
      relevantCount++;
    }
  }

  return relevantCount / relevantSet.size;
}

/**
 * Calculate F1@K
 * Harmonic mean of Precision@K and Recall@K
 *
 * @param {string[]} retrieved - Array of retrieved item IDs in ranked order
 * @param {Set<string>|string[]} relevant - Set or array of relevant item IDs
 * @param {number} k - Number of top items to consider
 * @returns {number} F1 score between 0 and 1
 */
function f1AtK(retrieved, relevant, k) {
  const precision = precisionAtK(retrieved, relevant, k);
  const recall = recallAtK(retrieved, relevant, k);

  if (precision + recall === 0) {
    return 0;
  }

  return (2 * precision * recall) / (precision + recall);
}

/**
 * Calculate Reciprocal Rank
 * Returns 1/rank of the first relevant result (0 if none found)
 *
 * @param {string[]} retrieved - Array of retrieved item IDs in ranked order
 * @param {Set<string>|string[]} relevant - Set or array of relevant item IDs
 * @returns {number} Reciprocal rank between 0 and 1
 */
function reciprocalRank(retrieved, relevant) {
  if (!retrieved || retrieved.length === 0) {
    return 0;
  }

  const relevantSet = relevant instanceof Set ? relevant : new Set(relevant);

  for (let i = 0; i < retrieved.length; i++) {
    if (relevantSet.has(retrieved[i])) {
      return 1 / (i + 1);
    }
  }

  return 0; // No relevant item found
}

/**
 * Calculate Mean Reciprocal Rank (MRR)
 * Average reciprocal rank across multiple queries
 *
 * @param {Array<{retrieved: string[], relevant: string[]|Set<string>}>} queries - Array of query results
 * @returns {number} MRR score between 0 and 1
 */
function meanReciprocalRank(queries) {
  if (!queries || queries.length === 0) {
    return 0;
  }

  let totalRR = 0;
  for (const query of queries) {
    totalRR += reciprocalRank(query.retrieved, query.relevant);
  }

  return totalRR / queries.length;
}

/**
 * Calculate Discounted Cumulative Gain (DCG)
 *
 * @param {number[]} relevanceScores - Array of relevance scores in ranked order
 * @param {number} k - Number of top items to consider (optional, defaults to all)
 * @returns {number} DCG score
 */
function dcg(relevanceScores, k = null) {
  if (!relevanceScores || relevanceScores.length === 0) {
    return 0;
  }

  const limit = k !== null ? Math.min(k, relevanceScores.length) : relevanceScores.length;
  let dcgScore = 0;

  for (let i = 0; i < limit; i++) {
    // Using log base 2, with position starting at 1
    // DCG = sum(rel_i / log2(i + 2)) for i starting at 0
    // The +2 ensures log2(2) = 1 for the first position
    dcgScore += relevanceScores[i] / Math.log2(i + 2);
  }

  return dcgScore;
}

/**
 * Calculate Ideal DCG (IDCG)
 * DCG with relevance scores sorted in descending order
 *
 * @param {number[]} relevanceScores - Array of relevance scores
 * @param {number} k - Number of top items to consider (optional, defaults to all)
 * @returns {number} IDCG score
 */
function idcg(relevanceScores, k = null) {
  if (!relevanceScores || relevanceScores.length === 0) {
    return 0;
  }

  // Sort in descending order to get ideal ranking
  const sorted = [...relevanceScores].sort((a, b) => b - a);
  return dcg(sorted, k);
}

/**
 * Calculate Normalized Discounted Cumulative Gain (NDCG)
 * NDCG = DCG / IDCG, normalized to [0, 1]
 *
 * For binary relevance (relevant/not relevant), use relevance scores of 1 and 0.
 * For graded relevance, use scores like 0, 1, 2, 3 (not relevant to highly relevant).
 *
 * @param {number[]} relevanceScores - Array of relevance scores in retrieval order
 * @param {number} k - Number of top items to consider (optional, defaults to all)
 * @returns {number} NDCG score between 0 and 1
 */
function ndcg(relevanceScores, k = null) {
  const idcgScore = idcg(relevanceScores, k);

  if (idcgScore === 0) {
    return 0; // No relevant documents at all
  }

  const dcgScore = dcg(relevanceScores, k);
  return dcgScore / idcgScore;
}

/**
 * Calculate NDCG@K with binary relevance
 * Convenience function for binary relevance judgments
 *
 * @param {string[]} retrieved - Array of retrieved item IDs in ranked order
 * @param {Set<string>|string[]} relevant - Set or array of relevant item IDs
 * @param {number} k - Number of top items to consider
 * @returns {number} NDCG score between 0 and 1
 */
function ndcgAtK(retrieved, relevant, k) {
  if (!retrieved || retrieved.length === 0 || k <= 0) {
    return 0;
  }

  const relevantSet = relevant instanceof Set ? relevant : new Set(relevant);

  // Convert retrieved items to binary relevance scores
  const relevanceScores = retrieved.slice(0, k).map(item => relevantSet.has(item) ? 1 : 0);

  // For IDCG, we need to know how many relevant items could appear in top K
  const maxRelevant = Math.min(k, relevantSet.size);
  const idealScores = Array(maxRelevant).fill(1).concat(Array(Math.max(0, k - maxRelevant)).fill(0));

  const dcgScore = dcg(relevanceScores, k);
  const idcgScore = dcg(idealScores, k);

  if (idcgScore === 0) {
    return 0;
  }

  return dcgScore / idcgScore;
}

/**
 * Calculate Average Precision (AP) for a single query
 * Used for computing Mean Average Precision (MAP)
 *
 * @param {string[]} retrieved - Array of retrieved item IDs in ranked order
 * @param {Set<string>|string[]} relevant - Set or array of relevant item IDs
 * @returns {number} Average precision between 0 and 1
 */
function averagePrecision(retrieved, relevant) {
  if (!retrieved || retrieved.length === 0) {
    return 0;
  }

  const relevantSet = relevant instanceof Set ? relevant : new Set(relevant);
  if (relevantSet.size === 0) {
    return 0;
  }

  let sumPrecision = 0;
  let relevantCount = 0;

  for (let i = 0; i < retrieved.length; i++) {
    if (relevantSet.has(retrieved[i])) {
      relevantCount++;
      // Precision at this position
      sumPrecision += relevantCount / (i + 1);
    }
  }

  return sumPrecision / relevantSet.size;
}

/**
 * Calculate Mean Average Precision (MAP)
 * Average of AP across multiple queries
 *
 * @param {Array<{retrieved: string[], relevant: string[]|Set<string>}>} queries - Array of query results
 * @returns {number} MAP score between 0 and 1
 */
function meanAveragePrecision(queries) {
  if (!queries || queries.length === 0) {
    return 0;
  }

  let totalAP = 0;
  for (const query of queries) {
    totalAP += averagePrecision(query.retrieved, query.relevant);
  }

  return totalAP / queries.length;
}

/**
 * Calculate Hit Rate (Hit@K)
 * Binary metric: 1 if any relevant item in top K, 0 otherwise
 *
 * @param {string[]} retrieved - Array of retrieved item IDs in ranked order
 * @param {Set<string>|string[]} relevant - Set or array of relevant item IDs
 * @param {number} k - Number of top items to consider
 * @returns {number} 1 if hit, 0 otherwise
 */
function hitAtK(retrieved, relevant, k) {
  if (!retrieved || retrieved.length === 0 || k <= 0) {
    return 0;
  }

  const relevantSet = relevant instanceof Set ? relevant : new Set(relevant);
  const topK = retrieved.slice(0, k);

  for (const item of topK) {
    if (relevantSet.has(item)) {
      return 1;
    }
  }

  return 0;
}

/**
 * Calculate Mean Hit Rate across multiple queries
 *
 * @param {Array<{retrieved: string[], relevant: string[]|Set<string>}>} queries - Array of query results
 * @param {number} k - Number of top items to consider
 * @returns {number} Hit rate between 0 and 1
 */
function meanHitRate(queries, k) {
  if (!queries || queries.length === 0) {
    return 0;
  }

  let totalHits = 0;
  for (const query of queries) {
    totalHits += hitAtK(query.retrieved, query.relevant, k);
  }

  return totalHits / queries.length;
}

/**
 * Calculate all metrics at once for a batch of queries
 *
 * @param {Array<{retrieved: string[], relevant: string[]|Set<string>}>} queries - Array of query results
 * @param {number[]} kValues - Array of K values to compute metrics at (e.g., [1, 3, 5, 10])
 * @returns {Object} Object containing all computed metrics
 */
function computeAllMetrics(queries, kValues = [1, 3, 5, 10]) {
  if (!queries || queries.length === 0) {
    log.warn('computeAllMetrics called with empty queries');
    return {
      mrr: 0,
      map: 0,
      queryCount: 0,
      metrics: {}
    };
  }

  const result = {
    mrr: meanReciprocalRank(queries),
    map: meanAveragePrecision(queries),
    queryCount: queries.length,
    metrics: {}
  };

  for (const k of kValues) {
    // Compute per-query metrics then average
    let totalPrecision = 0;
    let totalRecall = 0;
    let totalF1 = 0;
    let totalNDCG = 0;
    let totalHits = 0;

    for (const query of queries) {
      totalPrecision += precisionAtK(query.retrieved, query.relevant, k);
      totalRecall += recallAtK(query.retrieved, query.relevant, k);
      totalF1 += f1AtK(query.retrieved, query.relevant, k);
      totalNDCG += ndcgAtK(query.retrieved, query.relevant, k);
      totalHits += hitAtK(query.retrieved, query.relevant, k);
    }

    result.metrics[`@${k}`] = {
      precision: totalPrecision / queries.length,
      recall: totalRecall / queries.length,
      f1: totalF1 / queries.length,
      ndcg: totalNDCG / queries.length,
      hitRate: totalHits / queries.length
    };
  }

  log.info('Computed retrieval metrics', {
    queryCount: result.queryCount,
    mrr: result.mrr.toFixed(4),
    map: result.map.toFixed(4)
  });

  return result;
}

/**
 * Format metrics for display/reporting
 *
 * @param {Object} metrics - Metrics object from computeAllMetrics
 * @returns {string} Formatted metrics string
 */
function formatMetrics(metrics) {
  if (!metrics || metrics.queryCount === 0) {
    return 'No metrics available (0 queries)';
  }

  const lines = [
    `Retrieval Metrics (${metrics.queryCount} queries)`,
    '='.repeat(40),
    `MRR: ${metrics.mrr.toFixed(4)}`,
    `MAP: ${metrics.map.toFixed(4)}`,
    ''
  ];

  for (const [k, kMetrics] of Object.entries(metrics.metrics)) {
    lines.push(`Metrics ${k}:`);
    lines.push(`  Precision: ${kMetrics.precision.toFixed(4)}`);
    lines.push(`  Recall:    ${kMetrics.recall.toFixed(4)}`);
    lines.push(`  F1:        ${kMetrics.f1.toFixed(4)}`);
    lines.push(`  NDCG:      ${kMetrics.ndcg.toFixed(4)}`);
    lines.push(`  Hit Rate:  ${kMetrics.hitRate.toFixed(4)}`);
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  // Core metrics
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

  // Batch computation
  computeAllMetrics,
  formatMetrics
};
