'use client';

import { useState, useEffect } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { useGraphStore } from '@/lib/graph-store';
import { NODE_COLORS, getNodeColor } from '@/lib/graph-constants';

interface AnalyticsData {
  topConnected: Array<{
    id: string;
    name: string;
    type: string;
    degree: number;
  }>;
  isolatedNodes: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  metrics: {
    nodeCount: number;
    edgeCount: number;
    density: number;
    avgDegree: number;
  };
  nodeTypeDistribution: Record<string, number>;
}

interface AnalyticsDashboardProps {
  isOpen: boolean;
  onToggle: () => void;
  onSelectNode: (nodeName: string) => void;
  localStats?: {
    nodeCount: number;
    edgeCount: number;
    nodeTypes: Record<string, number>;
    avgDegree: number;
    isolatedNodes: number;
    mostConnected: Array<{ id: string; label: string; degree: number }>;
  };
}


function MetricCard({
  label,
  value,
  icon,
  color = 'blue',
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
}) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1.5 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
          {icon}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 uppercase">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function DensityRing({ density }: { density: number }) {
  const percentage = Math.min(density * 100, 100);
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg className="w-24 h-24 transform -rotate-90">
        <circle
          cx="48"
          cy="48"
          r="40"
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          className="text-gray-200 dark:text-gray-700"
        />
        <circle
          cx="48"
          cy="48"
          r="40"
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="text-blue-600 dark:text-blue-400 transition-all duration-500"
        />
      </svg>
      <span className="absolute text-lg font-bold text-gray-900 dark:text-white">
        {percentage.toFixed(1)}%
      </span>
    </div>
  );
}

function TypeDistributionBar({
  type,
  count,
  total,
}: {
  type: string;
  count: number;
  total: number;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: getNodeColor(type) }}
          />
          <span className="text-gray-700 dark:text-gray-300">{type}</span>
        </div>
        <span className="text-gray-500 dark:text-gray-400">
          {count} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${percentage}%`,
            backgroundColor: getNodeColor(type),
          }}
        />
      </div>
    </div>
  );
}

export default function AnalyticsDashboard({
  isOpen,
  onToggle,
  onSelectNode,
  localStats,
}: AnalyticsDashboardProps) {
  const authFetch = useAuthFetch();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!isOpen) return;

      setLoading(true);
      setError(null);

      try {
        // Fetch analytics from backend APIs
        const [topConnectedRes, isolatedRes, metricsRes] = await Promise.all([
          authFetch(`${API_BASE_URL}/api/graphrag/analytics/top-connected?limit=10`).catch(() => null),
          authFetch(`${API_BASE_URL}/api/graphrag/analytics/isolated`).catch(() => null),
          authFetch(`${API_BASE_URL}/api/graphrag/analytics/metrics`).catch(() => null),
        ]);

        const topConnected = topConnectedRes?.ok ? await topConnectedRes.json() : null;
        const isolated = isolatedRes?.ok ? await isolatedRes.json() : null;
        const metrics = metricsRes?.ok ? await metricsRes.json() : null;

        // Use API data if available, otherwise fall back to local stats
        setAnalytics({
          topConnected: topConnected?.nodes || localStats?.mostConnected?.map((n) => ({
            id: n.id,
            name: n.label,
            type: 'Unknown',
            degree: n.degree,
          })) || [],
          isolatedNodes: isolated?.nodes || [],
          metrics: metrics || {
            nodeCount: localStats?.nodeCount || 0,
            edgeCount: localStats?.edgeCount || 0,
            density: localStats?.nodeCount && localStats?.edgeCount
              ? (2 * localStats.edgeCount) / (localStats.nodeCount * (localStats.nodeCount - 1))
              : 0,
            avgDegree: localStats?.avgDegree || 0,
          },
          nodeTypeDistribution: localStats?.nodeTypes || {},
        });
      } catch (err) {
        console.error('Error fetching analytics:', err);
        // Fall back to local stats
        if (localStats) {
          setAnalytics({
            topConnected: localStats.mostConnected.map((n) => ({
              id: n.id,
              name: n.label,
              type: 'Unknown',
              degree: n.degree,
            })),
            isolatedNodes: [],
            metrics: {
              nodeCount: localStats.nodeCount,
              edgeCount: localStats.edgeCount,
              density: localStats.nodeCount > 1
                ? (2 * localStats.edgeCount) / (localStats.nodeCount * (localStats.nodeCount - 1))
                : 0,
              avgDegree: localStats.avgDegree,
            },
            nodeTypeDistribution: localStats.nodeTypes,
          });
        } else {
          setError('Failed to load analytics');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [isOpen, authFetch, localStats]);

  const data = analytics || {
    topConnected: localStats?.mostConnected?.map((n) => ({
      id: n.id,
      name: n.label,
      type: 'Unknown',
      degree: n.degree,
    })) || [],
    isolatedNodes: [],
    metrics: {
      nodeCount: localStats?.nodeCount || 0,
      edgeCount: localStats?.edgeCount || 0,
      density: 0,
      avgDegree: localStats?.avgDegree || 0,
    },
    nodeTypeDistribution: localStats?.nodeTypes || {},
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <span className="font-semibold text-gray-900 dark:text-white">Graph Analytics</span>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isOpen && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  label="Nodes"
                  value={data.metrics.nodeCount}
                  color="blue"
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="3" strokeWidth={2} />
                    </svg>
                  }
                />
                <MetricCard
                  label="Edges"
                  value={data.metrics.edgeCount}
                  color="purple"
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                    </svg>
                  }
                />
                <MetricCard
                  label="Avg Degree"
                  value={data.metrics.avgDegree.toFixed(2)}
                  color="green"
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                    </svg>
                  }
                />
                <MetricCard
                  label="Isolated"
                  value={data.isolatedNodes.length || localStats?.isolatedNodes || 0}
                  color="amber"
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                />
              </div>

              {/* Graph Density */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">Graph Density</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Ratio of actual to possible connections
                  </p>
                </div>
                <DensityRing density={data.metrics.density} />
              </div>

              {/* Node Type Distribution */}
              {Object.keys(data.nodeTypeDistribution).length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-3">Node Types</p>
                  <div className="space-y-3">
                    {Object.entries(data.nodeTypeDistribution)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => (
                        <TypeDistributionBar
                          key={type}
                          type={type}
                          count={count}
                          total={data.metrics.nodeCount}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Most Connected Nodes */}
              {data.topConnected.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-3">Most Connected</p>
                  <div className="space-y-2">
                    {data.topConnected.slice(0, 5).map((node, index) => (
                      <button
                        key={node.id}
                        onClick={() => onSelectNode(node.name)}
                        className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 flex items-center justify-center text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded">
                            {index + 1}
                          </span>
                          <div
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: getNodeColor(node.type) }}
                          />
                          <span className="text-sm text-gray-900 dark:text-white truncate max-w-[150px]">
                            {node.name}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {node.degree} connections
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
