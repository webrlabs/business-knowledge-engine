require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');

async function testProcessing() {
  console.log('Getting document from Cosmos...');

  // Get the document
  const doc = await getDocumentById('57529749-d36e-46b7-9a0e-67376ca1e202');

  if (!doc) {
    console.log('Document not found');
    return;
  }

  console.log('Document found:', doc.originalName);
  console.log('Status:', doc.status);
  console.log('\nProcessing metadata:', JSON.stringify(doc.processingResults?.metadata, null, 2));

  // Check if there's chunk data
  console.log('\n--- Checking extracted content ---');
  const extractedText = doc.extractedText || doc.processingResults?.extractedText;
  console.log('Extracted text length:', extractedText ? extractedText.length : 0);

  // Check entities array
  console.log('\n--- Entities in document ---');
  console.log('Entities count:', doc.entities?.length || 0);
  if (doc.entities && doc.entities.length > 0) {
    console.log('First 3 entities:', JSON.stringify(doc.entities.slice(0, 3), null, 2));
  }

  // Check relationships
  console.log('\nRelationships count:', doc.relationships?.length || 0);
}

testProcessing().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
