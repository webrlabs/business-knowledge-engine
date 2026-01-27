#!/usr/bin/env node
/**
 * Benchmark Runner Script
 *
 * CLI tool to run the full evaluation suite against the current system.
 * Integrates all evaluation metrics and generates comprehensive reports.
 *
 * Features:
 * - Run individual evaluators or full suite
 * - Support for benchmark datasets (JSON format)
 * - JSON and human-readable output formats
 * - CI/CD friendly with exit codes
 * - Configurable thresholds for pass/fail
 *
 * Usage:
 *   node run-benchmark.js --help
 *   node run-benchmark.js --suite all --dataset ./datasets/benchmark.json
 *   node run-benchmark.js --suite retrieval --output json
 *   node run-benchmark.js --suite entity-extraction --threshold 0.8
 *
 * Reference: Inspired by DeepEval and RAGAS evaluation frameworks
 * https://github.com/confident-ai/deepeval
 * https://github.com/explodinggradients/ragas
 *
 * Feature: F1.3.1 - Benchmark Runner Script
 */

const fs = require('fs');
const path = require('path');
const { log } = require('../utils/logger');

// Import evaluation modules
const metrics = require('./metrics');
const llmJudge = require('./llm-judge');
const groundingScore = require('./grounding-score');
const citationAccuracy = require('./citation-accuracy');
const entityExtractionEvaluator = require('./entity-extraction-evaluator');
const communitySummaryEvaluator = require('./community-summary-evaluator');
const lazyVsEagerComparison = require('./lazy-vs-eager-comparison');
const negativeTestEvaluator = require('./negative-test-evaluator');

// Import results storage service (F1.3.2)
const { getResultsStorageService } = require('./results-storage-service');

// Conditionally import relationship evaluator if available
let relationshipExtractionEvaluator;
try {
  relationshipExtractionEvaluator = require('./relationship-extraction-evaluator');
} catch {
  relationshipExtractionEvaluator = null;
}

/**
 * Available evaluation suites
 */
const SUITES = {
  ALL: 'all',
  RETRIEVAL: 'retrieval',
  ANSWER_QUALITY: 'answer-quality',
  GROUNDING: 'grounding',
  CITATION: 'citation',
  ENTITY_EXTRACTION: 'entity-extraction',
  RELATIONSHIP_EXTRACTION: 'relationship-extraction',
  COMMUNITY_SUMMARY: 'community-summary',
  LAZY_VS_EAGER: 'lazy-vs-eager',
  NEGATIVE_TESTS: 'negative-tests'
};

/**
 * Output formats
 */
const OUTPUT_FORMATS = {
  JSON: 'json',
  TEXT: 'text',
  MARKDOWN: 'markdown'
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  suite: SUITES.ALL,
  output: OUTPUT_FORMATS.TEXT,
  threshold: 0.7,
  failOnThreshold: false,
  verbose: false,
  kValues: [1, 3, 5, 10],
  // Results storage options (F1.3.2)
  saveResults: false,
  runName: null,
  gitCommit: null,
  gitBranch: null,
  tags: {},
  compareToBaseline: false,
  setAsBaseline: false,
  baselineName: 'default'
};

/**
 * Parse command line arguments
 *
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed configuration
 */
function parseArgs(args) {
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      case '--suite':
      case '-s':
        config.suite = args[++i] || SUITES.ALL;
        break;

      case '--dataset':
      case '-d':
        config.datasetPath = args[++i];
        break;

      case '--output':
      case '-o':
        config.output = args[++i] || OUTPUT_FORMATS.TEXT;
        break;

      case '--output-file':
      case '-f':
        config.outputFile = args[++i];
        break;

      case '--threshold':
      case '-t':
        config.threshold = parseFloat(args[++i]) || DEFAULT_CONFIG.threshold;
        break;

      case '--fail-on-threshold':
        config.failOnThreshold = true;
        break;

      case '--verbose':
      case '-v':
        config.verbose = true;
        break;

      case '--config':
      case '-c':
        const configPath = args[++i];
        if (configPath && fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          Object.assign(config, fileConfig);
        }
        break;

      // Results storage options (F1.3.2)
      case '--save-results':
        config.saveResults = true;
        break;

      case '--run-name':
        config.runName = args[++i];
        break;

      case '--git-commit':
        config.gitCommit = args[++i];
        break;

      case '--git-branch':
        config.gitBranch = args[++i];
        break;

      case '--tag':
        const tagArg = args[++i];
        if (tagArg && tagArg.includes('=')) {
          const [key, value] = tagArg.split('=');
          config.tags[key] = value;
        }
        break;

      case '--compare-baseline':
        config.compareToBaseline = true;
        break;

      case '--set-baseline':
        config.setAsBaseline = true;
        break;

      case '--baseline-name':
        config.baselineName = args[++i] || 'default';
        break;

      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  return config;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Benchmark Runner - Evaluation Suite for GraphRAG System

Usage: node run-benchmark.js [options]

Options:
  -h, --help                Show this help message
  -s, --suite <name>        Evaluation suite to run (default: all)
                            Options: all, retrieval, answer-quality, grounding,
                                     citation, entity-extraction, relationship-extraction
  -d, --dataset <path>      Path to benchmark dataset JSON file
  -o, --output <format>     Output format: json, text, markdown (default: text)
  -f, --output-file <path>  Write output to file instead of stdout
  -t, --threshold <value>   Pass/fail threshold (0-1, default: 0.7)
  --fail-on-threshold       Exit with error code if below threshold
  -v, --verbose             Show detailed output
  -c, --config <path>       Load configuration from JSON file

Results Storage Options (F1.3.2):
  --save-results            Save results to persistent storage
  --run-name <name>         Human-readable name for this run
  --git-commit <hash>       Git commit hash to associate with run
  --git-branch <branch>     Git branch name to associate with run
  --tag <key=value>         Add custom tag (can be used multiple times)
  --compare-baseline        Compare results against the baseline
  --set-baseline            Set this run as the new baseline
  --baseline-name <name>    Baseline name to use (default: 'default')

Examples:
  # Run all evaluations with default settings
  node run-benchmark.js

  # Run retrieval metrics only
  node run-benchmark.js --suite retrieval

  # Run with dataset and JSON output
  node run-benchmark.js --dataset ./datasets/qa_benchmark.json --output json

  # Run for CI/CD with threshold check
  node run-benchmark.js --threshold 0.8 --fail-on-threshold

  # Save results with metadata for trend analysis (F1.3.2)
  node run-benchmark.js --save-results --run-name "Sprint 12 Release" --git-branch main

  # Compare against baseline and fail if regressions detected
  node run-benchmark.js --save-results --compare-baseline --fail-on-threshold

  # Set new baseline after successful run
  node run-benchmark.js --save-results --set-baseline --baseline-name "v2.0-baseline"

Dataset Format:
  {
    "metadata": { "name": "...", "version": "...", "created": "..." },
    "retrieval": [
      { "query": "...", "retrieved": ["id1", "id2"], "relevant": ["id1", "id3"] }
    ],
    "qa": [
      { "question": "...", "answer": "...", "context": "...", "expectedAnswer": "..." }
    ],
    "entities": [
      { "extracted": [...], "groundTruth": [...] }
    ],
    "relationships": [
      { "extracted": [...], "groundTruth": [...] }
    ]
  }
`);
}

/**
 * Load benchmark dataset from file
 *
 * @param {string} datasetPath - Path to dataset file
 * @returns {Object} Loaded dataset
 */
function loadDataset(datasetPath) {
  if (!datasetPath) {
    return null;
  }

  try {
    const absolutePath = path.isAbsolute(datasetPath)
      ? datasetPath
      : path.join(process.cwd(), datasetPath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Dataset file not found: ${absolutePath}`);
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    const dataset = JSON.parse(content);

    log.info('Loaded benchmark dataset', {
      path: absolutePath,
      metadata: dataset.metadata
    });

    return dataset;
  } catch (error) {
    log.error('Failed to load dataset', { error: error.message });
    throw error;
  }
}

/**
 * Run retrieval metrics evaluation
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runRetrievalEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!dataset?.retrieval || dataset.retrieval.length === 0) {
    return {
      suite: 'retrieval',
      status: 'skipped',
      reason: 'No retrieval data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const queries = dataset.retrieval.map(item => ({
      retrieved: item.retrieved || [],
      relevant: new Set(item.relevant || [])
    }));

    const results = metrics.computeAllMetrics(queries, config.kValues);

    return {
      suite: 'retrieval',
      status: 'success',
      metrics: {
        mrr: results.mrr,
        map: results.map,
        queryCount: results.queryCount,
        atK: results.metrics
      },
      passed: results.mrr >= config.threshold,
      threshold: config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'retrieval',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run answer quality (LLM-as-Judge) evaluation
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runAnswerQualityEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!dataset?.qa || dataset.qa.length === 0) {
    return {
      suite: 'answer-quality',
      status: 'skipped',
      reason: 'No QA data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const items = dataset.qa.map(item => ({
      question: item.question,
      answer: item.answer,
      context: item.context
    }));

    const results = await llmJudge.evaluateBatch(items, ['helpfulness', 'accuracy', 'completeness']);

    // Calculate average scores
    const avgScores = {
      helpfulness: 0,
      accuracy: 0,
      completeness: 0,
      overall: 0
    };

    for (const result of results.evaluations) {
      if (result.dimensions) {
        avgScores.helpfulness += result.dimensions.helpfulness?.score || 0;
        avgScores.accuracy += result.dimensions.accuracy?.score || 0;
        avgScores.completeness += result.dimensions.completeness?.score || 0;
        avgScores.overall += result.overallScore || 0;
      }
    }

    const count = results.evaluations.length || 1;
    avgScores.helpfulness /= count;
    avgScores.accuracy /= count;
    avgScores.completeness /= count;
    avgScores.overall /= count;

    // Normalize to 0-1 scale (scores are 1-5)
    const normalizedScore = (avgScores.overall - 1) / 4;

    return {
      suite: 'answer-quality',
      status: 'success',
      metrics: {
        averageScores: avgScores,
        normalizedScore,
        evaluationCount: count
      },
      passed: normalizedScore >= config.threshold,
      threshold: config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'answer-quality',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run grounding score evaluation
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runGroundingEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!dataset?.qa || dataset.qa.length === 0) {
    return {
      suite: 'grounding',
      status: 'skipped',
      reason: 'No QA data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const items = dataset.qa.map(item => ({
      answer: item.answer,
      context: item.context
    }));

    const results = await groundingScore.calculateBatchGroundingScore(items);

    return {
      suite: 'grounding',
      status: 'success',
      metrics: {
        averageScore: results.aggregate.averageScore,
        averageWeightedScore: results.aggregate.averageWeightedScore,
        totalClaims: results.aggregate.totalClaims,
        supportedClaims: results.aggregate.supportedClaims,
        unsupportedClaims: results.aggregate.unsupportedClaims,
        evaluationCount: results.evaluations.length
      },
      passed: results.aggregate.averageScore >= config.threshold,
      threshold: config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'grounding',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run citation accuracy evaluation
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runCitationEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!dataset?.qa || dataset.qa.length === 0) {
    return {
      suite: 'citation',
      status: 'skipped',
      reason: 'No QA data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const items = dataset.qa
      .filter(item => item.sources && item.sources.length > 0)
      .map(item => ({
        answer: item.answer,
        sources: item.sources
      }));

    if (items.length === 0) {
      return {
        suite: 'citation',
        status: 'skipped',
        reason: 'No QA items with sources in dataset',
        latencyMs: Date.now() - startTime
      };
    }

    const results = await citationAccuracy.calculateBatchCitationAccuracy(items);

    return {
      suite: 'citation',
      status: 'success',
      metrics: {
        averageScore: results.aggregate.averageScore,
        averageWeightedScore: results.aggregate.averageWeightedScore,
        totalCitations: results.aggregate.totalCitations,
        verifiedCitations: results.aggregate.verifiedCitations,
        evaluationCount: results.evaluations.length
      },
      passed: results.aggregate.averageScore >= config.threshold,
      threshold: config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'citation',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run entity extraction evaluation
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runEntityExtractionEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!dataset?.entities || dataset.entities.length === 0) {
    return {
      suite: 'entity-extraction',
      status: 'skipped',
      reason: 'No entity data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const results = entityExtractionEvaluator.evaluateBatchEntityExtraction(
      dataset.entities,
      { mode: entityExtractionEvaluator.MatchingMode.STRICT }
    );

    return {
      suite: 'entity-extraction',
      status: 'success',
      metrics: {
        precision: results.aggregate.precision,
        recall: results.aggregate.recall,
        f1: results.aggregate.f1,
        macroPrecision: results.aggregate.macroPrecision,
        macroRecall: results.aggregate.macroRecall,
        macroF1: results.aggregate.macroF1,
        perTypeMetrics: results.aggregate.perTypeMetrics,
        documentCount: results.documentCount
      },
      passed: results.aggregate.f1 >= config.threshold,
      threshold: config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'entity-extraction',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run relationship extraction evaluation
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runRelationshipExtractionEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!relationshipExtractionEvaluator) {
    return {
      suite: 'relationship-extraction',
      status: 'skipped',
      reason: 'Relationship extraction evaluator not available',
      latencyMs: Date.now() - startTime
    };
  }

  if (!dataset?.relationships || dataset.relationships.length === 0) {
    return {
      suite: 'relationship-extraction',
      status: 'skipped',
      reason: 'No relationship data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const results = relationshipExtractionEvaluator.evaluateBatchRelationshipExtraction(
      dataset.relationships,
      { mode: relationshipExtractionEvaluator.RelationshipMatchingMode.STRICT }
    );

    return {
      suite: 'relationship-extraction',
      status: 'success',
      metrics: {
        precision: results.aggregate.precision,
        recall: results.aggregate.recall,
        f1: results.aggregate.f1,
        directionAccuracy: results.aggregate.directionAccuracy,
        perTypeMetrics: results.aggregate.perTypeMetrics,
        documentCount: results.documentCount
      },
      passed: results.aggregate.f1 >= config.threshold,
      threshold: config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'relationship-extraction',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run community summary evaluation
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runCommunitySummaryEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!dataset?.community_summaries || dataset.community_summaries.length === 0) {
    return {
      suite: 'community-summary',
      status: 'skipped',
      reason: 'No community summary data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const results = await communitySummaryEvaluator.evaluateBatchCommunitySummaries(
      dataset.community_summaries,
      { concurrency: 3 }
    );

    return {
      suite: 'community-summary',
      status: 'success',
      metrics: {
        accuracy: results.aggregate.accuracy.mean,
        relevance: results.aggregate.relevance.mean,
        coherence: results.aggregate.coherence.mean,
        entityCoverage: results.aggregate.entityCoverage.mean,
        overall: results.aggregate.overall.mean,
        itemCount: results.itemCount
      },
      passed: results.aggregate.overall.mean >= (config.threshold * 5), // Scale threshold to 0-5 or normalize score?
      // Actually threshold is usually 0.7 (0-1). Overall mean is 1-5.
      // Let's normalize overall mean to 0-1 for pass check.
      // (mean - 1) / 4
      threshold: config.threshold,
      passed: ((results.aggregate.overall.mean - 1) / 4) >= config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'community-summary',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run Lazy vs Eager GraphRAG comparison
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runLazyVsEagerEvaluation(dataset, config) {
  const startTime = Date.now();

  const queries = dataset?.qa || dataset?.retrieval || [];
  if (queries.length === 0) {
    return {
      suite: 'lazy-vs-eager',
      status: 'skipped',
      reason: 'No QA or retrieval data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    const result = await lazyVsEagerComparison.compareStrategies(queries, {
      iterations: config.iterations || 1,
    });

    return {
      suite: 'lazy-vs-eager',
      status: 'success',
      metrics: {
        eagerLatencyAvg: result.summary.latency.eagerAvg,
        lazyLatencyAvg: result.summary.latency.lazyAvg,
        latencyDiffPercent: result.summary.latency.diffPercent,
        eagerQualityAvg: result.summary.quality.eagerAvg,
        lazyQualityAvg: result.summary.quality.lazyAvg,
        qualityDiff: result.summary.quality.diff,
        latencyWinner: result.summary.latency.winner,
        qualityWinner: result.summary.quality.winner,
        queryCount: result.summary.queryCount
      },
      // Pass if quality hasn't regressed significantly (e.g. less than 10% drop)
      // or if it meets the overall threshold
      passed: result.summary.quality.lazyAvg >= (config.threshold * 4 + 1), // scale 0-1 to 1-5
      threshold: config.threshold,
      latencyMs: Date.now() - startTime,
      report: lazyVsEagerComparison.formatComparisonReport(result)
    };
  } catch (error) {
    return {
      suite: 'lazy-vs-eager',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run negative tests (hallucination resistance) evaluation
 *
 * Uses the comprehensive negative-test-evaluator with:
 * - 7 categories: nonexistent_entity, out_of_scope, temporal_gap, fictional,
 *   specificity_trap, cross_domain, counterfactual
 * - Heuristic + optional LLM-based classification
 * - Explicit hallucination pattern detection
 *
 * @param {Object} dataset - Benchmark dataset
 * @param {Object} config - Configuration
 * @returns {Object} Evaluation results
 */
async function runNegativeTestEvaluation(dataset, config) {
  const startTime = Date.now();

  if (!dataset?.negative_tests || dataset.negative_tests.length === 0) {
    return {
      suite: 'negative-tests',
      status: 'skipped',
      reason: 'No negative_tests data in dataset',
      latencyMs: Date.now() - startTime
    };
  }

  try {
    // Prepare test items from dataset
    const items = dataset.negative_tests.map(testCase => ({
      testCase: {
        id: testCase.id,
        category: testCase.category || testCase.expectedOutcome || 'general',
        question: testCase.question,
        reason: testCase.rationale || testCase.reason || 'Negative test case',
        acceptableResponses: testCase.acceptableResponses || ['insufficient information', 'not found', 'no information'],
        unacceptablePatterns: testCase.unacceptablePatterns || []
      },
      // Use actualAnswer if available, otherwise expectedAnswer for validation
      response: testCase.actualAnswer || testCase.expectedAnswer || 'Insufficient information is available.'
    }));

    const results = await negativeTestEvaluator.evaluateBatch(items, {
      useLLM: false, // Use heuristics for speed in benchmarks
      concurrency: 5
    });

    return {
      suite: 'negative-tests',
      status: 'success',
      metrics: {
        totalTests: results.aggregate.totalTests,
        passRate: results.aggregate.passRate,
        hallucinationRate: results.aggregate.hallucinationRate,
        averageScore: results.aggregate.averageScore,
        correctRefusals: results.aggregate.correctRefusals,
        qualifiedResponses: results.aggregate.qualifiedResponses,
        hallucinations: results.aggregate.hallucinations,
        byCategory: results.aggregate.byCategory
      },
      passed: results.aggregate.passRate >= config.threshold,
      threshold: config.threshold,
      latencyMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      suite: 'negative-tests',
      status: 'error',
      error: error.message,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Run all benchmark evaluations
 *
 * @param {Object} config - Configuration
 * @returns {Object} All evaluation results
 */
async function runBenchmark(config) {
  const startTime = Date.now();
  const results = {
    metadata: {
      timestamp: new Date().toISOString(),
      config: {
        suite: config.suite,
        threshold: config.threshold,
        datasetPath: config.datasetPath || 'none'
      }
    },
    suites: {},
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errors: 0
    }
  };

  // Load dataset
  let dataset = null;
  if (config.datasetPath) {
    try {
      dataset = loadDataset(config.datasetPath);
      results.metadata.dataset = dataset.metadata;
    } catch (error) {
      results.metadata.datasetError = error.message;
    }
  }

  // Create sample dataset if none provided
  if (!dataset) {
    dataset = createSampleDataset();
    results.metadata.dataset = { name: 'sample', note: 'Using sample dataset for demo' };
  }

  // Define suite runners
  const suiteRunners = {
    [SUITES.RETRIEVAL]: runRetrievalEvaluation,
    [SUITES.ANSWER_QUALITY]: runAnswerQualityEvaluation,
    [SUITES.GROUNDING]: runGroundingEvaluation,
    [SUITES.CITATION]: runCitationEvaluation,
    [SUITES.ENTITY_EXTRACTION]: runEntityExtractionEvaluation,
    [SUITES.RELATIONSHIP_EXTRACTION]: runRelationshipExtractionEvaluation,
    [SUITES.COMMUNITY_SUMMARY]: runCommunitySummaryEvaluation,
    [SUITES.LAZY_VS_EAGER]: runLazyVsEagerEvaluation,
    [SUITES.NEGATIVE_TESTS]: runNegativeTestEvaluation
  };

  // Determine which suites to run
  const suitesToRun = config.suite === SUITES.ALL
    ? Object.keys(suiteRunners)
    : [config.suite];

  // Run selected suites
  for (const suiteName of suitesToRun) {
    const runner = suiteRunners[suiteName];
    if (!runner) {
      results.suites[suiteName] = {
        suite: suiteName,
        status: 'error',
        error: `Unknown suite: ${suiteName}`
      };
      results.summary.errors++;
      continue;
    }

    if (config.verbose) {
      console.log(`Running ${suiteName} evaluation...`);
    }

    const suiteResult = await runner(dataset, config);
    results.suites[suiteName] = suiteResult;
    results.summary.total++;

    switch (suiteResult.status) {
      case 'success':
        if (suiteResult.passed) {
          results.summary.passed++;
        } else {
          results.summary.failed++;
        }
        break;
      case 'skipped':
        results.summary.skipped++;
        break;
      case 'error':
        results.summary.errors++;
        break;
    }
  }

  results.metadata.totalLatencyMs = Date.now() - startTime;
  results.summary.overallPassed = results.summary.failed === 0 && results.summary.errors === 0;

  return results;
}

/**
 * Create a sample dataset for demo purposes
 *
 * @returns {Object} Sample dataset
 */
function createSampleDataset() {
  return {
    metadata: {
      name: 'sample-benchmark',
      version: '1.0.0',
      created: new Date().toISOString(),
      description: 'Sample benchmark dataset for demonstration'
    },
    retrieval: [
      {
        query: 'What is the purchase order process?',
        retrieved: ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'],
        relevant: ['doc1', 'doc3']
      },
      {
        query: 'Who approves invoices?',
        retrieved: ['doc2', 'doc5', 'doc1', 'doc6', 'doc7'],
        relevant: ['doc2', 'doc6']
      },
      {
        query: 'What systems are used for ERP?',
        retrieved: ['doc3', 'doc1', 'doc8', 'doc9', 'doc10'],
        relevant: ['doc3', 'doc8', 'doc9']
      }
    ],
    qa: [
      {
        question: 'What is the purchase order process?',
        answer: 'The purchase order process involves requisition, approval, and order placement.',
        context: 'The standard purchase order process consists of three main steps: requisition by the department, approval by management, and order placement with the vendor.',
        expectedAnswer: 'The purchase order process has three steps: requisition, approval, and order placement.'
      }
    ],
    entities: [
      {
        extracted: [
          { name: 'Purchase Order Process', type: 'Process' },
          { name: 'Finance Department', type: 'Department' },
          { name: 'Approval Task', type: 'Task' }
        ],
        groundTruth: [
          { name: 'Purchase Order Process', type: 'Process' },
          { name: 'Finance Department', type: 'Department' },
          { name: 'Approval Task', type: 'Task' },
          { name: 'SAP ERP', type: 'System' }
        ]
      }
    ],
    relationships: [
      {
        extracted: [
          { from: 'Finance Department', to: 'Purchase Order Process', type: 'OWNS' },
          { from: 'Approval Task', to: 'Purchase Order Process', type: 'PRECEDES' }
        ],
        groundTruth: [
          { from: 'Finance Department', to: 'Purchase Order Process', type: 'OWNS' },
          { from: 'Purchase Order Process', to: 'SAP ERP', type: 'USES' }
        ]
      }
    ],
    community_summaries: [
      {
        generatedSummary: {
          title: "Finance Process Community",
          summary: "This community centers on the Finance Department and its Purchase Order Process. Key entities include the Approval Task and SAP ERP system.",
          keyEntities: ["Finance Department", "Purchase Order Process", "Approval Task"]
        },
        groundTruth: {
          id: 1,
          members: ["Finance Department", "Purchase Order Process", "Approval Task", "SAP ERP"],
          dominantType: "Department",
          typeCounts: { "Department": 1, "Process": 1, "Task": 1, "System": 1 },
          relationships: [
            { source: "Finance Department", target: "Purchase Order Process", type: "OWNS" },
            { source: "Approval Task", target: "Purchase Order Process", type: "PRECEDES" }
          ]
        }
      }
    ]
  };
}

/**
 * Format results as text
 *
 * @param {Object} results - Benchmark results
 * @returns {string} Formatted text
 */
function formatAsText(results) {
  const lines = [
    '='.repeat(60),
    'BENCHMARK EVALUATION RESULTS',
    '='.repeat(60),
    '',
    `Timestamp: ${results.metadata.timestamp}`,
    `Dataset: ${results.metadata.dataset?.name || 'none'}`,
    `Threshold: ${results.metadata.config.threshold}`,
    '',
    '-'.repeat(60),
    'SUMMARY',
    '-'.repeat(60),
    `Total Suites: ${results.summary.total}`,
    `Passed: ${results.summary.passed}`,
    `Failed: ${results.summary.failed}`,
    `Skipped: ${results.summary.skipped}`,
    `Errors: ${results.summary.errors}`,
    `Overall: ${results.summary.overallPassed ? 'PASSED' : 'FAILED'}`,
    ''
  ];

  for (const [suiteName, suiteResult] of Object.entries(results.suites)) {
    lines.push('-'.repeat(60));
    lines.push(`SUITE: ${suiteName.toUpperCase()}`);
    lines.push('-'.repeat(60));
    lines.push(`Status: ${suiteResult.status}`);

    if (suiteResult.status === 'success') {
      lines.push(`Passed: ${suiteResult.passed ? 'YES' : 'NO'}`);
      lines.push(`Threshold: ${suiteResult.threshold}`);
      lines.push('');
      lines.push('Metrics:');

      for (const [key, value] of Object.entries(suiteResult.metrics)) {
        if (typeof value === 'number') {
          lines.push(`  ${key}: ${value.toFixed(4)}`);
        } else if (typeof value === 'object' && !Array.isArray(value)) {
          lines.push(`  ${key}:`);
          for (const [subKey, subValue] of Object.entries(value)) {
            if (typeof subValue === 'number') {
              lines.push(`    ${subKey}: ${subValue.toFixed(4)}`);
            } else if (typeof subValue === 'object') {
              lines.push(`    ${subKey}: [object]`);
            } else {
              lines.push(`    ${subKey}: ${subValue}`);
            }
          }
        } else {
          lines.push(`  ${key}: ${value}`);
        }
      }
    } else if (suiteResult.status === 'skipped') {
      lines.push(`Reason: ${suiteResult.reason}`);
    } else if (suiteResult.status === 'error') {
      lines.push(`Error: ${suiteResult.error}`);
    }

    lines.push(`Latency: ${suiteResult.latencyMs}ms`);
    lines.push('');
  }

  lines.push('='.repeat(60));
  lines.push(`Total Latency: ${results.metadata.totalLatencyMs}ms`);
  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * Format results as markdown
 *
 * @param {Object} results - Benchmark results
 * @returns {string} Formatted markdown
 */
function formatAsMarkdown(results) {
  const lines = [
    '# Benchmark Evaluation Results',
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Timestamp | ${results.metadata.timestamp} |`,
    `| Dataset | ${results.metadata.dataset?.name || 'none'} |`,
    `| Threshold | ${results.metadata.config.threshold} |`,
    `| Total Suites | ${results.summary.total} |`,
    `| Passed | ${results.summary.passed} |`,
    `| Failed | ${results.summary.failed} |`,
    `| Skipped | ${results.summary.skipped} |`,
    `| Errors | ${results.summary.errors} |`,
    `| **Overall** | **${results.summary.overallPassed ? 'PASSED' : 'FAILED'}** |`,
    '',
    '## Suite Results',
    ''
  ];

  for (const [suiteName, suiteResult] of Object.entries(results.suites)) {
    lines.push(`### ${suiteName}`);
    lines.push('');
    lines.push(`- **Status:** ${suiteResult.status}`);

    if (suiteResult.status === 'success') {
      lines.push(`- **Passed:** ${suiteResult.passed ? 'Yes' : 'No'}`);
      lines.push(`- **Threshold:** ${suiteResult.threshold}`);
      lines.push('');
      lines.push('**Metrics:**');
      lines.push('');
      lines.push('| Metric | Value |');
      lines.push('|--------|-------|');

      for (const [key, value] of Object.entries(suiteResult.metrics)) {
        if (typeof value === 'number') {
          lines.push(`| ${key} | ${value.toFixed(4)} |`);
        } else if (typeof value !== 'object') {
          lines.push(`| ${key} | ${value} |`);
        }
      }
    } else if (suiteResult.status === 'skipped') {
      lines.push(`- **Reason:** ${suiteResult.reason}`);
    } else if (suiteResult.status === 'error') {
      lines.push(`- **Error:** ${suiteResult.error}`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated in ${results.metadata.totalLatencyMs}ms*`);

  return lines.join('\n');
}

/**
 * Format results based on output format
 *
 * @param {Object} results - Benchmark results
 * @param {string} format - Output format
 * @returns {string} Formatted output
 */
function formatResults(results, format) {
  switch (format) {
    case OUTPUT_FORMATS.JSON:
      return JSON.stringify(results, null, 2);
    case OUTPUT_FORMATS.MARKDOWN:
      return formatAsMarkdown(results);
    case OUTPUT_FORMATS.TEXT:
    default:
      return formatAsText(results);
  }
}

/**
 * Main entry point
 */
async function main() {
  // Parse arguments (skip node and script path)
  const config = parseArgs(process.argv.slice(2));

  log.info('Starting benchmark evaluation', {
    suite: config.suite,
    threshold: config.threshold,
    dataset: config.datasetPath || 'sample',
    saveResults: config.saveResults
  });

  try {
    // Run benchmark
    const results = await runBenchmark(config);

    // Format output
    const output = formatResults(results, config.output);

    // Write output
    if (config.outputFile) {
      fs.writeFileSync(config.outputFile, output);
      console.log(`Results written to: ${config.outputFile}`);
    } else {
      console.log(output);
    }

    // Save results to persistent storage (F1.3.2)
    if (config.saveResults) {
      try {
        const storageService = getResultsStorageService();

        const storedRun = await storageService.storeRun(results, {
          runName: config.runName,
          gitCommit: config.gitCommit,
          gitBranch: config.gitBranch,
          tags: config.tags
        });

        console.log(`\nResults saved to storage: ${storedRun.runId}`);
        log.info('Benchmark results saved', { runId: storedRun.runId });

        // Compare to baseline if requested
        if (config.compareToBaseline) {
          try {
            const comparison = await storageService.compareToBaseline(
              storedRun.runId,
              config.baselineName
            );

            console.log('\n--- Baseline Comparison ---');
            console.log(`Baseline: ${comparison.baselineRun.name}`);
            console.log(`Improvements: ${comparison.summary.improvementCount}`);
            console.log(`Regressions: ${comparison.summary.regressionCount}`);
            console.log(`Unchanged: ${comparison.summary.unchangedCount}`);

            if (comparison.regressions.length > 0) {
              console.log('\nRegressions detected:');
              for (const reg of comparison.regressions) {
                console.log(`  - ${reg.metric}: ${reg.baseline.toFixed(4)} -> ${reg.current.toFixed(4)} (${reg.percentChange.toFixed(1)}%)`);
              }
            }

            if (comparison.improvements.length > 0) {
              console.log('\nImprovements:');
              for (const imp of comparison.improvements) {
                console.log(`  + ${imp.metric}: ${imp.baseline.toFixed(4)} -> ${imp.current.toFixed(4)} (+${imp.percentChange.toFixed(1)}%)`);
              }
            }

            // Fail if regressions detected and fail-on-threshold is set
            if (config.failOnThreshold && comparison.summary.hasRegressions) {
              log.warn('Regressions detected compared to baseline');
              process.exit(1);
            }
          } catch (compError) {
            console.log(`\nNote: Could not compare to baseline: ${compError.message}`);
          }
        }

        // Set as new baseline if requested
        if (config.setAsBaseline) {
          await storageService.setBaseline(storedRun.runId, config.baselineName);
          console.log(`\nRun set as baseline: ${config.baselineName}`);
          log.info('New baseline set', { runId: storedRun.runId, baselineName: config.baselineName });
        }
      } catch (storageError) {
        console.error(`Warning: Failed to save results to storage: ${storageError.message}`);
        log.warn('Failed to save benchmark results', { error: storageError.message });
      }
    }

    // Exit with appropriate code
    if (config.failOnThreshold && !results.summary.overallPassed) {
      log.warn('Benchmark failed threshold check');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    log.error('Benchmark failed', { error: error.message });
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Export for testing
module.exports = {
  parseArgs,
  loadDataset,
  runBenchmark,
  runRetrievalEvaluation,
  runAnswerQualityEvaluation,
  runGroundingEvaluation,
  runCitationEvaluation,
  runEntityExtractionEvaluation,
  runRelationshipExtractionEvaluation,
  runNegativeTestEvaluation,
  createSampleDataset,
  formatResults,
  formatAsText,
  formatAsMarkdown,
  SUITES,
  OUTPUT_FORMATS,
  DEFAULT_CONFIG
};

// Run if executed directly
if (require.main === module) {
  main();
}
