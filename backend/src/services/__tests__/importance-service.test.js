/**
 * Tests for Entity Importance Service
 *
 * Feature: F3.2.4 - Importance Field on Entities
 */

const {
  calculateImportance,
  getTopEntitiesByImportance,
  getEntityImportance,
  DEFAULT_WEIGHTS,
  DEFAULT_CONFIG,
} = require('../importance-service');

// Mock the algorithms
jest.mock('../../algorithms/pagerank', () => ({
  calculatePageRank: jest.fn(),
}));

jest.mock('../../algorithms/betweenness', () => ({
  calculateBetweenness: jest.fn(),
}));

// Mock the graph service
jest.mock('../graph-service', () => ({
  getGraphService: jest.fn(),
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    errorWithStack: jest.fn(),
  },
}));

const { calculatePageRank } = require('../../algorithms/pagerank');
const { calculateBetweenness } = require('../../algorithms/betweenness');
const { getGraphService } = require('../graph-service');

describe('Importance Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateImportance', () => {
    it('should return empty results for empty graph', async () => {
      calculatePageRank.mockResolvedValue({
        scores: {},
        rankedEntities: [],
        metadata: { nodeCount: 0 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: {},
        rankedEntities: [],
        metadata: { nodeCount: 0 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
      });

      const result = await calculateImportance();

      expect(result.scores).toEqual({});
      expect(result.rankedEntities).toEqual([]);
      expect(result.metadata.nodeCount).toBe(0);
    });

    it('should calculate composite importance from multiple metrics', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process', mentionCount: 10 },
        { id: 'b', name: 'Node B', type: 'Task', mentionCount: 5 },
        { id: 'c', name: 'Node C', type: 'System', mentionCount: 1 },
      ];

      calculatePageRank.mockResolvedValue({
        scores: { a: 0.5, b: 0.3, c: 0.2 },
        rankedEntities: [],
        metadata: { nodeCount: 3 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.1, b: 0.6, c: 0.3 },
        rankedEntities: [],
        metadata: { nodeCount: 3 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      const result = await calculateImportance();

      expect(Object.keys(result.scores)).toHaveLength(3);
      expect(result.rankedEntities).toHaveLength(3);
      expect(result.metadata.nodeCount).toBe(3);

      // All scores should be between 0 and 1 when normalized
      for (const score of Object.values(result.scores)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });

    it('should rank entities correctly based on composite score', async () => {
      const nodes = [
        { id: 'low', name: 'Low Importance', type: 'Task', mentionCount: 1 },
        { id: 'medium', name: 'Medium Importance', type: 'Process', mentionCount: 5 },
        { id: 'high', name: 'High Importance', type: 'System', mentionCount: 10 },
      ];

      // High has best PageRank, best mention count
      calculatePageRank.mockResolvedValue({
        scores: { low: 0.1, medium: 0.3, high: 0.6 },
        rankedEntities: [],
        metadata: { nodeCount: 3 },
      });
      // Medium has best betweenness
      calculateBetweenness.mockResolvedValue({
        scores: { low: 0.1, medium: 0.5, high: 0.4 },
        rankedEntities: [],
        metadata: { nodeCount: 3 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      const result = await calculateImportance();

      // Check that entities are ranked by importance
      expect(result.rankedEntities[0].importance).toBeGreaterThan(result.rankedEntities[1].importance);
      expect(result.rankedEntities[1].importance).toBeGreaterThan(result.rankedEntities[2].importance);

      // Check that rank and percentile are set
      expect(result.rankedEntities[0].rank).toBe(1);
      expect(result.rankedEntities[1].rank).toBe(2);
      expect(result.rankedEntities[2].rank).toBe(3);
    });

    it('should include component scores for transparency', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process', mentionCount: 5 },
      ];

      calculatePageRank.mockResolvedValue({
        scores: { a: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 1 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.3 },
        rankedEntities: [],
        metadata: { nodeCount: 1 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      const result = await calculateImportance();

      const entity = result.rankedEntities[0];
      expect(entity.components).toBeDefined();
      expect(entity.components.pageRank).toBeDefined();
      expect(entity.components.betweenness).toBeDefined();
      expect(entity.components.mentionFrequency).toBeDefined();
    });

    it('should handle custom weights', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process', mentionCount: 1 },
        { id: 'b', name: 'Node B', type: 'Task', mentionCount: 10 },
      ];

      // B has much higher mention count but lower PageRank
      calculatePageRank.mockResolvedValue({
        scores: { a: 0.8, b: 0.2 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.5, b: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      // With high mention weight, B should rank higher
      const result = await calculateImportance({
        weights: {
          pageRank: 0.1,
          betweenness: 0.1,
          mentionFrequency: 0.8,
        },
      });

      // B should be ranked higher due to mention frequency weight
      expect(result.rankedEntities[0].id).toBe('b');
    });

    it('should handle missing mentionCount gracefully', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' }, // No mentionCount
        { id: 'b', name: 'Node B', type: 'Task', mentionCount: 5 },
      ];

      calculatePageRank.mockResolvedValue({
        scores: { a: 0.5, b: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.5, b: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      // Should not throw
      const result = await calculateImportance();
      expect(result.rankedEntities).toHaveLength(2);

      // Entity without mentionCount should default to 1
      const entityA = result.rankedEntities.find((e) => e.id === 'a');
      expect(entityA.mentionCount).toBe(1);
    });
  });

  describe('getTopEntitiesByImportance', () => {
    it('should return top N entities', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process', mentionCount: 1 },
        { id: 'b', name: 'Node B', type: 'Task', mentionCount: 2 },
        { id: 'c', name: 'Node C', type: 'System', mentionCount: 3 },
        { id: 'd', name: 'Node D', type: 'Role', mentionCount: 4 },
        { id: 'e', name: 'Node E', type: 'Task', mentionCount: 5 },
      ];

      calculatePageRank.mockResolvedValue({
        scores: { a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 5 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 5 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      const topEntities = await getTopEntitiesByImportance(3);

      expect(topEntities).toHaveLength(3);
      expect(topEntities[0].importance).toBeGreaterThan(topEntities[1].importance);
      expect(topEntities[1].importance).toBeGreaterThan(topEntities[2].importance);
    });

    it('should return all entities if N is greater than total', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];

      calculatePageRank.mockResolvedValue({
        scores: { a: 0.5, b: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.5, b: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      const topEntities = await getTopEntitiesByImportance(10);

      expect(topEntities).toHaveLength(2);
    });
  });

  describe('getEntityImportance', () => {
    it('should return importance for a specific entity', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process', mentionCount: 5 },
        { id: 'b', name: 'Node B', type: 'Task', mentionCount: 3 },
      ];

      calculatePageRank.mockResolvedValue({
        scores: { a: 0.6, b: 0.4 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.5, b: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 2 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      const entityImportance = await getEntityImportance('a');

      expect(entityImportance).not.toBeNull();
      expect(entityImportance.id).toBe('a');
      expect(entityImportance.importance).toBeDefined();
      expect(entityImportance.rank).toBeDefined();
      expect(entityImportance.components).toBeDefined();
    });

    it('should return null for non-existent entity', async () => {
      const nodes = [{ id: 'a', name: 'Node A', type: 'Process' }];

      calculatePageRank.mockResolvedValue({
        scores: { a: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 1 },
      });
      calculateBetweenness.mockResolvedValue({
        scores: { a: 0.5 },
        rankedEntities: [],
        metadata: { nodeCount: 1 },
      });
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges: [] }),
      });

      const entityImportance = await getEntityImportance('nonexistent');

      expect(entityImportance).toBeNull();
    });
  });

  describe('DEFAULT_WEIGHTS', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_WEIGHTS.pageRank).toBe(0.4);
      expect(DEFAULT_WEIGHTS.betweenness).toBe(0.35);
      expect(DEFAULT_WEIGHTS.mentionFrequency).toBe(0.25);
    });

    it('should sum to 1.0', () => {
      const sum = DEFAULT_WEIGHTS.pageRank +
                  DEFAULT_WEIGHTS.betweenness +
                  DEFAULT_WEIGHTS.mentionFrequency;
      expect(sum).toBe(1.0);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.weights).toEqual(DEFAULT_WEIGHTS);
      expect(DEFAULT_CONFIG.normalizeOutput).toBe(true);
    });
  });
});
