require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');
const { initializeOntologyService } = require('../src/services/ontology-service');

async function checkEntityValidation() {
  console.log('=== ENTITY VALIDATION AGAINST ONTOLOGY ===');
  console.log('');

  // Get the document
  const doc = await getDocumentById('6d4bc199-f0f7-42c7-9737-4eff2d4b3fbf');
  if (!doc) {
    console.log('Document not found');
    return;
  }

  // Initialize ontology
  const ontology = await initializeOntologyService();

  console.log('Validating', doc.entities.length, 'entities against ontology...');
  console.log('');

  let validCount = 0;
  let invalidCount = 0;
  const typeStats = {};

  for (const entity of doc.entities) {
    const result = ontology.validateEntityType(entity.type);

    // Track type stats
    typeStats[entity.type] = typeStats[entity.type] || { valid: 0, invalid: 0 };

    if (result.valid) {
      validCount++;
      typeStats[entity.type].valid++;
    } else {
      invalidCount++;
      typeStats[entity.type].invalid++;
      console.log('  INVALID:', entity.name, '- type:', entity.type);
      console.log('    Errors:', result.errors);
    }
  }

  console.log('VALIDATION RESULTS:');
  console.log('  Valid entities:', validCount, '/', doc.entities.length);
  console.log('  Invalid entities:', invalidCount);
  console.log('');

  console.log('ENTITY TYPE BREAKDOWN:');
  for (const [type, stats] of Object.entries(typeStats)) {
    const status = stats.invalid > 0 ? '❌' : '✅';
    console.log(`  ${status} ${type}: ${stats.valid} valid, ${stats.invalid} invalid`);
  }
  console.log('');

  // Check if all entity types exist in ontology
  console.log('ONTOLOGY TYPE COVERAGE:');
  const allTypes = new Set(doc.entities.map(e => e.type));
  for (const type of allTypes) {
    const exists = ontology.entityTypes.has(type);
    const status = exists ? '✅' : '❌';
    console.log(`  ${status} "${type}" in ontology: ${exists}`);
  }
}

checkEntityValidation().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
