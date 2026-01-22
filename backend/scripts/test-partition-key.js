/**
 * Test different partition key property names
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { createGremlinClient, closeGremlinClient } = require('../src/clients');

async function testPartitionKey(pkName) {
  const client = await createGremlinClient();
  const id = uuidv4();

  const query = `g.addV('TestType').property('id', '${id}').property('${pkName}', 'TestValue').property('name', 'Test')`;
  console.log(`Testing partition key: ${pkName}`);
  console.log(`Query: ${query.substring(0, 80)}...`);

  try {
    const result = await client.submit(query);
    console.log(`SUCCESS with partition key: ${pkName}`);
    console.log(`Result: ${JSON.stringify(result._items)}`);

    // Clean up - delete the test vertex
    await client.submit(`g.V('${id}').drop()`);

    return true;
  } catch (e) {
    console.log(`FAILED with partition key: ${pkName} - ${e.message.substring(0, 80)}`);
    return false;
  }
}

async function main() {
  const partitionKeyNames = ['pk', 'partitionKey', '/pk', 'category', 'type', 'label'];

  for (const pkName of partitionKeyNames) {
    console.log('---');
    const success = await testPartitionKey(pkName);
    if (success) {
      console.log(`\n*** Found working partition key: ${pkName} ***`);
      break;
    }
  }

  await closeGremlinClient();
}

main();
