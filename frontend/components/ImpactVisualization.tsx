'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { Core, ElementDefinition, NodeSingular } from 'cytoscape';

// Impact score colors - gradient from green (low) to red (high)
const getImpactColor = (score: number): string => {
  if (score >= 0.8) return '#EF4444'; // Red - Critical
  if (score >= 0.6) return '#F97316'; // Orange - High
  if (score >= 0.4) return '#EAB308'; // Yellow - Medium
  if (score >= 0.2) return '#22C55E'; // Green - Low
  return '#94A3B8'; // Gray - Minimal
};

// Entity type icons/colors (matching existing patterns)
const entityTypeColors: Record<string, string> = {
  Process: '#3B82F6',
  Task: '#10B981',
  Role: '#F59E0B',
  System: '#8B5CF6',
  DataAsset: '#EC4899',
  Form: '#06B6D4',
  Policy: '#EF4444',
  Procedure: '#14B8A6',
  Directive: '#F97316',
  Guide: '#6366F1',
  Application: '#8B5CF6',
  Database: '#EC4899',
  Department: '#F59E0B',
  Unknown: '#64748B',
};

// Risk level colors
const riskLevelColors: Record<string, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#CA8A04',
  low: '#16A34A',
};

export interface ImpactEntity {
  id: string;
  name: string;
  type?: string;
  pathLength: number;
  impactScore: number;
  direction: 'upstream' | 'downstream';
  importance?: number;
}

export interface ImpactPath {
  nodes: string[];
}

export interface ImpactAnalysisResult {
  sourceEntity: string;
  upstream?: {
    description: string;
    count: number;
    entities: ImpactEntity[];
    paths: string[][];
  };
  downstream?: {
    description: string;
    count: number;
    entities: ImpactEntity[];
    paths: string[][];
  };
  summary?: {
    totalUniqueEntities: number;
    criticalEntities: ImpactEntity[];
    criticalCount: number;
    typeDistribution: Record<string, number>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };
  metadata?: {
    executionTimeMs: number;
    maxUpstreamDepth?: number;
    maxDownstreamDepth?: number;
  };
}

export interface SimulationResult {
  simulatedEntity: string;
  action: string;
  impact: {
    directlyAffected: { count: number; entities: ImpactEntity[] };
    indirectlyAffected: { count: number; entities: ImpactEntity[] };
    criticallyAffected: { count: number; entities: ImpactEntity[] };
  };
  brokenRelationships: {
    count: number;
    relationships: { type: string; from: string; to: string }[];
  };
  recommendation: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export type ViewMode = 'both' | 'upstream' | 'downstream';
export type LayoutMode = 'tree' | 'radial' | 'hierarchical';

export interface ImpactVisualizationProps {
  data: ImpactAnalysisResult | null;
  simulation?: SimulationResult | null;
  height?: string;
  onNodeSelect?: (entity: ImpactEntity | null) => void;
  viewMode?: ViewMode;
  layoutMode?: LayoutMode;
  showLabels?: boolean;
  colorBy?: 'impact' | 'type';
}

const getLayoutConfig = (layoutMode: LayoutMode, direction: ViewMode) => {
  switch (layoutMode) {
    case 'tree':
      return {
        name: 'breadthfirst',
        fit: true,
        directed: true,
        padding: 50,
        spacingFactor: 1.5,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        roots: direction === 'both' ? undefined : `[direction="${direction === 'upstream' ? 'source' : 'source'}"]`,
      };
    case 'radial':
      return {
        name: 'concentric',
        fit: true,
        padding: 50,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        minNodeSpacing: 60,
        concentric: (node: NodeSingular) => {
          // Source entity at center, then by path length
          if (node.data('isSource')) return 100;
          return 100 - (node.data('pathLength') || 0) * 20;
        },
        levelWidth: () => 1,
      };
    case 'hierarchical':
    default:
      return {
        name: 'cose',
        fit: true,
        padding: 50,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 100,
        nodeOverlap: 30,
        nodeRepulsion: 500000,
        edgeElasticity: 100,
        gravity: 50,
        numIter: 1000,
      };
  }
};

export default function ImpactVisualization({
  data,
  simulation,
  height = '600px',
  onNodeSelect,
  viewMode = 'both',
  layoutMode = 'radial',
  showLabels = true,
  colorBy = 'impact',
}: ImpactVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<ImpactEntity | null>(null);
  const [currentLayout, setCurrentLayout] = useState<LayoutMode>(layoutMode);
  const [currentViewMode, setCurrentViewMode] = useState<ViewMode>(viewMode);
  const [currentColorBy, setCurrentColorBy] = useState<'impact' | 'type'>(colorBy);
  const [labelsVisible, setLabelsVisible] = useState(showLabels);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Build Cytoscape elements from impact analysis data
  const buildElements = useCallback((): ElementDefinition[] => {
    if (!data) return [];

    const elements: ElementDefinition[] = [];
    const nodeIds = new Set<string>();
    const edgeSet = new Set<string>();

    // Add source entity node
    const sourceId = `source_${data.sourceEntity}`;
    elements.push({
      data: {
        id: sourceId,
        label: data.sourceEntity,
        isSource: true,
        direction: 'source',
        pathLength: 0,
        impactScore: 1,
        impactColor: '#3B82F6', // Blue for source
        typeColor: '#3B82F6',
      },
    });
    nodeIds.add(sourceId);

    // Helper to add entities
    const addEntities = (entities: ImpactEntity[], direction: 'upstream' | 'downstream') => {
      entities.forEach((entity) => {
        const nodeId = `${direction}_${entity.id || entity.name}`;
        if (!nodeIds.has(nodeId)) {
          nodeIds.add(nodeId);
          elements.push({
            data: {
              id: nodeId,
              label: entity.name,
              type: entity.type || 'Unknown',
              direction,
              pathLength: entity.pathLength,
              impactScore: entity.impactScore,
              importance: entity.importance,
              impactColor: getImpactColor(entity.impactScore),
              typeColor: entityTypeColors[entity.type || 'Unknown'] || '#64748B',
              originalEntity: entity,
            },
          });
        }
      });
    };

    // Add edges from paths
    const addEdges = (paths: string[][], direction: 'upstream' | 'downstream') => {
      paths.forEach((path, pathIndex) => {
        for (let i = 0; i < path.length - 1; i++) {
          const sourceNodeId = i === 0 ? sourceId : `${direction}_${path[i]}`;
          const targetNodeId = `${direction}_${path[i + 1]}`;
          const edgeId = `edge_${direction}_${pathIndex}_${i}`;
          const edgeKey = `${sourceNodeId}-${targetNodeId}`;

          if (!edgeSet.has(edgeKey) && nodeIds.has(targetNodeId)) {
            edgeSet.add(edgeKey);
            elements.push({
              data: {
                id: edgeId,
                source: direction === 'upstream' ? sourceNodeId : sourceNodeId,
                target: direction === 'upstream' ? targetNodeId : targetNodeId,
                direction,
              },
            });
          }
        }
      });
    };

    // Process upstream entities
    if ((currentViewMode === 'both' || currentViewMode === 'upstream') && data.upstream) {
      addEntities(data.upstream.entities, 'upstream');
      addEdges(data.upstream.paths, 'upstream');
    }

    // Process downstream entities
    if ((currentViewMode === 'both' || currentViewMode === 'downstream') && data.downstream) {
      addEntities(data.downstream.entities, 'downstream');
      addEdges(data.downstream.paths, 'downstream');
    }

    return elements;
  }, [data, currentViewMode]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current || !data) return;

    const elements = buildElements();
    if (elements.length === 0) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        // Source node
        {
          selector: 'node[?isSource]',
          style: {
            'background-color': '#3B82F6',
            'border-width': 4,
            'border-color': '#1D4ED8',
            'width': 70,
            'height': 70,
            'label': labelsVisible ? 'data(label)' : '',
            'color': '#1F2937',
            'font-size': '14px',
            'font-weight': 700,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 8,
            'text-outline-color': '#FFFFFF',
            'text-outline-width': 2,
            'z-index': 999,
          },
        },
        // Regular nodes - colored by impact or type
        {
          selector: 'node[!isSource]',
          style: {
            'background-color': currentColorBy === 'impact' ? 'data(impactColor)' : 'data(typeColor)',
            'width': (node: NodeSingular) => 40 + (node.data('impactScore') || 0) * 20,
            'height': (node: NodeSingular) => 40 + (node.data('impactScore') || 0) * 20,
            'label': labelsVisible ? 'data(label)' : '',
            'color': '#1F2937',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 5,
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            'text-outline-color': '#FFFFFF',
            'text-outline-width': 2,
            'border-width': 2,
            'border-color': '#FFFFFF',
          },
        },
        // Upstream nodes indicator
        {
          selector: 'node[direction="upstream"]',
          style: {
            'shape': 'ellipse',
          },
        },
        // Downstream nodes indicator
        {
          selector: 'node[direction="downstream"]',
          style: {
            'shape': 'round-rectangle',
          },
        },
        // Selected node
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#1E40AF',
            'z-index': 999,
          },
        },
        // Hovered node
        {
          selector: 'node.highlighted',
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
            'width': 2,
            'line-color': '#94A3B8',
            'target-arrow-color': '#94A3B8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.7,
          },
        },
        // Upstream edges
        {
          selector: 'edge[direction="upstream"]',
          style: {
            'line-color': '#3B82F6',
            'target-arrow-color': '#3B82F6',
            'line-style': 'dashed',
          },
        },
        // Downstream edges
        {
          selector: 'edge[direction="downstream"]',
          style: {
            'line-color': '#EF4444',
            'target-arrow-color': '#EF4444',
          },
        },
        // Highlighted edges
        {
          selector: 'edge.highlighted',
          style: {
            'width': 3,
            'opacity': 1,
            'z-index': 999,
          },
        },
        // Dimmed edges
        {
          selector: 'edge.dimmed',
          style: {
            'opacity': 0.15,
          },
        },
      ],
      layout: getLayoutConfig(currentLayout, currentViewMode),
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2,
    });

    // Handle node selection
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      const entity = node.data('originalEntity');
      if (entity) {
        setSelectedNode(entity);
        onNodeSelect?.(entity);
      } else if (node.data('isSource')) {
        setSelectedNode(null);
        onNodeSelect?.(null);
      }
    });

    // Handle background tap (deselect)
    cy.on('tap', (event) => {
      if (event.target === cy) {
        setSelectedNode(null);
        onNodeSelect?.(null);
      }
    });

    // Handle hover for highlighting
    cy.on('mouseover', 'node', (event) => {
      const node = event.target;
      setHoveredNode(node.id());

      // Highlight connected nodes and edges
      cy.nodes().addClass('dimmed');
      cy.edges().addClass('dimmed');

      node.removeClass('dimmed').addClass('highlighted');
      node.connectedEdges().removeClass('dimmed').addClass('highlighted');
      node.neighborhood('node').removeClass('dimmed');
    });

    cy.on('mouseout', 'node', () => {
      setHoveredNode(null);
      cy.nodes().removeClass('dimmed highlighted');
      cy.edges().removeClass('dimmed highlighted');
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
    };
  }, [data, currentLayout, currentViewMode, labelsVisible, currentColorBy, buildElements, onNodeSelect]);

  // Zoom controls
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

  if (!data) {
    return (
      <div className="flex items-center justify-center bg-gray-50 dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700" style={{ height }}>
        <div className="text-center">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Select an entity to view impact analysis
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Summary Panel - Top Left */}
      <div className="absolute top-4 left-4 z-10 space-y-2 max-w-xs">
        {/* Analysis Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            Impact Analysis
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Source:</span>
              <span className="font-medium text-gray-900 dark:text-white truncate ml-2">
                {data.sourceEntity}
              </span>
            </div>
            {data.upstream && (
              <div className="flex justify-between text-sm">
                <span className="text-blue-600 dark:text-blue-400">Upstream:</span>
                <span className="font-medium">{data.upstream.count} entities</span>
              </div>
            )}
            {data.downstream && (
              <div className="flex justify-between text-sm">
                <span className="text-red-600 dark:text-red-400">Downstream:</span>
                <span className="font-medium">{data.downstream.count} entities</span>
              </div>
            )}
            {data.summary && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Critical:</span>
                  <span className="font-medium text-red-600">{data.summary.criticalCount}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-gray-600 dark:text-gray-400">Risk Level:</span>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-bold uppercase"
                    style={{
                      backgroundColor: `${riskLevelColors[data.summary.riskLevel]}20`,
                      color: riskLevelColors[data.summary.riskLevel],
                    }}
                  >
                    {data.summary.riskLevel}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* View Mode Selector */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            View Mode
          </label>
          <div className="flex gap-1">
            {(['both', 'upstream', 'downstream'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setCurrentViewMode(mode)}
                className={`flex-1 px-2 py-1.5 text-xs rounded capitalize ${
                  currentViewMode === mode
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* Labels Toggle */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={labelsVisible}
              onChange={(e) => setLabelsVisible(e.target.checked)}
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
            onChange={(e) => setCurrentLayout(e.target.value as LayoutMode)}
            className="w-full text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="radial">Radial</option>
            <option value="tree">Tree</option>
            <option value="hierarchical">Force-Directed</option>
          </select>
        </div>

        {/* Color Mode */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-2">
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
            Color By
          </label>
          <div className="flex gap-1">
            <button
              onClick={() => setCurrentColorBy('impact')}
              className={`flex-1 px-2 py-1 text-xs rounded ${
                currentColorBy === 'impact'
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              Impact
            </button>
            <button
              onClick={() => setCurrentColorBy('type')}
              className={`flex-1 px-2 py-1 text-xs rounded ${
                currentColorBy === 'type'
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              Type
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

      {/* Selected Node Details - Bottom Left */}
      {selectedNode && (
        <div className="absolute bottom-4 left-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 max-w-sm">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-gray-900 dark:text-white">Entity Details</h4>
            <button
              onClick={() => {
                setSelectedNode(null);
                onNodeSelect?.(null);
              }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Name</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedNode.name}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Type</p>
                <div className="flex items-center mt-1">
                  <div
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: entityTypeColors[selectedNode.type || 'Unknown'] }}
                  />
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {selectedNode.type || 'Unknown'}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Direction</p>
                <p className={`text-sm font-medium capitalize ${
                  selectedNode.direction === 'upstream' ? 'text-blue-600' : 'text-red-600'
                }`}>
                  {selectedNode.direction}
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Impact Score</p>
                <div className="flex items-center mt-1">
                  <div
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: getImpactColor(selectedNode.impactScore) }}
                  />
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {(selectedNode.impactScore * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Distance</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {selectedNode.pathLength} hop{selectedNode.pathLength !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Simulation Results - Bottom Right */}
      {simulation && (
        <div className="absolute bottom-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 max-w-sm">
          <h4 className="font-semibold text-gray-900 dark:text-white mb-2">
            Removal Simulation
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Direct Impact:</span>
              <span className="font-medium text-red-600">{simulation.impact.directlyAffected.count}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Indirect Impact:</span>
              <span className="font-medium text-orange-600">{simulation.impact.indirectlyAffected.count}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Critical:</span>
              <span className="font-medium text-red-600">{simulation.impact.criticallyAffected.count}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Broken Links:</span>
              <span className="font-medium">{simulation.brokenRelationships.count}</span>
            </div>
            <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded text-xs text-gray-700 dark:text-gray-300">
              {simulation.recommendation}
            </div>
          </div>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Direction Legend */}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-2">Direction</p>
            <div className="space-y-1">
              <div className="flex items-center">
                <div className="w-4 h-4 rounded-full bg-blue-500 mr-2" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Source</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 rounded-full bg-blue-400 mr-2 border-2 border-dashed border-blue-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Upstream (depends on)</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 rounded bg-red-400 mr-2" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Downstream (impacts)</span>
              </div>
            </div>
          </div>

          {/* Impact Score Legend */}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-2">Impact Score</p>
            <div className="space-y-1">
              <div className="flex items-center">
                <div className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: getImpactColor(0.9) }} />
                <span className="text-sm text-gray-700 dark:text-gray-300">Critical (&gt;80%)</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: getImpactColor(0.7) }} />
                <span className="text-sm text-gray-700 dark:text-gray-300">High (60-80%)</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: getImpactColor(0.5) }} />
                <span className="text-sm text-gray-700 dark:text-gray-300">Medium (40-60%)</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 rounded-full mr-2" style={{ backgroundColor: getImpactColor(0.3) }} />
                <span className="text-sm text-gray-700 dark:text-gray-300">Low (&lt;40%)</span>
              </div>
            </div>
          </div>

          {/* Node Size Legend */}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-2">Node Size</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Larger nodes indicate higher impact scores
            </p>
          </div>

          {/* Metadata */}
          {data.metadata && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-2">Analysis Info</p>
              <div className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                <p>Time: {data.metadata.executionTimeMs}ms</p>
                {data.metadata.maxUpstreamDepth !== undefined && (
                  <p>Max Upstream Depth: {data.metadata.maxUpstreamDepth}</p>
                )}
                {data.metadata.maxDownstreamDepth !== undefined && (
                  <p>Max Downstream Depth: {data.metadata.maxDownstreamDepth}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
