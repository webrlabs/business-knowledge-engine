import { create } from 'zustand';
import { API_BASE_URL } from './api';

// Types
export interface GraphNode {
  id: string;
  label: string;
  type: 'Process' | 'Task' | 'Role' | 'System' | 'DataAsset' | 'Form' | 'Policy' | 'Procedure' | 'Directive' | 'Guide' | string;
  description?: string;
  confidence?: number;
  mentionCount?: number;
  sourceDocumentId?: string;
  sourceDocumentIds?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type?: string;
  confidence?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RelatedEntity {
  id: string;
  name: string;
  type: string;
  relationship: string;
  direction: 'incoming' | 'outgoing';
  confidence?: number;
}

export interface SourceDocument {
  id: string;
  name: string;
  uploadedAt?: string;
}

export interface EnhancedNodeDetails {
  id: string;
  name: string;
  type: string;
  description?: string;
  confidence?: number;
  mentionCount?: number;
  createdAt?: string;
  updatedAt?: string;
  relatedEntities: RelatedEntity[];
  sourceDocuments: SourceDocument[];
  incomingCount: number;
  outgoingCount: number;
}

export interface PathResult {
  path: string[];
  pathDetails: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  relationships: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}

export type ConnectivityFilter = 'all' | 'connected' | 'isolated';
export type EdgeLabelMode = 'always' | 'hover' | 'selected' | 'never';
export type LayoutType = 'cose' | 'circle' | 'breadthfirst' | 'concentric';

type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface GraphState {
  // Selection
  selectedNodeId: string | null;
  selectedNodeDetails: EnhancedNodeDetails | null;
  selectedNodeLoading: boolean;

  // Filtering
  selectedNodeTypes: Set<string>;
  selectedDocuments: string[];
  connectivityFilter: ConnectivityFilter;
  confidenceThreshold: number;

  // Focus mode
  focusedNodeId: string | null;
  neighborhoodDepth: number;
  neighborhoodData: GraphData | null;
  focusModeLoading: boolean;

  // Path finding
  pathFinderOpen: boolean;
  pathFromNode: string | null;
  pathToNode: string | null;
  highlightedPath: string[];
  pathResults: PathResult[];
  pathFindingLoading: boolean;

  // Search
  searchQuery: string;
  searchResults: GraphNode[];
  searchLoading: boolean;

  // UI state
  showFilters: boolean;
  showPathFinder: boolean;
  showAnalytics: boolean;
  edgeLabelMode: EdgeLabelMode;
  currentLayout: LayoutType;

  // Context menu
  contextMenuPosition: { x: number; y: number } | null;
  contextMenuNodeId: string | null;

  // Actions
  setSelectedNode: (nodeId: string | null) => void;
  fetchNodeDetails: (nodeName: string, authFetch: AuthFetch) => Promise<void>;
  clearSelectedNode: () => void;

  setNodeTypeFilter: (types: Set<string>) => void;
  toggleNodeType: (type: string) => void;
  setDocumentFilter: (documentIds: string[]) => void;
  setConnectivityFilter: (filter: ConnectivityFilter) => void;
  setConfidenceThreshold: (threshold: number) => void;
  clearAllFilters: () => void;

  setFocusedNode: (nodeId: string | null, depth?: number) => void;
  fetchNeighborhood: (entityName: string, depth: number, authFetch: AuthFetch) => Promise<void>;
  setNeighborhoodDepth: (depth: number) => void;
  exitFocusMode: () => void;

  setPathFinderOpen: (open: boolean) => void;
  setPathFromNode: (nodeId: string | null) => void;
  setPathToNode: (nodeId: string | null) => void;
  findPath: (fromName: string, toName: string, maxDepth: number, authFetch: AuthFetch) => Promise<void>;
  setHighlightedPath: (path: string[]) => void;
  clearPathResults: () => void;

  setSearchQuery: (query: string) => void;
  searchNodes: (query: string, authFetch: AuthFetch) => Promise<void>;
  clearSearch: () => void;

  setShowFilters: (show: boolean) => void;
  setShowPathFinder: (show: boolean) => void;
  setShowAnalytics: (show: boolean) => void;
  setEdgeLabelMode: (mode: EdgeLabelMode) => void;
  setCurrentLayout: (layout: LayoutType) => void;

  setContextMenu: (position: { x: number; y: number } | null, nodeId: string | null) => void;
  closeContextMenu: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  // Initial state
  selectedNodeId: null,
  selectedNodeDetails: null,
  selectedNodeLoading: false,

  selectedNodeTypes: new Set<string>(),
  selectedDocuments: [],
  connectivityFilter: 'all',
  confidenceThreshold: 0,

  focusedNodeId: null,
  neighborhoodDepth: 2,
  neighborhoodData: null,
  focusModeLoading: false,

  pathFinderOpen: false,
  pathFromNode: null,
  pathToNode: null,
  highlightedPath: [],
  pathResults: [],
  pathFindingLoading: false,

  searchQuery: '',
  searchResults: [],
  searchLoading: false,

  showFilters: false,
  showPathFinder: false,
  showAnalytics: false,
  edgeLabelMode: 'hover',
  currentLayout: 'cose',

  contextMenuPosition: null,
  contextMenuNodeId: null,

  // Selection actions
  setSelectedNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
    if (!nodeId) {
      set({ selectedNodeDetails: null });
    }
  },

  fetchNodeDetails: async (nodeName, authFetch) => {
    set({ selectedNodeLoading: true });
    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/graphrag/entity/${encodeURIComponent(nodeName)}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch node details');
      }
      const data = await response.json();

      // Transform API response to EnhancedNodeDetails
      const details: EnhancedNodeDetails = {
        id: data.entity?.id || data.id || '',
        name: data.entity?.name || data.name || nodeName,
        type: data.entity?.type || data.type || 'Unknown',
        description: data.entity?.description || data.description,
        confidence: data.entity?.confidence || data.confidence,
        mentionCount: data.entity?.mentionCount || data.mentionCount,
        createdAt: data.entity?.createdAt || data.createdAt,
        updatedAt: data.entity?.updatedAt || data.updatedAt,
        relatedEntities: (data.relatedEntities || []).map((rel: any) => ({
          id: rel.id || rel.name,
          name: rel.name,
          type: rel.type,
          relationship: rel.relationship || rel.relationshipType || 'RELATED_TO',
          direction: rel.direction || 'outgoing',
          confidence: rel.confidence,
        })),
        sourceDocuments: (data.sourceDocuments || []).map((doc: any) => ({
          id: doc.id || doc.documentId,
          name: doc.name || doc.documentName || doc.id,
          uploadedAt: doc.uploadedAt,
        })),
        incomingCount: data.incomingCount || 0,
        outgoingCount: data.outgoingCount || 0,
      };

      set({ selectedNodeDetails: details, selectedNodeLoading: false });
    } catch (error) {
      console.error('Error fetching node details:', error);
      set({ selectedNodeLoading: false });
    }
  },

  clearSelectedNode: () => {
    set({
      selectedNodeId: null,
      selectedNodeDetails: null,
    });
  },

  // Filter actions
  setNodeTypeFilter: (types) => {
    set({ selectedNodeTypes: types });
  },

  toggleNodeType: (type) => {
    const current = get().selectedNodeTypes;
    const newTypes = new Set(current);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    set({ selectedNodeTypes: newTypes });
  },

  setDocumentFilter: (documentIds) => {
    set({ selectedDocuments: documentIds });
  },

  setConnectivityFilter: (filter) => {
    set({ connectivityFilter: filter });
  },

  setConfidenceThreshold: (threshold) => {
    set({ confidenceThreshold: threshold });
  },

  clearAllFilters: () => {
    set({
      selectedNodeTypes: new Set<string>(),
      selectedDocuments: [],
      connectivityFilter: 'all',
      confidenceThreshold: 0,
      searchQuery: '',
      searchResults: [],
    });
  },

  // Focus mode actions
  setFocusedNode: (nodeId, depth = 2) => {
    set({
      focusedNodeId: nodeId,
      neighborhoodDepth: depth,
    });
  },

  fetchNeighborhood: async (entityName, depth, authFetch) => {
    set({ focusModeLoading: true });
    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/graphrag/neighborhood?entityName=${encodeURIComponent(entityName)}&depth=${depth}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch neighborhood');
      }
      const data = await response.json();

      // Transform to GraphData format
      const neighborhoodData: GraphData = {
        nodes: (data.entities || []).map((entity: any) => ({
          id: entity.id,
          label: entity.name,
          type: entity.type,
          description: entity.description,
          confidence: entity.confidence,
        })),
        edges: (data.relationships || []).map((rel: any, index: number) => ({
          id: rel.id || `edge-${index}`,
          source: rel.from,
          target: rel.to,
          label: rel.type,
          type: rel.type,
          confidence: rel.confidence,
        })),
      };

      set({
        neighborhoodData,
        focusModeLoading: false,
        focusedNodeId: entityName,
      });
    } catch (error) {
      console.error('Error fetching neighborhood:', error);
      set({ focusModeLoading: false });
    }
  },

  setNeighborhoodDepth: (depth) => {
    set({ neighborhoodDepth: depth });
  },

  exitFocusMode: () => {
    set({
      focusedNodeId: null,
      neighborhoodData: null,
      // Keep current layout - don't reset to default
    });
  },

  // Path finding actions
  setPathFinderOpen: (open) => {
    set({ pathFinderOpen: open, showPathFinder: open });
  },

  setPathFromNode: (nodeId) => {
    set({ pathFromNode: nodeId });
  },

  setPathToNode: (nodeId) => {
    set({ pathToNode: nodeId });
  },

  findPath: async (fromName, toName, maxDepth, authFetch) => {
    set({ pathFindingLoading: true });
    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/graphrag/paths?from=${encodeURIComponent(fromName)}&to=${encodeURIComponent(toName)}&maxDepth=${maxDepth}`
      );
      if (!response.ok) {
        throw new Error('Failed to find path');
      }
      const data = await response.json();

      const pathResults: PathResult[] = (data.paths || [data]).map((pathData: any) => ({
        path: pathData.path || pathData.entities?.map((e: any) => e.id) || [],
        pathDetails: (pathData.entities || []).map((entity: any) => ({
          id: entity.id,
          name: entity.name,
          type: entity.type,
        })),
        relationships: pathData.relationships || [],
      }));

      // Extract node IDs for highlighting
      const highlightedPath = pathResults.length > 0
        ? pathResults[0].pathDetails.map((node) => node.id)
        : [];

      set({
        pathResults,
        highlightedPath,
        pathFindingLoading: false,
      });
    } catch (error) {
      console.error('Error finding path:', error);
      set({ pathFindingLoading: false, pathResults: [] });
    }
  },

  setHighlightedPath: (path) => {
    set({ highlightedPath: path });
  },

  clearPathResults: () => {
    set({
      pathResults: [],
      highlightedPath: [],
      pathFromNode: null,
      pathToNode: null,
    });
  },

  // Search actions
  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  searchNodes: async (query, authFetch) => {
    if (!query.trim()) {
      set({ searchResults: [], searchLoading: false });
      return;
    }

    set({ searchLoading: true });
    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/graphrag/search/autocomplete?q=${encodeURIComponent(query)}&limit=20`
      );
      if (!response.ok) {
        throw new Error('Failed to search nodes');
      }
      const data = await response.json();

      const searchResults: GraphNode[] = (data.nodes || data.results || []).map((node: any) => ({
        id: node.id,
        label: node.name || node.label,
        type: node.type,
        description: node.description,
        confidence: node.confidence,
      }));

      set({ searchResults, searchLoading: false });
    } catch (error) {
      console.error('Error searching nodes:', error);
      set({ searchLoading: false, searchResults: [] });
    }
  },

  clearSearch: () => {
    set({
      searchQuery: '',
      searchResults: [],
    });
  },

  // UI actions
  setShowFilters: (show) => {
    set({ showFilters: show });
  },

  setShowPathFinder: (show) => {
    set({ showPathFinder: show, pathFinderOpen: show });
  },

  setShowAnalytics: (show) => {
    set({ showAnalytics: show });
  },

  setEdgeLabelMode: (mode) => {
    set({ edgeLabelMode: mode });
  },

  setCurrentLayout: (layout) => {
    set({ currentLayout: layout });
  },

  // Context menu actions
  setContextMenu: (position, nodeId) => {
    set({
      contextMenuPosition: position,
      contextMenuNodeId: nodeId,
    });
  },

  closeContextMenu: () => {
    set({
      contextMenuPosition: null,
      contextMenuNodeId: null,
    });
  },
}));
