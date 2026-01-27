/**
 * Dataset Validator
 *
 * Validates benchmark datasets for completeness and schema compliance.
 * Used to ensure Q&A benchmark datasets meet requirements before evaluation.
 *
 * Feature: F1.1.1 - Q&A Benchmark Dataset
 */

const fs = require('fs');
const path = require('path');

/**
 * Valid categories for Q&A items
 */
const VALID_CATEGORIES = ['operational', 'technical', 'compliance', 'leadership'];

/**
 * Valid personas
 */
const VALID_PERSONAS = ['Ops', 'IT', 'Compliance', 'Leadership', 'Default'];

/**
 * Valid expected outcomes for negative tests
 */
const VALID_NEGATIVE_OUTCOMES = ['insufficient_information', 'not_found', 'out_of_scope'];

/**
 * Validation result structure
 */
class ValidationResult {
  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
    this.stats = {};
  }

  addError(message, path = null) {
    this.valid = false;
    this.errors.push({ message, path });
  }

  addWarning(message, path = null) {
    this.warnings.push({ message, path });
  }
}

/**
 * Validate dataset metadata
 *
 * @param {Object} metadata - Dataset metadata
 * @param {ValidationResult} result - Validation result to update
 */
function validateMetadata(metadata, result) {
  if (!metadata) {
    result.addError('Missing metadata section');
    return;
  }

  const requiredFields = ['name', 'version', 'created', 'description'];
  for (const field of requiredFields) {
    if (!metadata[field]) {
      result.addError(`Missing required metadata field: ${field}`, `metadata.${field}`);
    }
  }

  // Validate date format
  if (metadata.created && !/^\d{4}-\d{2}-\d{2}/.test(metadata.created)) {
    result.addWarning('Date should be in YYYY-MM-DD format', 'metadata.created');
  }

  // Validate version format (semver)
  if (metadata.version && !/^\d+\.\d+\.\d+/.test(metadata.version)) {
    result.addWarning('Version should follow semver format (X.Y.Z)', 'metadata.version');
  }
}

/**
 * Validate retrieval items
 *
 * @param {Array} retrieval - Retrieval query items
 * @param {ValidationResult} result - Validation result to update
 */
function validateRetrieval(retrieval, result) {
  if (!retrieval || !Array.isArray(retrieval)) {
    result.addWarning('No retrieval section or invalid format');
    return;
  }

  result.stats.retrievalCount = retrieval.length;
  const categoryCounts = {};
  const personaCounts = {};

  retrieval.forEach((item, index) => {
    const itemPath = `retrieval[${index}]`;

    if (!item.query) {
      result.addError('Missing query field', itemPath);
    }

    if (!item.retrieved || !Array.isArray(item.retrieved)) {
      result.addError('Missing or invalid retrieved array', itemPath);
    }

    if (!item.relevant || !Array.isArray(item.relevant)) {
      result.addError('Missing or invalid relevant array', itemPath);
    }

    // Track category distribution
    if (item.category) {
      if (!VALID_CATEGORIES.includes(item.category)) {
        result.addWarning(`Unknown category: ${item.category}`, `${itemPath}.category`);
      }
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }

    // Track persona distribution
    if (item.persona) {
      if (!VALID_PERSONAS.includes(item.persona)) {
        result.addWarning(`Unknown persona: ${item.persona}`, `${itemPath}.persona`);
      }
      personaCounts[item.persona] = (personaCounts[item.persona] || 0) + 1;
    }
  });

  result.stats.retrievalCategories = categoryCounts;
  result.stats.retrievalPersonas = personaCounts;
}

/**
 * Validate QA items
 *
 * @param {Array} qa - Q&A items
 * @param {ValidationResult} result - Validation result to update
 * @param {number} minRequired - Minimum number of QA items required
 */
function validateQA(qa, result, minRequired = 50) {
  if (!qa || !Array.isArray(qa)) {
    result.addError('Missing qa section or invalid format');
    return;
  }

  result.stats.qaCount = qa.length;

  if (qa.length < minRequired) {
    result.addError(`QA dataset must have at least ${minRequired} items, found ${qa.length}`);
  }

  const categoryCounts = {};
  const personaCounts = {};
  const withSources = [];
  const withExpectedEntities = [];

  qa.forEach((item, index) => {
    const itemPath = `qa[${index}]`;

    // Required fields
    if (!item.question) {
      result.addError('Missing question field', itemPath);
    }

    if (!item.answer) {
      result.addError('Missing answer field', itemPath);
    }

    if (!item.context) {
      result.addWarning('Missing context field (recommended)', itemPath);
    }

    // Track optional fields
    if (item.sources && Array.isArray(item.sources) && item.sources.length > 0) {
      withSources.push(index);

      // Validate source structure
      item.sources.forEach((source, sourceIndex) => {
        if (!source.id) {
          result.addWarning(`Source missing id`, `${itemPath}.sources[${sourceIndex}]`);
        }
        if (!source.content) {
          result.addWarning(`Source missing content`, `${itemPath}.sources[${sourceIndex}]`);
        }
      });
    }

    if (item.expectedEntities && Array.isArray(item.expectedEntities)) {
      withExpectedEntities.push(index);
    }

    // Track category distribution
    if (item.category) {
      if (!VALID_CATEGORIES.includes(item.category)) {
        result.addWarning(`Unknown category: ${item.category}`, `${itemPath}.category`);
      }
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    } else {
      result.addWarning('Missing category field', itemPath);
    }

    // Track persona distribution
    if (item.persona) {
      if (!VALID_PERSONAS.includes(item.persona)) {
        result.addWarning(`Unknown persona: ${item.persona}`, `${itemPath}.persona`);
      }
      personaCounts[item.persona] = (personaCounts[item.persona] || 0) + 1;
    }
  });

  result.stats.qaCategories = categoryCounts;
  result.stats.qaPersonas = personaCounts;
  result.stats.qaWithSources = withSources.length;
  result.stats.qaWithExpectedEntities = withExpectedEntities.length;

  // Check category coverage
  const missingCategories = VALID_CATEGORIES.filter(cat => !categoryCounts[cat]);
  if (missingCategories.length > 0) {
    result.addWarning(`QA items missing coverage for categories: ${missingCategories.join(', ')}`);
  }

  // Check minimum per category
  for (const category of VALID_CATEGORIES) {
    const count = categoryCounts[category] || 0;
    if (count < 5) {
      result.addWarning(`Category '${category}' has only ${count} items, recommend at least 5`);
    }
  }
}

/**
 * Validate negative test cases
 *
 * @param {Array} negativeTests - Negative test cases
 * @param {ValidationResult} result - Validation result to update
 * @param {Object} options - Validation options
 * @param {boolean} options.requireNegativeTests - Whether negative tests are required
 */
function validateNegativeTests(negativeTests, result, options = {}) {
  const { requireNegativeTests = false } = options;

  if (!negativeTests || !Array.isArray(negativeTests)) {
    if (requireNegativeTests) {
      result.addError('Missing negative_tests section or invalid format');
    } else {
      result.addWarning('No negative_tests section for hallucination resistance evaluation');
    }
    return;
  }

  result.stats.negativeTestCount = negativeTests.length;
  const categoryCounts = {};
  const personaCounts = {};

  if (negativeTests.length === 0 && requireNegativeTests) {
    result.addError('negative_tests must include at least one test case');
  }

  negativeTests.forEach((item, index) => {
    const itemPath = `negative_tests[${index}]`;

    if (!item.question) {
      result.addError('Missing question field', itemPath);
    }

    if (!item.expectedAnswer) {
      result.addError('Missing expectedAnswer field', itemPath);
    }

    if (!item.expectedOutcome) {
      result.addError('Missing expectedOutcome field', itemPath);
    } else if (!VALID_NEGATIVE_OUTCOMES.includes(item.expectedOutcome)) {
      result.addWarning(`Unknown expectedOutcome: ${item.expectedOutcome}`, `${itemPath}.expectedOutcome`);
    }

    if (item.expectedEntities && !Array.isArray(item.expectedEntities)) {
      result.addError('expectedEntities must be an array when provided', `${itemPath}.expectedEntities`);
    }

    // Track category distribution
    if (item.category) {
      if (!VALID_CATEGORIES.includes(item.category)) {
        result.addWarning(`Unknown category: ${item.category}`, `${itemPath}.category`);
      }
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    } else {
      result.addWarning('Missing category field', itemPath);
    }

    // Track persona distribution
    if (item.persona) {
      if (!VALID_PERSONAS.includes(item.persona)) {
        result.addWarning(`Unknown persona: ${item.persona}`, `${itemPath}.persona`);
      }
      personaCounts[item.persona] = (personaCounts[item.persona] || 0) + 1;
    } else {
      result.addWarning('Missing persona field', itemPath);
    }
  });

  result.stats.negativeTestCategories = categoryCounts;
  result.stats.negativeTestPersonas = personaCounts;

  // Check category coverage
  const missingCategories = VALID_CATEGORIES.filter(cat => !categoryCounts[cat]);
  if (missingCategories.length > 0) {
    result.addWarning(`Negative tests missing coverage for categories: ${missingCategories.join(', ')}`);
  }
}

/**
 * Validate entity extraction items
 *
 * @param {Array} entities - Entity extraction items
 * @param {ValidationResult} result - Validation result to update
 */
function validateEntities(entities, result) {
  if (!entities || !Array.isArray(entities)) {
    result.addWarning('No entities section for extraction evaluation');
    return;
  }

  result.stats.entityDocCount = entities.length;
  let totalExtracted = 0;
  let totalGroundTruth = 0;

  entities.forEach((item, index) => {
    const itemPath = `entities[${index}]`;

    if (!item.extracted || !Array.isArray(item.extracted)) {
      result.addError('Missing or invalid extracted array', itemPath);
    } else {
      totalExtracted += item.extracted.length;

      // Validate entity structure
      item.extracted.forEach((entity, entityIndex) => {
        if (!entity.name) {
          result.addError('Entity missing name', `${itemPath}.extracted[${entityIndex}]`);
        }
        if (!entity.type) {
          result.addError('Entity missing type', `${itemPath}.extracted[${entityIndex}]`);
        }
      });
    }

    if (!item.groundTruth || !Array.isArray(item.groundTruth)) {
      result.addError('Missing or invalid groundTruth array', itemPath);
    } else {
      totalGroundTruth += item.groundTruth.length;
    }
  });

  result.stats.totalExtractedEntities = totalExtracted;
  result.stats.totalGroundTruthEntities = totalGroundTruth;
}

/**
 * Validate relationship extraction items
 *
 * @param {Array} relationships - Relationship extraction items
 * @param {ValidationResult} result - Validation result to update
 */
function validateRelationships(relationships, result) {
  if (!relationships || !Array.isArray(relationships)) {
    result.addWarning('No relationships section for extraction evaluation');
    return;
  }

  result.stats.relationshipDocCount = relationships.length;
  let totalExtracted = 0;
  let totalGroundTruth = 0;

  relationships.forEach((item, index) => {
    const itemPath = `relationships[${index}]`;

    if (!item.extracted || !Array.isArray(item.extracted)) {
      result.addError('Missing or invalid extracted array', itemPath);
    } else {
      totalExtracted += item.extracted.length;

      // Validate relationship structure
      item.extracted.forEach((rel, relIndex) => {
        if (!rel.from) {
          result.addError('Relationship missing from', `${itemPath}.extracted[${relIndex}]`);
        }
        if (!rel.to) {
          result.addError('Relationship missing to', `${itemPath}.extracted[${relIndex}]`);
        }
        if (!rel.type) {
          result.addError('Relationship missing type', `${itemPath}.extracted[${relIndex}]`);
        }
      });
    }

    if (!item.groundTruth || !Array.isArray(item.groundTruth)) {
      result.addError('Missing or invalid groundTruth array', itemPath);
    } else {
      totalGroundTruth += item.groundTruth.length;
    }
  });

  result.stats.totalExtractedRelationships = totalExtracted;
  result.stats.totalGroundTruthRelationships = totalGroundTruth;
}

/**
 * Validate community summary items
 *
 * @param {Array} communitySummaries - Community summary items
 * @param {ValidationResult} result - Validation result to update
 */
function validateCommunitySummaries(communitySummaries, result) {
  if (!communitySummaries || !Array.isArray(communitySummaries)) {
    result.addWarning('No community_summaries section for summary evaluation');
    return;
  }

  result.stats.communitySummaryCount = communitySummaries.length;

  communitySummaries.forEach((item, index) => {
    const itemPath = `community_summaries[${index}]`;

    if (!item.generatedSummary) {
      result.addError('Missing generatedSummary', itemPath);
    } else {
      if (!item.generatedSummary.summary) {
        result.addError('Missing summary text', `${itemPath}.generatedSummary`);
      }
    }

    if (!item.groundTruth) {
      result.addError('Missing groundTruth', itemPath);
    } else {
      if (!item.groundTruth.members || !Array.isArray(item.groundTruth.members)) {
        result.addError('Missing or invalid members array', `${itemPath}.groundTruth`);
      }
    }
  });
}

/**
 * Validate a complete benchmark dataset
 *
 * @param {Object} dataset - The dataset to validate
 * @param {Object} options - Validation options
 * @param {number} options.minQAItems - Minimum required QA items (default: 50)
 * @returns {ValidationResult} Validation result
 */
function validateDataset(dataset, options = {}) {
  const { minQAItems = 50 } = options;
  const result = new ValidationResult();

  if (!dataset || typeof dataset !== 'object') {
    result.addError('Dataset must be a valid object');
    return result;
  }

  // Validate each section
  validateMetadata(dataset.metadata, result);
  validateRetrieval(dataset.retrieval, result);
  validateQA(dataset.qa, result, minQAItems);
  validateNegativeTests(dataset.negative_tests, result, options);
  validateEntities(dataset.entities, result);
  validateRelationships(dataset.relationships, result);
  validateCommunitySummaries(dataset.community_summaries, result);

  return result;
}

/**
 * Load and validate a dataset file
 *
 * @param {string} filePath - Path to dataset JSON file
 * @param {Object} options - Validation options
 * @returns {Object} { dataset, validation }
 */
function loadAndValidateDataset(filePath, options = {}) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Dataset file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const dataset = JSON.parse(content);
  const validation = validateDataset(dataset, options);

  return { dataset, validation };
}

/**
 * Generate a validation report
 *
 * @param {ValidationResult} result - Validation result
 * @param {string} format - Output format: 'text', 'json', 'markdown'
 * @returns {string} Formatted report
 */
function generateValidationReport(result, format = 'text') {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (format === 'markdown') {
    const lines = [
      '# Dataset Validation Report',
      '',
      `**Status:** ${result.valid ? '✅ VALID' : '❌ INVALID'}`,
      '',
      '## Statistics',
      '',
      '| Metric | Value |',
      '|--------|-------|'
    ];

    for (const [key, value] of Object.entries(result.stats)) {
      if (typeof value === 'object') {
        lines.push(`| ${key} | ${JSON.stringify(value)} |`);
      } else {
        lines.push(`| ${key} | ${value} |`);
      }
    }

    if (result.errors.length > 0) {
      lines.push('', '## Errors', '');
      result.errors.forEach((err, i) => {
        lines.push(`${i + 1}. ${err.message}${err.path ? ` (at ${err.path})` : ''}`);
      });
    }

    if (result.warnings.length > 0) {
      lines.push('', '## Warnings', '');
      result.warnings.forEach((warn, i) => {
        lines.push(`${i + 1}. ${warn.message}${warn.path ? ` (at ${warn.path})` : ''}`);
      });
    }

    return lines.join('\n');
  }

  // Default: text format
  const lines = [
    '='.repeat(60),
    'DATASET VALIDATION REPORT',
    '='.repeat(60),
    '',
    `Status: ${result.valid ? 'VALID' : 'INVALID'}`,
    '',
    'Statistics:',
    '-'.repeat(30)
  ];

  for (const [key, value] of Object.entries(result.stats)) {
    if (typeof value === 'object') {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`  ${key}: ${value}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push('', 'Errors:', '-'.repeat(30));
    result.errors.forEach((err, i) => {
      lines.push(`  ${i + 1}. ${err.message}${err.path ? ` (at ${err.path})` : ''}`);
    });
  }

  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:', '-'.repeat(30));
    result.warnings.forEach((warn, i) => {
      lines.push(`  ${i + 1}. ${warn.message}${warn.path ? ` (at ${warn.path})` : ''}`);
    });
  }

  lines.push('', '='.repeat(60));

  return lines.join('\n');
}

module.exports = {
  ValidationResult,
  validateDataset,
  validateMetadata,
  validateRetrieval,
  validateQA,
  validateEntities,
  validateRelationships,
  validateCommunitySummaries,
  validateNegativeTests,
  loadAndValidateDataset,
  generateValidationReport,
  VALID_CATEGORIES,
  VALID_PERSONAS,
  VALID_NEGATIVE_OUTCOMES
};
