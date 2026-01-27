'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { Core, ElementDefinition, NodeSingular } from 'cytoscape';

// Community colors - distinct palette for different communities
const communityColors = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Sky Blue
  '#96CEB4', // Sage Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#98D8C8', // Mint
  '#F7DC6F', // Gold
  '#BB8FCE', // Light Purple
  '#85C1E9', // Light Blue
  '#F8B500', // Amber
  '#00CED1', // Dark Cyan
];

// Entity type colors (matching existing graph visualization)
const entityTypeColors: Record<string, string> = {
  Process: '#3B82F6',      // Blue
  Task: '#10B981',         // Green
  Role: '#F59E0B',         // Amber
  System: '#8B5CF6',       // Purple
  DataAsset: '#EC4899',    // Pink
  Form: '#06B6D4',         // Cyan
  Policy: '#EF4444',       // Red
  Procedure: '#14B8A6',    // Teal
  Directive: '#F97316',    // Orange
  Guide: '#6366F1',        // Indigo
};

export interface CommunityMember {
  id: string;
  name: string;
  type: string;
}

export interface Community {
  communityId: string | number;
  title?: string;
  summary?: string;
  memberCount: number;
  members?: CommunityMember[];
  dominantType?: string;
  typeCounts?: Record<string, number>;
  relationshipCount?: number;
  keyEntities?: string[];
  generatedAt?: string;
}

export interface CommunityEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CommunityVisualizationProps {
  communities: Community[];
  edges?: CommunityEdge[];
  height?: string;
  onCommunitySelect?: (community: Community | null) => void;
  onNodeSelect?: (node: CommunityMember | null, communityId: string | number | null) => void;
  colorMode?: 'community' | 'entityType';
}

const getLayoutConfig = (layoutName: 'cose' | 'circle' | 'concentric') => {
  switch (layoutName) {
    case 'cose':
      return {
        name: 'cose',
        idealEdgeLength: 120,
        nodeOverlap: 30,
        refresh: 20,
        fit: true,
        padding: 50,
        randomize: false,
        componentSpacing: 150,
        nodeRepulsion: 600000,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 50,
        numIter: 1500,
        initialTemp: 250,
        coolingFactor: 0.95,
        minTemp: 1.0,
      };
    case 'circle':
      return {
        name: 'circle',
        fit: true,
        padding: 50,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        spacingFactor: 1.75,
      };
    case 'concentric':
      return {
        name: 'concentric',
        fit: true,
        padding: 50,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        spacingFactor: 1.5,
        minNodeSpacing: 50,
        concentric: (node: NodeSingular) => {
          // Place community parent nodes at center, members around them
          return node.data('isParent') ? 10 : 5;
        },
        levelWidth: () => 2,
      };
    default:
      return { name: 'cose' };
  }
};

export default function CommunityVisualization({
  communities,
  edges = [],
  height = '600px',
  onCommunitySelect,
  onNodeSelect,
  colorMode = 'community',
}: CommunityVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);
  const [selectedNode, setSelectedNode] = useState<CommunityMember | null>(null);
  const [currentLayout, setCurrentLayout] = useState<'cose' | 'circle' | 'concentric'>('cose');
  const [showLabels, setShowLabels] = useState(true);
  const [highlightedCommunity, setHighlightedCommunity] = useState<string | number | null>(null);

  // Build Cytoscape elements from communities
  const buildElements = useCallback((): ElementDefinition[] => {
    const elements: ElementDefinition[] = [];
    const nodeIds = new Set<string>();

    communities.forEach((community, index) => {
      const communityId = String(community.communityId);
      const color = communityColors[index % communityColors.length];

      // Add community parent node (compound node)
      elements.push({
        data: {
          id: `community_${communityId}`,
          label: community.title || `Community ${communityId}`,
          isParent: true,
          communityId: communityId,
          memberCount: community.memberCount,
          dominantType: community.dominantType,
          color: color,
        },
      });

      // Add member nodes
      if (community.members) {
        community.members.forEach((member) => {
          if (!nodeIds.has(member.id)) {
            nodeIds.add(member.id);
            elements.push({
              data: {
                id: member.id,
                label: member.name,
                type: member.type,
                parent: `community_${communityId}`,
                communityId: communityId,
                communityColor: color,
                entityColor: entityTypeColors[member.type] || '#64748B',
              },
            });
          }
        });
      }
    });

    // Add edges
    edges.forEach((edge) => {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        elements.push({
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.label || '',
          },
        });
      }
    });

    return elements;
  }, [communities, edges]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const elements = buildElements();

    const cy = cytoscape({
      container: containerRef.current,
      elements: elements,
      style: [
        // Parent (community) nodes
        {
          selector: 'node[?isParent]',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.15,
            'border-width': 3,
            'border-color': 'data(color)',
            'border-opacity': 0.8,
            'label': showLabels ? 'data(label)' : '',
            'color': '#1F2937',
            'font-size': '14px',
            'font-weight': 700,
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': -10,
            'padding': 30,
            'shape': 'roundrectangle',
          },
        },
        // Member nodes - community color mode
        {
          selector: 'node[!isParent]',
          style: {
            'background-color': colorMode === 'community' ? 'data(communityColor)' : 'data(entityColor)',
            'label': showLabels ? 'data(label)' : '',
            'color': '#1F2937',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '70px',
            'width': '50px',
            'height': '50px',
            'border-width': 2,
            'border-color': '#FFFFFF',
            'text-outline-color': '#FFFFFF',
            'text-outline-width': 2,
          },
        },
        // Selected node
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#1E40AF',
          },
        },
        // Highlighted community
        {
          selector: 'node.community-highlighted',
          style: {
            'border-width': 4,
            'border-color': '#FCD34D',
            'z-index': 999,
          },
        },
        // Dimmed nodes
        {
          selector: 'node.dimmed',
          style: {
            'opacity': 0.25,
          },
        },
        // Edges
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#94A3B8',
            'target-arrow-color': '#94A3B8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.7,
          },
        },
        // Highlighted edges
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#1E40AF',
            'target-arrow-color': '#1E40AF',
            'width': 2.5,
            'opacity': 1,
            'z-index': 999,
          },
        },
        // Dimmed edges
        {
          selector: 'edge.dimmed',
          style: {
            'opacity': 0.1,
          },
        },
      ],
      layout: getLayoutConfig(currentLayout),
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2,
    });

    // Handle community (parent node) selection
    cy.on('tap', 'node[?isParent]', (event) => {
      const node = event.target;
      const communityId = node.data('communityId');
      const community = communities.find(
        (c) => String(c.communityId) === communityId
      );
      setSelectedCommunity(community || null);
      setSelectedNode(null);
      onCommunitySelect?.(community || null);
      onNodeSelect?.(null, null);
    });

    // Handle member node selection
    cy.on('tap', 'node[!isParent]', (event) => {
      const node = event.target;
      const communityId = node.data('communityId');
      const member: CommunityMember = {
        id: node.data('id'),
        name: node.data('label'),
        type: node.data('type'),
      };
      setSelectedNode(member);
      setSelectedCommunity(null);
      onNodeSelect?.(member, communityId);
      onCommunitySelect?.(null);
    });

    // Handle background tap (deselect)
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedCommunity(null);
        setSelectedNode(null);
        onCommunitySelect?.(null);
        onNodeSelect?.(null, null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [communities, edges, currentLayout, showLabels, colorMode, buildElements, onCommunitySelect, onNodeSelect]);

  // Handle community highlighting
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    // Remove all highlighting classes
    cy.nodes().removeClass('community-highlighted dimmed');
    cy.edges().removeClass('highlighted dimmed');

    if (highlightedCommunity !== null) {
      const communityIdStr = String(highlightedCommunity);

      // Highlight nodes in the selected community
      cy.nodes().forEach((node) => {
        const nodeCommunityId = node.data('communityId');
        if (nodeCommunityId === communityIdStr) {
          node.addClass('community-highlighted');
        } else {
          node.addClass('dimmed');
        }
      });

      // Highlight edges within the community
      cy.edges().forEach((edge) => {
        const sourceNode = edge.source();
        const targetNode = edge.target();
        const sourceCommunity = sourceNode.data('communityId');
        const targetCommunity = targetNode.data('communityId');

        if (sourceCommunity === communityIdStr && targetCommunity === communityIdStr) {
          edge.addClass('highlighted');
        } else {
          edge.addClass('dimmed');
        }
      });
    }
  }, [highlightedCommunity]);

  const handleZoomIn = () => {
    if (cyRef.current) {
      const zoom = cyRef.current.zoom();
      cyRef.current.zoom({
        level: zoom * 1.2,
        renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
      });
    }
  };

  const handleZoomOut = () => {
    if (cyRef.current) {
      const zoom = cyRef.current.zoom();
      cyRef.current.zoom({
        level: zoom * 0.8,
        renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
      });
    }
  };

  const handleResetView = () => {
    if (cyRef.current) {
      cyRef.current.fit(undefined, 50);
    }
  };

  const handleFocusCommunity = (communityId: string | number) => {
    if (cyRef.current) {
      const parentNode = cyRef.current.$(`#community_${communityId}`);
      if (parentNode.length > 0) {
        cyRef.current.fit(parentNode, 50);
      }
    }
  };

  return (
    <div className="relative">
      {/* Controls Panel - Top Left */}
      <div className="absolute top-4 left-4 z-10 space-y-2">
        {/* Community List */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3 max-w-xs">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            Communities ({communities.length})
          </h4>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {communities.map((community, index) => (
              <button
                key={community.communityId}
                onClick={() => handleFocusCommunity(community.communityId)}
                onMouseEnter={() => setHighlightedCommunity(community.communityId)}
                onMouseLeave={() => setHighlightedCommunity(null)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                  highlightedCommunity === community.communityId
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: communityColors[index % communityColors.length] }}
                />
                <span className="truncate text-gray-700 dark:text-gray-300">
                  {community.title || `Community ${community.communityId}`}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
                  {community.memberCount}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* View Options */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Show Labels</span>
          </label>
        </div>
      </div>

      {/* Controls Panel - Top Right */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        {/* Layout Selector */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Layout
          </label>
          <select
            value={currentLayout}
            onChange={(e) => setCurrentLayout(e.target.value as 'cose' | 'circle' | 'concentric')}
            className="w-full text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="cose">Force-Directed</option>
            <option value="circle">Circular</option>
            <option value="concentric">Concentric</option>
          </select>
        </div>

        {/* Color Mode */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Color By
          </label>
          <div className="flex gap-1">
            <button
              onClick={() => {
                // Force re-render with new color mode
                if (cyRef.current) {
                  cyRef.current.nodes('[!isParent]').forEach((node) => {
                    node.style('background-color', node.data('communityColor'));
                  });
                }
              }}
              className={`flex-1 px-2 py-1 text-xs rounded ${
                colorMode === 'community'
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              Community
            </button>
            <button
              onClick={() => {
                if (cyRef.current) {
                  cyRef.current.nodes('[!isParent]').forEach((node) => {
                    node.style('background-color', node.data('entityColor'));
                  });
                }
              }}
              className={`flex-1 px-2 py-1 text-xs rounded ${
                colorMode === 'entityType'
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              Entity Type
            </button>
          </div>
        </div>

        {/* Zoom Controls */}
        <button
          onClick={handleZoomIn}
          className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 transition-colors"
          title="Zoom In"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 transition-colors"
          title="Zoom Out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={handleResetView}
          className="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 p-2 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 transition-colors"
          title="Reset View"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Selected Item Panel - Bottom Left */}
      {(selectedCommunity || selectedNode) && (
        <div className="absolute bottom-4 left-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 max-w-sm">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              {selectedCommunity ? 'Community Details' : 'Node Details'}
            </h4>
            <button
              onClick={() => {
                setSelectedCommunity(null);
                setSelectedNode(null);
              }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {selectedCommunity && (
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Title</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {selectedCommunity.title || `Community ${selectedCommunity.communityId}`}
                </p>
              </div>
              {selectedCommunity.summary && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Summary</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-3">
                    {selectedCommunity.summary}
                  </p>
                </div>
              )}
              <div className="flex gap-4">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Members</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {selectedCommunity.memberCount}
                  </p>
                </div>
                {selectedCommunity.dominantType && (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Dominant Type</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {selectedCommunity.dominantType}
                    </p>
                  </div>
                )}
              </div>
              {selectedCommunity.keyEntities && selectedCommunity.keyEntities.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Key Entities</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedCommunity.keyEntities.slice(0, 5).map((entity, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded"
                      >
                        {entity}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedNode && (
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Name</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedNode.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Type</p>
                <div className="flex items-center mt-1">
                  <div
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: entityTypeColors[selectedNode.type] || '#64748B' }}
                  />
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedNode.type}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">ID</p>
                <p className="text-xs font-mono text-gray-700 dark:text-gray-300">{selectedNode.id}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Graph Container */}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full bg-gray-50 dark:bg-gray-900 rounded-lg border-2 border-gray-200 dark:border-gray-700"
      />

      {/* Legend */}
      <div className="mt-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <h4 className="font-semibold text-gray-900 dark:text-white mb-3">Legend</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {communities.slice(0, 6).map((community, index) => (
            <div key={community.communityId} className="flex items-center">
              <div
                className="w-4 h-4 rounded mr-2 border border-gray-300 dark:border-gray-600"
                style={{ backgroundColor: communityColors[index % communityColors.length] }}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                {community.title || `C${community.communityId}`}
              </span>
            </div>
          ))}
        </div>
        {communities.length > 6 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            + {communities.length - 6} more communities
          </p>
        )}
      </div>
    </div>
  );
}
