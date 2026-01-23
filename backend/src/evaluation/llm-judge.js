/**
 * LLM-as-Judge Evaluator
 *
 * Uses GPT-4 (via Azure OpenAI) with rubrics to evaluate answer quality:
 * - Helpfulness: Does the answer address the user's question?
 * - Accuracy: Is the answer factually correct based on the context?
 * - Completeness: Does the answer cover all relevant aspects?
 *
 * Feature: F1.2.4 - LLM-as-Judge Evaluator
 */

const { createOpenAIClient, getOpenAIConfig } = require('../clients/openai');
const { log } = require('../utils/logger');

// Evaluation rubrics for scoring
const RUBRICS = {
  helpfulness: {
    description: 'Does the answer directly address the user\'s question and provide useful information?',
    criteria: [
      { score: 5, description: 'Excellent: Directly answers the question with actionable, relevant information' },
      { score: 4, description: 'Good: Answers the question well with useful information' },
      { score: 3, description: 'Adequate: Partially answers the question with some useful information' },
      { score: 2, description: 'Poor: Minimally addresses the question or provides tangential information' },
      { score: 1, description: 'Very Poor: Does not answer the question or provides irrelevant information' }
    ]
  },
  accuracy: {
    description: 'Is the answer factually correct and grounded in the provided context?',
    criteria: [
      { score: 5, description: 'Excellent: Completely accurate, all claims supported by context' },
      { score: 4, description: 'Good: Mostly accurate with minor unsupported details' },
      { score: 3, description: 'Adequate: Generally accurate but some claims lack support' },
      { score: 2, description: 'Poor: Contains significant inaccuracies or unsupported claims' },
      { score: 1, description: 'Very Poor: Largely inaccurate or fabricates information not in context' }
    ]
  },
  completeness: {
    description: 'Does the answer cover all relevant aspects from the context?',
    criteria: [
      { score: 5, description: 'Excellent: Comprehensive, covers all relevant information from context' },
      { score: 4, description: 'Good: Covers most relevant information with minor omissions' },
      { score: 3, description: 'Adequate: Covers key points but misses some relevant details' },
      { score: 2, description: 'Poor: Significant gaps, misses important information' },
      { score: 1, description: 'Very Poor: Severely incomplete, misses most relevant information' }
    ]
  }
};

/**
 * Build the evaluation prompt for the LLM judge
 *
 * @param {string} question - The original question
 * @param {string} answer - The answer to evaluate
 * @param {string} context - The context/sources used to generate the answer
 * @param {string[]} dimensions - Which dimensions to evaluate (helpfulness, accuracy, completeness)
 * @returns {string} The formatted prompt
 */
function buildEvaluationPrompt(question, answer, context, dimensions = ['helpfulness', 'accuracy', 'completeness']) {
  const rubricText = dimensions.map(dim => {
    const rubric = RUBRICS[dim];
    const criteriaText = rubric.criteria.map(c => `  ${c.score}: ${c.description}`).join('\n');
    return `### ${dim.charAt(0).toUpperCase() + dim.slice(1)}
${rubric.description}
Scoring criteria:
${criteriaText}`;
  }).join('\n\n');

  return `You are an expert evaluator assessing the quality of an AI assistant's answer.

## Task
Evaluate the following answer based on the provided rubrics. You must provide a score (1-5) and brief justification for each dimension.

## Question
${question}

## Context (sources available to generate the answer)
${context}

## Answer to Evaluate
${answer}

## Evaluation Rubrics
${rubricText}

## Instructions
For each dimension, provide:
1. A score from 1-5 following the rubric criteria
2. A brief justification (1-2 sentences) explaining your score

Respond in the following JSON format only (no markdown code blocks):
{
  ${dimensions.map(dim => `"${dim}": { "score": <number>, "justification": "<string>" }`).join(',\n  ')}
}`;
}

/**
 * Parse the LLM's evaluation response
 *
 * @param {string} response - The raw response from the LLM
 * @param {string[]} dimensions - Expected dimensions
 * @returns {Object} Parsed evaluation results
 */
function parseEvaluationResponse(response, dimensions) {
  try {
    // Remove potential markdown code blocks
    let cleanResponse = response.trim();
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

    const parsed = JSON.parse(cleanResponse);
    const result = {};

    for (const dim of dimensions) {
      if (parsed[dim]) {
        result[dim] = {
          score: Math.min(5, Math.max(1, parseInt(parsed[dim].score, 10) || 3)),
          justification: parsed[dim].justification || ''
        };
      } else {
        result[dim] = { score: 3, justification: 'Unable to parse evaluation' };
      }
    }

    return result;
  } catch (error) {
    log.warn('Failed to parse LLM judge response', { error: error.message, response });
    // Return default scores on parse failure
    return dimensions.reduce((acc, dim) => {
      acc[dim] = { score: 3, justification: 'Parse error - defaulting to neutral score' };
      return acc;
    }, {});
  }
}

/**
 * Evaluate a single answer using LLM-as-Judge
 *
 * @param {Object} params - Evaluation parameters
 * @param {string} params.question - The original question
 * @param {string} params.answer - The answer to evaluate
 * @param {string} params.context - The context/sources used
 * @param {string[]} [params.dimensions] - Dimensions to evaluate (default: all)
 * @param {Object} [openaiClient] - Optional OpenAI client (for testing)
 * @returns {Promise<Object>} Evaluation results with scores and justifications
 */
async function evaluateAnswer({ question, answer, context, dimensions = ['helpfulness', 'accuracy', 'completeness'] }, openaiClient = null) {
  const startTime = Date.now();

  if (!question || !answer) {
    throw new Error('Question and answer are required for evaluation');
  }

  const client = openaiClient || createOpenAIClient();
  const config = getOpenAIConfig();
  const deploymentName = config.deploymentName;

  if (!deploymentName) {
    throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME is required for LLM-as-Judge');
  }

  const prompt = buildEvaluationPrompt(question, answer, context || 'No context provided', dimensions);

  try {
    const completion = await client.chat.completions.create({
      model: deploymentName,
      messages: [
        {
          role: 'system',
          content: 'You are an expert evaluator. Respond only with valid JSON, no markdown formatting.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1, // Low temperature for consistent evaluation
      max_tokens: 500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const evaluation = parseEvaluationResponse(responseText, dimensions);

    // Calculate overall score (average)
    const scores = dimensions.map(dim => evaluation[dim].score);
    const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    const result = {
      dimensions: evaluation,
      overallScore: Math.round(overallScore * 100) / 100,
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime
    };

    log.info('LLM-as-Judge evaluation complete', {
      overallScore: result.overallScore,
      latencyMs: result.latencyMs,
      dimensions: dimensions.join(', ')
    });

    return result;
  } catch (error) {
    log.error('LLM-as-Judge evaluation failed', { error: error.message });
    throw error;
  }
}

/**
 * Evaluate multiple Q&A pairs in batch
 *
 * @param {Array<{question: string, answer: string, context: string, expectedAnswer?: string}>} items - Items to evaluate
 * @param {string[]} [dimensions] - Dimensions to evaluate
 * @param {Object} [options] - Additional options
 * @param {number} [options.concurrency=3] - Number of concurrent evaluations
 * @returns {Promise<Object>} Batch evaluation results with individual and aggregate scores
 */
async function evaluateBatch(items, dimensions = ['helpfulness', 'accuracy', 'completeness'], options = {}) {
  const { concurrency = 3 } = options;

  if (!items || items.length === 0) {
    return {
      results: [],
      aggregate: {},
      itemCount: 0
    };
  }

  const results = [];
  const client = createOpenAIClient();

  // Process in batches to respect rate limits
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, idx) => {
      try {
        const evaluation = await evaluateAnswer({
          question: item.question,
          answer: item.answer,
          context: item.context,
          dimensions
        }, client);

        return {
          index: i + idx,
          question: item.question,
          evaluation,
          success: true
        };
      } catch (error) {
        log.warn('Batch evaluation item failed', { index: i + idx, error: error.message });
        return {
          index: i + idx,
          question: item.question,
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
    // Calculate mean scores for each dimension
    for (const dim of dimensions) {
      const dimScores = successfulResults.map(r => r.evaluation.dimensions[dim].score);
      aggregate[dim] = {
        mean: dimScores.reduce((a, b) => a + b, 0) / dimScores.length,
        min: Math.min(...dimScores),
        max: Math.max(...dimScores),
        stdDev: calculateStdDev(dimScores)
      };
    }

    // Overall score statistics
    const overallScores = successfulResults.map(r => r.evaluation.overallScore);
    aggregate.overall = {
      mean: overallScores.reduce((a, b) => a + b, 0) / overallScores.length,
      min: Math.min(...overallScores),
      max: Math.max(...overallScores),
      stdDev: calculateStdDev(overallScores)
    };
  }

  log.info('Batch evaluation complete', {
    totalItems: items.length,
    successCount: successfulResults.length,
    failCount: results.length - successfulResults.length,
    overallMean: aggregate.overall?.mean?.toFixed(2)
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
 * Format evaluation results for display/reporting
 *
 * @param {Object} evaluation - Evaluation result from evaluateAnswer
 * @returns {string} Formatted string
 */
function formatEvaluation(evaluation) {
  if (!evaluation || !evaluation.dimensions) {
    return 'No evaluation available';
  }

  const lines = [
    'LLM-as-Judge Evaluation Results',
    '='.repeat(40),
    `Overall Score: ${evaluation.overallScore}/5`,
    `Evaluated At: ${evaluation.evaluatedAt}`,
    `Latency: ${evaluation.latencyMs}ms`,
    ''
  ];

  for (const [dim, result] of Object.entries(evaluation.dimensions)) {
    lines.push(`${dim.charAt(0).toUpperCase() + dim.slice(1)}: ${result.score}/5`);
    lines.push(`  ${result.justification}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format batch evaluation results for reporting
 *
 * @param {Object} batchResult - Result from evaluateBatch
 * @returns {string} Formatted string
 */
function formatBatchEvaluation(batchResult) {
  if (!batchResult || batchResult.itemCount === 0) {
    return 'No batch evaluation results';
  }

  const lines = [
    'LLM-as-Judge Batch Evaluation Results',
    '='.repeat(40),
    `Total Items: ${batchResult.itemCount}`,
    `Successful: ${batchResult.successCount}`,
    `Failed: ${batchResult.itemCount - batchResult.successCount}`,
    ''
  ];

  if (batchResult.aggregate.overall) {
    lines.push('Aggregate Scores:');
    lines.push(`  Overall: ${batchResult.aggregate.overall.mean.toFixed(2)}/5 (±${batchResult.aggregate.overall.stdDev.toFixed(2)})`);

    for (const [dim, stats] of Object.entries(batchResult.aggregate)) {
      if (dim !== 'overall') {
        lines.push(`  ${dim.charAt(0).toUpperCase() + dim.slice(1)}: ${stats.mean.toFixed(2)}/5 (min: ${stats.min}, max: ${stats.max})`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Get available evaluation rubrics
 * @returns {Object} The evaluation rubrics
 */
function getRubrics() {
  return RUBRICS;
}

module.exports = {
  // Core evaluation functions
  evaluateAnswer,
  evaluateBatch,

  // Utilities
  buildEvaluationPrompt,
  parseEvaluationResponse,
  formatEvaluation,
  formatBatchEvaluation,
  getRubrics,

  // Constants
  RUBRICS
};
