'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import Tooltip from '@/components/Tooltip';

// Stat card component with click navigation
interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  href: string;
  colorClass: string;
  tooltip: string;
}

function StatCard({ title, value, subtitle, icon, href, colorClass, tooltip }: StatCardProps) {
  const router = useRouter();

  return (
    <Tooltip content={tooltip}>
      <button
        onClick={() => router.push(href)}
        className={`w-full text-left bg-gradient-to-br ${colorClass} rounded-xl shadow-sm border p-6 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer group`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{title}</p>
          <div className="p-2 rounded-lg opacity-80 group-hover:opacity-100 transition-opacity">
            {icon}
          </div>
        </div>
        <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
      </button>
    </Tooltip>
  );
}

interface DashboardStats {
  totalDocuments: number;
  totalEntities: number;
  pendingReviews: number;
  completedDocuments: number;
  failedDocuments: number;
  graphSize: {
    nodes: number;
    edges: number;
  };
  recentActivity: Array<{
    id: string;
    type: string;
    title: string;
    timestamp: string;
    status: string;
  }>;
}

export default function Dashboard() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/api/stats/dashboard`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoadingStats(false);
    }
  }, [authFetch]);

  useEffect(() => {
    // Fetch dashboard stats
    fetchStats();
  }, [fetchStats]);

  if (!user) {
    return null; // DashboardLayout will handle loading state
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Key Metrics */}
      <section className="mb-8" aria-labelledby="dashboard-overview-heading">
        <h2 id="dashboard-overview-heading" className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">Dashboard Overview</h2>
        {loadingStats ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6" role="status" aria-live="polite" aria-label="Loading dashboard statistics">
            <span className="sr-only">Loading dashboard statistics...</span>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 animate-pulse" aria-hidden="true">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3"></div>
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6" role="list">
            <StatCard
              title="Total Documents"
              value={stats.totalDocuments}
              href="/dashboard/documents"
              colorClass="from-white to-blue-50 dark:from-gray-800 dark:to-gray-800/50 border-blue-100 dark:border-gray-700"
              tooltip="View all documents - Click to manage"
              icon={
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              }
            />

            <StatCard
              title="Total Entities"
              value={stats.totalEntities}
              href="/dashboard/graph"
              colorClass="from-white to-green-50 dark:from-gray-800 dark:to-gray-800/50 border-green-100 dark:border-gray-700"
              tooltip="View extracted entities - Click to explore graph"
              icon={
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              }
            />

            <StatCard
              title="Pending Reviews"
              value={stats.pendingReviews}
              href="/dashboard/review"
              colorClass="from-white to-yellow-50 dark:from-gray-800 dark:to-gray-800/50 border-yellow-100 dark:border-gray-700"
              tooltip="Items awaiting review - Click to review"
              icon={
                <div className="p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg">
                  <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
              }
            />

            <StatCard
              title="Graph Size"
              value={stats.graphSize.nodes}
              subtitle={`Nodes / ${stats.graphSize.edges} Edges`}
              href="/dashboard/graph"
              colorClass="from-white to-purple-50 dark:from-gray-800 dark:to-gray-800/50 border-purple-100 dark:border-gray-700"
              tooltip="Knowledge graph size - Click to visualize"
              icon={
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
              }
            />
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4" role="alert" aria-live="assertive">
            <p className="text-sm text-yellow-800">Unable to load dashboard statistics</p>
          </div>
        )}
      </section>

      {/* Recent Activity */}
      {stats && stats.recentActivity.length > 0 && (
        <section className="mb-8" aria-labelledby="recent-activity-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="recent-activity-heading" className="text-xl font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
            <button
              onClick={() => router.push('/dashboard/documents')}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
            >
              View all →
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stats.recentActivity.slice(0, 6).map((activity) => (
              <button
                key={activity.id}
                onClick={() => router.push('/dashboard/documents')}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all duration-200 text-left group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center">
                    <div className={`p-2 rounded-lg mr-3 ${
                      activity.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30' :
                      activity.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30' :
                      'bg-red-100 dark:bg-red-900/30'
                    }`}>
                      <svg className={`w-5 h-5 ${
                        activity.status === 'completed' ? 'text-green-600 dark:text-green-400' :
                        activity.status === 'pending' ? 'text-yellow-600 dark:text-yellow-400' :
                        'text-red-600 dark:text-red-400'
                      }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {activity.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {new Date(activity.timestamp).toLocaleDateString()} at {new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium shrink-0 ml-2 ${
                    activity.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' :
                    activity.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300' :
                    'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                  }`}>
                    {activity.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <button
            onClick={() => router.push('/dashboard/upload')}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-700 hover:scale-[1.02] transition-all duration-200 text-left group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-xl group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition-colors">
                <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">Upload Documents</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Upload and process business documents
            </p>
          </button>

          <button
            onClick={() => router.push('/dashboard/graph')}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-lg hover:border-green-200 dark:hover:border-green-700 hover:scale-[1.02] transition-all duration-200 text-left group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-xl group-hover:bg-green-200 dark:group-hover:bg-green-900/50 transition-colors">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <svg className="w-5 h-5 text-gray-400 group-hover:text-green-500 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">Knowledge Graph</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Explore business process relationships
            </p>
          </button>

          <button
            onClick={() => router.push('/dashboard/query')}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-lg hover:border-purple-200 dark:hover:border-purple-700 hover:scale-[1.02] transition-all duration-200 text-left group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50 transition-colors">
                <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <svg className="w-5 h-5 text-gray-400 group-hover:text-purple-500 group-hover:translate-x-1 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">GraphRAG Query</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Ask AI-powered questions about your processes
            </p>
          </button>
        </div>
      </section>
    </div>
  );
}
