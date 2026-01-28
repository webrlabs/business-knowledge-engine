'use client';

import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { DailyChallenge } from '@/lib/gamification-types';

function ChallengeSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-48" />
        </div>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full w-full" />
      <div className="flex justify-between">
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-16" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20" />
      </div>
    </div>
  );
}

export default function DailyChallengeCard() {
  const authFetch = useAuthFetch();
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchChallenge = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch(
        `${API_BASE_URL}/api/gamification/daily-challenge`
      );
      if (!res.ok) throw new Error('Failed to fetch daily challenge');
      const data: DailyChallenge = await res.json();
      setChallenge(data);
    } catch (err) {
      console.error('Daily challenge fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-amber-500"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Daily Challenge
          </h3>
        </div>
        {challenge && !challenge.completed && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {challenge.timeRemaining}
          </span>
        )}
      </div>

      {loading ? (
        <ChallengeSkeleton />
      ) : !challenge ? (
        <div className="text-center py-4">
          <svg
            className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2"
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
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No challenge available
          </p>
        </div>
      ) : challenge.completed ? (
        /* Completed State */
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-green-700 dark:text-green-400 truncate">
                {challenge.title}
              </p>
              <p className="text-xs text-green-600 dark:text-green-500">
                Completed!
              </p>
            </div>
          </div>

          {/* Full progress bar */}
          <div className="w-full h-2 bg-green-100 dark:bg-green-900/30 rounded-full overflow-hidden">
            <div className="h-full w-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full" />
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-green-600 dark:text-green-400 font-medium">
              {challenge.target}/{challenge.target}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-semibold">
              +{challenge.points} pts earned
            </span>
          </div>
        </div>
      ) : (
        /* Active State */
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-lg">
              {challenge.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {challenge.title}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                {challenge.description}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.min(challenge.progress, 100)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600 dark:text-gray-400 font-medium">
              {challenge.current}/{challenge.target}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 font-semibold">
              +{challenge.points} pts
            </span>
          </div>

          {/* Motivational text */}
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            {challenge.progress >= 75
              ? 'Almost there! Keep going!'
              : challenge.progress >= 50
                ? 'Halfway there -- nice work!'
                : challenge.progress > 0
                  ? 'Great start! Keep it up!'
                  : 'Get started to earn bonus points!'}
          </p>
        </div>
      )}
    </div>
  );
}
