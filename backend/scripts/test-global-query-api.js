require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCommunitySummaryService } = require('../src/services/community-summary-service');

async function testGlobalQuery() {
  console.log('=== TESTING GLOBAL QUERY API ===\n');

  const summaryService = getCommunitySummaryService();

  const queries = [
    "What is Line Management at the Department of Energy?",
    "Who oversees the DOE National Laboratories?",
    "What is the chain of command from Secretary to site managers?"
  ];

  for (const query of queries) {
    console.log('─'.repeat(70));
    console.log('QUERY:', query);
    console.log('─'.repeat(70));

    try {
      const result = await summaryService.globalQuery(query, {
        maxCommunities: 6,
        maxPartials: 5
      });

      console.log('\nANSWER:');
      console.log(typeof result.answer === 'string' ? result.answer : JSON.stringify(result.answer, null, 2));

      console.log('\nSOURCES:');
      for (const source of result.sources || []) {
        console.log(`  • ${source.communityName} (relevance: ${(source.relevanceScore * 100).toFixed(0)}%)`);
      }

      console.log('\nMETADATA:');
      console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`  Communities analyzed: ${result.metadata?.communitiesAnalyzed}`);
      console.log(`  Response time: ${result.metadata?.totalTimeMs}ms`);

    } catch (err) {
      console.log('Error:', err.message);
    }

    console.log('\n');
  }
}

testGlobalQuery().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
});
