/**
 * Test entity extraction on a single chunk
 * Usage: node scripts/test-entity-extraction.js <document-id>
 */

require('dotenv').config();

const { CosmosClient } = require('@azure/cosmos');
const { getDocumentIntelligenceService } = require('../src/services/docint-service');
const { generateSasUrl, getBlobNameFromUrl } = require('../src/storage/blob');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const containerId = process.env.COSMOS_DB_DOCUMENTS_CONTAINER || 'documents';

async function getDocument(id) {
  const client = new CosmosClient({ endpoint, key });
  const container = client.database(databaseId).container(containerId);
  const query = {
    query: 'SELECT * FROM c WHERE c.id = @id',
    parameters: [{ name: '@id', value: id }],
  };
  const { resources } = await container.items.query(query).fetchAll();
  return resources[0];
}

async function testExtraction(id) {
  console.log('Fetching document...');
  const document = await getDocument(id);

  if (!document) {
    console.log('Document not found');
    return;
  }

  console.log('Document:', document.title);
  console.log('Blob URL:', document.blobUrl);

  // Generate SAS URL
  console.log('\nGenerating SAS URL...');
  const blobName = getBlobNameFromUrl(document.blobUrl);
  const sasUrl = await generateSasUrl(blobName);
  console.log('SAS URL generated');

  // Extract content using Document Intelligence
  console.log('\nExtracting content with Document Intelligence...');
  const docIntelService = getDocumentIntelligenceService();
  const extractedContent = await docIntelService.analyzeDocument(sasUrl);

  console.log('\n=== Extraction Results ===');
  console.log('Content length:', extractedContent.content?.length || 0);
  console.log('Pages:', extractedContent.metadata?.pageCount || 0);
  console.log('Paragraphs:', extractedContent.paragraphs?.length || 0);
  console.log('Sections:', extractedContent.sections?.sections?.length || 0);
  console.log('Tables:', extractedContent.tables?.length || 0);

  // Check chunking
  console.log('\n=== Chunk Analysis ===');
  const chunks = [];
  const paragraphs = extractedContent.paragraphs || [];

  // Estimate chunks (simplified version)
  let currentChunk = '';
  let chunkCount = 0;
  const MAX_CHUNK_SIZE = 2000;

  for (const para of paragraphs) {
    if (currentChunk.length + (para.content?.length || 0) > MAX_CHUNK_SIZE) {
      if (currentChunk.length > 0) {
        chunkCount++;
      }
      currentChunk = para.content || '';
    } else {
      currentChunk += '\n' + (para.content || '');
    }
  }
  if (currentChunk.length > 0) chunkCount++;

  console.log('Estimated chunks:', chunkCount);
  console.log('This means', chunkCount, 'OpenAI API calls for entity extraction');
  console.log('Plus', chunkCount, 'calls for relationship extraction');
  console.log('Total estimated API calls:', chunkCount * 2);

  // Test a single entity extraction
  console.log('\n=== Testing Entity Extraction (first paragraph) ===');
  const testText = paragraphs[0]?.content || extractedContent.content?.substring(0, 1000);
  console.log('Test text:', testText?.substring(0, 200) + '...');

  const { EntityExtractorService } = require('../src/services/entity-extractor');
  const extractor = new EntityExtractorService();

  console.log('\nCalling OpenAI for entity extraction...');
  const startTime = Date.now();

  try {
    const entities = await extractor.extractEntities(testText, { title: document.title });
    console.log(`Extraction completed in ${Date.now() - startTime}ms`);
    console.log('Entities found:', entities.length);
    console.log('Entities:', entities.map(e => `${e.name} (${e.type})`).join(', '));
  } catch (error) {
    console.error('Entity extraction failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

const docId = process.argv[2];
if (!docId) {
  console.log('Usage: node scripts/test-entity-extraction.js <document-id>');
  process.exit(1);
}

testExtraction(docId).catch(console.error);
