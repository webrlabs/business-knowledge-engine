'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import HelpTooltip from '@/components/HelpTooltip';
import CommunityPanel from '@/components/CommunityPanel';
import dynamic from 'next/dynamic';
import { Community, CommunityMember, CommunityEdge } from '@/components/CommunityVisualization';

// Dynamically import SafeCommunityVisualization to avoid SSR issues with Cytoscape
const CommunityVisualization = dynamic(
  () => import('@/components/SafeCommunityVisualization'),
  { ssr: false }
);

interface CommunitySummary {
  communityId: string | number;
  title?: string;
  summary?: string;
  memberCount: number;
  dominantType?: string;
  typeCounts?: Record<string, number>;
  relationshipCount?: number;
  keyEntities?: string[];
  generatedAt?: string;
}

interface CommunitiesResponse {
  summaries: Record<string, CommunitySummary>;
  metadata?: {
    source?: string;
    lastFullGeneration?: string;
    lastModularity?: number;
    lastCommunityCount?: number;
  };
}

interface GraphData {
  nodes: Array<{ id: string; label: string; type: string }>;
  edges: Array<{ id: string; source: string; target: string; label?: string }>;
}

export default function CommunitiesPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [edges, setEdges] = useState<CommunityEdge[]>([]);
  const [selectedCommunity, setSelectedCommunity] = useState<Community | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<CommunitiesResponse['metadata'] | null>(null);

  const fetchCommunities = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch community summaries
      const communitiesResponse = await authFetch(`${API_BASE_URL}/api/graphrag/communities`);

      if (!communitiesResponse.ok) {
        if (communitiesResponse.status === 404) {
          setCommunities([]);
          return;
        }
        throw new Error('Failed to fetch communities');
      }

      const data: CommunitiesResponse = await communitiesResponse.json();
      setMetadata(data.metadata || null);

      // Convert summaries object to array
      const communityList: Community[] = Object.values(data.summaries || {}).map((summary) => ({
        communityId: summary.communityId,
        title: summary.title,
        summary: summary.summary,
        memberCount: summary.memberCount,
        dominantType: summary.dominantType,
        typeCounts: summary.typeCounts,
        relationshipCount: summary.relationshipCount,
        keyEntities: summary.keyEntities,
        generatedAt: summary.generatedAt,
      }));

      // Fetch graph data to get members and edges
      const graphResponse = await authFetch(`${API_BASE_URL}/api/graph/entities?limit=500`);

      if (graphResponse.ok) {
        const graphData: GraphData = await graphResponse.json();

        // Map edges
        setEdges(graphData.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.label,
        })));

        // We need to get community assignments - fetch the raw community data
        try {
          const rawCommunitiesResponse = await authFetch(`${API_BASE_URL}/api/graphrag/communities/raw`);
          if (rawCommunitiesResponse.ok) {
            const rawData = await rawCommunitiesResponse.json();
            // Merge member data if available
            communityList.forEach((community) => {
              const rawCommunity = rawData.communities?.find(
                (c: { id: number }) => String(c.id) === String(community.communityId)
              );
              if (rawCommunity?.members) {
                community.members = rawCommunity.members;
              }
            });
          }
        } catch {
          // Raw communities endpoint might not exist, that's okay
          // Assign nodes to communities based on available data
          const nodesByCommunity: Record<string, CommunityMember[]> = {};

          // If we have key entities, use them as members
          communityList.forEach((community) => {
            if (community.keyEntities && community.keyEntities.length > 0) {
              community.members = community.keyEntities.map((name, idx) => {
                // Try to find the actual node in graph data
                const node = graphData.nodes.find(
                  (n) => n.label === name || n.id === name
                );
                return {
                  id: node?.id || `${community.communityId}_${idx}`,
                  name: name,
                  type: node?.type || community.dominantType || 'Unknown',
                };
              });
            }
          });
        }
      }

      setCommunities(communityList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while fetching communities');
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  const handleGenerateCommunities = async (forceRefresh = false) => {
    try {
      setIsGenerating(true);
      setError(null);

      const response = await authFetch(`${API_BASE_URL}/api/graphrag/communities/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate communities');
      }

      // Refresh the communities list
      await fetchCommunities();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while generating communities');
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    fetchCommunities();
  }, [isAuthenticated, router, fetchCommunities]);

  if (!user) {
    return null;
  }

  const isEmpty = communities.length === 0;

  return (
    <>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Community Explorer
                </h2>
                <HelpTooltip
                  content="Communities are clusters of related entities detected by the Louvain algorithm. Each community groups entities that frequently interact or share common relationships."
                  learnMoreLink="#"
                />
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                Explore detected communities and their relationships in your knowledge graph
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchCommunities}
                disabled={isLoading}
                className="btn-secondary btn-sm"
              >
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>
              <button
                onClick={() => handleGenerateCommunities(true)}
                disabled={isGenerating || isLoading}
                className="btn-primary btn-sm"
              >
                {isGenerating ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12">
            <div className="flex flex-col items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">Loading communities...</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-8 text-center">
            <div className="flex flex-col items-center">
              <svg
                className="w-12 h-12 text-amber-500 dark:text-amber-400 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <h3 className="text-lg font-medium text-amber-900 dark:text-amber-100 mb-2">Notice</h3>
              <p className="text-amber-800 dark:text-amber-200 mb-6 max-w-md">{error}</p>
              <button onClick={fetchCommunities} className="btn-secondary">
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Empty State */}
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
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>

              <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                No Communities Detected
              </h3>

              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Communities haven&apos;t been generated yet. Generate communities to discover clusters of related entities in your knowledge graph.
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
                      What are communities?
                    </p>
                    <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
                      <li>Groups of entities that are closely related</li>
                      <li>Detected using the Louvain algorithm</li>
                      <li>Each community gets an AI-generated summary</li>
                      <li>Helps discover patterns in your knowledge graph</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleGenerateCommunities(false)}
                disabled={isGenerating}
                className="btn-primary inline-flex items-center shadow-sm"
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Generating...
                  </>
                ) : (
                  <>
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
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    Generate Communities
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Communities Display */}
        {!isEmpty && !isLoading && !error && (
          <div className="space-y-6">
            {/* Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Communities</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {communities.length}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-blue-600 dark:text-blue-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Members</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {communities.reduce((acc, c) => acc + c.memberCount, 0)}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-green-600 dark:text-green-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Avg. Size</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                      {communities.length > 0
                        ? Math.round(
                            communities.reduce((acc, c) => acc + c.memberCount, 0) /
                              communities.length
                          )
                        : 0}
                    </p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-purple-600 dark:text-purple-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
              {metadata?.lastModularity !== undefined && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Modularity</p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                        {metadata.lastModularity.toFixed(3)}
                      </p>
                    </div>
                    <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-6 h-6 text-amber-600 dark:text-amber-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Main Content: Visualization + Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Visualization */}
              <div className="lg:col-span-2">
                <CommunityVisualization
                  communities={communities}
                  edges={edges}
                  height="700px"
                  onCommunitySelect={setSelectedCommunity}
                />
              </div>

              {/* Community Panel */}
              <div className="lg:col-span-1">
                <CommunityPanel
                  community={selectedCommunity}
                  onClose={() => setSelectedCommunity(null)}
                />
              </div>
            </div>

            {/* Help Text */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
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
                    Exploring communities:
                  </p>
                  <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
                    <li>Hover over community names to highlight them in the graph</li>
                    <li>Click on communities or nodes to view details</li>
                    <li>Use the controls to change layout and color modes</li>
                    <li>Zoom and pan to explore larger graphs</li>
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
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h4 className="font-semibold text-blue-900 dark:text-blue-100">Louvain Algorithm</h4>
            </div>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Automatically detects communities using modularity optimization
            </p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 rounded-lg p-6 border border-purple-200 dark:border-purple-800">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-purple-600 dark:bg-purple-500 rounded-lg flex items-center justify-center mr-3">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
              </div>
              <h4 className="font-semibold text-purple-900 dark:text-purple-100">AI Summaries</h4>
            </div>
            <p className="text-sm text-purple-800 dark:text-purple-300">
              Each community gets an AI-generated summary describing its purpose
            </p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 rounded-lg p-6 border border-green-200 dark:border-green-800">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-green-600 dark:bg-green-500 rounded-lg flex items-center justify-center mr-3">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              </div>
              <h4 className="font-semibold text-green-900 dark:text-green-100">GraphRAG Integration</h4>
            </div>
            <p className="text-sm text-green-800 dark:text-green-300">
              Community context enhances query responses with structured knowledge
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
