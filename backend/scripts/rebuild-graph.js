/**
 * Rebuild graph from processed documents
 * Usage: node scripts/rebuild-graph.js
 */

require('dotenv').config();

const { CosmosClient } = require('@azure/cosmos');
const { getGraphService } = require('../src/services/graph-service');

const endpoint = process.env.COSMOS_DB_ENDPOINT;
const key = process.env.COSMOS_DB_KEY;
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const containerId = process.env.COSMOS_DB_DOCUMENTS_CONTAINER || 'documents';

async function getDocuments() {
  const client = new CosmosClient({ endpoint, key });
  const container = client.database(databaseId).container(containerId);
  const query = "SELECT * FROM c WHERE c.status = 'completed'";
  const { resources } = await container.items.query(query).fetchAll();
  return resources;
}

async function rebuildGraph() {
  console.log('Rebuilding graph from processed documents...\n');

  const graphService = getGraphService();
  const documents = await getDocuments();

  console.log(`Found ${documents.length} completed documents\n`);

  let totalEntities = 0;
  let totalRelationships = 0;
  let addedEntities = 0;
  let addedRelationships = 0;
  let failedEntities = 0;
  let failedRelationships = 0;

  for (const doc of documents) {
    console.log(`Processing: ${doc.title}`);

    const entities = doc.entities || [];
    const relationships = doc.relationships || [];

    console.log(`  Entities: ${entities.length}, Relationships: ${relationships.length}`);

    totalEntities += entities.length;
    totalRelationships += relationships.length;

    // Add entities
    for (const entity of entities) {
      try {
        // Ensure entity has required fields
        const entityToAdd = {
          ...entity,
          type: entity.type || 'Unknown',
          sourceDocumentId: doc.id,
        };

        await graphService.addVertex(entityToAdd);
        addedEntities++;
      } catch (error) {
        if (!error.message.includes('already exists')) {
          failedEntities++;
          if (failedEntities <= 5) {
            console.log(`    Failed to add entity "${entity.name}": ${error.message.substring(0, 100)}`);
          }
        } else {
          addedEntities++; // Count as added if it already exists
        }
      }
    }

    // Add relationships
    for (const rel of relationships) {
      try {
        const relToAdd = {
          ...rel,
          type: rel.type || 'RELATED_TO',
          sourceDocumentId: doc.id,
        };

        await graphService.addEdge(relToAdd);
        addedRelationships++;
      } catch (error) {
        if (!error.message.includes('already exists')) {
          failedRelationships++;
          if (failedRelationships <= 5) {
            console.log(`    Failed to add relationship: ${error.message.substring(0, 100)}`);
          }
        } else {
          addedRelationships++;
        }
      }
    }

    console.log(`  Added: ${addedEntities}/${totalEntities} entities, ${addedRelationships}/${totalRelationships} relationships`);
  }

  console.log('\n=== Summary ===');
  console.log(`Total entities: ${totalEntities}`);
  console.log(`Added entities: ${addedEntities}`);
  console.log(`Failed entities: ${failedEntities}`);
  console.log(`Total relationships: ${totalRelationships}`);
  console.log(`Added relationships: ${addedRelationships}`);
  console.log(`Failed relationships: ${failedRelationships}`);

  // Get final stats
  console.log('\n=== Final Graph Stats ===');
  const stats = await graphService.getStats();
  console.log(JSON.stringify(stats, null, 2));

  await graphService.close();
  process.exit(0);
}

rebuildGraph().catch(console.error);
