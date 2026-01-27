/**
 * Unit Tests for Community Summary Service
 *
 * Feature: F3.1.3 - Community Summary Generation
 */

const { CommunitySummaryService, CONFIG } = require('../community-summary-service');

// Mock dependencies
jest.mock('../../algorithms/louvain', () => ({
  detectCommunities: jest.fn(),
  detectSubgraphCommunities: jest.fn(),
}));

jest.mock('../graph-service', () => ({
  getGraphService: jest.fn(() => ({
    getAllEntities: jest.fn().mockResolvedValue({
      nodes: [
        { id: 'n1', name: 'Process A', type: 'Process' },
        { id: 'n2', name: 'Task B', type: 'Task' },
        { id: 'n3', name: 'System C', type: 'System' },
      ],
      edges: [
        { source: 'n1', target: 'n2', label: 'CONTAINS' },
        { source: 'n2', target: 'n3', label: 'USES' },
      ],
    }),
  })),
}));

jest.mock('../openai-service', () => ({
  getOpenAIService: jest.fn(() => ({
    getChatCompletion: jest.fn().mockResolvedValue({
      content: 'This is a test summary.',
    }),
    getJsonCompletion: jest.fn().mockResolvedValue({
      content: {
        title: 'Test Community Title',
        summary: 'This community contains business processes and related tasks.',
      },
    }),
  })),
}));

const { detectCommunities, detectSubgraphCommunities } = require('../../algorithms/louvain');

describe('CommunitySummaryService', () => {
  let service;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Setup default community detection response
    detectCommunities.mockResolvedValue({
      communities: { n1: 0, n2: 0, n3: 1 },
      communityList: [
        {
          id: 0,
          size: 2,
          members: [
            { id: 'n1', name: 'Process A', type: 'Process' },
            { id: 'n2', name: 'Task B', type: 'Task' },
          ],
          typeCounts: { Process: 1, Task: 1 },
          dominantType: 'Process',
        },
        {
          id: 1,
          size: 1,
          members: [{ id: 'n3', name: 'System C', type: 'System' }],
          typeCounts: { System: 1 },
          dominantType: 'System',
        },
      ],
      modularity: 0.45,
      metadata: {
        nodeCount: 3,
        edgeCount: 2,
        communityCount: 2,
        hierarchyLevels: 1,
        resolution: 1.0,
        executionTimeMs: 100,
      },
    });

    detectSubgraphCommunities.mockResolvedValue({
      communities: { n1: 0, n2: 0, n3: 1 },
      communityList: [
        {
          id: 0,
          size: 2,
          members: [
            { id: 'n1', name: 'Process A', type: 'Process' },
            { id: 'n2', name: 'Task B', type: 'Task' },
          ],
          typeCounts: { Process: 1, Task: 1 },
          dominantType: 'Process',
        },
      ],
      modularity: 0.42,
      metadata: {
        nodeCount: 2,
        edgeCount: 1,
        communityCount: 1,
        hierarchyLevels: 1,
        resolution: 1.0,
        executionTimeMs: 50,
      },
    });

    // Create new service instance for each test
    service = new CommunitySummaryService();
  });

  describe('generateAllSummaries', () => {
    it('should generate summaries for all eligible communities', async () => {
      const result = await service.generateAllSummaries();

      expect(detectCommunities).toHaveBeenCalled();
      expect(result).toHaveProperty('summaries');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('summarizedCount');
    });

    it('should filter communities by minimum size', async () => {
      const result = await service.generateAllSummaries({ minCommunitySize: 2 });

      // Only community 0 has size >= 2
      expect(result.metadata.summarizedCount).toBe(1);
      expect(result.metadata.skippedCount).toBe(1);
    });

    it('should cache generated summaries', async () => {
      await service.generateAllSummaries();

      // Second call should use cache
      const cached = service.getAllCachedSummaries();
      expect(Object.keys(cached).length).toBeGreaterThan(0);
    });
  });

  describe('getCommunitySummary', () => {
    it('should return summary for a specific community', async () => {
      const summary = await service.getCommunitySummary(0);

      expect(summary).toHaveProperty('communityId');
      expect(summary).toHaveProperty('title');
      expect(summary).toHaveProperty('summary');
    });

    it('should return null for non-existent community', async () => {
      detectCommunities.mockResolvedValue({
        communities: {},
        communityList: [],
        modularity: 0,
        metadata: {},
      });

      const summary = await service.getCommunitySummary(999);
      expect(summary).toBeNull();
    });

    it('should return cached summary if available', async () => {
      // First call generates summary
      await service.getCommunitySummary(0);

      // Second call should return cached
      const summary = await service.getCommunitySummary(0);

      expect(summary).toHaveProperty('title');
    });
  });

  describe('mapCommunitiesToPartialAnswers', () => {
    it('should generate partial answers for communities', async () => {
      // First generate summaries
      await service.generateAllSummaries();

      const result = await service.mapCommunitiesToPartialAnswers('What processes exist?');

      expect(result).toHaveProperty('partialAnswers');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata.communitiesProcessed).toBeGreaterThan(0);
    });
  });

  describe('generateSummariesForSubgraph', () => {
    it('should generate summaries for subgraph communities with caching', async () => {
      const entities = [
        { id: 'n1', name: 'Process A', type: 'Process' },
        { id: 'n2', name: 'Task B', type: 'Task' },
      ];
      const relationships = [
        { from: 'Process A', to: 'Task B', type: 'CONTAINS' },
      ];

      const result = await service.generateSummariesForSubgraph(entities, relationships);

      expect(detectSubgraphCommunities).toHaveBeenCalled();
      expect(result.metadata.mode).toBe('lazy');
      expect(Object.keys(result.summaries).length).toBeGreaterThan(0);

      // Lazy summaries SHOULD populate the shared cache now (F6.2.3)
      const cached = service.getAllCachedSummaries();
      expect(Object.keys(cached).length).toBeGreaterThan(0);
      
      // Verify stable ID format
      const cacheKey = Object.keys(cached)[0];
      expect(cacheKey).toMatch(/^comm_/);
    });
  });

  describe('reducePartialAnswers', () => {
    it('should synthesize partial answers into final answer', async () => {
      const partialAnswers = [
        {
          communityId: 0,
          communityName: 'Process Community',
          partialAnswer: 'This community contains Process A and Task B.',
          relevanceScore: 0.8,
        },
      ];

      const result = await service.reducePartialAnswers(
        'What processes exist?',
        partialAnswers
      );

      expect(result).toHaveProperty('answer');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('confidence');
    });

    it('should handle empty partial answers', async () => {
      const result = await service.reducePartialAnswers('Test query', []);

      expect(result.answer).toContain('No relevant');
      expect(result.confidence).toBe(0);
    });
  });

  describe('globalQuery', () => {
    it('should perform map-reduce pipeline', async () => {
      const result = await service.globalQuery('What processes exist in the system?');

      expect(result).toHaveProperty('answer');
      expect(result).toHaveProperty('sources');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('totalTimeMs');
    });
  });

  describe('SummaryCache', () => {
    it('should cache and retrieve summaries', async () => {
      const testSummary = {
        communityId: 0,
        title: 'Test',
        summary: 'Test summary',
      };

      service.cache.set('0', testSummary);
      const retrieved = service.cache.get('0');

      expect(retrieved).toEqual(testSummary);
    });

    it('should return null for expired entries', async () => {
      // Create cache with very short TTL
      service.cache.ttlMs = 1;

      service.cache.set('0', { title: 'Test' });

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 10));

      const retrieved = service.cache.get('0');
      expect(retrieved).toBeNull();
    });

    it('should evict old entries when at capacity', async () => {
      service.cache.maxSize = 2;

      service.cache.set('0', { title: 'First' });
      service.cache.set('1', { title: 'Second' });
      service.cache.set('2', { title: 'Third' }); // Should evict '0'

      expect(service.cache.get('0')).toBeNull();
      expect(service.cache.get('1')).not.toBeNull();
      expect(service.cache.get('2')).not.toBeNull();
    });

    it('should report correct stats', () => {
      service.cache.set('0', { title: 'Test' });

      const stats = service.cache.getStats();

      expect(stats.totalEntries).toBe(1);
      expect(stats.validEntries).toBe(1);
      expect(stats.expiredEntries).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return service status', async () => {
      await service.generateAllSummaries();

      const status = service.getStatus();

      expect(status).toHaveProperty('lastFullGeneration');
      expect(status).toHaveProperty('lastModularity');
      expect(status).toHaveProperty('lastCommunityCount');
      expect(status).toHaveProperty('cacheStats');
    });
  });

  describe('clearCache', () => {
    it('should clear all cached summaries', async () => {
      service.cache.set('0', { title: 'Test' });

      service.clearCache();

      const cached = service.getAllCachedSummaries();
      expect(Object.keys(cached).length).toBe(0);
    });
  });
});

describe('CONFIG', () => {
  it('should have sensible defaults', () => {
    expect(CONFIG.CACHE_TTL_MS).toBeGreaterThan(0);
    expect(CONFIG.MAX_CACHED_SUMMARIES).toBeGreaterThan(0);
    expect(CONFIG.MIN_COMMUNITY_SIZE_FOR_SUMMARY).toBeGreaterThan(0);
    expect(CONFIG.BATCH_SIZE).toBeGreaterThan(0);
  });
});
