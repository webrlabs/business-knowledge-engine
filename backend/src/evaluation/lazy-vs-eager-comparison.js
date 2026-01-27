/**
 * Lazy vs Eager GraphRAG Comparison Service
 *
 * Compares latency and quality between Eager (pre-computed) and Lazy (on-demand) GraphRAG strategies.
 *
 * Feature: F6.2.4 - Lazy vs Eager Comparison
 *
 * Methods:
 * - compareStrategies: Full comparison with latency and quality metrics
 * - runComparisonBenchmark: Run comparison against a test dataset file
 * - formatComparisonReport: Generate human-readable text report
 * - formatComparisonReportMarkdown: Generate markdown report
 * - formatComparisonReportJSON: Generate JSON report with all details
 */

const fs = require('fs');
const path = require('path');
const { getGraphRAGService } = require('../services/graph-rag-service');
const { evaluateBatch } = require('./llm-judge');
const { log } = require('../utils/logger');

// Default configuration
const DEFAULT_CONFIG = {
  iterations: 1, // Number of times to run each query for stable latency
  warmup: false, // Whether to run a warmup query
  judgeCriteria: ['helpfulness', 'accuracy', 'completeness'],
  concurrency: 1, // Number of queries to process in parallel (sequential by default)
  includeDetailedMetrics: true, // Include per-query breakdown in results
  cacheMetrics: true, // Track cache hit/miss rates for lazy mode
};

/**
 * Compare GraphRAG strategies for a given set of queries.
 *
 * @param {Object[]} testQueries - Array of test queries
 *   Each query: { question: string, expectedAnswer: string (optional), ... }
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Comparison results with metrics for each strategy
 */
async function compareStrategies(testQueries, options = {}) {
  const startTime = Date.now();
  const config = { ...DEFAULT_CONFIG, ...options };
  
  const graphRagService = getGraphRAGService();

  log.info('Starting Lazy vs Eager GraphRAG comparison', {
    queryCount: testQueries.length,
    config,
  });

  const eagerResults = [];
  const lazyResults = [];
  const comparisonResults = [];

  for (let i = 0; i < testQueries.length; i++) {
    const queryObj = testQueries[i];
    const queryText = queryObj.question || queryObj.query;
    
    log.info(`Processing query ${i + 1}/${testQueries.length}: "${queryText.substring(0, 50)}..."`);

    // --- Run Eager Mode ---
    const eagerStart = Date.now();
    let eagerResult;
    try {
      eagerResult = await graphRagService.generateAnswer(queryText, {
        lazySummaries: false,
        includeCommunityContext: true,
      });
    } catch (err) {
      log.error(`Eager mode failed for query: ${queryText}`, err);
      eagerResult = { answer: "Error", error: err.message, metadata: { processingTimeMs: 0 } };
    }
    const eagerTime = Date.now() - eagerStart;

    // --- Run Lazy Mode ---
    const lazyStart = Date.now();
    let lazyResult;
    try {
      lazyResult = await graphRagService.generateAnswer(queryText, {
        lazySummaries: true,
        includeCommunityContext: true,
      });
    } catch (err) {
      log.error(`Lazy mode failed for query: ${queryText}`, err);
      lazyResult = { answer: "Error", error: err.message, metadata: { processingTimeMs: 0 } };
    }
    const lazyTime = Date.now() - lazyStart;

    // --- Collect Metrics ---
    
    // Extract metadata
    const eagerMeta = eagerResult.metadata || {};
    const lazyMeta = lazyResult.metadata || {};

    // Calculate latency difference (negative means Lazy is faster)
    const latencyDiff = lazyTime - eagerTime;
    const latencyDiffPercent = eagerTime > 0 ? (latencyDiff / eagerTime) * 100 : 0;

    // Store raw results
    eagerResults.push({
      query: queryText,
      answer: eagerResult.answer,
      context: eagerResult.context,
      latency: eagerTime,
      processingTime: eagerMeta.processingTimeMs || eagerTime,
      communityCount: eagerMeta.communityCount || 0,
      chunkCount: eagerMeta.chunkCount || 0,
      contextLength: eagerResult.context ? eagerResult.context.length : 0,
    });

    lazyResults.push({
      query: queryText,
      answer: lazyResult.answer,
      context: lazyResult.context,
      latency: lazyTime,
      processingTime: lazyMeta.processingTimeMs || lazyTime,
      communityCount: lazyMeta.communityCount || 0,
      chunkCount: lazyMeta.chunkCount || 0,
      contextLength: lazyResult.context ? lazyResult.context.length : 0,
    });

    comparisonResults.push({
      query: queryText,
      eager: eagerResults[eagerResults.length - 1],
      lazy: lazyResults[lazyResults.length - 1],
      latencyDiff,
      latencyDiffPercent,
    });
  }

  // --- Evaluate Quality (LLM-as-Judge) ---
  // We evaluate both sets of answers if expected answers are provided, 
  // or we can just compare them against each other if needed. 
  // For now, let's assume we want to score them independently.

  log.info('Evaluating answer quality...');
  
  const eagerEvalItems = testQueries.map((q, i) => ({
    question: q.question || q.query,
    answer: eagerResults[i].answer,
    context: eagerResults[i].context, // Context isn't stored in eagerResults above, let's just pass null or fix it if needed by judge
    // The evaluateBatch function usually takes { question, answer, context, expectedAnswer }
    expectedAnswer: q.expectedAnswer,
  }));

  const lazyEvalItems = testQueries.map((q, i) => ({
    question: q.question || q.query,
    answer: lazyResults[i].answer,
    context: lazyResults[i].context,
    expectedAnswer: q.expectedAnswer,
  }));

  // Parallel evaluation
  const [eagerQuality, lazyQuality] = await Promise.all([
    evaluateBatch(eagerEvalItems, config.judgeCriteria),
    evaluateBatch(lazyEvalItems, config.judgeCriteria),
  ]);

  // Attach scores to results
  for (let i = 0; i < comparisonResults.length; i++) {
    comparisonResults[i].eager.quality = eagerQuality.evaluations[i]?.overallScore || 0;
    comparisonResults[i].lazy.quality = lazyQuality.evaluations[i]?.overallScore || 0;
    
    // Store detailed breakdown
    comparisonResults[i].eager.qualityDetails = eagerQuality.evaluations[i]?.dimensions;
    comparisonResults[i].lazy.qualityDetails = lazyQuality.evaluations[i]?.dimensions;
  }

  // --- Aggregate Metrics ---
  const aggregate = calculateAggregateMetrics(comparisonResults);

  const totalTime = Date.now() - startTime;
  log.info('Comparison completed', { totalTimeMs: totalTime });

  return {
    config,
    summary: aggregate,
    details: comparisonResults,
    totalTimeMs: totalTime,
  };
}

/**
 * Calculate aggregate metrics from detailed results.
 */
function calculateAggregateMetrics(results) {
  if (results.length === 0) return {};

  const sum = (arr, key) => arr.reduce((acc, curr) => acc + (curr[key] || 0), 0);
  const avg = (arr, key) => sum(arr, key) / arr.length;
  
  // Helper to get nested property
  const getNested = (obj, path) => path.split('.').reduce((o, i) => o ? o[i] : 0, obj);
  const sumNested = (arr, path) => arr.reduce((acc, curr) => acc + getNested(curr, path), 0);
  const avgNested = (arr, path) => sumNested(arr, path) / arr.length;

  const eagerLatencyAvg = avgNested(results, 'eager.latency');
  const lazyLatencyAvg = avgNested(results, 'lazy.latency');
  
  const eagerQualityAvg = avgNested(results, 'eager.quality');
  const lazyQualityAvg = avgNested(results, 'lazy.quality');

  const eagerCommunityAvg = avgNested(results, 'eager.communityCount');
  const lazyCommunityAvg = avgNested(results, 'lazy.communityCount');

  // Win counts
  let latencyWins = { eager: 0, lazy: 0, tie: 0 };
  let qualityWins = { eager: 0, lazy: 0, tie: 0 };

  results.forEach(r => {
    // Latency wins (lower is better)
    if (r.eager.latency < r.lazy.latency) latencyWins.eager++;
    else if (r.lazy.latency < r.eager.latency) latencyWins.lazy++;
    else latencyWins.tie++;

    // Quality wins (higher is better)
    if (r.eager.quality > r.lazy.quality) qualityWins.eager++;
    else if (r.lazy.quality > r.eager.quality) qualityWins.lazy++;
    else qualityWins.tie++;
  });

  return {
    queryCount: results.length,
    latency: {
      eagerAvg: Math.round(eagerLatencyAvg),
      lazyAvg: Math.round(lazyLatencyAvg),
      diff: Math.round(lazyLatencyAvg - eagerLatencyAvg),
      diffPercent: ((lazyLatencyAvg - eagerLatencyAvg) / eagerLatencyAvg) * 100,
      winner: eagerLatencyAvg < lazyLatencyAvg ? 'Eager' : 'Lazy',
    },
    quality: {
      eagerAvg: Number(eagerQualityAvg.toFixed(2)),
      lazyAvg: Number(lazyQualityAvg.toFixed(2)),
      diff: Number((lazyQualityAvg - eagerQualityAvg).toFixed(2)),
      winner: eagerQualityAvg > lazyQualityAvg ? 'Eager' : (lazyQualityAvg > eagerQualityAvg ? 'Lazy' : 'Tie'),
    },
    communities: {
      eagerAvg: Number(eagerCommunityAvg.toFixed(1)),
      lazyAvg: Number(lazyCommunityAvg.toFixed(1)),
    },
    wins: {
      latency: latencyWins,
      quality: qualityWins,
    }
  };
}

/**
 * Format comparison results as a human-readable report.
 */
function formatComparisonReport(results) {
  const { summary } = results;
  
  return `
═══════════════════════════════════════════════════════════════════
           LAZY VS EAGER GRAPHRAG COMPARISON REPORT
═══════════════════════════════════════════════════════════════════

📊 OVERVIEW
───────────────────────────────────────────────────────────────────
Queries Tested:     ${summary.queryCount}
Total Duration:     ${results.totalTimeMs} ms

⏱️ LATENCY (Lower is better)
───────────────────────────────────────────────────────────────────
Eager Average:      ${summary.latency.eagerAvg} ms
Lazy Average:       ${summary.latency.lazyAvg} ms
Difference:         ${summary.latency.diff > 0 ? '+' : ''}${summary.latency.diff} ms (${summary.latency.diffPercent.toFixed(1)}%)
Winner:             ${summary.latency.winner.toUpperCase()}
Win Count:          Eager: ${summary.wins.latency.eager}, Lazy: ${summary.wins.latency.lazy}, Tie: ${summary.wins.latency.tie}

⭐ QUALITY (Higher is better, Scale 1-5)
───────────────────────────────────────────────────────────────────
Eager Average:      ${summary.quality.eagerAvg}
Lazy Average:       ${summary.quality.lazyAvg}
Difference:         ${summary.quality.diff > 0 ? '+' : ''}${summary.quality.diff}
Winner:             ${summary.quality.winner.toUpperCase()}
Win Count:          Eager: ${summary.wins.quality.eager}, Lazy: ${summary.wins.quality.lazy}, Tie: ${summary.wins.quality.tie}

🔍 CONTEXT INSIGHTS
───────────────────────────────────────────────────────────────────
Avg Communities (Eager): ${summary.communities.eagerAvg}
Avg Communities (Lazy):  ${summary.communities.lazyAvg}

═══════════════════════════════════════════════════════════════════
`;
}

/**
 * Run comparison benchmark against a dataset file.
 *
 * @param {string} datasetPath - Path to the benchmark dataset JSON
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Benchmark results
 */
async function runComparisonBenchmark(datasetPath, options = {}) {
  log.info('Loading lazy vs eager comparison dataset', { path: datasetPath });

  let dataset;
  try {
    const absolutePath = path.isAbsolute(datasetPath)
      ? datasetPath
      : path.join(process.cwd(), datasetPath);

    const content = fs.readFileSync(absolutePath, 'utf-8');
    dataset = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to load dataset: ${err.message}`);
  }

  if (!dataset.queries || dataset.queries.length === 0) {
    throw new Error('Dataset must contain a "queries" array');
  }

  const testQueries = dataset.queries.map(q => ({
    question: q.question || q.query,
    expectedAnswer: q.expectedAnswer,
    category: q.category,
    difficulty: q.difficulty,
  }));

  const results = await compareStrategies(testQueries, options);

  // Attach dataset metadata to results
  results.dataset = {
    name: dataset.metadata?.name || path.basename(datasetPath),
    version: dataset.metadata?.version,
    queryCount: dataset.queries.length,
    categories: [...new Set(testQueries.map(q => q.category).filter(Boolean))],
  };

  return results;
}

/**
 * Format comparison results as markdown report.
 *
 * @param {Object} results - Comparison results from compareStrategies
 * @returns {string} Markdown formatted report
 */
function formatComparisonReportMarkdown(results) {
  const { summary, details } = results;

  const lines = [
    '# Lazy vs Eager GraphRAG Comparison Report',
    '',
    '## Overview',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Queries Tested | ${summary.queryCount} |`,
    `| Total Duration | ${results.totalTimeMs} ms |`,
    `| Test Date | ${new Date().toISOString()} |`,
    '',
    '## Latency Comparison',
    '',
    '> Lower latency is better',
    '',
    `| Strategy | Avg Latency | Win Count |`,
    `|----------|-------------|-----------|`,
    `| Eager | ${summary.latency.eagerAvg} ms | ${summary.wins.latency.eager} |`,
    `| Lazy | ${summary.latency.lazyAvg} ms | ${summary.wins.latency.lazy} |`,
    `| Tie | - | ${summary.wins.latency.tie} |`,
    '',
    `**Winner:** ${summary.latency.winner} (${summary.latency.diff > 0 ? '+' : ''}${summary.latency.diff} ms, ${summary.latency.diffPercent.toFixed(1)}%)`,
    '',
    '## Quality Comparison',
    '',
    '> Higher quality score is better (Scale: 1-5)',
    '',
    `| Strategy | Avg Quality | Win Count |`,
    `|----------|-------------|-----------|`,
    `| Eager | ${summary.quality.eagerAvg} | ${summary.wins.quality.eager} |`,
    `| Lazy | ${summary.quality.lazyAvg} | ${summary.wins.quality.lazy} |`,
    `| Tie | - | ${summary.wins.quality.tie} |`,
    '',
    `**Winner:** ${summary.quality.winner} (${summary.quality.diff > 0 ? '+' : ''}${summary.quality.diff})`,
    '',
    '## Community Context',
    '',
    `| Strategy | Avg Communities Used |`,
    `|----------|---------------------|`,
    `| Eager | ${summary.communities.eagerAvg} |`,
    `| Lazy | ${summary.communities.lazyAvg} |`,
    '',
  ];

  // Add per-query details if available
  if (details && details.length > 0) {
    lines.push('## Per-Query Details');
    lines.push('');
    lines.push('| Query | Eager Latency | Lazy Latency | Eager Quality | Lazy Quality | Latency Winner |');
    lines.push('|-------|---------------|--------------|---------------|--------------|----------------|');

    for (const d of details) {
      const queryShort = d.query.length > 40 ? d.query.substring(0, 40) + '...' : d.query;
      const latencyWinner = d.eager.latency < d.lazy.latency ? 'Eager' : (d.lazy.latency < d.eager.latency ? 'Lazy' : 'Tie');
      lines.push(`| ${queryShort} | ${d.eager.latency}ms | ${d.lazy.latency}ms | ${d.eager.quality?.toFixed(2) || 'N/A'} | ${d.lazy.quality?.toFixed(2) || 'N/A'} | ${latencyWinner} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by Lazy vs Eager GraphRAG Comparison (F6.2.4)*');

  return lines.join('\n');
}

/**
 * Format comparison results as JSON.
 *
 * @param {Object} results - Comparison results
 * @returns {string} JSON formatted string
 */
function formatComparisonReportJSON(results) {
  return JSON.stringify({
    metadata: {
      generatedAt: new Date().toISOString(),
      feature: 'F6.2.4',
      totalTimeMs: results.totalTimeMs,
    },
    dataset: results.dataset,
    config: results.config,
    summary: results.summary,
    details: results.details,
  }, null, 2);
}

/**
 * Create a sample comparison dataset for testing.
 *
 * @returns {Object} Sample dataset
 */
function createSampleComparisonDataset() {
  return {
    metadata: {
      name: 'lazy-vs-eager-sample',
      version: '1.0.0',
      description: 'Sample dataset for Lazy vs Eager GraphRAG comparison',
      created: new Date().toISOString(),
    },
    queries: [
      {
        question: 'What is the purchase order approval process?',
        expectedAnswer: 'The purchase order approval process involves multiple stages...',
        category: 'process',
        difficulty: 'easy',
      },
      {
        question: 'Who are the key stakeholders in the finance department?',
        expectedAnswer: 'Key stakeholders include the CFO, Finance Manager, and Accounts Payable team.',
        category: 'organization',
        difficulty: 'medium',
      },
      {
        question: 'How do the ERP and CRM systems integrate?',
        expectedAnswer: 'ERP and CRM systems integrate through APIs for customer and order data sync.',
        category: 'technical',
        difficulty: 'hard',
      },
      {
        question: 'What compliance requirements apply to vendor onboarding?',
        expectedAnswer: 'Vendor onboarding must comply with SOX, GDPR data requirements, and internal audit policies.',
        category: 'compliance',
        difficulty: 'medium',
      },
      {
        question: 'Summarize the quarterly revenue trends across all business units.',
        expectedAnswer: 'Quarterly revenue shows growth in core products with seasonal variations.',
        category: 'leadership',
        difficulty: 'hard',
      },
    ],
  };
}

/**
 * Calculate recommendation based on comparison results.
 *
 * @param {Object} summary - Aggregate summary from comparison
 * @returns {Object} Recommendation with reasoning
 */
function getRecommendation(summary) {
  // Scoring: prioritize quality, then latency
  const qualityWeight = 0.6;
  const latencyWeight = 0.4;

  let eagerScore = 0;
  let lazyScore = 0;

  // Quality scoring (higher is better)
  if (summary.quality.eagerAvg > summary.quality.lazyAvg) {
    eagerScore += qualityWeight;
  } else if (summary.quality.lazyAvg > summary.quality.eagerAvg) {
    lazyScore += qualityWeight;
  } else {
    eagerScore += qualityWeight / 2;
    lazyScore += qualityWeight / 2;
  }

  // Latency scoring (lower is better)
  if (summary.latency.eagerAvg < summary.latency.lazyAvg) {
    eagerScore += latencyWeight;
  } else if (summary.latency.lazyAvg < summary.latency.eagerAvg) {
    lazyScore += latencyWeight;
  } else {
    eagerScore += latencyWeight / 2;
    lazyScore += latencyWeight / 2;
  }

  const recommended = eagerScore > lazyScore ? 'Eager' : (lazyScore > eagerScore ? 'Lazy' : 'Either');

  const reasons = [];
  if (summary.quality.winner === 'Eager') {
    reasons.push('Eager provides higher answer quality');
  } else if (summary.quality.winner === 'Lazy') {
    reasons.push('Lazy provides higher answer quality');
  }

  if (summary.latency.winner === 'Eager') {
    reasons.push('Eager has lower latency (pre-computed summaries)');
  } else if (summary.latency.winner === 'Lazy') {
    reasons.push('Lazy has lower latency (on-demand generation)');
  }

  // Add context-specific advice
  if (summary.communities.lazyAvg < summary.communities.eagerAvg * 0.5) {
    reasons.push('Lazy uses fewer communities (more focused context)');
  }

  return {
    recommended,
    eagerScore: Number(eagerScore.toFixed(2)),
    lazyScore: Number(lazyScore.toFixed(2)),
    reasons,
    advice: recommended === 'Eager'
      ? 'Use Eager mode for production. Pre-compute community summaries during indexing.'
      : recommended === 'Lazy'
        ? 'Use Lazy mode for flexibility. Summaries are generated on-demand per query.'
        : 'Both strategies perform similarly. Choose based on your infrastructure constraints.',
  };
}

module.exports = {
  compareStrategies,
  runComparisonBenchmark,
  formatComparisonReport,
  formatComparisonReportMarkdown,
  formatComparisonReportJSON,
  calculateAggregateMetrics,
  createSampleComparisonDataset,
  getRecommendation,
  DEFAULT_CONFIG,
};
