'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import type { LeaderboardEntry, LeaderboardPeriod } from '@/lib/gamification-types';

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'weekly', label: 'This Week' },
  { value: 'monthly', label: 'This Month' },
  { value: 'all_time', label: 'All Time' },
];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<LeaderboardPeriod>('weekly');

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/gamification/leaderboard?period=${period}&limit=20`
      );
      if (!response.ok) throw new Error('Failed to fetch leaderboard');
      const data = await response.json();
      setLeaderboard(data);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      setError('Failed to load leaderboard. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [authFetch, period]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  function getPointsForPeriod(entry: LeaderboardEntry) {
    switch (period) {
      case 'weekly': return entry.weeklyPoints;
      case 'monthly': return entry.monthlyPoints;
      default: return entry.totalPoints;
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Leaderboard</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Top contributors driving knowledge discovery.
          </p>
        </div>
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                period === p.value
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
          <p className="text-red-800 dark:text-red-200">{error}</p>
          <button
            onClick={fetchLeaderboard}
            className="mt-3 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4 animate-pulse">
                <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full" />
                <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                </div>
                <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              </div>
            ))}
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">No activity recorded yet. Be the first to contribute!</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {leaderboard.map((entry) => {
              const isCurrentUser = user?.email === entry.userEmail || user?.id === entry.userId;
              const points = getPointsForPeriod(entry);

              return (
                <div
                  key={entry.userId}
                  className={`flex items-center gap-4 px-6 py-4 transition-colors ${
                    isCurrentUser
                      ? 'bg-blue-50/50 dark:bg-blue-900/10 ring-1 ring-inset ring-blue-200 dark:ring-blue-800'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-750'
                  }`}
                >
                  {/* Rank */}
                  <div className="w-8 flex-shrink-0 text-center">
                    {entry.rank === 1 ? (
                      <span className="text-2xl">&#x1F947;</span>
                    ) : entry.rank === 2 ? (
                      <span className="text-2xl">&#x1F948;</span>
                    ) : entry.rank === 3 ? (
                      <span className="text-2xl">&#x1F949;</span>
                    ) : (
                      <span className="text-sm font-bold text-gray-400 dark:text-gray-500">
                        {entry.rank}
                      </span>
                    )}
                  </div>

                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {entry.userName?.charAt(0).toUpperCase() || 'U'}
                  </div>

                  {/* Name + Level */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold truncate ${
                        isCurrentUser ? 'text-blue-900 dark:text-blue-200' : 'text-gray-900 dark:text-white'
                      }`}>
                        {entry.userName}
                        {isCurrentUser && (
                          <span className="ml-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">(you)</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {entry.level?.name || 'Novice'}
                      </span>
                      {entry.streakDays > 0 && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          &#x1F525; {entry.streakDays}d streak
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {entry.uploadsCount || 0} uploads
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {entry.reviewsCount || 0} reviews
                      </p>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-full">
                      <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                        {points.toLocaleString()}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">pts</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Points guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl p-6 text-white shadow-lg">
          <h3 className="text-lg font-bold mb-3">How to earn points</h3>
          <ul className="space-y-2 text-purple-100 text-sm">
            <li className="flex justify-between">
              <span>Upload a document</span>
              <span className="font-bold text-white">+10 pts</span>
            </li>
            <li className="flex justify-between">
              <span>Document approved</span>
              <span className="font-bold text-white">+50 pts</span>
            </li>
            <li className="flex justify-between">
              <span>Verify an entity</span>
              <span className="font-bold text-white">+5 pts</span>
            </li>
            <li className="flex justify-between">
              <span>Approve review</span>
              <span className="font-bold text-white">+15 pts</span>
            </li>
            <li className="flex justify-between">
              <span>Reject review</span>
              <span className="font-bold text-white">+10 pts</span>
            </li>
            <li className="flex justify-between">
              <span>Edit review</span>
              <span className="font-bold text-white">+20 pts</span>
            </li>
          </ul>
        </div>
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl p-6 text-white shadow-lg">
          <h3 className="text-lg font-bold mb-3">Streak bonuses</h3>
          <ul className="space-y-2 text-amber-100 text-sm">
            <li className="flex justify-between">
              <span>Daily activity</span>
              <span className="font-bold text-white">+5 pts/day</span>
            </li>
            <li className="flex justify-between">
              <span>7-day streak</span>
              <span className="font-bold text-white">+25 pts</span>
            </li>
          </ul>
        </div>
        <div className="bg-gradient-to-br from-blue-600 to-cyan-600 rounded-xl p-6 text-white shadow-lg">
          <h3 className="text-lg font-bold mb-3">Levels</h3>
          <ul className="space-y-2 text-blue-100 text-sm">
            <li className="flex justify-between"><span>Novice</span><span className="font-bold text-white">0 XP</span></li>
            <li className="flex justify-between"><span>Explorer</span><span className="font-bold text-white">100 XP</span></li>
            <li className="flex justify-between"><span>Analyst</span><span className="font-bold text-white">500 XP</span></li>
            <li className="flex justify-between"><span>Expert</span><span className="font-bold text-white">1,500 XP</span></li>
            <li className="flex justify-between"><span>Knowledge Master</span><span className="font-bold text-white">5,000 XP</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
