const { getContainers } = require('../storage/gamification-cosmos');
const { log } = require('../utils/logger');

const LEVELS = [
  { name: 'Novice', minXP: 0 },
  { name: 'Explorer', minXP: 100 },
  { name: 'Analyst', minXP: 500 },
  { name: 'Expert', minXP: 1500 },
  { name: 'Knowledge Master', minXP: 5000 },
];

const POINT_VALUES = {
  upload: 10,
  approval: 50,
  verify: 5,
  review_approve: 15,
  review_reject: 10,
  review_edit: 20,
  streak_bonus: 5,
  weekly_streak: 25,
};

class GamificationService {
  constructor() {
    this.initialized = false;
    this.containers = null;
  }

  async _ensureInitialized() {
    if (!this.initialized) {
      this.containers = await getContainers();
      this.initialized = true;
    }
  }

  calculateLevel(xp) {
    let level = LEVELS[0];
    for (const l of LEVELS) {
      if (xp >= l.minXP) level = l;
      else break;
    }
    const currentIndex = LEVELS.indexOf(level);
    const nextLevel = LEVELS[currentIndex + 1] || null;
    const xpForNext = nextLevel ? nextLevel.minXP - xp : 0;
    const progress = nextLevel
      ? ((xp - level.minXP) / (nextLevel.minXP - level.minXP)) * 100
      : 100;

    return {
      name: level.name,
      index: currentIndex,
      xp,
      xpForNext,
      nextLevelName: nextLevel ? nextLevel.name : null,
      progress: Math.min(100, Math.max(0, progress)),
    };
  }

  async getUserProfile(userId) {
    await this._ensureInitialized();

    try {
      const { resource } = await this.containers.userScores
        .item(userId, userId)
        .read();

      if (!resource) {
        return this._createDefaultProfile(userId);
      }

      return {
        ...resource,
        level: this.calculateLevel(resource.xp || 0),
      };
    } catch (error) {
      if (error.code === 404) {
        return this._createDefaultProfile(userId);
      }
      log.error(`Failed to get user profile for ${userId}`, error);
      throw error;
    }
  }

  _createDefaultProfile(userId) {
    return {
      userId,
      totalPoints: 0,
      xp: 0,
      streakDays: 0,
      badges: [],
      weeklyPoints: 0,
      monthlyPoints: 0,
      uploadsCount: 0,
      reviewsCount: 0,
      lastActiveDate: null,
      level: this.calculateLevel(0),
    };
  }

  async awardPoints(userId, action, details = {}) {
    await this._ensureInitialized();

    const points = POINT_VALUES[action];
    if (!points) {
      log.warn(`Unknown action type: ${action}`);
      return null;
    }

    const userName = details.userName || 'Unknown';
    const userEmail = details.userEmail || '';

    // Get or create user score document
    let userScore;
    try {
      const { resource } = await this.containers.userScores
        .item(userId, userId)
        .read();
      userScore = resource;
    } catch (error) {
      if (error.code === 404) {
        userScore = null;
      } else {
        throw error;
      }
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (!userScore) {
      userScore = {
        id: userId,
        userId,
        userName,
        userEmail,
        totalPoints: 0,
        xp: 0,
        streakDays: 0,
        badges: [],
        weeklyPoints: 0,
        monthlyPoints: 0,
        uploadsCount: 0,
        reviewsCount: 0,
        lastActiveDate: null,
        weekStartDate: this._getWeekStart(now),
        monthStartDate: this._getMonthStart(now),
        createdAt: now.toISOString(),
      };
    }

    // Reset weekly/monthly counters if period changed
    const currentWeekStart = this._getWeekStart(now);
    const currentMonthStart = this._getMonthStart(now);

    if (userScore.weekStartDate !== currentWeekStart) {
      userScore.weeklyPoints = 0;
      userScore.weekStartDate = currentWeekStart;
    }
    if (userScore.monthStartDate !== currentMonthStart) {
      userScore.monthlyPoints = 0;
      userScore.monthStartDate = currentMonthStart;
    }

    // Update streak
    const streakResult = this._updateStreak(userScore, today);
    userScore.streakDays = streakResult.streakDays;
    userScore.lastActiveDate = today;

    // Add streak bonus points
    let totalAwarded = points;
    if (streakResult.streakBonusAwarded) {
      totalAwarded += POINT_VALUES.streak_bonus;
    }
    if (streakResult.weeklyStreakAwarded) {
      totalAwarded += POINT_VALUES.weekly_streak;
    }

    // Update totals
    userScore.totalPoints += totalAwarded;
    userScore.xp += totalAwarded;
    userScore.weeklyPoints += totalAwarded;
    userScore.monthlyPoints += totalAwarded;
    userScore.userName = userName;
    userScore.userEmail = userEmail;
    userScore.updatedAt = now.toISOString();

    // Update action-specific counters
    if (action === 'upload') userScore.uploadsCount += 1;
    if (action.startsWith('review')) userScore.reviewsCount += 1;

    // Upsert user score
    await this.containers.userScores.items.upsert(userScore);

    // Record point transaction
    const transaction = {
      id: `pt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      userName,
      action,
      points: totalAwarded,
      basePoints: points,
      streakBonus: streakResult.streakBonusAwarded ? POINT_VALUES.streak_bonus : 0,
      weeklyStreakBonus: streakResult.weeklyStreakAwarded ? POINT_VALUES.weekly_streak : 0,
      details,
      timestamp: now.toISOString(),
    };

    try {
      await this.containers.pointTransactions.items.create(transaction);
    } catch (error) {
      log.warn('Failed to record point transaction', error);
    }

    const previousLevel = this.calculateLevel(userScore.xp - totalAwarded);
    const newLevel = this.calculateLevel(userScore.xp);
    const leveledUp = newLevel.index > previousLevel.index;

    return {
      pointsAwarded: totalAwarded,
      totalPoints: userScore.totalPoints,
      xp: userScore.xp,
      level: newLevel,
      leveledUp,
      streak: userScore.streakDays,
    };
  }

  _updateStreak(userScore, today) {
    const lastActive = userScore.lastActiveDate;
    let streakBonusAwarded = false;
    let weeklyStreakAwarded = false;

    if (!lastActive) {
      userScore.streakDays = 1;
      streakBonusAwarded = true;
    } else if (lastActive === today) {
      // Same day, no streak change
    } else {
      const lastDate = new Date(lastActive);
      const todayDate = new Date(today);
      const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        userScore.streakDays += 1;
        streakBonusAwarded = true;
        if (userScore.streakDays % 7 === 0) {
          weeklyStreakAwarded = true;
        }
      } else {
        userScore.streakDays = 1;
        streakBonusAwarded = true;
      }
    }

    return {
      streakDays: userScore.streakDays,
      streakBonusAwarded,
      weeklyStreakAwarded,
    };
  }

  _getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
  }

  _getMonthStart(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }

  async getLeaderboard(period = 'all_time', limit = 10) {
    await this._ensureInitialized();

    let sortField;
    switch (period) {
      case 'weekly':
        sortField = 'weeklyPoints';
        break;
      case 'monthly':
        sortField = 'monthlyPoints';
        break;
      default:
        sortField = 'totalPoints';
    }

    const query = {
      query: `SELECT c.userId, c.userName, c.userEmail, c.totalPoints, c.weeklyPoints, c.monthlyPoints, c.xp, c.streakDays, c.badges, c.uploadsCount, c.reviewsCount, c.lastActiveDate FROM c WHERE c.totalPoints > 0 ORDER BY c.${sortField} DESC OFFSET 0 LIMIT @limit`,
      parameters: [{ name: '@limit', value: limit }],
    };

    try {
      const { resources } = await this.containers.userScores.items
        .query(query)
        .fetchAll();

      return resources.map((user, index) => ({
        rank: index + 1,
        ...user,
        level: this.calculateLevel(user.xp || 0),
      }));
    } catch (error) {
      log.error('Failed to fetch leaderboard', error);
      return [];
    }
  }

  async getRecentTransactions(userId, limit = 20) {
    await this._ensureInitialized();

    const query = {
      query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.timestamp DESC OFFSET 0 LIMIT @limit',
      parameters: [
        { name: '@userId', value: userId },
        { name: '@limit', value: limit },
      ],
    };

    try {
      const { resources } = await this.containers.pointTransactions.items
        .query(query)
        .fetchAll();
      return resources;
    } catch (error) {
      log.error('Failed to fetch transactions', error);
      return [];
    }
  }
}

let instance = null;

function getGamificationService() {
  if (!instance) {
    instance = new GamificationService();
  }
  return instance;
}

module.exports = {
  GamificationService,
  getGamificationService,
  LEVELS,
  POINT_VALUES,
};
