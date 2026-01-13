'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import HelpTooltip from '@/components/HelpTooltip';
import dynamic from 'next/dynamic';

// Dynamically import SafeGraphVisualization to avoid SSR issues with Cytoscape
// SafeGraphVisualization wraps the graph with an error boundary
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
  processCount: number;
  taskCount: number;
  roleCount: number;
  systemCount: number;
}

export default function GraphPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="flex mb-6" aria-label="Breadcrumb">
          <ol className="inline-flex items-center space-x-1 md:space-x-3">
            <li className="inline-flex items-center">
              <a href="/dashboard" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                Home
              </a>
            </li>
            <li>
              <div className="flex items-center">
                <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700 dark:text-gray-200 font-medium">Knowledge Graph</span>
              </div>
            </li>
          </ol>
        </nav>

        {/* Page Header */}
        <div className="mb-8">
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
            <button
              onClick={fetchGraphData}
              disabled={isLoading}
              className="btn-secondary btn-sm"
            >
              {isLoading ? 'Loading...' : 'Refresh'}
            </button>
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
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <div className="flex items-center">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="text-lg font-medium text-red-900 dark:text-red-100">Error loading graph</h3>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
              </div>
            </div>
            <button
              onClick={fetchGraphData}
              className="mt-4 btn-secondary btn-sm"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Empty State */}
        {isEmpty && !isLoading && !error && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12">
          <div className="max-w-md mx-auto text-center">
            {/* Icon */}
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

            {/* Heading */}
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              No Graph Data Available
            </h3>

            {/* Description */}
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              The knowledge graph is currently empty. Upload and process documents to build your business process knowledge graph.
            </p>

            {/* Help Text */}
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

            {/* Action Button */}
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

            {/* Secondary Action */}
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
            {/* Graph Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Nodes</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {stats?.totalNodes ?? graphData.nodes.length}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Edges</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {stats?.totalEdges ?? graphData.edges.length}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Processes</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {stats?.processCount ?? graphData.nodes.filter(n => n.type === 'Process').length}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Tasks</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {stats?.taskCount ?? graphData.nodes.filter(n => n.type === 'Task').length}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Graph Visualization */}
            <GraphVisualization data={graphData} height="700px" />

            {/* Help Text */}
            <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
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
                    Interacting with the graph:
                  </p>
                  <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
                    <li>Click and drag to pan around the graph</li>
                    <li>Use mouse wheel or zoom controls to zoom in/out</li>
                    <li>Click on nodes to view details</li>
                    <li>Click the reset button to fit the entire graph in view</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h4 className="font-semibold text-blue-900 dark:text-blue-100">Interactive Visualization</h4>
            </div>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Zoom, pan, and explore your knowledge graph with an intuitive interface
            </p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg p-6 border border-purple-200 dark:border-purple-800">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-purple-600 dark:bg-purple-500 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              </div>
              <h4 className="font-semibold text-purple-900 dark:text-purple-100">Relationship Discovery</h4>
            </div>
            <p className="text-sm text-purple-800 dark:text-purple-300">
              Discover connections between processes, roles, systems, and policies
            </p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-lg p-6 border border-green-200 dark:border-green-800">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-green-600 dark:bg-green-500 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h4 className="font-semibold text-green-900 dark:text-green-100">Graph Analytics</h4>
            </div>
            <p className="text-sm text-green-800 dark:text-green-300">
              Analyze process complexity, identify bottlenecks, and optimize workflows
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
