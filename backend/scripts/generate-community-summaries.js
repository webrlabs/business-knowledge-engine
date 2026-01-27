/**
 * Generate Community Summaries (F6.1.1 - Map Phase)
 *
 * This script runs the "Map Phase" of GraphRAG by:
 * 1. Detecting communities in the knowledge graph
 * 2. Generating LLM summaries for each community
 * 3. Persisting these summaries for global query support
 *
 * Usage: node scripts/generate-community-summaries.js [--force] [--incremental]
 */

require('dotenv').config();
const { getCommunitySummaryService } = require('../src/services/community-summary-service');
const { log } = require('../src/utils/logger');
const { getGraphService } = require('../src/services/graph-service');

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const incremental = args.includes('--incremental');

  console.log('Starting Community Summary Generation (GraphRAG Map Phase)...');
  console.log(`Mode: ${incremental ? 'Incremental' : 'Full Generation'}`);
  console.log(`Force Refresh: ${force}`);

  try {
    const summaryService = getCommunitySummaryService();
    let result;

    if (incremental) {
      // Incremental update (F3.1.4)
      console.log('Running incremental update...');
      result = await summaryService.updateSummariesIncremental({
        forceIncremental: force
      });
    } else {
      // Full generation (F6.1.1)
      console.log('Running full summary generation...');
      result = await summaryService.generateAllSummaries({
        forceRefresh: force
      });
    }

    console.log('\n=== Generation Complete ===');
    console.log(`Total Communities: ${result.metadata?.totalCommunities || result.metadata?.communityCount || 0}`);
    console.log(`Summarized: ${result.metadata?.summarizedCount || 0}`);
    console.log(`Execution Time: ${result.metadata?.executionTimeMs}ms`);

    if (result.metadata?.persistence) {
      console.log('\nPersistence Stats:');
      console.log(`Run ID: ${result.metadata.persistence.runId}`);
      console.log(`Stored Summaries: ${result.metadata.persistence.storedSummaries}`);
    }

    // Close connections
    const graphService = getGraphService();
    await graphService.close();

    process.exit(0);
  } catch (error) {
    console.error('\nERROR: Failed to generate community summaries');
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
