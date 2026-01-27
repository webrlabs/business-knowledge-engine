/**
 * Community Summary Evaluator
 *
 * Evaluates the quality of generated community summaries using:
 * 1. LLM-as-Judge for qualitative metrics (Accuracy, Relevance, Coherence)
 * 2. Programmatic metrics for quantitative checks (Entity Coverage)
 *
 * Feature: F6.1.5 - Summary Quality Evaluation
 */

const llmJudge = require('./llm-judge');
const { log } = require('../utils/logger');

// Evaluation rubrics for community summaries
const SUMMARY_RUBRICS = {
  accuracy: {
    description: 'Does the summary accurately reflect the community composition and relationships described in the context?',
    criteria: [
      { score: 5, description: 'Excellent: Perfectly captures the community structure, dominant types, and key relationships without hallucinations.' },
      { score: 4, description: 'Good: Accurate representation with only minor omissions or insignificant details.' },
      { score: 3, description: 'Adequate: Captures the main points but may have minor inaccuracies or miss important relationships.' },
      { score: 2, description: 'Poor: Contains significant inaccuracies about entity types or relationships.' },
      { score: 1, description: 'Very Poor: completely misrepresents the community or hallucinates facts not in the data.' }
    ]
  },
  relevance: {
    description: 'Is the summary useful and descriptive? Does the title accurately describe the group?',
    criteria: [
      { score: 5, description: 'Excellent: Title and summary provide clear, actionable insight into what this community represents.' },
      { score: 4, description: 'Good: Generally useful description and accurate title.' },
      { score: 3, description: 'Adequate: Generic description or vague title, but not misleading.' },
      { score: 2, description: 'Poor: Vague, repetitive, or irrelevant description. Title is generic (e.g., "Community 1").' },
      { score: 1, description: 'Very Poor: Useless or confusing description.' }
    ]
  },
  coherence: {
    description: 'Is the summary well-written, concise, and easy to read?',
    criteria: [
      { score: 5, description: 'Excellent: Fluent, professional, and very concise.' },
      { score: 4, description: 'Good: Clear and readable.' },
      { score: 3, description: 'Adequate: Readable but may be repetitive or slightly disjointed.' },
      { score: 2, description: 'Poor: Hard to read, bad grammar, or very repetitive.' },
      { score: 1, description: 'Very Poor: Incoherent or unintelligible.' }
    ]
  }
};

/**
 * Calculate entity coverage score
 * What percentage of "key entities" listed in the ground truth are mentioned in the summary text?
 *
 * @param {string} summaryText - The generated summary text
 * @param {string[]} keyEntities - List of key entity names from ground truth/metadata
 * @returns {number} Coverage score (0-1)
 */
function calculateEntityCoverage(summaryText, keyEntities) {
  if (!summaryText || !keyEntities || keyEntities.length === 0) return 0;

  const normalizedSummary = summaryText.toLowerCase();
  let matches = 0;

  for (const entity of keyEntities) {
    if (normalizedSummary.includes(entity.toLowerCase())) {
      matches++;
    }
  }

  return matches / keyEntities.length;
}

/**
 * Evaluate a single community summary
 *
 * @param {Object} item - The evaluation item
 * @param {Object} item.generatedSummary - The summary object to evaluate ({ title, summary, keyEntities })
 * @param {Object} item.groundTruth - The community data ({ members, dominantType, typeCounts, relationships })
 * @returns {Promise<Object>} Evaluation result
 */
async function evaluateCommunitySummary(item) {
  const { generatedSummary, groundTruth } = item;
  const startTime = Date.now();

  // 1. Programmatic Metrics
  // Check coverage of top 5 entities from ground truth (if available) or from the summary's own keyEntities list if not
  const entitiesToCheck = groundTruth.members 
    ? groundTruth.members.slice(0, 5).map(m => typeof m === 'string' ? m : m.name)
    : (generatedSummary.keyEntities || []);
    
  const entityCoverage = calculateEntityCoverage(generatedSummary.summary, entitiesToCheck);

  // 2. LLM-as-Judge Evaluation
  // Construct context for the judge
  const context = `
Community ID: ${groundTruth.id || 'N/A'}
Size: ${groundTruth.memberCount || (groundTruth.members ? groundTruth.members.length : 'Unknown')}
Dominant Type: ${groundTruth.dominantType || 'Unknown'}
Type Distribution: ${JSON.stringify(groundTruth.typeCounts || {})}

Top Entities:
${entitiesToCheck.join(', ')}

Relationships (Sample):
${(groundTruth.relationships || []).slice(0, 10).map(r => `${r.source} -> ${r.target} (${r.type})`).join('\n')}
`;

  const question = `Evaluate the quality of the summary for this community.
Summary Title: ${generatedSummary.title}
Summary Text: ${generatedSummary.summary}`;

  // We temporarily swap the rubrics in llmJudge to use ours
  // Since llmJudge exports RUBRICS but buildEvaluationPrompt uses the global constant,
  // we need to pass our custom rubrics or dimensions if the function supported it.
  // Looking at llmJudge.js, it uses a local RUBRICS const.
  // However, evaluateAnswer calls buildEvaluationPrompt which uses RUBRICS.
  // We can't easily inject rubrics into llmJudge without modifying it.
  
  // Alternative: We manually call the LLM using the same pattern but with our prompt.
  // Or better: We update llmJudge to accept custom rubrics. 
  
  // For now, to avoid modifying llmJudge and risking regressions, I will implement a local `evaluateWithRubrics` helper
  // that mimics llmJudge but uses my rubrics.
  
  const llmResult = await evaluateWithCustomRubrics(
    question, 
    generatedSummary.summary, 
    context, 
    ['accuracy', 'relevance', 'coherence']
  );

  return {
    dimensions: llmResult.dimensions,
    overallScore: llmResult.overallScore,
    metrics: {
      entityCoverage
    },
    latencyMs: Date.now() - startTime
  };
}

/**
 * Helper to run LLM evaluation with custom rubrics
 * (Replicates llm-judge logic but with local rubrics)
 */
async function evaluateWithCustomRubrics(question, answer, context, dimensions) {
  const { createOpenAIClient, getOpenAIConfig } = require('../clients/openai');
  const client = createOpenAIClient();
  const config = getOpenAIConfig();
  
  // Build prompt with custom rubrics
  const rubricText = dimensions.map(dim => {
    const rubric = SUMMARY_RUBRICS[dim];
    const criteriaText = rubric.criteria.map(c => `  ${c.score}: ${c.description}`).join('\n');
    return `### ${dim.charAt(0).toUpperCase() + dim.slice(1)}
${rubric.description}
Scoring criteria:
${criteriaText}`;
  }).join('\n\n');

  const prompt = `You are an expert evaluator assessing the quality of a knowledge graph community summary.

## Task
Evaluate the following summary based on the provided rubrics. You must provide a score (1-5) and brief justification for each dimension.

## Community Context (Ground Truth)
${context}

## Summary to Evaluate
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

  try {
    const completion = await client.chat.completions.create({
      model: config.deploymentName,
      messages: [
        { role: 'system', content: 'You are an expert evaluator. Respond only with valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const evaluation = llmJudge.parseEvaluationResponse(responseText, dimensions);

    // Calculate overall score
    const scores = dimensions.map(dim => evaluation[dim].score);
    const overallScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    return {
      dimensions: evaluation,
      overallScore: Math.round(overallScore * 100) / 100
    };
  } catch (error) {
    log.error('Community summary evaluation failed', { error: error.message });
    throw error;
  }
}

/**
 * Evaluate a batch of community summaries
 *
 * @param {Array} items - List of { generatedSummary, groundTruth }
 * @param {Object} options - Options
 * @returns {Promise<Object>} Batch results
 */
async function evaluateBatchCommunitySummaries(items, options = {}) {
  const { concurrency = 3 } = options;
  const results = [];

  // Simple batch processing
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, idx) => {
      try {
        const evaluation = await evaluateCommunitySummary(item);
        return {
          index: i + idx,
          communityId: item.groundTruth.id,
          evaluation,
          success: true
        };
      } catch (error) {
        return {
          index: i + idx,
          communityId: item.groundTruth.id,
          error: error.message,
          success: false
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Aggregation
  const successful = results.filter(r => r.success);
  const aggregate = {
    accuracy: { mean: 0, min: 5, max: 0 },
    relevance: { mean: 0, min: 5, max: 0 },
    coherence: { mean: 0, min: 5, max: 0 },
    entityCoverage: { mean: 0, min: 1, max: 0 },
    overall: { mean: 0, min: 5, max: 0 }
  };

  if (successful.length > 0) {
    // Helper to update stats
    const updateStats = (target, value) => {
      target.sum = (target.sum || 0) + value;
      target.min = Math.min(target.min, value);
      target.max = Math.max(target.max, value);
    };

    successful.forEach(r => {
      updateStats(aggregate.accuracy, r.evaluation.dimensions.accuracy.score);
      updateStats(aggregate.relevance, r.evaluation.dimensions.relevance.score);
      updateStats(aggregate.coherence, r.evaluation.dimensions.coherence.score);
      updateStats(aggregate.entityCoverage, r.evaluation.metrics.entityCoverage);
      updateStats(aggregate.overall, r.evaluation.overallScore);
    });

    // Finalize means
    Object.keys(aggregate).forEach(k => {
      aggregate[k].mean = aggregate[k].sum / successful.length;
      delete aggregate[k].sum;
    });
  }

  return {
    results,
    aggregate,
    itemCount: items.length,
    successCount: successful.length
  };
}

module.exports = {
  evaluateCommunitySummary,
  evaluateBatchCommunitySummaries,
  calculateEntityCoverage,
  SUMMARY_RUBRICS
};
