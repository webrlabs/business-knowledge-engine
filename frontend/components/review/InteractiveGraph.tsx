'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { Core, ElementDefinition, NodeSingular } from 'cytoscape';
import { StagedEntity, StagedRelationship, ChangeStatus } from '@/lib/staging-store';
import { NODE_COLORS } from '@/lib/graph-constants';

// We'll dynamically import edgehandles since it's optional
let edgehandles: any = null;
if (typeof window !== 'undefined') {
  import('cytoscape-edgehandles').then((module) => {
    edgehandles = module.default;
    cytoscape.use(edgehandles);
  });
}

interface InteractiveGraphProps {
  entities: StagedEntity[];
  relationships: StagedRelationship[];
  selectedEntityId: string | null;
  onEntitySelect: (entityId: string | null) => void;
  onEntityPositionChange: (entityId: string, position: { x: number; y: number }) => void;
  onEntityDelete: (entityId: string) => void;
  onEntityEdit: (entity: StagedEntity) => void;
  onRelationshipCreate: (source: string, target: string) => void;
  onRelationshipDelete: (relationshipId: string) => void;
}


const statusColors: Record<ChangeStatus, string> = {
  unchanged: '#6B7280', // gray
  modified: '#F59E0B', // yellow
  added: '#10B981', // green
  deleted: '#EF4444', // red
};

export default function InteractiveGraph({
  entities,
  relationships,
  selectedEntityId,
  onEntitySelect,
  onEntityPositionChange,
  onEntityDelete,
  onEntityEdit,
  onRelationshipCreate,
  onRelationshipDelete,
}: InteractiveGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entityId?: string;
    relationshipId?: string;
  } | null>(null);
  const edgeHandlesRef = useRef<any>(null);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    // Filter out deleted entities and relationships for display
    const visibleEntities = entities.filter((e) => e.status !== 'deleted');
    const visibleRelationships = relationships.filter(
      (r) =>
        r.status !== 'deleted' &&
        visibleEntities.some((e) => e.id === r.source || e.stagedId === r.source) &&
        visibleEntities.some((e) => e.id === r.target || e.stagedId === r.target)
    );

    const elements: ElementDefinition[] = [
      ...visibleEntities.map((entity) => ({
        data: {
          id: entity.id,
          label: entity.name,
          type: entity.type,
          status: entity.status,
        },
        position: entity.position || undefined,
      })),
      ...visibleRelationships.map((rel) => ({
        data: {
          id: rel.id,
          source: rel.source,
          target: rel.target,
          label: rel.type,
          status: rel.status,
        },
      })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: any) => NODE_COLORS[ele.data('type')] || '#64748B',
            label: 'data(label)',
            color: '#1F2937',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '80px',
            width: '55px',
            height: '55px',
            'border-width': '3px',
            'border-color': (ele: any) => statusColors[ele.data('status') as ChangeStatus] || '#6B7280',
            'text-outline-color': '#FFFFFF',
            'text-outline-width': '2px',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': '4px',
            'border-color': '#1E40AF',
            'background-opacity': 0.9,
          },
        },
        {
          selector: 'node[status="added"]',
          style: {
            'border-style': 'dashed',
          },
        },
        {
          selector: 'node[status="deleted"]',
          style: {
            opacity: 0.4,
            'border-color': '#EF4444',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': (ele: any) => {
              const status = ele.data('status');
              if (status === 'added') return '#10B981';
              if (status === 'modified') return '#F59E0B';
              return '#94A3B8';
            },
            'target-arrow-color': (ele: any) => {
              const status = ele.data('status');
              if (status === 'added') return '#10B981';
              if (status === 'modified') return '#F59E0B';
              return '#94A3B8';
            },
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': '9px',
            color: '#64748B',
            'text-background-color': '#FFFFFF',
            'text-background-opacity': 0.9,
            'text-background-padding': '2px',
          },
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#1E40AF',
            'target-arrow-color': '#1E40AF',
            width: 3,
          },
        },
        {
          selector: '.eh-handle',
          style: {
            'background-color': '#3B82F6',
            width: 12,
            height: 12,
            shape: 'ellipse',
            'overlay-opacity': 0,
            'border-width': 12,
            'border-opacity': 0,
          },
        },
        {
          selector: '.eh-hover',
          style: {
            'background-color': '#1E40AF',
          },
        },
        {
          selector: '.eh-source',
          style: {
            'border-width': 2,
            'border-color': '#3B82F6',
          },
        },
        {
          selector: '.eh-target',
          style: {
            'border-width': 2,
            'border-color': '#3B82F6',
          },
        },
        {
          selector: '.eh-preview, .eh-ghost-edge',
          style: {
            'background-color': '#3B82F6',
            'line-color': '#3B82F6',
            'target-arrow-color': '#3B82F6',
            'source-arrow-color': '#3B82F6',
          },
        },
      ],
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.2,
    });

    // Run layout separately so we can stop it on cleanup
    const layout = cy.layout({
      name: 'cose',
      animate: false,
      fit: true,
      padding: 50,
      nodeRepulsion: () => 500000,
      idealEdgeLength: () => 100,
    });
    layout.run();

    // Enable node dragging
    cy.on('dragfree', 'node', (event) => {
      const node = event.target as NodeSingular;
      const position = node.position();
      onEntityPositionChange(node.data('id'), { x: position.x, y: position.y });
    });

    // Handle node selection
    cy.on('tap', 'node', (event) => {
      const node = event.target;
      onEntitySelect(node.data('id'));
    });

    // Handle background click (deselect)
    cy.on('tap', (event) => {
      if (event.target === cy) {
        onEntitySelect(null);
        setContextMenu(null);
      }
    });

    // Handle right-click context menu
    cy.on('cxttap', 'node', (event) => {
      const node = event.target;
      const renderedPosition = node.renderedPosition();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        setContextMenu({
          x: containerRect.left + renderedPosition.x,
          y: containerRect.top + renderedPosition.y,
          entityId: node.data('id'),
        });
      }
    });

    cy.on('cxttap', 'edge', (event) => {
      const edge = event.target;
      const midpoint = edge.midpoint();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        // Convert model position to rendered position
        const pan = cy.pan();
        const zoom = cy.zoom();
        setContextMenu({
          x: containerRect.left + midpoint.x * zoom + pan.x,
          y: containerRect.top + midpoint.y * zoom + pan.y,
          relationshipId: edge.data('id'),
        });
      }
    });

    // Initialize edge handles for creating relationships
    if (edgehandles && cy.edgehandles) {
      edgeHandlesRef.current = cy.edgehandles({
        snap: true,
        noEdgeEventsInDraw: true,
        edgeParams: () => ({
          data: {
            label: 'RELATED_TO',
            status: 'added',
          },
        }),
        complete: (sourceNode: NodeSingular, targetNode: NodeSingular) => {
          // Remove the temporary edge and trigger relationship creation
          const lastEdge = cy.edges().last();
          if (lastEdge) {
            lastEdge.remove();
          }
          onRelationshipCreate(sourceNode.data('id'), targetNode.data('id'));
        },
      });
    }

    cyRef.current = cy;

    return () => {
      // Clear ref first so other effects/handlers don't use the destroyed instance
      cyRef.current = null;
      // Stop the layout to cancel any pending async callbacks
      layout.stop();
      if (edgeHandlesRef.current) {
        edgeHandlesRef.current.destroy();
      }
      cy.destroy();
    };
  }, [entities, relationships, onEntityPositionChange, onEntitySelect, onRelationshipCreate]);

  // Handle selected entity changes
  useEffect(() => {
    if (!cyRef.current) return;

    cyRef.current.nodes().unselect();
    if (selectedEntityId) {
      const node = cyRef.current.getElementById(selectedEntityId);
      if (node.length > 0) {
        node.select();
        // Center on selected node
        cyRef.current.animate({
          center: { eles: node },
          duration: 300,
        });
      }
    }
  }, [selectedEntityId]);

  // Handle zoom controls
  const handleZoomIn = useCallback(() => {
    if (cyRef.current) {
      const zoom = cyRef.current.zoom();
      cyRef.current.zoom({
        level: zoom * 1.2,
        renderedPosition: {
          x: cyRef.current.width() / 2,
          y: cyRef.current.height() / 2,
        },
      });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (cyRef.current) {
      const zoom = cyRef.current.zoom();
      cyRef.current.zoom({
        level: zoom * 0.8,
        renderedPosition: {
          x: cyRef.current.width() / 2,
          y: cyRef.current.height() / 2,
        },
      });
    }
  }, []);

  const handleFit = useCallback(() => {
    if (cyRef.current) {
      cyRef.current.fit(undefined, 50);
    }
  }, []);

  const handleLayout = useCallback((layoutName: string) => {
    if (!cyRef.current) return;

    const layoutOptions: Record<string, any> = {
      cose: {
        name: 'cose',
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 50,
        nodeRepulsion: () => 500000,
      },
      circle: {
        name: 'circle',
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 50,
      },
      breadthfirst: {
        name: 'breadthfirst',
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 50,
        directed: true,
      },
    };

    cyRef.current.layout(layoutOptions[layoutName] || layoutOptions.cose).run();
  }, []);

  // Context menu handlers
  const handleEditEntity = useCallback(() => {
    if (contextMenu?.entityId) {
      const entity = entities.find(
        (e) => e.id === contextMenu.entityId || e.stagedId === contextMenu.entityId
      );
      if (entity) {
        onEntityEdit(entity);
      }
    }
    setContextMenu(null);
  }, [contextMenu, entities, onEntityEdit]);

  const handleDeleteEntity = useCallback(() => {
    if (contextMenu?.entityId) {
      onEntityDelete(contextMenu.entityId);
    }
    setContextMenu(null);
  }, [contextMenu, onEntityDelete]);

  const handleDeleteRelationship = useCallback(() => {
    if (contextMenu?.relationshipId) {
      onRelationshipDelete(contextMenu.relationshipId);
    }
    setContextMenu(null);
  }, [contextMenu, onRelationshipDelete]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  return (
    <div className="relative h-full">
      {/* Graph Container */}
      <div ref={containerRef} className="w-full h-full bg-gray-50 dark:bg-gray-900" />

      {/* Floating Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <button
          onClick={handleZoomIn}
          className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Zoom In"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={handleZoomOut}
          className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Zoom Out"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <button
          onClick={handleFit}
          className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          title="Fit to View"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
            />
          </svg>
        </button>
        <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
        <select
          onChange={(e) => handleLayout(e.target.value)}
          className="p-2 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 text-sm"
          title="Layout"
        >
          <option value="cose">Force</option>
          <option value="circle">Circle</option>
          <option value="breadthfirst">Tree</option>
        </select>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3 z-10">
        <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Status</h4>
        <div className="space-y-1">
          <div className="flex items-center text-xs">
            <div className="w-3 h-3 rounded-full border-2 border-gray-400 mr-2" />
            <span className="text-gray-600 dark:text-gray-400">Unchanged</span>
          </div>
          <div className="flex items-center text-xs">
            <div className="w-3 h-3 rounded-full border-2 border-green-500 border-dashed mr-2" />
            <span className="text-gray-600 dark:text-gray-400">Added</span>
          </div>
          <div className="flex items-center text-xs">
            <div className="w-3 h-3 rounded-full border-2 border-yellow-500 mr-2" />
            <span className="text-gray-600 dark:text-gray-400">Modified</span>
          </div>
          <div className="flex items-center text-xs">
            <div className="w-3 h-3 rounded-full border-2 border-red-500 mr-2 opacity-50" />
            <span className="text-gray-600 dark:text-gray-400">Deleted</span>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entityId && (
            <>
              <button
                onClick={handleEditEntity}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                Edit Entity
              </button>
              <button
                onClick={handleDeleteEntity}
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Delete Entity
              </button>
            </>
          )}
          {contextMenu.relationshipId && (
            <button
              onClick={handleDeleteRelationship}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Delete Relationship
            </button>
          )}
        </div>
      )}
    </div>
  );
}
