/**
 * Cleanup script to list and delete corrupted documents from Cosmos DB
 * Usage:
 *   node scripts/cleanup-documents.js list          - List all documents
 *   node scripts/cleanup-documents.js delete <id>   - Delete a specific document
 *   node scripts/cleanup-documents.js delete-all-failed - Delete all failed documents
 */

require('dotenv').config();

const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const containerId = process.env.COSMOS_DB_DOCUMENTS_CONTAINER || 'documents';

async function getContainer() {
  if (!endpoint || !key) {
    throw new Error('COSMOS_DB_ENDPOINT and COSMOS_DB_KEY are required');
  }
  const client = new CosmosClient({ endpoint, key });
  const database = client.database(databaseId);
  const container = database.container(containerId);
  return container;
}

async function listDocuments() {
  const container = await getContainer();
  const query = 'SELECT c.id, c.documentType, c.title, c.originalName, c.status, c.uploadedAt FROM c ORDER BY c.uploadedAt DESC';
  const { resources } = await container.items.query(query).fetchAll();

  console.log('\n=== Documents in Cosmos DB ===\n');
  if (resources.length === 0) {
    console.log('No documents found.');
    return;
  }

  resources.forEach((doc, idx) => {
    console.log(`${idx + 1}. ID: ${doc.id}`);
    console.log(`   Title: ${doc.title || 'N/A'}`);
    console.log(`   File: ${doc.originalName || 'N/A'}`);
    console.log(`   Status: ${doc.status || 'N/A'}`);
    console.log(`   Partition Key (documentType): ${doc.documentType || 'MISSING'}`);
    console.log(`   Uploaded: ${doc.uploadedAt || 'N/A'}`);
    console.log('');
  });

  console.log(`Total: ${resources.length} documents`);
}

async function deleteDocument(id) {
  const container = await getContainer();

  // First, find the document to get its partition key
  const query = {
    query: 'SELECT * FROM c WHERE c.id = @id',
    parameters: [{ name: '@id', value: id }],
  };
  const { resources } = await container.items.query(query).fetchAll();

  if (resources.length === 0) {
    console.log(`Document ${id} not found.`);
    return false;
  }

  const doc = resources[0];
  console.log(`Found document: ${doc.title || doc.originalName || id}`);
  console.log(`Document data:`, JSON.stringify(doc, null, 2));

  // Try various partition key values
  const partitionKeysToTry = [
    doc.documentType,
    'document',
    '',
    null,
    undefined,
    doc.id,
  ].filter((v, i, arr) => arr.indexOf(v) === i); // unique values

  for (const pk of partitionKeysToTry) {
    try {
      console.log(`Trying partition key: ${JSON.stringify(pk)}`);
      await container.item(id, pk).delete();
      console.log(`Successfully deleted document ${id} with partition key: ${JSON.stringify(pk)}`);
      return true;
    } catch (error) {
      if (error.code !== 404) {
        console.log(`  Error with partition key ${JSON.stringify(pk)}: ${error.message.substring(0, 100)}`);
      }
    }
  }

  console.error(`Failed to delete document ${id} - tried all partition key strategies`);
  return false;
}

async function deleteAllFailed() {
  const container = await getContainer();

  // Find all failed documents
  const query = "SELECT * FROM c WHERE c.status = 'failed'";
  const { resources } = await container.items.query(query).fetchAll();

  if (resources.length === 0) {
    console.log('No failed documents found.');
    return;
  }

  console.log(`Found ${resources.length} failed documents. Deleting...`);

  for (const doc of resources) {
    const partitionKey = doc.documentType || doc.id;
    try {
      await container.item(doc.id, partitionKey).delete();
      console.log(`Deleted: ${doc.title || doc.originalName || doc.id}`);
    } catch (error) {
      console.error(`Failed to delete ${doc.id}:`, error.message);
    }
  }

  console.log('Done.');
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'list':
        await listDocuments();
        break;
      case 'delete':
        if (!args[1]) {
          console.error('Please provide a document ID to delete.');
          console.error('Usage: node scripts/cleanup-documents.js delete <document-id>');
          process.exit(1);
        }
        await deleteDocument(args[1]);
        break;
      case 'delete-all-failed':
        await deleteAllFailed();
        break;
      default:
        console.log('Usage:');
        console.log('  node scripts/cleanup-documents.js list              - List all documents');
        console.log('  node scripts/cleanup-documents.js delete <id>       - Delete a specific document');
        console.log('  node scripts/cleanup-documents.js delete-all-failed - Delete all failed documents');
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
