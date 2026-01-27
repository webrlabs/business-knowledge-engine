require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');

async function check() {
  const doc = await getDocumentById('6d4bc199-f0f7-42c7-9737-4eff2d4b3fbf');
  if (!doc) return console.log('Not found');

  const m = doc.processingResults?.metadata || {};
  console.log('=== FEATURE INTEGRATION VERIFICATION ===');
  console.log('');
  console.log('SEMANTIC CHUNKING (F4.1.x):');
  console.log('  Chunks created:', m.chunksCreated);
  console.log('  Chunks indexed:', m.chunksIndexed);
  console.log('');
  console.log('ENTITY EXTRACTION (F4.3.x):');
  console.log('  Entities extracted:', m.entitiesExtracted);
  console.log('  Entities resolved:', m.entitiesResolved);
  console.log('  Entities merged:', m.entitiesMerged);
  console.log('  Entities linked:', m.entitiesLinked);
  console.log('');
  console.log('RELATIONSHIP VALIDATION (F4.3.1):');
  const vs = m.validationSummary || {};
  console.log('  Total entities:', vs.totalEntities);
  console.log('  Entities with warnings:', vs.entitiesWithWarnings);
  console.log('  Domain violations:', vs.domainViolations);
  console.log('  Range violations:', vs.rangeViolations);
  console.log('  Overall valid:', vs.overallValid);
  console.log('');
  console.log('MENTION TRACKING (F3.2.3):');
  console.log('  Unique entities mentioned:', m.uniqueEntitiesMentioned);
  console.log('  Total mentions:', m.totalEntityMentions);
  console.log('');
  console.log('CROSS-DOCUMENT LINKS:');
  console.log('  Links discovered:', m.crossDocumentLinks);
  console.log('');
  console.log('Processing time:', m.processingTimeMs, 'ms');
}
check();
