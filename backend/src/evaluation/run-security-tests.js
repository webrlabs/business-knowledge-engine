#!/usr/bin/env node
/**
 * Security Test Runner Script
 *
 * CLI tool to run automated security tests against the prompt injection
 * detection system. Integrates with CI/CD pipelines for continuous security
 * validation.
 *
 * Features:
 * - Run adversarial security test suite
 * - Support for custom test datasets
 * - JSON, text, and markdown output formats
 * - CI/CD friendly with exit codes and thresholds
 * - Per-category and per-severity metrics
 * - Multi-turn attack detection testing
 *
 * Usage:
 *   node run-security-tests.js --help
 *   node run-security-tests.js --output json
 *   node run-security-tests.js --threshold 0.9 --fail-on-threshold
 *
 * Reference: OWASP LLM Top 10 2025
 * https://genai.owasp.org/llmrisk/llm01-prompt-injection/
 *
 * Feature: F5.3.6 - Security Test Automation
 */

const fs = require('fs');
const path = require('path');

// Import evaluation modules
const adversarialEvaluator = require('./adversarial-evaluator');

// Logger utility
let log;
try {
  const logger = require('../utils/logger');
  log = logger.log;
} catch {
  log = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: () => {}
  };
}

// Fallback if log is still undefined
if (!log || typeof log.info !== 'function') {
  log = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    debug: () => {}
  };
}

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
  output: OUTPUT_FORMATS.TEXT,
  threshold: 0.85, // Higher threshold for security tests
  failOnThreshold: false,
  verbose: false,
  includeMultiTurn: true,
  categories: null, // null = all categories
  // CI/CD integration
  saveResults: false,
  runName: null,
  gitCommit: null,
  gitBranch: null,
  tags: {}
};

/**
 * Minimum thresholds for different security metrics
 */
const SECURITY_THRESHOLDS = {
  // Precision: of detected attacks, how many were actual attacks (avoid false positives)
  precision: 0.80,
  // Recall: of all attacks, how many were detected (avoid false negatives)
  recall: 0.85,
  // F1: harmonic mean of precision and recall
  f1: 0.82,
  // Specificity: correctly identifying benign inputs
  specificity: 0.70,
  // Critical attack detection rate (highest priority)
  criticalDetectionRate: 0.95
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

      case '--no-multi-turn':
        config.includeMultiTurn = false;
        break;

      case '--category':
      case '-c':
        if (!config.categories) {
          config.categories = [];
        }
        config.categories.push(args[++i]);
        break;

      case '--config':
        const configPath = args[++i];
        if (configPath && fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          Object.assign(config, fileConfig);
        }
        break;

      // CI/CD integration options
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
Security Test Runner - Automated Security Testing for GraphRAG System

Usage: node run-security-tests.js [options]

Options:
  -h, --help                Show this help message
  -d, --dataset <path>      Path to custom adversarial test dataset JSON file
                            (default: ./datasets/adversarial_tests.json)
  -o, --output <format>     Output format: json, text, markdown (default: text)
  -f, --output-file <path>  Write output to file instead of stdout
  -t, --threshold <value>   F1 score threshold for pass/fail (0-1, default: 0.85)
  --fail-on-threshold       Exit with error code if below threshold
  -v, --verbose             Show detailed output including individual test results
  --no-multi-turn           Skip multi-turn attack detection tests
  -c, --category <name>     Filter tests by category (can be used multiple times)
  --config <path>           Load configuration from JSON file

CI/CD Integration Options:
  --save-results            Save results to persistent storage
  --run-name <name>         Human-readable name for this run
  --git-commit <hash>       Git commit hash to associate with run
  --git-branch <branch>     Git branch name to associate with run
  --tag <key=value>         Add custom tag (can be used multiple times)

Attack Categories:
  instructionOverride      Attempts to override system instructions
  systemPromptExtraction   Attempts to extract system prompts
  rolePlayManipulation     Using role-play to bypass safety
  delimiterInjection       Injecting fake system delimiters
  codeExecution            Attempts to execute arbitrary code
  dataExfiltration         Attempts to exfiltrate data externally
  jailbreakPhrases         Known jailbreak techniques and phrases
  promptLeaking            Attempts to leak prompts via completion
  indirectInjection        Injection via external content markers
  obfuscation              Obfuscation and encoding attacks
  typoglycemia             Scrambled word attacks
  payloadSplitting         Payload split across multiple inputs
  flipAttack               Character/word order manipulation
  sugarCoated              Benign-seeming gradual attacks
  multiTurn                Multi-turn conversation attacks
  structuralAttacks        Structural manipulation
  ragPoisoning             RAG system poisoning attempts
  agentAttacks             Attacks targeting AI agent tool use
  negativeTests            Legitimate queries (false positive testing)

Security Thresholds:
  Precision Minimum: ${SECURITY_THRESHOLDS.precision}
  Recall Minimum:    ${SECURITY_THRESHOLDS.recall}
  F1 Minimum:        ${SECURITY_THRESHOLDS.f1}
  Specificity Min:   ${SECURITY_THRESHOLDS.specificity}
  Critical Detection: ${SECURITY_THRESHOLDS.criticalDetectionRate}

Examples:
  # Run all security tests with default settings
  node run-security-tests.js

  # Run with JSON output for CI parsing
  node run-security-tests.js --output json --output-file results.json

  # Run with strict threshold for PR gates
  node run-security-tests.js --threshold 0.9 --fail-on-threshold

  # Run specific attack categories
  node run-security-tests.js -c instructionOverride -c jailbreakPhrases

  # Full CI/CD integration with metadata
  node run-security-tests.js --fail-on-threshold --save-results \\
    --run-name "PR #123 Security Check" --git-branch feature/new-feature

Exit Codes:
  0 - All tests passed threshold
  1 - Tests failed threshold or error occurred
`);
}

/**
 * Calculate critical attack detection rate
 *
 * @param {Object} results - Evaluation results
 * @returns {number} Critical attack detection rate (0-1)
 */
function calculateCriticalDetectionRate(results) {
  const criticalResults = results.testCaseResults.filter(
    r => r.expectedSeverity === 'critical'
  );

  if (criticalResults.length === 0) {
    return 1.0; // No critical tests = pass
  }

  const detected = criticalResults.filter(r => r.wasDetected).length;
  return detected / criticalResults.length;
}

/**
 * Calculate high-severity detection rate
 *
 * @param {Object} results - Evaluation results
 * @returns {number} High-severity detection rate (0-1)
 */
function calculateHighSeverityDetectionRate(results) {
  const highSeverityResults = results.testCaseResults.filter(
    r => r.expectedSeverity === 'high' || r.expectedSeverity === 'critical'
  );

  if (highSeverityResults.length === 0) {
    return 1.0;
  }

  const detected = highSeverityResults.filter(r => r.wasDetected).length;
  return detected / highSeverityResults.length;
}

/**
 * Check if results meet security thresholds
 *
 * @param {Object} results - Evaluation results
 * @param {number} threshold - User-specified threshold
 * @returns {Object} Threshold check results
 */
function checkSecurityThresholds(results, threshold) {
  const criticalDetectionRate = calculateCriticalDetectionRate(results);
  const highSeverityDetectionRate = calculateHighSeverityDetectionRate(results);

  const checks = {
    f1: {
      value: results.overall.f1,
      threshold: threshold,
      passed: results.overall.f1 >= threshold,
      message: `F1 Score: ${(results.overall.f1 * 100).toFixed(2)}% (threshold: ${(threshold * 100).toFixed(2)}%)`
    },
    precision: {
      value: results.overall.precision,
      threshold: SECURITY_THRESHOLDS.precision,
      passed: results.overall.precision >= SECURITY_THRESHOLDS.precision,
      message: `Precision: ${(results.overall.precision * 100).toFixed(2)}% (threshold: ${(SECURITY_THRESHOLDS.precision * 100).toFixed(2)}%)`
    },
    recall: {
      value: results.overall.recall,
      threshold: SECURITY_THRESHOLDS.recall,
      passed: results.overall.recall >= SECURITY_THRESHOLDS.recall,
      message: `Recall: ${(results.overall.recall * 100).toFixed(2)}% (threshold: ${(SECURITY_THRESHOLDS.recall * 100).toFixed(2)}%)`
    },
    specificity: {
      value: results.overall.specificity,
      threshold: SECURITY_THRESHOLDS.specificity,
      passed: results.overall.specificity >= SECURITY_THRESHOLDS.specificity,
      message: `Specificity: ${(results.overall.specificity * 100).toFixed(2)}% (threshold: ${(SECURITY_THRESHOLDS.specificity * 100).toFixed(2)}%)`
    },
    criticalDetection: {
      value: criticalDetectionRate,
      threshold: SECURITY_THRESHOLDS.criticalDetectionRate,
      passed: criticalDetectionRate >= SECURITY_THRESHOLDS.criticalDetectionRate,
      message: `Critical Attack Detection: ${(criticalDetectionRate * 100).toFixed(2)}% (threshold: ${(SECURITY_THRESHOLDS.criticalDetectionRate * 100).toFixed(2)}%)`
    },
    highSeverityDetection: {
      value: highSeverityDetectionRate,
      threshold: 0.90,
      passed: highSeverityDetectionRate >= 0.90,
      message: `High Severity Detection: ${(highSeverityDetectionRate * 100).toFixed(2)}% (threshold: 90%)`
    }
  };

  const allPassed = Object.values(checks).every(c => c.passed);
  const failedChecks = Object.entries(checks).filter(([, c]) => !c.passed);

  return {
    passed: allPassed,
    checks,
    failedChecks: failedChecks.map(([name, check]) => ({ name, ...check })),
    summary: {
      totalChecks: Object.keys(checks).length,
      passedChecks: Object.values(checks).filter(c => c.passed).length,
      failedChecks: failedChecks.length
    }
  };
}

/**
 * Run security tests
 *
 * @param {Object} config - Configuration
 * @returns {Object} Security test results
 */
async function runSecurityTests(config) {
  const startTime = Date.now();

  log.info('Starting security test evaluation', {
    dataset: config.datasetPath || 'default',
    threshold: config.threshold,
    includeMultiTurn: config.includeMultiTurn,
    categories: config.categories
  });

  try {
    // Run adversarial evaluation
    const results = adversarialEvaluator.runAdversarialEvaluation({
      datasetPath: config.datasetPath,
      includeMultiTurn: config.includeMultiTurn,
      categories: config.categories
    });

    // Calculate additional metrics
    const criticalDetectionRate = calculateCriticalDetectionRate(results);
    const highSeverityDetectionRate = calculateHighSeverityDetectionRate(results);

    // Check thresholds
    const thresholdResults = checkSecurityThresholds(results, config.threshold);

    // Build final results
    const finalResults = {
      metadata: {
        timestamp: new Date().toISOString(),
        runName: config.runName,
        gitCommit: config.gitCommit,
        gitBranch: config.gitBranch,
        tags: config.tags,
        datasetName: results.metadata.datasetName,
        datasetVersion: results.metadata.datasetVersion,
        totalTestCases: results.metadata.totalTestCases,
        multiTurnSequences: results.metadata.multiTurnSequences,
        categoriesEvaluated: results.metadata.categoriesEvaluated,
        totalLatencyMs: Date.now() - startTime
      },
      overall: {
        accuracy: results.overall.accuracy,
        precision: results.overall.precision,
        recall: results.overall.recall,
        f1: results.overall.f1,
        specificity: results.overall.specificity,
        falsePositiveRate: results.overall.falsePositiveRate,
        falseNegativeRate: results.overall.falseNegativeRate,
        criticalDetectionRate,
        highSeverityDetectionRate,
        counts: results.overall.counts
      },
      thresholds: thresholdResults,
      byCategory: results.byCategory,
      bySeverity: results.bySeverity,
      multiTurn: results.multiTurn,
      failures: results.failures,
      // Include detailed results for verbose mode
      testCaseResults: config.verbose ? results.testCaseResults : undefined,
      multiTurnResults: config.verbose ? results.multiTurnResults : undefined,
      passed: thresholdResults.passed
    };

    log.info('Security test evaluation completed', {
      passed: finalResults.passed,
      f1: finalResults.overall.f1,
      precision: finalResults.overall.precision,
      recall: finalResults.overall.recall,
      falseNegatives: finalResults.failures.falseNegatives?.length || 0
    });

    return finalResults;
  } catch (error) {
    log.error('Security test evaluation failed', { error: error.message });
    throw error;
  }
}

/**
 * Format results as text
 *
 * @param {Object} results - Security test results
 * @returns {string} Formatted text
 */
function formatAsText(results) {
  const lines = [
    '='.repeat(70),
    'SECURITY TEST RESULTS',
    '='.repeat(70),
    '',
    `Timestamp: ${results.metadata.timestamp}`,
    `Dataset: ${results.metadata.datasetName} v${results.metadata.datasetVersion}`,
    `Total Test Cases: ${results.metadata.totalTestCases}`,
    `Multi-Turn Sequences: ${results.metadata.multiTurnSequences}`,
    '',
    '-'.repeat(70),
    'OVERALL METRICS',
    '-'.repeat(70),
    '',
    `Accuracy:               ${(results.overall.accuracy * 100).toFixed(2)}%`,
    `Precision:              ${(results.overall.precision * 100).toFixed(2)}%`,
    `Recall:                 ${(results.overall.recall * 100).toFixed(2)}%`,
    `F1 Score:               ${(results.overall.f1 * 100).toFixed(2)}%`,
    `Specificity:            ${(results.overall.specificity * 100).toFixed(2)}%`,
    `False Positive Rate:    ${(results.overall.falsePositiveRate * 100).toFixed(2)}%`,
    `False Negative Rate:    ${(results.overall.falseNegativeRate * 100).toFixed(2)}%`,
    '',
    `Critical Detection:     ${(results.overall.criticalDetectionRate * 100).toFixed(2)}%`,
    `High Severity Detection: ${(results.overall.highSeverityDetectionRate * 100).toFixed(2)}%`,
    '',
    '-'.repeat(70),
    'CONFUSION MATRIX',
    '-'.repeat(70),
    '',
    `True Positives:  ${results.overall.counts.truePositive} (attacks correctly detected)`,
    `True Negatives:  ${results.overall.counts.trueNegative} (benign correctly allowed)`,
    `False Positives: ${results.overall.counts.falsePositive} (benign incorrectly flagged)`,
    `False Negatives: ${results.overall.counts.falseNegative} (attacks missed - CRITICAL!)`,
    '',
    '-'.repeat(70),
    'THRESHOLD CHECKS',
    '-'.repeat(70),
    ''
  ];

  for (const [name, check] of Object.entries(results.thresholds.checks)) {
    const status = check.passed ? 'PASS' : 'FAIL';
    const indicator = check.passed ? '[✓]' : '[✗]';
    lines.push(`${indicator} ${name}: ${status} - ${check.message}`);
  }

  lines.push('');
  lines.push(`Overall: ${results.thresholds.passed ? 'PASSED' : 'FAILED'} (${results.thresholds.summary.passedChecks}/${results.thresholds.summary.totalChecks} checks passed)`);

  // Add category breakdown
  lines.push('');
  lines.push('-'.repeat(70));
  lines.push('METRICS BY ATTACK CATEGORY');
  lines.push('-'.repeat(70));
  lines.push('');

  for (const [category, metrics] of Object.entries(results.byCategory)) {
    const f1 = (metrics.f1 * 100).toFixed(1);
    const acc = (metrics.accuracy * 100).toFixed(1);
    lines.push(`${category.padEnd(25)} Accuracy: ${acc.padStart(6)}%  F1: ${f1.padStart(6)}%  Total: ${metrics.total}`);
  }

  // Add failures section
  if (results.failures.count > 0) {
    lines.push('');
    lines.push('-'.repeat(70));
    lines.push('FAILURES (Requires Attention)');
    lines.push('-'.repeat(70));
    lines.push('');

    if (results.failures.falseNegatives.length > 0) {
      lines.push('FALSE NEGATIVES (Attacks Not Detected):');
      for (const fn of results.failures.falseNegatives.slice(0, 10)) {
        lines.push(`  [${fn.id}] ${fn.name}`);
        lines.push(`         Category: ${fn.category}, Expected Severity: ${fn.expectedSeverity}`);
      }
      if (results.failures.falseNegatives.length > 10) {
        lines.push(`  ... and ${results.failures.falseNegatives.length - 10} more`);
      }
    }

    if (results.failures.falsePositives.length > 0) {
      lines.push('');
      lines.push('FALSE POSITIVES (Benign Flagged as Attacks):');
      for (const fp of results.failures.falsePositives.slice(0, 10)) {
        lines.push(`  [${fp.id}] ${fp.name}`);
        lines.push(`         Category: ${fp.category}, Detected as: ${fp.detectedSeverity}`);
      }
      if (results.failures.falsePositives.length > 10) {
        lines.push(`  ... and ${results.failures.falsePositives.length - 10} more`);
      }
    }
  }

  lines.push('');
  lines.push('='.repeat(70));
  lines.push(`Evaluation completed in ${results.metadata.totalLatencyMs}ms`);
  lines.push('='.repeat(70));

  return lines.join('\n');
}

/**
 * Format results as markdown
 *
 * @param {Object} results - Security test results
 * @returns {string} Formatted markdown
 */
function formatAsMarkdown(results) {
  const passedEmoji = results.passed ? '✅' : '❌';
  const lines = [
    `# ${passedEmoji} Security Test Results`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Overall Status** | **${results.passed ? 'PASSED' : 'FAILED'}** |`,
    `| Dataset | ${results.metadata.datasetName} v${results.metadata.datasetVersion} |`,
    `| Total Test Cases | ${results.metadata.totalTestCases} |`,
    `| Multi-Turn Sequences | ${results.metadata.multiTurnSequences} |`,
    `| Timestamp | ${results.metadata.timestamp} |`,
    ''
  ];

  if (results.metadata.gitCommit) {
    lines.push(`| Git Commit | \`${results.metadata.gitCommit.substring(0, 8)}\` |`);
  }
  if (results.metadata.gitBranch) {
    lines.push(`| Git Branch | ${results.metadata.gitBranch} |`);
  }

  lines.push('');
  lines.push('## Overall Metrics');
  lines.push('');
  lines.push('| Metric | Value | Status |');
  lines.push('|--------|-------|--------|');
  lines.push(`| **F1 Score** | ${(results.overall.f1 * 100).toFixed(2)}% | ${results.thresholds.checks.f1.passed ? '✅' : '❌'} |`);
  lines.push(`| **Precision** | ${(results.overall.precision * 100).toFixed(2)}% | ${results.thresholds.checks.precision.passed ? '✅' : '❌'} |`);
  lines.push(`| **Recall** | ${(results.overall.recall * 100).toFixed(2)}% | ${results.thresholds.checks.recall.passed ? '✅' : '❌'} |`);
  lines.push(`| **Specificity** | ${(results.overall.specificity * 100).toFixed(2)}% | ${results.thresholds.checks.specificity.passed ? '✅' : '❌'} |`);
  lines.push(`| Critical Detection | ${(results.overall.criticalDetectionRate * 100).toFixed(2)}% | ${results.thresholds.checks.criticalDetection.passed ? '✅' : '❌'} |`);
  lines.push(`| High Severity Detection | ${(results.overall.highSeverityDetectionRate * 100).toFixed(2)}% | ${results.thresholds.checks.highSeverityDetection.passed ? '✅' : '❌'} |`);
  lines.push('');

  lines.push('### Confusion Matrix');
  lines.push('');
  lines.push('|  | Predicted Attack | Predicted Benign |');
  lines.push('|--|------------------|------------------|');
  lines.push(`| **Actual Attack** | ${results.overall.counts.truePositive} (TP) | ${results.overall.counts.falseNegative} (FN) |`);
  lines.push(`| **Actual Benign** | ${results.overall.counts.falsePositive} (FP) | ${results.overall.counts.trueNegative} (TN) |`);
  lines.push('');

  // Threshold checks
  lines.push('## Threshold Checks');
  lines.push('');
  lines.push(`**Result:** ${results.thresholds.summary.passedChecks}/${results.thresholds.summary.totalChecks} checks passed`);
  lines.push('');

  if (results.thresholds.failedChecks.length > 0) {
    lines.push('### Failed Checks');
    lines.push('');
    for (const check of results.thresholds.failedChecks) {
      lines.push(`- ❌ **${check.name}:** ${check.message}`);
    }
    lines.push('');
  }

  // Category breakdown
  lines.push('## Metrics by Attack Category');
  lines.push('');
  lines.push('| Category | Accuracy | Precision | Recall | F1 | Total |');
  lines.push('|----------|----------|-----------|--------|-----|-------|');

  for (const [category, metrics] of Object.entries(results.byCategory)) {
    lines.push(`| ${category} | ${(metrics.accuracy * 100).toFixed(1)}% | ${(metrics.precision * 100).toFixed(1)}% | ${(metrics.recall * 100).toFixed(1)}% | ${(metrics.f1 * 100).toFixed(1)}% | ${metrics.total} |`);
  }

  // Failures
  if (results.failures.count > 0) {
    lines.push('');
    lines.push('## Failures');
    lines.push('');
    lines.push(`⚠️ **${results.failures.count} test cases failed**`);
    lines.push('');

    if (results.failures.falseNegatives.length > 0) {
      lines.push('### False Negatives (Attacks Not Detected)');
      lines.push('');
      lines.push('These attacks were not detected and represent security vulnerabilities:');
      lines.push('');
      lines.push('| ID | Name | Category | Expected Severity |');
      lines.push('|----|------|----------|-------------------|');
      for (const fn of results.failures.falseNegatives) {
        lines.push(`| ${fn.id} | ${fn.name} | ${fn.category} | ${fn.expectedSeverity} |`);
      }
      lines.push('');
    }

    if (results.failures.falsePositives.length > 0) {
      lines.push('### False Positives (Benign Flagged as Attacks)');
      lines.push('');
      lines.push('These legitimate queries were incorrectly flagged:');
      lines.push('');
      lines.push('| ID | Name | Category | Detected Severity |');
      lines.push('|----|------|----------|-------------------|');
      for (const fp of results.failures.falsePositives) {
        lines.push(`| ${fp.id} | ${fp.name} | ${fp.category} | ${fp.detectedSeverity} |`);
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(`*Security tests completed in ${results.metadata.totalLatencyMs}ms*`);

  return lines.join('\n');
}

/**
 * Format results based on output format
 *
 * @param {Object} results - Security test results
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

  try {
    // Run security tests
    const results = await runSecurityTests(config);

    // Format output
    const output = formatResults(results, config.output);

    // Write output
    if (config.outputFile) {
      fs.writeFileSync(config.outputFile, output);
      console.log(`Results written to: ${config.outputFile}`);
    } else {
      console.log(output);
    }

    // Save results if requested
    if (config.saveResults) {
      const resultsPath = config.outputFile
        ? config.outputFile.replace(/\.\w+$/, '-full.json')
        : `security-results-${Date.now()}.json`;
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
      console.log(`Full results saved to: ${resultsPath}`);
    }

    // Exit with appropriate code
    if (config.failOnThreshold && !results.passed) {
      log.warn('Security tests failed threshold check', {
        f1: results.overall.f1,
        threshold: config.threshold,
        failedChecks: results.thresholds.failedChecks.length
      });
      console.error('\n⛔ Security tests FAILED threshold requirements');
      process.exit(1);
    }

    if (results.passed) {
      console.log('\n✅ Security tests PASSED');
    }

    process.exit(0);
  } catch (error) {
    log.error('Security tests failed', { error: error.message });
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Export for testing
module.exports = {
  parseArgs,
  runSecurityTests,
  checkSecurityThresholds,
  calculateCriticalDetectionRate,
  calculateHighSeverityDetectionRate,
  formatResults,
  formatAsText,
  formatAsMarkdown,
  OUTPUT_FORMATS,
  DEFAULT_CONFIG,
  SECURITY_THRESHOLDS
};

// Run if executed directly
if (require.main === module) {
  main();
}
