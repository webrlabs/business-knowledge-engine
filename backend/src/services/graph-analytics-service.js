const { getContainers } = require('../storage/gamification-cosmos');
const { log } = require('../utils/logger');

class GraphAnalyticsService {
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

  async recordDailySnapshot(stats) {
    await this._ensureInitialized();

    const today = new Date().toISOString().split('T')[0];
    const snapshotId = `snapshot_${today}`;

    const snapshot = {
      id: snapshotId,
      metricType: 'daily_snapshot',
      date: today,
      nodes: stats.nodes || 0,
      edges: stats.edges || 0,
      documents: stats.documents || 0,
      density: stats.density || 0,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.containers.graphAnalytics.items.upsert(snapshot);
      log.info('Daily graph snapshot recorded', { date: today, nodes: snapshot.nodes, edges: snapshot.edges });
      return snapshot;
    } catch (error) {
      log.error('Failed to record daily snapshot', error);
      throw error;
    }
  }

  async getGrowthData(days = 30) {
    await this._ensureInitialized();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().split('T')[0];

    const query = {
      query: 'SELECT * FROM c WHERE c.metricType = "daily_snapshot" AND c.date >= @cutoff ORDER BY c.date ASC',
      parameters: [{ name: '@cutoff', value: cutoff }],
    };

    try {
      const { resources } = await this.containers.graphAnalytics.items
        .query(query)
        .fetchAll();

      return resources.map(s => ({
        date: s.date,
        nodes: s.nodes,
        edges: s.edges,
        documents: s.documents,
        density: s.density,
      }));
    } catch (error) {
      log.error('Failed to fetch growth data', error);
      return [];
    }
  }

  async hasTodaySnapshot() {
    await this._ensureInitialized();

    const today = new Date().toISOString().split('T')[0];
    const snapshotId = `snapshot_${today}`;

    try {
      const { resource } = await this.containers.graphAnalytics
        .item(snapshotId, 'daily_snapshot')
        .read();
      return !!resource;
    } catch (error) {
      if (error.code === 404) return false;
      log.error('Failed to check today snapshot', error);
      return false;
    }
  }
}

let instance = null;

function getGraphAnalyticsService() {
  if (!instance) {
    instance = new GraphAnalyticsService();
  }
  return instance;
}

module.exports = {
  GraphAnalyticsService,
  getGraphAnalyticsService,
};
