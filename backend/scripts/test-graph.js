/**
 * Test script to verify graph data
 * Usage: node scripts/test-graph.js
 */

require('dotenv').config();

const { getGraphService } = require('../src/services/graph-service');

async function testGraph() {
  console.log('Testing graph service...\n');

  const graphService = getGraphService();

  try {
    // Get stats
    console.log('=== Graph Statistics ===');
    const stats = await graphService.getStats();
    console.log(JSON.stringify(stats, null, 2));

    // Get entities
    console.log('\n=== Sample Entities (first 10) ===');
    const data = await graphService.getAllEntities(10);
    console.log('Nodes:', data.nodes.length);
    console.log('Edges:', data.edges.length);

    if (data.nodes.length > 0) {
      console.log('\nSample nodes:');
      data.nodes.slice(0, 5).forEach((node, i) => {
        console.log(`  ${i + 1}. ${node.label} (${node.type})`);
      });
    }

    if (data.edges.length > 0) {
      console.log('\nSample edges:');
      data.edges.slice(0, 5).forEach((edge, i) => {
        console.log(`  ${i + 1}. ${edge.source} --[${edge.label}]--> ${edge.target}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await graphService.close();
    process.exit(0);
  }
}

testGraph();
