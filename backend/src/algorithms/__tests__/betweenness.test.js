/**
 * Tests for Betweenness Centrality Algorithm
 *
 * Feature: F3.2.2 - Betweenness Centrality
 */

const {
  calculateBetweenness,
  getTopEntitiesByBetweenness,
  getEntityBetweenness,
  identifyBridgeEntities,
  DEFAULT_CONFIG,
} = require('../betweenness');

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

describe('Betweenness Centrality Algorithm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateBetweenness', () => {
    it('should return empty results for empty graph', async () => {
      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes: [], edges: [] }),
      });

      const result = await calculateBetweenness();

      expect(result.scores).toEqual({});
      expect(result.rankedEntities).toEqual([]);
      expect(result.metadata.nodeCount).toBe(0);
      expect(result.metadata.edgeCount).toBe(0);
    });

    it('should calculate betweenness for a linear chain graph', async () => {
      // Linear graph: A -> B -> C
      // B is on all shortest paths between A and C
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

      const result = await calculateBetweenness({ normalized: false });

      expect(Object.keys(result.scores)).toHaveLength(3);
      expect(result.rankedEntities).toHaveLength(3);
      expect(result.metadata.nodeCount).toBe(3);
      expect(result.metadata.edgeCount).toBe(2);

      // B should have highest betweenness as it's the bridge
      expect(result.rankedEntities[0].id).toBe('b');
      // A and C are endpoints, should have 0 betweenness
      expect(result.scores.a).toBe(0);
      expect(result.scores.c).toBe(0);
      // B is on the path from A to C
      expect(result.scores.b).toBe(1);
    });

    it('should calculate betweenness for a star topology', async () => {
      // Star graph: Hub connected to A, B, C, D
      // All paths between outer nodes go through hub
      const nodes = [
        { id: 'hub', name: 'Hub', type: 'Process' },
        { id: 'a', name: 'Node A', type: 'Task' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'Task' },
        { id: 'd', name: 'Node D', type: 'Task' },
      ];
      const edges = [
        { source: 'hub', target: 'a' },
        { source: 'hub', target: 'b' },
        { source: 'hub', target: 'c' },
        { source: 'hub', target: 'd' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculateBetweenness({ normalized: false, directed: false });

      // Hub should have highest betweenness - all paths go through it
      expect(result.rankedEntities[0].id).toBe('hub');
      expect(result.scores.hub).toBeGreaterThan(0);

      // Outer nodes should have zero betweenness
      expect(result.scores.a).toBe(0);
      expect(result.scores.b).toBe(0);
      expect(result.scores.c).toBe(0);
      expect(result.scores.d).toBe(0);
    });

    it('should handle cyclic graphs', async () => {
      // Triangle: A -> B -> C -> A
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

      const result = await calculateBetweenness();

      // All nodes should have defined betweenness scores
      expect(result.scores.a).toBeDefined();
      expect(result.scores.b).toBeDefined();
      expect(result.scores.c).toBeDefined();
    });

    it('should handle disconnected components', async () => {
      // Two disconnected pairs: A-B and C-D
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
        { id: 'd', name: 'Node D', type: 'Role' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'c', target: 'd' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculateBetweenness();

      // All nodes should have scores
      expect(Object.keys(result.scores)).toHaveLength(4);
      // No node is a bridge between components (they're disconnected)
      expect(result.scores.a).toBe(0);
      expect(result.scores.b).toBe(0);
      expect(result.scores.c).toBe(0);
      expect(result.scores.d).toBe(0);
    });

    it('should normalize scores when requested', async () => {
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

      const result = await calculateBetweenness({ normalized: true });

      // All normalized scores should be in [0, 1] range
      for (const score of Object.values(result.scores)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
      expect(result.metadata.normalized).toBe(true);
    });

    it('should handle undirected graph mode', async () => {
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

      const directedResult = await calculateBetweenness({ directed: true, normalized: false });
      const undirectedResult = await calculateBetweenness({ directed: false, normalized: false });

      // Results should differ between directed and undirected
      expect(undirectedResult.metadata.directed).toBe(false);
      expect(directedResult.metadata.directed).toBe(true);
      // In undirected mode, B should still be the bridge
      expect(undirectedResult.rankedEntities[0].id).toBe('b');
    });

    it('should identify the critical bridge in a barbell graph', async () => {
      // Barbell graph: two complete triangles connected by a single bridge
      // A-B-C (triangle) -- D -- E-F-G (triangle)
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Task' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'Task' },
        { id: 'd', name: 'Bridge D', type: 'Process' },
        { id: 'e', name: 'Node E', type: 'Task' },
        { id: 'f', name: 'Node F', type: 'Task' },
        { id: 'g', name: 'Node G', type: 'Task' },
      ];
      const edges = [
        // Left triangle
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'a' },
        // Bridge connection
        { source: 'c', target: 'd' },
        { source: 'd', target: 'e' },
        // Right triangle
        { source: 'e', target: 'f' },
        { source: 'f', target: 'g' },
        { source: 'g', target: 'e' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const result = await calculateBetweenness({ directed: false, normalized: false });

      // D should have highest betweenness - it's the bridge between triangles
      expect(result.rankedEntities[0].id).toBe('d');
    });
  });

  describe('getTopEntitiesByBetweenness', () => {
    it('should return top N entities', async () => {
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
        { id: 'd', name: 'Node D', type: 'Role' },
        { id: 'e', name: 'Node E', type: 'Task' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'd' },
        { source: 'd', target: 'e' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const topEntities = await getTopEntitiesByBetweenness(3);

      expect(topEntities).toHaveLength(3);
      // Most central nodes should be returned
      expect(topEntities[0].betweenness).toBeGreaterThanOrEqual(topEntities[1].betweenness);
      expect(topEntities[1].betweenness).toBeGreaterThanOrEqual(topEntities[2].betweenness);
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

      const topEntities = await getTopEntitiesByBetweenness(10);

      expect(topEntities).toHaveLength(2);
    });
  });

  describe('getEntityBetweenness', () => {
    it('should return betweenness for a specific entity with rank', async () => {
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

      const entityResult = await getEntityBetweenness('b');

      expect(entityResult).not.toBeNull();
      expect(entityResult.id).toBe('b');
      expect(entityResult.betweenness).toBeDefined();
      expect(entityResult.rank).toBe(1); // B should be rank 1 (highest betweenness)
      expect(entityResult.percentile).toBeGreaterThan(0);
    });

    it('should return null for non-existent entity', async () => {
      const nodes = [{ id: 'a', name: 'Node A', type: 'Process' }];
      const edges = [];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const entityResult = await getEntityBetweenness('nonexistent');

      expect(entityResult).toBeNull();
    });
  });

  describe('identifyBridgeEntities', () => {
    it('should identify entities with high betweenness as bridges', async () => {
      // Linear chain where middle nodes are bridges
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
        { id: 'c', name: 'Node C', type: 'System' },
        { id: 'd', name: 'Node D', type: 'Role' },
        { id: 'e', name: 'Node E', type: 'Task' },
      ];
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'd' },
        { source: 'd', target: 'e' },
      ];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const bridges = await identifyBridgeEntities(0.1, { directed: false });

      // Middle nodes (b, c, d) should be identified as bridges
      expect(bridges.length).toBeGreaterThan(0);
      const bridgeIds = bridges.map((b) => b.id);
      expect(bridgeIds).toContain('c'); // Most central
    });

    it('should return empty array when no bridges exceed threshold', async () => {
      // All nodes have zero betweenness (no paths through any node)
      const nodes = [
        { id: 'a', name: 'Node A', type: 'Process' },
        { id: 'b', name: 'Node B', type: 'Task' },
      ];
      const edges = [{ source: 'a', target: 'b' }];

      getGraphService.mockReturnValue({
        getAllEntities: jest.fn().mockResolvedValue({ nodes, edges }),
      });

      const bridges = await identifyBridgeEntities(0.9);

      // With high threshold, no bridges should be found in simple graph
      expect(bridges.length).toBe(0);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.normalized).toBe(true);
      expect(DEFAULT_CONFIG.directed).toBe(true);
      expect(DEFAULT_CONFIG.sampleSize).toBeNull();
    });
  });
});
