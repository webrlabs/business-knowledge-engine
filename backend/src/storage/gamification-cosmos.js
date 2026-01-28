const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');
const { log } = require('../utils/logger');

const CONFIG = {
  DATABASE_ID: process.env.COSMOS_DB_DATABASE || 'knowledge-platform',
  CONTAINERS: {
    USER_SCORES: 'user_scores',
    ACHIEVEMENTS: 'achievements',
    POINT_TRANSACTIONS: 'point_transactions',
    GRAPH_ANALYTICS: 'graph_analytics',
  },
};

let client = null;
let database = null;
const containers = {};

function getClient() {
  const endpoint = process.env.COSMOS_DB_ENDPOINT;
  const key = process.env.COSMOS_DB_KEY;

  if (!endpoint) {
    throw new Error('COSMOS_DB_ENDPOINT is required for gamification storage');
  }
  if (client) return client;

  if (key) {
    client = new CosmosClient({ endpoint, key });
  } else {
    client = new CosmosClient({
      endpoint,
      aadCredentials: new DefaultAzureCredential(),
    });
  }
  return client;
}

async function initGamificationContainers() {
  if (database && Object.keys(containers).length === 4) {
    return containers;
  }

  try {
    const cosmosClient = getClient();
    const { database: db } = await cosmosClient.databases.createIfNotExists({
      id: CONFIG.DATABASE_ID,
    });
    database = db;

    // user_scores - extended with gamification fields
    const { container: userScores } = await database.containers.createIfNotExists({
      id: CONFIG.CONTAINERS.USER_SCORES,
      partitionKey: { paths: ['/userId'] },
    });
    containers.userScores = userScores;

    // achievements - badge definitions
    const { container: achievements } = await database.containers.createIfNotExists({
      id: CONFIG.CONTAINERS.ACHIEVEMENTS,
      partitionKey: { paths: ['/category'] },
    });
    containers.achievements = achievements;

    // point_transactions - audit trail with 90-day TTL
    const { container: pointTransactions } = await database.containers.createIfNotExists({
      id: CONFIG.CONTAINERS.POINT_TRANSACTIONS,
      partitionKey: { paths: ['/userId'] },
      defaultTtl: 90 * 24 * 60 * 60, // 90 days in seconds
    });
    containers.pointTransactions = pointTransactions;

    // graph_analytics - daily snapshots
    const { container: graphAnalytics } = await database.containers.createIfNotExists({
      id: CONFIG.CONTAINERS.GRAPH_ANALYTICS,
      partitionKey: { paths: ['/metricType'] },
    });
    containers.graphAnalytics = graphAnalytics;

    log.info('Gamification containers initialized', {
      database: CONFIG.DATABASE_ID,
      containers: Object.keys(CONFIG.CONTAINERS),
    });

    return containers;
  } catch (error) {
    log.error('Failed to initialize gamification containers', error);
    throw error;
  }
}

async function getContainers() {
  return initGamificationContainers();
}

module.exports = {
  getContainers,
  initGamificationContainers,
  CONFIG,
};
