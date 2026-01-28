'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import type { DashboardStats } from '@/lib/gamification-types';
import SearchHero from '@/components/dashboard/SearchHero';
import UploadIncentive from '@/components/dashboard/UploadIncentive';
import ReviewQueueWidget from '@/components/dashboard/ReviewQueueWidget';
import LeaderboardWidget from '@/components/dashboard/LeaderboardWidget';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import GraphGrowthChart from '@/components/dashboard/GraphGrowthChart';
import DailyChallengeCard from '@/components/dashboard/DailyChallengeCard';

export default function Dashboard() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pendingReviews, setPendingReviews] = useState<Array<{ id: string; title: string; confidence: number; uploadedAt: string }>>([]);

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

        // Extract pending review items from recent activity
        if (data.recentActivity) {
          const pending = data.recentActivity
            .filter((a: { status: string }) => a.status === 'pending')
            .slice(0, 3)
            .map((a: { id: string; title: string; timestamp: string }) => ({
              id: a.id,
              title: a.title,
              confidence: Math.random() * 40 + 60, // placeholder until real data
              uploadedAt: a.timestamp,
            }));
          setPendingReviews(pending);
        }
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (!user) {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* 1. Search Hero */}
      <section aria-label="Search" className="pt-30 pb-30">
        <SearchHero firstName={user.name?.split(' ')[0]} />
      </section>

      {/* 2. Daily Challenge + Upload Incentive - side by side on desktop */}
      <section aria-label="Engagement" className="grid grid-cols-1 lg:grid-cols-2 gap-4 [&>*:only-child]:lg:col-span-2">
        <DailyChallengeCard />
        <UploadIncentive weeklyUploads={stats?.weeklyUploads || 0} />
      </section>

      {/* 4. Review Queue Widget (conditional) */}
      {pendingReviews.length > 0 && (
        <section aria-label="Pending Reviews">
          <ReviewQueueWidget pendingReviews={pendingReviews} />
        </section>
      )}

      {/* 5. Leaderboard + Activity Feed - 2 column grid */}
      <section aria-label="Community Activity" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LeaderboardWidget />
        <ActivityFeed />
      </section>

      {/* 6. Graph Growth Chart */}
      <section aria-label="Graph Growth">
        <GraphGrowthChart />
      </section>
    </div>
  );
}
