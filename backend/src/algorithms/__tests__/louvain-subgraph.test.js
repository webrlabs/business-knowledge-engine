/**
 * Tests for Subgraph Community Detection (LazyGraphRAG)
 *
 * Feature: F6.2.1 - On-Demand Community Detection
 */

const {
  detectSubgraphCommunities,
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

describe('Louvain Subgraph Detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should detect communities in a provided subgraph', async () => {
    const nodeIds = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
    
    // Mock getSubgraph response
    // Two cliques (A1-A2-A3) and (B1-B2-B3) connected by A3-B1
    const mockSubgraph = {
      entities: [
        { id: 'a1', name: 'A1', type: 'Process' },
        { id: 'a2', name: 'A2', type: 'Process' },
        { id: 'a3', name: 'A3', type: 'Process' },
        { id: 'b1', name: 'B1', type: 'Task' },
        { id: 'b2', name: 'B2', type: 'Task' },
        { id: 'b3', name: 'B3', type: 'Task' },
      ],
      relationships: [
        // Clique A
        { from: 'A1', to: 'A2', type: 'RELATED' },
        { from: 'A1', to: 'A3', type: 'RELATED' },
        { from: 'A2', to: 'A3', type: 'RELATED' },
        // Clique B
        { from: 'B1', to: 'B2', type: 'RELATED' },
        { from: 'B1', to: 'B3', type: 'RELATED' },
        { from: 'B2', to: 'B3', type: 'RELATED' },
        // Bridge
        { from: 'A3', to: 'B1', type: 'RELATED' },
      ]
    };

    getGraphService.mockReturnValue({
      getSubgraph: jest.fn().mockResolvedValue(mockSubgraph),
    });

    // We expect detectSubgraphCommunities to be exported eventually
    // Since it's not yet, this test will fail if we ran it now (import would be undefined)
    // But we are in TDD flow.
    const result = await detectSubgraphCommunities(nodeIds);

    expect(result.communityList.length).toBeGreaterThanOrEqual(2);
    
    // Check membership
    const commA = result.communities['a1'];
    const commB = result.communities['b1'];
    
    expect(result.communities['a2']).toBe(commA);
    expect(result.communities['a3']).toBe(commA);
    expect(result.communities['b2']).toBe(commB);
    expect(result.communities['b3']).toBe(commB);
    
    // Likely separate communities
    if (result.communityList.length > 1) {
        expect(commA).not.toBe(commB);
    }
  });

  it('should handle empty subgraph', async () => {
    getGraphService.mockReturnValue({
      getSubgraph: jest.fn().mockResolvedValue({ entities: [], relationships: [] }),
    });

    const result = await detectSubgraphCommunities(['a', 'b']);

    expect(result.communityList).toEqual([]);
    expect(result.metadata.nodeCount).toBe(0);
  });

  it('should handle subgraph with no edges', async () => {
    const mockSubgraph = {
      entities: [
        { id: 'a', name: 'A', type: 'Process' },
        { id: 'b', name: 'B', type: 'Process' },
      ],
      relationships: []
    };

    getGraphService.mockReturnValue({
      getSubgraph: jest.fn().mockResolvedValue(mockSubgraph),
    });

    const result = await detectSubgraphCommunities(['a', 'b']);

    expect(Object.keys(result.communities)).toHaveLength(2);
    expect(result.communities['a']).not.toBe(result.communities['b']);
  });
});
