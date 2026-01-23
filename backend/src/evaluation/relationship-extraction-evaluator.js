/**
 * Relationship Extraction Evaluator
 *
 * Compares extracted relationships against ground truth annotations to measure:
 * - Precision: What fraction of extracted relationships are correct?
 * - Recall: What fraction of true relationships were extracted?
 * - F1: Harmonic mean of precision and recall
 * - Direction Accuracy: What fraction of relationships have correct direction?
 *
 * Supports multiple matching modes:
 * - STRICT: Exact match on normalized entity names AND type AND direction
 * - PARTIAL: Fuzzy name matching (Levenshtein) with exact type and direction
 * - DIRECTION_AGNOSTIC: Allows A->B to match B->A (symmetric matching)
 * - TYPE_ONLY: Correct type regardless of entity names
 *
 * Reference: Knowledge Graph Construction evaluation metrics
 * https://www.mdpi.com/2076-3417/15/7/3727
 *
 * Feature: F1.2.6 - Relationship Extraction Evaluator
 */

const { log } = require('../utils/logger');
const { RELATIONSHIP_TYPES } = require('../prompts/entity-extraction');

/**
 * Matching modes for relationship comparison
 */
const RelationshipMatchingMode = {
  /** Exact match on normalized names AND type AND direction */
  STRICT: 'strict',
  /** Fuzzy name matching with exact type and direction */
  PARTIAL: 'partial',
  /** Allows A->B to match B->A (symmetric relationships) */
  DIRECTION_AGNOSTIC: 'direction_agnostic',
  /** Correct type regardless of entity names */
  TYPE_ONLY: 'type_only'
};

/**
 * Default similarity threshold for partial matching
 */
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/**
 * Normalize an entity name for comparison
 * - Lowercase
 * - Remove extra whitespace
 * - Remove common articles/determiners
 *
 * @param {string} name - Entity name to normalize
 * @returns {string} Normalized name
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }

  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[^\w\s]/g, '');
}

/**
 * Calculate Levenshtein distance between two strings
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;

  // Handle edge cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Create distance matrix
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // Deletion
        dp[i][j - 1] + 1,       // Insertion
        dp[i - 1][j - 1] + cost // Substitution
      );
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity ratio between two strings (0-1)
 * Uses normalized Levenshtein distance
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity ratio between 0 and 1
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const norm1 = normalizeName(str1);
  const norm2 = normalizeName(str2);

  if (norm1 === norm2) return 1;

  const maxLen = Math.max(norm1.length, norm2.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(norm1, norm2);
  return 1 - (distance / maxLen);
}

/**
 * Check if two relationships match based on the specified mode
 *
 * @param {Object} extracted - Extracted relationship
 * @param {Object} groundTruth - Ground truth relationship
 * @param {string} mode - Matching mode
 * @param {number} threshold - Similarity threshold for partial matching
 * @returns {{matches: boolean, similarity: number, typeMatch: boolean, directionMatch: boolean}}
 */
function relationshipsMatch(extracted, groundTruth, mode, threshold = DEFAULT_SIMILARITY_THRESHOLD) {
  // Check type match first
  const typeMatch = extracted.type === groundTruth.type;

  // Calculate entity name similarities
  const fromSimilarity = calculateSimilarity(extracted.from, groundTruth.from);
  const toSimilarity = calculateSimilarity(extracted.to, groundTruth.to);

  // Calculate reversed direction similarities (for DIRECTION_AGNOSTIC mode)
  const reversedFromSimilarity = calculateSimilarity(extracted.from, groundTruth.to);
  const reversedToSimilarity = calculateSimilarity(extracted.to, groundTruth.from);

  // Exact name matches
  const exactFromMatch = normalizeName(extracted.from) === normalizeName(groundTruth.from);
  const exactToMatch = normalizeName(extracted.to) === normalizeName(groundTruth.to);
  const exactReversedFromMatch = normalizeName(extracted.from) === normalizeName(groundTruth.to);
  const exactReversedToMatch = normalizeName(extracted.to) === normalizeName(groundTruth.from);

  // Direction match: true if the direction is preserved (from->to matches)
  const directionMatch = (fromSimilarity >= threshold && toSimilarity >= threshold) ||
                        (exactFromMatch && exactToMatch);

  // Average similarity for the best match
  const forwardSimilarity = (fromSimilarity + toSimilarity) / 2;
  const reversedSimilarity = (reversedFromSimilarity + reversedToSimilarity) / 2;
  const bestSimilarity = Math.max(forwardSimilarity, reversedSimilarity);
  const isReversedMatch = reversedSimilarity > forwardSimilarity;

  switch (mode) {
    case RelationshipMatchingMode.STRICT:
      return {
        matches: exactFromMatch && exactToMatch && typeMatch,
        similarity: forwardSimilarity,
        typeMatch,
        directionMatch: true // Direction is inherently correct in strict mode
      };

    case RelationshipMatchingMode.PARTIAL:
      return {
        matches: fromSimilarity >= threshold && toSimilarity >= threshold && typeMatch,
        similarity: forwardSimilarity,
        typeMatch,
        directionMatch: true // Direction must be correct in partial mode
      };

    case RelationshipMatchingMode.DIRECTION_AGNOSTIC:
      // Allow match if either forward or reversed direction matches
      const forwardMatches = fromSimilarity >= threshold && toSimilarity >= threshold;
      const reversedMatches = reversedFromSimilarity >= threshold && reversedToSimilarity >= threshold;
      return {
        matches: (forwardMatches || reversedMatches) && typeMatch,
        similarity: bestSimilarity,
        typeMatch,
        directionMatch: forwardMatches && !isReversedMatch // True only if forward match was used
      };

    case RelationshipMatchingMode.TYPE_ONLY:
      // Just check type, with minimal entity overlap
      return {
        matches: typeMatch && bestSimilarity > 0.3,
        similarity: bestSimilarity,
        typeMatch,
        directionMatch: forwardSimilarity > reversedSimilarity
      };

    default:
      log.warn(`Unknown matching mode: ${mode}, defaulting to strict`);
      return {
        matches: exactFromMatch && exactToMatch && typeMatch,
        similarity: forwardSimilarity,
        typeMatch,
        directionMatch: true
      };
  }
}

/**
 * Calculate precision, recall, and F1 for a single evaluation
 *
 * @param {number} truePositives - Number of correctly extracted relationships
 * @param {number} falsePositives - Number of incorrectly extracted relationships
 * @param {number} falseNegatives - Number of missed relationships
 * @returns {{precision: number, recall: number, f1: number}}
 */
function calculateMetrics(truePositives, falsePositives, falseNegatives) {
  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : 0;

  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : 0;

  const f1 = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  return { precision, recall, f1 };
}

/**
 * Create an empty result object for error cases
 */
function createEmptyResult() {
  return {
    precision: 0,
    recall: 0,
    f1: 0,
    directionAccuracy: 0,
    truePositives: 0,
    falsePositives: 0,
    falseNegatives: 0,
    totalExtracted: 0,
    totalGroundTruth: 0,
    correctDirections: 0,
    incorrectDirections: 0,
    perTypeMetrics: {},
    matches: [],
    unmatchedExtracted: [],
    unmatchedGroundTruth: [],
    mode: RelationshipMatchingMode.STRICT,
    similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
    evaluatedAt: new Date().toISOString(),
    latencyMs: 0
  };
}

/**
 * Evaluate relationship extraction against ground truth
 *
 * @param {Object} params - Evaluation parameters
 * @param {Object[]} params.extracted - Array of extracted relationships
 * @param {Object[]} params.groundTruth - Array of ground truth relationships
 * @param {Object} options - Evaluation options
 * @param {string} options.mode - Matching mode (strict, partial, direction_agnostic, type_only)
 * @param {number} options.similarityThreshold - Threshold for partial matching
 * @returns {Object} Evaluation results
 */
function evaluateRelationshipExtraction({ extracted, groundTruth }, options = {}) {
  const startTime = Date.now();
  const {
    mode = RelationshipMatchingMode.STRICT,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD
  } = options;

  // Input validation
  if (!extracted || !Array.isArray(extracted)) {
    log.warn('evaluateRelationshipExtraction called with invalid extracted array');
    return createEmptyResult();
  }

  if (!groundTruth || !Array.isArray(groundTruth)) {
    log.warn('evaluateRelationshipExtraction called with invalid groundTruth array');
    return createEmptyResult();
  }

  // Track matches to avoid double counting
  const matchedExtracted = new Set();
  const matchedGroundTruth = new Set();
  const matches = [];
  const falsePositives = [];
  const falseNegatives = [];

  // Per-type tracking
  const perTypeStats = {};
  for (const type of RELATIONSHIP_TYPES) {
    perTypeStats[type] = {
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 0,
      extracted: 0,
      groundTruth: 0,
      correctDirections: 0,
      incorrectDirections: 0
    };
  }

  // Count ground truth per type
  for (const gt of groundTruth) {
    if (perTypeStats[gt.type]) {
      perTypeStats[gt.type].groundTruth++;
    }
  }

  // Count extracted per type
  for (const ext of extracted) {
    if (perTypeStats[ext.type]) {
      perTypeStats[ext.type].extracted++;
    }
  }

  // Find matches using greedy matching (best matches first)
  const matchCandidates = [];

  for (let i = 0; i < extracted.length; i++) {
    for (let j = 0; j < groundTruth.length; j++) {
      const result = relationshipsMatch(extracted[i], groundTruth[j], mode, similarityThreshold);
      if (result.matches) {
        matchCandidates.push({
          extractedIdx: i,
          groundTruthIdx: j,
          similarity: result.similarity,
          directionMatch: result.directionMatch,
          extracted: extracted[i],
          groundTruth: groundTruth[j]
        });
      }
    }
  }

  // Sort by similarity (best matches first) for greedy matching
  matchCandidates.sort((a, b) => b.similarity - a.similarity);

  // Track direction accuracy
  let correctDirections = 0;
  let incorrectDirections = 0;

  // Greedy match assignment
  for (const candidate of matchCandidates) {
    if (!matchedExtracted.has(candidate.extractedIdx) &&
        !matchedGroundTruth.has(candidate.groundTruthIdx)) {
      matchedExtracted.add(candidate.extractedIdx);
      matchedGroundTruth.add(candidate.groundTruthIdx);
      matches.push({
        extracted: candidate.extracted,
        groundTruth: candidate.groundTruth,
        similarity: candidate.similarity,
        directionMatch: candidate.directionMatch
      });

      // Update direction tracking
      if (candidate.directionMatch) {
        correctDirections++;
      } else {
        incorrectDirections++;
      }

      // Update per-type stats
      if (perTypeStats[candidate.groundTruth.type]) {
        perTypeStats[candidate.groundTruth.type].truePositives++;
        if (candidate.directionMatch) {
          perTypeStats[candidate.groundTruth.type].correctDirections++;
        } else {
          perTypeStats[candidate.groundTruth.type].incorrectDirections++;
        }
      }
    }
  }

  // Identify false positives (extracted but not in ground truth)
  for (let i = 0; i < extracted.length; i++) {
    if (!matchedExtracted.has(i)) {
      falsePositives.push(extracted[i]);
      if (perTypeStats[extracted[i].type]) {
        perTypeStats[extracted[i].type].falsePositives++;
      }
    }
  }

  // Identify false negatives (in ground truth but not extracted)
  for (let j = 0; j < groundTruth.length; j++) {
    if (!matchedGroundTruth.has(j)) {
      falseNegatives.push(groundTruth[j]);
      if (perTypeStats[groundTruth[j].type]) {
        perTypeStats[groundTruth[j].type].falseNegatives++;
      }
    }
  }

  // Calculate aggregate metrics
  const truePositives = matches.length;
  const aggregateMetrics = calculateMetrics(
    truePositives,
    falsePositives.length,
    falseNegatives.length
  );

  // Calculate direction accuracy
  const directionAccuracy = truePositives > 0
    ? correctDirections / truePositives
    : 0;

  // Calculate per-type metrics
  const perTypeMetrics = {};
  for (const [type, stats] of Object.entries(perTypeStats)) {
    if (stats.groundTruth > 0 || stats.extracted > 0) {
      const typeDirectionAccuracy = stats.truePositives > 0
        ? stats.correctDirections / stats.truePositives
        : 0;
      perTypeMetrics[type] = {
        ...calculateMetrics(stats.truePositives, stats.falsePositives, stats.falseNegatives),
        support: stats.groundTruth,
        predicted: stats.extracted,
        truePositives: stats.truePositives,
        falsePositives: stats.falsePositives,
        falseNegatives: stats.falseNegatives,
        directionAccuracy: typeDirectionAccuracy,
        correctDirections: stats.correctDirections,
        incorrectDirections: stats.incorrectDirections
      };
    }
  }

  const latencyMs = Date.now() - startTime;

  const result = {
    // Aggregate metrics
    precision: aggregateMetrics.precision,
    recall: aggregateMetrics.recall,
    f1: aggregateMetrics.f1,
    directionAccuracy,

    // Counts
    truePositives,
    falsePositives: falsePositives.length,
    falseNegatives: falseNegatives.length,
    totalExtracted: extracted.length,
    totalGroundTruth: groundTruth.length,
    correctDirections,
    incorrectDirections,

    // Per-type breakdown
    perTypeMetrics,

    // Detailed match information
    matches,
    unmatchedExtracted: falsePositives,
    unmatchedGroundTruth: falseNegatives,

    // Metadata
    mode,
    similarityThreshold,
    evaluatedAt: new Date().toISOString(),
    latencyMs
  };

  log.info('Relationship extraction evaluation complete', {
    mode,
    precision: result.precision.toFixed(4),
    recall: result.recall.toFixed(4),
    f1: result.f1.toFixed(4),
    directionAccuracy: result.directionAccuracy.toFixed(4),
    totalExtracted: result.totalExtracted,
    totalGroundTruth: result.totalGroundTruth
  });

  return result;
}

/**
 * Evaluate relationship extraction for a batch of documents
 *
 * @param {Array<{extracted: Object[], groundTruth: Object[]}>} items - Array of evaluation items
 * @param {Object} options - Evaluation options
 * @returns {Object} Batch evaluation results with aggregate and per-document metrics
 */
function evaluateBatchRelationshipExtraction(items, options = {}) {
  const startTime = Date.now();

  if (!items || !Array.isArray(items) || items.length === 0) {
    log.warn('evaluateBatchRelationshipExtraction called with empty items array');
    return {
      aggregate: createEmptyResult(),
      documents: [],
      documentCount: 0,
      evaluatedAt: new Date().toISOString(),
      latencyMs: 0
    };
  }

  // Evaluate each document
  const documentResults = items.map((item, index) => ({
    documentIndex: index,
    ...evaluateRelationshipExtraction(item, options)
  }));

  // Aggregate results across all documents
  let totalTP = 0;
  let totalFP = 0;
  let totalFN = 0;
  let totalCorrectDirections = 0;
  let totalIncorrectDirections = 0;
  const aggregatePerType = {};

  for (const result of documentResults) {
    totalTP += result.truePositives;
    totalFP += result.falsePositives;
    totalFN += result.falseNegatives;
    totalCorrectDirections += result.correctDirections;
    totalIncorrectDirections += result.incorrectDirections;

    // Aggregate per-type stats
    for (const [type, metrics] of Object.entries(result.perTypeMetrics)) {
      if (!aggregatePerType[type]) {
        aggregatePerType[type] = {
          truePositives: 0,
          falsePositives: 0,
          falseNegatives: 0,
          support: 0,
          predicted: 0,
          correctDirections: 0,
          incorrectDirections: 0
        };
      }
      aggregatePerType[type].truePositives += metrics.truePositives;
      aggregatePerType[type].falsePositives += metrics.falsePositives;
      aggregatePerType[type].falseNegatives += metrics.falseNegatives;
      aggregatePerType[type].support += metrics.support;
      aggregatePerType[type].predicted += metrics.predicted;
      aggregatePerType[type].correctDirections += metrics.correctDirections;
      aggregatePerType[type].incorrectDirections += metrics.incorrectDirections;
    }
  }

  // Calculate aggregate metrics
  const aggregateMetrics = calculateMetrics(totalTP, totalFP, totalFN);
  const directionAccuracy = totalTP > 0 ? totalCorrectDirections / totalTP : 0;

  // Calculate aggregate per-type metrics
  const aggregatePerTypeMetrics = {};
  for (const [type, stats] of Object.entries(aggregatePerType)) {
    const typeDirectionAccuracy = stats.truePositives > 0
      ? stats.correctDirections / stats.truePositives
      : 0;
    aggregatePerTypeMetrics[type] = {
      ...calculateMetrics(stats.truePositives, stats.falsePositives, stats.falseNegatives),
      support: stats.support,
      predicted: stats.predicted,
      truePositives: stats.truePositives,
      falsePositives: stats.falsePositives,
      falseNegatives: stats.falseNegatives,
      directionAccuracy: typeDirectionAccuracy,
      correctDirections: stats.correctDirections,
      incorrectDirections: stats.incorrectDirections
    };
  }

  // Calculate macro-averaged metrics (average across types)
  const typesWithData = Object.values(aggregatePerTypeMetrics).filter(m => m.support > 0);
  const macroMetrics = {
    precision: typesWithData.length > 0
      ? typesWithData.reduce((sum, m) => sum + m.precision, 0) / typesWithData.length
      : 0,
    recall: typesWithData.length > 0
      ? typesWithData.reduce((sum, m) => sum + m.recall, 0) / typesWithData.length
      : 0,
    f1: typesWithData.length > 0
      ? typesWithData.reduce((sum, m) => sum + m.f1, 0) / typesWithData.length
      : 0,
    directionAccuracy: typesWithData.length > 0
      ? typesWithData.reduce((sum, m) => sum + m.directionAccuracy, 0) / typesWithData.length
      : 0
  };

  const latencyMs = Date.now() - startTime;

  const result = {
    aggregate: {
      // Micro-averaged (relationship-level)
      precision: aggregateMetrics.precision,
      recall: aggregateMetrics.recall,
      f1: aggregateMetrics.f1,
      directionAccuracy,

      // Macro-averaged (type-level)
      macroPrecision: macroMetrics.precision,
      macroRecall: macroMetrics.recall,
      macroF1: macroMetrics.f1,
      macroDirectionAccuracy: macroMetrics.directionAccuracy,

      // Counts
      truePositives: totalTP,
      falsePositives: totalFP,
      falseNegatives: totalFN,
      correctDirections: totalCorrectDirections,
      incorrectDirections: totalIncorrectDirections,
      totalExtracted: documentResults.reduce((sum, r) => sum + r.totalExtracted, 0),
      totalGroundTruth: documentResults.reduce((sum, r) => sum + r.totalGroundTruth, 0),

      // Per-type breakdown
      perTypeMetrics: aggregatePerTypeMetrics
    },
    documents: documentResults,
    documentCount: items.length,
    mode: options.mode || RelationshipMatchingMode.STRICT,
    similarityThreshold: options.similarityThreshold || DEFAULT_SIMILARITY_THRESHOLD,
    evaluatedAt: new Date().toISOString(),
    latencyMs
  };

  log.info('Batch relationship extraction evaluation complete', {
    documentCount: result.documentCount,
    microF1: result.aggregate.f1.toFixed(4),
    macroF1: result.aggregate.macroF1.toFixed(4),
    directionAccuracy: result.aggregate.directionAccuracy.toFixed(4),
    totalExtracted: result.aggregate.totalExtracted,
    totalGroundTruth: result.aggregate.totalGroundTruth
  });

  return result;
}

/**
 * Format evaluation results for display
 *
 * @param {Object} result - Evaluation result from evaluateRelationshipExtraction
 * @returns {string} Formatted string
 */
function formatRelationshipEvaluation(result) {
  if (!result) {
    return 'No evaluation results available';
  }

  const lines = [
    'Relationship Extraction Evaluation',
    '='.repeat(55),
    `Mode: ${result.mode}`,
    `Similarity Threshold: ${result.similarityThreshold}`,
    '',
    'Aggregate Metrics:',
    `  Precision:          ${(result.precision * 100).toFixed(2)}%`,
    `  Recall:             ${(result.recall * 100).toFixed(2)}%`,
    `  F1 Score:           ${(result.f1 * 100).toFixed(2)}%`,
    `  Direction Accuracy: ${(result.directionAccuracy * 100).toFixed(2)}%`,
    '',
    'Counts:',
    `  True Positives:     ${result.truePositives}`,
    `  False Positives:    ${result.falsePositives}`,
    `  False Negatives:    ${result.falseNegatives}`,
    `  Correct Directions: ${result.correctDirections}`,
    `  Incorrect Directions: ${result.incorrectDirections}`,
    `  Total Extracted:    ${result.totalExtracted}`,
    `  Total Ground Truth: ${result.totalGroundTruth}`,
    ''
  ];

  // Per-type breakdown
  const typesWithData = Object.entries(result.perTypeMetrics || {})
    .filter(([, m]) => m.support > 0 || m.predicted > 0)
    .sort((a, b) => b[1].support - a[1].support);

  if (typesWithData.length > 0) {
    lines.push('Per-Type Metrics:');
    lines.push('-'.repeat(70));
    lines.push(
      'Type'.padEnd(18) +
      'P'.padStart(7) +
      'R'.padStart(7) +
      'F1'.padStart(7) +
      'Dir'.padStart(7) +
      'Supp'.padStart(8)
    );
    lines.push('-'.repeat(70));

    for (const [type, metrics] of typesWithData) {
      lines.push(
        type.padEnd(18) +
        `${(metrics.precision * 100).toFixed(1)}%`.padStart(7) +
        `${(metrics.recall * 100).toFixed(1)}%`.padStart(7) +
        `${(metrics.f1 * 100).toFixed(1)}%`.padStart(7) +
        `${(metrics.directionAccuracy * 100).toFixed(1)}%`.padStart(7) +
        String(metrics.support).padStart(8)
      );
    }
    lines.push('');
  }

  // Unmatched details (limited for display)
  if (result.unmatchedExtracted && result.unmatchedExtracted.length > 0) {
    lines.push('False Positives (sample):');
    const sample = result.unmatchedExtracted.slice(0, 5);
    for (const rel of sample) {
      lines.push(`  - ${rel.from} -[${rel.type}]-> ${rel.to}`);
    }
    if (result.unmatchedExtracted.length > 5) {
      lines.push(`  ... and ${result.unmatchedExtracted.length - 5} more`);
    }
    lines.push('');
  }

  if (result.unmatchedGroundTruth && result.unmatchedGroundTruth.length > 0) {
    lines.push('False Negatives (sample):');
    const sample = result.unmatchedGroundTruth.slice(0, 5);
    for (const rel of sample) {
      lines.push(`  - ${rel.from} -[${rel.type}]-> ${rel.to}`);
    }
    if (result.unmatchedGroundTruth.length > 5) {
      lines.push(`  ... and ${result.unmatchedGroundTruth.length - 5} more`);
    }
    lines.push('');
  }

  lines.push(`Evaluated at: ${result.evaluatedAt}`);
  lines.push(`Latency: ${result.latencyMs}ms`);

  return lines.join('\n');
}

/**
 * Format batch evaluation results for display
 *
 * @param {Object} result - Batch evaluation result
 * @returns {string} Formatted string
 */
function formatBatchRelationshipEvaluation(result) {
  if (!result || !result.aggregate) {
    return 'No batch evaluation results available';
  }

  const lines = [
    'Batch Relationship Extraction Evaluation',
    '='.repeat(60),
    `Documents Evaluated: ${result.documentCount}`,
    `Mode: ${result.mode}`,
    `Similarity Threshold: ${result.similarityThreshold}`,
    '',
    'Aggregate Metrics (Micro-averaged):',
    `  Precision:          ${(result.aggregate.precision * 100).toFixed(2)}%`,
    `  Recall:             ${(result.aggregate.recall * 100).toFixed(2)}%`,
    `  F1 Score:           ${(result.aggregate.f1 * 100).toFixed(2)}%`,
    `  Direction Accuracy: ${(result.aggregate.directionAccuracy * 100).toFixed(2)}%`,
    '',
    'Aggregate Metrics (Macro-averaged):',
    `  Precision:          ${(result.aggregate.macroPrecision * 100).toFixed(2)}%`,
    `  Recall:             ${(result.aggregate.macroRecall * 100).toFixed(2)}%`,
    `  F1 Score:           ${(result.aggregate.macroF1 * 100).toFixed(2)}%`,
    `  Direction Accuracy: ${(result.aggregate.macroDirectionAccuracy * 100).toFixed(2)}%`,
    '',
    'Total Counts:',
    `  True Positives:     ${result.aggregate.truePositives}`,
    `  False Positives:    ${result.aggregate.falsePositives}`,
    `  False Negatives:    ${result.aggregate.falseNegatives}`,
    `  Correct Directions: ${result.aggregate.correctDirections}`,
    `  Incorrect Directions: ${result.aggregate.incorrectDirections}`,
    `  Total Extracted:    ${result.aggregate.totalExtracted}`,
    `  Total Ground Truth: ${result.aggregate.totalGroundTruth}`,
    ''
  ];

  // Per-type breakdown
  const typesWithData = Object.entries(result.aggregate.perTypeMetrics || {})
    .filter(([, m]) => m.support > 0 || m.predicted > 0)
    .sort((a, b) => b[1].support - a[1].support);

  if (typesWithData.length > 0) {
    lines.push('Per-Type Metrics:');
    lines.push('-'.repeat(75));
    lines.push(
      'Type'.padEnd(18) +
      'P'.padStart(7) +
      'R'.padStart(7) +
      'F1'.padStart(7) +
      'Dir'.padStart(7) +
      'Supp'.padStart(8) +
      'Pred'.padStart(8)
    );
    lines.push('-'.repeat(75));

    for (const [type, metrics] of typesWithData) {
      lines.push(
        type.padEnd(18) +
        `${(metrics.precision * 100).toFixed(1)}%`.padStart(7) +
        `${(metrics.recall * 100).toFixed(1)}%`.padStart(7) +
        `${(metrics.f1 * 100).toFixed(1)}%`.padStart(7) +
        `${(metrics.directionAccuracy * 100).toFixed(1)}%`.padStart(7) +
        String(metrics.support).padStart(8) +
        String(metrics.predicted).padStart(8)
      );
    }
    lines.push('');
  }

  lines.push(`Evaluated at: ${result.evaluatedAt}`);
  lines.push(`Total Latency: ${result.latencyMs}ms`);

  return lines.join('\n');
}

module.exports = {
  // Core evaluation functions
  evaluateRelationshipExtraction,
  evaluateBatchRelationshipExtraction,

  // Formatting functions
  formatRelationshipEvaluation,
  formatBatchRelationshipEvaluation,

  // Matching modes
  RelationshipMatchingMode,

  // Utility functions (exported for testing)
  normalizeName,
  calculateSimilarity,
  relationshipsMatch,
  calculateMetrics,

  // Constants
  DEFAULT_SIMILARITY_THRESHOLD
};
