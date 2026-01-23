/**
 * Tests for Incremental Community Detection (F3.1.4)
 *
 * Tests the Dynamic Frontier (DF) Louvain algorithm for incremental
 * community updates when new documents are added to the graph.
 */

const {
  detectCommunities,
  detectCommunitiesIncremental,
  detectCommunitiesSmart,
  identifyChangedCommunities,
  calculateModularity,
} = require('../louvain');

// Mock the graph service
jest.mock('../../services/graph-service', () => {
  let mockNodes = [];
  let mockEdges = [];

  return {
    getGraphService: () => ({
      getAllEntities: jest.fn().mockImplementation(async () => ({
        nodes: mockNodes,
        edges: mockEdges,
      })),
      getEntitiesModifiedSince: jest.fn().mockImplementation(async () => ({
        newEntities: [],
        modifiedEntities: [],
        total: 0,
      })),
      getEdgesCreatedSince: jest.fn().mockImplementation(async () => ({
        newEdges: [],
        total: 0,
      })),
      getGraphChangeSummary: jest.fn().mockImplementation(async () => ({
        hasChanges: true,
        recommendIncremental: true,
        changeRatio: 0.1,
        totalChanges: 5,
      })),
    }),
    setMockData: (nodes, edges) => {
      mockNodes = nodes;
      mockEdges = edges;
    },
  };
});

const { setMockData } = require('../../services/graph-service');

// Mock logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    errorWithStack: jest.fn(),
  },
}));

describe('Incremental Community Detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('identifyChangedCommunities', () => {
    it('should identify communities containing affected nodes', () => {
      const previousCommunities = {
        'node1': 0,
        'node2': 0,
        'node3': 1,
        'node4': 1,
      };
      const currentCommunities = {
        'node1': 0,
        'node2': 0,
        'node3': 1,
        'node4': 1,
        'node5': 2, // New node
      };
      const affectedNodes = new Set(['node5']);

      const changed = identifyChangedCommunities(
        previousCommunities,
        currentCommunities,
        affectedNodes
      );

      expect(changed).toContain(2); // New node's community
    });

    it('should identify communities when nodes moved between them', () => {
      const previousCommunities = {
        'node1': 0,
        'node2': 0,
        'node3': 1,
      };
      const currentCommunities = {
        'node1': 0,
        'node2': 1, // Moved from 0 to 1
        'node3': 1,
      };
      const affectedNodes = new Set(['node2']);

      const changed = identifyChangedCommunities(
        previousCommunities,
        currentCommunities,
        affectedNodes
      );

      expect(changed).toContain(0); // Previous community
      expect(changed).toContain(1); // New community
    });

    it('should return empty array when no changes', () => {
      const communities = {
        'node1': 0,
        'node2': 0,
        'node3': 1,
      };
      const affectedNodes = new Set();

      const changed = identifyChangedCommunities(
        communities,
        communities,
        affectedNodes
      );

      expect(changed).toHaveLength(0);
    });
  });

  describe('detectCommunitiesIncremental', () => {
    it('should fall back to full detection without previous result', async () => {
      // Set up a simple graph
      setMockData(
        [
          { id: 'A', name: 'A', type: 'Entity' },
          { id: 'B', name: 'B', type: 'Entity' },
          { id: 'C', name: 'C', type: 'Entity' },
        ],
        [
          { source: 'A', target: 'B' },
          { source: 'B', target: 'C' },
        ]
      );

      const result = await detectCommunitiesIncremental({
        previousResult: null, // No previous result
        newNodeIds: ['D'],
        newEdges: [],
      });

      expect(result).toBeDefined();
      expect(result.communities).toBeDefined();
      expect(result.communityList).toBeDefined();
    });

    it('should use incremental detection with valid previous result', async () => {
      // Set up initial graph
      const nodes = [
        { id: 'A', name: 'A', type: 'Entity' },
        { id: 'B', name: 'B', type: 'Entity' },
        { id: 'C', name: 'C', type: 'Entity' },
        { id: 'D', name: 'D', type: 'Entity' },
        { id: 'E', name: 'E', type: 'Entity' },
      ];
      const edges = [
        { source: 'A', target: 'B' },
        { source: 'B', target: 'C' },
        { source: 'D', target: 'E' },
      ];
      setMockData(nodes, edges);

      // Create mock previous result
      const previousResult = {
        communities: {
          'A': 0,
          'B': 0,
          'C': 0,
          'D': 1,
          'E': 1,
        },
        communityList: [
          { id: 0, size: 3, members: [{ id: 'A' }, { id: 'B' }, { id: 'C' }] },
          { id: 1, size: 2, members: [{ id: 'D' }, { id: 'E' }] },
        ],
        modularity: 0.5,
      };

      // Add a new node F connected to existing node E
      const newNodes = [...nodes, { id: 'F', name: 'F', type: 'Entity' }];
      const newEdges = [...edges, { source: 'E', target: 'F' }];
      setMockData(newNodes, newEdges);

      const result = await detectCommunitiesIncremental({
        previousResult,
        newNodeIds: ['F'],
        newEdges: [{ source: 'E', target: 'F' }],
        modifiedNodeIds: [],
      });

      expect(result).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.communities).toBeDefined();
      // Node F should be assigned to a community
      expect(result.communities['F']).toBeDefined();
    });

    it('should fall back to full detection for high change ratio', async () => {
      // Small graph with many changes
      setMockData(
        [
          { id: 'A', name: 'A', type: 'Entity' },
          { id: 'B', name: 'B', type: 'Entity' },
        ],
        [{ source: 'A', target: 'B' }]
      );

      const previousResult = {
        communities: { 'A': 0 },
        communityList: [{ id: 0, size: 1, members: [{ id: 'A' }] }],
        modularity: 0.0,
      };

      // Add many new nodes (high change ratio)
      const result = await detectCommunitiesIncremental({
        previousResult,
        newNodeIds: ['B'], // 50% new nodes = high ratio
        newEdges: [{ source: 'A', target: 'B' }],
      });

      expect(result).toBeDefined();
      // Should have used full detection due to high change ratio
      expect(result.communities).toBeDefined();
    });

    it('should handle empty graph gracefully', async () => {
      setMockData([], []);

      const result = await detectCommunitiesIncremental({
        previousResult: null,
        newNodeIds: [],
        newEdges: [],
      });

      expect(result).toBeDefined();
      expect(result.communities).toEqual({});
      expect(result.communityList).toEqual([]);
      expect(result.metadata.nodeCount).toBe(0);
    });

    it('should preserve stable communities for unaffected nodes', async () => {
      // Create larger graph so change ratio stays low (< 30%)
      // Need at least 10 nodes to avoid "small graph" fallback
      const nodes = [
        // Community 1 (5 nodes)
        { id: 'A1', name: 'A1', type: 'Entity' },
        { id: 'A2', name: 'A2', type: 'Entity' },
        { id: 'A3', name: 'A3', type: 'Entity' },
        { id: 'A4', name: 'A4', type: 'Entity' },
        { id: 'A5', name: 'A5', type: 'Entity' },
        // Community 2 (5 nodes)
        { id: 'B1', name: 'B1', type: 'Entity' },
        { id: 'B2', name: 'B2', type: 'Entity' },
        { id: 'B3', name: 'B3', type: 'Entity' },
        { id: 'B4', name: 'B4', type: 'Entity' },
        { id: 'B5', name: 'B5', type: 'Entity' },
        // New node (1 node = 9% change ratio)
        { id: 'N', name: 'N', type: 'Entity' },
      ];
      const edges = [
        // Dense community 1
        { source: 'A1', target: 'A2' },
        { source: 'A2', target: 'A3' },
        { source: 'A3', target: 'A4' },
        { source: 'A4', target: 'A5' },
        { source: 'A5', target: 'A1' },
        // Dense community 2
        { source: 'B1', target: 'B2' },
        { source: 'B2', target: 'B3' },
        { source: 'B3', target: 'B4' },
        { source: 'B4', target: 'B5' },
        { source: 'B5', target: 'B1' },
        // New node connected to community 2
        { source: 'B5', target: 'N' },
      ];
      setMockData(nodes, edges);

      const previousResult = {
        communities: {
          'A1': 0, 'A2': 0, 'A3': 0, 'A4': 0, 'A5': 0,
          'B1': 1, 'B2': 1, 'B3': 1, 'B4': 1, 'B5': 1,
        },
        communityList: [
          { id: 0, size: 5, members: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }, { id: 'A4' }, { id: 'A5' }] },
          { id: 1, size: 5, members: [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' }, { id: 'B5' }] },
        ],
        modularity: 0.5,
      };

      const result = await detectCommunitiesIncremental({
        previousResult,
        newNodeIds: ['N'],
        newEdges: [{ source: 'B5', target: 'N' }],
        modifiedNodeIds: [],
      });

      expect(result.metadata.incremental).toBe(true);
      // New node N should be processed
      expect(result.communities['N']).toBeDefined();
      // The frontier should be limited (N and its neighbors in community 2)
      expect(result.metadata.frontierSize).toBeLessThan(nodes.length);
      // Affected = new node N (1) + edge endpoint B5 (1) = 2
      expect(result.metadata.affectedNodeCount).toBeLessThanOrEqual(2);
    });

    it('should track changed communities correctly', async () => {
      // Larger graph to avoid small graph fallback (need > 10 nodes)
      const nodes = [
        // Community 1 (6 nodes)
        { id: 'A1', name: 'A1', type: 'Entity' },
        { id: 'A2', name: 'A2', type: 'Entity' },
        { id: 'A3', name: 'A3', type: 'Entity' },
        { id: 'A4', name: 'A4', type: 'Entity' },
        { id: 'A5', name: 'A5', type: 'Entity' },
        { id: 'A6', name: 'A6', type: 'Entity' },
        // Community 2 (6 nodes)
        { id: 'B1', name: 'B1', type: 'Entity' },
        { id: 'B2', name: 'B2', type: 'Entity' },
        { id: 'B3', name: 'B3', type: 'Entity' },
        { id: 'B4', name: 'B4', type: 'Entity' },
        { id: 'B5', name: 'B5', type: 'Entity' },
        { id: 'B6', name: 'B6', type: 'Entity' },
      ];
      const edges = [
        // Community 1 internal edges
        { source: 'A1', target: 'A2' },
        { source: 'A2', target: 'A3' },
        { source: 'A3', target: 'A4' },
        { source: 'A4', target: 'A5' },
        { source: 'A5', target: 'A6' },
        // Community 2 internal edges
        { source: 'B1', target: 'B2' },
        { source: 'B2', target: 'B3' },
        { source: 'B3', target: 'B4' },
        { source: 'B4', target: 'B5' },
        { source: 'B5', target: 'B6' },
        // Bridge edge
        { source: 'A6', target: 'B1' },
      ];
      setMockData(nodes, edges);

      const previousResult = {
        communities: {
          'A1': 0, 'A2': 0, 'A3': 0, 'A4': 0, 'A5': 0, 'A6': 0,
          'B1': 1, 'B2': 1, 'B3': 1, 'B4': 1, 'B5': 1, 'B6': 1,
        },
        communityList: [
          { id: 0, size: 6, members: [{ id: 'A1' }, { id: 'A2' }, { id: 'A3' }, { id: 'A4' }, { id: 'A5' }, { id: 'A6' }] },
          { id: 1, size: 6, members: [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' }, { id: 'B5' }, { id: 'B6' }] },
        ],
        modularity: 0.4,
      };

      const result = await detectCommunitiesIncremental({
        previousResult,
        newNodeIds: [],
        newEdges: [{ source: 'A6', target: 'B1' }], // Bridge edge
        modifiedNodeIds: [],
      });

      // Incremental mode should be used for low change ratio
      expect(result.metadata.incremental).toBe(true);
      // Changed communities should be identified
      expect(result.changedCommunities).toBeDefined();
      expect(Array.isArray(result.changedCommunities)).toBe(true);
    });
  });

  describe('calculateModularity', () => {
    it('should return 0 for single community with no edges', () => {
      const communities = new Map([['A', 0], ['B', 0]]);
      const adjacency = new Map([['A', new Set()], ['B', new Set()]]);
      const degrees = new Map([['A', 0], ['B', 0]]);

      const modularity = calculateModularity(communities, adjacency, degrees, 0);
      expect(modularity).toBe(0);
    });

    it('should calculate positive modularity for well-separated communities', () => {
      // Two cliques
      const communities = new Map([
        ['A', 0], ['B', 0], ['C', 0],
        ['X', 1], ['Y', 1], ['Z', 1],
      ]);
      const adjacency = new Map([
        ['A', new Set(['B', 'C'])],
        ['B', new Set(['A', 'C'])],
        ['C', new Set(['A', 'B'])],
        ['X', new Set(['Y', 'Z'])],
        ['Y', new Set(['X', 'Z'])],
        ['Z', new Set(['X', 'Y'])],
      ]);
      const degrees = new Map([
        ['A', 2], ['B', 2], ['C', 2],
        ['X', 2], ['Y', 2], ['Z', 2],
      ]);
      const totalWeight = 6; // 6 edges total

      const modularity = calculateModularity(communities, adjacency, degrees, totalWeight);
      expect(modularity).toBeGreaterThan(0);
    });
  });

  describe('Performance characteristics', () => {
    it('should process fewer nodes in incremental mode', async () => {
      // Create a larger graph
      const nodeCount = 50;
      const nodes = [];
      const edges = [];

      for (let i = 0; i < nodeCount; i++) {
        nodes.push({ id: `node${i}`, name: `Node ${i}`, type: 'Entity' });
      }

      // Create a connected graph
      for (let i = 1; i < nodeCount; i++) {
        edges.push({ source: `node${i - 1}`, target: `node${i}` });
      }

      setMockData(nodes, edges);

      // Full detection
      const fullResult = await detectCommunities();

      // Add one new node
      const newNode = { id: 'newNode', name: 'New Node', type: 'Entity' };
      const updatedNodes = [...nodes, newNode];
      const updatedEdges = [...edges, { source: 'node25', target: 'newNode' }];
      setMockData(updatedNodes, updatedEdges);

      // Incremental detection
      const incrementalResult = await detectCommunitiesIncremental({
        previousResult: fullResult,
        newNodeIds: ['newNode'],
        newEdges: [{ source: 'node25', target: 'newNode' }],
        modifiedNodeIds: [],
      });

      expect(incrementalResult.metadata.incremental).toBe(true);
      // Frontier should be much smaller than total nodes
      expect(incrementalResult.metadata.frontierSize).toBeLessThan(nodeCount);
      // Affected nodes = new node (1) + edge endpoints in newEdges that are in existing graph (1)
      // Total affected = 2 (newNode itself is counted once, node25 is also counted from edge)
      expect(incrementalResult.metadata.affectedNodeCount).toBeLessThanOrEqual(2);
    });
  });
});
