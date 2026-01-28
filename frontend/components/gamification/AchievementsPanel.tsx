'use client';

import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import type { Achievement } from '@/lib/gamification-types';
import BadgeDisplay from './BadgeDisplay';

type BadgeCategory = 'contribution' | 'review' | 'streak' | 'points';

const CATEGORY_META: Record<BadgeCategory, { label: string; icon: string }> = {
  contribution: { label: 'Contribution', icon: '\uD83D\uDCC4' },
  review:       { label: 'Review',       icon: '\uD83D\uDD0D' },
  streak:       { label: 'Streak',       icon: '\uD83D\uDD25' },
  points:       { label: 'Points',       icon: '\u2B50' },
};

const CATEGORY_ORDER: BadgeCategory[] = ['contribution', 'review', 'streak', 'points'];

function SkeletonBadge() {
  return (
    <div className="w-28 flex flex-col items-center gap-1.5 p-3 rounded-xl border border-gray-200 dark:border-gray-700 animate-pulse">
      <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700" />
      <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}

function SkeletonSection() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 animate-pulse">
        <div className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 w-10 bg-gray-200 dark:bg-gray-700 rounded-full ml-auto" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SkeletonBadge />
        <SkeletonBadge />
        <SkeletonBadge />
      </div>
    </div>
  );
}

export default function AchievementsPanel() {
  const authFetch = useAuthFetch();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAchievements = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await authFetch(`${API_BASE_URL}/api/gamification/achievements`);

      if (!res.ok) {
        throw new Error('Failed to fetch achievements');
      }

      const data: Achievement[] = await res.json();
      setAchievements(data);
    } catch (err) {
      console.error('Achievements error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load achievements');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchAchievements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group achievements by category
  const grouped = CATEGORY_ORDER.reduce<Record<BadgeCategory, Achievement[]>>(
    (acc, category) => {
      acc[category] = achievements.filter((a) => a.category === category);
      return acc;
    },
    { contribution: [], review: [], streak: [], points: [] }
  );

  const totalEarned = achievements.filter((a) => a.earned).length;
  const totalCount = achievements.length;

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <svg
            className="w-10 h-10 text-red-400 dark:text-red-500 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{error}</p>
          <button
            onClick={fetchAchievements}
            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-amber-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Achievements
          </h3>
        </div>

        {!loading && (
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-900/50 px-2.5 py-1 rounded-full tabular-nums">
            {totalEarned} / {totalCount}
          </span>
        )}
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="space-y-6">
          <SkeletonSection />
          <SkeletonSection />
          <SkeletonSection />
          <SkeletonSection />
        </div>
      ) : achievements.length === 0 ? (
        <div className="py-10 text-center">
          <svg
            className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-4.5A3.375 3.375 0 0019.875 10.875 3.375 3.375 0 0016.5 7.5h-9a3.375 3.375 0 00-3.375 3.375A3.375 3.375 0 007.5 14.25v4.5"
            />
          </svg>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No achievements available yet
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.map((category) => {
            const badges = grouped[category];
            if (badges.length === 0) return null;

            const meta = CATEGORY_META[category];
            const earned = badges.filter((b) => b.earned).length;

            return (
              <div key={category}>
                {/* Category Header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base" role="img" aria-hidden="true">
                    {meta.icon}
                  </span>
                  <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    {meta.label}
                  </h4>
                  <span className="ml-auto text-[11px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                    {earned}/{badges.length}
                  </span>
                </div>

                {/* Badges Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {badges.map((badge) => (
                    <BadgeDisplay key={badge.id} badge={badge} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
