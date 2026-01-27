/**
 * Clear Azure Search Index
 *
 * Deletes all documents from the Azure Search index.
 */

const { SearchClient, AzureKeyCredential } = require('@azure/search-documents');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = {
  endpoint: process.env.AZURE_SEARCH_ENDPOINT,
  apiKey: process.env.AZURE_SEARCH_API_KEY,
  indexName: process.env.AZURE_SEARCH_INDEX_NAME || 'documents',
};

async function clearSearchIndex() {
  console.log('Connecting to Azure Search...');
  console.log(`Endpoint: ${config.endpoint}`);
  console.log(`Index: ${config.indexName}`);

  const client = new SearchClient(
    config.endpoint,
    config.indexName,
    new AzureKeyCredential(config.apiKey)
  );

  try {
    // Get document count
    const countResult = await client.search('*', { top: 0, includeTotalCount: true });
    const totalCount = countResult.count || 0;
    console.log(`\nFound ${totalCount} documents in index`);

    if (totalCount === 0) {
      console.log('Index is already empty!');
      return;
    }

    // Get all document IDs
    console.log('Fetching document IDs...');
    const searchResult = await client.search('*', {
      select: ['id'],
      top: 1000 // Azure Search limit per request
    });

    const documentIds = [];
    for await (const result of searchResult.results) {
      documentIds.push(result.document.id);
    }

    console.log(`Retrieved ${documentIds.length} document IDs`);

    if (documentIds.length === 0) {
      console.log('No documents to delete.');
      return;
    }

    // Delete documents in batches
    const BATCH_SIZE = 100;
    let deleted = 0;

    for (let i = 0; i < documentIds.length; i += BATCH_SIZE) {
      const batch = documentIds.slice(i, i + BATCH_SIZE);
      const actions = batch.map(id => ({ delete: { id } }));

      try {
        await client.indexDocuments({ actions });
        deleted += batch.length;
        console.log(`Deleted ${deleted}/${documentIds.length} documents...`);
      } catch (err) {
        console.error(`Error deleting batch: ${err.message}`);
      }
    }

    console.log(`\nDeleted ${deleted} documents total.`);

    // Verify final count (may take a moment to reflect)
    console.log('Verifying (note: count may not reflect immediately)...');
    const finalResult = await client.search('*', { top: 0, includeTotalCount: true });
    console.log(`Remaining documents: ${finalResult.count || 0}`);

  } catch (error) {
    if (error.code === 'IndexNotFound') {
      console.log('Index does not exist.');
    } else {
      console.error('Error:', error.message);
      throw error;
    }
  }
}

clearSearchIndex()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
