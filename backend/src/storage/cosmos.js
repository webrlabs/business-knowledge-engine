const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const documentsContainerId =
  process.env.COSMOS_DB_DOCUMENTS_CONTAINER || 'documents';
const auditContainerId =
  process.env.COSMOS_DB_AUDIT_CONTAINER || 'audit-logs';

let client;
let database;
let documentsContainer;
let auditContainer;

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

async function initCosmos() {
  if (database && documentsContainer && auditContainer) {
    return;
  }
  const cosmosClient = getClient();
  const { database: db } = await cosmosClient.databases.createIfNotExists({
    id: databaseId,
  });
  database = db;

  const { container: docs } = await database.containers.createIfNotExists({
    id: documentsContainerId,
    partitionKey: {
      paths: ['/documentType'],
    },
  });
  documentsContainer = docs;

  const { container: audit } = await database.containers.createIfNotExists({
    id: auditContainerId,
    partitionKey: {
      paths: ['/entityType'],
    },
  });
  auditContainer = audit;
}

async function createDocument(document) {
  await initCosmos();
  const { resource } = await documentsContainer.items.create(document);
  return resource;
}

async function listDocuments() {
  await initCosmos();
  const query = 'SELECT * FROM c ORDER BY c.uploadedAt DESC';
  const { resources } = await documentsContainer.items.query(query).fetchAll();
  return resources;
}

async function getDocumentById(id) {
  await initCosmos();
  try {
    const { resource } = await documentsContainer.item(id, 'document').read();
    return resource;
  } catch (error) {
    if (error.code === 404) {
      // Fallback: try querying by id in case partition key is different
      const query = {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: id }],
      };
      const { resources } = await documentsContainer.items.query(query).fetchAll();
      return resources.length > 0 ? resources[0] : null;
    }
    throw error;
  }
}

async function updateDocument(id, updates) {
  await initCosmos();
  let resource;
  try {
    ({ resource } = await documentsContainer.item(id, 'document').read());
  } catch (error) {
    if (error.code === 404) {
      return null;
    }
    throw error;
  }
  const updated = { ...resource, ...updates };
  const { resource: saved } = await documentsContainer.item(id, 'document').replace(updated);
  return saved;
}

async function deleteDocument(id) {
  await initCosmos();
  try {
    await documentsContainer.item(id, 'document').delete();
    return true;
  } catch (error) {
    if (error.code === 404) {
      // Fallback: try to find and delete document with different partition key
      const query = {
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: id }],
      };
      const { resources } = await documentsContainer.items.query(query).fetchAll();
      if (resources.length > 0) {
        const doc = resources[0];
        // Try various partition key values (documents might have been created with different keys)
        const partitionKeysToTry = [doc.documentType, undefined, null, ''];
        for (const pk of partitionKeysToTry) {
          try {
            await documentsContainer.item(id, pk).delete();
            return true;
          } catch (deleteError) {
            if (deleteError.code !== 404) continue;
          }
        }
      }
      return false;
    }
    throw error;
  }
}

async function createAuditLog(entry) {
  await initCosmos();
  const { resource } = await auditContainer.items.create(entry);
  return resource;
}

async function queryAuditLogs({ entityId, action, entityType, limit = 100 }) {
  await initCosmos();
  const conditions = [];
  const parameters = [];

  if (entityId) {
    conditions.push('c.entityId = @entityId');
    parameters.push({ name: '@entityId', value: entityId });
  }
  if (action) {
    conditions.push('c.action = @action');
    parameters.push({ name: '@action', value: action });
  }
  if (entityType) {
    conditions.push('c.entityType = @entityType');
    parameters.push({ name: '@entityType', value: entityType });
  }

  let query = `SELECT * FROM c`;
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ` ORDER BY c.timestamp DESC`;

  const { resources } = await auditContainer.items
    .query({ query, parameters })
    .fetchAll();

  return resources.slice(0, Number(limit));
}

module.exports = {
  createDocument,
  listDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  createAuditLog,
  queryAuditLogs,
};
