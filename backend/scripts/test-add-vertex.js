/**
 * Test adding a vertex to the graph
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { createGremlinClient, closeGremlinClient } = require('../src/clients');

async function test() {
  const entity = {
    name: 'Test Entity',
    type: 'Unknown',
    description: 'Test description'
  };

  const id = uuidv4();
  const entityType = entity.type || 'Unknown';

  const query = `g.addV(label).property('id', id).property('pk', category).property('name', name)`;
  const bindings = {
    label: entityType,
    id: id,
    category: entityType,
    name: entity.name,
  };

  console.log('Query:', query);
  console.log('Bindings:', JSON.stringify(bindings, null, 2));

  const client = await createGremlinClient();

  try {
    const result = await client.submit(query, bindings);
    console.log('Success:', result._items);
  } catch (e) {
    console.log('Error:', e.message);

    // Try with hardcoded values
    console.log('\nTrying with hardcoded values...');
    const hardcodedQuery = `g.addV('TestType').property('id', '${id}').property('pk', 'TestType').property('name', 'Test')`;
    console.log('Hardcoded query:', hardcodedQuery);

    try {
      const result2 = await client.submit(hardcodedQuery);
      console.log('Hardcoded Success:', result2._items);
    } catch (e2) {
      console.log('Hardcoded Error:', e2.message);
    }
  }

  await closeGremlinClient();
}

test();
