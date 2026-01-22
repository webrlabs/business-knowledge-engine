const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const stagingContainerId =
  process.env.COSMOS_DB_STAGING_CONTAINER || 'staging-sessions';

let client;
let database;
let stagingContainer;

function getClient() {
  if (!endpoint) {
    throw new Error('COSMOS_DB_ENDPOINT is required');
  }
  if (client) {
    return client;
  }
  if (key) {
    client = new CosmosClient({ endpoint, key });
    return client;
  }
  client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential(),
  });
  return client;
}

async function initStaging() {
  if (database && stagingContainer) {
    return;
  }
  const cosmosClient = getClient();
  const { database: db } = await cosmosClient.databases.createIfNotExists({
    id: databaseId,
  });
  database = db;

  const { container } = await database.containers.createIfNotExists({
    id: stagingContainerId,
    partitionKey: {
      paths: ['/documentId'],
    },
  });
  stagingContainer = container;
}

/**
 * Create a new staging session for a document
 */
async function createStagingSession(session) {
  await initStaging();
  const { resource } = await stagingContainer.items.create(session);
  return resource;
}

/**
 * Get a staging session by ID
 */
async function getStagingSession(sessionId, documentId) {
  await initStaging();
  try {
    const { resource } = await stagingContainer
      .item(sessionId, documentId)
      .read();
    return resource;
  } catch (error) {
    if (error.code === 404) {
      // Try querying by sessionId if partition key doesn't match
      const query = {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      };
      const { resources } = await stagingContainer.items.query(query).fetchAll();
      return resources.length > 0 ? resources[0] : null;
    }
    throw error;
  }
}

/**
 * Get staging session by document ID
 */
async function getStagingSessionByDocumentId(documentId) {
  await initStaging();
  const query = {
    query: 'SELECT * FROM c WHERE c.documentId = @documentId ORDER BY c.createdAt DESC',
    parameters: [{ name: '@documentId', value: documentId }],
  };
  const { resources } = await stagingContainer.items.query(query).fetchAll();
  return resources.length > 0 ? resources[0] : null;
}

/**
 * Update a staging session
 */
async function updateStagingSession(sessionId, documentId, updates) {
  await initStaging();
  let resource;
  try {
    ({ resource } = await stagingContainer.item(sessionId, documentId).read());
  } catch (error) {
    if (error.code === 404) {
      return null;
    }
    throw error;
  }
  const updated = { ...resource, ...updates, updatedAt: new Date().toISOString() };
  const { resource: saved } = await stagingContainer
    .item(sessionId, documentId)
    .replace(updated);
  return saved;
}

/**
 * Delete a staging session
 */
async function deleteStagingSession(sessionId, documentId) {
  await initStaging();
  try {
    await stagingContainer.item(sessionId, documentId).delete();
    return true;
  } catch (error) {
    if (error.code === 404) {
      // Try finding and deleting with query
      const session = await getStagingSession(sessionId, documentId);
      if (session) {
        await stagingContainer.item(sessionId, session.documentId).delete();
        return true;
      }
      return false;
    }
    throw error;
  }
}

/**
 * List all staging sessions for a user
 */
async function listStagingSessionsByUser(userId) {
  await initStaging();
  const query = {
    query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC',
    parameters: [{ name: '@userId', value: userId }],
  };
  const { resources } = await stagingContainer.items.query(query).fetchAll();
  return resources;
}

/**
 * List all active staging sessions
 */
async function listActiveStagingSessions(limit = 100) {
  await initStaging();
  const query = {
    query: 'SELECT * FROM c WHERE c.status = @status ORDER BY c.createdAt DESC',
    parameters: [{ name: '@status', value: 'active' }],
  };
  const { resources } = await stagingContainer.items.query(query).fetchAll();
  return resources.slice(0, limit);
}

module.exports = {
  createStagingSession,
  getStagingSession,
  getStagingSessionByDocumentId,
  updateStagingSession,
  deleteStagingSession,
  listStagingSessionsByUser,
  listActiveStagingSessions,
};
