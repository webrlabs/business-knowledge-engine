require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');
const { getEntityExtractorService } = require('../src/services/entity-extractor');
const { getSemanticChunker } = require('../src/chunking/semantic-chunker');

async function testFullPipeline() {
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

  // Try semantic chunking (like the processor does)
  console.log('\n--- Testing semantic chunking ---');
  const semanticChunker = getSemanticChunker();

  try {
    const semanticResult = await semanticChunker.chunkText(extractedText, {
      breakpointPercentileThreshold: 95,
      bufferSize: 1,
    });

    console.log('Semantic chunking result:');
    console.log('  Method:', semanticResult.metadata.method);
    console.log('  Chunks:', semanticResult.chunks.length);
    console.log('  Breakpoints:', semanticResult.metadata.breakpoints?.length || 0);

    // Convert to proper chunk format
    const chunks = semanticResult.chunks.map((c, index) => ({
      id: `test_chunk_${index}`,
      chunkIndex: index,
      content: c.content,
      metadata: {
        sectionTitle: `Chunk ${index + 1}`,
        pageNumber: 1,
      }
    }));

    console.log('\n--- Testing entity extraction on chunks ---');
    const extractor = getEntityExtractorService();

    // Process document like the pipeline does
    const result = await extractor.processDocument(chunks, 'test-doc-id', doc.originalName);

    console.log('\nTotal extracted:');
    console.log('  Entities:', result.entities.length);
    console.log('  Relationships:', result.relationships.length);

    if (result.entities.length > 0) {
      console.log('\nFirst 10 entities:');
      for (const e of result.entities.slice(0, 10)) {
        console.log(`  - ${e.name} (${e.type}) - conf: ${e.confidence}`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  }
}

testFullPipeline().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
