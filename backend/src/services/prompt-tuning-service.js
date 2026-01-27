/**
 * Prompt Tuning Service
 *
 * Manages A/B testing of extraction prompts to identify which prompt variants
 * perform best for entity and relationship extraction.
 *
 * Features:
 * - Create and manage A/B test experiments
 * - Assign documents to variants based on allocation percentages
 * - Track extraction results per variant (entities, relationships, latency)
 * - Compare performance metrics across variants
 * - Store results for trend analysis
 *
 * Feature: F4.3.6 - Extraction Prompt Tuning
 */

const { log } = require('../utils/logger');
const {
  PromptVariantId,
  PROMPT_VARIANTS,
  getPromptVariant,
  getAllPromptVariants,
  getPromptVariantList,
  isValidVariant
} = require('../prompts/prompt-variants');
const { getOpenAIService } = require('./openai-service');
const { ENTITY_TYPES, RELATIONSHIP_TYPES } = require('../prompts/entity-extraction');

/**
 * Experiment status values
 */
const ExperimentStatus = {
  DRAFT: 'draft',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ARCHIVED: 'archived'
};

/**
 * Default experiment configuration
 */
const DEFAULT_EXPERIMENT_CONFIG = {
  minSamplesPerVariant: 10,
  maxDurationDays: 30,
  confidenceLevel: 0.95,
  primaryMetric: 'f1'
};

/**
 * In-memory storage for experiments (will be replaced with Cosmos DB)
 */
let experimentsStore = new Map();
let extractionResultsStore = new Map();
let experimentIdCounter = 1;

/**
 * PromptTuningService - Manages A/B testing of extraction prompts
 */
class PromptTuningService {
  constructor() {
    this.openaiService = getOpenAIService();
    this.activeExperiment = null;
  }

  // ============================================================
  // EXPERIMENT MANAGEMENT
  // ============================================================

  /**
   * Create a new A/B test experiment
   * @param {Object} config - Experiment configuration
   * @returns {Object} Created experiment
   */
  createExperiment(config) {
    const {
      name,
      description = '',
      variants = [PromptVariantId.BASELINE, PromptVariantId.FEW_SHOT],
      allocation = null,
      minSamplesPerVariant = DEFAULT_EXPERIMENT_CONFIG.minSamplesPerVariant,
      primaryMetric = DEFAULT_EXPERIMENT_CONFIG.primaryMetric
    } = config;

    // Validate variants
    for (const variantId of variants) {
      if (!isValidVariant(variantId)) {
        throw new Error(`Invalid variant ID: ${variantId}`);
      }
    }

    if (variants.length < 2) {
      throw new Error('Experiment requires at least 2 variants');
    }

    // Calculate default equal allocation if not provided
    const variantAllocation = allocation || this._calculateEqualAllocation(variants);

    // Validate allocation sums to 100
    const allocationSum = Object.values(variantAllocation).reduce((sum, val) => sum + val, 0);
    if (Math.abs(allocationSum - 100) > 0.01) {
      throw new Error(`Allocation percentages must sum to 100, got ${allocationSum}`);
    }

    const experimentId = `exp_${experimentIdCounter++}_${Date.now()}`;
    const experiment = {
      id: experimentId,
      name,
      description,
      status: ExperimentStatus.DRAFT,
      variants,
      allocation: variantAllocation,
      minSamplesPerVariant,
      primaryMetric,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      results: this._initializeResults(variants),
      metadata: {
        totalDocuments: 0,
        documentsPerVariant: Object.fromEntries(variants.map(v => [v, 0]))
      }
    };

    experimentsStore.set(experimentId, experiment);
    log.info('Created prompt tuning experiment', { experimentId, name, variants });

    return experiment;
  }

  /**
   * Start an experiment
   * @param {string} experimentId - Experiment ID
   * @returns {Object} Updated experiment
   */
  startExperiment(experimentId) {
    const experiment = this._getExperimentOrThrow(experimentId);

    if (experiment.status === ExperimentStatus.RUNNING) {
      throw new Error('Experiment is already running');
    }

    if (experiment.status === ExperimentStatus.COMPLETED) {
      throw new Error('Cannot start a completed experiment');
    }

    // Check for other running experiments
    if (this.activeExperiment && this.activeExperiment !== experimentId) {
      throw new Error(`Another experiment is already running: ${this.activeExperiment}`);
    }

    experiment.status = ExperimentStatus.RUNNING;
    experiment.startedAt = new Date().toISOString();
    this.activeExperiment = experimentId;

    log.info('Started prompt tuning experiment', { experimentId });
    return experiment;
  }

  /**
   * Pause a running experiment
   * @param {string} experimentId - Experiment ID
   * @returns {Object} Updated experiment
   */
  pauseExperiment(experimentId) {
    const experiment = this._getExperimentOrThrow(experimentId);

    if (experiment.status !== ExperimentStatus.RUNNING) {
      throw new Error('Can only pause a running experiment');
    }

    experiment.status = ExperimentStatus.PAUSED;
    this.activeExperiment = null;

    log.info('Paused prompt tuning experiment', { experimentId });
    return experiment;
  }

  /**
   * Complete an experiment and calculate final results
   * @param {string} experimentId - Experiment ID
   * @returns {Object} Completed experiment with final analysis
   */
  completeExperiment(experimentId) {
    const experiment = this._getExperimentOrThrow(experimentId);

    if (experiment.status === ExperimentStatus.COMPLETED) {
      throw new Error('Experiment is already completed');
    }

    // Calculate final results
    const analysis = this.analyzeExperiment(experimentId);

    experiment.status = ExperimentStatus.COMPLETED;
    experiment.completedAt = new Date().toISOString();
    experiment.finalAnalysis = analysis;

    if (this.activeExperiment === experimentId) {
      this.activeExperiment = null;
    }

    log.info('Completed prompt tuning experiment', {
      experimentId,
      winner: analysis.winner,
      improvement: analysis.improvementPercent
    });

    return experiment;
  }

  /**
   * Get an experiment by ID
   * @param {string} experimentId - Experiment ID
   * @returns {Object|null} Experiment or null
   */
  getExperiment(experimentId) {
    return experimentsStore.get(experimentId) || null;
  }

  /**
   * Get all experiments
   * @param {Object} options - Filter options
   * @returns {Object[]} Array of experiments
   */
  listExperiments(options = {}) {
    const { status, limit = 50 } = options;

    let experiments = Array.from(experimentsStore.values());

    if (status) {
      experiments = experiments.filter(e => e.status === status);
    }

    // Sort by creation date, newest first
    experiments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return experiments.slice(0, limit);
  }

  /**
   * Get the currently active experiment
   * @returns {Object|null} Active experiment or null
   */
  getActiveExperiment() {
    if (!this.activeExperiment) {
      return null;
    }
    return experimentsStore.get(this.activeExperiment) || null;
  }

  /**
   * Delete an experiment
   * @param {string} experimentId - Experiment ID
   */
  deleteExperiment(experimentId) {
    const experiment = this._getExperimentOrThrow(experimentId);

    if (experiment.status === ExperimentStatus.RUNNING) {
      throw new Error('Cannot delete a running experiment');
    }

    experimentsStore.delete(experimentId);

    // Clean up extraction results
    for (const [key, result] of extractionResultsStore) {
      if (result.experimentId === experimentId) {
        extractionResultsStore.delete(key);
      }
    }

    log.info('Deleted prompt tuning experiment', { experimentId });
  }

  // ============================================================
  // VARIANT ASSIGNMENT & EXTRACTION
  // ============================================================

  /**
   * Assign a document to a variant based on experiment allocation
   * @param {string} documentId - Document ID
   * @returns {string} Assigned variant ID
   */
  assignVariant(documentId) {
    const experiment = this.getActiveExperiment();

    if (!experiment) {
      // No active experiment, use baseline
      return PromptVariantId.BASELINE;
    }

    // Use deterministic assignment based on document ID hash
    const hash = this._hashString(documentId);
    const bucket = hash % 100;

    let cumulative = 0;
    for (const [variantId, percentage] of Object.entries(experiment.allocation)) {
      cumulative += percentage;
      if (bucket < cumulative) {
        return variantId;
      }
    }

    // Fallback to first variant
    return experiment.variants[0];
  }

  /**
   * Extract entities using a specific variant
   * @param {string} text - Text to extract from
   * @param {Object} documentContext - Document context
   * @param {string} variantId - Variant to use
   * @returns {Object} Extraction results
   */
  async extractEntitiesWithVariant(text, documentContext = {}, variantId = null) {
    const variant = this._getVariantOrDefault(variantId);
    const startTime = Date.now();

    try {
      const userPrompt = variant.buildEntityPrompt(text, documentContext);

      const response = await this.openaiService.getJsonCompletion([
        { role: 'system', content: variant.entitySystemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      // Parse response (some variants have custom parsers)
      let parsedResponse = response.content;
      if (variant.parseEntityResponse) {
        parsedResponse = variant.parseEntityResponse(parsedResponse);
      }

      const entities = parsedResponse?.entities || [];
      const latencyMs = Date.now() - startTime;

      // Validate and normalize entities
      const validatedEntities = entities
        .filter(e => e.name && e.type)
        .map(e => ({
          name: this._normalizeEntityName(e.name),
          type: ENTITY_TYPES.includes(e.type) ? e.type : 'Unknown',
          description: e.description || '',
          confidence: typeof e.confidence === 'number' ? Math.min(1, Math.max(0, e.confidence)) : 0.8,
          sourceSpan: e.sourceSpan || ''
        }));

      return {
        entities: validatedEntities,
        variantId: variant.id,
        latencyMs,
        rawEntityCount: entities.length,
        validEntityCount: validatedEntities.length
      };
    } catch (error) {
      log.error('Entity extraction failed', { variantId: variant.id, error: error.message });
      throw error;
    }
  }

  /**
   * Extract relationships using a specific variant
   * @param {string} text - Text to extract from
   * @param {Object[]} entities - Entities found in text
   * @param {Object} documentContext - Document context
   * @param {string} variantId - Variant to use
   * @returns {Object} Extraction results
   */
  async extractRelationshipsWithVariant(text, entities, documentContext = {}, variantId = null) {
    if (!entities || entities.length < 2) {
      return { relationships: [], variantId: variantId || PromptVariantId.BASELINE, latencyMs: 0 };
    }

    const variant = this._getVariantOrDefault(variantId);
    const startTime = Date.now();

    try {
      const userPrompt = variant.buildRelationshipPrompt(text, entities);

      const response = await this.openaiService.getJsonCompletion([
        { role: 'system', content: variant.relationshipSystemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      // Parse response
      let parsedResponse = response.content;
      if (variant.parseRelationshipResponse) {
        parsedResponse = variant.parseRelationshipResponse(parsedResponse);
      }

      const relationships = parsedResponse?.relationships || [];
      const latencyMs = Date.now() - startTime;

      // Validate relationships
      const entityNames = new Set(entities.map(e => e.name));
      const validatedRelationships = relationships
        .filter(r => {
          const fromExists = entityNames.has(r.from) || this._fuzzyMatchEntity(r.from, entityNames);
          const toExists = entityNames.has(r.to) || this._fuzzyMatchEntity(r.to, entityNames);
          return fromExists && toExists && r.type;
        })
        .map(r => ({
          from: this._resolveEntityName(r.from, entityNames),
          to: this._resolveEntityName(r.to, entityNames),
          type: RELATIONSHIP_TYPES.includes(r.type) ? r.type : 'RELATED_TO',
          confidence: typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0.7,
          evidence: r.evidence || ''
        }));

      return {
        relationships: validatedRelationships,
        variantId: variant.id,
        latencyMs,
        rawRelationshipCount: relationships.length,
        validRelationshipCount: validatedRelationships.length
      };
    } catch (error) {
      log.error('Relationship extraction failed', { variantId: variant.id, error: error.message });
      throw error;
    }
  }

  // ============================================================
  // RESULT TRACKING
  // ============================================================

  /**
   * Record extraction results for an experiment
   * @param {Object} params - Recording parameters
   */
  recordExtractionResult(params) {
    const {
      experimentId,
      documentId,
      variantId,
      entityResult,
      relationshipResult,
      groundTruth = null
    } = params;

    const experiment = experimentsStore.get(experimentId);
    if (!experiment) {
      log.warn('Attempted to record result for unknown experiment', { experimentId });
      return;
    }

    const resultId = `${experimentId}_${documentId}_${variantId}`;
    const result = {
      id: resultId,
      experimentId,
      documentId,
      variantId,
      timestamp: new Date().toISOString(),
      entityResult: {
        count: entityResult.entities?.length || 0,
        latencyMs: entityResult.latencyMs || 0,
        entities: entityResult.entities || []
      },
      relationshipResult: {
        count: relationshipResult?.relationships?.length || 0,
        latencyMs: relationshipResult?.latencyMs || 0,
        relationships: relationshipResult?.relationships || []
      },
      groundTruth
    };

    extractionResultsStore.set(resultId, result);

    // Update experiment aggregates
    const variantResults = experiment.results[variantId];
    if (variantResults) {
      variantResults.totalDocuments++;
      variantResults.totalEntities += result.entityResult.count;
      variantResults.totalRelationships += result.relationshipResult.count;
      variantResults.totalEntityLatencyMs += result.entityResult.latencyMs;
      variantResults.totalRelationshipLatencyMs += result.relationshipResult.latencyMs;

      // Calculate running averages
      variantResults.avgEntitiesPerDoc = variantResults.totalEntities / variantResults.totalDocuments;
      variantResults.avgRelationshipsPerDoc = variantResults.totalRelationships / variantResults.totalDocuments;
      variantResults.avgEntityLatencyMs = variantResults.totalEntityLatencyMs / variantResults.totalDocuments;
      variantResults.avgRelationshipLatencyMs = variantResults.totalRelationshipLatencyMs / variantResults.totalDocuments;
    }

    // Update metadata
    experiment.metadata.totalDocuments++;
    if (experiment.metadata.documentsPerVariant[variantId] !== undefined) {
      experiment.metadata.documentsPerVariant[variantId]++;
    }

    log.debug('Recorded extraction result', {
      experimentId,
      documentId,
      variantId,
      entities: result.entityResult.count,
      relationships: result.relationshipResult.count
    });
  }

  /**
   * Get extraction results for an experiment
   * @param {string} experimentId - Experiment ID
   * @param {Object} options - Query options
   * @returns {Object[]} Extraction results
   */
  getExtractionResults(experimentId, options = {}) {
    const { variantId, limit = 100 } = options;

    const results = [];
    for (const result of extractionResultsStore.values()) {
      if (result.experimentId === experimentId) {
        if (!variantId || result.variantId === variantId) {
          results.push(result);
        }
      }
    }

    return results.slice(0, limit);
  }

  // ============================================================
  // ANALYSIS & COMPARISON
  // ============================================================

  /**
   * Analyze experiment results and determine winner
   * @param {string} experimentId - Experiment ID
   * @returns {Object} Analysis results
   */
  analyzeExperiment(experimentId) {
    const experiment = this._getExperimentOrThrow(experimentId);
    const variantMetrics = {};

    // Calculate metrics for each variant
    for (const variantId of experiment.variants) {
      const results = experiment.results[variantId];
      const variantData = getPromptVariant(variantId);

      variantMetrics[variantId] = {
        id: variantId,
        name: variantData?.name || variantId,
        totalDocuments: results.totalDocuments,
        avgEntitiesPerDoc: results.avgEntitiesPerDoc || 0,
        avgRelationshipsPerDoc: results.avgRelationshipsPerDoc || 0,
        avgEntityLatencyMs: results.avgEntityLatencyMs || 0,
        avgRelationshipLatencyMs: results.avgRelationshipLatencyMs || 0,
        totalLatencyMs: (results.avgEntityLatencyMs || 0) + (results.avgRelationshipLatencyMs || 0)
      };

      // Calculate evaluation metrics if ground truth is available
      const variantResults = this.getExtractionResults(experimentId, { variantId });
      const withGroundTruth = variantResults.filter(r => r.groundTruth);

      if (withGroundTruth.length > 0) {
        const evalMetrics = this._calculateEvaluationMetrics(withGroundTruth);
        variantMetrics[variantId] = { ...variantMetrics[variantId], ...evalMetrics };
      }
    }

    // Determine winner based on primary metric
    const primaryMetric = experiment.primaryMetric || 'avgEntitiesPerDoc';
    let winner = null;
    let bestValue = -Infinity;

    // For latency, lower is better
    const lowerIsBetter = primaryMetric.includes('latency') || primaryMetric.includes('Latency');

    for (const [variantId, metrics] of Object.entries(variantMetrics)) {
      const value = metrics[primaryMetric] || 0;
      const isBetter = lowerIsBetter ? value < bestValue : value > bestValue;

      if (winner === null || isBetter) {
        winner = variantId;
        bestValue = value;
      }
    }

    // Calculate improvement vs baseline
    const baselineMetrics = variantMetrics[PromptVariantId.BASELINE];
    let improvementPercent = 0;
    if (baselineMetrics && winner !== PromptVariantId.BASELINE) {
      const baselineValue = baselineMetrics[primaryMetric] || 0;
      const winnerValue = variantMetrics[winner][primaryMetric] || 0;

      if (baselineValue !== 0) {
        if (lowerIsBetter) {
          improvementPercent = ((baselineValue - winnerValue) / baselineValue) * 100;
        } else {
          improvementPercent = ((winnerValue - baselineValue) / baselineValue) * 100;
        }
      }
    }

    // Check statistical significance
    const hasMinSamples = Object.values(variantMetrics)
      .every(m => m.totalDocuments >= experiment.minSamplesPerVariant);

    return {
      experimentId,
      primaryMetric,
      winner,
      winnerName: variantMetrics[winner]?.name,
      improvementPercent: Math.round(improvementPercent * 100) / 100,
      hasMinSamples,
      isStatisticallySignificant: hasMinSamples, // Simplified for now
      variantMetrics,
      analyzedAt: new Date().toISOString()
    };
  }

  /**
   * Generate a comparison report for an experiment
   * @param {string} experimentId - Experiment ID
   * @param {string} format - Output format ('json', 'markdown', 'text')
   * @returns {Object|string} Comparison report
   */
  generateComparisonReport(experimentId, format = 'json') {
    const experiment = this._getExperimentOrThrow(experimentId);
    const analysis = this.analyzeExperiment(experimentId);

    const report = {
      experiment: {
        id: experiment.id,
        name: experiment.name,
        description: experiment.description,
        status: experiment.status,
        startedAt: experiment.startedAt,
        completedAt: experiment.completedAt
      },
      summary: {
        totalDocuments: experiment.metadata.totalDocuments,
        primaryMetric: analysis.primaryMetric,
        winner: analysis.winner,
        winnerName: analysis.winnerName,
        improvementPercent: analysis.improvementPercent,
        hasMinSamples: analysis.hasMinSamples
      },
      variants: Object.entries(analysis.variantMetrics).map(([id, metrics]) => ({
        ...metrics,
        isWinner: id === analysis.winner,
        allocation: experiment.allocation[id]
      })),
      generatedAt: new Date().toISOString()
    };

    if (format === 'json') {
      return report;
    }

    if (format === 'markdown') {
      return this._formatReportMarkdown(report);
    }

    return this._formatReportText(report);
  }

  // ============================================================
  // VARIANT INFO
  // ============================================================

  /**
   * Get available prompt variants
   * @returns {Object[]} Array of variant metadata
   */
  getAvailableVariants() {
    return getPromptVariantList();
  }

  /**
   * Get variant details
   * @param {string} variantId - Variant ID
   * @returns {Object|null} Variant details (without full prompts)
   */
  getVariantInfo(variantId) {
    const variant = getPromptVariant(variantId);
    if (!variant) {
      return null;
    }

    return {
      id: variant.id,
      name: variant.name,
      description: variant.description,
      hypothesis: variant.hypothesis,
      createdAt: variant.createdAt,
      promptLength: {
        entitySystem: variant.entitySystemPrompt.length,
        relationshipSystem: variant.relationshipSystemPrompt.length
      }
    };
  }

  // ============================================================
  // PRIVATE HELPER METHODS
  // ============================================================

  _getExperimentOrThrow(experimentId) {
    const experiment = experimentsStore.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }
    return experiment;
  }

  _getVariantOrDefault(variantId) {
    if (variantId && isValidVariant(variantId)) {
      return getPromptVariant(variantId);
    }
    return getPromptVariant(PromptVariantId.BASELINE);
  }

  _calculateEqualAllocation(variants) {
    const percentage = Math.floor(100 / variants.length);
    const allocation = {};

    for (let i = 0; i < variants.length; i++) {
      if (i === variants.length - 1) {
        // Last variant gets remainder to ensure sum is exactly 100
        allocation[variants[i]] = 100 - (percentage * (variants.length - 1));
      } else {
        allocation[variants[i]] = percentage;
      }
    }

    return allocation;
  }

  _initializeResults(variants) {
    const results = {};
    for (const variantId of variants) {
      results[variantId] = {
        totalDocuments: 0,
        totalEntities: 0,
        totalRelationships: 0,
        totalEntityLatencyMs: 0,
        totalRelationshipLatencyMs: 0,
        avgEntitiesPerDoc: 0,
        avgRelationshipsPerDoc: 0,
        avgEntityLatencyMs: 0,
        avgRelationshipLatencyMs: 0
      };
    }
    return results;
  }

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  _normalizeEntityName(name) {
    if (!name) return '';
    return name
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  _fuzzyMatchEntity(name, entityNames) {
    const normalizedName = this._normalizeEntityName(name).toLowerCase();
    for (const existingName of entityNames) {
      const normalizedExisting = existingName.toLowerCase();
      if (normalizedName === normalizedExisting ||
          normalizedName.includes(normalizedExisting) ||
          normalizedExisting.includes(normalizedName)) {
        return true;
      }
    }
    return false;
  }

  _resolveEntityName(name, entityNames) {
    if (entityNames.has(name)) return name;

    const normalizedName = this._normalizeEntityName(name);
    if (entityNames.has(normalizedName)) return normalizedName;

    const lowerName = normalizedName.toLowerCase();
    for (const existingName of entityNames) {
      if (existingName.toLowerCase() === lowerName) {
        return existingName;
      }
    }
    return normalizedName;
  }

  _calculateEvaluationMetrics(results) {
    // Simplified evaluation metrics calculation
    // In production, would use the full entity-extraction-evaluator
    let totalTP = 0;
    let totalFP = 0;
    let totalFN = 0;

    for (const result of results) {
      if (!result.groundTruth) continue;

      const extractedNames = new Set(result.entityResult.entities.map(e => e.name.toLowerCase()));
      const groundTruthNames = new Set((result.groundTruth.entities || []).map(e => e.name.toLowerCase()));

      for (const name of extractedNames) {
        if (groundTruthNames.has(name)) {
          totalTP++;
        } else {
          totalFP++;
        }
      }

      for (const name of groundTruthNames) {
        if (!extractedNames.has(name)) {
          totalFN++;
        }
      }
    }

    const precision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 0;
    const recall = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      evaluatedDocuments: results.length
    };
  }

  _formatReportMarkdown(report) {
    const lines = [
      `# Prompt Tuning Experiment Report`,
      '',
      `## ${report.experiment.name}`,
      '',
      report.experiment.description || '_No description_',
      '',
      `**Status:** ${report.experiment.status}`,
      `**Started:** ${report.experiment.startedAt || 'N/A'}`,
      `**Completed:** ${report.experiment.completedAt || 'N/A'}`,
      '',
      '## Summary',
      '',
      `- **Total Documents:** ${report.summary.totalDocuments}`,
      `- **Primary Metric:** ${report.summary.primaryMetric}`,
      `- **Winner:** ${report.summary.winnerName} (${report.summary.winner})`,
      `- **Improvement vs Baseline:** ${report.summary.improvementPercent}%`,
      `- **Min Samples Reached:** ${report.summary.hasMinSamples ? 'Yes' : 'No'}`,
      '',
      '## Variant Comparison',
      '',
      '| Variant | Documents | Avg Entities | Avg Relationships | Avg Latency (ms) | Winner |',
      '|---------|-----------|--------------|-------------------|------------------|--------|'
    ];

    for (const v of report.variants) {
      const winnerMark = v.isWinner ? '✓' : '';
      lines.push(
        `| ${v.name} | ${v.totalDocuments} | ${v.avgEntitiesPerDoc.toFixed(1)} | ${v.avgRelationshipsPerDoc.toFixed(1)} | ${v.totalLatencyMs.toFixed(0)} | ${winnerMark} |`
      );
    }

    lines.push('', `_Generated at ${report.generatedAt}_`);

    return lines.join('\n');
  }

  _formatReportText(report) {
    const lines = [
      '='.repeat(60),
      `PROMPT TUNING EXPERIMENT REPORT`,
      '='.repeat(60),
      '',
      `Experiment: ${report.experiment.name}`,
      `Status: ${report.experiment.status}`,
      '',
      'SUMMARY:',
      '-'.repeat(40),
      `Total Documents: ${report.summary.totalDocuments}`,
      `Primary Metric: ${report.summary.primaryMetric}`,
      `Winner: ${report.summary.winnerName}`,
      `Improvement: ${report.summary.improvementPercent}%`,
      '',
      'VARIANT COMPARISON:',
      '-'.repeat(40)
    ];

    for (const v of report.variants) {
      const winnerMark = v.isWinner ? ' [WINNER]' : '';
      lines.push(`${v.name}${winnerMark}`);
      lines.push(`  Documents: ${v.totalDocuments}`);
      lines.push(`  Avg Entities: ${v.avgEntitiesPerDoc.toFixed(2)}`);
      lines.push(`  Avg Relationships: ${v.avgRelationshipsPerDoc.toFixed(2)}`);
      lines.push(`  Avg Latency: ${v.totalLatencyMs.toFixed(0)}ms`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ============================================================
  // TESTING/RESET UTILITIES
  // ============================================================

  /**
   * Reset all experiments (for testing)
   */
  _resetForTesting() {
    experimentsStore.clear();
    extractionResultsStore.clear();
    experimentIdCounter = 1;
    this.activeExperiment = null;
  }

  /**
   * Get statistics about the service
   * @returns {Object} Service statistics
   */
  getStats() {
    const experiments = Array.from(experimentsStore.values());
    return {
      totalExperiments: experiments.length,
      activeExperiment: this.activeExperiment,
      experimentsByStatus: {
        draft: experiments.filter(e => e.status === ExperimentStatus.DRAFT).length,
        running: experiments.filter(e => e.status === ExperimentStatus.RUNNING).length,
        paused: experiments.filter(e => e.status === ExperimentStatus.PAUSED).length,
        completed: experiments.filter(e => e.status === ExperimentStatus.COMPLETED).length
      },
      totalExtractionResults: extractionResultsStore.size,
      availableVariants: Object.keys(PROMPT_VARIANTS).length
    };
  }
}

// Singleton instance
let instance = null;

function getPromptTuningService() {
  if (!instance) {
    instance = new PromptTuningService();
  }
  return instance;
}

module.exports = {
  PromptTuningService,
  getPromptTuningService,
  ExperimentStatus,
  DEFAULT_EXPERIMENT_CONFIG
};
