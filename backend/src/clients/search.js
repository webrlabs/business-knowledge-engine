const { SearchClient } = require('@azure/search-documents');
const { DefaultAzureCredential } = require('@azure/identity');

function createSearchClient() {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const indexName = process.env.AZURE_SEARCH_INDEX_NAME || '';
  if (!endpoint) {
    throw new Error('AZURE_SEARCH_ENDPOINT is required');
  }
  if (!indexName) {
    throw new Error('AZURE_SEARCH_INDEX_NAME is required');
  }
  return new SearchClient(endpoint, indexName, new DefaultAzureCredential());
}

module.exports = {
  createSearchClient,
};
