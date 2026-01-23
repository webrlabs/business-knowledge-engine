/**
 * Entity Resolution Cache Service
 *
 * High-performance caching layer for entity resolution lookups using LRU caching.
 * Implements F5.2.2 from the SOTA GraphRAG Feature Backlog.
 *
 * Features:
 * - LRU caching for resolved entities by normalized name
 * - Embedding vector caching to avoid repeated API calls
 * - Similarity lookup caching for repeated comparisons
 * - Configurable TTL and cache sizes
 * - Cache statistics for monitoring and optimization
 * - Cache invalidation strategies
 *
 * Based on lru-cache v11+ best practices:
 * @see https://www.npmjs.com/package/lru-cache
 */

const { LRUCache } = require('lru-cache');
const { log } = require('../utils/logger');

// Configuration with environment variable overrides
const CONFIG = {
  // Resolved entities cache (most frequently accessed)
  RESOLVED_ENTITIES_MAX: parseInt(process.env.CACHE_RESOLVED_ENTITIES_MAX, 10) || 5000,
  RESOLVED_ENTITIES_TTL: parseInt(process.env.CACHE_RESOLVED_ENTITIES_TTL_MS, 10) || 30 * 60 * 1000, // 30 min

  // Embedding vectors cache (expensive to compute)
  EMBEDDINGS_MAX: parseInt(process.env.CACHE_EMBEDDINGS_MAX, 10) || 2000,
  EMBEDDINGS_TTL: parseInt(process.env.CACHE_EMBEDDINGS_TTL_MS, 10) || 60 * 60 * 1000, // 60 min

  // Similarity lookup cache (frequently repeated)
  SIMILARITY_MAX: parseInt(process.env.CACHE_SIMILARITY_MAX, 10) || 10000,
  SIMILARITY_TTL: parseInt(process.env.CACHE_SIMILARITY_TTL_MS, 10) || 15 * 60 * 1000, // 15 min

  // Canonical entity cache (frequently accessed)
  CANONICAL_MAX: parseInt(process.env.CACHE_CANONICAL_MAX, 10) || 3000,
  CANONICAL_TTL: parseInt(process.env.CACHE_CANONICAL_TTL_MS, 10) || 30 * 60 * 1000, // 30 min

  // Similar entities cache
  SIMILAR_ENTITIES_MAX: parseInt(process.env.CACHE_SIMILAR_ENTITIES_MAX, 10) || 2000,
  SIMILAR_ENTITIES_TTL: parseInt(process.env.CACHE_SIMILAR_ENTITIES_TTL_MS, 10) || 10 * 60 * 1000, // 10 min

  // Enable/disable caching entirely
  ENABLED: process.env.CACHE_ENTITY_RESOLUTION_ENABLED !== 'false',

  // Update age on get (refresh TTL on access)
  UPDATE_AGE_ON_GET: process.env.CACHE_UPDATE_AGE_ON_GET === 'true',
};

/**
 * Cache statistics tracker
 */
class CacheStats {
  constructor(name) {
    this.name = name;
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
    this.invalidations = 0;
    this.startTime = Date.now();
  }

  recordHit() {
    this.hits++;
  }

  recordMiss() {
    this.misses++;
  }

  recordSet() {
    this.sets++;
  }

  recordEviction() {
    this.evictions++;
  }

  recordInvalidation() {
    this.invalidations++;
  }

  get hitRate() {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  get uptimeMs() {
    return Date.now() - this.startTime;
  }

  toJSON() {
    return {
      name: this.name,
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      evictions: this.evictions,
      invalidations: this.invalidations,
      hitRate: this.hitRate,
      hitRatePercent: `${(this.hitRate * 100).toFixed(2)}%`,
      uptimeMs: this.uptimeMs,
      uptimeFormatted: this._formatUptime(this.uptimeMs),
    };
  }

  _formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  reset() {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.evictions = 0;
    this.invalidations = 0;
    this.startTime = Date.now();
  }
}

/**
 * Entity Resolution Cache
 *
 * Manages multiple specialized LRU caches for different aspects of entity resolution.
 */
class EntityResolutionCache {
  constructor(options = {}) {
    this.enabled = options.enabled ?? CONFIG.ENABLED;
    this.updateAgeOnGet = options.updateAgeOnGet ?? CONFIG.UPDATE_AGE_ON_GET;

    // Initialize caches
    this._initCaches(options);

    // Initialize statistics
    this.stats = {
      resolvedEntities: new CacheStats('resolvedEntities'),
      embeddings: new CacheStats('embeddings'),
      similarity: new CacheStats('similarity'),
      canonical: new CacheStats('canonical'),
      similarEntities: new CacheStats('similarEntities'),
    };

    log.info('Entity resolution cache initialized', {
      enabled: this.enabled,
      resolvedEntitiesMax: this.resolvedEntitiesCache.max,
      embeddingsMax: this.embeddingsCache.max,
      similarityMax: this.similarityCache.max,
      canonicalMax: this.canonicalCache.max,
      similarEntitiesMax: this.similarEntitiesCache.max,
    });
  }

  _initCaches(options) {
    // Cache for resolved entities: normalizedName -> resolution result
    this.resolvedEntitiesCache = new LRUCache({
      max: options.resolvedEntitiesMax ?? CONFIG.RESOLVED_ENTITIES_MAX,
      ttl: options.resolvedEntitiesTtl ?? CONFIG.RESOLVED_ENTITIES_TTL,
      updateAgeOnGet: this.updateAgeOnGet,
      dispose: (value, key, reason) => {
        if (reason === 'evict') {
          this.stats.resolvedEntities.recordEviction();
        }
      },
    });

    // Cache for embedding vectors: "name:type" -> embeddings
    this.embeddingsCache = new LRUCache({
      max: options.embeddingsMax ?? CONFIG.EMBEDDINGS_MAX,
      ttl: options.embeddingsTtl ?? CONFIG.EMBEDDINGS_TTL,
      updateAgeOnGet: this.updateAgeOnGet,
      dispose: (value, key, reason) => {
        if (reason === 'evict') {
          this.stats.embeddings.recordEviction();
        }
      },
    });

    // Cache for similarity lookups: "id1:id2" -> similarity score
    this.similarityCache = new LRUCache({
      max: options.similarityMax ?? CONFIG.SIMILARITY_MAX,
      ttl: options.similarityTtl ?? CONFIG.SIMILARITY_TTL,
      updateAgeOnGet: this.updateAgeOnGet,
      dispose: (value, key, reason) => {
        if (reason === 'evict') {
          this.stats.similarity.recordEviction();
        }
      },
    });

    // Cache for canonical entities: normalizedName -> canonical entity
    this.canonicalCache = new LRUCache({
      max: options.canonicalMax ?? CONFIG.CANONICAL_MAX,
      ttl: options.canonicalTtl ?? CONFIG.CANONICAL_TTL,
      updateAgeOnGet: this.updateAgeOnGet,
      dispose: (value, key, reason) => {
        if (reason === 'evict') {
          this.stats.canonical.recordEviction();
        }
      },
    });

    // Cache for similar entities lookup results: normalizedName -> similar entities array
    this.similarEntitiesCache = new LRUCache({
      max: options.similarEntitiesMax ?? CONFIG.SIMILAR_ENTITIES_MAX,
      ttl: options.similarEntitiesTtl ?? CONFIG.SIMILAR_ENTITIES_TTL,
      updateAgeOnGet: this.updateAgeOnGet,
      dispose: (value, key, reason) => {
        if (reason === 'evict') {
          this.stats.similarEntities.recordEviction();
        }
      },
    });
  }

  // ===================
  // Resolved Entities Cache
  // ===================

  /**
   * Get a resolved entity from cache
   * @param {string} normalizedName - The normalized entity name
   * @param {string} documentId - The document ID (part of cache key for document-specific resolution)
   * @returns {object|undefined} The cached resolution result or undefined
   */
  getResolvedEntity(normalizedName, documentId) {
    if (!this.enabled) return undefined;

    const key = this._resolvedEntityKey(normalizedName, documentId);
    const cached = this.resolvedEntitiesCache.get(key);

    if (cached) {
      this.stats.resolvedEntities.recordHit();
      log.debug('Cache hit: resolved entity', { normalizedName, documentId });
    } else {
      this.stats.resolvedEntities.recordMiss();
    }

    return cached;
  }

  /**
   * Store a resolved entity in cache
   * @param {string} normalizedName - The normalized entity name
   * @param {string} documentId - The document ID
   * @param {object} resolution - The resolution result
   */
  setResolvedEntity(normalizedName, documentId, resolution) {
    if (!this.enabled) return;

    const key = this._resolvedEntityKey(normalizedName, documentId);
    this.resolvedEntitiesCache.set(key, resolution);
    this.stats.resolvedEntities.recordSet();
    log.debug('Cache set: resolved entity', { normalizedName, documentId });
  }

  _resolvedEntityKey(normalizedName, documentId) {
    return `${normalizedName}:${documentId || 'global'}`;
  }

  // ===================
  // Embeddings Cache
  // ===================

  /**
   * Get cached embeddings for an entity
   * @param {string} name - Entity name
   * @param {string} type - Entity type
   * @param {string} description - Entity description (affects embedding)
   * @returns {object|undefined} The cached embeddings or undefined
   */
  getEmbeddings(name, type, description = '') {
    if (!this.enabled) return undefined;

    const key = this._embeddingsKey(name, type, description);
    const cached = this.embeddingsCache.get(key);

    if (cached) {
      this.stats.embeddings.recordHit();
      log.debug('Cache hit: embeddings', { name, type });
    } else {
      this.stats.embeddings.recordMiss();
    }

    return cached;
  }

  /**
   * Store embeddings in cache
   * @param {string} name - Entity name
   * @param {string} type - Entity type
   * @param {string} description - Entity description
   * @param {object} embeddings - The embeddings object
   */
  setEmbeddings(name, type, description, embeddings) {
    if (!this.enabled) return;

    const key = this._embeddingsKey(name, type, description);
    this.embeddingsCache.set(key, embeddings);
    this.stats.embeddings.recordSet();
    log.debug('Cache set: embeddings', { name, type });
  }

  _embeddingsKey(name, type, description = '') {
    // Use a hash of description to keep key size manageable
    const descHash = description ? this._simpleHash(description) : '';
    return `${name}:${type || 'unknown'}:${descHash}`;
  }

  _simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  // ===================
  // Similarity Cache
  // ===================

  /**
   * Get cached similarity score between two entities
   * @param {string} id1 - First entity ID
   * @param {string} id2 - Second entity ID
   * @returns {number|undefined} The cached similarity score or undefined
   */
  getSimilarity(id1, id2) {
    if (!this.enabled) return undefined;

    const key = this._similarityKey(id1, id2);
    const cached = this.similarityCache.get(key);

    if (cached !== undefined) {
      this.stats.similarity.recordHit();
      log.debug('Cache hit: similarity', { id1, id2, similarity: cached });
    } else {
      this.stats.similarity.recordMiss();
    }

    return cached;
  }

  /**
   * Store similarity score in cache
   * @param {string} id1 - First entity ID
   * @param {string} id2 - Second entity ID
   * @param {number} similarity - The similarity score
   */
  setSimilarity(id1, id2, similarity) {
    if (!this.enabled) return;

    const key = this._similarityKey(id1, id2);
    this.similarityCache.set(key, similarity);
    this.stats.similarity.recordSet();
    log.debug('Cache set: similarity', { id1, id2, similarity });
  }

  _similarityKey(id1, id2) {
    // Ensure consistent ordering for bidirectional lookups
    return id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`;
  }

  // ===================
  // Canonical Entity Cache
  // ===================

  /**
   * Get cached canonical entity
   * @param {string} normalizedName - The normalized entity name
   * @returns {object|undefined} The cached canonical entity or undefined
   */
  getCanonicalEntity(normalizedName) {
    if (!this.enabled) return undefined;

    const cached = this.canonicalCache.get(normalizedName);

    if (cached) {
      this.stats.canonical.recordHit();
      log.debug('Cache hit: canonical entity', { normalizedName });
    } else {
      this.stats.canonical.recordMiss();
    }

    return cached;
  }

  /**
   * Store canonical entity in cache
   * @param {string} normalizedName - The normalized entity name
   * @param {object} entity - The canonical entity
   */
  setCanonicalEntity(normalizedName, entity) {
    if (!this.enabled) return;

    this.canonicalCache.set(normalizedName, entity);
    this.stats.canonical.recordSet();
    log.debug('Cache set: canonical entity', { normalizedName });
  }

  // ===================
  // Similar Entities Cache
  // ===================

  /**
   * Get cached similar entities
   * @param {string} normalizedName - The normalized entity name
   * @param {string} type - Entity type (optional filter)
   * @param {object} options - Search options
   * @returns {array|undefined} The cached similar entities or undefined
   */
  getSimilarEntities(normalizedName, type, options = {}) {
    if (!this.enabled) return undefined;

    const key = this._similarEntitiesKey(normalizedName, type, options);
    const cached = this.similarEntitiesCache.get(key);

    if (cached) {
      this.stats.similarEntities.recordHit();
      log.debug('Cache hit: similar entities', { normalizedName, type });
    } else {
      this.stats.similarEntities.recordMiss();
    }

    return cached;
  }

  /**
   * Store similar entities in cache
   * @param {string} normalizedName - The normalized entity name
   * @param {string} type - Entity type
   * @param {object} options - Search options
   * @param {array} entities - The similar entities
   */
  setSimilarEntities(normalizedName, type, options, entities) {
    if (!this.enabled) return;

    const key = this._similarEntitiesKey(normalizedName, type, options);
    this.similarEntitiesCache.set(key, entities);
    this.stats.similarEntities.recordSet();
    log.debug('Cache set: similar entities', { normalizedName, type, count: entities.length });
  }

  _similarEntitiesKey(normalizedName, type, options = {}) {
    const optionsHash = this._simpleHash(JSON.stringify({
      filterByType: options.filterByType,
      excludeDocumentId: options.excludeDocumentId,
      maxCandidates: options.maxCandidates,
    }));
    return `${normalizedName}:${type || 'any'}:${optionsHash}`;
  }

  // ===================
  // Cache Invalidation
  // ===================

  /**
   * Invalidate all caches for a specific entity
   * @param {string} normalizedName - The normalized entity name
   */
  invalidateEntity(normalizedName) {
    if (!this.enabled) return;

    // Remove from all caches that use normalizedName as key or key prefix
    let invalidated = 0;

    // Clear from canonical cache
    if (this.canonicalCache.delete(normalizedName)) {
      invalidated++;
      this.stats.canonical.recordInvalidation();
    }

    // Clear from resolved entities cache (all document variants)
    for (const key of this.resolvedEntitiesCache.keys()) {
      if (key.startsWith(`${normalizedName}:`)) {
        this.resolvedEntitiesCache.delete(key);
        invalidated++;
        this.stats.resolvedEntities.recordInvalidation();
      }
    }

    // Clear from similar entities cache
    for (const key of this.similarEntitiesCache.keys()) {
      if (key.startsWith(`${normalizedName}:`)) {
        this.similarEntitiesCache.delete(key);
        invalidated++;
        this.stats.similarEntities.recordInvalidation();
      }
    }

    // Clear from embeddings cache
    for (const key of this.embeddingsCache.keys()) {
      if (key.startsWith(`${normalizedName}:`)) {
        this.embeddingsCache.delete(key);
        invalidated++;
        this.stats.embeddings.recordInvalidation();
      }
    }

    log.info('Entity cache invalidated', { normalizedName, invalidatedEntries: invalidated });
    return invalidated;
  }

  /**
   * Invalidate cache entries related to a document
   * @param {string} documentId - The document ID
   */
  invalidateDocument(documentId) {
    if (!this.enabled) return;

    let invalidated = 0;

    // Clear resolved entities for this document
    for (const key of this.resolvedEntitiesCache.keys()) {
      if (key.endsWith(`:${documentId}`)) {
        this.resolvedEntitiesCache.delete(key);
        invalidated++;
        this.stats.resolvedEntities.recordInvalidation();
      }
    }

    // Clear similar entities that excluded this document
    for (const key of this.similarEntitiesCache.keys()) {
      // Keys with this document in options need to be cleared
      this.similarEntitiesCache.delete(key);
      invalidated++;
      this.stats.similarEntities.recordInvalidation();
    }

    log.info('Document cache invalidated', { documentId, invalidatedEntries: invalidated });
    return invalidated;
  }

  /**
   * Invalidate similarity cache entries for an entity
   * @param {string} entityId - The entity ID
   */
  invalidateSimilarity(entityId) {
    if (!this.enabled) return;

    let invalidated = 0;

    for (const key of this.similarityCache.keys()) {
      if (key.includes(entityId)) {
        this.similarityCache.delete(key);
        invalidated++;
        this.stats.similarity.recordInvalidation();
      }
    }

    log.info('Similarity cache invalidated', { entityId, invalidatedEntries: invalidated });
    return invalidated;
  }

  /**
   * Clear all caches
   */
  clear() {
    this.resolvedEntitiesCache.clear();
    this.embeddingsCache.clear();
    this.similarityCache.clear();
    this.canonicalCache.clear();
    this.similarEntitiesCache.clear();

    log.info('All entity resolution caches cleared');
  }

  // ===================
  // Statistics & Monitoring
  // ===================

  /**
   * Get comprehensive cache statistics
   * @returns {object} Cache statistics
   */
  getStats() {
    return {
      enabled: this.enabled,
      caches: {
        resolvedEntities: {
          ...this.stats.resolvedEntities.toJSON(),
          size: this.resolvedEntitiesCache.size,
          maxSize: this.resolvedEntitiesCache.max,
          utilizationPercent: `${((this.resolvedEntitiesCache.size / this.resolvedEntitiesCache.max) * 100).toFixed(1)}%`,
        },
        embeddings: {
          ...this.stats.embeddings.toJSON(),
          size: this.embeddingsCache.size,
          maxSize: this.embeddingsCache.max,
          utilizationPercent: `${((this.embeddingsCache.size / this.embeddingsCache.max) * 100).toFixed(1)}%`,
        },
        similarity: {
          ...this.stats.similarity.toJSON(),
          size: this.similarityCache.size,
          maxSize: this.similarityCache.max,
          utilizationPercent: `${((this.similarityCache.size / this.similarityCache.max) * 100).toFixed(1)}%`,
        },
        canonical: {
          ...this.stats.canonical.toJSON(),
          size: this.canonicalCache.size,
          maxSize: this.canonicalCache.max,
          utilizationPercent: `${((this.canonicalCache.size / this.canonicalCache.max) * 100).toFixed(1)}%`,
        },
        similarEntities: {
          ...this.stats.similarEntities.toJSON(),
          size: this.similarEntitiesCache.size,
          maxSize: this.similarEntitiesCache.max,
          utilizationPercent: `${((this.similarEntitiesCache.size / this.similarEntitiesCache.max) * 100).toFixed(1)}%`,
        },
      },
      totals: this._calculateTotals(),
      config: {
        updateAgeOnGet: this.updateAgeOnGet,
        resolvedEntitiesTtlMs: CONFIG.RESOLVED_ENTITIES_TTL,
        embeddingsTtlMs: CONFIG.EMBEDDINGS_TTL,
        similarityTtlMs: CONFIG.SIMILARITY_TTL,
        canonicalTtlMs: CONFIG.CANONICAL_TTL,
        similarEntitiesTtlMs: CONFIG.SIMILAR_ENTITIES_TTL,
      },
    };
  }

  _calculateTotals() {
    const caches = [
      this.stats.resolvedEntities,
      this.stats.embeddings,
      this.stats.similarity,
      this.stats.canonical,
      this.stats.similarEntities,
    ];

    const totals = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      invalidations: 0,
      totalSize: 0,
      totalMaxSize: 0,
    };

    for (const stats of caches) {
      totals.hits += stats.hits;
      totals.misses += stats.misses;
      totals.sets += stats.sets;
      totals.evictions += stats.evictions;
      totals.invalidations += stats.invalidations;
    }

    totals.totalSize = this.resolvedEntitiesCache.size
      + this.embeddingsCache.size
      + this.similarityCache.size
      + this.canonicalCache.size
      + this.similarEntitiesCache.size;

    totals.totalMaxSize = this.resolvedEntitiesCache.max
      + this.embeddingsCache.max
      + this.similarityCache.max
      + this.canonicalCache.max
      + this.similarEntitiesCache.max;

    const totalRequests = totals.hits + totals.misses;
    totals.overallHitRate = totalRequests === 0 ? 0 : totals.hits / totalRequests;
    totals.overallHitRatePercent = `${(totals.overallHitRate * 100).toFixed(2)}%`;
    totals.utilizationPercent = `${((totals.totalSize / totals.totalMaxSize) * 100).toFixed(1)}%`;

    return totals;
  }

  /**
   * Reset all statistics (keeps cached data)
   */
  resetStats() {
    for (const stats of Object.values(this.stats)) {
      stats.reset();
    }
    log.info('Cache statistics reset');
  }

  /**
   * Get a summary suitable for health checks
   * @returns {object} Health check summary
   */
  getHealthSummary() {
    const stats = this.getStats();
    const totals = stats.totals;

    return {
      status: this.enabled ? 'enabled' : 'disabled',
      overallHitRate: totals.overallHitRatePercent,
      utilization: totals.utilizationPercent,
      totalCachedItems: totals.totalSize,
      health: this._assessHealth(totals),
    };
  }

  _assessHealth(totals) {
    // Assess cache health based on hit rate and utilization
    const hitRate = totals.overallHitRate;
    const utilization = totals.totalSize / totals.totalMaxSize;

    if (hitRate >= 0.7 && utilization < 0.95) {
      return 'healthy';
    } else if (hitRate >= 0.4 || utilization < 0.9) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  /**
   * Enable or disable caching at runtime
   * @param {boolean} enabled - Whether to enable caching
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    log.info(`Entity resolution cache ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton cache instance
 * @returns {EntityResolutionCache} The cache instance
 */
function getEntityResolutionCache() {
  if (!instance) {
    instance = new EntityResolutionCache();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
function resetEntityResolutionCache() {
  if (instance) {
    instance.clear();
    instance = null;
  }
}

module.exports = {
  EntityResolutionCache,
  getEntityResolutionCache,
  resetEntityResolutionCache,
  CONFIG,
  CacheStats,
};
