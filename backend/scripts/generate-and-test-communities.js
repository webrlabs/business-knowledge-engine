require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { detectCommunities } = require('../src/algorithms/louvain');
const { getCommunitySummaryService } = require('../src/services/community-summary-service');

async function run() {
  console.log('=== COMMUNITY DETECTION & SUMMARY GENERATION ===\n');

  // Step 1: Detect communities
  console.log('Step 1: Detecting communities with Louvain algorithm...');
  const detection = await detectCommunities({ resolution: 1.0 });

  console.log('\n--- DETECTION RESULTS ---');
  console.log('Total nodes:', detection.metadata.nodeCount);
  console.log('Total edges:', detection.metadata.edgeCount);
  console.log('Communities found:', detection.metadata.communityCount);
  console.log('Modularity score:', detection.modularity.toFixed(4));
  console.log('Hierarchy levels:', detection.metadata.hierarchyLevels);

  console.log('\n--- COMMUNITY STRUCTURE ---');
  for (const community of detection.communityList) {
    console.log('\nCommunity', community.id, '(' + community.size + ' members):');
    console.log('  Dominant type:', community.dominantType);
    console.log('  Type distribution:', JSON.stringify(community.typeCounts));
    console.log('  Members:', community.members.map(m => m.name).join(', '));
  }

  // Step 2: Generate summaries
  console.log('\n\nStep 2: Generating LLM summaries for communities...');
  const summaryService = getCommunitySummaryService();
  const summaryResult = await summaryService.generateAllSummaries({
    forceRefresh: true,
    minCommunitySize: 2
  });

  console.log('\n--- GENERATED SUMMARIES ---');
  for (const [id, summary] of Object.entries(summaryResult.summaries)) {
    console.log('\nCommunity', id + ':');
    console.log('  Title:', summary.title);
    console.log('  Summary:', summary.summary);
    console.log('  Key entities:', summary.keyEntities?.join(', '));
  }

  console.log('\n--- SUMMARY METADATA ---');
  console.log('Summarized:', summaryResult.metadata.summarizedCount);
  console.log('Skipped (too small):', summaryResult.metadata.skippedCount);
  console.log('Execution time:', summaryResult.metadata.executionTimeMs, 'ms');

  // Return data for next step
  return { detection, summaryResult };
}

run().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
