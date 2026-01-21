const { SearchClient, SearchIndexClient, SearchIndexerClient } = require('@azure/search-documents');
const { AzureKeyCredential } = require('@azure/core-auth');
const { DefaultAzureCredential } = require('@azure/identity');

/**
 * Escapes a string value for safe use in OData filter expressions.
 * Prevents OData injection attacks by escaping single quotes.
 * @param {string} value - The value to escape
 * @returns {string} - The escaped value safe for OData filters
 */
function escapeODataString(value) {
  if (typeof value !== 'string') {
    throw new Error('OData filter value must be a string');
  }
  // In OData, single quotes are escaped by doubling them
  return value.replace(/'/g, "''");
}

/**
 * Validates that a string is a valid UUID format.
 * @param {string} value - The value to validate
 * @returns {boolean} - True if valid UUID
 */
function isValidUUID(value) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof value === 'string' && uuidRegex.test(value);
}

const INDEX_SCHEMA = {
  name: process.env.AZURE_SEARCH_INDEX_NAME || 'documents',
  fields: [
    { name: 'id', type: 'Edm.String', key: true, filterable: true },
    { name: 'documentId', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'chunkIndex', type: 'Edm.Int32', sortable: true },
    { name: 'content', type: 'Edm.String', searchable: true, analyzerName: 'standard.lucene' },
    { name: 'contentVector', type: 'Collection(Edm.Single)', searchable: true, vectorSearchDimensions: 1536, vectorSearchProfileName: 'vector-profile' },
    { name: 'title', type: 'Edm.String', searchable: true, filterable: true },
    { name: 'sourceFile', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'pageNumber', type: 'Edm.Int32', filterable: true, sortable: true },
    { name: 'sectionTitle', type: 'Edm.String', searchable: true, filterable: true },
    { name: 'chunkType', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'entities', type: 'Collection(Edm.String)', searchable: true, filterable: true },
    { name: 'uploadedAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
    { name: 'processedAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
    { name: 'metadata', type: 'Edm.String', searchable: false, filterable: false },
  ],
  vectorSearch: {
    algorithms: [
      {
        name: 'hnsw-algorithm',
        kind: 'hnsw',
        parameters: {
          m: 4,
          efConstruction: 400,
          efSearch: 500,
          metric: 'cosine',
        },
      },
    ],
    profiles: [
      {
        name: 'vector-profile',
        algorithmConfigurationName: 'hnsw-algorithm',
      },
    ],
  },
  semantic: {
    configurations: [
      {
        name: 'semantic-config',
        prioritizedFields: {
          contentFields: [{ fieldName: 'content' }],
          titleField: { fieldName: 'title' },
          keywordsFields: [{ fieldName: 'entities' }],
        },
      },
    ],
  },
};

class SearchService {
  constructor() {
    this.searchClient = null;
    this.indexClient = null;
    this.endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    this.indexName = process.env.AZURE_SEARCH_INDEX_NAME || 'documents';
    this.apiKey = process.env.AZURE_SEARCH_API_KEY;
  }

  _getCredential() {
    // Use API key if provided (local dev), otherwise use Azure AD (deployed)
    if (this.apiKey) {
      return new AzureKeyCredential(this.apiKey);
    }
    return new DefaultAzureCredential();
  }

  async _getSearchClient() {
    if (!this.searchClient) {
      if (!this.endpoint) {
        throw new Error('AZURE_SEARCH_ENDPOINT is required');
      }
      this.searchClient = new SearchClient(this.endpoint, this.indexName, this._getCredential());
    }
    return this.searchClient;
  }

  async _getIndexClient() {
    if (!this.indexClient) {
      if (!this.endpoint) {
        throw new Error('AZURE_SEARCH_ENDPOINT is required');
      }
      this.indexClient = new SearchIndexClient(this.endpoint, this._getCredential());
    }
    return this.indexClient;
  }

  async ensureIndexExists() {
    const indexClient = await this._getIndexClient();

    try {
      await indexClient.getIndex(this.indexName);
    } catch (error) {
      if (error.statusCode === 404) {
        await indexClient.createIndex(INDEX_SCHEMA);
      } else {
        throw error;
      }
    }
  }

  async indexDocument(document) {
    const client = await this._getSearchClient();

    const result = await client.uploadDocuments([document]);

    if (result.results[0].succeeded) {
      return { success: true, key: result.results[0].key };
    } else {
      throw new Error(`Failed to index document: ${result.results[0].errorMessage}`);
    }
  }

  async indexDocuments(documents) {
    if (documents.length === 0) {
      return { success: true, indexed: 0 };
    }

    const client = await this._getSearchClient();

    // Prepare documents - serialize metadata object to JSON string
    const preparedDocuments = documents.map(doc => {
      const prepared = { ...doc };
      if (prepared.metadata && typeof prepared.metadata === 'object') {
        prepared.metadata = JSON.stringify(prepared.metadata);
      }
      return prepared;
    });

    // Process in batches of 100
    const BATCH_SIZE = 100;
    let totalIndexed = 0;
    const errors = [];

    for (let i = 0; i < preparedDocuments.length; i += BATCH_SIZE) {
      const batch = preparedDocuments.slice(i, i + BATCH_SIZE);

      const result = await client.uploadDocuments(batch);

      for (const r of result.results) {
        if (r.succeeded) {
          totalIndexed++;
        } else {
          errors.push({ key: r.key, error: r.errorMessage });
        }
      }
    }

    return {
      success: errors.length === 0,
      indexed: totalIndexed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async deleteDocumentsByDocumentId(documentId) {
    const client = await this._getSearchClient();

    // Validate documentId to prevent injection attacks
    if (!documentId || typeof documentId !== 'string') {
      throw new Error('documentId must be a non-empty string');
    }

    // First, find all chunks for this document
    // Use escapeODataString to prevent OData injection
    const safeDocumentId = escapeODataString(documentId);
    const searchResults = await client.search('*', {
      filter: `documentId eq '${safeDocumentId}'`,
      select: ['id'],
    });

    const keysToDelete = [];
    for await (const result of searchResults.results) {
      keysToDelete.push({ id: result.document.id });
    }

    if (keysToDelete.length === 0) {
      return { success: true, deleted: 0 };
    }

    const deleteResult = await client.deleteDocuments(keysToDelete);

    const deletedCount = deleteResult.results.filter((r) => r.succeeded).length;
    return { success: true, deleted: deletedCount };
  }

  async hybridSearch(query, queryVector, options = {}) {
    const client = await this._getSearchClient();

    const searchOptions = {
      top: options.top || 10,
      select: options.select || ['id', 'documentId', 'content', 'title', 'sourceFile', 'pageNumber', 'sectionTitle', 'entities', 'chunkType'],
      includeTotalCount: true,
    };

    // Add vector search if vector provided
    if (queryVector && queryVector.length > 0) {
      searchOptions.vectorSearchOptions = {
        queries: [
          {
            kind: 'vector',
            vector: queryVector,
            fields: ['contentVector'],
            kNearestNeighborsCount: options.top || 10,
          },
        ],
      };
    }

    // Add semantic search if enabled
    if (options.semantic !== false) {
      searchOptions.queryType = 'semantic';
      searchOptions.semanticSearchOptions = {
        configurationName: 'semantic-config',
      };
    }

    // Add filters - WARNING: If filter comes from user input, it should be validated
    // Only allow filters that have been constructed using escapeODataString
    if (options.filter) {
      if (typeof options.filter !== 'string') {
        throw new Error('Filter must be a string');
      }
      searchOptions.filter = options.filter;
    }

    const searchResults = await client.search(query || '*', searchOptions);

    const results = [];
    for await (const result of searchResults.results) {
      results.push({
        ...result.document,
        score: result.score,
        rerankerScore: result.rerankerScore,
        highlights: result.highlights,
      });
    }

    return {
      results,
      totalCount: searchResults.count,
    };
  }

  async vectorSearch(queryVector, options = {}) {
    const client = await this._getSearchClient();

    const searchOptions = {
      top: options.top || 10,
      select: options.select || ['id', 'documentId', 'content', 'title', 'sourceFile', 'pageNumber', 'sectionTitle', 'entities', 'chunkType'],
      vectorSearchOptions: {
        queries: [
          {
            kind: 'vector',
            vector: queryVector,
            fields: ['contentVector'],
            kNearestNeighborsCount: options.top || 10,
          },
        ],
      },
    };

    // Add filters - WARNING: If filter comes from user input, it should be validated
    if (options.filter) {
      if (typeof options.filter !== 'string') {
        throw new Error('Filter must be a string');
      }
      searchOptions.filter = options.filter;
    }

    const searchResults = await client.search('*', searchOptions);

    const results = [];
    for await (const result of searchResults.results) {
      results.push({
        ...result.document,
        score: result.score,
      });
    }

    return { results };
  }

  /**
   * Build a safe filter expression for documentId
   * @param {string} documentId - The document ID to filter by
   * @returns {string} - Safe OData filter expression
   */
  buildDocumentIdFilter(documentId) {
    return `documentId eq '${escapeODataString(documentId)}'`;
  }
}

// Singleton instance
let instance = null;

function getSearchService() {
  if (!instance) {
    instance = new SearchService();
  }
  return instance;
}

module.exports = {
  SearchService,
  getSearchService,
  INDEX_SCHEMA,
  escapeODataString,
  isValidUUID,
};
