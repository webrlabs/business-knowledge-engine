/**
 * Tests for PageRank Algorithm
 *
 * Feature: F3.2.1 - PageRank Algorithm
 */

const {
  calculatePageRank,
  getTopEntitiesByPageRank,
  getEntityPageRank,
  DEFAULT_CONFIG,
} = require('../pagerank');

// Mock the graph service
jest.mock('../../services/graph-service', () => ({
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

const { getGraphService } = require('../../services/graph-service');

describe('PageRank Algorithm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculatePageRank', () => {
    it('should return empty results for empty graph', async () => {
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
      });

      const result = await calculatePageRank();

      expect(result.scores).toEqual({});
      expect(result.rankedEntities).toEqual([]);
      expect(result.metadata.nodeCount).toBe(0);
      expect(result.metadata.edgeCount).toBe(0);
      expect(result.metadata.converged).toBe(true);
    });

    it('should calculate PageRank for a simple graph', async () => {
      // Simple graph: A -> B -> C
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculatePageRank();

      expect(Object.keys(result.scores)).toHaveLength(3);
      expect(result.rankedEntities).toHaveLength(3);
      expect(result.metadata.nodeCount).toBe(3);
      expect(result.metadata.edgeCount).toBe(2);
      expect(result.metadata.converged).toBe(true);

      // In a linear chain, the last node (c) should have highest PageRank
      // because it receives PR from b, which receives PR from a
      expect(result.rankedEntities[0].id).toBe('c');
    });

    it('should calculate PageRank for a cyclic graph', async () => {
      // Cyclic graph: A -> B -> C -> A
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculatePageRank();

      expect(result.metadata.converged).toBe(true);

      // All scores should be nearly equal in a cycle
      const scores = Object.values(result.scores);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      scores.forEach((score) => {
        expect(Math.abs(score - avgScore)).toBeLessThan(0.01);
      });
    });

    it('should handle hub and authority pattern', async () => {
      // Hub pattern: A points to many nodes
      const nodes = [
        { id: 'hub', name: 'Hub', type: 'Process' },
        { id: 'a', name: 'Node A', type: 'Task' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'Task' },
        { id: 'authority', name: 'Authority', type: 'System' },
      ];
      const edges = [
        { source: 'hub', target: 'a' },
        { source: 'hub', target: 'b' },
        { source: 'hub', target: 'c' },
        { source: 'a', target: 'authority' },
        { source: 'b', target: 'authority' },
        { source: 'c', target: 'authority' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculatePageRank();

      // Authority should have highest score (many incoming links)
      expect(result.rankedEntities[0].id).toBe('authority');
    });

    it('should respect custom damping factor', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];
      const edges = [{ source: 'a', target: 'b' }];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result1 = await calculatePageRank({ dampingFactor: 0.5 });
      const result2 = await calculatePageRank({ dampingFactor: 0.95 });

      // Different damping factors should produce different scores
      expect(result1.scores.b).not.toBe(result2.scores.b);
      expect(result1.metadata.dampingFactor).toBe(0.5);
      expect(result2.metadata.dampingFactor).toBe(0.95);
    });

    it('should handle disconnected nodes', async () => {
      // Node C is disconnected
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C (Disconnected)', type: 'System' },
      ];
      const edges = [{ source: 'a', target: 'b' }];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculatePageRank();

      // All nodes should have scores
      expect(result.scores.a).toBeDefined();
      expect(result.scores.b).toBeDefined();
      expect(result.scores.c).toBeDefined();

      // Disconnected node should have minimum score (only from teleportation)
      const minScore = (1 - DEFAULT_CONFIG.dampingFactor) / 3;
      expect(result.scores.c).toBeCloseTo(minScore, 4);
    });

    it('should converge within max iterations', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];
      const edges = [{ source: 'a', target: 'b' }];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculatePageRank({ maxIterations: 5 });

      expect(result.metadata.iterations).toBeLessThanOrEqual(5);
    });
  });

  describe('getTopEntitiesByPageRank', () => {
    it('should return top N entities', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
        { id: 'd', name: 'Node D', type: 'Role' },
        { id: 'e', name: 'Node E', type: 'Task' },
      ];
      const edges = [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
        { source: 'd', target: 'c' },
        { source: 'e', target: 'c' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const topEntities = await getTopEntitiesByPageRank(3);

      expect(topEntities).toHaveLength(3);
      expect(topEntities[0].id).toBe('c'); // Most linked-to entity
      expect(topEntities[0].pageRank).toBeGreaterThan(topEntities[1].pageRank);
    });

    it('should return all entities if N is greater than total', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];
      const edges = [];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const topEntities = await getTopEntitiesByPageRank(10);

      expect(topEntities).toHaveLength(2);
    });
  });

  describe('getEntityPageRank', () => {
    it('should return PageRank for a specific entity with rank', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
      ];
      const edges = [
        { source: 'a', target: 'c' },
        { source: 'b', target: 'c' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const entityRank = await getEntityPageRank('c');

      expect(entityRank).not.toBeNull();
      expect(entityRank.id).toBe('c');
      expect(entityRank.pageRank).toBeDefined();
      expect(entityRank.rank).toBe(1); // Should be rank 1 (highest)
      expect(entityRank.percentile).toBeGreaterThan(0);
    });

    it('should return null for non-existent entity', async () => {
      const nodes = [{ id: 'a', name: 'Node A', type: 'Process' }];
      const edges = [];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const entityRank = await getEntityPageRank('nonexistent');

      expect(entityRank).toBeNull();
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.dampingFactor).toBe(0.85);
      expect(DEFAULT_CONFIG.maxIterations).toBe(100);
      expect(DEFAULT_CONFIG.convergenceThreshold).toBe(1e-6);
      expect(DEFAULT_CONFIG.defaultScore).toBe(1.0);
    });
  });
});
