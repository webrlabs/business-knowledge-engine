const { getContainers } = require('../storage/gamification-cosmos');
const { log } = require('../utils/logger');

const BADGE_DEFINITIONS = [
  {
    id: 'first_upload',
    name: 'First Upload',
    description: 'Upload your first document',
    icon: 'upload',
    category: 'contribution',
    rarity: 'common',
    condition: { type: 'uploads_count', threshold: 1 },
  },
  {
    id: 'contributor_5',
    name: 'Contributor',
    description: 'Upload 5 documents',
    icon: 'folder-plus',
    category: 'contribution',
    rarity: 'common',
    condition: { type: 'uploads_count', threshold: 5 },
  },
  {
    id: 'knowledge_builder_25',
    name: 'Knowledge Builder',
    description: 'Upload 25 documents',
    icon: 'library',
    category: 'contribution',
    rarity: 'rare',
    condition: { type: 'uploads_count', threshold: 25 },
  },
  {
    id: 'quality_guardian',
    name: 'Quality Guardian',
    description: 'Complete your first review',
    icon: 'shield-check',
    category: 'review',
    rarity: 'common',
    condition: { type: 'reviews_count', threshold: 1 },
  },
  {
    id: 'review_expert_10',
    name: 'Review Expert',
    description: 'Complete 10 reviews',
    icon: 'clipboard-check',
    category: 'review',
    rarity: 'rare',
    condition: { type: 'reviews_count', threshold: 10 },
  },
  {
    id: 'review_master_50',
    name: 'Review Master',
    description: 'Complete 50 reviews',
    icon: 'award',
    category: 'review',
    rarity: 'epic',
    condition: { type: 'reviews_count', threshold: 50 },
  },
  {
    id: 'consistent_7',
    name: 'Consistent',
    description: 'Maintain a 7-day activity streak',
    icon: 'flame',
    category: 'streak',
    rarity: 'rare',
    condition: { type: 'streak_days', threshold: 7 },
  },
  {
    id: 'dedicated_30',
    name: 'Dedicated',
    description: 'Maintain a 30-day activity streak',
    icon: 'fire',
    category: 'streak',
    rarity: 'epic',
    condition: { type: 'streak_days', threshold: 30 },
  },
  {
    id: 'rising_star_1000',
    name: 'Rising Star',
    description: 'Earn 1,000 total points',
    icon: 'star',
    category: 'points',
    rarity: 'rare',
    condition: { type: 'total_points', threshold: 1000 },
  },
  {
    id: 'knowledge_master_5000',
    name: 'Knowledge Master',
    description: 'Earn 5,000 total points',
    icon: 'crown',
    category: 'points',
    rarity: 'legendary',
    condition: { type: 'total_points', threshold: 5000 },
  },
];

class AchievementService {
  constructor() {
    this.initialized = false;
    this.containers = null;
    this.badgeDefinitions = BADGE_DEFINITIONS;
  }

  async _ensureInitialized() {
    if (!this.initialized) {
      this.containers = await getContainers();
      await this._seedBadgeDefinitions();
      this.initialized = true;
    }
  }

  async _seedBadgeDefinitions() {
    for (const badge of BADGE_DEFINITIONS) {
      try {
        await this.containers.achievements.items.upsert(badge);
      } catch (error) {
        log.warn(`Failed to seed badge ${badge.id}`, error);
      }
    }
  }

  async getAllBadges() {
    await this._ensureInitialized();

    try {
      const { resources } = await this.containers.achievements.items
        .query('SELECT * FROM c')
        .fetchAll();
      return resources;
    } catch (error) {
      log.error('Failed to fetch badge definitions', error);
      return BADGE_DEFINITIONS;
    }
  }

  async getUserAchievements(userId, userScore) {
    await this._ensureInitialized();

    const allBadges = await this.getAllBadges();
    const earnedBadgeIds = (userScore.badges || []).map(b =>
      typeof b === 'string' ? b : b.id
    );

    return allBadges.map(badge => ({
      ...badge,
      earned: earnedBadgeIds.includes(badge.id),
      earnedAt: (userScore.badges || []).find(
        b => (typeof b === 'string' ? b : b.id) === badge.id
      )?.earnedAt || null,
      progress: this._calculateProgress(badge, userScore),
    }));
  }

  _calculateProgress(badge, userScore) {
    const { condition } = badge;
    let current = 0;

    switch (condition.type) {
      case 'uploads_count':
        current = userScore.uploadsCount || 0;
        break;
      case 'reviews_count':
        current = userScore.reviewsCount || 0;
        break;
      case 'streak_days':
        current = userScore.streakDays || 0;
        break;
      case 'total_points':
        current = userScore.totalPoints || 0;
        break;
      default:
        return 0;
    }

    return Math.min(100, (current / condition.threshold) * 100);
  }

  async checkAndAwardBadges(userId, userScore) {
    await this._ensureInitialized();

    const earnedBadgeIds = (userScore.badges || []).map(b =>
      typeof b === 'string' ? b : b.id
    );
    const newBadges = [];

    for (const badge of BADGE_DEFINITIONS) {
      if (earnedBadgeIds.includes(badge.id)) continue;

      const { condition } = badge;
      let current = 0;

      switch (condition.type) {
        case 'uploads_count':
          current = userScore.uploadsCount || 0;
          break;
        case 'reviews_count':
          current = userScore.reviewsCount || 0;
          break;
        case 'streak_days':
          current = userScore.streakDays || 0;
          break;
        case 'total_points':
          current = userScore.totalPoints || 0;
          break;
      }

      if (current >= condition.threshold) {
        const badgeAward = {
          id: badge.id,
          name: badge.name,
          earnedAt: new Date().toISOString(),
        };
        newBadges.push(badgeAward);
      }
    }

    if (newBadges.length > 0) {
      const updatedBadges = [...(userScore.badges || []), ...newBadges];

      try {
        const { resource } = await this.containers.userScores
          .item(userId, userId)
          .read();

        if (resource) {
          resource.badges = updatedBadges;
          await this.containers.userScores.items.upsert(resource);
        }
      } catch (error) {
        log.error(`Failed to award badges to user ${userId}`, error);
      }
    }

    return newBadges;
  }
}

let instance = null;

function getAchievementService() {
  if (!instance) {
    instance = new AchievementService();
  }
  return instance;
}

module.exports = {
  AchievementService,
  getAchievementService,
  BADGE_DEFINITIONS,
};
