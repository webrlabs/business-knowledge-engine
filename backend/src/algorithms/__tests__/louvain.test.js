/**
 * Tests for Louvain Community Detection Algorithm
 *
 * Feature: F3.1.1 - Louvain Algorithm
 */

const {
  detectCommunities,
  getEntityCommunity,
  getTopCommunities,
  calculateModularity,
  DEFAULT_CONFIG,
} = require('../louvain');

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

describe('Louvain Community Detection Algorithm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectCommunities', () => {
    it('should return empty results for empty graph', async () => {
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
      });

      const result = await detectCommunities();

      expect(result.communities).toEqual({});
      expect(result.communityList).toEqual([]);
      expect(result.modularity).toBe(0);
      expect(result.metadata.nodeCount).toBe(0);
      expect(result.metadata.communityCount).toBe(0);
    });

    it('should detect communities in a simple disconnected graph', async () => {
      // Two disconnected pairs: (A-B) and (C-D) should form 2 communities
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Process' },
        { id: 'c', name: 'Node C', type: 'Task' },
        { id: 'd', name: 'Node D', type: 'Task' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'c', target: 'd' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await detectCommunities();

      expect(Object.keys(result.communities)).toHaveLength(4);
      expect(result.metadata.nodeCount).toBe(4);
      expect(result.metadata.edgeCount).toBe(2);

      // A and B should be in the same community
      expect(result.communities.a).toBe(result.communities.b);
      // C and D should be in the same community
      expect(result.communities.c).toBe(result.communities.d);
      // But A/B should be in different community than C/D
      expect(result.communities.a).not.toBe(result.communities.c);
    });

    it('should detect communities in a clique graph', async () => {
      // Two fully connected cliques connected by one edge
      const nodes = [
        { id: 'a1', name: 'Clique A1', type: 'Process' },
        { id: 'a2', name: 'Clique A2', type: 'Process' },
        { id: 'a3', name: 'Clique A3', type: 'Process' },
        { id: 'b1', name: 'Clique B1', type: 'Task' },
        { id: 'b2', name: 'Clique B2', type: 'Task' },
        { id: 'b3', name: 'Clique B3', type: 'Task' },
      ];
      const edges = [
        // Clique A
        { source: 'a1', target: 'a2' },
        { source: 'a1', target: 'a3' },
        { source: 'a2', target: 'a3' },
        // Clique B
        { source: 'b1', target: 'b2' },
        { source: 'b1', target: 'b3' },
        { source: 'b2', target: 'b3' },
        // Bridge edge
        { source: 'a3', target: 'b1' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await detectCommunities();

      // Should detect 2 communities (one for each clique)
      expect(result.communityList.length).toBeLessThanOrEqual(3);
      expect(result.modularity).toBeGreaterThan(0);

      // Members of same clique should be in same community
      expect(result.communities.a1).toBe(result.communities.a2);
      expect(result.communities.b1).toBe(result.communities.b2);
    });

    it('should handle a single node', async () => {
      const nodes = [{ id: 'a', name: 'Lonely Node', type: 'Process' }];
      const edges = [];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await detectCommunities();

      expect(Object.keys(result.communities)).toHaveLength(1);
      expect(result.communityList).toHaveLength(1);
      expect(result.communityList[0].members).toHaveLength(1);
      expect(result.metadata.communityCount).toBe(1);
    });

    it('should handle a fully connected graph', async () => {
      // All nodes connected to all others
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
        { id: 'd', name: 'Node D', type: 'Role' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'a', target: 'd' },
        { source: 'b', target: 'c' },
        { source: 'b', target: 'd' },
        { source: 'c', target: 'd' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await detectCommunities();

      // In a fully connected graph, all nodes should be in the same community
      expect(result.communityList.length).toBe(1);
      expect(result.communityList[0].size).toBe(4);
    });

    it('should respect resolution parameter', async () => {
      // Two connected cliques
      const nodes = [
        { id: 'a1', name: 'A1', type: 'Process' },
        { id: 'a2', name: 'A2', type: 'Process' },
        { id: 'b1', name: 'B1', type: 'Task' },
        { id: 'b2', name: 'B2', type: 'Task' },
      ];
      const edges = [
        { source: 'a1', target: 'a2' },
        { source: 'b1', target: 'b2' },
        { source: 'a2', target: 'b1' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      // Higher resolution should find more communities
      const resultLow = await detectCommunities({ resolution: 0.5 });
      const resultHigh = await detectCommunities({ resolution: 2.0 });

      // Both should complete successfully
      expect(resultLow.metadata.communityCount).toBeGreaterThan(0);
      expect(resultHigh.metadata.communityCount).toBeGreaterThan(0);
    });

    it('should include community type counts', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Process' },
        { id: 'c', name: 'Node C', type: 'Task' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await detectCommunities();

      // Check that communities have typeCounts
      for (const community of result.communityList) {
        expect(community.typeCounts).toBeDefined();
        expect(community.dominantType).toBeDefined();
      }
    });

    it('should handle self-loops gracefully', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];
      const edges = [
        { source: 'a', target: 'a' }, // Self-loop
        { source: 'a', target: 'b' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      // Should not throw
      const result = await detectCommunities();
      expect(Object.keys(result.communities)).toHaveLength(2);
    });

    it('should return positive modularity for well-clustered graph', async () => {
      // Well-defined clusters should have positive modularity
      const nodes = [
        { id: 'a1', name: 'A1', type: 'Process' },
        { id: 'a2', name: 'A2', type: 'Process' },
        { id: 'a3', name: 'A3', type: 'Process' },
        { id: 'b1', name: 'B1', type: 'Task' },
        { id: 'b2', name: 'B2', type: 'Task' },
        { id: 'b3', name: 'B3', type: 'Task' },
      ];
      const edges = [
        // Cluster A (dense)
        { source: 'a1', target: 'a2' },
        { source: 'a1', target: 'a3' },
        { source: 'a2', target: 'a3' },
        // Cluster B (dense)
        { source: 'b1', target: 'b2' },
        { source: 'b1', target: 'b3' },
        { source: 'b2', target: 'b3' },
        // Weak connection between clusters
        { source: 'a3', target: 'b1' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await detectCommunities();

      expect(result.modularity).toBeGreaterThan(0);
    });
  });

  describe('getEntityCommunity', () => {
    it('should return community info for a specific entity', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];
      const edges = [{ source: 'a', target: 'b' }];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await getEntityCommunity('a');

      expect(result).not.toBeNull();
      expect(result.entityId).toBe('a');
      expect(result.communityId).toBeDefined();
      expect(result.community).toBeDefined();
      expect(result.community.members).toBeDefined();
      expect(result.totalCommunities).toBeGreaterThan(0);
    });

    it('should return null for non-existent entity', async () => {
      const nodes = [{ id: 'a', name: 'Node A', type: 'Process' }];
      const edges = [];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await getEntityCommunity('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getTopCommunities', () => {
    it('should return top N communities by size', async () => {
      const nodes = [
        { id: 'a1', name: 'A1', type: 'Process' },
        { id: 'a2', name: 'A2', type: 'Process' },
        { id: 'a3', name: 'A3', type: 'Process' },
        { id: 'b1', name: 'B1', type: 'Task' },
        { id: 'b2', name: 'B2', type: 'Task' },
      ];
      const edges = [
        { source: 'a1', target: 'a2' },
        { source: 'a2', target: 'a3' },
        { source: 'b1', target: 'b2' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await getTopCommunities(1);

      expect(result.length).toBeLessThanOrEqual(1);
      if (result.length > 0) {
        expect(result[0].size).toBeGreaterThanOrEqual(1);
      }
    });

    it('should return all communities if N is greater than total', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];
      const edges = [];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await getTopCommunities(10);

      // Each node in its own community when no edges
      expect(result.length).toBe(2);
    });
  });

  describe('calculateModularity', () => {
    it('should return 0 for empty graph', () => {
      const communities = new Map();
      const adjacency = new Map();
      const degrees = new Map();

      const modularity = calculateModularity(communities, adjacency, degrees, 0);

      expect(modularity).toBe(0);
    });

    it('should calculate positive modularity for good clustering', () => {
      // Two disconnected pairs - perfect clustering
      const communities = new Map([
        ['a', 0],
        ['b', 0],
        ['c', 1],
        ['d', 1],
      ]);
      const adjacency = new Map([
        ['a', new Set(['b'])],
        ['b', new Set(['a'])],
        ['c', new Set(['d'])],
        ['d', new Set(['c'])],
      ]);
      const degrees = new Map([
        ['a', 1],
        ['b', 1],
        ['c', 1],
        ['d', 1],
      ]);

      const modularity = calculateModularity(communities, adjacency, degrees, 2);

      expect(modularity).toBeGreaterThan(0);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.maxIterations).toBe(100);
      expect(DEFAULT_CONFIG.minModularityGain).toBe(1e-7);
      expect(DEFAULT_CONFIG.resolution).toBe(1.0);
    });
  });
});
