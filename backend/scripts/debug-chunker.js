require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');
const { getSemanticChunker } = require('../src/chunking/semantic-chunker');

async function test() {
  console.log('Getting document from Cosmos...');
  const doc = await getDocumentById('d5caf7d3-92f1-4a74-ad8d-30b9203980a4');

  if (!doc) {
    console.log('Document not found');
    return;
  }

  const extractedText = doc.extractedText || doc.processingResults?.extractedText;
  console.log('Text length:', extractedText.length);

  const chunker = getSemanticChunker();

  // Try to debug where the mismatch happens
  console.log('\nAttempting semantic chunking...');
  console.log('Text preview:', extractedText.substring(0, 200));

  try {
    const result = await chunker.chunkText(extractedText, {
      breakpointPercentileThreshold: 95,
      bufferSize: 1,
      embeddingBatchSize: 16, // Match the default
    });
    console.log('Success!');
    console.log('Method:', result.metadata.method);
    console.log('Chunks:', result.chunks.length);
  } catch (err) {
    console.error('Error:', err.message);

    // Try with smaller batch size
    console.log('\nRetrying with smaller batch size...');
    try {
      const result = await chunker.chunkText(extractedText, {
        breakpointPercentileThreshold: 95,
        bufferSize: 1,
        embeddingBatchSize: 4, // Smaller batch
      });
      console.log('Success with smaller batch!');
      console.log('Method:', result.metadata.method);
      console.log('Chunks:', result.chunks.length);
    } catch (err2) {
      console.error('Still failed:', err2.message);
    }
  }
}

test().catch(err => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
});
