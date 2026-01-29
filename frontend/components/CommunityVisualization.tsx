'use client';

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import cytoscape, { Core, ElementDefinition, NodeSingular } from 'cytoscape';
import { useCommunityStore } from '@/lib/community-store';

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

export interface CommunityVisualizationHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  focusCommunity: (communityId: string | number) => void;
}

export interface CommunityVisualizationProps {
  communities: Community[];
  edges?: CommunityEdge[];
  height?: string;
  onCommunitySelect?: (community: Community | null) => void;
  onNodeSelect?: (node: CommunityMember | null, communityId: string | number | null) => void;
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

const CommunityVisualization = forwardRef<CommunityVisualizationHandle, CommunityVisualizationProps>(({
  communities,
  edges = [],
  height = '600px',
  onCommunitySelect,
  onNodeSelect,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const {
    selectedCommunity,
    highlightedCommunityId,
    showLabels,
    currentLayout,
    colorMode,
    focusedCommunityIndex,
    selectCommunity,
    selectMember,
    setHighlightedCommunity,
    setFocusedCommunityIndex,
    navigateCommunity,
    closePanel,
  } = useCommunityStore();

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      if (cyRef.current) {
        const zoom = cyRef.current.zoom();
        cyRef.current.zoom({
          level: zoom * 1.2,
          renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
        });
      }
    },
    zoomOut: () => {
      if (cyRef.current) {
        const zoom = cyRef.current.zoom();
        cyRef.current.zoom({
          level: zoom * 0.8,
          renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 },
        });
      }
    },
    resetView: () => {
      if (cyRef.current) {
        cyRef.current.fit(undefined, 50);
      }
    },
    focusCommunity: (communityId: string | number) => {
      if (cyRef.current) {
        const parentNode = cyRef.current.$(`#community_${communityId}`);
        if (parentNode.length > 0) {
          cyRef.current.fit(parentNode, 50);
        }
      }
    },
  }));

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
            'padding': '30px',
            'shape': 'roundrectangle',
          },
        },
        // Member nodes
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
      minZoom: 0.1,
      maxZoom: 3,
      wheelSensitivity: 0.2,
    });

    // Run layout separately so we can stop it on cleanup
    const layout = cy.layout(getLayoutConfig(currentLayout));
    layout.run();

    // Handle community (parent node) selection
    cy.on('tap', 'node[?isParent]', (event) => {
      const node = event.target;
      const communityId = node.data('communityId');
      const community = communities.find(
        (c) => String(c.communityId) === communityId
      );
      selectCommunity(community || null);
      selectMember(null);
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
      // Find the community for this member
      const community = communities.find(
        (c) => String(c.communityId) === communityId
      );
      selectCommunity(community || null);
      selectMember(member);
      onNodeSelect?.(member, communityId);
      onCommunitySelect?.(community || null);
    });

    // Handle background tap (deselect)
    cy.on('tap', (event) => {
      if (event.target === cy) {
        closePanel();
        onCommunitySelect?.(null);
        onNodeSelect?.(null, null);
      }
    });

    cyRef.current = cy;

    return () => {
      cyRef.current = null;
      layout.stop();
      cy.destroy();
    };
  }, [communities, edges, currentLayout, showLabels, colorMode, buildElements, onCommunitySelect, onNodeSelect, selectCommunity, selectMember, closePanel]);

  // Handle community highlighting
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    // Remove all highlighting classes
    cy.nodes().removeClass('community-highlighted dimmed');
    cy.edges().removeClass('highlighted dimmed');

    if (highlightedCommunityId !== null) {
      const communityIdStr = String(highlightedCommunityId);

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
  }, [highlightedCommunityId]);

  // Update node colors when colorMode changes
  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;

    cy.nodes('[!isParent]').forEach((node) => {
      const newColor = colorMode === 'community'
        ? node.data('communityColor')
        : node.data('entityColor');
      node.style('background-color', newColor);
    });
  }, [colorMode]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle if we're focused on the visualization or body
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          event.preventDefault();
          navigateCommunity('next', communities.length);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          event.preventDefault();
          navigateCommunity('prev', communities.length);
          break;
        case 'Enter':
          if (focusedCommunityIndex >= 0 && focusedCommunityIndex < communities.length) {
            event.preventDefault();
            const community = communities[focusedCommunityIndex];
            selectCommunity(community);
            onCommunitySelect?.(community);
          }
          break;
        case 'Escape':
          event.preventDefault();
          closePanel();
          setFocusedCommunityIndex(-1);
          setHighlightedCommunity(null);
          onCommunitySelect?.(null);
          break;
        case 'Tab':
          if (!event.shiftKey && communities.length > 0) {
            event.preventDefault();
            const nextIndex = (focusedCommunityIndex + 1) % communities.length;
            setFocusedCommunityIndex(nextIndex);
            setHighlightedCommunity(communities[nextIndex].communityId);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    communities,
    focusedCommunityIndex,
    navigateCommunity,
    selectCommunity,
    closePanel,
    setFocusedCommunityIndex,
    setHighlightedCommunity,
    onCommunitySelect,
  ]);

  // Highlight focused community
  useEffect(() => {
    if (focusedCommunityIndex >= 0 && focusedCommunityIndex < communities.length) {
      setHighlightedCommunity(communities[focusedCommunityIndex].communityId);
    }
  }, [focusedCommunityIndex, communities, setHighlightedCommunity]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full bg-gray-50 dark:bg-gray-900 rounded-lg border-2 border-gray-200 dark:border-gray-700"
      tabIndex={0}
      role="application"
      aria-label="Community visualization graph"
    />
  );
});

CommunityVisualization.displayName = 'CommunityVisualization';

export default CommunityVisualization;
