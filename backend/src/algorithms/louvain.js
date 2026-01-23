/**
 * Louvain Community Detection Algorithm Implementation
 *
 * Detects communities in the knowledge graph using the Louvain method,
 * which optimizes modularity through iterative node movements between
 * communities and hierarchical aggregation.
 *
 * Feature: F3.1.1 - Louvain Algorithm
 */

const { getGraphService } = require('../services/graph-service');
const { log } = require('../utils/logger');

/**
 * Louvain configuration defaults
 */
const DEFAULT_CONFIG = {
  maxIterations: 100, // Maximum iterations per phase
  minModularityGain: 1e-7, // Minimum gain to continue optimization
  resolution: 1.0, // Resolution parameter (higher = smaller communities)
};

/**
 * Calculate modularity of the current community assignment.
 *
 * Modularity Q = (1/2m) * sum[(Aij - (ki*kj)/(2m)) * delta(ci, cj)]
 *
 * @param {Map} communities - Map of nodeId -> communityId
 * @param {Map} adjacency - Map of nodeId -> Set of neighbor nodeIds
 * @param {Map} degrees - Map of nodeId -> degree (total edge weight)
 * @param {number} totalWeight - Total edge weight (2m)
 * @param {number} resolution - Resolution parameter
 * @returns {number} Modularity score (-0.5 to 1.0)
 */
function calculateModularity(communities, adjacency, degrees, totalWeight, resolution = 1.0) {
  if (totalWeight === 0) return 0;

  let modularity = 0;
  const communityWeights = new Map(); // Sum of degrees in each community
  const internalWeights = new Map(); // Sum of internal edge weights in each community

  // Calculate community weights
  for (const [nodeId, communityId] of communities) {
    const degree = degrees.get(nodeId) || 0;
    communityWeights.set(communityId, (communityWeights.get(communityId) || 0) + degree);
  }

  // Calculate internal edge weights
  for (const [nodeId, neighbors] of adjacency) {
    const communityId = communities.get(nodeId);
    for (const neighborId of neighbors) {
      if (communities.get(neighborId) === communityId) {
        internalWeights.set(communityId, (internalWeights.get(communityId) || 0) + 1);
      }
    }
  }

  // Calculate modularity
  for (const communityId of new Set(communities.values())) {
    const internal = (internalWeights.get(communityId) || 0) / 2; // Each edge counted twice
    const total = communityWeights.get(communityId) || 0;
    modularity += internal / totalWeight - resolution * Math.pow(total / (2 * totalWeight), 2);
  }

  return modularity;
}

/**
 * Calculate the modularity gain from moving a node to a new community.
 *
 * @param {string} nodeId - Node to move
 * @param {string} targetCommunity - Community to move to
 * @param {Map} communities - Current community assignments
 * @param {Map} adjacency - Adjacency list
 * @param {Map} degrees - Node degrees
 * @param {number} totalWeight - Total edge weight
 * @param {number} resolution - Resolution parameter
 * @returns {number} Modularity gain (can be negative)
 */
function calculateModularityGain(
  nodeId,
  targetCommunity,
  communities,
  adjacency,
  degrees,
  totalWeight,
  resolution
) {
  if (totalWeight === 0) return 0;

  const currentCommunity = communities.get(nodeId);
  if (currentCommunity === targetCommunity) return 0;

  const ki = degrees.get(nodeId) || 0;
  const neighbors = adjacency.get(nodeId) || new Set();

  // Count edges to current community and target community
  let edgesToCurrent = 0;
  let edgesToTarget = 0;

  for (const neighborId of neighbors) {
    const neighborCommunity = communities.get(neighborId);
    if (neighborCommunity === currentCommunity && neighborId !== nodeId) {
      edgesToCurrent++;
    }
    if (neighborCommunity === targetCommunity) {
      edgesToTarget++;
    }
  }

  // Calculate sum of degrees in current and target communities (excluding nodeId)
  let sumCurrent = 0;
  let sumTarget = 0;

  for (const [nId, cId] of communities) {
    if (nId === nodeId) continue;
    const degree = degrees.get(nId) || 0;
    if (cId === currentCommunity) sumCurrent += degree;
    if (cId === targetCommunity) sumTarget += degree;
  }

  // Modularity gain formula
  const m2 = 2 * totalWeight;
  const gain =
    (edgesToTarget - edgesToCurrent) / totalWeight -
    resolution * ki * (sumTarget - sumCurrent) / (m2 * totalWeight);

  return gain;
}

/**
 * Perform one phase of the Louvain algorithm (local moving).
 *
 * @param {Map} communities - Current community assignments
 * @param {Map} adjacency - Adjacency list
 * @param {Map} degrees - Node degrees
 * @param {number} totalWeight - Total edge weight
 * @param {Object} config - Algorithm configuration
 * @returns {Object} { improved: boolean, communities: Map }
 */
function localMovingPhase(communities, adjacency, degrees, totalWeight, config) {
  const { maxIterations, minModularityGain, resolution } = config;

  let improved = true;
  let iteration = 0;
  let totalGain = 0;

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    const nodeIds = Array.from(communities.keys());
    // Randomize order for better convergence
    for (let i = nodeIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
    }

    for (const nodeId of nodeIds) {
      const currentCommunity = communities.get(nodeId);
      const neighbors = adjacency.get(nodeId) || new Set();

      // Find unique communities among neighbors
      const neighborCommunities = new Set();
      for (const neighborId of neighbors) {
        neighborCommunities.add(communities.get(neighborId));
      }

      // Try moving to each neighbor community
      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const targetCommunity of neighborCommunities) {
        if (targetCommunity === currentCommunity) continue;

        const gain = calculateModularityGain(
          nodeId,
          targetCommunity,
          communities,
          adjacency,
          degrees,
          totalWeight,
          resolution
        );

        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = targetCommunity;
        }
      }

      // Move node if there's a positive gain
      if (bestGain > minModularityGain) {
        communities.set(nodeId, bestCommunity);
        improved = true;
        totalGain += bestGain;
      }
    }
  }

  log.debug(`Local moving phase completed`, { iterations: iteration, totalGain });
  return { improved: totalGain > minModularityGain, communities };
}

/**
 * Aggregate communities into super-nodes for hierarchical optimization.
 *
 * @param {Map} communities - Current community assignments
 * @param {Map} adjacency - Original adjacency list
 * @returns {Object} { superAdjacency, superCommunities, communityMapping }
 */
function aggregateCommunities(communities, adjacency) {
  // Get unique communities
  const uniqueCommunities = Array.from(new Set(communities.values()));
  const communityToSuper = new Map();

  // Map each community to a super-node ID
  uniqueCommunities.forEach((communityId, index) => {
    communityToSuper.set(communityId, `super_${index}`);
  });

  // Build super-node adjacency
  const superAdjacency = new Map();
  const superDegrees = new Map();

  for (const superId of communityToSuper.values()) {
    superAdjacency.set(superId, new Set());
    superDegrees.set(superId, 0);
  }

  // Count edges between communities
  for (const [nodeId, neighbors] of adjacency) {
    const nodeCommunity = communities.get(nodeId);
    const nodeSuper = communityToSuper.get(nodeCommunity);

    for (const neighborId of neighbors) {
      const neighborCommunity = communities.get(neighborId);
      const neighborSuper = communityToSuper.get(neighborCommunity);

      if (nodeSuper !== neighborSuper) {
        superAdjacency.get(nodeSuper).add(neighborSuper);
      }
      superDegrees.set(nodeSuper, (superDegrees.get(nodeSuper) || 0) + 1);
    }
  }

  // Initialize super-node communities (each super-node in its own community)
  const superCommunities = new Map();
  for (const superId of communityToSuper.values()) {
    superCommunities.set(superId, superId);
  }

  // Create mapping from original nodes to final communities
  const nodeToSuperMapping = new Map();
  for (const [nodeId, communityId] of communities) {
    nodeToSuperMapping.set(nodeId, communityToSuper.get(communityId));
  }

  return {
    superAdjacency,
    superCommunities,
    superDegrees,
    communityToSuper,
    nodeToSuperMapping,
  };
}

/**
 * Detect communities in the knowledge graph using the Louvain algorithm.
 *
 * @param {Object} options - Configuration options
 * @param {number} options.maxIterations - Maximum iterations per phase (default: 100)
 * @param {number} options.minModularityGain - Minimum gain to continue (default: 1e-7)
 * @param {number} options.resolution - Resolution parameter (default: 1.0)
 * @returns {Promise<Object>} Community detection results
 */
async function detectCommunities(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const { resolution } = config;

  log.info('Starting Louvain community detection', { config });
  const startTime = Date.now();

  try {
    // Fetch graph data
    const graphService = getGraphService();
    const { nodes, edges } = await graphService.getAllEntities(10000);

    if (nodes.length === 0) {
      log.warn('No nodes found in graph for community detection');
      return {
        communities: {},
        communityList: [],
        modularity: 0,
        metadata: {
          nodeCount: 0,
          edgeCount: 0,
          communityCount: 0,
          hierarchyLevels: 0,
          executionTimeMs: Date.now() - startTime,
        },
      };
    }

    log.info(`Loaded graph data for community detection`, {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    });

    // Build adjacency structures
    const adjacency = new Map();
    const degrees = new Map();
    const nodeIdSet = new Set(nodes.map((n) => n.id));

    // Initialize
    for (const node of nodes) {
      adjacency.set(node.id, new Set());
      degrees.set(node.id, 0);
    }

    // Build adjacency list (undirected graph for community detection)
    let totalWeight = 0;
    for (const edge of edges) {
      const source = edge.source;
      const target = edge.target;

      if (nodeIdSet.has(source) && nodeIdSet.has(target) && source !== target) {
        adjacency.get(source).add(target);
        adjacency.get(target).add(source);
        degrees.set(source, (degrees.get(source) || 0) + 1);
        degrees.set(target, (degrees.get(target) || 0) + 1);
        totalWeight++;
      }
    }

    // Initialize each node in its own community
    let communities = new Map();
    for (const node of nodes) {
      communities.set(node.id, node.id);
    }

    // Track hierarchy levels
    let hierarchyLevels = 0;
    let improved = true;
    let currentAdjacency = adjacency;
    let currentDegrees = degrees;
    let currentCommunities = communities;
    let currentTotalWeight = totalWeight;

    // Main Louvain loop: alternate between local moving and aggregation
    while (improved) {
      hierarchyLevels++;

      // Phase 1: Local moving
      const result = localMovingPhase(
        currentCommunities,
        currentAdjacency,
        currentDegrees,
        currentTotalWeight,
        config
      );
      currentCommunities = result.communities;
      improved = result.improved;

      if (!improved) break;

      // Check if all nodes are in the same community
      const uniqueCommunities = new Set(currentCommunities.values());
      if (uniqueCommunities.size <= 1) break;

      // Phase 2: Aggregation
      const aggregated = aggregateCommunities(currentCommunities, currentAdjacency);

      // If no aggregation possible, stop
      if (aggregated.superCommunities.size === currentCommunities.size) {
        break;
      }

      // Map original node communities through hierarchy
      if (hierarchyLevels === 1) {
        // First level: use direct mapping
        for (const [nodeId, superId] of aggregated.nodeToSuperMapping) {
          communities.set(nodeId, superId);
        }
      } else {
        // Later levels: compose mappings
        for (const [nodeId, currentComm] of communities) {
          const superComm = aggregated.communityToSuper.get(currentComm);
          if (superComm) {
            communities.set(nodeId, superComm);
          }
        }
      }

      currentAdjacency = aggregated.superAdjacency;
      currentDegrees = aggregated.superDegrees;
      currentCommunities = aggregated.superCommunities;

      log.debug(`Completed hierarchy level ${hierarchyLevels}`, {
        communities: uniqueCommunities.size,
      });
    }

    // Renumber communities to sequential integers
    const communityRemap = new Map();
    let nextCommunityId = 0;
    for (const communityId of communities.values()) {
      if (!communityRemap.has(communityId)) {
        communityRemap.set(communityId, nextCommunityId++);
      }
    }

    // Apply remapping
    for (const [nodeId, communityId] of communities) {
      communities.set(nodeId, communityRemap.get(communityId));
    }

    // Calculate final modularity
    const modularity = calculateModularity(
      communities,
      adjacency,
      degrees,
      totalWeight,
      resolution
    );

    // Build community list with member nodes
    const communityList = buildCommunityList(nodes, communities);

    const executionTimeMs = Date.now() - startTime;
    log.info('Louvain community detection completed', {
      communityCount: communityList.length,
      modularity: modularity.toFixed(4),
      hierarchyLevels,
      executionTimeMs,
    });

    return {
      communities: Object.fromEntries(communities),
      communityList,
      modularity,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        communityCount: communityList.length,
        hierarchyLevels,
        resolution,
        executionTimeMs,
      },
    };
  } catch (error) {
    log.errorWithStack('Louvain community detection failed', error);
    throw error;
  }
}

/**
 * Build a list of communities with their member nodes.
 *
 * @param {Array} nodes - Original node objects
 * @param {Map} communities - Map of nodeId -> communityId
 * @returns {Array} Array of community objects
 */
function buildCommunityList(nodes, communities) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const communityMembers = new Map();

  // Group nodes by community
  for (const [nodeId, communityId] of communities) {
    if (!communityMembers.has(communityId)) {
      communityMembers.set(communityId, []);
    }
    communityMembers.get(communityId).push(nodeId);
  }

  // Build community list
  const communityList = [];
  for (const [communityId, memberIds] of communityMembers) {
    const members = memberIds.map((id) => {
      const node = nodeMap.get(id);
      return {
        id,
        name: node?.name || node?.label || id,
        type: node?.type || 'Unknown',
      };
    });

    // Count entity types in community
    const typeCounts = {};
    for (const member of members) {
      typeCounts[member.type] = (typeCounts[member.type] || 0) + 1;
    }

    communityList.push({
      id: communityId,
      size: members.length,
      members,
      typeCounts,
      // Determine dominant type
      dominantType: Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown',
    });
  }

  // Sort by size (largest first)
  communityList.sort((a, b) => b.size - a.size);

  return communityList;
}

/**
 * Get community for a specific entity.
 *
 * @param {string} entityId - Entity ID to look up
 * @param {Object} options - Detection options
 * @returns {Promise<Object|null>} Community info for the entity
 */
async function getEntityCommunity(entityId, options = {}) {
  const result = await detectCommunities(options);
  const communityId = result.communities[entityId];

  if (communityId === undefined) {
    return null;
  }

  const community = result.communityList.find((c) => c.id === communityId);

  return {
    entityId,
    communityId,
    community,
    totalCommunities: result.communityList.length,
    modularity: result.modularity,
  };
}

/**
 * Get the largest communities.
 *
 * @param {number} n - Number of communities to return
 * @param {Object} options - Detection options
 * @returns {Promise<Array>} Top N communities by size
 */
async function getTopCommunities(n = 10, options = {}) {
  const result = await detectCommunities(options);
  return result.communityList.slice(0, n);
}

/**
 * Incremental Community Detection using Dynamic Frontier approach.
 *
 * Based on DF Louvain (Dynamic Frontier) algorithm that achieves significant speedup
 * by only processing affected vertices when the graph changes.
 *
 * Feature: F3.1.4 - Incremental Community Updates
 *
 * @see https://arxiv.org/html/2404.19634v3 - DF Louvain paper
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.previousResult - Previous detection result with communities map
 * @param {Array} options.newNodeIds - IDs of nodes added since last detection
 * @param {Array} options.newEdges - Edges added since last detection {source, target}
 * @param {Array} options.modifiedNodeIds - IDs of nodes modified since last detection
 * @param {number} options.maxIterations - Max iterations for local moving phase
 * @param {number} options.minModularityGain - Min gain threshold
 * @param {number} options.resolution - Resolution parameter
 * @returns {Promise<Object>} Incremental community detection results
 */
async function detectCommunitiesIncremental(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const {
    previousResult,
    newNodeIds = [],
    newEdges = [],
    modifiedNodeIds = [],
    resolution,
  } = config;

  log.info('Starting incremental community detection (DF Louvain)', {
    newNodeCount: newNodeIds.length,
    newEdgeCount: newEdges.length,
    modifiedNodeCount: modifiedNodeIds.length,
    hasPreviousResult: !!previousResult,
  });

  const startTime = Date.now();

  try {
    // Fetch current graph data
    const graphService = getGraphService();
    const { nodes, edges } = await graphService.getAllEntities(10000);

    if (nodes.length === 0) {
      log.warn('No nodes found in graph for incremental community detection');
      return {
        communities: {},
        communityList: [],
        modularity: 0,
        metadata: {
          nodeCount: 0,
          edgeCount: 0,
          communityCount: 0,
          executionTimeMs: Date.now() - startTime,
          incremental: true,
          affectedNodeCount: 0,
        },
      };
    }

    // Build adjacency structures
    const adjacency = new Map();
    const degrees = new Map();
    const nodeIdSet = new Set(nodes.map((n) => n.id));

    // Initialize
    for (const node of nodes) {
      adjacency.set(node.id, new Set());
      degrees.set(node.id, 0);
    }

    // Build adjacency list (undirected graph)
    let totalWeight = 0;
    for (const edge of edges) {
      const source = edge.source;
      const target = edge.target;

      if (nodeIdSet.has(source) && nodeIdSet.has(target) && source !== target) {
        adjacency.get(source).add(target);
        adjacency.get(target).add(source);
        degrees.set(source, (degrees.get(source) || 0) + 1);
        degrees.set(target, (degrees.get(target) || 0) + 1);
        totalWeight++;
      }
    }

    // Determine if we should use incremental or full detection
    const hasValidPreviousResult = previousResult &&
      previousResult.communities &&
      Object.keys(previousResult.communities).length > 0;

    const totalChanges = newNodeIds.length + newEdges.length + modifiedNodeIds.length;
    const changeRatio = nodes.length > 0 ? totalChanges / nodes.length : 1;

    // Use full detection if:
    // - No valid previous result
    // - Change ratio is > 30% (incremental won't be beneficial)
    // - Very small graph (< 10 nodes)
    if (!hasValidPreviousResult || changeRatio > 0.3 || nodes.length < 10) {
      log.info('Using full detection instead of incremental', {
        reason: !hasValidPreviousResult ? 'no_previous_result' :
                changeRatio > 0.3 ? 'high_change_ratio' : 'small_graph',
        changeRatio: changeRatio.toFixed(3),
      });
      return detectCommunities(options);
    }

    // Initialize communities from previous result (seed property approach)
    let communities = new Map();
    let nextCommunityId = 0;

    // Map previous communities
    for (const [nodeId, communityId] of Object.entries(previousResult.communities)) {
      if (nodeIdSet.has(nodeId)) {
        communities.set(nodeId, communityId);
        nextCommunityId = Math.max(nextCommunityId, communityId + 1);
      }
    }

    // Identify affected frontier: nodes that need reprocessing
    const affectedNodes = new Set();

    // 1. New nodes are affected
    for (const nodeId of newNodeIds) {
      if (nodeIdSet.has(nodeId)) {
        affectedNodes.add(nodeId);
        // Assign new nodes to their own community initially
        communities.set(nodeId, nextCommunityId++);
      }
    }

    // 2. Endpoints of new edges are affected
    for (const edge of newEdges) {
      if (nodeIdSet.has(edge.source)) affectedNodes.add(edge.source);
      if (nodeIdSet.has(edge.target)) affectedNodes.add(edge.target);
    }

    // 3. Modified nodes are affected
    for (const nodeId of modifiedNodeIds) {
      if (nodeIdSet.has(nodeId)) {
        affectedNodes.add(nodeId);
      }
    }

    // 4. Neighbors of affected nodes are also in the frontier
    const frontier = new Set(affectedNodes);
    for (const nodeId of affectedNodes) {
      const neighbors = adjacency.get(nodeId) || new Set();
      for (const neighborId of neighbors) {
        frontier.add(neighborId);
      }
    }

    // Ensure all nodes have a community assignment
    for (const node of nodes) {
      if (!communities.has(node.id)) {
        communities.set(node.id, nextCommunityId++);
      }
    }

    log.info('Identified frontier for incremental detection', {
      affectedNodes: affectedNodes.size,
      frontierSize: frontier.size,
      totalNodes: nodes.length,
      frontierRatio: (frontier.size / nodes.length).toFixed(3),
    });

    // Run local moving phase only on frontier nodes
    const result = localMovingPhaseIncremental(
      communities,
      adjacency,
      degrees,
      totalWeight,
      frontier,
      config
    );
    communities = result.communities;

    // Renumber communities to sequential integers
    const communityRemap = new Map();
    let finalCommunityId = 0;
    for (const communityId of communities.values()) {
      if (!communityRemap.has(communityId)) {
        communityRemap.set(communityId, finalCommunityId++);
      }
    }

    // Apply remapping
    for (const [nodeId, communityId] of communities) {
      communities.set(nodeId, communityRemap.get(communityId));
    }

    // Calculate final modularity
    const modularity = calculateModularity(
      communities,
      adjacency,
      degrees,
      totalWeight,
      resolution
    );

    // Build community list with member nodes
    const communityList = buildCommunityList(nodes, communities);

    // Identify which communities changed
    const changedCommunities = identifyChangedCommunities(
      previousResult.communities,
      Object.fromEntries(communities),
      affectedNodes
    );

    const executionTimeMs = Date.now() - startTime;

    log.info('Incremental community detection completed', {
      communityCount: communityList.length,
      modularity: modularity.toFixed(4),
      affectedNodes: affectedNodes.size,
      frontierSize: frontier.size,
      changedCommunities: changedCommunities.length,
      executionTimeMs,
    });

    return {
      communities: Object.fromEntries(communities),
      communityList,
      modularity,
      changedCommunities,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        communityCount: communityList.length,
        hierarchyLevels: 1, // Incremental doesn't use hierarchy
        resolution,
        executionTimeMs,
        incremental: true,
        affectedNodeCount: affectedNodes.size,
        frontierSize: frontier.size,
        changedCommunityCount: changedCommunities.length,
        changeRatio,
      },
    };
  } catch (error) {
    log.errorWithStack('Incremental community detection failed, falling back to full', error);
    // Fallback to full detection
    return detectCommunities(options);
  }
}

/**
 * Incremental local moving phase - only processes frontier nodes.
 *
 * @param {Map} communities - Current community assignments
 * @param {Map} adjacency - Adjacency list
 * @param {Map} degrees - Node degrees
 * @param {number} totalWeight - Total edge weight
 * @param {Set} frontier - Nodes to process
 * @param {Object} config - Algorithm configuration
 * @returns {Object} { improved: boolean, communities: Map }
 */
function localMovingPhaseIncremental(communities, adjacency, degrees, totalWeight, frontier, config) {
  const { maxIterations, minModularityGain, resolution } = config;

  let improved = true;
  let iteration = 0;
  let totalGain = 0;

  // Convert frontier to array for iteration
  const frontierArray = Array.from(frontier);

  while (improved && iteration < maxIterations) {
    improved = false;
    iteration++;

    // Randomize order for better convergence
    for (let i = frontierArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [frontierArray[i], frontierArray[j]] = [frontierArray[j], frontierArray[i]];
    }

    for (const nodeId of frontierArray) {
      const currentCommunity = communities.get(nodeId);
      const neighbors = adjacency.get(nodeId) || new Set();

      // Find unique communities among neighbors
      const neighborCommunities = new Set();
      for (const neighborId of neighbors) {
        neighborCommunities.add(communities.get(neighborId));
      }

      // Try moving to each neighbor community
      let bestCommunity = currentCommunity;
      let bestGain = 0;

      for (const targetCommunity of neighborCommunities) {
        if (targetCommunity === currentCommunity) continue;

        const gain = calculateModularityGain(
          nodeId,
          targetCommunity,
          communities,
          adjacency,
          degrees,
          totalWeight,
          resolution
        );

        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = targetCommunity;
        }
      }

      // Move node if there's a positive gain
      if (bestGain > minModularityGain) {
        communities.set(nodeId, bestCommunity);
        improved = true;
        totalGain += bestGain;
      }
    }
  }

  log.debug('Incremental local moving phase completed', {
    iterations: iteration,
    totalGain,
    frontierSize: frontier.size,
  });

  return { improved: totalGain > minModularityGain, communities };
}

/**
 * Identify which communities changed between two detection runs.
 *
 * @param {Object} previousCommunities - Previous nodeId -> communityId mapping
 * @param {Object} currentCommunities - Current nodeId -> communityId mapping
 * @param {Set} affectedNodes - Nodes that were in the frontier
 * @returns {Array} List of changed community IDs
 */
function identifyChangedCommunities(previousCommunities, currentCommunities, affectedNodes) {
  const changedCommunities = new Set();

  // Communities containing affected nodes have changed
  for (const nodeId of affectedNodes) {
    const currentComm = currentCommunities[nodeId];
    if (currentComm !== undefined) {
      changedCommunities.add(currentComm);
    }
  }

  // Also check for nodes that moved between communities
  for (const [nodeId, prevComm] of Object.entries(previousCommunities)) {
    const currComm = currentCommunities[nodeId];
    if (currComm !== undefined && currComm !== prevComm) {
      changedCommunities.add(currComm);
      changedCommunities.add(prevComm);
    }
  }

  return Array.from(changedCommunities);
}

/**
 * Smart community detection that chooses between full and incremental.
 *
 * @param {Object} options - Detection options
 * @param {string} options.sinceTimestamp - Timestamp of last detection
 * @returns {Promise<Object>} Detection results
 */
async function detectCommunitiesSmart(options = {}) {
  const { sinceTimestamp, previousResult } = options;

  if (!sinceTimestamp || !previousResult) {
    log.info('No previous state, using full detection');
    return detectCommunities(options);
  }

  try {
    const graphService = getGraphService();
    const changeSummary = await graphService.getGraphChangeSummary(sinceTimestamp);

    if (!changeSummary.hasChanges) {
      log.info('No graph changes detected, returning previous result');
      return {
        ...previousResult,
        metadata: {
          ...previousResult.metadata,
          fromCache: true,
          noChanges: true,
        },
      };
    }

    if (changeSummary.recommendIncremental) {
      log.info('Using incremental detection based on change analysis', {
        changeRatio: changeSummary.changeRatio,
        totalChanges: changeSummary.totalChanges,
      });

      // Get the actual changed entities
      const [entityChanges, edgeChanges] = await Promise.all([
        graphService.getEntitiesModifiedSince(sinceTimestamp),
        graphService.getEdgesCreatedSince(sinceTimestamp),
      ]);

      return detectCommunitiesIncremental({
        ...options,
        previousResult,
        newNodeIds: entityChanges.newEntities.map(e => e.id),
        modifiedNodeIds: entityChanges.modifiedEntities.map(e => e.id),
        newEdges: edgeChanges.newEdges,
      });
    }

    log.info('Using full detection due to high change ratio', {
      changeRatio: changeSummary.changeRatio,
    });
    return detectCommunities(options);
  } catch (error) {
    log.warn('Smart detection failed, falling back to full', { error: error.message });
    return detectCommunities(options);
  }
}

module.exports = {
  detectCommunities,
  detectCommunitiesIncremental,
  detectCommunitiesSmart,
  getEntityCommunity,
  getTopCommunities,
  calculateModularity,
  identifyChangedCommunities,
  DEFAULT_CONFIG,
};
