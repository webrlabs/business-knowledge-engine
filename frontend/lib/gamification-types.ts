export interface LevelInfo {
  name: string;
  index: number;
  xp: number;
  xpForNext: number;
  nextLevelName: string | null;
  progress: number;
}

export interface GamificationProfile {
  userId: string;
  userName?: string;
  userEmail?: string;
  totalPoints: number;
  xp: number;
  streakDays: number;
  badges: BadgeAward[];
  weeklyPoints: number;
  monthlyPoints: number;
  uploadsCount: number;
  reviewsCount: number;
  lastActiveDate: string | null;
  level: LevelInfo;
}

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'contribution' | 'review' | 'streak' | 'points';
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  condition: {
    type: string;
    threshold: number;
  };
}

export interface BadgeAward {
  id: string;
  name: string;
  earnedAt: string;
}

export interface Achievement extends BadgeDefinition {
  earned: boolean;
  earnedAt: string | null;
  progress: number;
}

export interface ActivityItem {
  id: string;
  type: 'upload' | 'review' | 'verify' | 'badge' | 'activity';
  userId: string;
  userName: string;
  action: string;
  points: number;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  userName: string;
  userEmail?: string;
  totalPoints: number;
  weeklyPoints: number;
  monthlyPoints: number;
  xp: number;
  streakDays: number;
  badges: BadgeAward[];
  uploadsCount: number;
  reviewsCount: number;
  lastActiveDate: string | null;
  level: LevelInfo;
}

export interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  action: string;
  target: number;
  points: number;
  icon: string;
  date: string;
  expiresAt: string;
  timeRemaining: string;
  current: number;
  completed: boolean;
  progress: number;
}

export interface GraphGrowthPoint {
  date: string;
  nodes: number;
  edges: number;
  documents: number;
  density: number;
}

export interface DashboardStats {
  totalDocuments: number;
  totalEntities: number;
  pendingReviews: number;
  completedDocuments: number;
  failedDocuments: number;
  weeklyUploads: number;
  densityPercent: number;
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

export interface SearchSuggestion {
  entities: Array<{
    name: string;
    type: string;
    score: number;
  }>;
  popularQueries: Array<{
    query: string;
    count: number;
  }>;
  sampleQuestions: string[];
}

export type LeaderboardPeriod = 'weekly' | 'monthly' | 'all_time';
export type ActivityFilter = 'all' | 'my' | 'team';
export type SearchMode = 'natural' | 'entity' | 'fulltext';
