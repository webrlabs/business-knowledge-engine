import { create } from 'zustand';
import type {
  GamificationProfile,
  Achievement,
  ActivityItem,
  LeaderboardEntry,
  DailyChallenge,
  LeaderboardPeriod,
  ActivityFilter,
} from './gamification-types';

interface GamificationState {
  // Data
  profile: GamificationProfile | null;
  achievements: Achievement[];
  activityFeed: ActivityItem[];
  leaderboard: LeaderboardEntry[];
  dailyChallenge: DailyChallenge | null;

  // UI state
  leaderboardPeriod: LeaderboardPeriod;
  activityFilter: ActivityFilter;
  isLoadingProfile: boolean;
  isLoadingAchievements: boolean;
  isLoadingFeed: boolean;
  isLoadingLeaderboard: boolean;
  isLoadingChallenge: boolean;
  error: string | null;

  // Actions
  setProfile: (profile: GamificationProfile | null) => void;
  setAchievements: (achievements: Achievement[]) => void;
  setActivityFeed: (feed: ActivityItem[]) => void;
  setLeaderboard: (entries: LeaderboardEntry[]) => void;
  setDailyChallenge: (challenge: DailyChallenge | null) => void;
  setLeaderboardPeriod: (period: LeaderboardPeriod) => void;
  setActivityFilter: (filter: ActivityFilter) => void;
  setLoading: (key: string, value: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  profile: null,
  achievements: [],
  activityFeed: [],
  leaderboard: [],
  dailyChallenge: null,
  leaderboardPeriod: 'weekly' as LeaderboardPeriod,
  activityFilter: 'all' as ActivityFilter,
  isLoadingProfile: false,
  isLoadingAchievements: false,
  isLoadingFeed: false,
  isLoadingLeaderboard: false,
  isLoadingChallenge: false,
  error: null,
};

export const useGamificationStore = create<GamificationState>((set) => ({
  ...initialState,

  setProfile: (profile) => set({ profile }),
  setAchievements: (achievements) => set({ achievements }),
  setActivityFeed: (feed) => set({ activityFeed: feed }),
  setLeaderboard: (entries) => set({ leaderboard: entries }),
  setDailyChallenge: (challenge) => set({ dailyChallenge: challenge }),
  setLeaderboardPeriod: (period) => set({ leaderboardPeriod: period }),
  setActivityFilter: (filter) => set({ activityFilter: filter }),
  setLoading: (key, value) => {
    const loadingKey = `isLoading${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof GamificationState;
    set({ [loadingKey]: value } as Partial<GamificationState>);
  },
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
