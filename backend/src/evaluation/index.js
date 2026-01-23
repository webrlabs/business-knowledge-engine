/**
 * Evaluation Module
 *
 * Exports evaluation tools for measuring system quality:
 * - Retrieval metrics (Precision, Recall, MRR, NDCG)
 * - LLM-as-Judge evaluator (Helpfulness, Accuracy, Completeness)
 * - Grounding Score Calculator (Hallucination detection)
 * - Citation Accuracy Checker (Citation verification)
 * - Entity Extraction Evaluator (Precision, Recall, F1 for entities)
 * - Relationship Extraction Evaluator (Precision, Recall, F1, Direction Accuracy for relationships)
 * - Results Storage Service (Persistent storage for benchmark results) - F1.3.2
 * - Dashboard Service (Visual dashboards and trend reports) - F1.3.5
 */

const metrics = require('./metrics');
const llmJudge = require('./llm-judge');
const groundingScore = require('./grounding-score');
const citationAccuracy = require('./citation-accuracy');
const entityExtractionEvaluator = require('./entity-extraction-evaluator');
const relationshipExtractionEvaluator = require('./relationship-extraction-evaluator');
const resultsStorageService = require('./results-storage-service');
const chunkingComparison = require('./chunking-comparison');
const dashboardService = require('./dashboard-service');

module.exports = {
  // Retrieval metrics
  ...metrics,

  // LLM-as-Judge evaluation
  evaluateAnswer: llmJudge.evaluateAnswer,
  evaluateBatch: llmJudge.evaluateBatch,
  formatEvaluation: llmJudge.formatEvaluation,
  formatBatchEvaluation: llmJudge.formatBatchEvaluation,
  getRubrics: llmJudge.getRubrics,
  RUBRICS: llmJudge.RUBRICS,

  // Grounding Score Calculator (F1.2.3)
  calculateGroundingScore: groundingScore.calculateGroundingScore,
  calculateBatchGroundingScore: groundingScore.calculateBatchGroundingScore,
  quickGroundingCheck: groundingScore.quickGroundingCheck,
  formatGroundingScore: groundingScore.formatGroundingScore,
  formatBatchGroundingScore: groundingScore.formatBatchGroundingScore,
  ClaimStatus: groundingScore.ClaimStatus,
  STATUS_WEIGHTS: groundingScore.STATUS_WEIGHTS,

  // Citation Accuracy Checker (F1.2.2)
  calculateCitationAccuracy: citationAccuracy.calculateCitationAccuracy,
  calculateBatchCitationAccuracy: citationAccuracy.calculateBatchCitationAccuracy,
  quickCitationCheck: citationAccuracy.quickCitationCheck,
  formatCitationAccuracy: citationAccuracy.formatCitationAccuracy,
  formatBatchCitationAccuracy: citationAccuracy.formatBatchCitationAccuracy,
  extractCitations: citationAccuracy.extractCitations,
  CitationStatus: citationAccuracy.CitationStatus,
  CITATION_STATUS_WEIGHTS: citationAccuracy.STATUS_WEIGHTS,

  // Entity Extraction Evaluator (F1.2.5)
  evaluateEntityExtraction: entityExtractionEvaluator.evaluateEntityExtraction,
  evaluateBatchEntityExtraction: entityExtractionEvaluator.evaluateBatchEntityExtraction,
  formatEntityEvaluation: entityExtractionEvaluator.formatEntityEvaluation,
  formatBatchEntityEvaluation: entityExtractionEvaluator.formatBatchEntityEvaluation,
  MatchingMode: entityExtractionEvaluator.MatchingMode,
  normalizeName: entityExtractionEvaluator.normalizeName,
  calculateSimilarity: entityExtractionEvaluator.calculateSimilarity,

  // Relationship Extraction Evaluator (F1.2.6)
  evaluateRelationshipExtraction: relationshipExtractionEvaluator.evaluateRelationshipExtraction,
  evaluateBatchRelationshipExtraction: relationshipExtractionEvaluator.evaluateBatchRelationshipExtraction,
  formatRelationshipEvaluation: relationshipExtractionEvaluator.formatRelationshipEvaluation,
  formatBatchRelationshipEvaluation: relationshipExtractionEvaluator.formatBatchRelationshipEvaluation,
  RelationshipMatchingMode: relationshipExtractionEvaluator.RelationshipMatchingMode,
  relationshipsMatch: relationshipExtractionEvaluator.relationshipsMatch,

  // Results Storage Service (F1.3.2)
  ResultsStorageService: resultsStorageService.ResultsStorageService,
  getResultsStorageService: resultsStorageService.getResultsStorageService,
  RESULTS_STORAGE_CONFIG: resultsStorageService.CONFIG,
  RESULTS_DOC_TYPES: resultsStorageService.DOC_TYPES,
  STORAGE_BACKENDS: resultsStorageService.STORAGE_BACKENDS,

  // A/B Chunking Comparison (F4.1.4)
  compareChunkingStrategies: chunkingComparison.compareChunkingStrategies,
  runComparisonBenchmark: chunkingComparison.runComparisonBenchmark,
  formatComparisonReport: chunkingComparison.formatComparisonReport,
  createFixedChunks: chunkingComparison.createFixedChunks,
  DEFAULT_FIXED_CHUNKING_CONFIG: chunkingComparison.DEFAULT_FIXED_CONFIG,
  DEFAULT_SEMANTIC_CHUNKING_CONFIG: chunkingComparison.DEFAULT_SEMANTIC_CONFIG,

  // Dashboard Service (F1.3.5)
  DashboardService: dashboardService.DashboardService,
  getDashboardService: dashboardService.getDashboardService,
  generateSparkline: dashboardService.generateSparkline,
  DASHBOARD_CONFIG: dashboardService.CONFIG
};
