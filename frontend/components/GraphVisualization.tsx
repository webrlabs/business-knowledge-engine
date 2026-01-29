'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';

// @ts-expect-error - cytoscape-svg doesn't have type definitions
import cytoscapeSvg from 'cytoscape-svg';

// Register cytoscape-svg extension
cytoscape.use(cytoscapeSvg);
import { useAuthFetch } from '@/lib/api';
import { useGraphStore, GraphNode as StoreGraphNode, EdgeLabelMode, LayoutType } from '@/lib/graph-store';
import { getGraphStatistics } from '@/lib/graph-export';
import { NODE_COLORS, NodeType } from '@/lib/graph-constants';

// Import graph components
import NodeDetailsPanel from './graph/NodeDetailsPanel';
import ContextMenu from './graph/ContextMenu';
import PathFinderPanel from './graph/PathFinderPanel';
import ExportMenu from './graph/ExportMenu';
import AnalyticsDashboard from './graph/AnalyticsDashboard';
import SearchAutocomplete from './graph/SearchAutocomplete';

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

// Use shared NODE_COLORS from graph-constants

// Layout dropdown component
interface LayoutOption {
  value: LayoutType;
  label: string;
  icon: React.ReactNode;
}

const layoutOptions: LayoutOption[] = [
  {
    value: 'cose',
    label: 'Force-Directed',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="2" strokeWidth={2} />
        <circle cx="6" cy="6" r="1.5" strokeWidth={2} />
        <circle cx="18" cy="6" r="1.5" strokeWidth={2} />
        <circle cx="6" cy="18" r="1.5" strokeWidth={2} />
        <circle cx="18" cy="18" r="1.5" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={1.5} d="M7.5 7.5l3 3M16.5 7.5l-3 3M7.5 16.5l3-3M16.5 16.5l-3-3" />
      </svg>
    ),
  },
  {
    value: 'circle',
    label: 'Circular',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" strokeWidth={2} />
        <circle cx="12" cy="4" r="1.5" fill="currentColor" />
        <circle cx="19" cy="9" r="1.5" fill="currentColor" />
        <circle cx="17" cy="17" r="1.5" fill="currentColor" />
        <circle cx="7" cy="17" r="1.5" fill="currentColor" />
        <circle cx="5" cy="9" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    value: 'breadthfirst',
    label: 'Hierarchical',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="4" r="2" strokeWidth={2} />
        <circle cx="6" cy="12" r="2" strokeWidth={2} />
        <circle cx="18" cy="12" r="2" strokeWidth={2} />
        <circle cx="4" cy="20" r="2" strokeWidth={2} />
        <circle cx="10" cy="20" r="2" strokeWidth={2} />
        <circle cx="20" cy="20" r="2" strokeWidth={2} />
        <path strokeLinecap="round" strokeWidth={1.5} d="M12 6v4M6 14v4M18 14v4M10 6l-4 4M14 6l4 4" />
      </svg>
    ),
  },
  {
    value: 'concentric',
    label: 'Concentric',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" strokeWidth={2} />
        <circle cx="12" cy="12" r="7" strokeWidth={1.5} />
        <circle cx="12" cy="5" r="1" fill="currentColor" />
        <circle cx="12" cy="19" r="1" fill="currentColor" />
        <circle cx="5" cy="12" r="1" fill="currentColor" />
        <circle cx="19" cy="12" r="1" fill="currentColor" />
      </svg>
    ),
  },
];

function LayoutDropdown({
  currentLayout,
  onLayoutChange,
}: {
  currentLayout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentOption = layoutOptions.find((opt) => opt.value === currentLayout) || layoutOptions[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-md transition-colors flex items-center gap-1 ${
          isOpen
            ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
        }`}
        title={`Layout: ${currentOption.label}`}
      >
        {currentOption.icon}
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
          <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Layout</p>
          </div>
          {layoutOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onLayoutChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                currentLayout === option.value
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}
            >
              <span className={currentLayout === option.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}>
                {option.icon}
              </span>
              <span className="text-sm">{option.label}</span>
              {currentLayout === option.value && (
                <svg className="w-4 h-4 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Edge label dropdown component
interface EdgeLabelOption {
  value: EdgeLabelMode;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const edgeLabelOptions: EdgeLabelOption[] = [
  {
    value: 'never',
    label: 'Hidden',
    description: 'No labels shown',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
      </svg>
    ),
  },
  {
    value: 'hover',
    label: 'On Hover',
    description: 'Show when hovering',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
  {
    value: 'selected',
    label: 'Selected Only',
    description: 'Show on selected edges',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
      </svg>
    ),
  },
  {
    value: 'always',
    label: 'Always',
    description: 'Show all labels',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
    ),
  },
];

function EdgeLabelDropdown({
  currentMode,
  onModeChange,
}: {
  currentMode: EdgeLabelMode;
  onModeChange: (mode: EdgeLabelMode) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentOption = edgeLabelOptions.find((opt) => opt.value === currentMode) || edgeLabelOptions[0];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-md transition-colors flex items-center gap-1 ${
          isOpen
            ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
        }`}
        title={`Edge Labels: ${currentOption.label}`}
      >
        {currentOption.icon}
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
          <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Edge Labels</p>
          </div>
          {edgeLabelOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => {
                onModeChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                currentMode === option.value
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}
            >
              <span className={currentMode === option.value ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}>
                {option.icon}
              </span>
              <div className="flex-1">
                <span className="text-sm">{option.label}</span>
                <p className="text-xs text-gray-500 dark:text-gray-400">{option.description}</p>
              </div>
              {currentMode === option.value && (
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Filter dropdown component
function FilterDropdown({
  nodeTypesInData,
  nodeTypeCounts,
}: {
  nodeTypesInData: string[];
  nodeTypeCounts: Record<string, number>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    selectedNodeTypes,
    connectivityFilter,
    toggleNodeType,
    setConnectivityFilter,
    clearAllFilters,
  } = useGraphStore();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeFilterCount =
    selectedNodeTypes.size +
    (connectivityFilter !== 'all' ? 1 : 0);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-2 rounded-md transition-colors flex items-center gap-1 ${
          isOpen || activeFilterCount > 0
            ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
        }`}
        title={`Filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        {activeFilterCount > 0 && (
          <span className="text-xs font-medium">{activeFilterCount}</span>
        )}
        <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50 max-h-96 overflow-y-auto">
          <div className="px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Filters</p>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { clearAllFilters(); }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Node Types */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Node Types</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {nodeTypesInData.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedNodeTypes.has(type)}
                    onChange={() => toggleNodeType(type)}
                    className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                  />
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: NODE_COLORS[type as keyof typeof NODE_COLORS] || '#64748B' }}
                  />
                  <span className="text-gray-700 dark:text-gray-300 flex-1">{type}</span>
                  <span className="text-xs text-gray-400">{nodeTypeCounts[type] || 0}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Connectivity */}
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Connectivity</p>
            <div className="flex gap-1">
              {(['all', 'connected', 'isolated'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => setConnectivityFilter(option)}
                  className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                    connectivityFilter === option
                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {option === 'all' ? 'All' : option === 'connected' ? 'Connected' : 'Isolated'}
                </button>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

const getLayoutConfig = (layoutName: LayoutType, centerId?: string) => {
  switch (layoutName) {
    case 'cose':
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
      return {
        name: 'circle',
        fit: true,
        padding: 30,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        spacingFactor: 1.5
      };
    case 'breadthfirst':
      return {
        name: 'breadthfirst',
        fit: true,
        padding: 30,
        directed: true,
        spacingFactor: 1.5,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true
      };
    case 'concentric':
      return {
        name: 'concentric',
        fit: true,
        padding: 30,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        spacingFactor: 1.5,
        concentric: (node: any) => {
          if (centerId && node.id() === centerId) return 10;
          return node.degree();
        },
        levelWidth: () => 2
      };
    default:
      return { name: 'cose' };
  }
};

export default function GraphVisualization({ data, height = '600px' }: GraphVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const authFetch = useAuthFetch();

  // Local state
  const [localStats, setLocalStats] = useState<ReturnType<typeof getGraphStatistics> | null>(null);

  // Graph store
  const {
    selectedNodeId,
    selectedNodeDetails,
    selectedNodeLoading,
    selectedNodeTypes,
    connectivityFilter,
    focusedNodeId,
    neighborhoodDepth,
    highlightedPath,
    edgeLabelMode,
    currentLayout,
    showPathFinder,
    showAnalytics,
    contextMenuPosition,
    contextMenuNodeId,
    setSelectedNode,
    fetchNodeDetails,
    clearSelectedNode,
    setShowPathFinder,
    setShowAnalytics,
    setEdgeLabelMode,
    setCurrentLayout,
    setContextMenu,
    closeContextMenu,
    setHighlightedPath,
    setFocusedNode,
    fetchNeighborhood,
    exitFocusMode,
    toggleNodeType,
    clearAllFilters,
  } = useGraphStore();

  // Convert data nodes to store format
  const storeNodes: StoreGraphNode[] = data.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
  }));

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const nodeIds = new Set(data.nodes.map(n => n.id));
    const elements: ElementDefinition[] = [
      ...data.nodes.map(node => ({
        data: {
          id: node.id,
          label: node.label,
          type: node.type
        }
      })),
      ...data.edges
        .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map(edge => ({
          data: {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: edge.label
          }
        }))
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements: elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: any) => NODE_COLORS[ele.data('type') as GraphNode['type']] || '#64748B',
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
            'label': '', // Labels controlled by separate useEffect
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
            // Label visibility controlled by edgeLabelMode useEffect
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
            'opacity': 0.15
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
            'opacity': 0.1
          }
        },
        {
          selector: 'node.path-highlighted',
          style: {
            'border-width': '4px',
            'border-color': '#8B5CF6',
            'background-opacity': 1,
            'z-index': 1000
          }
        },
        {
          selector: 'edge.path-highlighted',
          style: {
            'line-color': '#8B5CF6',
            'target-arrow-color': '#8B5CF6',
            'width': 4,
            'z-index': 1000,
            'label': 'data(label)'
          }
        },
        {
          selector: 'node.path-dimmed',
          style: {
            'opacity': 0.2
          }
        },
        {
          selector: 'edge.path-dimmed',
          style: {
            'opacity': 0.1
          }
        },
        {
          selector: 'node.focus-center',
          style: {
            'border-width': '6px',
            'border-color': '#3B82F6',
            'width': '80px',
            'height': '80px'
          }
        }
      ],
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2
    });

    const layout = cy.layout(getLayoutConfig(currentLayout));
    layout.run();

    // Handle node selection
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      const nodeId = node.data('id');
      const nodeName = node.data('label');
      setSelectedNode(nodeId);
      fetchNodeDetails(nodeName, authFetch);
    });

    // Handle background tap (deselect)
    cy.on('tap', (event) => {
      if (event.target === cy) {
        clearSelectedNode();
        closeContextMenu();
      }
    });

    // Right-click context menu
    cy.on('cxttap', 'node', (event) => {
      event.originalEvent.preventDefault();
      const node = event.target;
      const position = event.renderedPosition || event.position;
      const containerRect = containerRef.current?.getBoundingClientRect();

      if (containerRect) {
        setContextMenu(
          {
            x: containerRect.left + position.x,
            y: containerRect.top + position.y
          },
          node.data('id')
        );
      }
    });

    cyRef.current = cy;

    // Calculate local stats
    setTimeout(() => {
      if (cyRef.current) {
        setLocalStats(getGraphStatistics(cyRef.current));
      }
    }, 500);

    return () => {
      cyRef.current = null;
      layout.stop();
      cy.destroy();
    };
  }, [data]); // Only recreate graph when data changes, not edgeLabelMode

  // Apply edge label mode changes without recreating graph
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    // Helper to update label based on mode
    const updateEdgeLabel = (edge: any, isHovered = false) => {
      if (edgeLabelMode === 'always') {
        edge.style('label', edge.data('label'));
      } else if (edgeLabelMode === 'never') {
        edge.style('label', '');
      } else if (edgeLabelMode === 'selected') {
        edge.style('label', edge.selected() ? edge.data('label') : '');
      } else if (edgeLabelMode === 'hover') {
        edge.style('label', isHovered ? edge.data('label') : '');
      }
    };

    // Update all edge labels
    cy.edges().forEach((edge) => updateEdgeLabel(edge));

    // Remove old event handlers
    cy.off('mouseover', 'edge');
    cy.off('mouseout', 'edge');
    cy.off('select', 'edge');
    cy.off('unselect', 'edge');

    // Set up hover handlers for 'hover' mode
    if (edgeLabelMode === 'hover') {
      cy.on('mouseover', 'edge', (event) => {
        event.target.style('label', event.target.data('label'));
      });
      cy.on('mouseout', 'edge', (event) => {
        event.target.style('label', '');
      });
    }

    // Set up selection handlers for 'selected' mode
    if (edgeLabelMode === 'selected') {
      cy.on('select', 'edge', (event) => {
        event.target.style('label', event.target.data('label'));
      });
      cy.on('unselect', 'edge', (event) => {
        event.target.style('label', '');
      });
    }
  }, [edgeLabelMode]);

  // Apply node type filtering
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    cy.batch(() => {
      if (selectedNodeTypes.size === 0) {
        cy.nodes().style('display', 'element');
        cy.edges().style('display', 'element');
      } else {
        cy.nodes().forEach((node) => {
          const nodeType = node.data('type');
          node.style('display', selectedNodeTypes.has(nodeType) ? 'element' : 'none');
        });

        cy.edges().forEach((edge) => {
          const source = edge.source();
          const target = edge.target();
          const visible = source.style('display') === 'element' && target.style('display') === 'element';
          edge.style('display', visible ? 'element' : 'none');
        });
      }
    });
  }, [selectedNodeTypes]);

  // Apply connectivity filtering
  useEffect(() => {
    if (!cyRef.current || connectivityFilter === 'all') return;
    const cy = cyRef.current;

    cy.batch(() => {
      const connectedIds = new Set<string>();
      cy.edges().forEach((edge) => {
        connectedIds.add(edge.source().id());
        connectedIds.add(edge.target().id());
      });

      cy.nodes().forEach((node) => {
        const isConnected = connectedIds.has(node.id());
        if (connectivityFilter === 'connected') {
          node.style('display', isConnected ? 'element' : 'none');
        } else if (connectivityFilter === 'isolated') {
          node.style('display', isConnected ? 'none' : 'element');
        }
      });
    });
  }, [connectivityFilter]);

  // Apply path highlighting
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    cy.batch(() => {
      cy.elements().removeClass('path-highlighted path-dimmed');

      if (highlightedPath.length > 0) {
        // Dim all elements
        cy.elements().addClass('path-dimmed');

        // Highlight path nodes
        highlightedPath.forEach((nodeId) => {
          const node = cy.$id(nodeId);
          if (node.length > 0) {
            node.removeClass('path-dimmed').addClass('path-highlighted');
          }
        });

        // Highlight edges between path nodes
        for (let i = 0; i < highlightedPath.length - 1; i++) {
          const source = highlightedPath[i];
          const target = highlightedPath[i + 1];
          const edges = cy.edges().filter((edge) => {
            const s = edge.source().id();
            const t = edge.target().id();
            return (s === source && t === target) || (s === target && t === source);
          });
          edges.removeClass('path-dimmed').addClass('path-highlighted');
        }
      }
    });
  }, [highlightedPath]);

  // Apply layout changes
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const layout = cy.layout(getLayoutConfig(currentLayout, focusedNodeId || undefined));
    layout.run();
  }, [currentLayout, focusedNodeId]);

  // Handle focus mode
  useEffect(() => {
    if (!cyRef.current || !focusedNodeId) return;
    const cy = cyRef.current;

    cy.batch(() => {
      cy.elements().removeClass('dimmed focus-center');

      const centerNode = cy.nodes().filter((n) => n.data('label') === focusedNodeId || n.id() === focusedNodeId);
      if (centerNode.length > 0) {
        centerNode.addClass('focus-center');

        // Get neighborhood
        const neighborhood = centerNode.closedNeighborhood();
        for (let i = 1; i < neighborhoodDepth; i++) {
          neighborhood.merge(neighborhood.closedNeighborhood());
        }

        cy.elements().not(neighborhood).addClass('dimmed');
      }
    });

    // Run concentric layout centered on focused node
    const layout = cy.layout(getLayoutConfig('concentric', focusedNodeId));
    layout.run();
  }, [focusedNodeId, neighborhoodDepth]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'Escape':
          clearSelectedNode();
          closeContextMenu();
          setHighlightedPath([]);
          exitFocusMode();
          break;
        case 'f':
        case 'F':
          if (selectedNodeId) {
            const node = data.nodes.find((n) => n.id === selectedNodeId);
            if (node) {
              setFocusedNode(node.label);
            }
          }
          break;
        case 'p':
        case 'P':
          setShowPathFinder(!showPathFinder);
          break;
        case '/':
          e.preventDefault();
          document.querySelector<HTMLInputElement>('[data-graph-search]')?.focus();
          break;
        case 'r':
        case 'R':
          if (cyRef.current) {
            cyRef.current.fit(undefined, 30);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, showPathFinder, data.nodes]);

  // Handle select node from search or related entities
  useEffect(() => {
    const handleSelectNode = (e: CustomEvent<{ name: string }>) => {
      if (!cyRef.current) return;
      const cy = cyRef.current;
      const node = cy.nodes().filter((n) => n.data('label') === e.detail.name);
      if (node.length > 0) {
        cy.animate({
          center: { eles: node },
          zoom: 1.5
        }, {
          duration: 300
        });
        node.select();
        setSelectedNode(node.id());
        fetchNodeDetails(e.detail.name, authFetch);
      }
    };

    window.addEventListener('graph:selectNode' as any, handleSelectNode);
    return () => window.removeEventListener('graph:selectNode' as any, handleSelectNode);
  }, [authFetch, fetchNodeDetails, setSelectedNode]);

  // Handlers
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

  const handleSelectNodeFromSearch = useCallback((node: StoreGraphNode) => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    const cyNode = cy.$id(node.id);
    if (cyNode.length > 0) {
      cy.animate({
        center: { eles: cyNode },
        zoom: 1.5
      }, {
        duration: 300
      });
      cyNode.select();
      setSelectedNode(node.id);
      fetchNodeDetails(node.label, authFetch);
    }
  }, [authFetch, fetchNodeDetails, setSelectedNode]);

  const handleFocus = useCallback((nodeId: string) => {
    const node = data.nodes.find((n) => n.id === nodeId);
    if (node) {
      setFocusedNode(node.label);
    }
  }, [data.nodes, setFocusedNode]);

  const handleHighlightPath = useCallback((nodeIds: string[]) => {
    setHighlightedPath(nodeIds);
  }, [setHighlightedPath]);

  const handleClearHighlight = useCallback(() => {
    setHighlightedPath([]);
  }, [setHighlightedPath]);

  const nodeTypesInData = Array.from(new Set(data.nodes.map(n => n.type)));
  const nodeTypeCounts = nodeTypesInData.reduce((acc, type) => {
    acc[type] = data.nodes.filter(n => n.type === type).length;
    return acc;
  }, {} as Record<string, number>);

  // Calculate visible nodes based on filters
  const visibleNodesCount = data.nodes.filter((node) => {
    // Check node type filter
    if (selectedNodeTypes.size > 0 && !selectedNodeTypes.has(node.type)) {
      return false;
    }
    // Note: connectivity and confidence filters are applied in cytoscape,
    // but we can approximate for UI purposes
    return true;
  }).length;

  const hasActiveFilters = selectedNodeTypes.size > 0 || connectivityFilter !== 'all';
  const showEmptyFilterState = hasActiveFilters && visibleNodesCount === 0;

  // Get selected node for context menu
  const contextMenuNode = contextMenuNodeId
    ? data.nodes.find((n) => n.id === contextMenuNodeId)
    : null;

  return (
    <div className="relative">
      {/* Top Toolbar */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-end gap-4">
        {/* Unified Toolbar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-1.5 flex items-center gap-1">
          {/* Search */}
          <div className="w-48">
            <SearchAutocomplete
              nodes={storeNodes}
              onSelectNode={handleSelectNodeFromSearch}
              placeholder="Search... (/)"
            />
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* Filter Dropdown */}
          <FilterDropdown nodeTypesInData={nodeTypesInData} nodeTypeCounts={nodeTypeCounts} />

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* Zoom Controls */}
          <div className="flex items-center" role="group" aria-label="Zoom controls">
            <button
              onClick={handleZoomIn}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              title="Zoom In"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
            </button>
            <button
              onClick={handleZoomOut}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              title="Zoom Out"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
              </svg>
            </button>
            <button
              onClick={handleResetView}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
              title="Fit to View (R)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            </button>
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* Layout Dropdown */}
          <LayoutDropdown currentLayout={currentLayout} onLayoutChange={setCurrentLayout} />

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* Edge Label Dropdown */}
          <EdgeLabelDropdown currentMode={edgeLabelMode} onModeChange={setEdgeLabelMode} />

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* Export */}
          <ExportMenu cyRef={cyRef} />

          {/* Divider */}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />

          {/* Feature Toggles */}
          <div className="flex items-center" role="group" aria-label="Features">
            <button
              onClick={() => setShowPathFinder(!showPathFinder)}
              className={`p-2 rounded-md transition-colors ${
                showPathFinder
                  ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
              title="Path Finder (P)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
            <button
              onClick={() => setShowAnalytics(!showAnalytics)}
              className={`p-2 rounded-md transition-colors ${
                showAnalytics
                  ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
              title="Analytics Dashboard"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Side Panels */}
      <div className="absolute top-20 left-4 z-10 space-y-2" style={{ maxWidth: '320px' }}>
        {/* Node Details Panel */}
        {selectedNodeDetails && (
          <NodeDetailsPanel
            details={selectedNodeDetails}
            onClose={clearSelectedNode}
            onFocus={handleFocus}
            onFindPaths={() => setShowPathFinder(true)}
          />
        )}

        {/* Path Finder Panel */}
        {showPathFinder && (
          <PathFinderPanel
            nodes={storeNodes}
            onHighlightPath={handleHighlightPath}
            onClearHighlight={handleClearHighlight}
          />
        )}
      </div>

      {/* Right Side Panels */}
      <div className="absolute top-20 right-4 z-10 space-y-2" style={{ maxWidth: '320px' }}>
        {/* Analytics Dashboard */}
        {showAnalytics && (
          <AnalyticsDashboard
            isOpen={true}
            onToggle={() => setShowAnalytics(false)}
            onSelectNode={(name) => {
              const event = new CustomEvent('graph:selectNode', { detail: { name } });
              window.dispatchEvent(event);
            }}
            localStats={localStats || undefined}
          />
        )}
      </div>

      {/* Focus Mode Banner */}
      {focusedNodeId && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 z-10">
          <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
            <span className="text-sm font-medium">
              Focused on: {focusedNodeId}
            </span>
            <button
              onClick={exitFocusMode}
              className="ml-2 p-1 hover:bg-blue-700 rounded transition-colors"
              title="Exit Focus Mode (Esc)"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenuPosition && contextMenuNode && (
        <ContextMenu
          position={contextMenuPosition}
          nodeName={contextMenuNode.label}
          nodeId={contextMenuNode.id}
          nodeType={contextMenuNode.type}
          onClose={closeContextMenu}
          onViewDetails={() => {
            setSelectedNode(contextMenuNode.id);
            fetchNodeDetails(contextMenuNode.label, authFetch);
          }}
          onFocus={() => handleFocus(contextMenuNode.id)}
          onFindPathsFrom={() => setShowPathFinder(true)}
        />
      )}

      {/* Graph Container */}
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className="w-full bg-gray-50 dark:bg-gray-900 rounded-lg border-2 border-gray-200 dark:border-gray-700"
        />

        {/* Empty Filtered State Overlay */}
        {showEmptyFilterState && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50/90 dark:bg-gray-900/90 rounded-lg">
            <div className="text-center max-w-md p-8">
              <div className="mb-4">
                <svg className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                No nodes match your filters
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Try adjusting your filter selections to see more results.
              </p>
              <ul className="text-sm text-gray-500 dark:text-gray-400 text-left space-y-2 mb-6">
                <li className="flex items-start gap-2">
                  <span className="text-gray-400 dark:text-gray-500 mt-0.5">•</span>
                  Adjusting your node type selections
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-400 dark:text-gray-500 mt-0.5">•</span>
                  Clearing filters to see all nodes
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-gray-400 dark:text-gray-500 mt-0.5">•</span>
                  Searching for specific node names
                </li>
              </ul>
              <button
                onClick={clearAllFilters}
                className="btn-primary inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear All Filters
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
