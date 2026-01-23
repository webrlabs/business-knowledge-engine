/**
 * Pagination Service (F5.2.4)
 *
 * Provides cursor-based pagination for all list endpoints.
 * Supports multiple pagination strategies:
 * - Cosmos DB continuation tokens (most efficient)
 * - Keyset-based pagination (timestamp + id)
 * - Offset-based fallback (legacy compatibility)
 *
 * Benefits of cursor-based pagination:
 * - Consistent results even when data changes
 * - Better performance at scale (no OFFSET scanning)
 * - Simpler client implementation
 */

const { log } = require('../utils/logger');

/**
 * Default pagination settings
 */
const DEFAULTS = {
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  CURSOR_ENCODING: 'base64',
};

/**
 * Cursor types supported by the pagination service
 */
const CURSOR_TYPES = {
  CONTINUATION: 'continuation', // Cosmos DB continuation token
  KEYSET: 'keyset',            // Keyset-based (timestamp + id)
  OFFSET: 'offset',            // Legacy offset-based
};

/**
 * Encode a cursor object to a string
 * @param {Object} cursorData - Cursor data to encode
 * @returns {string} Encoded cursor string
 */
function encodeCursor(cursorData) {
  if (!cursorData) return null;
  try {
    const json = JSON.stringify(cursorData);
    return Buffer.from(json).toString('base64');
  } catch (error) {
    log.warn('Failed to encode cursor', { error: error.message });
    return null;
  }
}

/**
 * Decode a cursor string to an object
 * @param {string} cursor - Encoded cursor string
 * @returns {Object|null} Decoded cursor data or null if invalid
 */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch (error) {
    log.warn('Failed to decode cursor', { error: error.message });
    return null;
  }
}

/**
 * Create a keyset cursor from a record
 * Uses timestamp and id for stable ordering
 * @param {Object} record - Record to create cursor from
 * @param {string} sortField - Field used for sorting
 * @returns {string} Encoded cursor
 */
function createKeysetCursor(record, sortField = 'timestamp') {
  if (!record) return null;
  return encodeCursor({
    type: CURSOR_TYPES.KEYSET,
    sortValue: record[sortField],
    id: record.id,
    sortField,
  });
}

/**
 * Create a continuation cursor (for Cosmos DB)
 * @param {string} continuationToken - Cosmos DB continuation token
 * @returns {string} Encoded cursor
 */
function createContinuationCursor(continuationToken) {
  if (!continuationToken) return null;
  return encodeCursor({
    type: CURSOR_TYPES.CONTINUATION,
    token: continuationToken,
  });
}

/**
 * Create an offset cursor (legacy compatibility)
 * @param {number} offset - Current offset
 * @param {number} limit - Page size
 * @returns {string} Encoded cursor
 */
function createOffsetCursor(offset, limit) {
  return encodeCursor({
    type: CURSOR_TYPES.OFFSET,
    offset: offset + limit,
    limit,
  });
}

/**
 * Standardized paginated response format
 * @param {Array} items - Items in the current page
 * @param {Object} options - Pagination metadata
 * @returns {Object} Standardized paginated response
 */
function createPaginatedResponse(items, options = {}) {
  const {
    nextCursor = null,
    previousCursor = null,
    hasMore = false,
    totalCount = null,
    pageSize = items.length,
    currentPage = null,
  } = options;

  return {
    items,
    pagination: {
      nextCursor,
      previousCursor,
      hasMore,
      pageSize,
      itemCount: items.length,
      ...(totalCount !== null && { totalCount }),
      ...(currentPage !== null && { currentPage }),
    },
  };
}

/**
 * Parse pagination parameters from request query
 * @param {Object} query - Request query parameters
 * @returns {Object} Parsed pagination parameters
 */
function parsePaginationParams(query = {}) {
  let pageSize = parseInt(query.pageSize || query.limit || DEFAULTS.PAGE_SIZE, 10);

  // Enforce max page size
  if (isNaN(pageSize) || pageSize < 1) {
    pageSize = DEFAULTS.PAGE_SIZE;
  } else if (pageSize > DEFAULTS.MAX_PAGE_SIZE) {
    pageSize = DEFAULTS.MAX_PAGE_SIZE;
  }

  return {
    cursor: query.cursor || null,
    pageSize,
    sortField: query.sortBy || 'timestamp',
    sortOrder: query.sortOrder === 'asc' ? 'ASC' : 'DESC',
  };
}

/**
 * Paginate Cosmos DB query results using continuation tokens
 * This is the most efficient method for Cosmos DB
 *
 * @param {Object} container - Cosmos DB container
 * @param {Object} querySpec - Query specification { query, parameters }
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated response
 */
async function paginateCosmosQuery(container, querySpec, options = {}) {
  const { cursor, pageSize = DEFAULTS.PAGE_SIZE } = options;

  // Decode cursor to get continuation token
  const cursorData = decodeCursor(cursor);
  const continuationToken = cursorData?.type === CURSOR_TYPES.CONTINUATION
    ? cursorData.token
    : undefined;

  const queryOptions = {
    maxItemCount: pageSize,
    continuationToken,
  };

  try {
    const iterator = container.items.query(querySpec, queryOptions);
    const { resources, continuationToken: nextToken } = await iterator.fetchNext();

    const hasMore = !!nextToken;
    const nextCursor = hasMore ? createContinuationCursor(nextToken) : null;

    return createPaginatedResponse(resources || [], {
      nextCursor,
      hasMore,
      pageSize,
    });
  } catch (error) {
    log.errorWithStack('Failed to paginate Cosmos query', error);
    throw error;
  }
}

/**
 * Paginate Cosmos DB query results using keyset pagination
 * Useful when you need stable ordering and don't want to rely on continuation tokens
 *
 * @param {Object} container - Cosmos DB container
 * @param {string} baseQuery - Base SQL query without pagination
 * @param {Array} parameters - Query parameters
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated response
 */
async function paginateCosmosKeyset(container, baseQuery, parameters = [], options = {}) {
  const {
    cursor,
    pageSize = DEFAULTS.PAGE_SIZE,
    sortField = 'timestamp',
    sortOrder = 'DESC',
  } = options;

  const cursorData = decodeCursor(cursor);
  let finalQuery = baseQuery;
  const finalParams = [...parameters];

  // Add keyset condition if cursor provided
  if (cursorData?.type === CURSOR_TYPES.KEYSET && cursorData.sortValue) {
    const operator = sortOrder === 'DESC' ? '<' : '>';
    const existingWhere = baseQuery.toLowerCase().includes(' where ');
    const connector = existingWhere ? ' AND' : ' WHERE';

    // For stable pagination, we need to handle equal sort values by also comparing id
    finalQuery = `${baseQuery}${connector} (c.${sortField} ${operator} @cursorSortValue OR (c.${sortField} = @cursorSortValue AND c.id ${operator} @cursorId))`;
    finalParams.push(
      { name: '@cursorSortValue', value: cursorData.sortValue },
      { name: '@cursorId', value: cursorData.id }
    );
  }

  // Add ORDER BY and LIMIT
  finalQuery += ` ORDER BY c.${sortField} ${sortOrder}, c.id ${sortOrder}`;
  finalQuery += ` OFFSET 0 LIMIT @pageSize`;
  finalParams.push({ name: '@pageSize', value: pageSize + 1 }); // Fetch one extra to detect hasMore

  try {
    const { resources } = await container.items
      .query({ query: finalQuery, parameters: finalParams })
      .fetchAll();

    const hasMore = resources.length > pageSize;
    const items = hasMore ? resources.slice(0, pageSize) : resources;

    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? createKeysetCursor(lastItem, sortField)
      : null;

    return createPaginatedResponse(items, {
      nextCursor,
      hasMore,
      pageSize,
    });
  } catch (error) {
    log.errorWithStack('Failed to paginate Cosmos keyset query', error);
    throw error;
  }
}

/**
 * Paginate Gremlin query results
 * Gremlin doesn't have native cursor support, so we use keyset pagination
 *
 * @param {Object} gremlinClient - Gremlin client
 * @param {string} baseQuery - Base Gremlin query
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>} Paginated response
 */
async function paginateGremlinQuery(gremlinClient, baseQuery, options = {}) {
  const {
    cursor,
    pageSize = DEFAULTS.PAGE_SIZE,
    sortField = 'createdAt',
    sortOrder = 'DESC',
  } = options;

  const cursorData = decodeCursor(cursor);
  let gremlinQuery = baseQuery;

  // Add keyset filtering if cursor provided
  if (cursorData?.type === CURSOR_TYPES.KEYSET && cursorData.sortValue) {
    const operator = sortOrder === 'DESC' ? 'lt' : 'gt';
    // Gremlin has filter syntax
    gremlinQuery += `.has('${sortField}', ${operator}('${cursorData.sortValue}'))`;
  }

  // Add ordering
  const orderDirection = sortOrder === 'DESC' ? 'desc' : 'asc';
  gremlinQuery += `.order().by('${sortField}', ${orderDirection})`;

  // Fetch one extra to detect hasMore
  gremlinQuery += `.limit(${pageSize + 1})`;

  try {
    const result = await gremlinClient.submit(gremlinQuery);
    const resources = result._items || result.toArray?.() || [];

    const hasMore = resources.length > pageSize;
    const items = hasMore ? resources.slice(0, pageSize) : resources;

    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem
      ? createKeysetCursor({
          [sortField]: lastItem.properties?.[sortField]?.[0]?.value || lastItem[sortField],
          id: lastItem.id,
        }, sortField)
      : null;

    return createPaginatedResponse(items, {
      nextCursor,
      hasMore,
      pageSize,
    });
  } catch (error) {
    log.errorWithStack('Failed to paginate Gremlin query', error);
    throw error;
  }
}

/**
 * Paginate an in-memory array
 * Useful for already-fetched data or small collections
 *
 * @param {Array} items - Array of items to paginate
 * @param {Object} options - Pagination options
 * @returns {Object} Paginated response
 */
function paginateArray(items, options = {}) {
  const {
    cursor,
    pageSize = DEFAULTS.PAGE_SIZE,
    sortField = null,
    sortOrder = 'DESC',
    totalCount = null,
  } = options;

  let sortedItems = [...items];

  // Sort if sortField specified
  if (sortField) {
    sortedItems.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal === bVal) return 0;
      const comparison = aVal < bVal ? -1 : 1;
      return sortOrder === 'DESC' ? -comparison : comparison;
    });
  }

  // Decode cursor for offset-based pagination
  const cursorData = decodeCursor(cursor);
  let offset = 0;

  if (cursorData?.type === CURSOR_TYPES.OFFSET) {
    offset = cursorData.offset || 0;
  } else if (cursorData?.type === CURSOR_TYPES.KEYSET && sortField) {
    // Find position by keyset
    const idx = sortedItems.findIndex(item =>
      item[sortField] === cursorData.sortValue && item.id === cursorData.id
    );
    offset = idx >= 0 ? idx + 1 : 0;
  }

  const pagedItems = sortedItems.slice(offset, offset + pageSize);
  const hasMore = offset + pageSize < sortedItems.length;

  const nextCursor = hasMore
    ? createOffsetCursor(offset, pageSize)
    : null;

  return createPaginatedResponse(pagedItems, {
    nextCursor,
    hasMore,
    pageSize,
    totalCount: totalCount ?? sortedItems.length,
    currentPage: Math.floor(offset / pageSize) + 1,
  });
}

/**
 * Pagination middleware for Express routes
 * Adds pagination helpers to request object
 *
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
function paginationMiddleware(options = {}) {
  const { defaultPageSize = DEFAULTS.PAGE_SIZE } = options;

  return (req, res, next) => {
    // Parse pagination params from query
    req.pagination = parsePaginationParams({
      ...req.query,
      limit: req.query.limit || defaultPageSize,
    });

    // Add helper to send paginated response
    res.paginate = (items, paginationMeta = {}) => {
      const response = createPaginatedResponse(items, paginationMeta);
      res.json(response);
    };

    next();
  };
}

/**
 * Helper to add pagination query params to Cosmos SQL query
 * @param {string} baseQuery - Base SQL query
 * @param {Object} options - Pagination options
 * @returns {Object} { query, parameters }
 */
function buildPaginatedCosmosQuery(baseQuery, options = {}) {
  const {
    sortField = 'timestamp',
    sortOrder = 'DESC',
    pageSize = DEFAULTS.PAGE_SIZE,
    cursor = null,
  } = options;

  let query = baseQuery;
  const parameters = [];

  const cursorData = decodeCursor(cursor);

  // Add keyset condition
  if (cursorData?.type === CURSOR_TYPES.KEYSET && cursorData.sortValue) {
    const operator = sortOrder === 'DESC' ? '<' : '>';
    const existingWhere = baseQuery.toLowerCase().includes(' where ');
    const connector = existingWhere ? ' AND' : ' WHERE';

    query = `${baseQuery}${connector} (c.${sortField} ${operator} @cursorSortValue OR (c.${sortField} = @cursorSortValue AND c.id ${operator} @cursorId))`;
    parameters.push(
      { name: '@cursorSortValue', value: cursorData.sortValue },
      { name: '@cursorId', value: cursorData.id }
    );
  }

  // Add ORDER BY
  query += ` ORDER BY c.${sortField} ${sortOrder}, c.id ${sortOrder}`;

  // Add LIMIT (fetch one extra for hasMore detection)
  query += ` OFFSET 0 LIMIT @pageSize`;
  parameters.push({ name: '@pageSize', value: pageSize + 1 });

  return { query, parameters, pageSize };
}

/**
 * Process query results and create paginated response
 * @param {Array} results - Query results
 * @param {Object} options - Options including pageSize and sortField
 * @returns {Object} Paginated response
 */
function processPaginatedResults(results, options = {}) {
  const { pageSize = DEFAULTS.PAGE_SIZE, sortField = 'timestamp' } = options;

  const hasMore = results.length > pageSize;
  const items = hasMore ? results.slice(0, pageSize) : results;

  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem
    ? createKeysetCursor(lastItem, sortField)
    : null;

  return createPaginatedResponse(items, {
    nextCursor,
    hasMore,
    pageSize,
  });
}

/**
 * Pagination Service class for dependency injection
 */
class PaginationService {
  constructor(options = {}) {
    this.defaultPageSize = options.defaultPageSize || DEFAULTS.PAGE_SIZE;
    this.maxPageSize = options.maxPageSize || DEFAULTS.MAX_PAGE_SIZE;
  }

  encodeCursor(data) { return encodeCursor(data); }
  decodeCursor(cursor) { return decodeCursor(cursor); }

  parseParams(query) {
    return parsePaginationParams({ ...query, limit: query.limit || this.defaultPageSize });
  }

  createResponse(items, meta) { return createPaginatedResponse(items, meta); }

  async paginateCosmos(container, querySpec, options) {
    return paginateCosmosQuery(container, querySpec, { ...options, pageSize: options.pageSize || this.defaultPageSize });
  }

  async paginateCosmosKeyset(container, baseQuery, params, options) {
    return paginateCosmosKeyset(container, baseQuery, params, { ...options, pageSize: options.pageSize || this.defaultPageSize });
  }

  paginateArray(items, options) {
    return paginateArray(items, { ...options, pageSize: options.pageSize || this.defaultPageSize });
  }

  buildQuery(baseQuery, options) {
    return buildPaginatedCosmosQuery(baseQuery, { ...options, pageSize: options.pageSize || this.defaultPageSize });
  }

  processResults(results, options) {
    return processPaginatedResults(results, { ...options, pageSize: options.pageSize || this.defaultPageSize });
  }
}

// Singleton instance
let instance = null;

function getPaginationService(options) {
  if (!instance) {
    instance = new PaginationService(options);
  }
  return instance;
}

module.exports = {
  // Constants
  DEFAULTS,
  CURSOR_TYPES,

  // Core functions
  encodeCursor,
  decodeCursor,
  createKeysetCursor,
  createContinuationCursor,
  createOffsetCursor,
  createPaginatedResponse,
  parsePaginationParams,

  // Database-specific pagination
  paginateCosmosQuery,
  paginateCosmosKeyset,
  paginateGremlinQuery,
  paginateArray,

  // Helpers
  buildPaginatedCosmosQuery,
  processPaginatedResults,
  paginationMiddleware,

  // Service class
  PaginationService,
  getPaginationService,
};
