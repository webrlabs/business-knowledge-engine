/**
 * A/B Chunking Comparison Service
 *
 * Compares retrieval quality between semantic and fixed-size chunking strategies.
 * Uses the evaluation framework metrics to measure and compare performance.
 *
 * Feature: F4.1.4 - A/B Chunking Comparison
 *
 * Methods:
 * - compareChunkingStrategies: Full comparison with embedding generation
 * - runComparisonBenchmark: Run comparison against a test dataset
 * - formatComparisonReport: Generate human-readable report
 *
 * References:
 * - Max-Min semantic chunking (2025): https://link.springer.com/article/10.1007/s10791-025-09638-7
 * - Chunking Strategies for RAG (2025): https://medium.com/@adnanmasood/chunking-strategies-for-retrieval-augmented-generation-rag
 */

const { getSemanticChunker } = require('../chunking/semantic-chunker');
const { getOpenAIService } = require('../services/openai-service');
const { computeAllMetrics, formatMetrics } = require('./metrics');
const { log } = require('../utils/logger');

// Default configuration for fixed-size chunking
const DEFAULT_FIXED_CONFIG = {
  chunkSize: 500, // words
  overlap: 50,    // words
};

// Default configuration for semantic chunking
const DEFAULT_SEMANTIC_CONFIG = {
  breakpointPercentileThreshold: 95,
  bufferSize: 1,
  maxChunkWords: 800,
  minChunkWords: 50,
};

/**
 * Split text into fixed-size chunks (word-based).
 *
 * @param {string} text - Text to chunk
 * @param {number} chunkSize - Words per chunk
 * @param {number} overlap - Overlap words between chunks
 * @returns {Object[]} Array of chunk objects
 */
function createFixedChunks(text, chunkSize = 500, overlap = 50) {
  const chunks = [];
  const words = text.split(/\s+/);

  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const content = words.slice(start, end).join(' ');

    if (content.trim().length > 0) {
      chunks.push({
        id: `fixed_chunk_${chunkIndex}`,
        content: content.trim(),
        chunkIndex,
        method: 'fixed',
        wordCount: end - start,
        startWord: start,
        endWord: end - 1,
      });
      chunkIndex++;
    }

    // Move with overlap
    start = end - overlap;

    // Ensure progress
    if (start <= 0 || start >= words.length - overlap) {
      start = end;
    }
  }

  return chunks;
}

/**
 * Calculate cosine similarity between two vectors.
 *
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Cosine similarity (0 to 1)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Retrieve top K chunks by similarity to query embedding.
 *
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {Object[]} chunks - Array of chunks with embeddings
 * @param {number} k - Number of top results to return
 * @returns {Object[]} Top K chunks sorted by similarity
 */
function retrieveTopK(queryEmbedding, chunks, k = 10) {
  const scored = chunks.map(chunk => ({
    ...chunk,
    similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, k);
}

/**
 * Compare chunking strategies for a given document and test queries.
 *
 * @param {string} documentText - The document text to chunk
 * @param {Object[]} testQueries - Array of test queries with relevance judgments
 *   Each query: { question: string, relevantChunkKeywords: string[], ... }
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Comparison results with metrics for each strategy
 */
async function compareChunkingStrategies(documentText, testQueries, options = {}) {
  const startTime = Date.now();

  const fixedConfig = { ...DEFAULT_FIXED_CONFIG, ...options.fixed };
  const semanticConfig = { ...DEFAULT_SEMANTIC_CONFIG, ...options.semantic };
  const kValues = options.kValues || [1, 3, 5, 10];

  const openai = getOpenAIService();
  const semanticChunker = getSemanticChunker(semanticConfig);

  log.info('Starting A/B chunking comparison', {
    documentLength: documentText.length,
    queryCount: testQueries.length,
    fixedConfig,
    semanticConfig,
  });

  // Step 1: Create chunks using both strategies
  log.debug('Creating fixed chunks...');
  const fixedChunks = createFixedChunks(documentText, fixedConfig.chunkSize, fixedConfig.overlap);

  log.debug('Creating semantic chunks...');
  const semanticResult = await semanticChunker.chunkText(documentText, semanticConfig);
  const semanticChunks = semanticResult.chunks.map((chunk, index) => ({
    id: `semantic_chunk_${index}`,
    content: chunk.content,
    chunkIndex: index,
    method: chunk.method || 'semantic',
    wordCount: chunk.content.split(/\s+/).length,
    sentences: chunk.sentences,
    startSentence: chunk.startSentence,
    endSentence: chunk.endSentence,
  }));

  log.info('Chunks created', {
    fixedChunkCount: fixedChunks.length,
    semanticChunkCount: semanticChunks.length,
    semanticMethod: semanticResult.metadata.method,
    breakpoints: semanticResult.metadata.breakpoints?.length || 0,
  });

  // Step 2: Generate embeddings for all chunks
  log.debug('Generating embeddings for fixed chunks...');
  const fixedTexts = fixedChunks.map(c => c.content);
  const fixedEmbeddings = await openai.getEmbeddings(fixedTexts);
  fixedChunks.forEach((chunk, i) => {
    chunk.embedding = fixedEmbeddings[i];
  });

  log.debug('Generating embeddings for semantic chunks...');
  const semanticTexts = semanticChunks.map(c => c.content);
  const semanticEmbeddings = await openai.getEmbeddings(semanticTexts);
  semanticChunks.forEach((chunk, i) => {
    chunk.embedding = semanticEmbeddings[i];
  });

  // Step 3: Generate query embeddings
  log.debug('Generating query embeddings...');
  const queryTexts = testQueries.map(q => q.question);
  const queryEmbeddings = await openai.getEmbeddings(queryTexts);

  // Step 4: For each query, retrieve and evaluate
  const fixedResults = [];
  const semanticResults = [];

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    const queryEmbedding = queryEmbeddings[i];

    // Retrieve from fixed chunks
    const fixedTop = retrieveTopK(queryEmbedding, fixedChunks, Math.max(...kValues));
    const fixedRetrieved = fixedTop.map(c => c.id);

    // Retrieve from semantic chunks
    const semanticTop = retrieveTopK(queryEmbedding, semanticChunks, Math.max(...kValues));
    const semanticRetrieved = semanticTop.map(c => c.id);

    // Determine relevant chunks by keyword matching
    const fixedRelevant = determineRelevantChunks(fixedChunks, query.relevantChunkKeywords || []);
    const semanticRelevant = determineRelevantChunks(semanticChunks, query.relevantChunkKeywords || []);

    fixedResults.push({
      query: query.question,
      retrieved: fixedRetrieved,
      relevant: fixedRelevant,
      topChunks: fixedTop.slice(0, 3).map(c => ({
        id: c.id,
        similarity: c.similarity,
        preview: c.content.substring(0, 100) + '...',
      })),
    });

    semanticResults.push({
      query: query.question,
      retrieved: semanticRetrieved,
      relevant: semanticRelevant,
      topChunks: semanticTop.slice(0, 3).map(c => ({
        id: c.id,
        similarity: c.similarity,
        preview: c.content.substring(0, 100) + '...',
      })),
    });
  }

  // Step 5: Compute metrics
  const fixedMetrics = computeAllMetrics(fixedResults, kValues);
  const semanticMetrics = computeAllMetrics(semanticResults, kValues);

  // Step 6: Calculate chunk quality statistics
  const fixedChunkStats = calculateChunkStats(fixedChunks);
  const semanticChunkStats = calculateChunkStats(semanticChunks);

  const processingTime = Date.now() - startTime;

  log.info('A/B chunking comparison completed', {
    processingTimeMs: processingTime,
    fixedMRR: fixedMetrics.mrr,
    semanticMRR: semanticMetrics.mrr,
  });

  return {
    comparison: {
      documentLength: documentText.length,
      queryCount: testQueries.length,
      processingTimeMs: processingTime,
    },
    fixed: {
      config: fixedConfig,
      chunkCount: fixedChunks.length,
      chunkStats: fixedChunkStats,
      metrics: fixedMetrics,
      queryResults: fixedResults,
    },
    semantic: {
      config: semanticConfig,
      chunkCount: semanticChunks.length,
      chunkStats: semanticChunkStats,
      metadata: {
        method: semanticResult.metadata.method,
        breakpoints: semanticResult.metadata.breakpoints?.length || 0,
        distanceStats: semanticResult.metadata.distanceStats,
      },
      metrics: semanticMetrics,
      queryResults: semanticResults,
    },
    winner: determineWinner(fixedMetrics, semanticMetrics),
    improvements: calculateImprovements(fixedMetrics, semanticMetrics, kValues),
  };
}

/**
 * Determine which chunks are relevant based on keyword matching.
 *
 * @param {Object[]} chunks - Array of chunks
 * @param {string[]} keywords - Keywords that indicate relevance
 * @returns {string[]} Array of relevant chunk IDs
 */
function determineRelevantChunks(chunks, keywords) {
  if (!keywords || keywords.length === 0) {
    return [];
  }

  const relevant = [];
  const normalizedKeywords = keywords.map(k => k.toLowerCase());

  for (const chunk of chunks) {
    const contentLower = chunk.content.toLowerCase();
    const hasKeyword = normalizedKeywords.some(keyword => contentLower.includes(keyword));

    if (hasKeyword) {
      relevant.push(chunk.id);
    }
  }

  return relevant;
}

/**
 * Calculate statistics about chunk sizes.
 *
 * @param {Object[]} chunks - Array of chunks
 * @returns {Object} Statistics object
 */
function calculateChunkStats(chunks) {
  if (chunks.length === 0) {
    return { count: 0, avgWords: 0, minWords: 0, maxWords: 0, stdDev: 0 };
  }

  const wordCounts = chunks.map(c => c.wordCount || c.content.split(/\s+/).length);
  const sum = wordCounts.reduce((a, b) => a + b, 0);
  const avg = sum / wordCounts.length;
  const min = Math.min(...wordCounts);
  const max = Math.max(...wordCounts);

  const squaredDiffs = wordCounts.map(w => Math.pow(w - avg, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / wordCounts.length;
  const stdDev = Math.sqrt(variance);

  return {
    count: chunks.length,
    avgWords: Math.round(avg),
    minWords: min,
    maxWords: max,
    stdDev: Math.round(stdDev * 100) / 100,
    totalWords: sum,
  };
}

/**
 * Determine the overall winner based on key metrics.
 *
 * @param {Object} fixedMetrics - Metrics for fixed chunking
 * @param {Object} semanticMetrics - Metrics for semantic chunking
 * @returns {Object} Winner determination with reasoning
 */
function determineWinner(fixedMetrics, semanticMetrics) {
  const scores = {
    fixed: 0,
    semantic: 0,
  };

  // Compare MRR (important for finding first relevant result)
  if (fixedMetrics.mrr > semanticMetrics.mrr) scores.fixed += 2;
  else if (semanticMetrics.mrr > fixedMetrics.mrr) scores.semantic += 2;

  // Compare MAP (important for overall ranking quality)
  if (fixedMetrics.map > semanticMetrics.map) scores.fixed += 2;
  else if (semanticMetrics.map > fixedMetrics.map) scores.semantic += 2;

  // Compare metrics at different K values
  for (const k of Object.keys(fixedMetrics.metrics || {})) {
    const fixedK = fixedMetrics.metrics[k];
    const semanticK = semanticMetrics.metrics[k];

    if (fixedK && semanticK) {
      if (fixedK.recall > semanticK.recall) scores.fixed += 1;
      else if (semanticK.recall > fixedK.recall) scores.semantic += 1;

      if (fixedK.ndcg > semanticK.ndcg) scores.fixed += 1;
      else if (semanticK.ndcg > fixedK.ndcg) scores.semantic += 1;
    }
  }

  const winner = scores.fixed > scores.semantic ? 'fixed' :
                 scores.semantic > scores.fixed ? 'semantic' : 'tie';

  return {
    winner,
    scores,
    reasoning: winner === 'tie' ?
      'Both strategies performed equally well' :
      `${winner} chunking outperformed with score ${Math.max(scores.fixed, scores.semantic)} vs ${Math.min(scores.fixed, scores.semantic)}`,
  };
}

/**
 * Calculate improvement percentages between strategies.
 *
 * @param {Object} fixedMetrics - Metrics for fixed chunking
 * @param {Object} semanticMetrics - Metrics for semantic chunking
 * @param {number[]} kValues - K values to compare
 * @returns {Object} Improvement percentages (positive = semantic better)
 */
function calculateImprovements(fixedMetrics, semanticMetrics, kValues) {
  const improvements = {
    mrr: calculatePercentImprovement(fixedMetrics.mrr, semanticMetrics.mrr),
    map: calculatePercentImprovement(fixedMetrics.map, semanticMetrics.map),
    byK: {},
  };

  for (const k of kValues) {
    const kKey = `@${k}`;
    const fixedK = fixedMetrics.metrics?.[kKey];
    const semanticK = semanticMetrics.metrics?.[kKey];

    if (fixedK && semanticK) {
      improvements.byK[kKey] = {
        precision: calculatePercentImprovement(fixedK.precision, semanticK.precision),
        recall: calculatePercentImprovement(fixedK.recall, semanticK.recall),
        f1: calculatePercentImprovement(fixedK.f1, semanticK.f1),
        ndcg: calculatePercentImprovement(fixedK.ndcg, semanticK.ndcg),
        hitRate: calculatePercentImprovement(fixedK.hitRate, semanticK.hitRate),
      };
    }
  }

  return improvements;
}

/**
 * Calculate percentage improvement from baseline to new value.
 *
 * @param {number} baseline - Baseline (fixed) value
 * @param {number} newValue - New (semantic) value
 * @returns {number} Percentage improvement (positive = new is better)
 */
function calculatePercentImprovement(baseline, newValue) {
  if (baseline === 0 && newValue === 0) return 0;
  if (baseline === 0) return newValue > 0 ? 100 : 0;
  return Math.round(((newValue - baseline) / baseline) * 10000) / 100;
}

/**
 * Run comparison against a benchmark dataset.
 *
 * @param {Object} dataset - Benchmark dataset with documents and queries
 * @returns {Promise<Object>} Aggregated comparison results
 */
async function runComparisonBenchmark(dataset, options = {}) {
  const results = [];

  for (const testCase of dataset.testCases || []) {
    try {
      const result = await compareChunkingStrategies(
        testCase.documentText,
        testCase.queries,
        options
      );
      results.push({
        testCaseId: testCase.id,
        name: testCase.name,
        ...result,
      });
    } catch (error) {
      log.error('Comparison failed for test case', {
        testCaseId: testCase.id,
        error: error.message,
      });
      results.push({
        testCaseId: testCase.id,
        name: testCase.name,
        error: error.message,
      });
    }
  }

  // Aggregate results
  const successfulResults = results.filter(r => !r.error);
  const aggregated = aggregateResults(successfulResults);

  return {
    dataset: {
      name: dataset.name,
      totalTestCases: dataset.testCases?.length || 0,
      successfulTestCases: successfulResults.length,
    },
    aggregated,
    individualResults: results,
  };
}

/**
 * Aggregate results from multiple test cases.
 *
 * @param {Object[]} results - Array of comparison results
 * @returns {Object} Aggregated metrics
 */
function aggregateResults(results) {
  if (results.length === 0) {
    return { fixed: {}, semantic: {}, winner: 'unknown' };
  }

  const fixedMRRs = results.map(r => r.fixed?.metrics?.mrr || 0);
  const semanticMRRs = results.map(r => r.semantic?.metrics?.mrr || 0);
  const fixedMAPs = results.map(r => r.fixed?.metrics?.map || 0);
  const semanticMAPs = results.map(r => r.semantic?.metrics?.map || 0);

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  const fixedWins = results.filter(r => r.winner?.winner === 'fixed').length;
  const semanticWins = results.filter(r => r.winner?.winner === 'semantic').length;
  const ties = results.filter(r => r.winner?.winner === 'tie').length;

  return {
    fixed: {
      avgMRR: avg(fixedMRRs),
      avgMAP: avg(fixedMAPs),
      wins: fixedWins,
    },
    semantic: {
      avgMRR: avg(semanticMRRs),
      avgMAP: avg(semanticMAPs),
      wins: semanticWins,
    },
    ties,
    overallWinner: semanticWins > fixedWins ? 'semantic' :
                   fixedWins > semanticWins ? 'fixed' : 'tie',
  };
}

/**
 * Format comparison results as a human-readable report.
 *
 * @param {Object} results - Comparison results
 * @returns {string} Formatted report
 */
function formatComparisonReport(results) {
  const lines = [
    '═══════════════════════════════════════════════════════════════════',
    '               A/B CHUNKING COMPARISON REPORT',
    '═══════════════════════════════════════════════════════════════════',
    '',
    '📊 OVERVIEW',
    '───────────────────────────────────────────────────────────────────',
    `Document Length: ${results.comparison?.documentLength?.toLocaleString()} characters`,
    `Queries Tested: ${results.comparison?.queryCount}`,
    `Processing Time: ${results.comparison?.processingTimeMs}ms`,
    '',
    '📦 CHUNK STATISTICS',
    '───────────────────────────────────────────────────────────────────',
    '',
    'Fixed Chunking:',
    `  • Chunks Created: ${results.fixed?.chunkCount}`,
    `  • Avg Words/Chunk: ${results.fixed?.chunkStats?.avgWords}`,
    `  • Word Range: ${results.fixed?.chunkStats?.minWords} - ${results.fixed?.chunkStats?.maxWords}`,
    `  • Std Dev: ${results.fixed?.chunkStats?.stdDev}`,
    '',
    'Semantic Chunking:',
    `  • Chunks Created: ${results.semantic?.chunkCount}`,
    `  • Avg Words/Chunk: ${results.semantic?.chunkStats?.avgWords}`,
    `  • Word Range: ${results.semantic?.chunkStats?.minWords} - ${results.semantic?.chunkStats?.maxWords}`,
    `  • Std Dev: ${results.semantic?.chunkStats?.stdDev}`,
    `  • Breakpoints Detected: ${results.semantic?.metadata?.breakpoints || 0}`,
    '',
    '📈 RETRIEVAL METRICS',
    '───────────────────────────────────────────────────────────────────',
    '',
    '                    FIXED      SEMANTIC    IMPROVEMENT',
    `MRR:                ${formatMetricValue(results.fixed?.metrics?.mrr)}      ${formatMetricValue(results.semantic?.metrics?.mrr)}       ${formatImprovement(results.improvements?.mrr)}`,
    `MAP:                ${formatMetricValue(results.fixed?.metrics?.map)}      ${formatMetricValue(results.semantic?.metrics?.map)}       ${formatImprovement(results.improvements?.map)}`,
    '',
  ];

  // Add per-K metrics
  const kValues = Object.keys(results.improvements?.byK || {});
  for (const k of kValues) {
    const fixedK = results.fixed?.metrics?.metrics?.[k];
    const semanticK = results.semantic?.metrics?.metrics?.[k];
    const impK = results.improvements?.byK?.[k];

    if (fixedK && semanticK) {
      lines.push(`Metrics ${k}:`);
      lines.push(`  Precision:        ${formatMetricValue(fixedK.precision)}      ${formatMetricValue(semanticK.precision)}       ${formatImprovement(impK?.precision)}`);
      lines.push(`  Recall:           ${formatMetricValue(fixedK.recall)}      ${formatMetricValue(semanticK.recall)}       ${formatImprovement(impK?.recall)}`);
      lines.push(`  F1:               ${formatMetricValue(fixedK.f1)}      ${formatMetricValue(semanticK.f1)}       ${formatImprovement(impK?.f1)}`);
      lines.push(`  NDCG:             ${formatMetricValue(fixedK.ndcg)}      ${formatMetricValue(semanticK.ndcg)}       ${formatImprovement(impK?.ndcg)}`);
      lines.push(`  Hit Rate:         ${formatMetricValue(fixedK.hitRate)}      ${formatMetricValue(semanticK.hitRate)}       ${formatImprovement(impK?.hitRate)}`);
      lines.push('');
    }
  }

  lines.push('🏆 WINNER');
  lines.push('───────────────────────────────────────────────────────────────────');
  lines.push(`Winner: ${results.winner?.winner?.toUpperCase() || 'UNKNOWN'}`);
  lines.push(`Reasoning: ${results.winner?.reasoning || 'N/A'}`);
  lines.push(`Scores: Fixed=${results.winner?.scores?.fixed || 0}, Semantic=${results.winner?.scores?.semantic || 0}`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format a metric value for display.
 */
function formatMetricValue(value) {
  if (value === undefined || value === null) return '  N/A  ';
  return value.toFixed(4).padStart(7);
}

/**
 * Format an improvement percentage for display.
 */
function formatImprovement(value) {
  if (value === undefined || value === null) return '   N/A';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`.padStart(7);
}

module.exports = {
  compareChunkingStrategies,
  runComparisonBenchmark,
  formatComparisonReport,
  createFixedChunks,
  // Exported for testing
  cosineSimilarity,
  retrieveTopK,
  determineRelevantChunks,
  calculateChunkStats,
  determineWinner,
  calculateImprovements,
  DEFAULT_FIXED_CONFIG,
  DEFAULT_SEMANTIC_CONFIG,
};
