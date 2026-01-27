/**
 * Community Summary Service
 *
 * Generates and caches LLM summaries for communities detected in the knowledge graph.
 * Follows Microsoft GraphRAG's map-reduce approach for global query answering.
 *
 * Feature: F3.1.3 - Community Summary Generation
 *
 * Key capabilities:
 * - Generate summaries for detected communities using LLM
 * - Cache summaries with configurable TTL
 * - Support both indexing-time (pre-computed) and query-time (lazy) generation
 * - Integrate with Louvain community detection algorithm
 */

const {
  detectCommunities,
  detectCommunitiesIncremental,
  detectCommunitiesSmart,
  detectSubgraphCommunities,
} = require('../algorithms/louvain');
const { getGraphService } = require('./graph-service');
const { getOpenAIService } = require('./openai-service');
const { getCommunityStorageService } = require('./community-storage-service');
const { log } = require('../utils/logger');
const crypto = require('crypto');

/**
 * Configuration for community summary generation
 */
const CONFIG = {
  // Cache settings
  CACHE_TTL_MS: 30 * 60 * 1000, // 30 minutes default cache TTL
  MAX_CACHED_SUMMARIES: 100, // Maximum number of cached summaries

  // Summary generation settings
  MAX_ENTITIES_IN_PROMPT: 50, // Max entities to include in summary prompt
  MAX_RELATIONSHIPS_IN_PROMPT: 100, // Max relationships to include
  MIN_COMMUNITY_SIZE_FOR_SUMMARY: 2, // Minimum community size to generate summary
  MAX_SUMMARY_LENGTH: 500, // Target max length for summaries

  // LLM settings
  SUMMARY_TEMPERATURE: 0.3, // Lower temperature for more consistent summaries
  MAX_TOKENS_PER_SUMMARY: 400, // Max tokens for each summary response

  // Batch settings
  BATCH_SIZE: 5, // Number of summaries to generate concurrently
  RATE_LIMIT_DELAY_MS: 500, // Delay between batches to avoid rate limits
};

/**
 * In-memory cache for community summaries
 */
class SummaryCache {
  constructor(maxSize = CONFIG.MAX_CACHED_SUMMARIES, ttlMs = CONFIG.CACHE_TTL_MS) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get a cached summary
   * @param {string} communityId - Community identifier
   * @returns {Object|null} Cached summary or null if not found/expired
   */
  get(communityId) {
    const entry = this.cache.get(communityId);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(communityId);
      return null;
    }

    return entry.data;
  }

  /**
   * Store a summary in cache
   * @param {string} communityId - Community identifier
   * @param {Object} summary - Summary data to cache
   */
  set(communityId, summary) {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(communityId, {
      data: summary,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all cached summaries
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let validCount = 0;
    let expiredCount = 0;

    for (const [, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries: validCount,
      expiredEntries: expiredCount,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

/**
 * Community Summary Service
 * Generates and manages LLM summaries for knowledge graph communities
 */
class CommunitySummaryService {
  constructor() {
    this.graphService = getGraphService();
    this.openai = getOpenAIService();
    this.cache = new SummaryCache();
    this.storageService = null; // Lazy initialized to avoid circular deps

    // Track last full generation
    this.lastFullGeneration = null;
    this.lastModularity = null;
    this.lastCommunityCount = null;
  }

  /**
   * Get the storage service (lazy initialization)
   * @private
   */
  _getStorageService() {
    if (!this.storageService) {
      this.storageService = getCommunityStorageService();
    }
    return this.storageService;
  }

  /**
   * Generate summaries for all communities in the graph.
   * This is the "indexing-time" approach used by Microsoft GraphRAG.
   *
   * @param {Object} options - Generation options
   * @param {boolean} options.forceRefresh - Force regeneration even if cached
   * @param {number} options.minCommunitySize - Minimum community size to summarize
   * @returns {Promise<Object>} Generated summaries and metadata
   */
  async generateAllSummaries(options = {}) {
    const startTime = Date.now();
    const { forceRefresh = false, minCommunitySize = CONFIG.MIN_COMMUNITY_SIZE_FOR_SUMMARY } = options;

    log.info('Starting community summary generation', { forceRefresh, minCommunitySize });

    try {
      // Step 1: Detect communities using Louvain algorithm
      const communityResult = await detectCommunities({
        resolution: options.resolution || 1.0,
      });

      const { communityList, modularity, metadata: communityMetadata } = communityResult;

      log.info('Community detection completed', {
        communityCount: communityList.length,
        modularity: modularity.toFixed(4),
      });

      // Step 2: Filter communities by size
      const eligibleCommunities = communityList.filter(
        (c) => c.size >= minCommunitySize
      );

      log.info(`Eligible communities for summarization: ${eligibleCommunities.length}`);

      // Step 3: Fetch relationship data for context
      const relationshipsMap = await this._fetchCommunityRelationships(eligibleCommunities);

      // Step 4: Generate summaries (with batching and rate limiting)
      const summaries = await this._generateSummariesBatch(
        eligibleCommunities,
        relationshipsMap,
        forceRefresh
      );

      // Step 5: Cache results and track generation
      this.lastFullGeneration = Date.now();
      this.lastModularity = modularity;
      this.lastCommunityCount = communityList.length;

      // Step 6: Persist to Cosmos DB (F3.1.2 - Community Storage)
      let persistenceResult = null;
      try {
        const storage = this._getStorageService();

        // Store detection run and communities
        const runResult = await storage.storeDetectionRun({
          communityList: eligibleCommunities,
          modularity,
          metadata: {
            ...communityMetadata,
            algorithm: 'louvain',
            resolution: options.resolution || 1.0,
          },
        });

        // Store summaries in batch
        const summaryResult = await storage.storeSummariesBatch(summaries);

        persistenceResult = {
          runId: runResult.runId,
          storedCommunities: runResult.storedCommunityCount,
          storedSummaries: summaryResult.stored,
          failedSummaries: summaryResult.failed,
        };

        log.info('Community data persisted to storage', persistenceResult);
      } catch (persistError) {
        // Log but don't fail - in-memory cache still works
        log.warn('Failed to persist community data to storage', {
          error: persistError.message,
        });
      }

      const executionTimeMs = Date.now() - startTime;

      const result = {
        summaries,
        metadata: {
          ...communityMetadata,
          summarizedCount: Object.keys(summaries).length,
          skippedCount: communityList.length - eligibleCommunities.length,
          executionTimeMs,
          generatedAt: new Date().toISOString(),
          cacheStats: this.cache.getStats(),
          persistence: persistenceResult,
        },
      };

      log.info('Community summary generation completed', {
        summarizedCount: result.metadata.summarizedCount,
        executionTimeMs,
        persisted: !!persistenceResult,
      });

      return result;
    } catch (error) {
      log.errorWithStack('Failed to generate community summaries', error);
      throw error;
    }
  }

  /**
   * Incrementally update community summaries when new documents are added.
   * Only regenerates summaries for communities that changed.
   *
   * Feature: F3.1.4 - Incremental Community Updates
   *
   * This method:
   * 1. Uses the smart detection algorithm to determine if incremental is appropriate
   * 2. Only regenerates summaries for changed communities
   * 3. Preserves cached summaries for unchanged communities
   * 4. Persists results to storage
   *
   * @param {Object} options - Options for incremental update
   * @param {string} options.sinceTimestamp - Timestamp of last update (optional, uses stored)
   * @param {boolean} options.forceIncremental - Force incremental even if not recommended
   * @param {number} options.minCommunitySize - Min size for summary generation
   * @returns {Promise<Object>} Update results with changed summaries
   */
  async updateSummariesIncremental(options = {}) {
    const startTime = Date.now();
    const { minCommunitySize = CONFIG.MIN_COMMUNITY_SIZE_FOR_SUMMARY } = options;

    log.info('Starting incremental community summary update', options);

    try {
      // Get previous detection run from storage
      const storage = this._getStorageService();
      const lastRun = await storage.getLatestDetectionRun();

      let sinceTimestamp = options.sinceTimestamp;
      let previousResult = null;

      if (lastRun) {
        sinceTimestamp = sinceTimestamp || lastRun.createdAt;
        // Reconstruct previous result from stored communities
        const storedCommunities = await storage.getCommunitiesByRunId(lastRun.id);
        previousResult = {
          communities: {},
          communityList: storedCommunities.map(c => ({
            id: parseInt(c.communityId, 10),
            size: c.size,
            members: c.members,
            typeCounts: c.typeCounts,
            dominantType: c.dominantType,
          })),
          modularity: lastRun.modularity,
          metadata: lastRun.metadata,
        };

        // Build communities map from community list
        for (const community of previousResult.communityList) {
          for (const member of community.members) {
            previousResult.communities[member.id] = community.id;
          }
        }
      }

      // Use smart detection if we have previous state, otherwise full
      let communityResult;
      if (previousResult && sinceTimestamp) {
        communityResult = await detectCommunitiesSmart({
          resolution: options.resolution || 1.0,
          sinceTimestamp,
          previousResult,
        });
      } else {
        log.info('No previous state available, using full detection');
        communityResult = await detectCommunities({
          resolution: options.resolution || 1.0,
        });
      }

      const {
        communityList,
        modularity,
        changedCommunities = [],
        metadata: communityMetadata,
      } = communityResult;

      // If no changes and we have previous state, return early
      if (communityMetadata?.noChanges && previousResult) {
        log.info('No graph changes, skipping summary regeneration');
        return {
          summaries: await this.getAllSummariesWithStorage(),
          metadata: {
            ...communityMetadata,
            skipped: true,
            reason: 'no_changes',
            executionTimeMs: Date.now() - startTime,
          },
        };
      }

      // Determine which communities need summary regeneration
      const eligibleCommunities = communityList.filter(
        (c) => c.size >= minCommunitySize
      );

      let communitiesToRegenerate;
      let summariesToPreserve = {};

      if (communityMetadata?.incremental && changedCommunities.length > 0) {
        // Incremental: only regenerate changed communities
        const changedSet = new Set(changedCommunities);
        communitiesToRegenerate = eligibleCommunities.filter(
          (c) => changedSet.has(c.id)
        );

        // Preserve summaries for unchanged communities
        const unchangedCommunities = eligibleCommunities.filter(
          (c) => !changedSet.has(c.id)
        );

        for (const community of unchangedCommunities) {
          const existingSummary = this.cache.get(String(community.id));
          if (existingSummary) {
            summariesToPreserve[community.id] = existingSummary;
          }
        }

        log.info('Incremental summary regeneration', {
          totalCommunities: eligibleCommunities.length,
          regenerating: communitiesToRegenerate.length,
          preserving: Object.keys(summariesToPreserve).length,
        });
      } else {
        // Full regeneration
        communitiesToRegenerate = eligibleCommunities;
        log.info('Full summary regeneration', {
          totalCommunities: eligibleCommunities.length,
        });
      }

      // Fetch relationships for communities to regenerate
      const relationshipsMap = await this._fetchCommunityRelationships(communitiesToRegenerate);

      // Generate new summaries
      const newSummaries = await this._generateSummariesBatch(
        communitiesToRegenerate,
        relationshipsMap,
        true // force refresh for changed communities
      );

      // Merge with preserved summaries
      const allSummaries = { ...summariesToPreserve, ...newSummaries };

      // Update tracking
      this.lastFullGeneration = Date.now();
      this.lastModularity = modularity;
      this.lastCommunityCount = communityList.length;

      // Persist to storage
      let persistenceResult = null;
      try {
        // Store detection run
        const runResult = await storage.storeDetectionRun({
          communityList: eligibleCommunities,
          modularity,
          metadata: {
            ...communityMetadata,
            algorithm: 'louvain_incremental',
            resolution: options.resolution || 1.0,
          },
        });

        // Store only the newly generated summaries (preserve existing ones)
        const summaryResult = await storage.storeSummariesBatch(newSummaries);

        persistenceResult = {
          runId: runResult.runId,
          storedCommunities: runResult.storedCommunityCount,
          storedSummaries: summaryResult.stored,
          preservedSummaries: Object.keys(summariesToPreserve).length,
        };

        log.info('Incremental results persisted', persistenceResult);
      } catch (persistError) {
        log.warn('Failed to persist incremental results', {
          error: persistError.message,
        });
      }

      const executionTimeMs = Date.now() - startTime;

      const result = {
        summaries: allSummaries,
        changedCommunities,
        metadata: {
          ...communityMetadata,
          totalCommunities: eligibleCommunities.length,
          regeneratedCount: communitiesToRegenerate.length,
          preservedCount: Object.keys(summariesToPreserve).length,
          executionTimeMs,
          generatedAt: new Date().toISOString(),
          cacheStats: this.cache.getStats(),
          persistence: persistenceResult,
          incremental: communityMetadata?.incremental || false,
        },
      };

      log.info('Incremental community summary update completed', {
        regenerated: result.metadata.regeneratedCount,
        preserved: result.metadata.preservedCount,
        executionTimeMs,
      });

      return result;
    } catch (error) {
      log.errorWithStack('Incremental summary update failed', error);
      // Fallback to full regeneration
      log.info('Falling back to full summary generation');
      return this.generateAllSummaries(options);
    }
  }

  /**
   * Get summary for a specific community (lazy generation if not cached)
   *
   * @param {string|number} communityId - Community ID
   * @param {Object} options - Options
   * @returns {Promise<Object>} Community summary
   */
  async getCommunitySummary(communityId, options = {}) {
    // Check in-memory cache first
    const cached = this.cache.get(String(communityId));
    if (cached && !options.forceRefresh) {
      log.debug('Returning cached community summary', { communityId });
      return cached;
    }

    // Check persistent storage (F3.1.2 - Community Storage)
    if (!options.forceRefresh) {
      try {
        const storage = this._getStorageService();
        const stored = await storage.getSummary(communityId);
        if (stored) {
          // Warm the in-memory cache
          this.cache.set(String(communityId), stored);
          log.debug('Loaded community summary from persistent storage', { communityId });
          return stored;
        }
      } catch (storageError) {
        log.debug('Could not load from storage, will generate', {
          communityId,
          error: storageError.message,
        });
      }
    }

    // Detect communities to find this one
    const { communityList, communities } = await detectCommunities();

    // Find the community
    const community = communityList.find((c) => c.id === communityId || c.id === Number(communityId));

    if (!community) {
      log.warn('Community not found', { communityId });
      return null;
    }

    // Fetch relationships for this community
    const relationshipsMap = await this._fetchCommunityRelationships([community]);
    const relationships = relationshipsMap.get(community.id) || [];

    // Generate summary
    const summary = await this._generateSingleSummary(community, relationships);

    // Cache result
    this.cache.set(String(communityId), summary);

    return summary;
  }

  /**
   * Get summaries for multiple communities
   *
   * @param {Array<string|number>} communityIds - Community IDs to get
   * @param {Object} options - Options
   * @returns {Promise<Object>} Map of communityId -> summary
   */
  async getCommunitySummaries(communityIds, options = {}) {
    const result = {};
    const toGenerate = [];

    // Check cache for each
    for (const id of communityIds) {
      const cached = this.cache.get(String(id));
      if (cached && !options.forceRefresh) {
        result[id] = cached;
      } else {
        toGenerate.push(id);
      }
    }

    // Generate missing summaries
    if (toGenerate.length > 0) {
      const { communityList } = await detectCommunities();

      const communities = communityList.filter(
        (c) => toGenerate.includes(c.id) || toGenerate.includes(String(c.id))
      );

      if (communities.length > 0) {
        const relationshipsMap = await this._fetchCommunityRelationships(communities);
        const generated = await this._generateSummariesBatch(communities, relationshipsMap, true);

        Object.assign(result, generated);
      }
    }

    return result;
  }

  /**
   * Get all cached summaries (for query-time context assembly)
   *
   * @returns {Object} All valid cached summaries
   */
  getAllCachedSummaries() {
    const result = {};
    const now = Date.now();

    for (const [communityId, entry] of this.cache.cache) {
      if (now - entry.timestamp <= this.cache.ttlMs) {
        result[communityId] = entry.data;
      }
    }

    return result;
  }

  /**
   * Get all summaries with persistent storage fallback (F3.1.2)
   * This async method checks both in-memory cache and persistent storage.
   *
   * @param {Object} options - Options
   * @param {boolean} options.preferStorage - Prefer loading from storage over cache
   * @returns {Promise<Object>} All available summaries
   */
  async getAllSummariesWithStorage(options = {}) {
    // Start with in-memory cache
    let result = this.getAllCachedSummaries();

    // If cache is empty or preferStorage is set, try persistent storage
    if (Object.keys(result).length === 0 || options.preferStorage) {
      try {
        const storage = this._getStorageService();
        const storedSummaries = await storage.getAllSummaries({
          limit: options.limit || 100,
        });

        if (Object.keys(storedSummaries).length > 0) {
          // Merge storage results (storage takes precedence if preferStorage)
          if (options.preferStorage) {
            result = { ...result, ...storedSummaries };
          } else {
            result = { ...storedSummaries, ...result };
          }

          // Warm the in-memory cache
          for (const [communityId, summary] of Object.entries(storedSummaries)) {
            if (!this.cache.get(communityId)) {
              this.cache.set(communityId, summary);
            }
          }

          log.debug('Loaded summaries from persistent storage', {
            storageCount: Object.keys(storedSummaries).length,
            totalCount: Object.keys(result).length,
          });
        }
      } catch (storageError) {
        log.debug('Could not load from storage', { error: storageError.message });
      }
    }

    return result;
  }

  /**
   * Generate summaries for communities detected within a query subgraph.
   * Feature: F6.2.2 - Query-Time Summarization
   *
   * @param {Array} entities - Entities in the subgraph
   * @param {Array} relationships - Relationships in the subgraph
   * @param {Object} options - Options for detection/summarization
   * @param {number} options.minCommunitySize - Minimum community size to summarize
   * @param {number} options.resolution - Louvain resolution parameter
   * @returns {Promise<Object>} Summaries and metadata
   */
  async generateSummariesForSubgraph(entities = [], relationships = [], options = {}) {
    const startTime = Date.now();
    const minCommunitySize = options.minCommunitySize || CONFIG.MIN_COMMUNITY_SIZE_FOR_SUMMARY;
    const nodeIds = entities.map(e => e.id).filter(Boolean);

    if (nodeIds.length === 0) {
      return {
        summaries: {},
        communities: [],
        metadata: {
          summarizedCount: 0,
          skippedCount: 0,
          executionTimeMs: 0,
          generatedAt: new Date().toISOString(),
          mode: 'lazy',
          reason: 'no_nodes',
        },
      };
    }

    try {
      const detectionResult = await detectSubgraphCommunities(nodeIds, {
        resolution: options.resolution || 1.0,
      });

      const communityList = detectionResult.communityList || [];
      const eligibleCommunities = communityList.filter(c => c.size >= minCommunitySize);

      if (eligibleCommunities.length === 0) {
        return {
          summaries: {},
          communities: [],
          metadata: {
            ...detectionResult.metadata,
            summarizedCount: 0,
            skippedCount: communityList.length,
            executionTimeMs: Date.now() - startTime,
            generatedAt: new Date().toISOString(),
            mode: 'lazy',
            reason: 'no_eligible_communities',
          },
        };
      }

      const relationshipsMap = this._buildRelationshipsMapFromSubgraph(
        eligibleCommunities,
        relationships
      );

      // F6.2.3: Use stable community IDs for caching
      // Since detection IDs are non-deterministic, we generate a hash based on members
      for (const community of eligibleCommunities) {
        community.id = this._generateStableCommunityId(community.members);
      }

      const summaries = await this._generateSummariesBatch(
        eligibleCommunities,
        relationshipsMap,
        false, // Don't force refresh
        { cache: true } // Enable caching for lazy summaries
      );

      return {
        summaries,
        communities: eligibleCommunities,
        metadata: {
          ...detectionResult.metadata,
          summarizedCount: Object.keys(summaries).length,
          skippedCount: communityList.length - eligibleCommunities.length,
          executionTimeMs: Date.now() - startTime,
          generatedAt: new Date().toISOString(),
          mode: 'lazy',
        },
      };
    } catch (error) {
      log.warn('Failed to generate subgraph summaries, returning empty result', {
        error: error.message,
      });

      return {
        summaries: {},
        communities: [],
        metadata: {
          summarizedCount: 0,
          skippedCount: 0,
          executionTimeMs: Date.now() - startTime,
          generatedAt: new Date().toISOString(),
          mode: 'lazy',
          error: error.message,
        },
      };
    }
  }

  /**
   * Map-Reduce: Generate partial answers from community summaries
   * This is the MAP phase of Microsoft GraphRAG's global search
   *
   * @param {string} queryText - User query
   * @param {Object} options - Options
   * @returns {Promise<Object>} Partial answers from communities
   */
  async mapCommunitiesToPartialAnswers(queryText, options = {}) {
    const startTime = Date.now();
    const maxCommunities = options.maxCommunities || 10;

    // Get or generate community summaries
    let summaries = this.getAllCachedSummaries();

    if (Object.keys(summaries).length === 0 || options.forceRefresh) {
      const result = await this.generateAllSummaries({ forceRefresh: options.forceRefresh });
      summaries = result.summaries;
    }

    // Get top communities by size/relevance
    const sortedCommunities = Object.entries(summaries)
      .sort((a, b) => (b[1].memberCount || 0) - (a[1].memberCount || 0))
      .slice(0, maxCommunities);

    // Generate partial answers from each community
    const partialAnswers = [];

    for (const [communityId, summary] of sortedCommunities) {
      try {
        const partial = await this._generatePartialAnswer(queryText, summary);
        partialAnswers.push({
          communityId,
          communityName: summary.title || `Community ${communityId}`,
          partialAnswer: partial,
          relevanceScore: this._calculateRelevanceScore(queryText, summary),
        });
      } catch (error) {
        log.warn('Failed to generate partial answer for community', {
          communityId,
          error: error.message,
        });
      }
    }

    // Sort by relevance
    partialAnswers.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {
      partialAnswers,
      metadata: {
        queryLength: queryText.length,
        communitiesProcessed: sortedCommunities.length,
        executionTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Map-Reduce: Synthesize partial answers into final answer
   * This is the REDUCE phase of Microsoft GraphRAG's global search
   *
   * @param {string} queryText - User query
   * @param {Array} partialAnswers - Partial answers from MAP phase
   * @param {Object} options - Options
   * @returns {Promise<Object>} Synthesized answer
   */
  async reducePartialAnswers(queryText, partialAnswers, options = {}) {
    if (!partialAnswers || partialAnswers.length === 0) {
      return {
        answer: 'No relevant community context found to answer this question.',
        sources: [],
        confidence: 0,
      };
    }

    // Filter to most relevant partial answers
    const topPartials = partialAnswers
      .filter((p) => p.partialAnswer && p.partialAnswer.trim().length > 0)
      .slice(0, options.maxPartials || 5);

    if (topPartials.length === 0) {
      return {
        answer: 'Community summaries did not contain relevant information for this query.',
        sources: [],
        confidence: 0,
      };
    }

    // Build synthesis prompt
    const partialsText = topPartials
      .map((p, i) => `[Source ${i + 1}: ${p.communityName}]\n${p.partialAnswer}`)
      .join('\n\n');

    const messages = [
      {
        role: 'system',
        content: `You are a knowledge synthesis assistant. Your task is to combine multiple partial answers from different knowledge communities into a single, coherent, comprehensive answer.

Guidelines:
- Synthesize information from all sources, don't just concatenate
- Resolve any contradictions by noting different perspectives
- Cite sources using [Source N] notation
- Be comprehensive but concise
- If information is incomplete, acknowledge gaps
- Focus on answering the specific question asked`,
      },
      {
        role: 'user',
        content: `Question: ${queryText}

Partial answers from knowledge communities:

${partialsText}

Please synthesize these partial answers into a comprehensive response to the question.`,
      },
    ];

    try {
      const response = await this.openai.getChatCompletion(messages, {
        maxTokens: options.maxTokens || 800,
      });

      return {
        answer: response.content,
        sources: topPartials.map((p) => ({
          communityId: p.communityId,
          communityName: p.communityName,
          relevanceScore: p.relevanceScore,
        })),
        confidence: this._calculateConfidence(topPartials),
        metadata: {
          partialAnswersUsed: topPartials.length,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      log.errorWithStack('Failed to synthesize partial answers', error);
      throw error;
    }
  }

  /**
   * Full Map-Reduce pipeline for global query answering
   *
   * @param {string} queryText - User query
   * @param {Object} options - Options
   * @returns {Promise<Object>} Final answer with metadata
   */
  async globalQuery(queryText, options = {}) {
    const startTime = Date.now();

    // MAP phase
    const mapResult = await this.mapCommunitiesToPartialAnswers(queryText, options);

    // REDUCE phase
    const reduceResult = await this.reducePartialAnswers(
      queryText,
      mapResult.partialAnswers,
      options
    );

    return {
      ...reduceResult,
      metadata: {
        ...reduceResult.metadata,
        mapPhaseTimeMs: mapResult.metadata.executionTimeMs,
        totalTimeMs: Date.now() - startTime,
        communitiesAnalyzed: mapResult.metadata.communitiesProcessed,
      },
    };
  }

  /**
   * Generate a stable community ID based on its members.
   * Used for caching lazy summaries where detection IDs are non-deterministic.
   *
   * @param {Array} members - Array of member objects or IDs
   * @returns {string} Stable hash ID (e.g., "comm_a1b2c3...")
   */
  _generateStableCommunityId(members) {
    if (!members || members.length === 0) return 'comm_empty';

    // Extract IDs/names and sort them for stability
    const ids = members
      .map(m => (typeof m === 'object' ? (m.id || m.name) : m))
      .filter(Boolean)
      .map(String)
      .sort();

    // Generate hash
    const hash = crypto
      .createHash('md5')
      .update(ids.join(','))
      .digest('hex');

    return `comm_${hash.substring(0, 12)}`;
  }

  // ========== Private Methods ==========

  /**
   * Fetch relationships for communities
   */
  async _fetchCommunityRelationships(communities) {
    const relationshipsMap = new Map();

    try {
      // Get all relationships from graph
      const { edges } = await this.graphService.getAllEntities(10000);

      // Build member sets for each community
      const communityMemberSets = new Map();
      for (const community of communities) {
        const memberIds = new Set(community.members.map((m) => m.id));
        communityMemberSets.set(community.id, memberIds);
      }

      // Filter relationships to those within each community
      for (const community of communities) {
        const memberSet = communityMemberSets.get(community.id);
        const communityRelationships = [];

        for (const edge of edges) {
          // Check if both source and target are in this community
          // Match by ID or by name
          const sourceInCommunity = memberSet.has(edge.source) ||
            community.members.some((m) => m.name === edge.sourceName || m.id === edge.source);
          const targetInCommunity = memberSet.has(edge.target) ||
            community.members.some((m) => m.name === edge.targetName || m.id === edge.target);

          if (sourceInCommunity && targetInCommunity) {
            communityRelationships.push({
              source: edge.sourceName || edge.source,
              target: edge.targetName || edge.target,
              type: edge.label || edge.type || 'RELATED_TO',
            });
          }
        }

        relationshipsMap.set(community.id, communityRelationships);
      }
    } catch (error) {
      log.warn('Failed to fetch community relationships', { error: error.message });
    }

    return relationshipsMap;
  }

  /**
   * Build a relationships map using a subgraph relationship list.
   * @param {Array} communities - Community list with members
   * @param {Array} relationships - Subgraph relationships
   * @returns {Map} Map of communityId -> relationship list
   */
  _buildRelationshipsMapFromSubgraph(communities, relationships = []) {
    const relationshipsMap = new Map();
    const nameToCommunity = new Map();

    for (const community of communities) {
      relationshipsMap.set(community.id, []);
      for (const member of community.members || []) {
        const name = typeof member === 'string' ? member : member.name;
        if (name) {
          nameToCommunity.set(name, community.id);
        }
      }
    }

    for (const rel of relationships) {
      const sourceName = rel.from || rel.source;
      const targetName = rel.to || rel.target;
      if (!sourceName || !targetName) continue;

      const sourceCommunity = nameToCommunity.get(sourceName);
      const targetCommunity = nameToCommunity.get(targetName);
      if (sourceCommunity && sourceCommunity === targetCommunity) {
        const bucket = relationshipsMap.get(sourceCommunity);
        if (bucket) {
          bucket.push({
            source: sourceName,
            target: targetName,
            type: rel.type || rel.label || 'RELATED_TO',
          });
        }
      }
    }

    return relationshipsMap;
  }

  /**
   * Generate summaries for a batch of communities
   */
  async _generateSummariesBatch(communities, relationshipsMap, forceRefresh = false, options = {}) {
    const summaries = {};
    const batches = [];
    const useCache = options.cache !== false;

    // Split into batches
    for (let i = 0; i < communities.length; i += CONFIG.BATCH_SIZE) {
      batches.push(communities.slice(i, i + CONFIG.BATCH_SIZE));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(async (community) => {
        // Check cache unless forcing refresh
        if (useCache && !forceRefresh) {
          const cached = this.cache.get(String(community.id));
          if (cached) {
            return { communityId: community.id, summary: cached };
          }
        }

        const relationships = relationshipsMap.get(community.id) || [];
        const summary = await this._generateSingleSummary(community, relationships);

        // Cache the result
        if (useCache) {
          this.cache.set(String(community.id), summary);
        }

        return { communityId: community.id, summary };
      });

      const batchResults = await Promise.all(batchPromises);

      for (const { communityId, summary } of batchResults) {
        summaries[communityId] = summary;
      }

      // Rate limiting delay between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await this._sleep(CONFIG.RATE_LIMIT_DELAY_MS);
      }
    }

    return summaries;
  }

  /**
   * Generate a summary for a single community
   */
  async _generateSingleSummary(community, relationships) {
    const { id, members, typeCounts, dominantType } = community;

    // Limit entities and relationships for prompt
    const limitedMembers = members.slice(0, CONFIG.MAX_ENTITIES_IN_PROMPT);
    const limitedRelationships = relationships.slice(0, CONFIG.MAX_RELATIONSHIPS_IN_PROMPT);

    // Build entity list
    const entityList = limitedMembers
      .map((m) => `- ${m.name} (${m.type || 'Unknown'})`)
      .join('\n');

    // Build relationship list
    const relationshipList = limitedRelationships
      .map((r) => `- ${r.source} --[${r.type}]--> ${r.target}`)
      .join('\n');

    // Build type distribution
    const typeDistribution = Object.entries(typeCounts || {})
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    const messages = [
      {
        role: 'system',
        content: `You are a knowledge graph analyst creating summaries for communities of related entities.

Your task is to generate a concise, informative summary that:
1. Identifies the main theme or domain of the community
2. Describes the key entities and their roles
3. Explains the relationships and how entities connect
4. Highlights any notable patterns or insights

Keep the summary under ${CONFIG.MAX_SUMMARY_LENGTH} characters.
Write in a clear, professional style suitable for enterprise knowledge management.`,
      },
      {
        role: 'user',
        content: `Summarize this knowledge graph community:

Community ID: ${id}
Size: ${members.length} entities
Dominant Entity Type: ${dominantType || 'Mixed'}
Type Distribution: ${typeDistribution}

Entities:
${entityList || '(No entities)'}

Relationships:
${relationshipList || '(No relationships)'}

Please provide a concise summary of this community, including:
1. A descriptive title (5-10 words)
2. A summary paragraph describing the community's content and relationships`,
      },
    ];

    try {
      const response = await this.openai.getJsonCompletion(
        [
          ...messages,
          {
            role: 'user',
            content: 'Respond in JSON format with "title" and "summary" fields.',
          },
        ],
        { maxTokens: CONFIG.MAX_TOKENS_PER_SUMMARY }
      );

      const parsed = response.content;

      return {
        communityId: id,
        title: parsed.title || `Community ${id}`,
        summary: parsed.summary || 'No summary generated.',
        memberCount: members.length,
        dominantType: dominantType || 'Unknown',
        typeCounts,
        relationshipCount: relationships.length,
        keyEntities: limitedMembers.slice(0, 5).map((m) => m.name),
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.warn('Failed to generate community summary, using fallback', {
        communityId: id,
        error: error.message,
      });

      // Fallback summary
      const topEntities = limitedMembers.slice(0, 5).map((m) => m.name).join(', ');
      return {
        communityId: id,
        title: `${dominantType || 'Mixed'} Community`,
        summary: `A community of ${members.length} entities primarily consisting of ${dominantType || 'various'} types. Key entities include: ${topEntities}. Contains ${relationships.length} internal relationships.`,
        memberCount: members.length,
        dominantType: dominantType || 'Unknown',
        typeCounts,
        relationshipCount: relationships.length,
        keyEntities: limitedMembers.slice(0, 5).map((m) => m.name),
        generatedAt: new Date().toISOString(),
        fallback: true,
      };
    }
  }

  /**
   * Generate a partial answer from a community summary
   */
  async _generatePartialAnswer(queryText, summary) {
    const messages = [
      {
        role: 'system',
        content: `You are analyzing a knowledge community to answer a question.
Based on the community summary, provide any relevant information that helps answer the question.
If the community doesn't contain relevant information, respond with "No relevant information in this community."
Be concise and specific.`,
      },
      {
        role: 'user',
        content: `Community: ${summary.title}
Summary: ${summary.summary}
Key Entities: ${summary.keyEntities?.join(', ') || 'N/A'}

Question: ${queryText}

What relevant information does this community provide?`,
      },
    ];

    const response = await this.openai.getChatCompletion(messages, {
      maxTokens: 200,
    });

    return response.content;
  }

  /**
   * Calculate relevance score between query and summary
   */
  _calculateRelevanceScore(queryText, summary) {
    // Simple keyword matching for now
    // In production, could use embeddings for semantic similarity
    const queryWords = queryText.toLowerCase().split(/\s+/);
    const summaryText = `${summary.title} ${summary.summary} ${summary.keyEntities?.join(' ') || ''}`.toLowerCase();

    let matches = 0;
    for (const word of queryWords) {
      if (word.length > 3 && summaryText.includes(word)) {
        matches++;
      }
    }

    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  /**
   * Calculate confidence based on partial answers
   */
  _calculateConfidence(partialAnswers) {
    if (!partialAnswers || partialAnswers.length === 0) return 0;

    const avgRelevance =
      partialAnswers.reduce((sum, p) => sum + (p.relevanceScore || 0), 0) / partialAnswers.length;

    // More sources = higher confidence (up to a point)
    const sourceFactor = Math.min(partialAnswers.length / 3, 1);

    return Math.min((avgRelevance * 0.6 + sourceFactor * 0.4), 1);
  }

  /**
   * Sleep utility
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      lastFullGeneration: this.lastFullGeneration
        ? new Date(this.lastFullGeneration).toISOString()
        : null,
      lastModularity: this.lastModularity,
      lastCommunityCount: this.lastCommunityCount,
      cacheStats: this.cache.getStats(),
    };
  }

  /**
   * Get service status including storage (async version)
   * @returns {Promise<Object>} Service status with storage stats
   */
  async getStatusWithStorage() {
    const baseStatus = this.getStatus();

    try {
      const storage = this._getStorageService();
      const storageStats = await storage.getStats();
      return {
        ...baseStatus,
        storageStats,
        storageEnabled: true,
      };
    } catch (error) {
      return {
        ...baseStatus,
        storageStats: null,
        storageEnabled: false,
        storageError: error.message,
      };
    }
  }

  /**
   * Clear the summary cache
   */
  clearCache() {
    this.cache.clear();
    log.info('Community summary cache cleared');
  }

  /**
   * Clear both in-memory cache and persistent storage
   * @param {Object} options - Options
   * @param {boolean} options.preserveSnapshots - Keep snapshots for historical tracking
   * @returns {Promise<Object>} Clear result
   */
  async clearAll(options = {}) {
    // Clear in-memory cache
    this.clearCache();

    // Clear persistent storage
    try {
      const storage = this._getStorageService();
      const storageResult = await storage.clearStorage(options);
      return {
        cacheCleared: true,
        storageCleared: true,
        ...storageResult,
      };
    } catch (error) {
      log.warn('Failed to clear storage', { error: error.message });
      return {
        cacheCleared: true,
        storageCleared: false,
        error: error.message,
      };
    }
  }
}

// Singleton instance
let instance = null;

function getCommunitySummaryService() {
  if (!instance) {
    instance = new CommunitySummaryService();
  }
  return instance;
}

module.exports = {
  CommunitySummaryService,
  getCommunitySummaryService,
  CONFIG,
};
