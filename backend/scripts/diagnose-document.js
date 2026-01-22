/**
 * Diagnostic script to check document processing status and errors
 * Usage: node scripts/diagnose-document.js <document-id>
 */

require('dotenv').config();

const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const containerId = process.env.COSMOS_DB_DOCUMENTS_CONTAINER || 'documents';

async function diagnoseDocument(id) {
  if (!endpoint || !key) {
    throw new Error('COSMOS_DB_ENDPOINT and COSMOS_DB_KEY are required');
  }

  const client = new CosmosClient({ endpoint, key });
  const container = client.database(databaseId).container(containerId);

  // Query for the document
  const query = {
    query: 'SELECT * FROM c WHERE c.id = @id',
    parameters: [{ name: '@id', value: id }],
  };
  const { resources } = await container.items.query(query).fetchAll();

  if (resources.length === 0) {
    console.log('Document not found');
    return;
  }

  const doc = resources[0];

  console.log('\n=== Document Diagnosis ===\n');
  console.log('ID:', doc.id);
  console.log('Title:', doc.title);
  console.log('File:', doc.originalName);
  console.log('Status:', doc.status);
  console.log('Uploaded:', doc.uploadedAt);
  console.log('Processing Started:', doc.processingStartedAt || 'N/A');
  console.log('Processing Completed:', doc.processingCompletedAt || 'N/A');

  if (doc.processingError) {
    console.log('\n=== Processing Error ===');
    console.log(doc.processingError);
  }

  if (doc.processingResults) {
    console.log('\n=== Processing Results ===');
    console.log('Extracted Text Length:', doc.processingResults.extractedText?.length || 0);
    console.log('Tables:', doc.processingResults.tables?.length || 0);
    if (doc.processingResults.metadata) {
      console.log('Metadata:', JSON.stringify(doc.processingResults.metadata, null, 2));
    }
  }

  if (doc.entities) {
    console.log('\n=== Entities ===');
    console.log('Count:', doc.entities.length);
    if (doc.entities.length > 0) {
      console.log('First 5:', doc.entities.slice(0, 5).map(e => `${e.name} (${e.type})`).join(', '));
    }
  }

  if (doc.relationships) {
    console.log('\n=== Relationships ===');
    console.log('Count:', doc.relationships.length);
  }

  console.log('\n=== Full Document Data ===');
  // Print keys and their types/sizes
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('_')) continue; // Skip Cosmos metadata
    const type = Array.isArray(value) ? `array[${value.length}]` : typeof value;
    const preview = typeof value === 'string'
      ? value.substring(0, 50) + (value.length > 50 ? '...' : '')
      : type === 'object' ? JSON.stringify(value).substring(0, 50) + '...' : value;
    console.log(`  ${key}: (${type}) ${preview}`);
  }
}

const docId = process.argv[2];
if (!docId) {
  console.log('Usage: node scripts/diagnose-document.js <document-id>');
  process.exit(1);
}

diagnoseDocument(docId).catch(console.error);
