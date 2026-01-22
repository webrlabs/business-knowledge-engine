/**
 * Retry processing a stuck document
 * Usage: node scripts/retry-processing.js <document-id>
 */

require('dotenv').config();

const { CosmosClient } = require('@azure/cosmos');
const { DocumentProcessor } = require('../src/pipelines/document-processor');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const containerId = process.env.COSMOS_DB_DOCUMENTS_CONTAINER || 'documents';

async function getContainer() {
  const client = new CosmosClient({ endpoint, key });
  return client.database(databaseId).container(containerId);
}

async function getDocument(id) {
  const container = await getContainer();
  const query = {
    query: 'SELECT * FROM c WHERE c.id = @id',
    parameters: [{ name: '@id', value: id }],
  };
  const { resources } = await container.items.query(query).fetchAll();
  return resources[0];
}

async function updateDocument(id, updates) {
  const container = await getContainer();
  const doc = await getDocument(id);
  if (!doc) return null;

  const partitionKey = doc.documentType || 'document';
  const updated = { ...doc, ...updates };
  const { resource } = await container.item(id, partitionKey).replace(updated);
  return resource;
}

async function retryProcessing(id) {
  console.log('Fetching document...');
  const document = await getDocument(id);

  if (!document) {
    console.log('Document not found');
    return;
  }

  console.log('Document:', document.title);
  console.log('Current status:', document.status);
  console.log('Blob URL:', document.blobUrl);

  // Reset status to processing
  console.log('\nResetting status to processing...');
  await updateDocument(id, {
    status: 'processing',
    processingError: null,
    processingStartedAt: new Date().toISOString(),
  });

  // Create cosmos service wrapper
  const cosmosService = {
    updateDocument: async (docId, updates) => {
      console.log(`  Status update: ${updates.status || updates.processingStage || 'update'}`);
      return updateDocument(docId, updates);
    },
    getDocument,
  };

  // Process document
  console.log('\nStarting processing...');
  const processor = new DocumentProcessor(cosmosService);

  try {
    const result = await processor.processDocument(id, document.blobUrl, {
      mimeType: document.mimeType,
      filename: document.filename,
      title: document.title,
    });

    console.log('\n=== Processing Complete ===');
    console.log('Stats:', JSON.stringify(result.stats, null, 2));
  } catch (error) {
    console.error('\n=== Processing Failed ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

const docId = process.argv[2];
if (!docId) {
  console.log('Usage: node scripts/retry-processing.js <document-id>');
  process.exit(1);
}

retryProcessing(docId).catch(console.error);
