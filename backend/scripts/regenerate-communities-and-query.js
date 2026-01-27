require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { detectCommunities } = require('../src/algorithms/louvain');
const { getCommunitySummaryService } = require('../src/services/community-summary-service');

async function run() {
  console.log('=== REGENERATING COMMUNITIES WITH EDGES ===\n');

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
    console.log('  Members:');
    for (const m of community.members) {
      console.log(`    - ${m.name} (${m.type})`);
    }
  }

  // Step 2: Generate summaries
  console.log('\n\n========================================');
  console.log('Step 2: Generating LLM summaries for communities...');
  console.log('========================================');
  const summaryService = getCommunitySummaryService();
  const summaryResult = await summaryService.generateAllSummaries({
    forceRefresh: true,
    minCommunitySize: 2
  });

  console.log('\n--- GENERATED SUMMARIES ---');
  for (const [id, summary] of Object.entries(summaryResult.summaries)) {
    console.log('\n=== Community', id, '===');
    console.log('Title:', summary.title);
    console.log('Summary:', summary.summary);
    console.log('Key entities:', summary.keyEntities?.join(', '));
    console.log('Member count:', summary.memberCount);
    console.log('Relationship count:', summary.relationshipCount);
  }

  console.log('\n--- SUMMARY METADATA ---');
  console.log('Summarized:', summaryResult.metadata.summarizedCount);
  console.log('Skipped (too small):', summaryResult.metadata.skippedCount);
  console.log('Execution time:', summaryResult.metadata.executionTimeMs, 'ms');

  // Step 3: Test global query
  console.log('\n\n========================================');
  console.log('Step 3: Testing Global Query (Map-Reduce)...');
  console.log('========================================');

  const testQuery = "What is the role of Line Management in the DOE structure?";
  console.log('Query:', testQuery);
  console.log('\nExecuting map-reduce query over community summaries...');

  try {
    const result = await summaryService.globalQuery(testQuery, {
      maxCommunities: 10,
      maxPartials: 5
    });

    console.log('\n--- GLOBAL QUERY RESULT ---');
    console.log('Answer:', result.answer);
    console.log('\nSources used:');
    for (const source of result.sources || []) {
      console.log(`  - ${source.communityName} (relevance: ${source.relevanceScore?.toFixed(2)})`);
    }
    console.log('\nConfidence:', result.confidence?.toFixed(2));
    console.log('Communities analyzed:', result.metadata?.communitiesAnalyzed);
    console.log('Total time:', result.metadata?.totalTimeMs, 'ms');
  } catch (err) {
    console.log('Error in global query:', err.message);
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
