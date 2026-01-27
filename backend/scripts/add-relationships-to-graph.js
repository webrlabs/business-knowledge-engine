require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById, upsertDocument } = require('../src/storage/cosmos');
const { getEntityExtractorService } = require('../src/services/entity-extractor');
const { getGraphService } = require('../src/services/graph-service');

async function addRelationships() {
  console.log('=== ADDING RELATIONSHIPS TO GRAPH ===\n');

  // Get the document
  const doc = await getDocumentById('6d4bc199-f0f7-42c7-9737-4eff2d4b3fbf');
  if (!doc) {
    console.log('Document not found');
    return;
  }

  console.log('Document:', doc.originalName);
  console.log('Existing entities:', doc.entities?.length || 0);
  console.log('Existing relationships:', doc.relationships?.length || 0);

  // Extract relationships
  const text = doc.processingResults?.extractedText || '';
  const entities = doc.entities || [];

  console.log('\nExtracting relationships...');
  const extractor = getEntityExtractorService();
  const relationships = await extractor.extractRelationships(text, entities, {
    title: doc.originalName
  });

  console.log('Relationships extracted:', relationships.length);

  // Add relationships to graph
  console.log('\n--- Adding to Graph ---');
  const graphService = getGraphService();

  let added = 0;
  let errors = 0;

  for (const rel of relationships) {
    try {
      await graphService.addEdge({
        from: rel.from,
        to: rel.to,
        type: rel.type,
        confidence: rel.confidence,
        evidence: rel.evidence,
        sourceDocumentId: doc.id
      });
      console.log(`  Added: ${rel.from} --[${rel.type}]--> ${rel.to}`);
      added++;
    } catch (err) {
      console.log(`  Error adding ${rel.from} -> ${rel.to}: ${err.message}`);
      errors++;
    }
  }

  console.log('\n--- Results ---');
  console.log('Edges added:', added);
  console.log('Errors:', errors);

  // Update document with relationships
  console.log('\nUpdating document in Cosmos DB...');
  doc.relationships = relationships.map((r, index) => ({
    id: `${doc.id}_rel_${index}`,
    source: r.from,
    target: r.to,
    from: r.from,
    to: r.to,
    type: r.type,
    confidence: r.confidence,
    evidence: r.evidence,
    sourceDocumentId: doc.id
  }));

  await upsertDocument(doc);
  console.log('Document updated with', doc.relationships.length, 'relationships');

  // Verify graph state
  console.log('\n--- Verifying Graph State ---');
  const { nodes, edges } = await graphService.getAllEntities(10000);
  console.log('Vertices:', nodes.length);
  console.log('Edges:', edges.length);

  if (edges.length > 0) {
    console.log('\nSample edges:');
    for (const edge of edges.slice(0, 5)) {
      console.log(`  ${edge.sourceName || edge.source} --[${edge.label}]--> ${edge.targetName || edge.target}`);
    }
  }
}

addRelationships().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
