'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { useGraphStore } from '@/lib/graph-store';

import HelpTooltip from '@/components/HelpTooltip';
import dynamic from 'next/dynamic';

// Dynamically import SafeGraphVisualization to avoid SSR issues with Cytoscape
const GraphVisualization = dynamic(
  () => import('@/components/SafeGraphVisualization'),
  { ssr: false }
);

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

interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  labelCounts?: Record<string, number>;
}

export default function GraphPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Graph store for filtering
  const {
    selectedNodeTypes,
    connectivityFilter,
    confidenceThreshold,
    toggleNodeType,
    clearAllFilters
  } = useGraphStore();

  const fetchGraphData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch graph stats
      const statsResponse = await authFetch(`${API_BASE_URL}/api/graphrag/stats`);

      if (!statsResponse.ok) {
        throw new Error('Failed to fetch graph statistics');
      }

      const statsData = await statsResponse.json();
      setStats(statsData);

      // Fetch graph data if there are nodes
      if (statsData.totalNodes > 0) {
        const graphResponse = await authFetch(`${API_BASE_URL}/api/graph/entities?limit=500`);

        if (!graphResponse.ok) {
          throw new Error('Failed to fetch graph data');
        }

        const data = await graphResponse.json();
        setGraphData(data);
      } else {
        setGraphData(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while fetching graph data');
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    fetchGraphData();
  }, [isAuthenticated, router, fetchGraphData]);

  if (!user) {
    return null;
  }

  const isEmpty = !graphData || graphData.nodes.length === 0;

  // Calculate active filters for chips display
  const activeFilters: Array<{ type: string; count: number }> = [];
  if (graphData) {
    selectedNodeTypes.forEach((type) => {
      const count = graphData.nodes.filter((n) => n.type === type).length;
      activeFilters.push({ type, count });
    });
  }

  const hasActiveFilters =
    selectedNodeTypes.size > 0 ||
    connectivityFilter !== 'all' ||
    confidenceThreshold > 0;

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Knowledge Graph</h2>
                <HelpTooltip
                  content="The Knowledge Graph visualizes relationships between business entities like processes, tasks, roles, and systems. Use the controls to zoom, pan, and filter the graph to explore connections."
                  learnMoreLink="#"
                />
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                Explore the relationships between business processes, tasks, roles, and systems
              </p>
            </div>
            <div className="flex gap-2">
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="btn-secondary btn-sm"
                >
                  Clear Filters
                </button>
              )}
              <button
                onClick={fetchGraphData}
                disabled={isLoading}
                className="btn-secondary btn-sm"
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12">
            <div className="flex flex-col items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading knowledge graph...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-8 text-center">
            <div className="flex flex-col items-center">
              <svg className="w-12 h-12 text-amber-500 dark:text-amber-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="text-lg font-medium text-amber-900 dark:text-amber-100 mb-2">Notice</h3>
              <p className="text-amber-800 dark:text-amber-200 mb-6 max-w-md">
                {error === 'Failed to fetch graph statistics' ? 'No graph data is currently available.' : error}
              </p>
              <button
                onClick={fetchGraphData}
                className="btn-secondary"
              >
                Refresh Data
              </button>
            </div>
          </div>
        )}

        {/* Empty State - No data at all */}
        {isEmpty && !isLoading && !error && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12">
            <div className="max-w-md mx-auto text-center">
              <div className="mb-6">
                <svg
                  className="w-24 h-24 text-gray-300 dark:text-gray-600 mx-auto"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                  />
                </svg>
              </div>

              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                No Graph Data Available
              </h3>

              <p className="text-gray-600 dark:text-gray-400 mb-6">
                The knowledge graph is currently empty. Upload and process documents to build your business process knowledge graph.
              </p>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6 text-left">
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                      How to build your knowledge graph:
                    </p>
                    <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-decimal list-inside">
                      <li>Upload business process documents (PDFs, Word, PowerPoint, Visio)</li>
                      <li>Documents are automatically analyzed using Azure AI</li>
                      <li>Entities and relationships are extracted</li>
                      <li>Review and approve extracted entities</li>
                      <li>Approved entities appear in the knowledge graph</li>
                    </ol>
                  </div>
                </div>
              </div>

              <button
                onClick={() => router.push('/dashboard/upload')}
                className="btn-primary inline-flex items-center shadow-sm"
              >
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                Upload Documents
              </button>

              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                or{' '}
                <a
                  href="/dashboard/query"
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                >
                  try the GraphRAG query interface
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Graph Display */}
        {!isEmpty && !isLoading && !error && graphData && (
          <div>
            {/* Graph Visualization */}
            <GraphVisualization
              data={graphData}
              height="750px"
            />
          </div>
        )}
      </div>
    </>
  );
}
