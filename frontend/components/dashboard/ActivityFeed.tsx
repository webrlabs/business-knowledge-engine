'use client';

import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { ActivityItem, ActivityFilter } from '@/lib/gamification-types';
import { useGamificationStore } from '@/lib/gamification-store';

const FILTER_TABS: { label: string; value: ActivityFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'My Activity', value: 'my' },
  { label: 'Team', value: 'team' },
];

const PAGE_SIZE = 20;

function TypeIcon({ type }: { type: ActivityItem['type'] }) {
  const iconClass = 'w-4 h-4';

  switch (type) {
    case 'upload':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      );
    case 'review':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case 'verify':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'badge':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
}

function getTypeColor(type: ActivityItem['type']): string {
  switch (type) {
    case 'upload':
      return 'text-blue-500 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400';
    case 'review':
      return 'text-purple-500 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-400';
    case 'verify':
      return 'text-green-500 bg-green-100 dark:bg-green-900/30 dark:text-green-400';
    case 'badge':
      return 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400';
    default:
      return 'text-gray-500 bg-gray-100 dark:bg-gray-900/30 dark:text-gray-400';
  }
}

function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

function SkeletonItem() {
  return (
    <div className="flex items-start gap-3 p-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      </div>
      <div className="h-5 w-12 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0" />
    </div>
  );
}

export default function ActivityFeed() {
  const authFetch = useAuthFetch();
  const { activityFilter, setActivityFilter, setActivityFeed } = useGamificationStore();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const fetchActivity = useCallback(
    async (filter: ActivityFilter, currentOffset: number, append: boolean) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
        }

        const res = await authFetch(
          `${API_BASE_URL}/api/gamification/activity-feed?filter=${filter}&limit=${PAGE_SIZE}&offset=${currentOffset}`
        );

        if (!res.ok) throw new Error('Failed to fetch activity feed');

        const data: ActivityItem[] = await res.json();

        if (append) {
          setItems((prev) => [...prev, ...data]);
        } else {
          setItems(data);
        }

        setActivityFeed(append ? [...items, ...data] : data);
        setHasMore(data.length === PAGE_SIZE);
      } catch (err) {
        console.error('Activity feed error:', err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [authFetch, setActivityFeed, items]
  );

  // Fetch on mount and when filter changes
  useEffect(() => {
    setOffset(0);
    fetchActivity(activityFilter, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityFilter]);

  const handleLoadMore = () => {
    const nextOffset = offset + PAGE_SIZE;
    setOffset(nextOffset);
    fetchActivity(activityFilter, nextOffset, true);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          Activity Feed
        </h3>

        {/* Filter Tabs */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-900/50 rounded-lg p-0.5">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActivityFilter(tab.value)}
              className={`flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all duration-200 ${
                activityFilter === tab.value
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed Items */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700/50 max-h-[400px] overflow-y-auto">
        {loading ? (
          <>
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </>
        ) : items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No activity yet
            </p>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-750 dark:hover:bg-gray-900/30 transition-colors"
            >
              {/* Type Icon */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${getTypeColor(item.type)}`}
              >
                <TypeIcon type={item.type} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-gray-100">
                  <span className="font-medium">{item.userName}</span>{' '}
                  <span className="text-gray-600 dark:text-gray-400">
                    {item.action}
                  </span>
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {formatRelativeTime(item.timestamp)}
                </p>
              </div>

              {/* Points Badge */}
              {item.points > 0 && (
                <span className="shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                  +{item.points}
                </span>
              )}
            </div>
          ))
        )}
      </div>

      {/* Load More */}
      {!loading && hasMore && items.length > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700/50">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 py-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </span>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
