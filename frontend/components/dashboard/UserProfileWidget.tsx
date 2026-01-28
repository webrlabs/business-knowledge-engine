'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { GamificationProfile } from '@/lib/gamification-types';
import { useAuth } from '@/lib/auth';

export default function UserProfileWidget() {
  const authFetch = useAuthFetch();
  const { user } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch(`${API_BASE_URL}/api/gamification/profile`);
      if (!res.ok) throw new Error('Failed to load profile');
      const data: GamificationProfile = await res.json();
      setProfile(data);
    } catch (err) {
      console.error('Profile fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?';

  if (loading) {
    return (
      <div className="animate-pulse flex items-center gap-3 px-2 py-2">
        <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20" />
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-28" />
        </div>
      </div>
    );
  }

  const level = profile?.level;
  const progressPercent = level ? Math.min(Math.max(level.progress * 100, 0), 100) : 0;

  return (
    <button
      onClick={() => router.push('/dashboard/leaderboard')}
      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left group"
      title="View leaderboard & achievements"
    >
      {/* Avatar */}
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-sm">
        <span className="text-xs font-bold text-white leading-none">{initials}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
          {user?.name ?? 'User'}
        </p>
        {profile ? (
          <div className="flex items-center gap-2 mt-0.5">
            {/* Level pill */}
            <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
              {level?.name ?? 'Novice'}
            </span>
            {/* XP bar (thin inline) */}
            <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden max-w-[60px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {/* Streak */}
            {profile.streakDays > 0 && (
              <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 23c-4.97 0-8-3.03-8-7 0-2.72 1.37-5.32 2.8-7.24.44-.59 1.3-.28 1.3.46 0 1.05.62 2.04 1.3 2.78.16.18.44.06.44-.18 0-2.15.96-4.42 2.48-6.07.42-.46 1.16-.16 1.16.46 0 2.56 1.28 4.72 3.12 5.96.33.22.68-.12.55-.48-.32-.88-.48-1.84-.48-2.85 0-.37.4-.58.68-.34C19.78 10.63 20 13.03 20 16c0 3.97-3.03 7-8 7z" />
                </svg>
                {profile.streakDays}
              </span>
            )}
            {/* Points */}
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400 tabular-nums">
              {profile.totalPoints} pts
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-gray-400 dark:text-gray-500">0 pts</p>
        )}
      </div>
    </button>
  );
}
