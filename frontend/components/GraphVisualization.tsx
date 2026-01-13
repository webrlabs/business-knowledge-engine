'use client';

import { useEffect, useRef, useState } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';

interface GraphNode {
  id: string;
  label: string;
  type: 'Process' | 'Task' | 'Role' | 'System' | 'DataAsset' | 'Form' | 'Policy' | 'Procedure' | 'Directive' | 'Guide';
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: 'PRECEDES' | 'RESPONSIBLE_FOR' | 'TRANSFORMS_INTO' | 'REGULATED_BY';
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphVisualizationProps {
  data: GraphData;
  height?: string;
}

const nodeColors: Record<GraphNode['type'], string> = {
  Process: '#3B82F6',      // Blue
  Task: '#10B981',         // Green
  Role: '#F59E0B',         // Amber
  System: '#8B5CF6',       // Purple
  DataAsset: '#EC4899',    // Pink
  Form: '#06B6D4',         // Cyan
  Policy: '#EF4444',       // Red
  Procedure: '#14B8A6',    // Teal
  Directive: '#F97316',    // Orange
  Guide: '#6366F1'         // Indigo
};

const getLayoutConfig = (layoutName: 'cose' | 'circle' | 'breadthfirst') => {
  switch (layoutName) {
    case 'cose':
      // Force-directed layout (physics-based)
      return {
        name: 'cose',
        idealEdgeLength: 100,
        nodeOverlap: 20,
        refresh: 20,
        fit: true,
        padding: 30,
        randomize: false,
        componentSpacing: 100,
        nodeRepulsion: 400000,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0
      };
    case 'circle':
      // Circular layout
      return {
        name: 'circle',
        fit: true,
        padding: 30,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        spacingFactor: 1.5
      };
    case 'breadthfirst':
      // Hierarchical layout
      return {
        name: 'breadthfirst',
        fit: true,
        padding: 30,
        directed: true,
        spacingFactor: 1.5,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true
      };
    default:
      return { name: 'cose' };
  }
};

export default function GraphVisualization({ data, height = '600px' }: GraphVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<Set<GraphNode['type']>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [currentLayout, setCurrentLayout] = useState<'cose' | 'circle' | 'breadthfirst'>('cose');

  useEffect(() => {
    if (!containerRef.current) return;

    // Transform data to Cytoscape format
    const elements: ElementDefinition[] = [
      ...data.nodes.map(node => ({
        data: {
          id: node.id,
          label: node.label,
          type: node.type
        }
      })),
      ...data.edges.map(edge => ({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label
        }
      }))
    ];

    // Initialize Cytoscape
    const cy = cytoscape({
      container: containerRef.current,
      elements: elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: any) => nodeColors[ele.data('type') as GraphNode['type']] || '#64748B',
            'label': 'data(label)',
            'color': '#1F2937',
            'font-size': '12px',
            'font-weight': 600,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            'width': '60px',
            'height': '60px',
            'border-width': '2px',
            'border-color': '#FFFFFF',
            'text-outline-color': '#FFFFFF',
            'text-outline-width': '2px'
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': '4px',
            'border-color': '#1E40AF',
            'background-color': (ele: any) => nodeColors[ele.data('type') as GraphNode['type']] || '#64748B',
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': '#94A3B8',
            'target-arrow-color': '#94A3B8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'font-size': '10px',
            'color': '#64748B',
            'text-background-color': '#FFFFFF',
            'text-background-opacity': 0.8,
            'text-background-padding': '3px',
            'text-rotation': 'autorotate'
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#1E40AF',
            'target-arrow-color': '#1E40AF',
            'width': 3
          }
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': '4px',
            'border-color': '#FCD34D',
            'z-index': 999
          }
        },
        {
          selector: 'node.dimmed',
          style: {
            'opacity': 0.3
          }
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#FCD34D',
            'target-arrow-color': '#FCD34D',
            'width': 3,
            'z-index': 999
          }
        },
        {
          selector: 'edge.dimmed',
          style: {
            'opacity': 0.2
          }
        }
      ],
      layout: getLayoutConfig(currentLayout),
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2
    });

    // Handle node selection
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      setSelectedNode({
        id: node.data('id'),
        label: node.data('label'),
        type: node.data('type')
      });
    });

    // Handle background tap (deselect)
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedNode(null);
      }
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [data, currentLayout]);

  // Apply node type filtering
  useEffect(() => {
    if (!cyRef.current) return;

    const cy = cyRef.current;

    if (selectedNodeTypes.size === 0) {
      // Show all nodes and edges
      cy.nodes().style('display', 'element');
      cy.edges().style('display', 'element');
    } else {
      // Filter nodes by selected types
      cy.nodes().forEach((node) => {
        const nodeType = node.data('type');
        if (selectedNodeTypes.has(nodeType)) {
          node.style('display', 'element');
        } else {
          node.style('display', 'none');
        }
      });

      // Show edges only if both source and target are visible
      cy.edges().forEach((edge) => {
        const source = edge.source();
        const target = edge.target();
        if (source.style('display') === 'element' && target.style('display') === 'element') {
          edge.style('display', 'element');
        } else {
          edge.style('display', 'none');
        }
      });
    }
  }, [selectedNodeTypes]);

  // Apply search highlighting
  useEffect(() => {
    if (!cyRef.current) return;

    const cy = cyRef.current;

    if (!searchQuery.trim()) {
      // Remove all highlighting
      cy.nodes().removeClass('highlighted dimmed');
      cy.edges().removeClass('highlighted dimmed');
      return;
    }

    const query = searchQuery.toLowerCase();
    const matchingNodes = cy.nodes().filter((node) => {
      const label = node.data('label').toLowerCase();
      const type = node.data('type').toLowerCase();
      return label.includes(query) || type.includes(query);
    });

    if (matchingNodes.length > 0) {
      // Highlight matching nodes and dim others
      cy.nodes().addClass('dimmed');
      matchingNodes.removeClass('dimmed').addClass('highlighted');

      // Highlight edges connected to matching nodes
      cy.edges().addClass('dimmed');
      matchingNodes.connectedEdges().removeClass('dimmed').addClass('highlighted');
    } else {
      // No matches, remove all highlighting
      cy.nodes().removeClass('highlighted dimmed');
      cy.edges().removeClass('highlighted dimmed');
    }
  }, [searchQuery]);

  const handleZoomIn = () => {
    if (cyRef.current) {
      const zoom = cyRef.current.zoom();
      cyRef.current.zoom({
        level: zoom * 1.2,
        renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 }
      });
    }
  };

  const handleZoomOut = () => {
    if (cyRef.current) {
      const zoom = cyRef.current.zoom();
      cyRef.current.zoom({
        level: zoom * 0.8,
        renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 }
      });
    }
  };

  const handleResetView = () => {
    if (cyRef.current) {
      cyRef.current.fit(undefined, 30);
    }
  };

  const toggleNodeTypeFilter = (type: GraphNode['type']) => {
    const newTypes = new Set(selectedNodeTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setSelectedNodeTypes(newTypes);
  };

  const clearFilters = () => {
    setSelectedNodeTypes(new Set());
    setSearchQuery('');
  };

  const nodeTypesInData = Array.from(new Set(data.nodes.map(n => n.type)));

  return (
    <div className="relative">
      {/* Search and Filter Controls */}
      <div className="absolute top-4 left-4 z-10 space-y-2">
        {/* Search Bar */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-3">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes..."
              className="text-sm outline-none w-48"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Filter Button and Panel */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="w-full px-3 py-2 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {selectedNodeTypes.size > 0 && (
                <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">
                  {selectedNodeTypes.size}
                </span>
              )}
            </span>
            <svg
              className={`w-4 h-4 transform transition-transform ${showFilters ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showFilters && (
            <div className="border-t border-gray-200 p-3">
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {nodeTypesInData.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedNodeTypes.has(type)}
                      onChange={() => toggleNodeTypeFilter(type)}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: nodeColors[type] }}
                    />
                    <span className="text-sm text-gray-700">{type}</span>
                    <span className="text-xs text-gray-400 ml-auto">
                      {data.nodes.filter(n => n.type === type).length}
                    </span>
                  </label>
                ))}
              </div>
              {selectedNodeTypes.size > 0 && (
                <button
                  onClick={clearFilters}
                  className="w-full mt-2 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                >
                  Clear All Filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Graph Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        {/* Layout Selector */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-2">
          <label className="block text-xs font-medium text-gray-700 mb-2">Layout</label>
          <select
            value={currentLayout}
            onChange={(e) => setCurrentLayout(e.target.value as 'cose' | 'circle' | 'breadthfirst')}
            className="w-full text-sm border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="cose">Force-Directed</option>
            <option value="circle">Circular</option>
            <option value="breadthfirst">Hierarchical</option>
          </select>
        </div>

        {/* Zoom Controls */}
        <button
          onClick={handleZoomIn}
          className="bg-white hover:bg-gray-50 text-gray-700 p-2 rounded-lg shadow-md border border-gray-200 transition-colors"
          title="Zoom In"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="bg-white hover:bg-gray-50 text-gray-700 p-2 rounded-lg shadow-md border border-gray-200 transition-colors"
          title="Zoom Out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={handleResetView}
          className="bg-white hover:bg-gray-50 text-gray-700 p-2 rounded-lg shadow-md border border-gray-200 transition-colors"
          title="Reset View"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Node Details Panel */}
      {selectedNode && (
        <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-gray-900">Node Details</h4>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-500 uppercase">Type</p>
              <div className="flex items-center mt-1">
                <div
                  className="w-3 h-3 rounded-full mr-2"
                  style={{ backgroundColor: nodeColors[selectedNode.type] }}
                />
                <p className="text-sm font-medium text-gray-900">{selectedNode.type}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Name</p>
              <p className="text-sm font-medium text-gray-900 mt-1">{selectedNode.label}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">ID</p>
              <p className="text-xs font-mono text-gray-700 mt-1">{selectedNode.id}</p>
            </div>
          </div>
        </div>
      )}

      {/* Graph Container */}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full bg-gray-50 rounded-lg border-2 border-gray-200"
      />

      {/* Legend */}
      <div className="mt-4 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h4 className="font-semibold text-gray-900 mb-3">Node Types</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(nodeColors).map(([type, color]) => (
            <div key={type} className="flex items-center">
              <div
                className="w-4 h-4 rounded-full mr-2"
                style={{ backgroundColor: color }}
              />
              <span className="text-sm text-gray-700">{type}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
