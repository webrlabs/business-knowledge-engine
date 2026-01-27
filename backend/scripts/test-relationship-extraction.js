require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');
const { getEntityExtractorService } = require('../src/services/entity-extractor');

async function test() {
  console.log('=== TESTING RELATIONSHIP EXTRACTION ===\n');

  // Get the document
  const doc = await getDocumentById('6d4bc199-f0f7-42c7-9737-4eff2d4b3fbf');
  if (!doc) {
    console.log('Document not found');
    return;
  }

  console.log('Document:', doc.originalName);
  console.log('Entities:', doc.entities?.length || 0);

  // Get sample text from the document
  const text = doc.processingResults?.extractedText || '';
  console.log('\nExtracted text length:', text.length);
  console.log('Sample text:', text.substring(0, 500) + '...');

  // Get entities
  const entities = doc.entities || [];
  console.log('\nEntities for relationship extraction:');
  for (const e of entities.slice(0, 10)) {
    console.log(`  - ${e.name} (${e.type})`);
  }

  // Test relationship extraction
  console.log('\n--- Testing Relationship Extraction ---');
  const extractor = getEntityExtractorService();

  console.log('Extracting relationships from text...');
  const relationships = await extractor.extractRelationships(text, entities, {
    title: doc.originalName
  });

  console.log('\n--- EXTRACTED RELATIONSHIPS ---');
  console.log('Total relationships found:', relationships.length);

  if (relationships.length > 0) {
    for (const rel of relationships) {
      console.log(`  ${rel.from} --[${rel.type}]--> ${rel.to}`);
      console.log(`    Confidence: ${rel.confidence}, Evidence: ${rel.evidence?.substring(0, 80)}...`);
    }
  } else {
    console.log('No relationships extracted!');
    console.log('\nPossible issues:');
    console.log('1. Text may not contain explicit relationships');
    console.log('2. LLM may not be finding connections between extracted entities');
    console.log('3. Entity names may not match between extraction and text');

    // Try manual extraction with verbose logging
    console.log('\n--- Attempting manual verbose extraction ---');
    const { getOpenAIService } = require('../src/services/openai-service');
    const {
      RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT,
      buildRelationshipExtractionPrompt,
    } = require('../src/prompts/entity-extraction');

    const openai = getOpenAIService();
    const userPrompt = buildRelationshipExtractionPrompt(text.substring(0, 4000), entities.slice(0, 15));

    console.log('\nPrompt (first 500 chars):');
    console.log(userPrompt.substring(0, 500) + '...');

    try {
      const response = await openai.getJsonCompletion([
        { role: 'system', content: RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ]);

      console.log('\nRaw LLM response:');
      console.log(JSON.stringify(response.content, null, 2));
    } catch (err) {
      console.log('Error calling LLM:', err.message);
    }
  }
}

test().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
