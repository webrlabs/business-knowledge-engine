/**
 * Impact Analysis Service
 *
 * Provides dependency traversal and impact analysis for entities in the knowledge graph.
 * Implements features F3.3.1, F3.3.2, F3.3.3, and F3.3.4 from the feature backlog.
 *
 * Key capabilities:
 * - Upstream dependency traversal: "What does X depend on?"
 * - Downstream impact traversal: "What depends on X?"
 * - Impact scoring based on path length and entity importance
 *
 * @see https://learn.microsoft.com/en-us/azure/cosmos-db/gremlin/modeling
 */

const { getGraphService } = require('./graph-service');
const { log } = require('../utils/logger');

/**
 * Relationship types that indicate dependency/influence direction.
 * These are used to determine upstream vs downstream traversal.
 */
const DEPENDENCY_EDGE_TYPES = {
  // Edges where the source depends on the target (follow outward for upstream)
  upstream: ['DEPENDS_ON', 'REQUIRES', 'USES', 'INPUTS', 'PART_OF'],
  // Edges where the target depends on the source (follow inward for downstream)
  downstream: ['PRODUCES', 'CONTAINS', 'MANAGES', 'TRIGGERS', 'FOLLOWED_BY'],
  // Bidirectional relationships (consider both directions)
  bidirectional: ['RELATED_TO', 'ASSOCIATED_WITH'],
};

/**
 * Default configuration for impact analysis
 */
const DEFAULT_CONFIG = {
  maxDepth: 5,            // Maximum traversal depth
  maxEntities: 100,       // Maximum entities to return
  includeImportance: true, // Include importance scores in results
  decayFactor: 0.7,       // Impact score decay per hop (closer = higher impact)
};

/**
 * Calculate impact score based on path length and entity importance.
 * Uses exponential decay: closer entities have higher impact.
 *
 * @param {number} pathLength - Number of hops from source entity
 * @param {number} entityImportance - Importance score of the entity (0-1)
 * @param {number} decayFactor - Decay factor per hop (default 0.7)
 * @returns {number} Impact score (0-1)
 */
function calculateImpactScore(pathLength, entityImportance = 0.5, decayFactor = DEFAULT_CONFIG.decayFactor) {
  // Base impact decays exponentially with path length
  const distanceDecay = Math.pow(decayFactor, pathLength);

  // Combine distance decay with entity importance
  // Weight: 60% distance, 40% importance
  const impactScore = (0.6 * distanceDecay) + (0.4 * entityImportance);

  return Math.min(1, Math.max(0, impactScore));
}

/**
 * Traverse upstream to find dependencies.
 * Answers: "What does X depend on?"
 *
 * @param {string} entityName - Name of the starting entity
 * @param {Object} options - Traversal options
 * @param {number} options.maxDepth - Maximum traversal depth (default 5)
 * @param {number} options.maxEntities - Maximum entities to return (default 100)
 * @param {string[]} options.edgeTypes - Edge types to follow (optional)
 * @returns {Promise<Object>} Upstream dependencies with impact scores
 */
async function getUpstreamDependencies(entityName, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const graphService = getGraphService();
  const startTime = Date.now();

  log.info('Starting upstream dependency traversal', {
    entityName,
    maxDepth: config.maxDepth,
  });

  try {
    // Build edge filter for upstream traversal
    const edgeTypes = config.edgeTypes || DEPENDENCY_EDGE_TYPES.upstream;
    const edgeFilter = edgeTypes.map((t) => `'${t}'`).join(', ');

    // Gremlin query for upstream traversal
    // Follow outgoing edges of dependency types to find what this entity depends on
    const query = `
      g.V().has('name', entityName)
        .repeat(
          outE().hasLabel(within(${edgeFilter}))
          .inV()
          .simplePath()
        )
        .times(${config.maxDepth})
        .emit()
        .path()
        .by(valueMap(true).fold())
        .limit(${config.maxEntities})
    `;

    const pathResults = await graphService._submit(query, { entityName });

    // Process path results to extract entities and calculate impact
    const dependenciesMap = new Map();
    const paths = [];

    for (const path of pathResults) {
      const pathObjects = path.objects || path;
      if (!Array.isArray(pathObjects) || pathObjects.length < 2) continue;

      const processedPath = [];

      for (let i = 0; i < pathObjects.length; i++) {
        const item = pathObjects[i];
        // Handle folded valueMap results
        const vertexData = Array.isArray(item) ? item[0] : item;
        if (!vertexData || !vertexData.id) continue;

        const entity = normalizeVertexData(vertexData);
        const pathLength = Math.floor(i / 2); // Every other element is a vertex

        // Calculate impact score
        const importance = entity.importance || 0.5;
        const impactScore = calculateImpactScore(pathLength, importance, config.decayFactor);

        // Track unique entities with their closest path
        if (!dependenciesMap.has(entity.id) || dependenciesMap.get(entity.id).pathLength > pathLength) {
          dependenciesMap.set(entity.id, {
            ...entity,
            pathLength,
            impactScore,
            direction: 'upstream',
          });
        }

        processedPath.push(entity.name);
      }

      if (processedPath.length > 1) {
        paths.push(processedPath);
      }
    }

    // Convert to sorted array
    const dependencies = Array.from(dependenciesMap.values())
      .filter((d) => d.name !== entityName) // Exclude starting entity
      .sort((a, b) => b.impactScore - a.impactScore);

    const executionTimeMs = Date.now() - startTime;

    log.info('Upstream traversal completed', {
      entityName,
      dependencyCount: dependencies.length,
      pathCount: paths.length,
      executionTimeMs,
    });

    return {
      sourceEntity: entityName,
      direction: 'upstream',
      description: `What ${entityName} depends on`,
      dependencies,
      paths: paths.slice(0, 10), // Return top 10 paths for visualization
      metadata: {
        totalDependencies: dependencies.length,
        maxDepthReached: Math.max(...dependencies.map((d) => d.pathLength), 0),
        executionTimeMs,
      },
    };
  } catch (error) {
    log.errorWithStack('Upstream traversal failed', error, { entityName });

    // Return empty result on error
    return {
      sourceEntity: entityName,
      direction: 'upstream',
      description: `What ${entityName} depends on`,
      dependencies: [],
      paths: [],
      metadata: {
        totalDependencies: 0,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
      },
    };
  }
}

/**
 * Traverse downstream to find impacted entities.
 * Answers: "What depends on X?" / "What will be affected if X changes?"
 *
 * @param {string} entityName - Name of the starting entity
 * @param {Object} options - Traversal options
 * @param {number} options.maxDepth - Maximum traversal depth (default 5)
 * @param {number} options.maxEntities - Maximum entities to return (default 100)
 * @param {string[]} options.edgeTypes - Edge types to follow (optional)
 * @returns {Promise<Object>} Downstream impacted entities with impact scores
 */
async function getDownstreamImpact(entityName, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const graphService = getGraphService();
  const startTime = Date.now();

  log.info('Starting downstream impact traversal', {
    entityName,
    maxDepth: config.maxDepth,
  });

  try {
    // Build edge filter for downstream traversal
    // For downstream, we follow incoming edges of dependency types
    const upstreamEdges = config.edgeTypes || DEPENDENCY_EDGE_TYPES.upstream;
    const edgeFilter = upstreamEdges.map((t) => `'${t}'`).join(', ');

    // Gremlin query for downstream traversal
    // Follow incoming edges to find what depends on this entity
    const query = `
      g.V().has('name', entityName)
        .repeat(
          inE().hasLabel(within(${edgeFilter}))
          .outV()
          .simplePath()
        )
        .times(${config.maxDepth})
        .emit()
        .path()
        .by(valueMap(true).fold())
        .limit(${config.maxEntities})
    `;

    const pathResults = await graphService._submit(query, { entityName });

    // Process path results
    const impactedMap = new Map();
    const paths = [];

    for (const path of pathResults) {
      const pathObjects = path.objects || path;
      if (!Array.isArray(pathObjects) || pathObjects.length < 2) continue;

      const processedPath = [];

      for (let i = 0; i < pathObjects.length; i++) {
        const item = pathObjects[i];
        const vertexData = Array.isArray(item) ? item[0] : item;
        if (!vertexData || !vertexData.id) continue;

        const entity = normalizeVertexData(vertexData);
        const pathLength = Math.floor(i / 2);

        const importance = entity.importance || 0.5;
        const impactScore = calculateImpactScore(pathLength, importance, config.decayFactor);

        if (!impactedMap.has(entity.id) || impactedMap.get(entity.id).pathLength > pathLength) {
          impactedMap.set(entity.id, {
            ...entity,
            pathLength,
            impactScore,
            direction: 'downstream',
          });
        }

        processedPath.push(entity.name);
      }

      if (processedPath.length > 1) {
        paths.push(processedPath);
      }
    }

    const impactedEntities = Array.from(impactedMap.values())
      .filter((d) => d.name !== entityName)
      .sort((a, b) => b.impactScore - a.impactScore);

    const executionTimeMs = Date.now() - startTime;

    log.info('Downstream traversal completed', {
      entityName,
      impactedCount: impactedEntities.length,
      pathCount: paths.length,
      executionTimeMs,
    });

    return {
      sourceEntity: entityName,
      direction: 'downstream',
      description: `What depends on ${entityName}`,
      impactedEntities,
      paths: paths.slice(0, 10),
      metadata: {
        totalImpacted: impactedEntities.length,
        maxDepthReached: Math.max(...impactedEntities.map((d) => d.pathLength), 0),
        executionTimeMs,
      },
    };
  } catch (error) {
    log.errorWithStack('Downstream traversal failed', error, { entityName });

    return {
      sourceEntity: entityName,
      direction: 'downstream',
      description: `What depends on ${entityName}`,
      impactedEntities: [],
      paths: [],
      metadata: {
        totalImpacted: 0,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
      },
    };
  }
}

/**
 * Perform bidirectional impact analysis.
 * Combines upstream and downstream traversal for complete picture.
 *
 * @param {string} entityName - Name of the entity to analyze
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Combined upstream and downstream analysis
 */
async function analyzeImpact(entityName, options = {}) {
  const startTime = Date.now();

  log.info('Starting bidirectional impact analysis', { entityName });

  // Run both traversals in parallel
  const [upstream, downstream] = await Promise.all([
    getUpstreamDependencies(entityName, options),
    getDownstreamImpact(entityName, options),
  ]);

  // Calculate aggregate statistics
  const allEntities = [
    ...upstream.dependencies,
    ...downstream.impactedEntities,
  ];

  const uniqueEntities = new Map();
  for (const entity of allEntities) {
    if (!uniqueEntities.has(entity.id)) {
      uniqueEntities.set(entity.id, entity);
    }
  }

  // Identify critical entities (high impact in both directions or very high impact)
  const criticalEntities = allEntities.filter((e) => e.impactScore > 0.7);

  // Group by entity type for summary
  const typeDistribution = {};
  for (const entity of uniqueEntities.values()) {
    const type = entity.type || 'Unknown';
    typeDistribution[type] = (typeDistribution[type] || 0) + 1;
  }

  const executionTimeMs = Date.now() - startTime;

  log.info('Impact analysis completed', {
    entityName,
    upstreamCount: upstream.dependencies.length,
    downstreamCount: downstream.impactedEntities.length,
    criticalCount: criticalEntities.length,
    executionTimeMs,
  });

  return {
    sourceEntity: entityName,
    upstream: {
      description: upstream.description,
      count: upstream.dependencies.length,
      entities: upstream.dependencies,
      paths: upstream.paths,
    },
    downstream: {
      description: downstream.description,
      count: downstream.impactedEntities.length,
      entities: downstream.impactedEntities,
      paths: downstream.paths,
    },
    summary: {
      totalUniqueEntities: uniqueEntities.size,
      criticalEntities: criticalEntities.slice(0, 10),
      criticalCount: criticalEntities.length,
      typeDistribution,
      riskLevel: calculateRiskLevel(downstream.impactedEntities.length, criticalEntities.length),
    },
    metadata: {
      executionTimeMs,
      maxUpstreamDepth: upstream.metadata.maxDepthReached,
      maxDownstreamDepth: downstream.metadata.maxDepthReached,
    },
  };
}

/**
 * Simulate the impact of removing an entity.
 * Shows what would be affected if an entity is removed or changed.
 *
 * @param {string} entityName - Name of the entity to simulate removal
 * @param {Object} options - Simulation options
 * @returns {Promise<Object>} Simulation results
 */
async function simulateRemoval(entityName, options = {}) {
  const startTime = Date.now();

  log.info('Simulating entity removal', { entityName });

  // Get downstream impact (what depends on this entity)
  const downstream = await getDownstreamImpact(entityName, {
    ...options,
    maxDepth: options.maxDepth || 10, // Deeper traversal for simulation
  });

  // Categorize impact by severity
  const directlyAffected = downstream.impactedEntities.filter((e) => e.pathLength === 1);
  const indirectlyAffected = downstream.impactedEntities.filter((e) => e.pathLength > 1);
  const criticallyAffected = downstream.impactedEntities.filter((e) => e.impactScore > 0.7);

  // Identify broken relationships
  const graphService = getGraphService();
  let brokenRelationships = [];

  try {
    const edgeQuery = `
      g.V().has('name', entityName)
        .bothE()
        .project('type', 'from', 'to', 'direction')
        .by(label())
        .by(outV().values('name'))
        .by(inV().values('name'))
        .by(constant('both'))
    `;

    brokenRelationships = await graphService._submit(edgeQuery, { entityName });
  } catch (error) {
    log.warn('Failed to get relationships for simulation', { error: error.message });
  }

  const executionTimeMs = Date.now() - startTime;

  return {
    simulatedEntity: entityName,
    action: 'removal',
    impact: {
      directlyAffected: {
        count: directlyAffected.length,
        entities: directlyAffected,
      },
      indirectlyAffected: {
        count: indirectlyAffected.length,
        entities: indirectlyAffected.slice(0, 20), // Limit for readability
      },
      criticallyAffected: {
        count: criticallyAffected.length,
        entities: criticallyAffected,
      },
    },
    brokenRelationships: {
      count: brokenRelationships.length,
      relationships: brokenRelationships,
    },
    recommendation: generateRecommendation(directlyAffected.length, criticallyAffected.length),
    riskLevel: calculateRiskLevel(downstream.impactedEntities.length, criticallyAffected.length),
    metadata: {
      totalAffectedEntities: downstream.impactedEntities.length,
      executionTimeMs,
    },
  };
}

/**
 * Normalize vertex data from Gremlin response.
 *
 * @param {Object} vertexData - Raw vertex data from Gremlin
 * @returns {Object} Normalized entity object
 */
function normalizeVertexData(vertexData) {
  const entity = {};

  for (const [key, value] of Object.entries(vertexData)) {
    if (key === 'id') {
      entity.id = value;
    } else if (key === 'label') {
      entity.type = value;
    } else if (Array.isArray(value)) {
      entity[key] = value[0];
    } else {
      entity[key] = value;
    }
  }

  return entity;
}

/**
 * Calculate risk level based on impact metrics.
 *
 * @param {number} totalAffected - Total number of affected entities
 * @param {number} criticalCount - Number of critically affected entities
 * @returns {string} Risk level: 'low', 'medium', 'high', or 'critical'
 */
function calculateRiskLevel(totalAffected, criticalCount) {
  if (criticalCount > 5 || totalAffected > 50) return 'critical';
  if (criticalCount > 2 || totalAffected > 20) return 'high';
  if (criticalCount > 0 || totalAffected > 5) return 'medium';
  return 'low';
}

/**
 * Generate recommendation based on impact analysis.
 *
 * @param {number} directCount - Number of directly affected entities
 * @param {number} criticalCount - Number of critically affected entities
 * @returns {string} Recommendation text
 */
function generateRecommendation(directCount, criticalCount) {
  if (criticalCount > 5) {
    return 'CAUTION: This change affects multiple critical entities. Consider phased rollout and extensive testing.';
  }
  if (criticalCount > 0) {
    return 'WARNING: This change affects critical entities. Review dependencies and prepare rollback plan.';
  }
  if (directCount > 10) {
    return 'NOTICE: This change has wide direct impact. Coordinate with dependent teams.';
  }
  if (directCount > 0) {
    return 'INFO: This change has limited impact. Standard change procedures apply.';
  }
  return 'OK: No significant dependencies detected. Change can proceed safely.';
}

// Singleton instance with caching
let cachedAnalysis = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get impact analysis with caching.
 *
 * @param {string} entityName - Entity name
 * @param {string} direction - 'upstream', 'downstream', or 'both'
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Analysis result
 */
async function getImpactAnalysisWithCache(entityName, direction = 'both', options = {}) {
  const cacheKey = `${entityName}:${direction}:${JSON.stringify(options)}`;
  const cached = cachedAnalysis.get(cacheKey);

  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS && !options.forceRefresh) {
    return cached.result;
  }

  let result;
  switch (direction) {
    case 'upstream':
      result = await getUpstreamDependencies(entityName, options);
      break;
    case 'downstream':
      result = await getDownstreamImpact(entityName, options);
      break;
    case 'both':
    default:
      result = await analyzeImpact(entityName, options);
      break;
  }

  cachedAnalysis.set(cacheKey, { result, timestamp: Date.now() });

  // Clean old cache entries
  if (cachedAnalysis.size > 100) {
    const now = Date.now();
    for (const [key, value] of cachedAnalysis.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        cachedAnalysis.delete(key);
      }
    }
  }

  return result;
}

/**
 * Clear the impact analysis cache.
 */
function clearCache() {
  cachedAnalysis.clear();
}

module.exports = {
  getUpstreamDependencies,
  getDownstreamImpact,
  analyzeImpact,
  simulateRemoval,
  getImpactAnalysisWithCache,
  clearCache,
  calculateImpactScore,
  DEPENDENCY_EDGE_TYPES,
  DEFAULT_CONFIG,
};
