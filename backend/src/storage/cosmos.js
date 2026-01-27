const { CosmosClient } = require('@azure/cosmos');
const { DefaultAzureCredential } = require('@azure/identity');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const documentsContainerId =
  process.env.COSMOS_DB_DOCUMENTS_CONTAINER || 'documents';

let client;
let database;
let documentsContainer;

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
  if (database && documentsContainer) {
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

/**
 * List documents with cursor-based pagination (F5.2.4)
 * @param {Object} options - Pagination options
 * @param {string} [options.cursor] - Pagination cursor
 * @param {number} [options.pageSize] - Page size (default 20, max 100)
 * @param {string} [options.status] - Filter by status
 * @returns {Promise<Object>} Paginated response { items, pagination }
 */
async function listDocumentsPaginated(options = {}) {
  await initCosmos();

  const {
    buildPaginatedCosmosQuery,
    processPaginatedResults,
    parsePaginationParams,
  } = require('../services/pagination-service');

  const { cursor, pageSize } = parsePaginationParams({
    cursor: options.cursor,
    pageSize: options.pageSize,
  });

  let baseQuery = 'SELECT * FROM c';
  const filterParams = [];

  // Add status filter if provided
  if (options.status) {
    baseQuery += ' WHERE c.status = @status';
    filterParams.push({ name: '@status', value: options.status });
  }

  // Build paginated query
  const { query, parameters: paginatedParams } = buildPaginatedCosmosQuery(
    baseQuery,
    { cursor, pageSize, sortField: 'uploadedAt', sortOrder: 'DESC' }
  );

  const finalParams = [...filterParams, ...paginatedParams];

  const { resources } = await documentsContainer.items
    .query({ query, parameters: finalParams })
    .fetchAll();

  return processPaginatedResults(resources, { pageSize, sortField: 'uploadedAt' });
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

async function queryDocuments(querySpec) {
  await initCosmos();
  const { resources } = await documentsContainer.items.query(querySpec).fetchAll();
  return resources;
}

module.exports = {
  getClient,
  createDocument,
  listDocuments,
  listDocumentsPaginated,
  queryDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
};