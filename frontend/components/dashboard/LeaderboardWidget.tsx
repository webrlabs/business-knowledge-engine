'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { LeaderboardEntry, LeaderboardPeriod } from '@/lib/gamification-types';
import { useGamificationStore } from '@/lib/gamification-store';
import { useAuth } from '@/lib/auth';

const PERIOD_TABS: { label: string; value: LeaderboardPeriod }[] = [
  { label: 'Week', value: 'weekly' },
  { label: 'Month', value: 'monthly' },
  { label: 'All', value: 'all_time' },
];

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-yellow-300 to-yellow-500 flex items-center justify-center shadow-sm shadow-yellow-500/30">
        <svg className="w-3.5 h-3.5 text-yellow-900" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
        </svg>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gray-200 to-gray-400 dark:from-gray-400 dark:to-gray-500 flex items-center justify-center shadow-sm">
        <span className="text-xs font-bold text-gray-700 dark:text-gray-900">2</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-300 to-orange-500 flex items-center justify-center shadow-sm shadow-orange-500/20">
        <span className="text-xs font-bold text-orange-900">3</span>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{rank}</span>
    </div>
  );
}

function getPointsByPeriod(entry: LeaderboardEntry, period: LeaderboardPeriod): number {
  switch (period) {
    case 'weekly':
      return entry.weeklyPoints;
    case 'monthly':
      return entry.monthlyPoints;
    case 'all_time':
      return entry.totalPoints;
  }
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5 animate-pulse">
      <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24" />
        <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded w-16" />
      </div>
      <div className="h-5 w-14 bg-gray-200 dark:bg-gray-700 rounded-full" />
    </div>
  );
}

export default function LeaderboardWidget() {
  const authFetch = useAuthFetch();
  const { user } = useAuth();
  const {
    leaderboardPeriod,
    setLeaderboardPeriod,
    setLeaderboard,
  } = useGamificationStore();

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLeaderboard = useCallback(
    async (period: LeaderboardPeriod) => {
      try {
        setLoading(true);
        const res = await authFetch(
          `${API_BASE_URL}/api/gamification/leaderboard?period=${period}&limit=5`
        );

        if (!res.ok) throw new Error('Failed to fetch leaderboard');

        const data: LeaderboardEntry[] = await res.json();
        setEntries(data);
        setLeaderboard(data);
      } catch (err) {
        console.error('Leaderboard error:', err);
      } finally {
        setLoading(false);
      }
    },
    [authFetch, setLeaderboard]
  );

  useEffect(() => {
    fetchLeaderboard(leaderboardPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboardPeriod]);

  const isCurrentUser = (entry: LeaderboardEntry): boolean => {
    if (!user) return false;
    return entry.userId === user.id || entry.userEmail === user.email;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Leaderboard
        </h3>
        <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
        </svg>
      </div>

      {/* Period Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-900/50 rounded-lg p-0.5 mb-4">
        {PERIOD_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setLeaderboardPeriod(tab.value)}
            className={`flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition-all duration-200 ${
              leaderboardPeriod === tab.value
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Leaderboard Entries */}
      <div className="space-y-1">
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : entries.length === 0 ? (
          <div className="py-6 text-center">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No rankings yet
            </p>
          </div>
        ) : (
          entries.map((entry) => {
            const isCurrent = isCurrentUser(entry);
            const points = getPointsByPeriod(entry, leaderboardPeriod);

            return (
              <div
                key={entry.userId}
                className={`flex items-center gap-3 py-2.5 px-2 rounded-lg transition-colors ${
                  isCurrent
                    ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-900/30'
                }`}
              >
                {/* Rank */}
                <RankBadge rank={entry.rank} />

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      isCurrent
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {entry.userName}
                    {isCurrent && (
                      <span className="ml-1.5 text-xs font-normal text-blue-500 dark:text-blue-400">
                        (you)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {entry.level.name}
                  </p>
                </div>

                {/* Points */}
                <div className="text-right shrink-0">
                  <p
                    className={`text-sm font-bold tabular-nums ${
                      isCurrent
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    {points.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    pts
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* View Full Leaderboard Link */}
      <Link
        href="/dashboard/leaderboard"
        className="mt-4 flex items-center justify-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors py-2"
      >
        View full leaderboard
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}
