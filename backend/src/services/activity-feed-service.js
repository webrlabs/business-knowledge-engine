const { getContainers } = require('../storage/gamification-cosmos');
const { log } = require('../utils/logger');

class ActivityFeedService {
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

  async getActivityFeed(options = {}) {
    await this._ensureInitialized();

    const { userId, filter = 'all', limit = 20, offset = 0 } = options;

    let query;
    const parameters = [
      { name: '@limit', value: limit },
      { name: '@offset', value: offset },
    ];

    if (filter === 'my' && userId) {
      query = 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.timestamp DESC OFFSET @offset LIMIT @limit';
      parameters.push({ name: '@userId', value: userId });
    } else {
      query = 'SELECT * FROM c ORDER BY c.timestamp DESC OFFSET @offset LIMIT @limit';
    }

    try {
      const { resources } = await this.containers.pointTransactions.items
        .query({ query, parameters })
        .fetchAll();

      return resources.map(tx => ({
        id: tx.id,
        type: this._getActivityType(tx.action),
        userId: tx.userId,
        userName: tx.userName,
        action: tx.action,
        points: tx.points,
        details: tx.details || {},
        timestamp: tx.timestamp,
      }));
    } catch (error) {
      log.error('Failed to fetch activity feed', error);
      return [];
    }
  }

  _getActivityType(action) {
    const typeMap = {
      upload: 'upload',
      approval: 'review',
      verify: 'verify',
      review_approve: 'review',
      review_reject: 'review',
      review_edit: 'review',
    };
    return typeMap[action] || 'activity';
  }
}

let instance = null;

function getActivityFeedService() {
  if (!instance) {
    instance = new ActivityFeedService();
  }
  return instance;
}

module.exports = {
  ActivityFeedService,
  getActivityFeedService,
};
