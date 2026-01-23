/**
 * Adversarial Test Evaluator
 *
 * Evaluates prompt injection detection against the adversarial test dataset.
 * Tests both single-message and multi-turn attack detection capabilities.
 *
 * Features:
 * - Evaluates detection accuracy (true positives, true negatives)
 * - Measures false positive and false negative rates
 * - Tests multi-turn attack detection
 * - Generates detailed reports by attack category
 * - Provides precision, recall, and F1 scores for security detection
 *
 * Reference: OWASP LLM01:2025, FlipAttack research, PromptScreen architecture
 * @see https://genai.owasp.org/llmrisk/llm01-prompt-injection/
 * @see https://arxiv.org/abs/2512.19011
 *
 * Feature: F5.3.1 - Adversarial Test Dataset
 */

const fs = require('fs');
const path = require('path');

// Import prompt injection service
let PromptInjectionService, getPromptInjectionService, resetPromptInjectionService, SEVERITY;
try {
  const pis = require('../services/prompt-injection-service');
  PromptInjectionService = pis.PromptInjectionService;
  getPromptInjectionService = pis.getPromptInjectionService;
  resetPromptInjectionService = pis.resetPromptInjectionService;
  SEVERITY = pis.SEVERITY;
} catch {
  // Will be handled when service is needed
}

/**
 * Severity order for comparison
 */
const SEVERITY_ORDER = ['none', 'low', 'medium', 'high', 'critical'];

/**
 * Default path to adversarial test dataset
 */
const DEFAULT_DATASET_PATH = path.join(__dirname, 'datasets', 'adversarial_tests.json');

/**
 * Load adversarial test dataset
 *
 * @param {string} datasetPath - Path to dataset file
 * @returns {Object} Loaded dataset
 */
function loadAdversarialDataset(datasetPath = DEFAULT_DATASET_PATH) {
  const absolutePath = path.isAbsolute(datasetPath)
    ? datasetPath
    : path.join(process.cwd(), datasetPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Adversarial dataset not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Compare severity levels
 *
 * @param {string} a - First severity
 * @param {string} b - Second severity
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
function compareSeverity(a, b) {
  const indexA = SEVERITY_ORDER.indexOf(a?.toLowerCase() || 'none');
  const indexB = SEVERITY_ORDER.indexOf(b?.toLowerCase() || 'none');
  return indexA - indexB;
}

/**
 * Check if detected severity meets or exceeds expected severity
 *
 * @param {string} detected - Detected severity
 * @param {string} expected - Expected minimum severity
 * @returns {boolean} True if detected meets or exceeds expected
 */
function severityMeetsExpected(detected, expected) {
  return compareSeverity(detected, expected) >= 0;
}

/**
 * Check if detected categories include expected categories
 *
 * @param {string[]} detected - Detected categories
 * @param {string[]} expected - Expected categories
 * @returns {boolean} True if at least one expected category is detected
 */
function categoriesMatch(detected, expected) {
  if (!expected || expected.length === 0) {
    return true; // No specific categories expected
  }
  if (!detected || detected.length === 0) {
    return false;
  }
  return expected.some(exp => detected.includes(exp));
}

/**
 * Evaluate a single test case
 *
 * @param {Object} testCase - Test case from dataset
 * @param {Object} service - Prompt injection service instance
 * @returns {Object} Evaluation result
 */
function evaluateTestCase(testCase, service) {
  const startTime = Date.now();

  // Analyze the input text
  const result = service.analyzeText(testCase.input);

  // Determine if detection was correct
  const wasDetected = result.isRisky;
  const expectedDetection = testCase.expectedDetection;

  // Calculate result type
  let resultType;
  if (expectedDetection && wasDetected) {
    resultType = 'truePositive';
  } else if (!expectedDetection && !wasDetected) {
    resultType = 'trueNegative';
  } else if (!expectedDetection && wasDetected) {
    resultType = 'falsePositive';
  } else {
    resultType = 'falseNegative';
  }

  // Check severity match (for true positives)
  const severityMatch = testCase.expectedSeverity
    ? severityMeetsExpected(result.severity, testCase.expectedSeverity)
    : true;

  // Check category match (for true positives)
  const detectedCategories = result.detections?.map(d => d.category) || [];
  const categoryMatch = testCase.expectedCategories
    ? categoriesMatch(detectedCategories, testCase.expectedCategories)
    : true;

  return {
    testId: testCase.id,
    testName: testCase.name,
    category: testCase.category,
    resultType,
    wasDetected,
    expectedDetection,
    detectedSeverity: result.severity,
    expectedSeverity: testCase.expectedSeverity || 'none',
    severityMatch,
    detectedCategories,
    expectedCategories: testCase.expectedCategories || [],
    categoryMatch,
    heuristicScore: result.heuristicScore,
    detectionCount: result.detectionCount,
    latencyMs: Date.now() - startTime,
    passed: resultType === 'truePositive' || resultType === 'trueNegative'
  };
}

/**
 * Evaluate a multi-turn conversation sequence
 *
 * @param {Object} sequence - Multi-turn sequence from dataset
 * @param {Object} service - Prompt injection service instance
 * @returns {Object} Evaluation result
 */
function evaluateMultiTurnSequence(sequence, service) {
  const startTime = Date.now();

  // Prepare messages for analysis
  const messages = sequence.messages.map(m => ({
    role: m.role,
    content: m.content
  }));

  // Analyze full conversation
  const result = service.analyzeMessages(messages);

  // Check cross-message detection
  const crossMessageDetected = result.detections?.some(d => d.category === 'cross_message');

  // Evaluate individual messages
  const messageResults = sequence.messages
    .filter(m => m.role === 'user')
    .map((m, index) => {
      const individualResult = service.analyzeText(m.content);
      return {
        messageIndex: index,
        content: m.content.substring(0, 50) + '...',
        expectedDetection: m.expectedDetection,
        wasDetected: individualResult.isRisky,
        severity: individualResult.severity,
        expectedSeverity: m.expectedSeverity || 'none'
      };
    });

  // Determine overall result type
  const expectedCrossMessage = sequence.expectedCrossMessageDetection;
  let resultType;
  if (expectedCrossMessage && crossMessageDetected) {
    resultType = 'truePositive';
  } else if (!expectedCrossMessage && !crossMessageDetected) {
    resultType = 'trueNegative';
  } else if (!expectedCrossMessage && crossMessageDetected) {
    resultType = 'falsePositive';
  } else {
    resultType = 'falseNegative';
  }

  return {
    sequenceId: sequence.id,
    sequenceName: sequence.name,
    description: sequence.description,
    resultType,
    crossMessageDetected,
    expectedCrossMessageDetection: expectedCrossMessage,
    overallSeverity: result.severity,
    expectedSeverity: sequence.expectedCrossMessageSeverity || 'none',
    messageResults,
    totalDetections: result.detectionCount,
    latencyMs: Date.now() - startTime,
    passed: resultType === 'truePositive' || resultType === 'trueNegative'
  };
}

/**
 * Calculate aggregate metrics from evaluation results
 *
 * @param {Object[]} results - Array of test case results
 * @returns {Object} Aggregate metrics
 */
function calculateMetrics(results) {
  const counts = {
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0
  };

  for (const result of results) {
    counts[result.resultType]++;
  }

  const total = results.length;
  const correct = counts.truePositive + counts.trueNegative;
  const incorrect = counts.falsePositive + counts.falseNegative;

  // Calculate standard metrics
  const accuracy = total > 0 ? correct / total : 0;

  // Precision: of all detected as attacks, how many were actual attacks
  const precision = (counts.truePositive + counts.falsePositive) > 0
    ? counts.truePositive / (counts.truePositive + counts.falsePositive)
    : 0;

  // Recall: of all actual attacks, how many were detected
  const recall = (counts.truePositive + counts.falseNegative) > 0
    ? counts.truePositive / (counts.truePositive + counts.falseNegative)
    : 0;

  // F1 Score
  const f1 = (precision + recall) > 0
    ? 2 * (precision * recall) / (precision + recall)
    : 0;

  // Specificity: of all benign inputs, how many were correctly identified
  const specificity = (counts.trueNegative + counts.falsePositive) > 0
    ? counts.trueNegative / (counts.trueNegative + counts.falsePositive)
    : 0;

  // False Positive Rate
  const falsePositiveRate = (counts.falsePositive + counts.trueNegative) > 0
    ? counts.falsePositive / (counts.falsePositive + counts.trueNegative)
    : 0;

  // False Negative Rate
  const falseNegativeRate = (counts.truePositive + counts.falseNegative) > 0
    ? counts.falseNegative / (counts.truePositive + counts.falseNegative)
    : 0;

  return {
    total,
    correct,
    incorrect,
    accuracy,
    precision,
    recall,
    f1,
    specificity,
    falsePositiveRate,
    falseNegativeRate,
    counts
  };
}

/**
 * Calculate per-category metrics
 *
 * @param {Object[]} results - Array of test case results
 * @returns {Object} Metrics by category
 */
function calculatePerCategoryMetrics(results) {
  const byCategory = {};

  for (const result of results) {
    const category = result.category;
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(result);
  }

  const categoryMetrics = {};
  for (const [category, categoryResults] of Object.entries(byCategory)) {
    categoryMetrics[category] = calculateMetrics(categoryResults);
  }

  return categoryMetrics;
}

/**
 * Calculate per-severity metrics
 *
 * @param {Object[]} results - Array of test case results
 * @returns {Object} Metrics by expected severity
 */
function calculatePerSeverityMetrics(results) {
  const bySeverity = {};

  for (const result of results) {
    const severity = result.expectedSeverity || 'none';
    if (!bySeverity[severity]) {
      bySeverity[severity] = [];
    }
    bySeverity[severity].push(result);
  }

  const severityMetrics = {};
  for (const [severity, severityResults] of Object.entries(bySeverity)) {
    severityMetrics[severity] = calculateMetrics(severityResults);
  }

  return severityMetrics;
}

/**
 * Run full adversarial evaluation
 *
 * @param {Object} options - Evaluation options
 * @param {string} options.datasetPath - Path to adversarial dataset
 * @param {Object} options.serviceConfig - Configuration for prompt injection service
 * @param {boolean} options.includeMultiTurn - Whether to evaluate multi-turn sequences
 * @param {string[]} options.categories - Filter by specific categories (optional)
 * @returns {Object} Full evaluation results
 */
function runAdversarialEvaluation(options = {}) {
  const {
    datasetPath = DEFAULT_DATASET_PATH,
    serviceConfig = {},
    includeMultiTurn = true,
    categories = null
  } = options;

  const startTime = Date.now();

  // Load dataset
  const dataset = loadAdversarialDataset(datasetPath);

  // Initialize service (reset to ensure clean state)
  if (resetPromptInjectionService) {
    resetPromptInjectionService();
  }

  if (!getPromptInjectionService) {
    throw new Error('Prompt injection service not available');
  }

  const service = getPromptInjectionService(serviceConfig);

  // Filter test cases if categories specified
  let testCases = dataset.testCases;
  if (categories && categories.length > 0) {
    testCases = testCases.filter(tc => categories.includes(tc.category));
  }

  // Evaluate single-message test cases
  const testCaseResults = testCases.map(tc => evaluateTestCase(tc, service));

  // Evaluate multi-turn sequences if requested
  let multiTurnResults = [];
  if (includeMultiTurn && dataset.multiTurnSequences) {
    multiTurnResults = dataset.multiTurnSequences.map(seq =>
      evaluateMultiTurnSequence(seq, service)
    );
  }

  // Calculate aggregate metrics
  const overallMetrics = calculateMetrics(testCaseResults);
  const categoryMetrics = calculatePerCategoryMetrics(testCaseResults);
  const severityMetrics = calculatePerSeverityMetrics(testCaseResults);

  // Calculate multi-turn metrics
  const multiTurnMetrics = multiTurnResults.length > 0
    ? calculateMetrics(multiTurnResults)
    : null;

  // Identify failures for debugging
  const failures = testCaseResults.filter(r => !r.passed);
  const falsePositives = testCaseResults.filter(r => r.resultType === 'falsePositive');
  const falseNegatives = testCaseResults.filter(r => r.resultType === 'falseNegative');

  // Get service stats
  const serviceStats = service.getStats();

  return {
    metadata: {
      timestamp: new Date().toISOString(),
      datasetName: dataset.metadata.name,
      datasetVersion: dataset.metadata.version,
      totalTestCases: testCases.length,
      multiTurnSequences: multiTurnResults.length,
      categoriesEvaluated: [...new Set(testCases.map(tc => tc.category))],
      latencyMs: Date.now() - startTime
    },
    overall: overallMetrics,
    byCategory: categoryMetrics,
    bySeverity: severityMetrics,
    multiTurn: multiTurnMetrics,
    testCaseResults,
    multiTurnResults,
    failures: {
      count: failures.length,
      falsePositives: falsePositives.map(r => ({
        id: r.testId,
        name: r.testName,
        category: r.category,
        detectedSeverity: r.detectedSeverity,
        detectedCategories: r.detectedCategories
      })),
      falseNegatives: falseNegatives.map(r => ({
        id: r.testId,
        name: r.testName,
        category: r.category,
        expectedSeverity: r.expectedSeverity,
        expectedCategories: r.expectedCategories
      }))
    },
    serviceStats
  };
}

/**
 * Generate a summary report from evaluation results
 *
 * @param {Object} results - Evaluation results from runAdversarialEvaluation
 * @returns {string} Formatted summary report
 */
function generateSummaryReport(results) {
  const lines = [
    '='.repeat(70),
    'ADVERSARIAL SECURITY TEST EVALUATION REPORT',
    '='.repeat(70),
    '',
    `Dataset: ${results.metadata.datasetName} v${results.metadata.datasetVersion}`,
    `Timestamp: ${results.metadata.timestamp}`,
    `Total Test Cases: ${results.metadata.totalTestCases}`,
    `Multi-Turn Sequences: ${results.metadata.multiTurnSequences}`,
    '',
    '-'.repeat(70),
    'OVERALL METRICS',
    '-'.repeat(70),
    '',
    `Accuracy:           ${(results.overall.accuracy * 100).toFixed(2)}%`,
    `Precision:          ${(results.overall.precision * 100).toFixed(2)}%`,
    `Recall:             ${(results.overall.recall * 100).toFixed(2)}%`,
    `F1 Score:           ${(results.overall.f1 * 100).toFixed(2)}%`,
    `Specificity:        ${(results.overall.specificity * 100).toFixed(2)}%`,
    '',
    `True Positives:     ${results.overall.counts.truePositive}`,
    `True Negatives:     ${results.overall.counts.trueNegative}`,
    `False Positives:    ${results.overall.counts.falsePositive}`,
    `False Negatives:    ${results.overall.counts.falseNegative}`,
    '',
    '-'.repeat(70),
    'METRICS BY CATEGORY',
    '-'.repeat(70),
    ''
  ];

  for (const [category, metrics] of Object.entries(results.byCategory)) {
    lines.push(`${category}:`);
    lines.push(`  Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%, F1: ${(metrics.f1 * 100).toFixed(1)}%, Total: ${metrics.total}`);
  }

  lines.push('');
  lines.push('-'.repeat(70));
  lines.push('METRICS BY SEVERITY');
  lines.push('-'.repeat(70));
  lines.push('');

  for (const severity of SEVERITY_ORDER) {
    if (results.bySeverity[severity]) {
      const metrics = results.bySeverity[severity];
      lines.push(`${severity.toUpperCase()}:`);
      lines.push(`  Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%, Total: ${metrics.total}`);
    }
  }

  if (results.multiTurn) {
    lines.push('');
    lines.push('-'.repeat(70));
    lines.push('MULTI-TURN DETECTION');
    lines.push('-'.repeat(70));
    lines.push('');
    lines.push(`Accuracy:       ${(results.multiTurn.accuracy * 100).toFixed(2)}%`);
    lines.push(`F1 Score:       ${(results.multiTurn.f1 * 100).toFixed(2)}%`);
  }

  if (results.failures.count > 0) {
    lines.push('');
    lines.push('-'.repeat(70));
    lines.push('FAILURES');
    lines.push('-'.repeat(70));
    lines.push('');
    lines.push(`Total Failures: ${results.failures.count}`);

    if (results.failures.falsePositives.length > 0) {
      lines.push('');
      lines.push('False Positives (legitimate queries flagged as attacks):');
      for (const fp of results.failures.falsePositives.slice(0, 5)) {
        lines.push(`  - [${fp.id}] ${fp.name} (detected: ${fp.detectedSeverity})`);
      }
      if (results.failures.falsePositives.length > 5) {
        lines.push(`  ... and ${results.failures.falsePositives.length - 5} more`);
      }
    }

    if (results.failures.falseNegatives.length > 0) {
      lines.push('');
      lines.push('False Negatives (attacks not detected):');
      for (const fn of results.failures.falseNegatives.slice(0, 5)) {
        lines.push(`  - [${fn.id}] ${fn.name} (expected: ${fn.expectedSeverity})`);
      }
      if (results.failures.falseNegatives.length > 5) {
        lines.push(`  ... and ${results.failures.falseNegatives.length - 5} more`);
      }
    }
  }

  lines.push('');
  lines.push('='.repeat(70));
  lines.push(`Evaluation completed in ${results.metadata.latencyMs}ms`);
  lines.push('='.repeat(70));

  return lines.join('\n');
}

/**
 * Generate markdown report from evaluation results
 *
 * @param {Object} results - Evaluation results
 * @returns {string} Markdown formatted report
 */
function generateMarkdownReport(results) {
  const lines = [
    '# Adversarial Security Test Evaluation Report',
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Dataset | ${results.metadata.datasetName} v${results.metadata.datasetVersion} |`,
    `| Timestamp | ${results.metadata.timestamp} |`,
    `| Total Test Cases | ${results.metadata.totalTestCases} |`,
    `| Multi-Turn Sequences | ${results.metadata.multiTurnSequences} |`,
    '',
    '## Overall Metrics',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| **Accuracy** | ${(results.overall.accuracy * 100).toFixed(2)}% |`,
    `| **Precision** | ${(results.overall.precision * 100).toFixed(2)}% |`,
    `| **Recall** | ${(results.overall.recall * 100).toFixed(2)}% |`,
    `| **F1 Score** | ${(results.overall.f1 * 100).toFixed(2)}% |`,
    `| Specificity | ${(results.overall.specificity * 100).toFixed(2)}% |`,
    `| False Positive Rate | ${(results.overall.falsePositiveRate * 100).toFixed(2)}% |`,
    `| False Negative Rate | ${(results.overall.falseNegativeRate * 100).toFixed(2)}% |`,
    '',
    '### Confusion Matrix',
    '',
    '|  | Predicted Attack | Predicted Benign |',
    '|--|------------------|------------------|',
    `| **Actual Attack** | ${results.overall.counts.truePositive} (TP) | ${results.overall.counts.falseNegative} (FN) |`,
    `| **Actual Benign** | ${results.overall.counts.falsePositive} (FP) | ${results.overall.counts.trueNegative} (TN) |`,
    '',
    '## Metrics by Category',
    '',
    '| Category | Accuracy | Precision | Recall | F1 | Total |',
    '|----------|----------|-----------|--------|-----|-------|'
  ];

  for (const [category, metrics] of Object.entries(results.byCategory)) {
    lines.push(`| ${category} | ${(metrics.accuracy * 100).toFixed(1)}% | ${(metrics.precision * 100).toFixed(1)}% | ${(metrics.recall * 100).toFixed(1)}% | ${(metrics.f1 * 100).toFixed(1)}% | ${metrics.total} |`);
  }

  lines.push('');
  lines.push('## Metrics by Severity');
  lines.push('');
  lines.push('| Severity | Accuracy | Total |');
  lines.push('|----------|----------|-------|');

  for (const severity of SEVERITY_ORDER) {
    if (results.bySeverity[severity]) {
      const metrics = results.bySeverity[severity];
      lines.push(`| ${severity} | ${(metrics.accuracy * 100).toFixed(1)}% | ${metrics.total} |`);
    }
  }

  if (results.failures.count > 0) {
    lines.push('');
    lines.push('## Failures');
    lines.push('');
    lines.push(`Total: ${results.failures.count} test cases failed`);
    lines.push('');

    if (results.failures.falseNegatives.length > 0) {
      lines.push('### False Negatives (Missed Attacks)');
      lines.push('');
      lines.push('| ID | Name | Category | Expected Severity |');
      lines.push('|----|------|----------|-------------------|');
      for (const fn of results.failures.falseNegatives) {
        lines.push(`| ${fn.id} | ${fn.name} | ${fn.category} | ${fn.expectedSeverity} |`);
      }
      lines.push('');
    }

    if (results.failures.falsePositives.length > 0) {
      lines.push('### False Positives (Benign Flagged)');
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
  lines.push(`*Report generated in ${results.metadata.latencyMs}ms*`);

  return lines.join('\n');
}

module.exports = {
  loadAdversarialDataset,
  evaluateTestCase,
  evaluateMultiTurnSequence,
  runAdversarialEvaluation,
  calculateMetrics,
  calculatePerCategoryMetrics,
  calculatePerSeverityMetrics,
  generateSummaryReport,
  generateMarkdownReport,
  compareSeverity,
  severityMeetsExpected,
  categoriesMatch,
  DEFAULT_DATASET_PATH,
  SEVERITY_ORDER
};
