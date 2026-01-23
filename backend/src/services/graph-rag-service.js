/**
 * GraphRAG Service
 *
 * Implements state-of-the-art Graph-based Retrieval Augmented Generation:
 * - Entity-centric retrieval with relationship expansion
 * - Community detection and summarization (Microsoft GraphRAG approach)
 * - Multi-hop traversal for complex queries
 * - Hybrid search combining vector similarity and graph structure
 * - Context assembly for LLM queries
 */

const { getGraphService, normalizeEntityName } = require('./graph-service');
const { getSearchService } = require('./search-service');
const { getOpenAIService } = require('./openai-service');
const { getEntityResolutionService } = require('./entity-resolution-service');
const { getImportanceWithCache, calculateImportance } = require('./importance-service');
const { getCommunitySummaryService } = require('./community-summary-service');
const { getOntologyService } = require('./ontology-service');
const { log } = require('../utils/logger');

// Configuration
const CONFIG = {
  // Retrieval parameters
  MAX_ENTITIES: 10,
  MAX_RELATIONSHIPS: 30,
  MAX_HOPS: 3,
  MAX_CHUNKS_PER_ENTITY: 3,

  // Community detection
  MIN_COMMUNITY_SIZE: 3,
  MAX_COMMUNITIES: 5,

  // Context assembly
  MAX_CONTEXT_TOKENS: 8000,
  ENTITY_CONTEXT_WEIGHT: 0.4,
  RELATIONSHIP_CONTEXT_WEIGHT: 0.3,
  CHUNK_CONTEXT_WEIGHT: 0.3,

  // Community context in GraphRAG (F3.1.5)
  INCLUDE_COMMUNITY_CONTEXT: true,  // Include community summaries by default
  COMMUNITY_CONTEXT_WEIGHT: 0.2,    // Weight for community context in assembly
  MAX_COMMUNITY_SUMMARIES: 3,       // Max community summaries to include

  // Importance-weighted retrieval (F3.2.5)
  IMPORTANCE_WEIGHT: 0.3,          // Weight for importance in combined scoring
  SIMILARITY_WEIGHT: 0.7,          // Weight for similarity in combined scoring
  IMPORTANCE_BOOST_FACTOR: 1.5,    // Boost for high-importance entities during expansion
  RRF_K: 60,                       // Reciprocal Rank Fusion constant
};

class GraphRAGService {
  constructor() {
    this.graph = getGraphService();
    this.search = getSearchService();
    this.openai = getOpenAIService();
    this.entityResolution = getEntityResolutionService();
    this.communitySummary = getCommunitySummaryService();
    this.ontology = getOntologyService();
    // Cached importance scores for weighted retrieval (F3.2.5)
    this.importanceScores = null;
    this.importanceScoresTimestamp = 0;
    // Ontology initialization flag (F2.1.2)
    this.ontologyInitialized = false;
  }

  /**
   * Initialize ontology service for polymorphic queries (F2.1.2)
   * @private
   */
  async _ensureOntologyInitialized() {
    if (!this.ontologyInitialized) {
      try {
        await this.ontology.initialize();
        this.ontologyInitialized = true;
      } catch (error) {
        log.warn('Ontology service initialization failed, polymorphic queries may not work', {
          error: error.message
        });
      }
    }
  }

  /**
   * Load or refresh importance scores for weighted retrieval (F3.2.5)
   * Uses caching to avoid recalculating on every query
   */
  async _loadImportanceScores(forceRefresh = false) {
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    if (!forceRefresh && this.importanceScores && (now - this.importanceScoresTimestamp) < CACHE_TTL_MS) {
      return this.importanceScores;
    }

    try {
      const result = await getImportanceWithCache({ forceRefresh });
      this.importanceScores = result.scores || {};
      this.importanceScoresTimestamp = now;
      log.info('Importance scores loaded for weighted retrieval', {
        entityCount: Object.keys(this.importanceScores).length,
      });
      return this.importanceScores;
    } catch (error) {
      log.warn('Failed to load importance scores, using empty map', { error: error.message });
      this.importanceScores = {};
      return this.importanceScores;
    }
  }

  /**
   * Get importance score for an entity (F3.2.5)
   * Returns normalized score [0, 1] or default value if not found
   */
  _getEntityImportance(entityId, entityName) {
    if (!this.importanceScores) return 0.5; // Default middle importance

    // Try by ID first, then by normalized name
    const score = this.importanceScores[entityId] ||
                  this.importanceScores[normalizeEntityName(entityName || '')] ||
                  0.5;
    return score;
  }

  /**
   * Main query method - performs GraphRAG retrieval and returns assembled context
   */
  async query(queryText, options = {}) {
    const startTime = Date.now();

    // Step 0: Load importance scores for weighted retrieval (F3.2.5)
    const useImportanceWeighting = options.useImportanceWeighting !== false;
    if (useImportanceWeighting) {
      await this._loadImportanceScores();
    }

    // Step 1: Extract entities from the query using LLM
    const queryEntities = await this._extractQueryEntities(queryText);

    // Step 2: Resolve query entities to canonical graph entities
    const resolvedEntities = await this._resolveQueryEntities(queryEntities);

    // Step 3: Expand the entity set by traversing relationships
    const expandedGraph = await this._expandEntityGraph(resolvedEntities, options);

    // Step 4: Find relevant document chunks for the expanded entities
    const relevantChunks = await this._findRelevantChunks(queryText, expandedGraph.entities, options);

    // Step 5: Detect communities in the subgraph (for global context)
    const communities = await this._detectCommunities(expandedGraph);

    // Step 6: Assemble context for LLM
    const context = await this._assembleContext(
      queryText,
      expandedGraph,
      relevantChunks,
      communities,
      options
    );

    const processingTime = Date.now() - startTime;

    // Calculate importance statistics for logging (F3.2.5)
    const entitiesWithImportance = expandedGraph.entities.filter(e => e.importance !== undefined);
    const avgImportance = entitiesWithImportance.length > 0
      ? entitiesWithImportance.reduce((sum, e) => sum + (e.importance || 0), 0) / entitiesWithImportance.length
      : 0;

    // Community context settings (F3.1.5)
    const includeCommunityContext = options.includeCommunityContext !== false && CONFIG.INCLUDE_COMMUNITY_CONTEXT;
    const cachedSummaries = this.communitySummary.getAllCachedSummaries();
    const cachedSummaryCount = Object.keys(cachedSummaries).length;

    log.info('GraphRAG query completed', {
      queryLength: queryText.length,
      extractedEntities: queryEntities.length,
      resolvedEntities: resolvedEntities.length,
      expandedEntities: expandedGraph.entities.length,
      relationships: expandedGraph.relationships.length,
      chunks: relevantChunks.length,
      communities: communities.length,
      processingTimeMs: processingTime,
      useImportanceWeighting,
      avgEntityImportance: avgImportance.toFixed(3),
      // F3.1.5 logging
      includeCommunityContext,
      cachedCommunitySummaries: cachedSummaryCount,
    });

    return {
      context,
      metadata: {
        queryEntities,
        resolvedEntities: resolvedEntities.map(e => ({ name: e.name, type: e.type })),
        expandedGraph: {
          entityCount: expandedGraph.entities.length,
          relationshipCount: expandedGraph.relationships.length,
        },
        chunkCount: relevantChunks.length,
        communityCount: communities.length,
        processingTimeMs: processingTime,
        // Importance-weighted retrieval metadata (F3.2.5)
        importanceWeighting: {
          enabled: useImportanceWeighting,
          avgEntityImportance: avgImportance,
          topEntityByImportance: expandedGraph.entities[0]?.name,
          topEntityImportanceScore: expandedGraph.entities[0]?.importance,
          entitiesWithImportanceScores: entitiesWithImportance.length,
        },
        // Community context metadata (F3.1.5)
        communityContext: {
          enabled: includeCommunityContext,
          subgraphCommunities: communities.length,
          cachedSummariesAvailable: cachedSummaryCount,
          maxSummariesIncluded: CONFIG.MAX_COMMUNITY_SUMMARIES,
        },
      },
      // Raw data for further processing
      entities: expandedGraph.entities,
      relationships: expandedGraph.relationships,
      chunks: relevantChunks,
      communities,
    };
  }

  /**
   * Extract entities mentioned in the query using LLM
   */
  async _extractQueryEntities(queryText) {
    const messages = [
      {
        role: 'system',
        content: `You are an entity extraction system. Extract all entities mentioned in the user's query.
Return a JSON object with an "entities" array. Each entity should have:
- name: The entity name as mentioned
- type: The entity type (Process, Task, Role, System, Document, Concept, etc.)

Focus on business entities like:
- Processes (e.g., "approval process", "onboarding workflow")
- Tasks/Activities (e.g., "submit report", "review application")
- Roles (e.g., "manager", "administrator")
- Systems (e.g., "CRM", "ERP system")
- Documents (e.g., "invoice", "purchase order")
- Concepts (e.g., "compliance", "risk assessment")`,
      },
      {
        role: 'user',
        content: queryText,
      },
    ];

    try {
      const response = await this.openai.getJsonCompletion(messages);
      return response.content.entities || [];
    } catch (error) {
      log.warn('Failed to extract query entities', { error: error.message });
      // Fallback: use the query text as a single entity
      return [{ name: queryText, type: 'Query' }];
    }
  }

  /**
   * Resolve extracted entities to canonical graph entities
   */
  async _resolveQueryEntities(queryEntities) {
    const resolved = [];

    for (const entity of queryEntities) {
      // Try to find in entity resolution index
      const canonical = await this.entityResolution.getCanonicalEntity(entity.name);

      if (canonical) {
        resolved.push(canonical);
        continue;
      }

      // Try to find in graph by name (fuzzy)
      const graphEntity = await this.graph.findVertexByName(entity.name);

      if (graphEntity) {
        resolved.push(graphEntity);
        continue;
      }

      // Try semantic search for similar entities
      const similar = await this.entityResolution.findSimilarEntities(entity, { maxCandidates: 3 });

      if (similar.length > 0 && similar[0].similarity > 0.75) {
        resolved.push(similar[0]);
      }
    }

    return resolved;
  }

  /**
   * Expand the entity graph by traversing relationships
   * Uses importance-weighted prioritization (F3.2.5)
   */
  async _expandEntityGraph(seedEntities, options = {}) {
    const maxHops = options.maxHops || CONFIG.MAX_HOPS;
    const maxEntities = options.maxEntities || CONFIG.MAX_ENTITIES;
    const useImportanceWeighting = options.useImportanceWeighting !== false;

    const visitedEntities = new Map();
    const relationships = [];

    // Priority queue: entities with higher importance get expanded first (F3.2.5)
    const entitiesToProcess = seedEntities.map(e => ({
      ...e,
      depth: 0,
      priority: useImportanceWeighting ? this._getEntityImportance(e.id, e.name) : 1,
    }));

    // Sort by priority (highest first) for importance-weighted expansion
    entitiesToProcess.sort((a, b) => b.priority - a.priority);

    // Add seed entities to visited
    for (const entity of seedEntities) {
      visitedEntities.set(normalizeEntityName(entity.name), entity);
    }

    while (entitiesToProcess.length > 0 && visitedEntities.size < maxEntities) {
      const current = entitiesToProcess.shift();

      if (current.depth >= maxHops) {
        continue;
      }

      // Get neighbors from graph
      try {
        const neighbors = await this._getEntityNeighbors(current.name);

        // Score and sort neighbors by importance (F3.2.5)
        const scoredNeighbors = neighbors.map(n => ({
          ...n,
          importance: useImportanceWeighting
            ? this._getEntityImportance(n.entity.id, n.entity.name)
            : 1,
        }));

        // Sort by importance - prioritize more important neighbors
        scoredNeighbors.sort((a, b) => b.importance - a.importance);

        for (const neighbor of scoredNeighbors) {
          const normalizedName = normalizeEntityName(neighbor.entity.name);

          // Add relationship with importance metadata
          relationships.push({
            from: current.name,
            to: neighbor.entity.name,
            type: neighbor.relationshipType,
            direction: neighbor.direction,
            targetImportance: neighbor.importance,
          });

          // Add entity if not visited
          if (!visitedEntities.has(normalizedName)) {
            // Attach importance score to entity for later use
            const enrichedEntity = {
              ...neighbor.entity,
              importance: neighbor.importance,
            };
            visitedEntities.set(normalizedName, enrichedEntity);

            // Queue for further expansion if not at max depth
            // High-importance entities get boosted priority (F3.2.5)
            if (current.depth + 1 < maxHops) {
              const boostedPriority = useImportanceWeighting
                ? neighbor.importance * CONFIG.IMPORTANCE_BOOST_FACTOR
                : 1;

              entitiesToProcess.push({
                ...enrichedEntity,
                depth: current.depth + 1,
                priority: boostedPriority,
              });

              // Re-sort queue to maintain priority order
              entitiesToProcess.sort((a, b) => b.priority - a.priority);
            }
          }
        }
      } catch (error) {
        log.warn('Failed to expand entity', { entityName: current.name, error: error.message });
      }
    }

    // Sort final entity list by importance (F3.2.5)
    const sortedEntities = Array.from(visitedEntities.values());
    if (useImportanceWeighting) {
      sortedEntities.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    }

    return {
      entities: sortedEntities,
      relationships: this._deduplicateRelationships(relationships),
    };
  }

  /**
   * Get neighboring entities from the graph
   */
  async _getEntityNeighbors(entityName) {
    const neighbors = [];

    try {
      // Outgoing relationships
      const outQuery = `
        g.V().has('name', name)
          .outE()
          .project('type', 'target', 'confidence')
          .by(label())
          .by(inV().valueMap(true))
          .by(coalesce(values('confidence'), constant(1.0)))
          .limit(20)
      `;

      const outResults = await this.graph._submit(outQuery, { name: entityName });

      for (const r of outResults) {
        neighbors.push({
          entity: this.graph._normalizeVertex(r.target),
          relationshipType: r.type,
          direction: 'outgoing',
          confidence: r.confidence,
        });
      }

      // Incoming relationships
      const inQuery = `
        g.V().has('name', name)
          .inE()
          .project('type', 'source', 'confidence')
          .by(label())
          .by(outV().valueMap(true))
          .by(coalesce(values('confidence'), constant(1.0)))
          .limit(20)
      `;

      const inResults = await this.graph._submit(inQuery, { name: entityName });

      for (const r of inResults) {
        neighbors.push({
          entity: this.graph._normalizeVertex(r.source),
          relationshipType: r.type,
          direction: 'incoming',
          confidence: r.confidence,
        });
      }
    } catch (error) {
      log.warn('Failed to get entity neighbors', { entityName, error: error.message });
    }

    return neighbors;
  }

  /**
   * Find relevant document chunks for the expanded entities
   * Uses importance-weighted scoring with Reciprocal Rank Fusion (F3.2.5)
   */
  async _findRelevantChunks(queryText, entities, options = {}) {
    const maxChunksPerEntity = options.maxChunksPerEntity || CONFIG.MAX_CHUNKS_PER_ENTITY;
    const useImportanceWeighting = options.useImportanceWeighting !== false;

    // Generate query embedding
    const queryEmbedding = await this.openai.getEmbedding(queryText);

    // Build entity importance map for chunk scoring (F3.2.5)
    const entityImportanceMap = new Map();
    for (const entity of entities) {
      entityImportanceMap.set(
        entity.name.toLowerCase(),
        entity.importance || this._getEntityImportance(entity.id, entity.name)
      );
    }

    // Search for chunks mentioning any of the entities
    const entityNames = entities.map(e => e.name);

    // Build filter for entity mentions
    const entityFilters = entityNames
      .slice(0, 10) // Limit to avoid filter complexity
      .map(name => `entities/any(e: e eq '${name.replace(/'/g, "''")}')`)
      .join(' or ');

    const searchResults = await this.search.hybridSearch(queryText, queryEmbedding.embedding, {
      top: maxChunksPerEntity * entities.length,
      filter: entityFilters || undefined,
      semantic: true,
    });

    // Also do a pure vector search without entity filter
    const vectorResults = await this.search.vectorSearch(queryEmbedding.embedding, {
      top: 10,
    });

    // Combine and deduplicate results
    const allChunks = new Map();

    for (const chunk of [...searchResults.results, ...vectorResults.results]) {
      if (!allChunks.has(chunk.id)) {
        allChunks.set(chunk.id, chunk);
      }
    }

    // Calculate combined scores using importance weighting and RRF (F3.2.5)
    const scoredChunks = Array.from(allChunks.values()).map(chunk => {
      const similarityScore = chunk.score || 0;

      // Calculate importance boost based on entities mentioned in chunk
      let importanceBoost = 0;
      if (useImportanceWeighting && chunk.entities && Array.isArray(chunk.entities)) {
        const mentionedImportances = chunk.entities
          .map(e => entityImportanceMap.get(e.toLowerCase()) || 0)
          .filter(imp => imp > 0);

        if (mentionedImportances.length > 0) {
          // Use max importance among mentioned entities
          importanceBoost = Math.max(...mentionedImportances);
        }
      }

      // Combined score using weighted average (F3.2.5)
      // If importance weighting is disabled, use pure similarity
      const combinedScore = useImportanceWeighting
        ? (CONFIG.SIMILARITY_WEIGHT * similarityScore) + (CONFIG.IMPORTANCE_WEIGHT * importanceBoost)
        : similarityScore;

      return {
        ...chunk,
        originalScore: similarityScore,
        importanceBoost,
        score: combinedScore,
      };
    });

    // Apply Reciprocal Rank Fusion for final ranking (F3.2.5)
    // RRF combines rankings from similarity and importance
    if (useImportanceWeighting) {
      // Sort by similarity for similarity rank
      const bySimilarity = [...scoredChunks].sort((a, b) => b.originalScore - a.originalScore);
      const similarityRanks = new Map(bySimilarity.map((c, i) => [c.id, i + 1]));

      // Sort by importance boost for importance rank
      const byImportance = [...scoredChunks].sort((a, b) => b.importanceBoost - a.importanceBoost);
      const importanceRanks = new Map(byImportance.map((c, i) => [c.id, i + 1]));

      // Calculate RRF score: 1/(k + rank)
      for (const chunk of scoredChunks) {
        const simRank = similarityRanks.get(chunk.id) || scoredChunks.length;
        const impRank = importanceRanks.get(chunk.id) || scoredChunks.length;

        // RRF formula with weighted components
        chunk.rrfScore = (CONFIG.SIMILARITY_WEIGHT / (CONFIG.RRF_K + simRank)) +
                         (CONFIG.IMPORTANCE_WEIGHT / (CONFIG.RRF_K + impRank));
      }

      // Final sort by RRF score
      scoredChunks.sort((a, b) => b.rrfScore - a.rrfScore);
    } else {
      // Sort by original score if importance weighting disabled
      scoredChunks.sort((a, b) => b.score - a.score);
    }

    const limitedChunks = scoredChunks.slice(0, maxChunksPerEntity * Math.min(entities.length, 10));

    log.debug('Chunk retrieval with importance weighting', {
      totalChunks: scoredChunks.length,
      returnedChunks: limitedChunks.length,
      useImportanceWeighting,
      topChunkScore: limitedChunks[0]?.score,
      topChunkRRF: limitedChunks[0]?.rrfScore,
    });

    return limitedChunks;
  }

  /**
   * Detect communities in the subgraph using simple connected components
   * (In production, you might use Louvain or other community detection algorithms)
   */
  async _detectCommunities(expandedGraph) {
    const { entities, relationships } = expandedGraph;

    // Build adjacency list
    const adjacency = new Map();
    for (const entity of entities) {
      adjacency.set(entity.name, new Set());
    }

    for (const rel of relationships) {
      if (adjacency.has(rel.from) && adjacency.has(rel.to)) {
        adjacency.get(rel.from).add(rel.to);
        adjacency.get(rel.to).add(rel.from);
      }
    }

    // Find connected components (simple BFS)
    const visited = new Set();
    const communities = [];

    for (const entity of entities) {
      if (visited.has(entity.name)) continue;

      const community = [];
      const queue = [entity.name];

      while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;

        visited.add(current);
        community.push(current);

        const neighbors = adjacency.get(current) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }

      if (community.length >= CONFIG.MIN_COMMUNITY_SIZE) {
        communities.push({
          id: `community_${communities.length}`,
          members: community,
          size: community.length,
        });
      }
    }

    // Sort by size and limit
    return communities
      .sort((a, b) => b.size - a.size)
      .slice(0, CONFIG.MAX_COMMUNITIES);
  }

  /**
   * Assemble context for LLM query
   * Now includes community summaries by default for improved global question answering (F3.1.5)
   */
  async _assembleContext(queryText, expandedGraph, chunks, communities, options = {}) {
    const contextParts = [];

    // Entity context
    const entityContext = this._buildEntityContext(expandedGraph.entities);
    contextParts.push({
      type: 'entities',
      content: entityContext,
      weight: CONFIG.ENTITY_CONTEXT_WEIGHT,
    });

    // Relationship context
    const relationshipContext = this._buildRelationshipContext(expandedGraph.relationships);
    contextParts.push({
      type: 'relationships',
      content: relationshipContext,
      weight: CONFIG.RELATIONSHIP_CONTEXT_WEIGHT,
    });

    // Document chunk context
    const chunkContext = this._buildChunkContext(chunks);
    contextParts.push({
      type: 'chunks',
      content: chunkContext,
      weight: CONFIG.CHUNK_CONTEXT_WEIGHT,
    });

    // Community summaries - included by default for better global question answering (F3.1.5)
    // Can be disabled via options.includeCommunityContext = false
    const includeCommunityContext = options.includeCommunityContext !== false && CONFIG.INCLUDE_COMMUNITY_CONTEXT;
    let communityContext = '';

    if (includeCommunityContext && communities.length > 0) {
      communityContext = await this._buildCommunityContext(communities, expandedGraph, {
        maxSummaries: CONFIG.MAX_COMMUNITY_SUMMARIES,
        ...options,
      });

      if (communityContext) {
        contextParts.push({
          type: 'communities',
          content: communityContext,
          weight: CONFIG.COMMUNITY_CONTEXT_WEIGHT,
        });
      }
    }

    // Assemble final context string
    const contextSections = [];

    if (entityContext) {
      contextSections.push(`## Relevant Entities\n${entityContext}`);
    }

    if (relationshipContext) {
      contextSections.push(`## Relationships\n${relationshipContext}`);
    }

    if (chunkContext) {
      contextSections.push(`## Source Documents\n${chunkContext}`);
    }

    // Include community context in final output (F3.1.5)
    if (communityContext) {
      contextSections.push(`## Knowledge Community Insights\n${communityContext}`);
    }

    return contextSections.join('\n\n');
  }

  /**
   * Build entity context string
   * Includes importance indicators for authoritative entities (F3.2.5)
   */
  _buildEntityContext(entities) {
    if (entities.length === 0) return '';

    // Sort by importance to show most authoritative first (F3.2.5)
    const sortedEntities = [...entities]
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, CONFIG.MAX_ENTITIES);

    return sortedEntities
      .map((e, index) => {
        const parts = [`**${e.name}**`];
        if (e.type) parts.push(`(${e.type})`);

        // Add importance indicator for high-importance entities (F3.2.5)
        if (e.importance && e.importance > 0.7) {
          parts.push('[Key Entity]');
        } else if (e.importance && e.importance > 0.5) {
          parts.push('[Important]');
        }

        if (e.description) parts.push(`: ${e.description}`);
        return parts.join(' ');
      })
      .join('\n');
  }

  /**
   * Build relationship context string
   */
  _buildRelationshipContext(relationships) {
    if (relationships.length === 0) return '';

    return relationships
      .slice(0, CONFIG.MAX_RELATIONSHIPS)
      .map(r => `- ${r.from} --[${r.type}]--> ${r.to}`)
      .join('\n');
  }

  /**
   * Build document chunk context string
   */
  _buildChunkContext(chunks) {
    if (chunks.length === 0) return '';

    return chunks
      .map((chunk, i) => {
        const source = chunk.sourceFile || chunk.title || 'Unknown';
        const page = chunk.pageNumber ? ` (Page ${chunk.pageNumber})` : '';
        return `### Source ${i + 1}: ${source}${page}\n${chunk.content}`;
      })
      .join('\n\n');
  }

  /**
   * Build community context using pre-computed summaries (F3.1.3 + F3.1.5)
   * Falls back to on-demand generation if summaries aren't cached.
   * Now integrated into default GraphRAG context assembly (F3.1.5).
   *
   * @param {Array} communities - Detected communities from query subgraph
   * @param {Object} expandedGraph - Expanded entity graph
   * @param {Object} options - Build options
   * @param {number} options.maxSummaries - Max summaries to include (default: CONFIG.MAX_COMMUNITY_SUMMARIES)
   * @param {boolean} options.forceRefresh - Force regeneration of summaries
   * @returns {Promise<string>} Formatted community context string
   */
  async _buildCommunityContext(communities, expandedGraph, options = {}) {
    const summaries = [];
    const maxSummaries = options.maxSummaries || CONFIG.MAX_COMMUNITY_SUMMARIES;

    // Try to get pre-computed summaries from the community summary service
    const cachedSummaries = this.communitySummary.getAllCachedSummaries();
    const hasCachedSummaries = Object.keys(cachedSummaries).length > 0;

    // If we have Louvain-based cached summaries, prioritize those that overlap
    // with our query subgraph entities (F3.1.5)
    const queryEntityNames = new Set(expandedGraph.entities.map(e => e.name.toLowerCase()));
    const relevantCachedSummaries = [];

    if (hasCachedSummaries) {
      for (const [communityId, summary] of Object.entries(cachedSummaries)) {
        // Check if this cached community has entities relevant to our query
        const keyEntities = summary.keyEntities || [];
        const overlapCount = keyEntities.filter(e =>
          queryEntityNames.has(e.toLowerCase())
        ).length;

        if (overlapCount > 0) {
          relevantCachedSummaries.push({
            communityId,
            summary,
            overlapCount,
            relevanceScore: overlapCount / Math.max(keyEntities.length, 1),
          });
        }
      }

      // Sort by relevance to query entities
      relevantCachedSummaries.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    // First, add relevant cached summaries (from Louvain communities)
    for (const { summary } of relevantCachedSummaries.slice(0, maxSummaries)) {
      const entityCount = summary.memberCount || 'N/A';
      summaries.push(
        `### ${summary.title || 'Knowledge Community'} (${entityCount} entities)\n${summary.summary}`
      );
    }

    // Then add subgraph communities (from BFS connected components) if space remains
    const remainingSlots = maxSummaries - summaries.length;
    if (remainingSlots > 0) {
      for (const community of communities.slice(0, remainingSlots)) {
        // Check if we already have a summary for overlapping entities
        const alreadyCovered = relevantCachedSummaries.some(cached =>
          cached.summary.keyEntities?.some(e =>
            community.members.includes(e)
          )
        );

        if (alreadyCovered && !options.forceRefresh) {
          continue;
        }

        // Check for pre-computed summary by ID
        const cachedSummary = cachedSummaries[community.id] || cachedSummaries[String(community.id)];

        if (cachedSummary && !options.forceRefresh) {
          summaries.push(
            `### ${cachedSummary.title || community.id} (${community.size} entities)\n${cachedSummary.summary}`
          );
          continue;
        }

        // Fall back to on-demand generation
        const communityEntities = expandedGraph.entities
          .filter(e => community.members.includes(e.name));

        const communityRelationships = expandedGraph.relationships
          .filter(r => community.members.includes(r.from) && community.members.includes(r.to));

        const generatedSummary = await this._summarizeCommunity(communityEntities, communityRelationships);
        summaries.push(`### ${community.id} (${community.size} entities)\n${generatedSummary}`);
      }
    }

    log.debug('Community context built for GraphRAG (F3.1.5)', {
      totalCommunities: communities.length,
      usedCachedSummaries: hasCachedSummaries,
      relevantCachedFound: relevantCachedSummaries.length,
      summariesIncluded: summaries.length,
      maxSummaries,
    });

    return summaries.join('\n\n');
  }

  /**
   * Summarize a community using LLM (on-demand fallback)
   */
  async _summarizeCommunity(entities, relationships) {
    const entityList = entities.map(e => `${e.name} (${e.type || 'Unknown'})`).join(', ');
    const relationshipList = relationships.map(r => `${r.from} ${r.type} ${r.to}`).join('; ');

    const messages = [
      {
        role: 'system',
        content: 'You are a knowledge graph analyst. Summarize the following group of related entities and their relationships in 2-3 sentences.',
      },
      {
        role: 'user',
        content: `Entities: ${entityList}\n\nRelationships: ${relationshipList}`,
      },
    ];

    try {
      const response = await this.openai.getChatCompletion(messages, { maxTokens: 200 });
      return response.content;
    } catch (error) {
      log.warn('Failed to summarize community', { error: error.message });
      return `Contains ${entities.length} entities: ${entityList}`;
    }
  }

  /**
   * Global query using community summaries (F3.1.3 + F6.1.2 Map-Reduce)
   * Uses the community summary service's map-reduce pipeline
   *
   * @param {string} queryText - User query
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Answer with sources
   */
  async globalQuery(queryText, options = {}) {
    log.info('Starting global query with community summaries', { queryLength: queryText.length });

    try {
      // Use community summary service's map-reduce pipeline
      const result = await this.communitySummary.globalQuery(queryText, {
        maxCommunities: options.maxCommunities || CONFIG.MAX_COMMUNITIES,
        maxPartials: options.maxPartials || 5,
        ...options,
      });

      log.info('Global query completed', {
        confidence: result.confidence,
        sourcesCount: result.sources?.length || 0,
        timeMs: result.metadata?.totalTimeMs,
      });

      return result;
    } catch (error) {
      log.errorWithStack('Global query failed', error);
      throw error;
    }
  }

  /**
   * Pre-generate community summaries (for indexing time)
   * Should be called after document ingestion to prepare summaries
   *
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generation result
   */
  async generateCommunitySummaries(options = {}) {
    return this.communitySummary.generateAllSummaries(options);
  }

  /**
   * Deduplicate relationships
   */
  _deduplicateRelationships(relationships) {
    const seen = new Set();
    return relationships.filter(r => {
      const key = `${r.from}-${r.type}-${r.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Generate an answer using the GraphRAG context
   */
  async generateAnswer(queryText, options = {}) {
    // Get GraphRAG context
    const ragResult = await this.query(queryText, options);

    // Generate answer using LLM
    const messages = [
      {
        role: 'system',
        content: `You are a knowledgeable assistant that answers questions based on organizational knowledge.
Use the provided context from the knowledge graph and documents to answer the user's question.
If the context doesn't contain enough information, say so clearly.
Always cite specific entities or sources when possible.`,
      },
      {
        role: 'user',
        content: `Context:\n${ragResult.context}\n\n---\n\nQuestion: ${queryText}`,
      },
    ];

    const response = await this.openai.getChatCompletion(messages, {
      maxTokens: options.maxTokens || 1000,
    });

    return {
      answer: response.content,
      context: ragResult.context,
      metadata: ragResult.metadata,
      sources: {
        entities: ragResult.entities.map(e => ({ name: e.name, type: e.type })),
        documents: [...new Set(ragResult.chunks.map(c => c.sourceFile).filter(Boolean))],
      },
    };
  }

  /**
   * Get entity-centric view for a specific entity
   */
  async getEntityView(entityName, options = {}) {
    // Resolve to canonical entity
    const canonical = await this.entityResolution.getCanonicalEntity(entityName);
    const entity = canonical || await this.graph.findVertexByName(entityName);

    if (!entity) {
      return null;
    }

    // Get related entities and relationships
    const relatedData = await this.entityResolution.getRelatedEntities(entityName, {
      includeSimilar: true,
      maxRelated: options.maxRelated || 20,
    });

    // Get neighbors from graph
    const neighbors = await this._getEntityNeighbors(entity.name);

    // Get document chunks mentioning this entity
    const chunks = await this.search.hybridSearch(entity.name, null, {
      top: 10,
      filter: `entities/any(e: e eq '${entity.name.replace(/'/g, "''")}')`,
    });

    return {
      entity,
      aliases: canonical?.aliases || [],
      relatedEntities: relatedData.related,
      neighbors: neighbors.map(n => ({
        entity: { name: n.entity.name, type: n.entity.type },
        relationship: n.relationshipType,
        direction: n.direction,
      })),
      documentMentions: chunks.results.map(c => ({
        documentId: c.documentId,
        sourceFile: c.sourceFile,
        excerpt: c.content.substring(0, 200) + '...',
      })),
    };
  }

  // ==================== Polymorphic Query Methods (F2.1.2) ====================

  /**
   * Query entities by type with polymorphic expansion (includes subtypes)
   * Feature: F2.1.2 - Type Inheritance / Polymorphic Queries
   *
   * Example: queryByType('BusinessFlowEntity') returns Process, Task, Activity, Decision entities
   *
   * @param {string} type - The parent type to query
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default: 100)
   * @param {boolean} options.includeSubtypes - Include subtypes in query (default: true)
   * @param {string} options.orderBy - Field to order results by
   * @param {boolean} options.descending - Order descending (default: false)
   * @returns {Promise<Object>} Query results with type hierarchy info
   */
  async queryByType(type, options = {}) {
    await this._ensureOntologyInitialized();

    const {
      limit = 100,
      includeSubtypes = true,
      orderBy,
      descending = false
    } = options;

    const startTime = Date.now();

    // Expand type to include subtypes if requested
    let typesToQuery = [type];
    let typeHierarchy = null;

    if (includeSubtypes && this.ontologyInitialized) {
      const expansion = this.ontology.expandTypeWithSubtypes(type);
      typesToQuery = expansion.types;
      typeHierarchy = expansion.hierarchy;

      log.debug('Polymorphic type expansion', {
        requestedType: type,
        expandedTypes: typesToQuery,
        typeCount: typesToQuery.length
      });
    }

    // Query the graph for entities of these types
    const entities = await this.graph.findVerticesByTypesPolymorphic(typesToQuery, {
      limit,
      orderBy,
      descending
    });

    // Enrich with importance scores
    await this._loadImportanceScores();
    const enrichedEntities = entities.map(entity => ({
      ...entity,
      importance: this._getEntityImportance(entity.id, entity.name)
    }));

    // Sort by importance if no orderBy specified
    if (!orderBy) {
      enrichedEntities.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    }

    const processingTime = Date.now() - startTime;

    log.info('Polymorphic type query completed', {
      requestedType: type,
      includeSubtypes,
      matchingTypes: typesToQuery.length,
      resultCount: enrichedEntities.length,
      processingTimeMs: processingTime
    });

    return {
      entities: enrichedEntities,
      metadata: {
        requestedType: type,
        includeSubtypes,
        matchingTypes: typesToQuery,
        typeHierarchy,
        resultCount: enrichedEntities.length,
        processingTimeMs: processingTime
      }
    };
  }

  /**
   * Query with type filtering applied to results
   * Feature: F2.1.2 - Type Inheritance / Polymorphic Queries
   *
   * This method performs a standard GraphRAG query but filters results
   * to only include entities of the specified type (and optionally its subtypes).
   *
   * @param {string} queryText - The query text
   * @param {Object} options - Query options
   * @param {string} options.typeFilter - Filter results to this type (and subtypes)
   * @param {boolean} options.includeSubtypes - Include subtypes in filter (default: true)
   * @returns {Promise<Object>} Filtered query results
   */
  async queryWithTypeFilter(queryText, options = {}) {
    const { typeFilter, includeSubtypes = true, ...queryOptions } = options;

    // First, perform the standard GraphRAG query
    const result = await this.query(queryText, queryOptions);

    // If no type filter, return results as-is
    if (!typeFilter) {
      return result;
    }

    await this._ensureOntologyInitialized();

    // Get types to include in filter
    let allowedTypes = new Set([typeFilter]);
    if (includeSubtypes && this.ontologyInitialized) {
      const expansion = this.ontology.expandTypeWithSubtypes(typeFilter);
      allowedTypes = new Set(expansion.types.map(t => t.toLowerCase()));
    }

    // Filter entities by type
    const filteredEntities = result.entities.filter(entity => {
      const entityType = (entity.type || '').toLowerCase();
      return allowedTypes.has(entityType);
    });

    // Filter relationships to only include those between filtered entities
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));
    const filteredRelationships = result.relationships.filter(rel =>
      filteredEntityNames.has(rel.from) && filteredEntityNames.has(rel.to)
    );

    log.debug('Applied polymorphic type filter', {
      typeFilter,
      includeSubtypes,
      allowedTypes: [...allowedTypes],
      originalEntityCount: result.entities.length,
      filteredEntityCount: filteredEntities.length
    });

    return {
      ...result,
      entities: filteredEntities,
      relationships: filteredRelationships,
      metadata: {
        ...result.metadata,
        typeFilter: {
          requestedType: typeFilter,
          includeSubtypes,
          allowedTypes: [...allowedTypes],
          entitiesFiltered: result.entities.length - filteredEntities.length
        }
      }
    };
  }

  /**
   * Get the type hierarchy tree for a given type
   * Feature: F2.1.2 - Type Inheritance / Polymorphic Queries
   *
   * @param {string} type - The root type
   * @returns {Promise<Object>} Type hierarchy tree
   */
  async getTypeHierarchy(type) {
    await this._ensureOntologyInitialized();

    if (!this.ontologyInitialized) {
      return {
        error: 'Ontology service not initialized',
        types: [type],
        hierarchy: null
      };
    }

    const expansion = this.ontology.expandTypeWithSubtypes(type);
    const tree = this.ontology.getTypeTree(type);

    return {
      rootType: type,
      allTypes: expansion.types,
      hierarchy: expansion.hierarchy,
      tree,
      warning: expansion.warning
    };
  }

  // ==================== Time-Aware Query Methods (F2.3.4) ====================

  /**
   * Query the graph at a specific point in time
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * This performs a GraphRAG-style query but only considers entities and
   * relationships that were valid at the specified point in time.
   *
   * Example use case: "Show org structure as of 2024-01-01"
   *
   * @param {string} queryText - The query text
   * @param {string} pointInTime - ISO timestamp for the temporal context
   * @param {Object} options - Query options
   * @param {number} options.maxEntities - Maximum entities to return (default: CONFIG.MAX_ENTITIES)
   * @param {number} options.maxHops - Maximum traversal depth (default: CONFIG.MAX_HOPS)
   * @param {boolean} options.includeChunks - Include document chunks (default: true)
   * @returns {Promise<Object>} Time-aware query results
   */
  async queryAtTime(queryText, pointInTime, options = {}) {
    const startTime = Date.now();
    const targetTime = new Date(pointInTime);

    log.info('Starting time-aware GraphRAG query', {
      queryLength: queryText.length,
      pointInTime,
    });

    // Step 1: Extract entities from the query using LLM
    const queryEntities = await this._extractQueryEntities(queryText);

    // Step 2: Resolve query entities to canonical graph entities
    const resolvedEntities = await this._resolveQueryEntities(queryEntities);

    // Step 3: Filter resolved entities to only those valid at the target time
    const validResolvedEntities = resolvedEntities.filter((entity) => {
      return this._isEntityValidAt(entity, targetTime);
    });

    if (validResolvedEntities.length === 0 && resolvedEntities.length > 0) {
      log.warn('No resolved entities were valid at the target time', {
        resolvedCount: resolvedEntities.length,
        pointInTime,
      });
    }

    // Step 4: Time-aware graph expansion
    const expandedGraph = await this._expandEntityGraphAtTime(
      validResolvedEntities,
      pointInTime,
      options
    );

    // Step 5: Find relevant document chunks (optional)
    let relevantChunks = [];
    if (options.includeChunks !== false) {
      // Filter chunks to those created before the target time
      relevantChunks = await this._findRelevantChunksAtTime(
        queryText,
        expandedGraph.entities,
        pointInTime,
        options
      );
    }

    // Step 6: Detect communities in the temporal subgraph
    const communities = await this._detectCommunities(expandedGraph);

    // Step 7: Assemble context for LLM
    const context = await this._assembleTemporalContext(
      queryText,
      expandedGraph,
      relevantChunks,
      communities,
      pointInTime,
      options
    );

    const processingTime = Date.now() - startTime;

    log.info('Time-aware GraphRAG query completed', {
      queryLength: queryText.length,
      pointInTime,
      extractedEntities: queryEntities.length,
      resolvedEntities: resolvedEntities.length,
      validResolvedEntities: validResolvedEntities.length,
      expandedEntities: expandedGraph.entities.length,
      relationships: expandedGraph.relationships.length,
      chunks: relevantChunks.length,
      communities: communities.length,
      processingTimeMs: processingTime,
    });

    return {
      context,
      pointInTime,
      metadata: {
        queryEntities,
        resolvedEntities: resolvedEntities.map((e) => ({
          name: e.name,
          type: e.type,
          validAtTime: this._isEntityValidAt(e, targetTime),
        })),
        expandedGraph: {
          entityCount: expandedGraph.entities.length,
          relationshipCount: expandedGraph.relationships.length,
        },
        chunkCount: relevantChunks.length,
        communityCount: communities.length,
        processingTimeMs: processingTime,
        temporalQuery: {
          pointInTime,
          entitiesFilteredByTime:
            resolvedEntities.length - validResolvedEntities.length,
        },
      },
      entities: expandedGraph.entities,
      relationships: expandedGraph.relationships,
      chunks: relevantChunks,
      communities,
    };
  }

  /**
   * Check if an entity was valid at a specific point in time.
   * @private
   */
  _isEntityValidAt(entity, targetTime) {
    const target = targetTime instanceof Date ? targetTime : new Date(targetTime);

    // If validFrom exists, entity must have been created before target time
    if (entity.validFrom) {
      const validFrom = new Date(entity.validFrom);
      if (validFrom > target) return false;
    }

    // If validTo exists, entity must still be valid at target time
    if (entity.validTo) {
      const validTo = new Date(entity.validTo);
      if (validTo < target) return false;
    }

    return true;
  }

  /**
   * Expand entity graph considering temporal validity.
   * @private
   */
  async _expandEntityGraphAtTime(seedEntities, pointInTime, options = {}) {
    const maxHops = options.maxHops || CONFIG.MAX_HOPS;
    const maxEntities = options.maxEntities || CONFIG.MAX_ENTITIES;
    const targetTime = new Date(pointInTime);

    const visitedEntities = new Map();
    const relationships = [];

    // Initialize with seed entities
    const entitiesToProcess = seedEntities.map((e) => ({
      ...e,
      depth: 0,
    }));

    for (const entity of seedEntities) {
      visitedEntities.set(normalizeEntityName(entity.name), entity);
    }

    while (entitiesToProcess.length > 0 && visitedEntities.size < maxEntities) {
      const current = entitiesToProcess.shift();

      if (current.depth >= maxHops) {
        continue;
      }

      // Get neighbors valid at the target time
      try {
        const neighborsResult = await this.graph.findNeighborsValidAt(
          current.name,
          pointInTime,
          { maxNeighbors: 20 }
        );

        for (const neighbor of neighborsResult.neighbors || []) {
          const normalizedName = normalizeEntityName(neighbor.entity.name);

          // Add relationship
          relationships.push({
            from: current.name,
            to: neighbor.entity.name,
            type: neighbor.relationshipType,
            direction: neighbor.direction,
            validAt: pointInTime,
          });

          // Add entity if not visited
          if (!visitedEntities.has(normalizedName)) {
            visitedEntities.set(normalizedName, neighbor.entity);

            if (current.depth + 1 < maxHops) {
              entitiesToProcess.push({
                ...neighbor.entity,
                depth: current.depth + 1,
              });
            }
          }
        }
      } catch (error) {
        log.warn('Failed to expand entity at time', {
          entityName: current.name,
          pointInTime,
          error: error.message,
        });
      }
    }

    return {
      entities: Array.from(visitedEntities.values()),
      relationships: this._deduplicateRelationships(relationships),
    };
  }

  /**
   * Find relevant chunks that existed at a specific point in time.
   * @private
   */
  async _findRelevantChunksAtTime(queryText, entities, pointInTime, options = {}) {
    const maxChunksPerEntity =
      options.maxChunksPerEntity || CONFIG.MAX_CHUNKS_PER_ENTITY;
    const targetTime = new Date(pointInTime);

    // Generate query embedding
    const queryEmbedding = await this.openai.getEmbedding(queryText);

    // Build filter for entity mentions
    const entityNames = entities.map((e) => e.name);
    const entityFilters = entityNames
      .slice(0, 10)
      .map((name) => `entities/any(e: e eq '${name.replace(/'/g, "''")}')`)
      .join(' or ');

    const searchResults = await this.search.hybridSearch(
      queryText,
      queryEmbedding.embedding,
      {
        top: maxChunksPerEntity * entities.length,
        filter: entityFilters || undefined,
        semantic: true,
      }
    );

    // Filter chunks by creation/indexing time
    const validChunks = searchResults.results.filter((chunk) => {
      // Check if chunk was indexed before target time
      if (chunk.indexedAt) {
        const indexedAt = new Date(chunk.indexedAt);
        if (indexedAt > targetTime) return false;
      }
      // Check document creation time if available
      if (chunk.documentCreatedAt) {
        const createdAt = new Date(chunk.documentCreatedAt);
        if (createdAt > targetTime) return false;
      }
      return true;
    });

    return validChunks.slice(
      0,
      maxChunksPerEntity * Math.min(entities.length, 10)
    );
  }

  /**
   * Assemble context with temporal annotation.
   * @private
   */
  async _assembleTemporalContext(
    queryText,
    expandedGraph,
    chunks,
    communities,
    pointInTime,
    options = {}
  ) {
    const contextSections = [];

    // Add temporal context header
    contextSections.push(
      `## Temporal Context\nThe following information reflects the state of the knowledge graph as of **${pointInTime}**.`
    );

    // Entity context
    const entityContext = this._buildEntityContext(expandedGraph.entities);
    if (entityContext) {
      contextSections.push(`## Relevant Entities (as of ${pointInTime})\n${entityContext}`);
    }

    // Relationship context
    const relationshipContext = this._buildRelationshipContext(
      expandedGraph.relationships
    );
    if (relationshipContext) {
      contextSections.push(`## Relationships (as of ${pointInTime})\n${relationshipContext}`);
    }

    // Document chunk context
    const chunkContext = this._buildChunkContext(chunks);
    if (chunkContext) {
      contextSections.push(
        `## Source Documents (available as of ${pointInTime})\n${chunkContext}`
      );
    }

    return contextSections.join('\n\n');
  }

  /**
   * Generate an answer for a time-aware query.
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * @param {string} queryText - The query text
   * @param {string} pointInTime - ISO timestamp for the temporal context
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Answer with temporal context
   */
  async generateAnswerAtTime(queryText, pointInTime, options = {}) {
    // Get time-aware GraphRAG context
    const ragResult = await this.queryAtTime(queryText, pointInTime, options);

    // Generate answer using LLM
    const messages = [
      {
        role: 'system',
        content: `You are a knowledgeable assistant that answers questions based on organizational knowledge.
You are answering questions about the state of the organization AS OF ${pointInTime}.
Use the provided context from the knowledge graph and documents to answer the user's question.
Be clear that your answer reflects the historical state at the specified time, not the current state.
If the context doesn't contain enough information, say so clearly.
Always cite specific entities or sources when possible.`,
      },
      {
        role: 'user',
        content: `Context (as of ${pointInTime}):\n${ragResult.context}\n\n---\n\nQuestion: ${queryText}`,
      },
    ];

    const response = await this.openai.getChatCompletion(messages, {
      maxTokens: options.maxTokens || 1000,
    });

    return {
      answer: response.content,
      pointInTime,
      context: ragResult.context,
      metadata: ragResult.metadata,
      sources: {
        entities: ragResult.entities.map((e) => ({
          name: e.name,
          type: e.type,
          validFrom: e.validFrom,
          validTo: e.validTo,
        })),
        documents: [
          ...new Set(ragResult.chunks.map((c) => c.sourceFile).filter(Boolean)),
        ],
      },
    };
  }

  /**
   * Get a point-in-time snapshot of the graph.
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * @param {string} pointInTime - ISO timestamp
   * @param {Object} options - Snapshot options
   * @returns {Promise<Object>} Graph snapshot
   */
  async getGraphSnapshot(pointInTime, options = {}) {
    return this.graph.getGraphSnapshotAt(pointInTime, options);
  }

  /**
   * Compare graph state between two points in time.
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * @param {string} time1 - First point in time
   * @param {string} time2 - Second point in time
   * @param {Object} options - Comparison options
   * @returns {Promise<Object>} Comparison results
   */
  async compareGraphStates(time1, time2, options = {}) {
    return this.graph.compareGraphStates(time1, time2, options);
  }
}

// Singleton instance
let instance = null;

function getGraphRAGService() {
  if (!instance) {
    instance = new GraphRAGService();
  }
  return instance;
}

module.exports = {
  GraphRAGService,
  getGraphRAGService,
  CONFIG,
};
