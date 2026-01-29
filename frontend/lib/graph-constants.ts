// Shared constants for the knowledge graph visualization

export const NODE_TYPES = [
  'Process',
  'Task',
  'Role',
  'System',
  'DataAsset',
  'Form',
  'Policy',
  'Procedure',
  'Directive',
  'Guide',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_COLORS: Record<NodeType, string> = {
  Process: '#2563EB',      // Blue - Core business workflows
  Task: '#16A34A',         // Green - Actionable items
  Role: '#EA580C',         // Orange - People/responsibilities
  System: '#7C3AED',       // Violet - Technical systems
  DataAsset: '#0EA5E9',    // Sky - Data/information assets
  Form: '#EAB308',         // Yellow - Input forms
  Policy: '#DC2626',       // Red - Governance rules
  Procedure: '#0D9488',    // Teal - Step-by-step processes
  Directive: '#DB2777',    // Pink - Commands/mandates
  Guide: '#64748B',        // Slate - Reference documentation
};

// Helper to get color with fallback
export function getNodeColor(type: string): string {
  return NODE_COLORS[type as NodeType] || '#64748B';
}
