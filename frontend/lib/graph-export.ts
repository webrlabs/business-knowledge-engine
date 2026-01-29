import type { Core } from 'cytoscape';

// Extend Core type to include svg method from cytoscape-svg extension
interface CyWithSvg extends Core {
  svg(options?: { full?: boolean; bg?: string }): string;
}

export interface GraphExportData {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    description?: string;
    confidence?: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
  }>;
  metadata: {
    exportedAt: string;
    nodeCount: number;
    edgeCount: number;
  };
}

/**
 * Export graph as PNG image
 */
export function exportAsPNG(cy: Core, filename: string = 'knowledge-graph.png'): void {
  const png = cy.png({
    full: true,
    scale: 2,
    bg: '#ffffff',
  });

  // Create download link
  const link = document.createElement('a');
  link.href = png;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Export graph as SVG
 * Note: Requires cytoscape-svg extension to be registered
 */
export function exportAsSVG(cy: Core, filename: string = 'knowledge-graph.svg'): void {
  const cyWithSvg = cy as CyWithSvg;

  // Check if svg method is available (extension loaded)
  if (typeof cyWithSvg.svg !== 'function') {
    console.warn('SVG export not available. cytoscape-svg extension may not be loaded.');
    // Fallback to PNG
    exportAsPNG(cy, filename.replace('.svg', '.png'));
    return;
  }

  const svg = cyWithSvg.svg({
    full: true,
    bg: '#ffffff',
  });

  // Create blob and download
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Export graph data as JSON
 */
export function exportAsJSON(cy: Core, filename: string = 'knowledge-graph.json'): void {
  const nodes = cy.nodes().map((node) => ({
    id: node.id(),
    label: node.data('label'),
    type: node.data('type'),
    description: node.data('description'),
    confidence: node.data('confidence'),
  }));

  const edges = cy.edges().map((edge) => ({
    id: edge.id(),
    source: edge.source().id(),
    target: edge.target().id(),
    label: edge.data('label'),
  }));

  const exportData: GraphExportData = {
    nodes,
    edges,
    metadata: {
      exportedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Export graph as CSV (nodes.csv and edges.csv)
 */
export function exportAsCSV(cy: Core, filenamePrefix: string = 'knowledge-graph'): void {
  // Export nodes
  const nodesCSV = generateNodesCSV(cy);
  downloadCSV(nodesCSV, `${filenamePrefix}-nodes.csv`);

  // Export edges
  const edgesCSV = generateEdgesCSV(cy);
  downloadCSV(edgesCSV, `${filenamePrefix}-edges.csv`);
}

function generateNodesCSV(cy: Core): string {
  const headers = ['id', 'label', 'type', 'description', 'confidence'];
  const rows = cy.nodes().map((node) => {
    const data = node.data();
    return [
      escapeCSV(data.id || ''),
      escapeCSV(data.label || ''),
      escapeCSV(data.type || ''),
      escapeCSV(data.description || ''),
      data.confidence !== undefined ? String(data.confidence) : '',
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function generateEdgesCSV(cy: Core): string {
  const headers = ['id', 'source', 'target', 'label', 'confidence'];
  const rows = cy.edges().map((edge) => {
    const data = edge.data();
    return [
      escapeCSV(data.id || ''),
      escapeCSV(edge.source().id()),
      escapeCSV(edge.target().id()),
      escapeCSV(data.label || ''),
      data.confidence !== undefined ? String(data.confidence) : '',
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Get graph statistics for display
 */
export function getGraphStatistics(cy: Core): {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: Record<string, number>;
  avgDegree: number;
  isolatedNodes: number;
  mostConnected: Array<{ id: string; label: string; degree: number }>;
} {
  const nodes = cy.nodes();
  const edges = cy.edges();

  // Count by type
  const nodeTypes: Record<string, number> = {};
  nodes.forEach((node) => {
    const type = node.data('type') || 'Unknown';
    nodeTypes[type] = (nodeTypes[type] || 0) + 1;
  });

  // Calculate degrees
  const degrees = nodes.map((node) => ({
    id: node.id(),
    label: node.data('label'),
    degree: node.degree(false),
  }));

  const totalDegree = degrees.reduce((sum, d) => sum + d.degree, 0);
  const avgDegree = nodes.length > 0 ? totalDegree / nodes.length : 0;

  // Isolated nodes (degree = 0)
  const isolatedNodes = degrees.filter((d) => d.degree === 0).length;

  // Most connected nodes
  const mostConnected = degrees
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 10);

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodeTypes,
    avgDegree: Math.round(avgDegree * 100) / 100,
    isolatedNodes,
    mostConnected,
  };
}
