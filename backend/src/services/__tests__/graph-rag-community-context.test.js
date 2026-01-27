/**
 * Tests for Community Context in GraphRAG
 *
 * Feature: F3.1.5 - Community Context in GraphRAG
 *
 * Tests the integration of community summaries into the GraphRAG
 * query context for improved global question answering.
 */

const { GraphRAGService, CONFIG } = require('../graph-rag-service');

// Mock all dependencies
jest.mock('../graph-service', () => ({
  getGraphService: jest.fn(),
  normalizeEntityName: jest.fn((name) => name?.toLowerCase() || ''),
}));

jest.mock('../search-service', () => ({
  getSearchService: jest.fn(),
}));

jest.mock('../openai-service', () => ({
  getOpenAIService: jest.fn(),
}));

jest.mock('../entity-resolution-service', () => ({
  getEntityResolutionService: jest.fn(),
}));

jest.mock('../community-summary-service', () => ({
  getCommunitySummaryService: jest.fn(),
}));

jest.mock('../importance-service', () => ({
  getImportanceWithCache: jest.fn(),
  calculateImportance: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    errorWithStack: jest.fn(),
  },
}));

const { getGraphService, normalizeEntityName } = require('../graph-service');
const { getSearchService } = require('../search-service');
const { getOpenAIService } = require('../openai-service');
const { getEntityResolutionService } = require('../entity-resolution-service');
const { getCommunitySummaryService } = require('../community-summary-service');
const { getImportanceWithCache } = require('../importance-service');

describe('GraphRAG Community Context (F3.1.5)', () => {
  let service;
  let mockGraphService;
  let mockSearchService;
  let mockOpenAIService;
  let mockEntityResolution;
  let mockCommunitySummary;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock graph service
    mockGraphService = {
      findVertexByName: jest.fn(),
      _submit: jest.fn().mockResolvedValue([]),
      _normalizeVertex: jest.fn((v) => v),
    };
    getGraphService.mockReturnValue(mockGraphService);

    // Setup mock search service
    mockSearchService = {
      hybridSearch: jest.fn().mockResolvedValue({ results: [] }),
      vectorSearch: jest.fn().mockResolvedValue({ results: [] }),
    };
    getSearchService.mockReturnValue(mockSearchService);

    // Setup mock OpenAI service
    mockOpenAIService = {
      getJsonCompletion: jest.fn().mockResolvedValue({
        content: { entities: [] },
      }),
      getChatCompletion: jest.fn().mockResolvedValue({
        content: 'Test summary',
      }),
      getEmbedding: jest.fn().mockResolvedValue({
        embedding: new Array(1536).fill(0),
      }),
    };
    getOpenAIService.mockReturnValue(mockOpenAIService);

    // Setup mock entity resolution service
    mockEntityResolution = {
      getCanonicalEntity: jest.fn().mockResolvedValue(null),
      findSimilarEntities: jest.fn().mockResolvedValue([]),
      getRelatedEntities: jest.fn().mockResolvedValue({ related: [] }),
    };
    getEntityResolutionService.mockReturnValue(mockEntityResolution);

    // Setup mock community summary service
    mockCommunitySummary = {
      getAllCachedSummaries: jest.fn().mockReturnValue({}),
      getCommunitySummary: jest.fn(),
      generateAllSummaries: jest.fn(),
      generateSummariesForSubgraph: jest.fn(),
      globalQuery: jest.fn(),
    };
    getCommunitySummaryService.mockReturnValue(mockCommunitySummary);

    // Setup mock importance service
    getImportanceWithCache.mockResolvedValue({
      scores: {},
    });

    // Create fresh service instance
    service = new GraphRAGService();
  });

  describe('CONFIG', () => {
    it('should have community context settings (F3.1.5)', () => {
      expect(CONFIG.INCLUDE_COMMUNITY_CONTEXT).toBe(true);
      expect(CONFIG.COMMUNITY_CONTEXT_WEIGHT).toBe(0.2);
      expect(CONFIG.MAX_COMMUNITY_SUMMARIES).toBe(3);
    });
  });

  describe('_buildCommunityContext', () => {
    const mockExpandedGraph = {
      entities: [
        { name: 'Process A', type: 'Process' },
        { name: 'Task B', type: 'Task' },
        { name: 'System C', type: 'System' },
      ],
      relationships: [
        { from: 'Process A', to: 'Task B', type: 'CONTAINS' },
        { from: 'Task B', to: 'System C', type: 'USES' },
      ],
    };

    const mockCommunities = [
      {
        id: 'community_0',
        members: ['Process A', 'Task B'],
        size: 2,
      },
    ];

    it('should include cached community summaries when available', async () => {
      const cachedSummaries = {
        'louvain_1': {
          title: 'Process Management Community',
          summary: 'This community covers process management and tasks.',
          keyEntities: ['Process A', 'Task B'],
          memberCount: 5,
        },
      };
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue(cachedSummaries);

      const context = await service._buildCommunityContext(
        mockCommunities,
        mockExpandedGraph
      );

      expect(context).toContain('Process Management Community');
      expect(context).toContain('process management and tasks');
    });

    it('should prioritize cached summaries with relevant entities', async () => {
      const cachedSummaries = {
        'relevant_community': {
          title: 'Relevant Community',
          summary: 'Contains Process A related content.',
          keyEntities: ['Process A', 'Other Entity'],
          memberCount: 3,
        },
        'irrelevant_community': {
          title: 'Irrelevant Community',
          summary: 'Unrelated content.',
          keyEntities: ['Unrelated Entity X', 'Unrelated Entity Y'],
          memberCount: 10,
        },
      };
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue(cachedSummaries);

      const context = await service._buildCommunityContext(
        mockCommunities,
        mockExpandedGraph
      );

      // Should include the relevant community
      expect(context).toContain('Relevant Community');
      // Should not include irrelevant community
      expect(context).not.toContain('Irrelevant Community');
    });

    it('should fall back to on-demand generation when no cached summaries', async () => {
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue({});
      mockOpenAIService.getChatCompletion.mockResolvedValue({
        content: 'Generated summary for community',
      });

      const context = await service._buildCommunityContext(
        mockCommunities,
        mockExpandedGraph
      );

      expect(context).toContain('community_0');
      expect(mockOpenAIService.getChatCompletion).toHaveBeenCalled();
    });

    it('should use lazy subgraph summaries when enabled (F6.2.2)', async () => {
      mockCommunitySummary.generateSummariesForSubgraph.mockResolvedValue({
        summaries: {
          0: {
            title: 'Lazy Community',
            summary: 'Lazy summary for subgraph.',
            memberCount: 2,
          },
        },
        communities: [
          { id: 0, size: 2, members: [{ name: 'Process A' }, { name: 'Task B' }] },
        ],
        metadata: { mode: 'lazy' },
      });

      const context = await service._buildCommunityContext(
        mockCommunities,
        mockExpandedGraph,
        { lazySummaries: true }
      );

      expect(mockCommunitySummary.generateSummariesForSubgraph).toHaveBeenCalled();
      expect(context).toContain('Lazy Community');
    });

    it('should respect maxSummaries option', async () => {
      const cachedSummaries = {
        'community_1': {
          title: 'Community 1',
          summary: 'Summary 1',
          keyEntities: ['Process A'],
          memberCount: 5,
        },
        'community_2': {
          title: 'Community 2',
          summary: 'Summary 2',
          keyEntities: ['Task B'],
          memberCount: 4,
        },
        'community_3': {
          title: 'Community 3',
          summary: 'Summary 3',
          keyEntities: ['System C'],
          memberCount: 3,
        },
      };
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue(cachedSummaries);

      const context = await service._buildCommunityContext(
        mockCommunities,
        mockExpandedGraph,
        { maxSummaries: 1 }
      );

      // Should only include 1 summary
      const summaryCount = (context.match(/###/g) || []).length;
      expect(summaryCount).toBeLessThanOrEqual(1);
    });

    it('should handle empty communities gracefully', async () => {
      const context = await service._buildCommunityContext(
        [],
        mockExpandedGraph
      );

      expect(context).toBe('');
    });
  });

  describe('_assembleContext', () => {
    const mockExpandedGraph = {
      entities: [{ name: 'Test Entity', type: 'Process', importance: 0.8 }],
      relationships: [{ from: 'Test Entity', to: 'Other', type: 'RELATED' }],
    };
    const mockChunks = [{ content: 'Test content', sourceFile: 'test.pdf' }];
    const mockCommunities = [{ id: 'c1', members: ['Test Entity'], size: 1 }];

    it('should include community context by default (F3.1.5)', async () => {
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue({
        'cached_community': {
          title: 'Test Community',
          summary: 'Community summary for testing.',
          keyEntities: ['Test Entity'],
          memberCount: 3,
        },
      });

      const context = await service._assembleContext(
        'test query',
        mockExpandedGraph,
        mockChunks,
        mockCommunities,
        {} // No explicit includeCommunityContext option
      );

      expect(context).toContain('Knowledge Community Insights');
      expect(context).toContain('Test Community');
    });

    it('should allow disabling community context via option', async () => {
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue({
        'cached_community': {
          title: 'Test Community',
          summary: 'Community summary.',
          keyEntities: ['Test Entity'],
          memberCount: 3,
        },
      });

      const context = await service._assembleContext(
        'test query',
        mockExpandedGraph,
        mockChunks,
        mockCommunities,
        { includeCommunityContext: false }
      );

      expect(context).not.toContain('Knowledge Community Insights');
    });

    it('should include all context sections', async () => {
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue({});

      const context = await service._assembleContext(
        'test query',
        mockExpandedGraph,
        mockChunks,
        mockCommunities
      );

      expect(context).toContain('## Relevant Entities');
      expect(context).toContain('## Relationships');
      expect(context).toContain('## Source Documents');
    });
  });

  describe('query metadata', () => {
    it('should include communityContext metadata (F3.1.5)', async () => {
      // Setup minimal mocks for query
      mockOpenAIService.getJsonCompletion.mockResolvedValue({
        content: { entities: [{ name: 'Test', type: 'Process' }] },
      });
      mockEntityResolution.getCanonicalEntity.mockResolvedValue({
        name: 'Test Entity',
        type: 'Process',
      });
      mockCommunitySummary.getAllCachedSummaries.mockReturnValue({
        'test_community': { title: 'Test', summary: 'Summary', keyEntities: ['Test Entity'] },
      });

      const result = await service.query('What is Test Entity?');

      expect(result.metadata.communityContext).toBeDefined();
      expect(result.metadata.communityContext.enabled).toBe(true);
      expect(result.metadata.communityContext.cachedSummariesAvailable).toBeDefined();
      expect(result.metadata.communityContext.maxSummariesIncluded).toBe(CONFIG.MAX_COMMUNITY_SUMMARIES);
    });
  });
});
