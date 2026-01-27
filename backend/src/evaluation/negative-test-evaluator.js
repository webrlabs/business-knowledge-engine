/**
 * Negative Test Evaluator
 *
 * Evaluates system responses to questions that should result in
 * "insufficient information" or "not found" responses.
 * Tests hallucination resistance by checking if the system correctly
 * refuses to answer questions about nonexistent entities, fictional
 * scenarios, or out-of-scope topics.
 *
 * Feature: F1.1.4 - Negative Test Cases
 *
 * @see https://arxiv.org/abs/2311.05232 - HaluEval benchmark
 * @see https://huggingface.co/datasets/truthfulqa - TruthfulQA dataset
 */

const { createOpenAIClient, getOpenAIConfig } = require('../clients/openai');
const { log } = require('../utils/logger');

/**
 * Response classification types
 */
const ResponseType = {
  CORRECT_REFUSAL: 'correct_refusal',
  QUALIFIED_RESPONSE: 'qualified_response',
  HALLUCINATION: 'hallucination',
  ERROR: 'error'
};

/**
 * Default acceptable refusal phrases
 */
const DEFAULT_REFUSAL_PHRASES = [
  'insufficient information',
  'not found',
  'no information available',
  'cannot find',
  'does not exist',
  'outside scope',
  'not documented',
  'not available',
  'no records',
  'unable to determine',
  'no such',
  'not applicable',
  'cannot provide',
  'hypothetical',
  'did not occur',
  'no evidence',
  'don\'t have information',
  'do not have information',
  'i don\'t have',
  'i do not have',
  'no data',
  'not in the knowledge base',
  'not in my knowledge',
  'cannot answer',
  'unable to answer'
];

/**
 * Build prompt for LLM-based response classification
 *
 * @param {string} question - The original question
 * @param {string} response - The system response to classify
 * @param {string} reason - Why this is a negative test case
 * @returns {string} The classification prompt
 */
function buildClassificationPrompt(question, response, reason) {
  return `You are evaluating an AI system's response to a question that should NOT be answerable from the knowledge base.

## Context
The question asks about something that does not exist, is fictional, or is outside the scope of the knowledge base.
Reason this is a negative test: ${reason}

## Question Asked
${question}

## System Response
${response}

## Your Task
Classify the response into one of these categories:

1. "correct_refusal" - The system clearly states it cannot answer, lacks information, or the topic is not found/outside scope.
   Examples: "I don't have information about that", "No records found", "That is outside the scope of available documentation"

2. "qualified_response" - The system partially refuses but may provide some hedged or speculative content.
   Examples: "I cannot find specific information, but generally...", "While I don't have documentation on this, typically..."

3. "hallucination" - The system confidently provides specific information as if it were factual, without admitting uncertainty.
   Examples: Providing specific details, procedures, names, or facts that appear fabricated.

## Response Format
Respond with a JSON object only (no markdown):
{
  "classification": "correct_refusal|qualified_response|hallucination",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this classification was chosen",
  "hallucinated_claims": ["List any specific claims that appear fabricated (empty if none)"]
}`;
}

/**
 * Parse JSON response from LLM
 *
 * @param {string} text - Raw LLM response
 * @returns {Object|null} Parsed JSON or null
 */
function parseJsonResponse(text) {
  try {
    let clean = text.trim();
    // Remove markdown code blocks
    if (clean.startsWith('```json')) clean = clean.slice(7);
    if (clean.startsWith('```')) clean = clean.slice(3);
    if (clean.endsWith('```')) clean = clean.slice(0, -3);
    clean = clean.trim();
    return JSON.parse(clean);
  } catch (e) {
    log.warn('Failed to parse classification response', { error: e.message });
    return null;
  }
}

/**
 * Check if response contains refusal phrases using pattern matching
 *
 * @param {string} response - The system response
 * @param {string[]} acceptableResponses - Custom acceptable response phrases
 * @returns {Object} Pattern matching result
 */
function checkRefusalPatterns(response, acceptableResponses = []) {
  const lowerResponse = response.toLowerCase();
  const allPhrases = [...DEFAULT_REFUSAL_PHRASES, ...acceptableResponses.map(p => p.toLowerCase())];

  const matchedPhrases = allPhrases.filter(phrase => lowerResponse.includes(phrase));

  return {
    hasRefusal: matchedPhrases.length > 0,
    matchedPhrases,
    matchCount: matchedPhrases.length
  };
}

/**
 * Check if response contains hallucination indicators
 *
 * @param {string} response - The system response
 * @param {string[]} unacceptablePatterns - Patterns that indicate hallucination
 * @returns {Object} Hallucination check result
 */
function checkHallucinationPatterns(response, unacceptablePatterns = []) {
  const lowerResponse = response.toLowerCase();
  const matchedPatterns = [];

  for (const pattern of unacceptablePatterns) {
    if (lowerResponse.includes(pattern.toLowerCase())) {
      matchedPatterns.push(pattern);
    }
  }

  return {
    hasHallucination: matchedPatterns.length > 0,
    matchedPatterns,
    matchCount: matchedPatterns.length
  };
}

/**
 * Classify a single response using heuristics
 *
 * @param {string} response - The system response
 * @param {Object} testCase - The negative test case
 * @returns {Object} Heuristic classification result
 */
function classifyWithHeuristics(response, testCase) {
  const refusalCheck = checkRefusalPatterns(
    response,
    testCase.acceptableResponses || []
  );

  const hallucinationCheck = checkHallucinationPatterns(
    response,
    testCase.unacceptablePatterns || []
  );

  // Decision logic
  if (hallucinationCheck.hasHallucination) {
    return {
      classification: ResponseType.HALLUCINATION,
      confidence: 0.8,
      reasoning: `Response contains unacceptable patterns: ${hallucinationCheck.matchedPatterns.join(', ')}`,
      method: 'heuristic'
    };
  }

  if (refusalCheck.hasRefusal) {
    return {
      classification: ResponseType.CORRECT_REFUSAL,
      confidence: 0.9,
      reasoning: `Response contains refusal phrases: ${refusalCheck.matchedPhrases.slice(0, 3).join(', ')}`,
      method: 'heuristic'
    };
  }

  // Ambiguous - may need LLM classification
  return {
    classification: ResponseType.QUALIFIED_RESPONSE,
    confidence: 0.5,
    reasoning: 'Response does not clearly refuse or hallucinate - may be qualified response',
    method: 'heuristic',
    needsLLMVerification: true
  };
}

/**
 * Classify a response using LLM
 *
 * @param {string} question - Original question
 * @param {string} response - System response
 * @param {string} reason - Why this is a negative test
 * @param {Object} client - OpenAI client
 * @param {string} deploymentName - Model deployment name
 * @returns {Promise<Object>} LLM classification result
 */
async function classifyWithLLM(question, response, reason, client, deploymentName) {
  const prompt = buildClassificationPrompt(question, response, reason);

  try {
    const completion = await client.chat.completions.create({
      model: deploymentName,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at evaluating AI system responses for hallucinations. Respond only with valid JSON.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const parsed = parseJsonResponse(responseText);

    if (parsed && parsed.classification) {
      return {
        classification: parsed.classification,
        confidence: parsed.confidence || 0.8,
        reasoning: parsed.reasoning || '',
        hallucinatedClaims: parsed.hallucinated_claims || [],
        method: 'llm'
      };
    }

    return {
      classification: ResponseType.QUALIFIED_RESPONSE,
      confidence: 0.5,
      reasoning: 'LLM classification parsing failed',
      method: 'llm_fallback'
    };
  } catch (error) {
    log.error('LLM classification failed', { error: error.message });
    throw error;
  }
}

/**
 * Evaluate a single negative test case
 *
 * @param {Object} testCase - The negative test case
 * @param {string} response - System response to evaluate
 * @param {Object} options - Evaluation options
 * @param {Object} openaiClient - Optional OpenAI client
 * @returns {Promise<Object>} Evaluation result
 */
async function evaluateTestCase(testCase, response, options = {}, openaiClient = null) {
  const startTime = Date.now();
  const { useLLM = true, llmForAmbiguous = true } = options;

  // First, try heuristic classification
  const heuristicResult = classifyWithHeuristics(response, testCase);

  let finalResult = heuristicResult;

  // Use LLM for ambiguous cases or if requested
  if (useLLM && (heuristicResult.needsLLMVerification || !llmForAmbiguous)) {
    try {
      const client = openaiClient || createOpenAIClient();
      const config = getOpenAIConfig();
      const deploymentName = config.deploymentName;

      if (deploymentName) {
        const llmResult = await classifyWithLLM(
          testCase.question,
          response,
          testCase.reason,
          client,
          deploymentName
        );
        finalResult = llmResult;
      }
    } catch (error) {
      log.warn('LLM classification failed, using heuristic result', { error: error.message });
    }
  }

  // Calculate score
  let score;
  switch (finalResult.classification) {
    case ResponseType.CORRECT_REFUSAL:
      score = 1.0;
      break;
    case ResponseType.QUALIFIED_RESPONSE:
      score = 0.5;
      break;
    case ResponseType.HALLUCINATION:
      score = 0.0;
      break;
    default:
      score = 0.0;
  }

  return {
    testCaseId: testCase.id,
    category: testCase.category,
    question: testCase.question,
    response: response.substring(0, 500) + (response.length > 500 ? '...' : ''),
    classification: finalResult.classification,
    score,
    confidence: finalResult.confidence,
    reasoning: finalResult.reasoning,
    hallucinatedClaims: finalResult.hallucinatedClaims || [],
    method: finalResult.method,
    passed: finalResult.classification === ResponseType.CORRECT_REFUSAL,
    latencyMs: Date.now() - startTime
  };
}

/**
 * Evaluate multiple test cases in batch
 *
 * @param {Array<{testCase: Object, response: string}>} items - Test cases with responses
 * @param {Object} options - Evaluation options
 * @returns {Promise<Object>} Batch evaluation results
 */
async function evaluateBatch(items, options = {}) {
  const startTime = Date.now();
  const { concurrency = 3, useLLM = true } = options;

  if (!items || items.length === 0) {
    return {
      results: [],
      aggregate: {},
      itemCount: 0,
      passCount: 0,
      failCount: 0
    };
  }

  const results = [];
  const client = useLLM ? createOpenAIClient() : null;

  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(item =>
      evaluateTestCase(item.testCase, item.response, options, client)
        .catch(error => ({
          testCaseId: item.testCase.id,
          category: item.testCase.category,
          question: item.testCase.question,
          classification: ResponseType.ERROR,
          score: 0,
          error: error.message,
          passed: false
        }))
    );

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Calculate aggregate statistics
  const aggregate = calculateAggregateStats(results);

  return {
    results,
    aggregate,
    itemCount: items.length,
    passCount: results.filter(r => r.passed).length,
    failCount: results.filter(r => !r.passed).length,
    latencyMs: Date.now() - startTime
  };
}

/**
 * Calculate aggregate statistics from results
 *
 * @param {Object[]} results - Individual evaluation results
 * @returns {Object} Aggregate statistics
 */
function calculateAggregateStats(results) {
  if (results.length === 0) {
    return {
      totalTests: 0,
      passRate: 0,
      hallucinationRate: 0,
      averageScore: 0
    };
  }

  const byClassification = {};
  const byCategory = {};
  let totalScore = 0;

  for (const result of results) {
    // By classification
    byClassification[result.classification] = (byClassification[result.classification] || 0) + 1;

    // By category
    if (!byCategory[result.category]) {
      byCategory[result.category] = { pass: 0, fail: 0, total: 0 };
    }
    byCategory[result.category].total++;
    if (result.passed) {
      byCategory[result.category].pass++;
    } else {
      byCategory[result.category].fail++;
    }

    totalScore += result.score;
  }

  const correctRefusals = byClassification[ResponseType.CORRECT_REFUSAL] || 0;
  const hallucinations = byClassification[ResponseType.HALLUCINATION] || 0;
  const qualified = byClassification[ResponseType.QUALIFIED_RESPONSE] || 0;

  return {
    totalTests: results.length,
    correctRefusals,
    qualifiedResponses: qualified,
    hallucinations,
    passRate: correctRefusals / results.length,
    hallucinationRate: hallucinations / results.length,
    averageScore: totalScore / results.length,
    byClassification,
    byCategory
  };
}

/**
 * Load negative test dataset from file
 *
 * @param {string} datasetPath - Path to dataset file
 * @returns {Object} Loaded dataset
 */
function loadNegativeTestDataset(datasetPath) {
  const fs = require('fs');
  const path = require('path');

  const absolutePath = path.isAbsolute(datasetPath)
    ? datasetPath
    : path.join(process.cwd(), datasetPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Dataset file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Format evaluation results as text report
 *
 * @param {Object} batchResult - Result from evaluateBatch
 * @returns {string} Formatted text report
 */
function formatTextReport(batchResult) {
  const lines = [
    'Negative Test Evaluation Report',
    '=' .repeat(50),
    '',
    `Total Test Cases: ${batchResult.itemCount}`,
    `Passed (Correct Refusals): ${batchResult.passCount}`,
    `Failed: ${batchResult.failCount}`,
    `Pass Rate: ${(batchResult.aggregate.passRate * 100).toFixed(1)}%`,
    `Hallucination Rate: ${(batchResult.aggregate.hallucinationRate * 100).toFixed(1)}%`,
    `Average Score: ${(batchResult.aggregate.averageScore * 100).toFixed(1)}%`,
    '',
    'Classification Breakdown:',
    `  Correct Refusals: ${batchResult.aggregate.correctRefusals}`,
    `  Qualified Responses: ${batchResult.aggregate.qualifiedResponses}`,
    `  Hallucinations: ${batchResult.aggregate.hallucinations}`,
    ''
  ];

  // Category breakdown
  if (batchResult.aggregate.byCategory) {
    lines.push('Results by Category:');
    for (const [category, stats] of Object.entries(batchResult.aggregate.byCategory)) {
      const rate = ((stats.pass / stats.total) * 100).toFixed(1);
      lines.push(`  ${category}: ${stats.pass}/${stats.total} (${rate}%)`);
    }
    lines.push('');
  }

  // Failed tests
  const failures = batchResult.results.filter(r => !r.passed);
  if (failures.length > 0) {
    lines.push('Failed Test Cases:');
    lines.push('-'.repeat(50));
    for (const failure of failures.slice(0, 10)) {
      lines.push(`[${failure.testCaseId}] ${failure.category}`);
      lines.push(`  Q: ${failure.question.substring(0, 80)}...`);
      lines.push(`  Classification: ${failure.classification}`);
      lines.push(`  Reason: ${failure.reasoning}`);
      if (failure.hallucinatedClaims?.length > 0) {
        lines.push(`  Hallucinated: ${failure.hallucinatedClaims.join(', ')}`);
      }
      lines.push('');
    }
    if (failures.length > 10) {
      lines.push(`  ... and ${failures.length - 10} more failures`);
    }
  }

  return lines.join('\n');
}

/**
 * Format evaluation results as markdown report
 *
 * @param {Object} batchResult - Result from evaluateBatch
 * @returns {string} Formatted markdown report
 */
function formatMarkdownReport(batchResult) {
  const lines = [
    '# Negative Test Evaluation Report',
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total Test Cases | ${batchResult.itemCount} |`,
    `| Passed (Correct Refusals) | ${batchResult.passCount} |`,
    `| Failed | ${batchResult.failCount} |`,
    `| Pass Rate | ${(batchResult.aggregate.passRate * 100).toFixed(1)}% |`,
    `| Hallucination Rate | ${(batchResult.aggregate.hallucinationRate * 100).toFixed(1)}% |`,
    `| Average Score | ${(batchResult.aggregate.averageScore * 100).toFixed(1)}% |`,
    '',
    '## Classification Breakdown',
    '',
    '| Classification | Count |',
    '|----------------|-------|',
    `| Correct Refusals | ${batchResult.aggregate.correctRefusals} |`,
    `| Qualified Responses | ${batchResult.aggregate.qualifiedResponses} |`,
    `| Hallucinations | ${batchResult.aggregate.hallucinations} |`,
    ''
  ];

  // Category breakdown
  if (batchResult.aggregate.byCategory) {
    lines.push('## Results by Category');
    lines.push('');
    lines.push('| Category | Passed | Total | Pass Rate |');
    lines.push('|----------|--------|-------|-----------|');
    for (const [category, stats] of Object.entries(batchResult.aggregate.byCategory)) {
      const rate = ((stats.pass / stats.total) * 100).toFixed(1);
      lines.push(`| ${category} | ${stats.pass} | ${stats.total} | ${rate}% |`);
    }
    lines.push('');
  }

  // Failed tests
  const failures = batchResult.results.filter(r => !r.passed);
  if (failures.length > 0) {
    lines.push('## Failed Test Cases');
    lines.push('');
    for (const failure of failures.slice(0, 20)) {
      lines.push(`### ${failure.testCaseId} (${failure.category})`);
      lines.push('');
      lines.push(`**Question:** ${failure.question}`);
      lines.push('');
      lines.push(`**Classification:** \`${failure.classification}\``);
      lines.push('');
      lines.push(`**Reason:** ${failure.reasoning}`);
      if (failure.hallucinatedClaims?.length > 0) {
        lines.push('');
        lines.push(`**Hallucinated Claims:**`);
        failure.hallucinatedClaims.forEach(c => lines.push(`- ${c}`));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Create a mock response generator for testing
 * This simulates GraphRAG responses for negative test evaluation
 *
 * @param {Object} graphRagService - Optional GraphRAG service to use
 * @returns {Function} Response generator function
 */
function createResponseGenerator(graphRagService = null) {
  return async function generateResponse(question) {
    if (graphRagService) {
      try {
        const result = await graphRagService.query(question);
        return result.answer || result.response || '';
      } catch (error) {
        return `Error: ${error.message}`;
      }
    }

    // Mock response for testing without actual service
    return 'I don\'t have sufficient information to answer that question based on the available knowledge base.';
  };
}

/**
 * Run full negative test evaluation against a GraphRAG service
 *
 * @param {Object} graphRagService - The GraphRAG service to test
 * @param {Object} options - Evaluation options
 * @returns {Promise<Object>} Complete evaluation results
 */
async function runNegativeTestSuite(graphRagService, options = {}) {
  const startTime = Date.now();
  const path = require('path');

  const {
    datasetPath = path.join(__dirname, 'datasets', 'negative_tests.json'),
    maxTests = null,
    categories = null,
    useLLM = true,
    concurrency = 3
  } = options;

  // Load dataset
  let dataset;
  try {
    dataset = loadNegativeTestDataset(datasetPath);
  } catch (error) {
    return {
      status: 'error',
      error: `Failed to load dataset: ${error.message}`,
      latencyMs: Date.now() - startTime
    };
  }

  // Filter test cases
  let testCases = dataset.negative_tests || [];

  if (categories) {
    testCases = testCases.filter(tc => categories.includes(tc.category));
  }

  if (maxTests) {
    testCases = testCases.slice(0, maxTests);
  }

  log.info('Running negative test suite', {
    totalTests: testCases.length,
    categories: categories || 'all',
    useLLM
  });

  // Generate responses for each test case
  const responseGenerator = createResponseGenerator(graphRagService);
  const items = [];

  for (const testCase of testCases) {
    try {
      const response = await responseGenerator(testCase.question);
      items.push({ testCase, response });
    } catch (error) {
      items.push({
        testCase,
        response: `Error generating response: ${error.message}`
      });
    }
  }

  // Evaluate all responses
  const batchResult = await evaluateBatch(items, { useLLM, concurrency });

  return {
    status: 'success',
    dataset: {
      name: dataset.metadata?.name,
      version: dataset.metadata?.version,
      totalTestCases: testCases.length
    },
    ...batchResult,
    totalLatencyMs: Date.now() - startTime
  };
}

module.exports = {
  // Core evaluation functions
  evaluateTestCase,
  evaluateBatch,
  runNegativeTestSuite,

  // Utility functions
  classifyWithHeuristics,
  classifyWithLLM,
  checkRefusalPatterns,
  checkHallucinationPatterns,
  calculateAggregateStats,

  // Dataset functions
  loadNegativeTestDataset,

  // Formatting
  formatTextReport,
  formatMarkdownReport,

  // Testing helpers
  createResponseGenerator,

  // Constants
  ResponseType,
  DEFAULT_REFUSAL_PHRASES,

  // Prompt builder (for testing)
  buildClassificationPrompt
};
