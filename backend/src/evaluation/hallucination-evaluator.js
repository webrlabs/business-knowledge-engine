/**
 * Hallucination Evaluator
 *
 * Provides a simplified interface for evaluating hallucination resistance
 * in system responses. Wraps the negative-test-evaluator with an interface
 * focused on detecting when the system correctly refuses to answer
 * unanswerable questions vs. hallucinating responses.
 *
 * @module evaluation/hallucination-evaluator
 */

const {
  evaluateTestCase,
  evaluateBatch,
  checkRefusalPatterns,
  checkHallucinationPatterns,
  ResponseType,
  DEFAULT_REFUSAL_PHRASES,
} = require('./negative-test-evaluator');

/**
 * Additional refusal phrases for the hallucination evaluator
 */
const ADDITIONAL_REFUSAL_PHRASES = [
  'out of scope',
  'outside scope',
  'for this assistant',
  'beyond my knowledge',
  'beyond my scope',
  'not in my knowledge',
  'do not know',
  'don\'t know',
  'i am sorry',
  'i\'m sorry',
  'apologize',
  'not certain',
  'not sure',
  'uncertain',
  'no knowledge',
  'lack of information',
];

/**
 * Expected outcome types for negative test cases
 */
const Outcome = {
  NOT_FOUND: 'not_found',
  INSUFFICIENT_INFO: 'insufficient_info',
  OUT_OF_SCOPE: 'out_of_scope',
  REFUSAL: 'refusal',
};

/**
 * Map outcomes to categories for the negative-test-evaluator
 */
const OUTCOME_TO_CATEGORY = {
  [Outcome.NOT_FOUND]: 'nonexistent_entity',
  [Outcome.INSUFFICIENT_INFO]: 'temporal_gap',
  [Outcome.OUT_OF_SCOPE]: 'out_of_scope',
  [Outcome.REFUSAL]: 'counterfactual',
};

/**
 * Evaluate a single negative test case for hallucination
 *
 * @param {Object} testCase - The test case
 * @param {string} testCase.id - Test case ID
 * @param {string} testCase.question - The question asked
 * @param {string} testCase.expectedOutcome - Expected outcome (from Outcome enum)
 * @param {string} [testCase.context] - Optional context
 * @param {string} answer - The system's response
 * @param {Object} [options] - Evaluation options
 * @returns {Promise<Object>} Evaluation result
 */
async function evaluateNegativeTestCase(testCase, answer, options = {}) {
  // Check for refusal patterns using heuristics with additional phrases
  const refusalCheck = checkRefusalPatterns(answer, ADDITIONAL_REFUSAL_PHRASES);
  const hallucinationCheck = checkHallucinationPatterns(answer, []);

  // Determine if the response correctly refuses to answer
  const detectedNegative = refusalCheck.hasRefusal;
  const hasHallucination = hallucinationCheck.hasHallucination;

  // A test passes if:
  // 1. The system detected it should refuse (detectedNegative is true)
  // 2. The system did not hallucinate specific claims
  const passed = detectedNegative && !hasHallucination;

  return {
    testCaseId: testCase.id,
    question: testCase.question,
    expectedOutcome: testCase.expectedOutcome,
    answer,
    passed,
    detectedNegative,
    hasHallucination,
    refusalPhrases: refusalCheck.matchedPhrases,
    hallucinationPatterns: hallucinationCheck.matchedPatterns || [],
    confidence: detectedNegative ? 0.9 : 0.3,
  };
}

/**
 * Evaluate a batch of test cases for hallucination
 *
 * @param {Object[]} testCases - Array of test cases
 * @param {string[]} answers - Array of system responses (same order as testCases)
 * @param {Object} [options] - Evaluation options
 * @returns {Promise<Object>} Batch evaluation results with aggregate stats
 */
async function evaluateBatchHallucination(testCases, answers, options = {}) {
  if (testCases.length !== answers.length) {
    throw new Error('testCases and answers arrays must have the same length');
  }

  const results = [];
  for (let i = 0; i < testCases.length; i++) {
    const result = await evaluateNegativeTestCase(testCases[i], answers[i], options);
    results.push(result);
  }

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.length - passedCount;
  const hallucinationCount = results.filter(r => r.hasHallucination).length;

  return {
    results,
    aggregate: {
      totalCount: results.length,
      passedCount,
      failedCount,
      hallucinationCount,
      passRate: results.length > 0 ? passedCount / results.length : 0,
      hallucinationRate: results.length > 0 ? hallucinationCount / results.length : 0,
    },
  };
}

/**
 * Format evaluation result as human-readable text
 *
 * @param {Object} result - Single evaluation result
 * @returns {string} Formatted text
 */
function formatEvaluationResult(result) {
  const status = result.passed ? 'PASS' : 'FAIL';
  const lines = [
    `[${status}] Test Case: ${result.testCaseId}`,
    `  Question: ${result.question}`,
    `  Expected: ${result.expectedOutcome}`,
    `  Detected Negative: ${result.detectedNegative}`,
    `  Has Hallucination: ${result.hasHallucination}`,
  ];

  if (result.refusalPhrases.length > 0) {
    lines.push(`  Refusal Phrases: ${result.refusalPhrases.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Format batch results as a report
 *
 * @param {Object} batchResult - Batch evaluation result
 * @param {string} [format='text'] - Output format ('text' or 'markdown')
 * @returns {string} Formatted report
 */
function formatBatchReport(batchResult, format = 'text') {
  const { aggregate, results } = batchResult;

  if (format === 'markdown') {
    const lines = [
      '# Hallucination Evaluation Report',
      '',
      '## Summary',
      `- **Total Tests:** ${aggregate.totalCount}`,
      `- **Passed:** ${aggregate.passedCount}`,
      `- **Failed:** ${aggregate.failedCount}`,
      `- **Pass Rate:** ${(aggregate.passRate * 100).toFixed(1)}%`,
      `- **Hallucination Rate:** ${(aggregate.hallucinationRate * 100).toFixed(1)}%`,
      '',
      '## Results',
      '',
      '| ID | Status | Detected Negative | Hallucination |',
      '|----|--------|-------------------|---------------|',
    ];

    for (const r of results) {
      const status = r.passed ? 'PASS' : 'FAIL';
      lines.push(`| ${r.testCaseId} | ${status} | ${r.detectedNegative} | ${r.hasHallucination} |`);
    }

    return lines.join('\n');
  }

  // Text format
  const lines = [
    '=== Hallucination Evaluation Report ===',
    '',
    `Total Tests: ${aggregate.totalCount}`,
    `Passed: ${aggregate.passedCount}`,
    `Failed: ${aggregate.failedCount}`,
    `Pass Rate: ${(aggregate.passRate * 100).toFixed(1)}%`,
    `Hallucination Rate: ${(aggregate.hallucinationRate * 100).toFixed(1)}%`,
    '',
    '--- Individual Results ---',
    '',
  ];

  for (const r of results) {
    lines.push(formatEvaluationResult(r));
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  // Core functions
  evaluateNegativeTestCase,
  evaluateBatchHallucination,

  // Formatting
  formatEvaluationResult,
  formatBatchReport,

  // Constants
  Outcome,
  ResponseType,
};
