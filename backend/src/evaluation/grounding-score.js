/**
 * Grounding Score Calculator
 *
 * Measures how well answers are grounded in retrieved context.
 * Identifies and penalizes unsupported claims (hallucinations).
 *
 * Feature: F1.2.3 - Grounding Score Calculator
 *
 * Approach: LLM-based claim verification using GPT-4.
 * 1. Extract atomic claims from the answer
 * 2. Verify each claim against the provided context
 * 3. Calculate grounding score based on supported vs total claims
 *
 * @see https://www.deepset.ai/blog/rag-llm-evaluation-groundedness
 * @see https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-llm-evaluation-phase
 */

const { createOpenAIClient, getOpenAIConfig } = require('../clients/openai');
const { log } = require('../utils/logger');

/**
 * Verification status for individual claims
 */
const ClaimStatus = {
  SUPPORTED: 'supported',
  PARTIALLY_SUPPORTED: 'partially_supported',
  NOT_SUPPORTED: 'not_supported',
  NOT_VERIFIABLE: 'not_verifiable'
};

/**
 * Weights for calculating grounding score based on claim status
 */
const STATUS_WEIGHTS = {
  [ClaimStatus.SUPPORTED]: 1.0,
  [ClaimStatus.PARTIALLY_SUPPORTED]: 0.5,
  [ClaimStatus.NOT_SUPPORTED]: 0.0,
  [ClaimStatus.NOT_VERIFIABLE]: 0.0
};

/**
 * Build prompt for extracting claims from an answer
 *
 * @param {string} answer - The answer to extract claims from
 * @returns {string} The formatted prompt
 */
function buildClaimExtractionPrompt(answer) {
  return `You are an expert at analyzing text and extracting factual claims.

## Task
Extract all atomic factual claims from the following answer. Each claim should be:
- A single, self-contained statement
- Verifiable against source documents
- Not an opinion or subjective statement

## Answer to Analyze
${answer}

## Instructions
Extract each distinct factual claim as a separate item. Combine closely related facts into one claim if they cannot be verified independently.

Respond in the following JSON format only (no markdown code blocks):
{
  "claims": [
    "First factual claim here",
    "Second factual claim here"
  ]
}

If the answer contains no verifiable factual claims, return: {"claims": []}`;
}

/**
 * Build prompt for verifying claims against context
 *
 * @param {string[]} claims - List of claims to verify
 * @param {string} context - The context to verify against
 * @returns {string} The formatted prompt
 */
function buildClaimVerificationPrompt(claims, context) {
  const claimsList = claims.map((claim, idx) => `${idx + 1}. "${claim}"`).join('\n');

  return `You are an expert fact-checker verifying claims against source documents.

## Task
For each claim below, determine if it is supported by the provided context.

## Claims to Verify
${claimsList}

## Source Context
${context}

## Verification Categories
- "supported": The claim is directly stated or strongly implied by the context
- "partially_supported": Part of the claim is supported, but some details are not verified
- "not_supported": The claim contradicts the context or states something not mentioned
- "not_verifiable": The claim is about something the context doesn't address at all

## Instructions
Verify each claim against the context. Be strict - only mark as "supported" if the context clearly supports the claim.

Respond in the following JSON format only (no markdown code blocks):
{
  "verifications": [
    {
      "claim_index": 1,
      "status": "supported|partially_supported|not_supported|not_verifiable",
      "evidence": "Quote or describe the supporting evidence, or explain why not supported",
      "confidence": 0.0-1.0
    }
  ]
}`;
}

/**
 * Parse JSON response from LLM, handling markdown code blocks
 *
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed JSON or null on failure
 */
function parseJsonResponse(response) {
  try {
    let cleanResponse = response.trim();

    // Remove markdown code blocks
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.slice(7);
    }
    if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.slice(3);
    }
    if (cleanResponse.endsWith('```')) {
      cleanResponse = cleanResponse.slice(0, -3);
    }
    cleanResponse = cleanResponse.trim();

    return JSON.parse(cleanResponse);
  } catch (error) {
    log.warn('Failed to parse JSON response', { error: error.message });
    return null;
  }
}

/**
 * Extract claims from an answer using LLM
 *
 * @param {string} answer - The answer to extract claims from
 * @param {Object} client - OpenAI client
 * @param {string} deploymentName - Model deployment name
 * @returns {Promise<string[]>} Array of extracted claims
 */
async function extractClaims(answer, client, deploymentName) {
  const prompt = buildClaimExtractionPrompt(answer);

  const completion = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      {
        role: 'system',
        content: 'You are an expert at extracting factual claims. Respond only with valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 1000
  });

  const responseText = completion.choices[0]?.message?.content || '';
  const parsed = parseJsonResponse(responseText);

  if (parsed && Array.isArray(parsed.claims)) {
    return parsed.claims;
  }

  log.warn('Failed to extract claims, treating answer as single claim');
  return [answer];
}

/**
 * Verify claims against context using LLM
 *
 * @param {string[]} claims - Claims to verify
 * @param {string} context - Context to verify against
 * @param {Object} client - OpenAI client
 * @param {string} deploymentName - Model deployment name
 * @returns {Promise<Object[]>} Array of verification results
 */
async function verifyClaims(claims, context, client, deploymentName) {
  if (claims.length === 0) {
    return [];
  }

  const prompt = buildClaimVerificationPrompt(claims, context);

  const completion = await client.chat.completions.create({
    model: deploymentName,
    messages: [
      {
        role: 'system',
        content: 'You are an expert fact-checker. Respond only with valid JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 2000
  });

  const responseText = completion.choices[0]?.message?.content || '';
  const parsed = parseJsonResponse(responseText);

  if (parsed && Array.isArray(parsed.verifications)) {
    // Normalize and validate verifications
    return parsed.verifications.map((v, idx) => ({
      claimIndex: v.claim_index || idx + 1,
      claim: claims[(v.claim_index || idx + 1) - 1] || claims[idx],
      status: Object.values(ClaimStatus).includes(v.status) ? v.status : ClaimStatus.NOT_VERIFIABLE,
      evidence: v.evidence || '',
      confidence: Math.min(1, Math.max(0, parseFloat(v.confidence) || 0.5))
    }));
  }

  // Default: mark all claims as not verifiable
  log.warn('Failed to verify claims, defaulting to not_verifiable');
  return claims.map((claim, idx) => ({
    claimIndex: idx + 1,
    claim,
    status: ClaimStatus.NOT_VERIFIABLE,
    evidence: 'Verification failed',
    confidence: 0
  }));
}

/**
 * Calculate grounding score from verification results
 *
 * @param {Object[]} verifications - Array of verification results
 * @returns {Object} Score details including raw score and weighted score
 */
function calculateScoreFromVerifications(verifications) {
  if (verifications.length === 0) {
    return {
      score: 1.0, // No claims to verify = fully grounded (empty answer)
      weightedScore: 1.0,
      supportedCount: 0,
      partialCount: 0,
      unsupportedCount: 0,
      notVerifiableCount: 0,
      totalClaims: 0
    };
  }

  let supportedCount = 0;
  let partialCount = 0;
  let unsupportedCount = 0;
  let notVerifiableCount = 0;
  let weightedSum = 0;
  let confidenceWeightedSum = 0;
  let totalConfidence = 0;

  for (const v of verifications) {
    const weight = STATUS_WEIGHTS[v.status] || 0;
    weightedSum += weight;
    confidenceWeightedSum += weight * v.confidence;
    totalConfidence += v.confidence;

    switch (v.status) {
      case ClaimStatus.SUPPORTED:
        supportedCount++;
        break;
      case ClaimStatus.PARTIALLY_SUPPORTED:
        partialCount++;
        break;
      case ClaimStatus.NOT_SUPPORTED:
        unsupportedCount++;
        break;
      case ClaimStatus.NOT_VERIFIABLE:
        notVerifiableCount++;
        break;
    }
  }

  const totalClaims = verifications.length;
  const score = weightedSum / totalClaims;
  const weightedScore = totalConfidence > 0
    ? confidenceWeightedSum / totalConfidence
    : score;

  return {
    score: Math.round(score * 1000) / 1000,
    weightedScore: Math.round(weightedScore * 1000) / 1000,
    supportedCount,
    partialCount,
    unsupportedCount,
    notVerifiableCount,
    totalClaims
  };
}

/**
 * Calculate grounding score for an answer against context
 *
 * @param {Object} params - Parameters
 * @param {string} params.answer - The answer to evaluate
 * @param {string} params.context - The retrieved context to check against
 * @param {Object} [options] - Optional configuration
 * @param {boolean} [options.includeVerifications=true] - Include detailed verifications in result
 * @param {Object} [openaiClient] - Optional OpenAI client (for testing)
 * @returns {Promise<Object>} Grounding evaluation result
 */
async function calculateGroundingScore({ answer, context }, options = {}, openaiClient = null) {
  const startTime = Date.now();
  const { includeVerifications = true } = options;

  // Input validation
  if (!answer || typeof answer !== 'string') {
    throw new Error('Answer is required and must be a string');
  }

  if (!context || typeof context !== 'string') {
    throw new Error('Context is required and must be a string');
  }

  // Handle empty answer
  if (answer.trim().length === 0) {
    return {
      score: 1.0,
      weightedScore: 1.0,
      totalClaims: 0,
      supportedClaims: 0,
      unsupportedClaims: [],
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime
    };
  }

  // Handle empty context
  if (context.trim().length === 0) {
    log.warn('Empty context provided for grounding evaluation');
    return {
      score: 0.0,
      weightedScore: 0.0,
      totalClaims: 1,
      supportedClaims: 0,
      unsupportedClaims: [{ claim: answer, reason: 'No context provided for verification' }],
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime
    };
  }

  const client = openaiClient || createOpenAIClient();
  const config = getOpenAIConfig();
  const deploymentName = config.deploymentName;

  if (!deploymentName) {
    throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME is required for grounding evaluation');
  }

  try {
    // Step 1: Extract claims from answer
    log.info('Extracting claims from answer', { answerLength: answer.length });
    const claims = await extractClaims(answer, client, deploymentName);

    if (claims.length === 0) {
      return {
        score: 1.0,
        weightedScore: 1.0,
        totalClaims: 0,
        supportedClaims: 0,
        unsupportedClaims: [],
        evaluatedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime
      };
    }

    // Step 2: Verify claims against context
    log.info('Verifying claims against context', { claimCount: claims.length });
    const verifications = await verifyClaims(claims, context, client, deploymentName);

    // Step 3: Calculate score
    const scoreDetails = calculateScoreFromVerifications(verifications);

    // Build unsupported claims list
    const unsupportedClaims = verifications
      .filter(v => v.status === ClaimStatus.NOT_SUPPORTED || v.status === ClaimStatus.NOT_VERIFIABLE)
      .map(v => ({
        claim: v.claim,
        status: v.status,
        reason: v.evidence
      }));

    const result = {
      score: scoreDetails.score,
      weightedScore: scoreDetails.weightedScore,
      totalClaims: scoreDetails.totalClaims,
      supportedClaims: scoreDetails.supportedCount,
      partiallySupportedClaims: scoreDetails.partialCount,
      unsupportedClaims,
      breakdown: {
        supported: scoreDetails.supportedCount,
        partiallySupported: scoreDetails.partialCount,
        notSupported: scoreDetails.unsupportedCount,
        notVerifiable: scoreDetails.notVerifiableCount
      },
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime
    };

    // Optionally include full verifications
    if (includeVerifications) {
      result.verifications = verifications;
    }

    log.info('Grounding score calculation complete', {
      score: result.score,
      totalClaims: result.totalClaims,
      supported: scoreDetails.supportedCount,
      unsupported: scoreDetails.unsupportedCount,
      latencyMs: result.latencyMs
    });

    return result;
  } catch (error) {
    log.error('Grounding score calculation failed', { error: error.message });
    throw error;
  }
}

/**
 * Calculate grounding scores for multiple answer-context pairs in batch
 *
 * @param {Array<{answer: string, context: string}>} items - Items to evaluate
 * @param {Object} [options] - Additional options
 * @param {number} [options.concurrency=2] - Number of concurrent evaluations
 * @param {boolean} [options.includeVerifications=false] - Include detailed verifications
 * @returns {Promise<Object>} Batch evaluation results with individual and aggregate scores
 */
async function calculateBatchGroundingScore(items, options = {}) {
  const { concurrency = 2, includeVerifications = false } = options;

  if (!items || items.length === 0) {
    return {
      results: [],
      aggregate: {},
      itemCount: 0,
      successCount: 0
    };
  }

  const results = [];
  const client = createOpenAIClient();

  // Process in batches to respect rate limits
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, idx) => {
      try {
        const evaluation = await calculateGroundingScore(
          { answer: item.answer, context: item.context },
          { includeVerifications },
          client
        );

        return {
          index: i + idx,
          answer: item.answer.substring(0, 100) + (item.answer.length > 100 ? '...' : ''),
          evaluation,
          success: true
        };
      } catch (error) {
        log.warn('Batch grounding evaluation item failed', { index: i + idx, error: error.message });
        return {
          index: i + idx,
          answer: item.answer.substring(0, 100) + (item.answer.length > 100 ? '...' : ''),
          evaluation: null,
          success: false,
          error: error.message
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Calculate aggregate statistics
  const successfulResults = results.filter(r => r.success);
  const aggregate = {};

  if (successfulResults.length > 0) {
    const scores = successfulResults.map(r => r.evaluation.score);
    const weightedScores = successfulResults.map(r => r.evaluation.weightedScore);
    const totalClaims = successfulResults.reduce((sum, r) => sum + r.evaluation.totalClaims, 0);
    const totalSupported = successfulResults.reduce((sum, r) => sum + r.evaluation.supportedClaims, 0);

    aggregate.score = {
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      min: Math.min(...scores),
      max: Math.max(...scores),
      stdDev: calculateStdDev(scores)
    };

    aggregate.weightedScore = {
      mean: weightedScores.reduce((a, b) => a + b, 0) / weightedScores.length,
      min: Math.min(...weightedScores),
      max: Math.max(...weightedScores),
      stdDev: calculateStdDev(weightedScores)
    };

    aggregate.claims = {
      total: totalClaims,
      supported: totalSupported,
      supportRate: totalClaims > 0 ? totalSupported / totalClaims : 1.0
    };
  }

  log.info('Batch grounding evaluation complete', {
    totalItems: items.length,
    successCount: successfulResults.length,
    failCount: results.length - successfulResults.length,
    meanScore: aggregate.score?.mean?.toFixed(3)
  });

  return {
    results,
    aggregate,
    itemCount: items.length,
    successCount: successfulResults.length
  };
}

/**
 * Calculate standard deviation
 *
 * @param {number[]} values - Array of numbers
 * @returns {number} Standard deviation
 */
function calculateStdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Format grounding score result for display/reporting
 *
 * @param {Object} result - Result from calculateGroundingScore
 * @returns {string} Formatted string
 */
function formatGroundingScore(result) {
  if (!result) {
    return 'No grounding evaluation available';
  }

  const scorePercent = (result.score * 100).toFixed(1);
  const lines = [
    'Grounding Score Evaluation',
    '='.repeat(40),
    `Grounding Score: ${scorePercent}%`,
    `Weighted Score: ${(result.weightedScore * 100).toFixed(1)}%`,
    `Total Claims: ${result.totalClaims}`,
    `Evaluated At: ${result.evaluatedAt}`,
    `Latency: ${result.latencyMs}ms`,
    ''
  ];

  if (result.breakdown) {
    lines.push('Claim Breakdown:');
    lines.push(`  Supported: ${result.breakdown.supported}`);
    lines.push(`  Partially Supported: ${result.breakdown.partiallySupported}`);
    lines.push(`  Not Supported: ${result.breakdown.notSupported}`);
    lines.push(`  Not Verifiable: ${result.breakdown.notVerifiable}`);
    lines.push('');
  }

  if (result.unsupportedClaims && result.unsupportedClaims.length > 0) {
    lines.push('Unsupported Claims:');
    result.unsupportedClaims.forEach((uc, idx) => {
      lines.push(`  ${idx + 1}. "${uc.claim}"`);
      lines.push(`     Status: ${uc.status}`);
      lines.push(`     Reason: ${uc.reason}`);
    });
  }

  return lines.join('\n');
}

/**
 * Format batch grounding evaluation results for reporting
 *
 * @param {Object} batchResult - Result from calculateBatchGroundingScore
 * @returns {string} Formatted string
 */
function formatBatchGroundingScore(batchResult) {
  if (!batchResult || batchResult.itemCount === 0) {
    return 'No batch grounding evaluation results';
  }

  const lines = [
    'Batch Grounding Score Evaluation',
    '='.repeat(40),
    `Total Items: ${batchResult.itemCount}`,
    `Successful: ${batchResult.successCount}`,
    `Failed: ${batchResult.itemCount - batchResult.successCount}`,
    ''
  ];

  if (batchResult.aggregate.score) {
    lines.push('Aggregate Scores:');
    lines.push(`  Mean Score: ${(batchResult.aggregate.score.mean * 100).toFixed(1)}% (±${(batchResult.aggregate.score.stdDev * 100).toFixed(1)}%)`);
    lines.push(`  Score Range: ${(batchResult.aggregate.score.min * 100).toFixed(1)}% - ${(batchResult.aggregate.score.max * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('Claim Statistics:');
    lines.push(`  Total Claims Evaluated: ${batchResult.aggregate.claims.total}`);
    lines.push(`  Claims Supported: ${batchResult.aggregate.claims.supported}`);
    lines.push(`  Overall Support Rate: ${(batchResult.aggregate.claims.supportRate * 100).toFixed(1)}%`);
  }

  return lines.join('\n');
}

/**
 * Quick grounding check - simplified score without detailed claim analysis
 * Useful for fast evaluation during development/testing
 *
 * @param {string} answer - The answer to evaluate
 * @param {string} context - The context to check against
 * @param {Object} [openaiClient] - Optional OpenAI client
 * @returns {Promise<{score: number, isGrounded: boolean}>} Quick grounding result
 */
async function quickGroundingCheck(answer, context, openaiClient = null) {
  const client = openaiClient || createOpenAIClient();
  const config = getOpenAIConfig();
  const deploymentName = config.deploymentName;

  if (!deploymentName) {
    throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME is required');
  }

  const prompt = `You are evaluating if an answer is grounded in the given context.

## Context
${context}

## Answer
${answer}

## Task
Rate how well the answer is grounded in the context on a scale of 0-100:
- 100: All information in the answer is directly supported by the context
- 75: Most information is supported, minor details may be inferred
- 50: About half the information is supported
- 25: Little information is supported, mostly unsupported claims
- 0: The answer contradicts or ignores the context entirely

Respond with only a JSON object:
{"score": <number>, "reason": "<brief explanation>"}`;

  try {
    const completion = await client.chat.completions.create({
      model: deploymentName,
      messages: [
        { role: 'system', content: 'You are an expert fact-checker. Respond only with valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 200
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const parsed = parseJsonResponse(responseText);

    if (parsed && typeof parsed.score === 'number') {
      const normalizedScore = Math.min(100, Math.max(0, parsed.score)) / 100;
      return {
        score: normalizedScore,
        isGrounded: normalizedScore >= 0.7,
        reason: parsed.reason || ''
      };
    }

    return { score: 0.5, isGrounded: false, reason: 'Unable to parse evaluation' };
  } catch (error) {
    log.error('Quick grounding check failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  // Core functions
  calculateGroundingScore,
  calculateBatchGroundingScore,
  quickGroundingCheck,

  // Internal utilities (exported for testing)
  extractClaims,
  verifyClaims,
  calculateScoreFromVerifications,

  // Prompt builders (exported for testing)
  buildClaimExtractionPrompt,
  buildClaimVerificationPrompt,

  // Formatting
  formatGroundingScore,
  formatBatchGroundingScore,

  // Constants
  ClaimStatus,
  STATUS_WEIGHTS
};
