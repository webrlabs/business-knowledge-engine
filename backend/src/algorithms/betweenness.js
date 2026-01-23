/**
 * Betweenness Centrality Algorithm Implementation
 *
 * Calculates betweenness centrality scores for entities in the knowledge graph.
 * Betweenness centrality measures how often a node lies on the shortest path
 * between other nodes. High betweenness entities are "bridges" that connect
 * different parts of the graph.
 *
 * Feature: F3.2.2 - Betweenness Centrality
 */

const { getGraphService } = require('../services/graph-service');
const { log } = require('../utils/logger');

/**
 * Betweenness Centrality configuration defaults
 */
const DEFAULT_CONFIG = {
  normalized: true, // Normalize scores to [0, 1] range
  directed: true, // Treat graph as directed
  sampleSize: null, // null = use all nodes, number = sample for approximation
};

/**
 * Calculate betweenness centrality scores for all entities in the knowledge graph.
 * Uses Brandes' algorithm for efficient computation.
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.normalized - Normalize scores (default: true)
 * @param {boolean} options.directed - Treat as directed graph (default: true)
 * @param {number|null} options.sampleSize - Sample size for approximation (default: null)
 * @returns {Promise<Object>} Betweenness centrality results with scores and metadata
 */
async function calculateBetweenness(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const { normalized, directed, sampleSize } = config;

  log.info('Starting Betweenness Centrality calculation', { config });
  const startTime = Date.now();

  try {
    // Fetch graph data
    const graphService = getGraphService();
    const { nodes, edges } = await graphService.getAllEntities(10000);

    if (nodes.length === 0) {
      log.warn('No nodes found in graph for Betweenness Centrality calculation');
      return {
        scores: {},
        rankedEntities: [],
        metadata: {
          nodeCount: 0,
          edgeCount: 0,
          normalized,
          directed,
          executionTimeMs: Date.now() - startTime,
        },
      };
    }

    log.info(`Loaded graph data for Betweenness Centrality`, {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    });

    // Build adjacency list
    const { adjacency, nodeIds, nodeIdSet } = buildAdjacencyList(nodes, edges, directed);

    // Determine source nodes for BFS (all or sample)
    let sourceNodes = nodeIds;
    if (sampleSize && sampleSize < nodeIds.length) {
      sourceNodes = sampleNodes(nodeIds, sampleSize);
      log.info(`Using sampled approximation with ${sampleSize} source nodes`);
    }

    // Initialize betweenness scores
    const betweenness = {};
    for (const nodeId of nodeIds) {
      betweenness[nodeId] = 0;
    }

    // Brandes' algorithm: compute betweenness from each source
    for (const source of sourceNodes) {
      const { sigma, predecessors, distances } = bfs(source, adjacency, nodeIdSet);
      accumulateBetweenness(source, betweenness, sigma, predecessors, distances, nodeIds);
    }

    // Normalize scores if requested
    if (normalized) {
      normalizeScores(betweenness, nodeIds.length, directed, sampleSize);
    }

    // Scale back if we used sampling
    if (sampleSize && sampleSize < nodeIds.length) {
      const scaleFactor = nodeIds.length / sampleSize;
      for (const nodeId of nodeIds) {
        betweenness[nodeId] *= scaleFactor;
      }
    }

    // Create ranked list of entities with their scores
    const rankedEntities = createRankedEntityList(nodes, betweenness);

    const executionTimeMs = Date.now() - startTime;
    log.info('Betweenness Centrality calculation completed', {
      executionTimeMs,
      topEntity: rankedEntities[0]?.name,
      topScore: rankedEntities[0]?.betweenness,
    });

    return {
      scores: betweenness,
      rankedEntities,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        normalized,
        directed,
        sampleSize: sampleSize || nodes.length,
        executionTimeMs,
      },
    };
  } catch (error) {
    log.errorWithStack('Betweenness Centrality calculation failed', error);
    throw error;
  }
}

/**
 * Build adjacency list from nodes and edges.
 *
 * @param {Array} nodes - Array of node objects
 * @param {Array} edges - Array of edge objects with source and target
 * @param {boolean} directed - Whether to treat graph as directed
 * @returns {Object} Adjacency list structure
 */
function buildAdjacencyList(nodes, edges, directed) {
  const nodeIds = nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);

  // adjacency[nodeId] = array of neighbor node IDs
  const adjacency = {};
  for (const nodeId of nodeIds) {
    adjacency[nodeId] = [];
  }

  // Process edges
  for (const edge of edges) {
    const source = edge.source;
    const target = edge.target;

    if (nodeIdSet.has(source) && nodeIdSet.has(target)) {
      adjacency[source].push(target);

      // For undirected graphs, add reverse edge too
      if (!directed) {
        adjacency[target].push(source);
      }
    }
  }

  return { adjacency, nodeIds, nodeIdSet };
}

/**
 * Perform BFS from a source node to compute shortest path data.
 *
 * @param {string} source - Source node ID
 * @param {Object} adjacency - Adjacency list
 * @param {Set} nodeIdSet - Set of all node IDs
 * @returns {Object} BFS results: sigma (path counts), predecessors, distances
 */
function bfs(source, adjacency, nodeIdSet) {
  // sigma[v] = number of shortest paths from source to v
  const sigma = {};
  // predecessors[v] = list of predecessors on shortest paths
  const predecessors = {};
  // distances[v] = distance from source to v (-1 = unreachable)
  const distances = {};

  // Initialize
  for (const nodeId of nodeIdSet) {
    sigma[nodeId] = 0;
    predecessors[nodeId] = [];
    distances[nodeId] = -1;
  }

  sigma[source] = 1;
  distances[source] = 0;

  // BFS queue and stack for later traversal
  const queue = [source];
  const stack = [];

  while (queue.length > 0) {
    const v = queue.shift();
    stack.push(v);

    for (const w of adjacency[v] || []) {
      // First time reaching w?
      if (distances[w] < 0) {
        distances[w] = distances[v] + 1;
        queue.push(w);
      }

      // Is this a shortest path to w via v?
      if (distances[w] === distances[v] + 1) {
        sigma[w] += sigma[v];
        predecessors[w].push(v);
      }
    }
  }

  return { sigma, predecessors, distances, stack };
}

/**
 * Accumulate betweenness contributions from a single BFS source.
 *
 * @param {string} source - Source node ID
 * @param {Object} betweenness - Betweenness scores to update (mutated)
 * @param {Object} sigma - Path counts from BFS
 * @param {Object} predecessors - Predecessor lists from BFS
 * @param {Object} distances - Distances from BFS
 * @param {Array} nodeIds - All node IDs
 */
function accumulateBetweenness(source, betweenness, sigma, predecessors, distances, nodeIds) {
  // delta[v] = dependency of source on v
  const delta = {};
  for (const nodeId of nodeIds) {
    delta[nodeId] = 0;
  }

  // Build stack in order of decreasing distance
  const sortedByDistance = nodeIds
    .filter((id) => distances[id] >= 0)
    .sort((a, b) => distances[b] - distances[a]);

  // Accumulate dependencies in reverse BFS order
  for (const w of sortedByDistance) {
    for (const v of predecessors[w]) {
      const contribution = (sigma[v] / sigma[w]) * (1 + delta[w]);
      delta[v] += contribution;
    }

    // Add to betweenness (exclude source node)
    if (w !== source) {
      betweenness[w] += delta[w];
    }
  }
}

/**
 * Normalize betweenness scores to [0, 1] range.
 *
 * @param {Object} betweenness - Betweenness scores to normalize (mutated)
 * @param {number} n - Number of nodes
 * @param {boolean} directed - Whether graph is directed
 * @param {number|null} sampleSize - Sample size used (null if no sampling)
 */
function normalizeScores(betweenness, n, directed, sampleSize) {
  if (n <= 2) return;

  // Normalization factor: maximum possible betweenness
  // For directed: (n-1)(n-2), for undirected: (n-1)(n-2)/2
  const normFactor = directed ? (n - 1) * (n - 2) : ((n - 1) * (n - 2)) / 2;

  if (normFactor > 0) {
    for (const nodeId of Object.keys(betweenness)) {
      betweenness[nodeId] /= normFactor;
    }
  }
}

/**
 * Sample nodes for approximation algorithm.
 *
 * @param {Array} nodeIds - All node IDs
 * @param {number} sampleSize - Number of nodes to sample
 * @returns {Array} Sampled node IDs
 */
function sampleNodes(nodeIds, sampleSize) {
  const shuffled = [...nodeIds];
  // Fisher-Yates shuffle for first sampleSize elements
  for (let i = 0; i < Math.min(sampleSize, shuffled.length); i++) {
    const j = i + Math.floor(Math.random() * (shuffled.length - i));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, sampleSize);
}

/**
 * Create a ranked list of entities with their betweenness scores.
 *
 * @param {Array} nodes - Original node objects
 * @param {Object} scores - Map of node ID to betweenness score
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
        betweenness: score,
        description: node?.description,
        confidence: node?.confidence,
      };
    })
    .sort((a, b) => b.betweenness - a.betweenness);

  return rankedEntities;
}

/**
 * Get top N entities by betweenness centrality score.
 *
 * @param {number} n - Number of top entities to return
 * @param {Object} options - Betweenness calculation options
 * @returns {Promise<Array>} Top N entities sorted by betweenness
 */
async function getTopEntitiesByBetweenness(n = 10, options = {}) {
  const result = await calculateBetweenness(options);
  return result.rankedEntities.slice(0, n);
}

/**
 * Get betweenness centrality score for a specific entity.
 *
 * @param {string} entityId - Entity ID to look up
 * @param {Object} options - Betweenness calculation options
 * @returns {Promise<Object|null>} Entity with betweenness score or null if not found
 */
async function getEntityBetweenness(entityId, options = {}) {
  const result = await calculateBetweenness(options);
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

/**
 * Identify bridge entities - nodes that if removed would significantly
 * increase path lengths or disconnect the graph.
 *
 * @param {number} threshold - Minimum normalized betweenness to be considered a bridge (default: 0.1)
 * @param {Object} options - Betweenness calculation options
 * @returns {Promise<Array>} Bridge entities with their scores
 */
async function identifyBridgeEntities(threshold = 0.1, options = {}) {
  const result = await calculateBetweenness({ ...options, normalized: true });

  return result.rankedEntities.filter((entity) => entity.betweenness >= threshold);
}

module.exports = {
  calculateBetweenness,
  getTopEntitiesByBetweenness,
  getEntityBetweenness,
  identifyBridgeEntities,
  DEFAULT_CONFIG,
};
