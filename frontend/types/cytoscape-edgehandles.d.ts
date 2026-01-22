declare module 'cytoscape-edgehandles' {
  import cytoscape from 'cytoscape';

  interface EdgehandlesOptions {
    preview?: boolean;
    hoverDelay?: number;
    snap?: boolean;
    snapThreshold?: number;
    snapFrequency?: number;
    noEdgeEventsInDraw?: boolean;
    disableBrowserGestures?: boolean;
    handleNodes?: string;
    handlePosition?: (node: cytoscape.NodeSingular) => 'middle top' | 'middle bottom' | 'left' | 'right';
    handleInDrawMode?: boolean;
    edgeType?: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular) => 'flat' | 'node';
    loopAllowed?: (node: cytoscape.NodeSingular) => boolean;
    edgeParams?: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular, i?: number) => object;
    complete?: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular, addedEdge: cytoscape.EdgeSingular) => void;
    stop?: (sourceNode: cytoscape.NodeSingular) => void;
    cancel?: (sourceNode: cytoscape.NodeSingular, cancelledTargets: cytoscape.NodeCollection) => void;
    hoverover?: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular) => void;
    hoverout?: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular) => void;
    previewon?: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular, previewEdge: cytoscape.EdgeSingular) => void;
    previewoff?: (sourceNode: cytoscape.NodeSingular, targetNode: cytoscape.NodeSingular, previewEdge: cytoscape.EdgeSingular) => void;
    drawon?: () => void;
    drawoff?: () => void;
  }

  interface EdgehandlesInstance {
    start: (sourceNode: cytoscape.NodeSingular) => void;
    stop: () => void;
    hide: () => void;
    show: () => void;
    enable: () => void;
    disable: () => void;
    enableDrawMode: () => void;
    disableDrawMode: () => void;
    destroy: () => void;
  }

  const edgehandles: cytoscape.Ext;

  export default edgehandles;
}

declare namespace cytoscape {
  interface Core {
    edgehandles: (options?: import('cytoscape-edgehandles').EdgehandlesOptions) => import('cytoscape-edgehandles').EdgehandlesInstance;
  }
}
