/**
 * Clear Gremlin Graph Database - Batched Approach
 *
 * Deletes vertices in small batches with delays to avoid rate limiting (429 errors).
 */

const Gremlin = require('gremlin');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = {
  endpoint: process.env.COSMOS_GREMLIN_ENDPOINT,
  primaryKey: process.env.COSMOS_GREMLIN_KEY,
  database: process.env.COSMOS_GREMLIN_DATABASE || 'knowledge-graph',
  collection: process.env.COSMOS_GREMLIN_GRAPH || 'entities',
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clearGraphBatched() {
  const authenticator = new Gremlin.driver.auth.PlainTextSaslAuthenticator(
    `/dbs/${config.database}/colls/${config.collection}`,
    config.primaryKey
  );

  const client = new Gremlin.driver.Client(config.endpoint, {
    authenticator,
    traversalsource: 'g',
    rejectUnauthorized: true,
    mimeType: 'application/vnd.gremlin-v2.0+json',
  });

  try {
    console.log('Connecting to Gremlin...');
    console.log(`Endpoint: ${config.endpoint}`);
    console.log(`Database: ${config.database}`);
    console.log(`Collection: ${config.collection}`);

    // Get initial counts
    const vertexCountResult = await client.submit('g.V().count()');
    const vertexCount = vertexCountResult.first();
    console.log(`\nFound ${vertexCount} vertices in graph`);

    if (vertexCount === 0) {
      console.log('Graph is already empty!');
      return;
    }

    const BATCH_SIZE = 5; // Small batch size to stay under RU limit
    const DELAY_MS = 2000; // 2 second delay between batches

    console.log(`\nDeleting vertices in batches of ${BATCH_SIZE} with ${DELAY_MS}ms delay...`);

    let deleted = 0;
    let retries = 0;
    const MAX_RETRIES = 10;

    while (deleted < vertexCount && retries < MAX_RETRIES) {
      try {
        // Get a small batch of vertex IDs
        const idsResult = await client.submit(`g.V().limit(${BATCH_SIZE}).id()`);
        const ids = idsResult.toArray();

        if (ids.length === 0) {
          console.log('No more vertices to delete.');
          break;
        }

        // Delete each vertex individually to minimize RU consumption
        for (const id of ids) {
          try {
            await client.submit('g.V(id).drop()', { id });
            deleted++;
            process.stdout.write(`\rDeleted ${deleted} vertices...`);
          } catch (err) {
            if (err.message && err.message.includes('429')) {
              console.log(`\nRate limited on vertex ${id}, waiting 5 seconds...`);
              await sleep(5000);
              // Retry the same vertex
              await client.submit('g.V(id).drop()', { id });
              deleted++;
              process.stdout.write(`\rDeleted ${deleted} vertices...`);
            } else {
              throw err;
            }
          }
          // Small delay between individual deletes
          await sleep(500);
        }

        // Delay between batches
        await sleep(DELAY_MS);
        retries = 0; // Reset retries on success

      } catch (err) {
        if (err.message && err.message.includes('429')) {
          retries++;
          const waitTime = Math.pow(2, retries) * 1000; // Exponential backoff
          console.log(`\nRate limited, waiting ${waitTime / 1000} seconds (retry ${retries}/${MAX_RETRIES})...`);
          await sleep(waitTime);
        } else {
          throw err;
        }
      }
    }

    console.log(`\n\nDeleted ${deleted} vertices total.`);

    // Verify final count
    const finalCountResult = await client.submit('g.V().count()');
    const finalCount = finalCountResult.first();
    console.log(`Remaining vertices: ${finalCount}`);

    if (finalCount > 0) {
      console.log('\nSome vertices remain. You may need to run this script again.');
    } else {
      console.log('\nGraph successfully cleared!');
    }

  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    await client.close();
  }
}

clearGraphBatched()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
