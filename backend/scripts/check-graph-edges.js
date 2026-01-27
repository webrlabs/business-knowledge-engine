require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getDocumentById } = require('../src/storage/cosmos');
const { getGraphService } = require('../src/services/graph-service');

async function check() {
  console.log('=== CHECKING GRAPH EDGES ===\n');

  // Check document relationships
  const doc = await getDocumentById('6d4bc199-f0f7-42c7-9737-4eff2d4b3fbf');
  if (!doc) {
    console.log('Document not found');
    return;
  }

  console.log('Document:', doc.originalName);
  console.log('Entities in doc:', doc.entities?.length || 0);
  console.log('Relationships in doc:', doc.relationships?.length || 0);

  if (doc.relationships && doc.relationships.length > 0) {
    console.log('\nSample relationships from document:');
    for (const rel of doc.relationships.slice(0, 10)) {
      console.log(`  ${rel.source} --[${rel.type}]--> ${rel.target}`);
    }
  }

  // Check graph edges
  console.log('\n--- GRAPH STATE ---');
  const graphService = getGraphService();
  const { nodes, edges } = await graphService.getAllEntities(10000);

  console.log('Vertices in graph:', nodes.length);
  console.log('Edges in graph:', edges.length);

  if (edges.length > 0) {
    console.log('\nSample edges from graph:');
    for (const edge of edges.slice(0, 10)) {
      console.log(`  ${edge.sourceName || edge.source} --[${edge.label}]--> ${edge.targetName || edge.target}`);
    }
  } else {
    console.log('\nNo edges found in graph!');
    console.log('Checking raw Gremlin edges...');

    // Check raw edges directly
    const client = await graphService._getClient();
    try {
      const rawEdges = await client.submit('g.E().limit(50).valueMap(true)');
      console.log('Raw edges from Gremlin:', rawEdges._items?.length || 0);
      if (rawEdges._items && rawEdges._items.length > 0) {
        console.log('Sample raw edges:', JSON.stringify(rawEdges._items.slice(0, 3), null, 2));
      }
    } catch (err) {
      console.log('Error querying edges:', err.message);
    }
  }
}

check().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
