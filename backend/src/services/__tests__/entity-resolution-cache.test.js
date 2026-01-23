/**
 * Unit tests for Entity Resolution Cache Service
 *
 * Tests F5.2.2 - Entity Resolution Caching functionality
 */

const {
  EntityResolutionCache,
  getEntityResolutionCache,
  resetEntityResolutionCache,
  CONFIG,
  CacheStats,
} = require('../entity-resolution-cache');

describe('EntityResolutionCache', () => {
  let cache;

  beforeEach(() => {
    // Reset singleton and create fresh instance
    resetEntityResolutionCache();
    cache = new EntityResolutionCache({
      resolvedEntitiesMax: 100,
      embeddingsMax: 50,
      similarityMax: 200,
      canonicalMax: 75,
      similarEntitiesMax: 50,
    });
  });

  afterEach(() => {
    resetEntityResolutionCache();
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default configuration when enabled', () => {
      const stats = cache.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.caches.resolvedEntities.maxSize).toBe(100);
      expect(stats.caches.embeddings.maxSize).toBe(50);
    });

    test('should initialize with caching disabled when specified', () => {
      const disabledCache = new EntityResolutionCache({ enabled: false });
      expect(disabledCache.getStats().enabled).toBe(false);
    });

    test('should create singleton instance', () => {
      resetEntityResolutionCache();
      const instance1 = getEntityResolutionCache();
      const instance2 = getEntityResolutionCache();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Resolved Entities Cache', () => {
    test('should store and retrieve resolved entity', () => {
      const normalizedName = 'test_entity';
      const documentId = 'doc123';
      const resolution = {
        entity: { id: '1', name: 'Test Entity' },
        action: 'created',
        similarity: 0.95,
      };

      cache.setResolvedEntity(normalizedName, documentId, resolution);
      const retrieved = cache.getResolvedEntity(normalizedName, documentId);

      expect(retrieved).toEqual(resolution);
    });

    test('should return undefined for cache miss', () => {
      const result = cache.getResolvedEntity('nonexistent', 'doc123');
      expect(result).toBeUndefined();
    });

    test('should track hits and misses', () => {
      cache.setResolvedEntity('entity1', 'doc1', { entity: {} });

      // Hit
      cache.getResolvedEntity('entity1', 'doc1');
      // Miss
      cache.getResolvedEntity('entity2', 'doc1');

      const stats = cache.getStats();
      expect(stats.caches.resolvedEntities.hits).toBe(1);
      expect(stats.caches.resolvedEntities.misses).toBe(1);
    });

    test('should use document-specific keys', () => {
      const resolution1 = { entity: { id: '1' }, action: 'created' };
      const resolution2 = { entity: { id: '2' }, action: 'merged' };

      cache.setResolvedEntity('same_entity', 'doc1', resolution1);
      cache.setResolvedEntity('same_entity', 'doc2', resolution2);

      expect(cache.getResolvedEntity('same_entity', 'doc1')).toEqual(resolution1);
      expect(cache.getResolvedEntity('same_entity', 'doc2')).toEqual(resolution2);
    });
  });

  describe('Embeddings Cache', () => {
    test('should store and retrieve embeddings', () => {
      const name = 'Test Entity';
      const type = 'Process';
      const description = 'A test process for unit testing';
      const embeddings = {
        nameVector: [0.1, 0.2, 0.3],
        descriptionVector: [0.4, 0.5, 0.6],
        combinedVector: [0.7, 0.8, 0.9],
      };

      cache.setEmbeddings(name, type, description, embeddings);
      const retrieved = cache.getEmbeddings(name, type, description);

      expect(retrieved).toEqual(embeddings);
    });

    test('should differentiate by description', () => {
      const name = 'Entity';
      const type = 'Task';
      const embeddings1 = { combinedVector: [0.1] };
      const embeddings2 = { combinedVector: [0.2] };

      cache.setEmbeddings(name, type, 'Description 1', embeddings1);
      cache.setEmbeddings(name, type, 'Description 2', embeddings2);

      expect(cache.getEmbeddings(name, type, 'Description 1')).toEqual(embeddings1);
      expect(cache.getEmbeddings(name, type, 'Description 2')).toEqual(embeddings2);
    });

    test('should handle empty description', () => {
      const embeddings = { combinedVector: [0.1] };
      cache.setEmbeddings('Entity', 'Type', '', embeddings);
      expect(cache.getEmbeddings('Entity', 'Type', '')).toEqual(embeddings);
    });
  });

  describe('Similarity Cache', () => {
    test('should store and retrieve similarity scores', () => {
      cache.setSimilarity('id1', 'id2', 0.95);
      expect(cache.getSimilarity('id1', 'id2')).toBe(0.95);
    });

    test('should be bidirectional', () => {
      cache.setSimilarity('id1', 'id2', 0.85);
      expect(cache.getSimilarity('id2', 'id1')).toBe(0.85);
    });

    test('should return undefined for cache miss', () => {
      expect(cache.getSimilarity('id1', 'id2')).toBeUndefined();
    });
  });

  describe('Canonical Entity Cache', () => {
    test('should store and retrieve canonical entity', () => {
      const entity = { id: '1', name: 'Canonical Entity', type: 'Process' };
      cache.setCanonicalEntity('canonical_entity', entity);
      expect(cache.getCanonicalEntity('canonical_entity')).toEqual(entity);
    });

    test('should return undefined for cache miss', () => {
      expect(cache.getCanonicalEntity('nonexistent')).toBeUndefined();
    });
  });

  describe('Similar Entities Cache', () => {
    test('should store and retrieve similar entities', () => {
      const entities = [
        { id: '1', name: 'Entity 1', similarity: 0.9 },
        { id: '2', name: 'Entity 2', similarity: 0.8 },
      ];
      const options = { filterByType: true, maxCandidates: 10 };

      cache.setSimilarEntities('test_entity', 'Process', options, entities);
      const retrieved = cache.getSimilarEntities('test_entity', 'Process', options);

      expect(retrieved).toEqual(entities);
    });

    test('should differentiate by options', () => {
      const entities1 = [{ id: '1' }];
      const entities2 = [{ id: '2' }];
      const options1 = { filterByType: true };
      const options2 = { filterByType: false };

      cache.setSimilarEntities('entity', 'Type', options1, entities1);
      cache.setSimilarEntities('entity', 'Type', options2, entities2);

      expect(cache.getSimilarEntities('entity', 'Type', options1)).toEqual(entities1);
      expect(cache.getSimilarEntities('entity', 'Type', options2)).toEqual(entities2);
    });
  });

  describe('Cache Invalidation', () => {
    test('should invalidate entity from all caches', () => {
      const normalizedName = 'test_entity';

      cache.setResolvedEntity(normalizedName, 'doc1', { entity: {} });
      cache.setCanonicalEntity(normalizedName, { id: '1' });
      cache.setSimilarEntities(normalizedName, 'Type', {}, []);

      const invalidated = cache.invalidateEntity(normalizedName);

      expect(invalidated).toBeGreaterThan(0);
      expect(cache.getResolvedEntity(normalizedName, 'doc1')).toBeUndefined();
      expect(cache.getCanonicalEntity(normalizedName)).toBeUndefined();
    });

    test('should invalidate document-related caches', () => {
      cache.setResolvedEntity('entity1', 'doc1', { entity: {} });
      cache.setResolvedEntity('entity2', 'doc1', { entity: {} });
      cache.setResolvedEntity('entity1', 'doc2', { entity: {} });

      cache.invalidateDocument('doc1');

      expect(cache.getResolvedEntity('entity1', 'doc1')).toBeUndefined();
      expect(cache.getResolvedEntity('entity2', 'doc1')).toBeUndefined();
      expect(cache.getResolvedEntity('entity1', 'doc2')).toEqual({ entity: {} });
    });

    test('should invalidate similarity cache for entity', () => {
      cache.setSimilarity('id1', 'id2', 0.9);
      cache.setSimilarity('id1', 'id3', 0.8);
      cache.setSimilarity('id2', 'id3', 0.7);

      cache.invalidateSimilarity('id1');

      expect(cache.getSimilarity('id1', 'id2')).toBeUndefined();
      expect(cache.getSimilarity('id1', 'id3')).toBeUndefined();
      expect(cache.getSimilarity('id2', 'id3')).toBe(0.7);
    });
  });

  describe('Cache Clear', () => {
    test('should clear all caches', () => {
      cache.setResolvedEntity('entity', 'doc', { entity: {} });
      cache.setEmbeddings('name', 'type', 'desc', { combinedVector: [] });
      cache.setSimilarity('id1', 'id2', 0.9);
      cache.setCanonicalEntity('canonical', { id: '1' });
      cache.setSimilarEntities('entity', 'type', {}, []);

      cache.clear();

      expect(cache.getResolvedEntity('entity', 'doc')).toBeUndefined();
      expect(cache.getEmbeddings('name', 'type', 'desc')).toBeUndefined();
      expect(cache.getSimilarity('id1', 'id2')).toBeUndefined();
      expect(cache.getCanonicalEntity('canonical')).toBeUndefined();
      expect(cache.getSimilarEntities('entity', 'type', {})).toBeUndefined();
    });
  });

  describe('Cache Statistics', () => {
    test('should return comprehensive statistics', () => {
      cache.setResolvedEntity('e1', 'd1', { entity: {} });
      cache.getResolvedEntity('e1', 'd1'); // hit
      cache.getResolvedEntity('e2', 'd1'); // miss

      const stats = cache.getStats();

      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('caches');
      expect(stats).toHaveProperty('totals');
      expect(stats).toHaveProperty('config');
      expect(stats.caches.resolvedEntities.hits).toBe(1);
      expect(stats.caches.resolvedEntities.misses).toBe(1);
      expect(stats.caches.resolvedEntities.sets).toBe(1);
    });

    test('should calculate correct hit rate', () => {
      for (let i = 0; i < 3; i++) {
        cache.setResolvedEntity(`entity${i}`, 'doc', { entity: {} });
      }
      for (let i = 0; i < 3; i++) {
        cache.getResolvedEntity(`entity${i}`, 'doc'); // 3 hits
      }
      cache.getResolvedEntity('nonexistent', 'doc'); // 1 miss

      const stats = cache.getStats();
      expect(stats.caches.resolvedEntities.hitRate).toBeCloseTo(0.75, 2);
    });

    test('should calculate totals across all caches', () => {
      cache.setResolvedEntity('e1', 'd1', { entity: {} });
      cache.setEmbeddings('n1', 't1', 'd1', { combinedVector: [] });

      const stats = cache.getStats();
      expect(stats.totals.totalSize).toBe(2);
      expect(stats.totals.sets).toBe(2);
    });

    test('should reset statistics', () => {
      cache.setResolvedEntity('e1', 'd1', { entity: {} });
      cache.getResolvedEntity('e1', 'd1');

      cache.resetStats();

      const stats = cache.getStats();
      expect(stats.caches.resolvedEntities.hits).toBe(0);
      expect(stats.caches.resolvedEntities.sets).toBe(0);
      // But cache should still have data
      expect(cache.getResolvedEntity('e1', 'd1')).toBeDefined();
    });
  });

  describe('Health Summary', () => {
    test('should return health summary', () => {
      const health = cache.getHealthSummary();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('overallHitRate');
      expect(health).toHaveProperty('utilization');
      expect(health).toHaveProperty('totalCachedItems');
      expect(health).toHaveProperty('health');
    });

    test('should report healthy status with good hit rate', () => {
      // Add items and access them to build up good hit rate
      for (let i = 0; i < 10; i++) {
        cache.setResolvedEntity(`entity${i}`, 'doc', { entity: {} });
      }
      for (let i = 0; i < 10; i++) {
        cache.getResolvedEntity(`entity${i}`, 'doc'); // 10 hits
      }
      cache.getResolvedEntity('miss1', 'doc'); // 1 miss

      const health = cache.getHealthSummary();
      expect(health.health).toBe('healthy');
    });
  });

  describe('Enable/Disable at Runtime', () => {
    test('should disable caching at runtime', () => {
      cache.setEnabled(false);

      cache.setResolvedEntity('entity', 'doc', { entity: {} });
      expect(cache.getResolvedEntity('entity', 'doc')).toBeUndefined();
    });

    test('should enable caching at runtime', () => {
      cache.setEnabled(false);
      cache.setEnabled(true);

      cache.setResolvedEntity('entity', 'doc', { entity: {} });
      expect(cache.getResolvedEntity('entity', 'doc')).toBeDefined();
    });
  });

  describe('CacheStats Class', () => {
    test('should track all metrics', () => {
      const stats = new CacheStats('test');

      stats.recordHit();
      stats.recordHit();
      stats.recordMiss();
      stats.recordSet();
      stats.recordEviction();
      stats.recordInvalidation();

      const json = stats.toJSON();
      expect(json.hits).toBe(2);
      expect(json.misses).toBe(1);
      expect(json.sets).toBe(1);
      expect(json.evictions).toBe(1);
      expect(json.invalidations).toBe(1);
      expect(json.hitRate).toBeCloseTo(0.667, 2);
    });

    test('should handle zero requests for hit rate', () => {
      const stats = new CacheStats('test');
      expect(stats.hitRate).toBe(0);
    });

    test('should format uptime correctly', () => {
      const stats = new CacheStats('test');
      const json = stats.toJSON();
      expect(json.uptimeFormatted).toMatch(/\d+s|\d+m|\d+h/);
    });

    test('should reset all metrics', () => {
      const stats = new CacheStats('test');
      stats.recordHit();
      stats.recordMiss();

      stats.reset();

      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('Disabled Cache Behavior', () => {
    let disabledCache;

    beforeEach(() => {
      disabledCache = new EntityResolutionCache({ enabled: false });
    });

    test('should not store when disabled', () => {
      disabledCache.setResolvedEntity('entity', 'doc', { entity: {} });
      disabledCache.setEmbeddings('name', 'type', 'desc', { combinedVector: [] });
      disabledCache.setSimilarity('id1', 'id2', 0.9);
      disabledCache.setCanonicalEntity('canonical', { id: '1' });
      disabledCache.setSimilarEntities('entity', 'type', {}, []);

      expect(disabledCache.getResolvedEntity('entity', 'doc')).toBeUndefined();
      expect(disabledCache.getEmbeddings('name', 'type', 'desc')).toBeUndefined();
      expect(disabledCache.getSimilarity('id1', 'id2')).toBeUndefined();
      expect(disabledCache.getCanonicalEntity('canonical')).toBeUndefined();
      expect(disabledCache.getSimilarEntities('entity', 'type', {})).toBeUndefined();
    });

    test('should not track stats when disabled', () => {
      disabledCache.setResolvedEntity('entity', 'doc', { entity: {} });
      disabledCache.getResolvedEntity('entity', 'doc');

      const stats = disabledCache.getStats();
      expect(stats.totals.hits).toBe(0);
      expect(stats.totals.sets).toBe(0);
    });
  });
});

describe('CONFIG', () => {
  test('should have default values', () => {
    expect(CONFIG.RESOLVED_ENTITIES_MAX).toBeGreaterThan(0);
    expect(CONFIG.EMBEDDINGS_MAX).toBeGreaterThan(0);
    expect(CONFIG.SIMILARITY_MAX).toBeGreaterThan(0);
    expect(CONFIG.CANONICAL_MAX).toBeGreaterThan(0);
    expect(CONFIG.SIMILAR_ENTITIES_MAX).toBeGreaterThan(0);
    expect(CONFIG.ENABLED).toBe(true);
  });

  test('should have reasonable TTL values', () => {
    expect(CONFIG.RESOLVED_ENTITIES_TTL).toBeGreaterThan(0);
    expect(CONFIG.EMBEDDINGS_TTL).toBeGreaterThan(0);
    expect(CONFIG.SIMILARITY_TTL).toBeGreaterThan(0);
    expect(CONFIG.CANONICAL_TTL).toBeGreaterThan(0);
    expect(CONFIG.SIMILAR_ENTITIES_TTL).toBeGreaterThan(0);
  });
});
