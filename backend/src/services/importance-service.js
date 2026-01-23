/**
 * Entity Importance Service
 *
 * Calculates and stores composite importance scores for entities in the knowledge graph.
 * Combines multiple metrics to determine overall entity importance:
 * - PageRank: Measures influence based on incoming connections
 * - Betweenness Centrality: Measures bridging importance
 * - Mention Frequency: Measures how often entity appears across documents
 *
 * Feature: F3.2.4 - Importance Field on Entities
 */

const { calculatePageRank } = require('../algorithms/pagerank');
const { calculateBetweenness } = require('../algorithms/betweenness');
const { getGraphService } = require('./graph-service');
const { log } = require('../utils/logger');

/**
 * Default weights for importance calculation.
 * Weights should sum to 1.0 for normalized output.
 */
const DEFAULT_WEIGHTS = {
  pageRank: 0.4,       // Connection-based influence
  betweenness: 0.35,   // Bridging importance
  mentionFrequency: 0.25, // Document presence
};

/**
 * Configuration defaults
 */
const DEFAULT_CONFIG = {
  weights: DEFAULT_WEIGHTS,
  normalizeOutput: true, // Normalize final scores to [0, 1]
};

/**
 * Normalize an array of scores to [0, 1] range using min-max normalization.
 *
 * @param {Object} scores - Map of entity ID to score
 * @returns {Object} Normalized scores
 */
function normalizeScores(scores) {
  const values = Object.values(scores);
  if (values.length === 0) return {};

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    // All scores are the same, normalize to 0.5
    const normalized = {};
    for (const id of Object.keys(scores)) {
      normalized[id] = 0.5;
    }
    return normalized;
  }

  const normalized = {};
  for (const [id, score] of Object.entries(scores)) {
    normalized[id] = (score - min) / range;
  }
  return normalized;
}

/**
 * Calculate mention frequency scores from entity data.
 * Uses the mentionCount field if available, otherwise falls back to counting
 * unique source documents.
 *
 * @param {Array} nodes - Array of node objects from graph
 * @returns {Object} Map of entity ID to mention frequency score
 */
function calculateMentionFrequency(nodes) {
  const mentionScores = {};

  for (const node of nodes) {
    // Use mentionCount if available, otherwise default to 1
    const mentionCount = node.mentionCount || 1;
    mentionScores[node.id] = mentionCount;
  }

  return mentionScores;
}

/**
 * Calculate composite importance scores for all entities in the knowledge graph.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.weights - Custom weights for each metric
 * @param {boolean} options.normalizeOutput - Whether to normalize final scores (default: true)
 * @returns {Promise<Object>} Importance results with scores and metadata
 */
async function calculateImportance(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };

  log.info('Starting importance calculation', { weights });
  const startTime = Date.now();

  try {
    // Calculate component metrics in parallel
    const [pageRankResult, betweennessResult] = await Promise.all([
      calculatePageRank(),
      calculateBetweenness(),
    ]);

    const { nodes } = await getGraphService().getAllEntities(10000);

    if (nodes.length === 0) {
      log.warn('No nodes found for importance calculation');
      return {
        scores: {},
        rankedEntities: [],
        metadata: {
          nodeCount: 0,
          weights,
          executionTimeMs: Date.now() - startTime,
        },
      };
    }

    // Extract raw scores
    const pageRankScores = pageRankResult.scores;
    const betweennessScores = betweennessResult.scores;
    const mentionScores = calculateMentionFrequency(nodes);

    // Normalize each component
    const normalizedPageRank = normalizeScores(pageRankScores);
    const normalizedBetweenness = normalizeScores(betweennessScores);
    const normalizedMention = normalizeScores(mentionScores);

    // Calculate composite importance
    const importanceScores = {};
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    for (const nodeId of Object.keys(pageRankScores)) {
      const pr = normalizedPageRank[nodeId] || 0;
      const bc = normalizedBetweenness[nodeId] || 0;
      const mf = normalizedMention[nodeId] || 0;

      // Weighted sum
      const importance = weights.pageRank * pr +
                         weights.betweenness * bc +
                         weights.mentionFrequency * mf;

      importanceScores[nodeId] = importance;
    }

    // Optionally normalize final output
    const finalScores = config.normalizeOutput
      ? normalizeScores(importanceScores)
      : importanceScores;

    // Create ranked list with full entity details
    const rankedEntities = Object.entries(finalScores)
      .map(([nodeId, importance]) => {
        const node = nodeMap.get(nodeId);
        return {
          id: nodeId,
          name: node?.name || node?.label || nodeId,
          type: node?.type || 'Unknown',
          importance,
          // Component scores for transparency
          components: {
            pageRank: normalizedPageRank[nodeId] || 0,
            betweenness: normalizedBetweenness[nodeId] || 0,
            mentionFrequency: normalizedMention[nodeId] || 0,
          },
          // Original node properties
          description: node?.description,
          confidence: node?.confidence,
          mentionCount: node?.mentionCount || 1,
        };
      })
      .sort((a, b) => b.importance - a.importance);

    // Add rank and percentile
    rankedEntities.forEach((entity, index) => {
      entity.rank = index + 1;
      entity.percentile = ((rankedEntities.length - index - 1) / rankedEntities.length) * 100;
    });

    const executionTimeMs = Date.now() - startTime;

    log.info('Importance calculation completed', {
      nodeCount: nodes.length,
      executionTimeMs,
      topEntity: rankedEntities[0]?.name,
      topScore: rankedEntities[0]?.importance,
    });

    return {
      scores: finalScores,
      rankedEntities,
      metadata: {
        nodeCount: nodes.length,
        weights,
        normalizedOutput: config.normalizeOutput,
        pageRankMetadata: pageRankResult.metadata,
        betweennessMetadata: betweennessResult.metadata,
        executionTimeMs,
      },
    };
  } catch (error) {
    log.errorWithStack('Importance calculation failed', error);
    throw error;
  }
}

/**
 * Update importance scores on entities in the graph database.
 * Stores the calculated importance as a property on each vertex.
 *
 * @param {Object} options - Calculation options
 * @returns {Promise<Object>} Update results with counts
 */
async function updateEntityImportanceScores(options = {}) {
  log.info('Starting entity importance score update');
  const startTime = Date.now();

  try {
    // Calculate importance scores
    const result = await calculateImportance(options);

    if (result.rankedEntities.length === 0) {
      return {
        updated: 0,
        failed: 0,
        total: 0,
        executionTimeMs: Date.now() - startTime,
      };
    }

    const graphService = getGraphService();
    let updated = 0;
    let failed = 0;

    // Update each entity with its importance score
    for (const entity of result.rankedEntities) {
      try {
        await graphService._submit(
          `g.V(vertexId)
            .property('importance', importance)
            .property('importanceRank', rank)
            .property('importancePercentile', percentile)
            .property('importanceUpdatedAt', updatedAt)`,
          {
            vertexId: entity.id,
            importance: entity.importance,
            rank: entity.rank,
            percentile: entity.percentile,
            updatedAt: new Date().toISOString(),
          }
        );
        updated++;
      } catch (error) {
        log.warn('Failed to update importance for entity', {
          entityId: entity.id,
          entityName: entity.name,
          error: error.message,
        });
        failed++;
      }
    }

    const executionTimeMs = Date.now() - startTime;

    log.info('Entity importance update completed', {
      updated,
      failed,
      total: result.rankedEntities.length,
      executionTimeMs,
    });

    return {
      updated,
      failed,
      total: result.rankedEntities.length,
      scores: result.scores,
      metadata: result.metadata,
      executionTimeMs,
    };
  } catch (error) {
    log.errorWithStack('Entity importance update failed', error);
    throw error;
  }
}

/**
 * Get top N entities by importance score.
 *
 * @param {number} n - Number of top entities to return
 * @param {Object} options - Calculation options
 * @returns {Promise<Array>} Top N entities sorted by importance
 */
async function getTopEntitiesByImportance(n = 10, options = {}) {
  const result = await calculateImportance(options);
  return result.rankedEntities.slice(0, n);
}

/**
 * Get importance score for a specific entity.
 *
 * @param {string} entityId - Entity ID to look up
 * @param {Object} options - Calculation options
 * @returns {Promise<Object|null>} Entity with importance score or null if not found
 */
async function getEntityImportance(entityId, options = {}) {
  const result = await calculateImportance(options);
  const entity = result.rankedEntities.find((e) => e.id === entityId);
  return entity || null;
}

/**
 * Get importance scores from the graph database (cached scores).
 * This retrieves previously calculated scores stored on entities,
 * avoiding recalculation.
 *
 * @param {number} limit - Maximum entities to return
 * @returns {Promise<Array>} Entities with cached importance scores
 */
async function getCachedImportanceScores(limit = 100) {
  const graphService = getGraphService();

  try {
    const query = `g.V()
      .has('importance')
      .order()
      .by('importance', desc)
      .limit(${limit})
      .valueMap(true)`;

    const results = await graphService._submit(query);

    return results.map((v) => {
      const vertex = graphService._normalizeVertex(v);
      return {
        id: vertex.id,
        name: vertex.name,
        type: vertex.type,
        importance: vertex.importance,
        importanceRank: vertex.importanceRank,
        importancePercentile: vertex.importancePercentile,
        importanceUpdatedAt: vertex.importanceUpdatedAt,
      };
    });
  } catch (error) {
    log.warn('Failed to get cached importance scores', { error: error.message });
    return [];
  }
}

// Singleton instance for caching results
let cachedResult = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get importance scores with caching.
 * Recalculates only if cache is stale.
 *
 * @param {Object} options - Calculation options
 * @param {boolean} options.forceRefresh - Force recalculation
 * @returns {Promise<Object>} Importance calculation result
 */
async function getImportanceWithCache(options = {}) {
  const now = Date.now();

  if (options.forceRefresh || !cachedResult || (now - cacheTimestamp) > CACHE_TTL_MS) {
    cachedResult = await calculateImportance(options);
    cacheTimestamp = now;
  }

  return cachedResult;
}

/**
 * Clear the importance cache.
 */
function clearImportanceCache() {
  cachedResult = null;
  cacheTimestamp = 0;
}

/**
 * Get mention statistics for a specific entity.
 * Feature: F3.2.3 - Mention Frequency Tracking
 *
 * @param {string} entityId - Entity ID or name to look up
 * @returns {Promise<Object|null>} Mention statistics or null if not found
 */
async function getEntityMentionStats(entityId) {
  const graphService = getGraphService();

  try {
    // First try to get by ID, then by name
    let query = `g.V(entityId).valueMap(true)`;
    let result = await graphService._submit(query, { entityId });

    if (result.length === 0) {
      // Try by name
      query = `g.V().has('name', entityName).valueMap(true)`;
      result = await graphService._submit(query, { entityName: entityId });
    }

    if (result.length === 0) {
      return null;
    }

    const vertex = graphService._normalizeVertex(result[0]);

    // Parse sourceDocumentIds from comma-separated string
    const sourceDocumentIds = vertex.sourceDocumentIds
      ? vertex.sourceDocumentIds.split(',').filter(id => id.trim())
      : [];

    return {
      id: vertex.id,
      name: vertex.name,
      type: vertex.type,
      mentionCount: vertex.mentionCount || 1,
      documentCount: sourceDocumentIds.length || 1,
      sourceDocumentIds,
      lastMentionedAt: vertex.lastMentionedAt,
      createdAt: vertex.createdAt,
      updatedAt: vertex.updatedAt,
      // Include importance data if available
      importance: vertex.importance,
      importanceRank: vertex.importanceRank,
      importancePercentile: vertex.importancePercentile,
    };
  } catch (error) {
    log.warn('Failed to get entity mention stats', { entityId, error: error.message });
    return null;
  }
}

/**
 * Get top entities by mention count.
 * Feature: F3.2.3 - Mention Frequency Tracking
 *
 * @param {number} limit - Maximum number of entities to return
 * @returns {Promise<Array>} Array of entities sorted by mention count
 */
async function getTopEntitiesByMentionCount(limit = 50) {
  const graphService = getGraphService();
  return graphService.getTopEntitiesByMentionCount(limit);
}

/**
 * Get mention frequency analysis across all entities.
 * Provides summary statistics about entity mentions.
 * Feature: F3.2.3 - Mention Frequency Tracking
 *
 * @returns {Promise<Object>} Mention frequency analysis
 */
async function getMentionFrequencyAnalysis() {
  const graphService = getGraphService();

  try {
    // Get all entities with mention counts
    const query = `g.V().has('mentionCount').valueMap(true)`;
    const results = await graphService._submit(query);

    if (results.length === 0) {
      return {
        totalEntities: 0,
        totalMentions: 0,
        averageMentionCount: 0,
        maxMentionCount: 0,
        minMentionCount: 0,
        distribution: {},
        topEntities: [],
      };
    }

    const entities = results.map(v => {
      const vertex = graphService._normalizeVertex(v);
      return {
        id: vertex.id,
        name: vertex.name,
        type: vertex.type,
        mentionCount: vertex.mentionCount || 1,
      };
    });

    // Calculate statistics
    const mentionCounts = entities.map(e => e.mentionCount);
    const totalMentions = mentionCounts.reduce((sum, c) => sum + c, 0);
    const maxMentionCount = Math.max(...mentionCounts);
    const minMentionCount = Math.min(...mentionCounts);
    const averageMentionCount = totalMentions / entities.length;

    // Create distribution buckets
    const distribution = {
      '1': 0,        // Exactly 1 mention
      '2-5': 0,      // 2-5 mentions
      '6-10': 0,     // 6-10 mentions
      '11-25': 0,    // 11-25 mentions
      '26-50': 0,    // 26-50 mentions
      '50+': 0,      // More than 50 mentions
    };

    for (const count of mentionCounts) {
      if (count === 1) distribution['1']++;
      else if (count <= 5) distribution['2-5']++;
      else if (count <= 10) distribution['6-10']++;
      else if (count <= 25) distribution['11-25']++;
      else if (count <= 50) distribution['26-50']++;
      else distribution['50+']++;
    }

    // Get top 10 entities by mention count
    const topEntities = entities
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 10);

    return {
      totalEntities: entities.length,
      totalMentions,
      averageMentionCount: parseFloat(averageMentionCount.toFixed(2)),
      maxMentionCount,
      minMentionCount,
      distribution,
      topEntities,
    };
  } catch (error) {
    log.errorWithStack('Failed to get mention frequency analysis', error);
    throw error;
  }
}

module.exports = {
  calculateImportance,
  updateEntityImportanceScores,
  getTopEntitiesByImportance,
  getEntityImportance,
  getCachedImportanceScores,
  getImportanceWithCache,
  clearImportanceCache,
  getEntityMentionStats,
  getTopEntitiesByMentionCount,
  getMentionFrequencyAnalysis,
  DEFAULT_WEIGHTS,
  DEFAULT_CONFIG,
};
