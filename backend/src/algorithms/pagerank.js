/**
 * PageRank Algorithm Implementation
 *
 * Calculates importance scores for entities in the knowledge graph using
 * the PageRank algorithm. Higher scores indicate more influential entities
 * that are referenced by or connected to many other entities.
 *
 * Feature: F3.2.1 - PageRank Algorithm
 */

const { getGraphService } = require('../services/graph-service');
const { log } = require('../utils/logger');

/**
 * PageRank configuration defaults
 */
const DEFAULT_CONFIG = {
  dampingFactor: 0.85, // Standard damping factor
  maxIterations: 100, // Maximum iterations before stopping
  convergenceThreshold: 1e-6, // Stop when changes are below this threshold
  defaultScore: 1.0, // Initial score for all nodes
};

/**
 * Calculate PageRank scores for all entities in the knowledge graph.
 *
 * @param {Object} options - Configuration options
 * @param {number} options.dampingFactor - Damping factor (default: 0.85)
 * @param {number} options.maxIterations - Maximum iterations (default: 100)
 * @param {number} options.convergenceThreshold - Convergence threshold (default: 1e-6)
 * @returns {Promise<Object>} PageRank results with scores and metadata
 */
async function calculatePageRank(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const { dampingFactor, maxIterations, convergenceThreshold } = config;

  log.info('Starting PageRank calculation', { config });
  const startTime = Date.now();

  try {
    // Fetch graph data
    const graphService = getGraphService();
    const { nodes, edges } = await graphService.getAllEntities(10000); // Get up to 10k entities

    if (nodes.length === 0) {
      log.warn('No nodes found in graph for PageRank calculation');
      return {
        scores: {},
        rankedEntities: [],
        metadata: {
          nodeCount: 0,
          edgeCount: 0,
          iterations: 0,
          converged: true,
          executionTimeMs: Date.now() - startTime,
        },
      };
    }

    log.info(`Loaded graph data for PageRank`, {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    });

    // Build adjacency structures
    const { inLinks, outLinkCounts, nodeIds } = buildAdjacencyStructures(nodes, edges);

    // Initialize scores
    const n = nodeIds.length;
    const initialScore = 1.0 / n;
    let scores = {};
    for (const nodeId of nodeIds) {
      scores[nodeId] = initialScore;
    }

    // Iterative PageRank computation
    let iteration = 0;
    let converged = false;
    let maxDelta = 0;

    while (iteration < maxIterations && !converged) {
      const newScores = {};
      maxDelta = 0;

      // Calculate new scores
      for (const nodeId of nodeIds) {
        // Sum contributions from incoming links
        let incomingSum = 0;
        const incoming = inLinks[nodeId] || [];

        for (const sourceId of incoming) {
          const sourceOutCount = outLinkCounts[sourceId] || 1;
          incomingSum += scores[sourceId] / sourceOutCount;
        }

        // Apply PageRank formula: (1-d)/N + d * sum(PR(i)/L(i))
        const newScore = (1 - dampingFactor) / n + dampingFactor * incomingSum;
        newScores[nodeId] = newScore;

        // Track convergence
        const delta = Math.abs(newScore - scores[nodeId]);
        if (delta > maxDelta) {
          maxDelta = delta;
        }
      }

      scores = newScores;
      iteration++;

      // Check convergence
      if (maxDelta < convergenceThreshold) {
        converged = true;
      }

      // Log progress every 10 iterations
      if (iteration % 10 === 0) {
        log.debug(`PageRank iteration ${iteration}`, { maxDelta });
      }
    }

    // Create ranked list of entities with their scores
    const rankedEntities = createRankedEntityList(nodes, scores);

    const executionTimeMs = Date.now() - startTime;
    log.info('PageRank calculation completed', {
      iterations: iteration,
      converged,
      maxDelta,
      executionTimeMs,
      topEntity: rankedEntities[0]?.name,
      topScore: rankedEntities[0]?.pageRank,
    });

    return {
      scores,
      rankedEntities,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        iterations: iteration,
        converged,
        finalMaxDelta: maxDelta,
        dampingFactor,
        executionTimeMs,
      },
    };
  } catch (error) {
    log.errorWithStack('PageRank calculation failed', error);
    throw error;
  }
}

/**
 * Build adjacency structures for PageRank computation.
 *
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects with source and target
 * @returns {Object} Adjacency structures (inLinks, outLinkCounts, nodeIds)
 */
function buildAdjacencyStructures(nodes, edges) {
  const nodeIds = nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);

  // inLinks[nodeId] = array of node IDs that link TO this node
  const inLinks = {};

  // outLinkCounts[nodeId] = number of outgoing links from this node
  const outLinkCounts = {};

  // Initialize structures
  for (const nodeId of nodeIds) {
    inLinks[nodeId] = [];
    outLinkCounts[nodeId] = 0;
  }

  // Process edges
  for (const edge of edges) {
    const source = edge.source;
    const target = edge.target;

    // Only count edges where both nodes exist in our node set
    if (nodeIdSet.has(source) && nodeIdSet.has(target)) {
      // Add incoming link to target
      inLinks[target].push(source);

      // Increment outgoing link count for source
      outLinkCounts[source]++;
    }
  }

  return { inLinks, outLinkCounts, nodeIds };
}

/**
 * Create a ranked list of entities with their PageRank scores.
 *
 * @param {Array} nodes - Original node objects
 * @param {Object} scores - Map of node ID to PageRank score
 * @returns {Array} Sorted array of entities with scores
 */
function createRankedEntityList(nodes, scores) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  const rankedEntities = Object.entries(scores)
    .map(([nodeId, score]) => {
      const node = nodeMap.get(nodeId);
      return {
        id: nodeId,
        name: node?.name || node?.label || nodeId,
        type: node?.type || 'Unknown',
        pageRank: score,
        // Include original node properties for context
        description: node?.description,
        confidence: node?.confidence,
      };
    })
    .sort((a, b) => b.pageRank - a.pageRank);

  return rankedEntities;
}

/**
 * Get top N entities by PageRank score.
 *
 * @param {number} n - Number of top entities to return
 * @param {Object} options - PageRank calculation options
 * @returns {Promise<Array>} Top N entities sorted by PageRank
 */
async function getTopEntitiesByPageRank(n = 10, options = {}) {
  const result = await calculatePageRank(options);
  return result.rankedEntities.slice(0, n);
}

/**
 * Get PageRank score for a specific entity.
 *
 * @param {string} entityId - Entity ID to look up
 * @param {Object} options - PageRank calculation options
 * @returns {Promise<Object|null>} Entity with PageRank score or null if not found
 */
async function getEntityPageRank(entityId, options = {}) {
  const result = await calculatePageRank(options);
  const entity = result.rankedEntities.find((e) => e.id === entityId);

  if (!entity) {
    return null;
  }

  // Calculate rank position
  const rank = result.rankedEntities.findIndex((e) => e.id === entityId) + 1;

  return {
    ...entity,
    rank,
    percentile: ((result.rankedEntities.length - rank) / result.rankedEntities.length) * 100,
  };
}

module.exports = {
  calculatePageRank,
  getTopEntitiesByPageRank,
  getEntityPageRank,
  DEFAULT_CONFIG,
};
