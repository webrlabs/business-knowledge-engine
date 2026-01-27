require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');
const { getEntityExtractorService } = require('../src/services/entity-extractor');

async function testExtraction() {
  console.log('Getting document from Cosmos...');

  // Get the document
  const doc = await getDocumentById('d5caf7d3-92f1-4a74-ad8d-30b9203980a4');

  if (!doc) {
    console.log('Document not found');
    return;
  }

  console.log('Document found:', doc.originalName);
  const extractedText = doc.extractedText || doc.processingResults?.extractedText;
  console.log('Text length:', extractedText.length);

  // Create mock chunks like the processor would
  const CHUNK_SIZE = 1000;
  const chunks = [];
  for (let i = 0; i < extractedText.length; i += CHUNK_SIZE) {
    chunks.push({
      content: extractedText.substring(i, i + CHUNK_SIZE),
      metadata: {
        chunkIndex: chunks.length,
        pageNumber: 1,
      }
    });
  }

  console.log(`\nCreated ${chunks.length} mock chunks`);
  console.log('First chunk (first 200 chars):', chunks[0].content.substring(0, 200));

  // Test entity extraction
  console.log('\n--- Testing entity extraction ---');
  const extractor = getEntityExtractorService();

  console.log('Processing first chunk...');
  try {
    const result = await extractor.processChunk(chunks[0].content, [], {
      title: doc.originalName,
      pageNumber: 1,
    });

    console.log('\nExtracted entities:', result.entities.length);
    console.log('Extracted relationships:', result.relationships.length);

    if (result.entities.length > 0) {
      console.log('\nFirst 5 entities:');
      for (const e of result.entities.slice(0, 5)) {
        console.log(`  - ${e.name} (${e.type}) - ${e.confidence}`);
      }
    }
  } catch (err) {
    console.error('Entity extraction error:', err.message);
    console.error(err.stack);
  }
}

testExtraction().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
