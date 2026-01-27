/**
 * Tests for Q&A Benchmark Dataset (F1.1.1)
 *
 * Validates that the Q&A benchmark dataset meets all requirements:
 * - 50+ curated Q&A pairs
 * - Coverage of operational, technical, compliance, and leadership domains
 * - Expected entities and source document references
 * - Persona tags for each question
 *
 * Note: Negative tests are stored in a separate file (negative_tests.json)
 * per the F1.1.4 feature specification.
 */

const path = require('path');
const fs = require('fs');
const {
  validateDataset,
  loadAndValidateDataset,
  generateValidationReport,
  VALID_CATEGORIES,
  VALID_PERSONAS,
  VALID_NEGATIVE_OUTCOMES
} = require('../dataset-validator');

const DATASET_PATH = path.join(__dirname, '..', 'datasets', 'qa_benchmark.json');
const NEGATIVE_TESTS_PATH = path.join(__dirname, '..', 'datasets', 'negative_tests.json');

describe('Q&A Benchmark Dataset (F1.1.1)', () => {
  let dataset;
  let validation;
  let negativeTests;

  beforeAll(() => {
    // Load main dataset without requiring negative tests (they're in a separate file)
    const result = loadAndValidateDataset(DATASET_PATH, { requireNegativeTests: false });
    dataset = result.dataset;
    validation = result.validation;

    // Load negative tests from separate file (F1.1.4)
    if (fs.existsSync(NEGATIVE_TESTS_PATH)) {
      const negativeTestsData = JSON.parse(fs.readFileSync(NEGATIVE_TESTS_PATH, 'utf-8'));
      negativeTests = negativeTestsData.negative_tests || negativeTestsData.tests || [];
    } else {
      negativeTests = [];
    }
  });

  describe('Dataset Loading', () => {
    test('should load dataset file successfully', () => {
      expect(dataset).toBeDefined();
      expect(typeof dataset).toBe('object');
    });

    test('should have all required sections', () => {
      expect(dataset.metadata).toBeDefined();
      expect(dataset.qa).toBeDefined();
      expect(Array.isArray(dataset.qa)).toBe(true);
    });
  });

  describe('Metadata Validation', () => {
    test('should have valid metadata', () => {
      expect(dataset.metadata.name).toBe('qa-benchmark');
      expect(dataset.metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(dataset.metadata.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dataset.metadata.description).toBeDefined();
    });

    test('should have feature reference', () => {
      expect(dataset.metadata.featureId).toBe('F1.1.1');
    });

    test('should list all categories', () => {
      expect(dataset.metadata.categories).toEqual(expect.arrayContaining(VALID_CATEGORIES));
    });

    test('should list all personas', () => {
      expect(dataset.metadata.personas).toEqual(expect.arrayContaining(['Ops', 'IT', 'Compliance', 'Leadership']));
    });
  });

  describe('Q&A Pairs Requirement', () => {
    test('should have at least 50 Q&A pairs', () => {
      expect(dataset.qa.length).toBeGreaterThanOrEqual(50);
    });

    test('metadata totalQuestions should match actual count', () => {
      expect(dataset.metadata.totalQuestions).toBe(dataset.qa.length);
    });

    // Note: negativeTestCases count is not in qa_benchmark.json metadata
    // because negative tests are stored in a separate file (F1.1.4)
  });

  describe('Category Coverage', () => {
    let categoryCounts;

    beforeAll(() => {
      categoryCounts = {};
      dataset.qa.forEach(item => {
        if (item.category) {
          categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
        }
      });
    });

    test('should cover all four categories', () => {
      expect(Object.keys(categoryCounts)).toEqual(expect.arrayContaining(VALID_CATEGORIES));
    });

    test('should have operational questions', () => {
      expect(categoryCounts.operational).toBeGreaterThan(0);
    });

    test('should have technical questions', () => {
      expect(categoryCounts.technical).toBeGreaterThan(0);
    });

    test('should have compliance questions', () => {
      expect(categoryCounts.compliance).toBeGreaterThan(0);
    });

    test('should have leadership questions', () => {
      expect(categoryCounts.leadership).toBeGreaterThan(0);
    });

    test('should have at least 10 questions per category', () => {
      for (const category of VALID_CATEGORIES) {
        expect(categoryCounts[category]).toBeGreaterThanOrEqual(10);
      }
    });
  });

  describe('Persona Coverage', () => {
    let personaCounts;

    beforeAll(() => {
      personaCounts = {};
      dataset.qa.forEach(item => {
        if (item.persona) {
          personaCounts[item.persona] = (personaCounts[item.persona] || 0) + 1;
        }
      });
    });

    test('should have persona tags for all Q&A items', () => {
      const itemsWithPersona = dataset.qa.filter(item => item.persona);
      expect(itemsWithPersona.length).toBe(dataset.qa.length);
    });

    test('should cover key personas', () => {
      expect(personaCounts['Ops']).toBeGreaterThan(0);
      expect(personaCounts['IT']).toBeGreaterThan(0);
      expect(personaCounts['Compliance']).toBeGreaterThan(0);
      expect(personaCounts['Leadership']).toBeGreaterThan(0);
    });
  });

  describe('Q&A Item Structure', () => {
    test('each item should have required fields', () => {
      dataset.qa.forEach((item, index) => {
        expect(item.question).toBeDefined();
        expect(typeof item.question).toBe('string');
        expect(item.question.length).toBeGreaterThan(0);

        expect(item.answer).toBeDefined();
        expect(typeof item.answer).toBe('string');
        expect(item.answer.length).toBeGreaterThan(0);

        expect(item.category).toBeDefined();
        expect(VALID_CATEGORIES).toContain(item.category);

        expect(item.persona).toBeDefined();
        expect(VALID_PERSONAS).toContain(item.persona);
      });
    });

    test('each item should have context', () => {
      const itemsWithContext = dataset.qa.filter(item => item.context && item.context.length > 0);
      expect(itemsWithContext.length).toBe(dataset.qa.length);
    });

    test('most items should have expected entities', () => {
      const itemsWithEntities = dataset.qa.filter(
        item => item.expectedEntities && Array.isArray(item.expectedEntities) && item.expectedEntities.length > 0
      );
      // At least 80% should have expected entities
      expect(itemsWithEntities.length).toBeGreaterThanOrEqual(dataset.qa.length * 0.8);
    });

    test('some items should have source documents', () => {
      const itemsWithSources = dataset.qa.filter(
        item => item.sources && Array.isArray(item.sources) && item.sources.length > 0
      );
      // At least 50% should have sources
      expect(itemsWithSources.length).toBeGreaterThanOrEqual(dataset.qa.length * 0.5);
    });
  });

  describe('Source Document Structure', () => {
    test('sources should have required fields', () => {
      dataset.qa.forEach((item, index) => {
        if (item.sources && Array.isArray(item.sources)) {
          item.sources.forEach((source, sourceIndex) => {
            expect(source.id).toBeDefined();
            expect(source.title).toBeDefined();
            expect(source.content).toBeDefined();
          });
        }
      });
    });
  });

  describe('Retrieval Section', () => {
    test('should have retrieval queries', () => {
      expect(dataset.retrieval).toBeDefined();
      expect(Array.isArray(dataset.retrieval)).toBe(true);
      expect(dataset.retrieval.length).toBeGreaterThan(0);
    });

    test('retrieval items should have required fields', () => {
      dataset.retrieval.forEach((item, index) => {
        expect(item.query).toBeDefined();
        expect(item.retrieved).toBeDefined();
        expect(Array.isArray(item.retrieved)).toBe(true);
        expect(item.relevant).toBeDefined();
        expect(Array.isArray(item.relevant)).toBe(true);
      });
    });

    test('retrieval items should have category and persona', () => {
      dataset.retrieval.forEach((item, index) => {
        expect(item.category).toBeDefined();
        expect(item.persona).toBeDefined();
      });
    });

    test('retrieval items should have expected entities', () => {
      const itemsWithEntities = dataset.retrieval.filter(
        item => item.expectedEntities && Array.isArray(item.expectedEntities)
      );
      expect(itemsWithEntities.length).toBeGreaterThan(0);
    });
  });

  describe('Entity Extraction Section', () => {
    test('should have entity extraction items', () => {
      expect(dataset.entities).toBeDefined();
      expect(Array.isArray(dataset.entities)).toBe(true);
      expect(dataset.entities.length).toBeGreaterThan(0);
    });

    test('entity items should have extracted and groundTruth', () => {
      dataset.entities.forEach((item, index) => {
        expect(item.extracted).toBeDefined();
        expect(Array.isArray(item.extracted)).toBe(true);
        expect(item.groundTruth).toBeDefined();
        expect(Array.isArray(item.groundTruth)).toBe(true);
      });
    });

    test('entities should have name and type', () => {
      dataset.entities.forEach((item, index) => {
        item.extracted.forEach((entity, entityIndex) => {
          expect(entity.name).toBeDefined();
          expect(entity.type).toBeDefined();
        });
        item.groundTruth.forEach((entity, entityIndex) => {
          expect(entity.name).toBeDefined();
          expect(entity.type).toBeDefined();
        });
      });
    });
  });

  describe('Relationship Extraction Section', () => {
    test('should have relationship extraction items', () => {
      expect(dataset.relationships).toBeDefined();
      expect(Array.isArray(dataset.relationships)).toBe(true);
      expect(dataset.relationships.length).toBeGreaterThan(0);
    });

    test('relationship items should have extracted and groundTruth', () => {
      dataset.relationships.forEach((item, index) => {
        expect(item.extracted).toBeDefined();
        expect(Array.isArray(item.extracted)).toBe(true);
        expect(item.groundTruth).toBeDefined();
        expect(Array.isArray(item.groundTruth)).toBe(true);
      });
    });

    test('relationships should have from, to, and type', () => {
      dataset.relationships.forEach((item, index) => {
        item.extracted.forEach((rel, relIndex) => {
          expect(rel.from).toBeDefined();
          expect(rel.to).toBeDefined();
          expect(rel.type).toBeDefined();
        });
        item.groundTruth.forEach((rel, relIndex) => {
          expect(rel.from).toBeDefined();
          expect(rel.to).toBeDefined();
          expect(rel.type).toBeDefined();
        });
      });
    });
  });

  describe('Community Summary Section', () => {
    test('should have community summary items', () => {
      expect(dataset.community_summaries).toBeDefined();
      expect(Array.isArray(dataset.community_summaries)).toBe(true);
      expect(dataset.community_summaries.length).toBeGreaterThan(0);
    });

    test('summary items should have required structure', () => {
      dataset.community_summaries.forEach((item, index) => {
        expect(item.generatedSummary).toBeDefined();
        expect(item.generatedSummary.summary).toBeDefined();
        expect(item.groundTruth).toBeDefined();
        expect(item.groundTruth.members).toBeDefined();
        expect(Array.isArray(item.groundTruth.members)).toBe(true);
      });
    });
  });

  describe('Negative Test Cases (F1.1.4 - Separate File)', () => {
    // Negative tests are stored in a separate file (negative_tests.json)
    // per feature F1.1.4 specification
    // Note: negative_tests.json uses a different schema optimized for hallucination testing

    const VALID_NEGATIVE_CATEGORIES = [
      'nonexistent_entity',
      'out_of_scope',
      'temporal_gap',
      'fictional',
      'specificity_trap',
      'cross_domain',
      'counterfactual'
    ];

    test('should have negative test cases in separate file', () => {
      expect(negativeTests).toBeDefined();
      expect(Array.isArray(negativeTests)).toBe(true);
      expect(negativeTests.length).toBeGreaterThanOrEqual(8);
    });

    test('negative tests should cover multiple categories', () => {
      const categoryCounts = {};
      negativeTests.forEach(item => {
        if (item.category) {
          categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
        }
      });
      // Should have at least 3 different categories
      expect(Object.keys(categoryCounts).length).toBeGreaterThanOrEqual(3);
      // All categories should be valid negative test categories
      Object.keys(categoryCounts).forEach(cat => {
        expect(VALID_NEGATIVE_CATEGORIES).toContain(cat);
      });
    });

    test('negative tests should have required fields', () => {
      negativeTests.forEach(item => {
        expect(item.id).toBeDefined();
        expect(item.question).toBeDefined();
        expect(item.category).toBeDefined();
        expect(VALID_NEGATIVE_CATEGORIES).toContain(item.category);
        expect(item.reason).toBeDefined();
        expect(item.expectedBehavior).toBeDefined();
        expect(item.acceptableResponses).toBeDefined();
        expect(Array.isArray(item.acceptableResponses)).toBe(true);
      });
    });

    test('negative tests should have unacceptable patterns', () => {
      negativeTests.forEach(item => {
        expect(item.unacceptablePatterns).toBeDefined();
        expect(Array.isArray(item.unacceptablePatterns)).toBe(true);
        expect(item.unacceptablePatterns.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Overall Validation', () => {
    test('should pass schema validation', () => {
      expect(validation.valid).toBe(true);
    });

    test('should have no critical errors', () => {
      expect(validation.errors.length).toBe(0);
    });

    test('validation report should be generatable', () => {
      const textReport = generateValidationReport(validation, 'text');
      expect(textReport).toContain('VALID');

      const markdownReport = generateValidationReport(validation, 'markdown');
      expect(markdownReport).toContain('VALID');

      const jsonReport = generateValidationReport(validation, 'json');
      const parsed = JSON.parse(jsonReport);
      expect(parsed.valid).toBe(true);
    });
  });

  describe('Question Quality', () => {
    test('questions should end with question mark', () => {
      const questionsWithoutMark = dataset.qa.filter(
        item => !item.question.trim().endsWith('?')
      );
      // Allow some flexibility, but most should have question marks
      expect(questionsWithoutMark.length).toBeLessThan(dataset.qa.length * 0.1);
    });

    test('answers should be substantial', () => {
      dataset.qa.forEach((item, index) => {
        // Answers should be at least 50 characters
        expect(item.answer.length).toBeGreaterThan(50);
      });
    });

    test('each question should be unique', () => {
      const questions = dataset.qa.map(item => item.question.toLowerCase().trim());
      const uniqueQuestions = new Set(questions);
      expect(uniqueQuestions.size).toBe(questions.length);
    });
  });
});

describe('Dataset Validator', () => {
  describe('validateDataset', () => {
    test('should reject null dataset', () => {
      const result = validateDataset(null);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('should reject empty object', () => {
      const result = validateDataset({});
      expect(result.valid).toBe(false);
    });

    test('should validate minimal valid dataset', () => {
      const minimalDataset = {
        metadata: {
          name: 'test',
          version: '1.0.0',
          created: '2026-01-23',
          description: 'Test dataset'
        },
        qa: Array(50).fill(null).map((_, i) => ({
          id: `qa-${i}`,
          question: `Question ${i}?`,
          answer: 'This is a test answer that is at least fifty characters long to pass validation.',
          context: 'Test context',
          category: VALID_CATEGORIES[i % 4],
          persona: VALID_PERSONAS[i % 4]
        }))
      };

      const result = validateDataset(minimalDataset);
      expect(result.valid).toBe(true);
    });

    test('should fail if QA count below minimum', () => {
      const smallDataset = {
        metadata: {
          name: 'test',
          version: '1.0.0',
          created: '2026-01-23',
          description: 'Test dataset'
        },
        qa: [
          {
            question: 'Test?',
            answer: 'Test answer',
            category: 'operational',
            persona: 'Ops'
          }
        ]
      };

      const result = validateDataset(smallDataset, { minQAItems: 50 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('at least 50'))).toBe(true);
    });

    test('should allow custom minimum QA count', () => {
      const smallDataset = {
        metadata: {
          name: 'test',
          version: '1.0.0',
          created: '2026-01-23',
          description: 'Test dataset'
        },
        qa: Array(5).fill(null).map((_, i) => ({
          question: `Question ${i}?`,
          answer: 'Test answer that meets minimum length requirement for validation.',
          context: 'Context',
          category: 'operational',
          persona: 'Ops'
        }))
      };

      const result = validateDataset(smallDataset, { minQAItems: 5 });
      expect(result.valid).toBe(true);
    });

    test('should fail when negative tests are required but missing', () => {
      const datasetWithoutNegatives = {
        metadata: {
          name: 'test',
          version: '1.0.0',
          created: '2026-01-23',
          description: 'Test dataset'
        },
        qa: Array(50).fill(null).map((_, i) => ({
          question: `Question ${i}?`,
          answer: 'Test answer that is long enough to pass validation requirements.',
          context: 'Context',
          category: 'operational',
          persona: 'Ops'
        }))
      };

      const result = validateDataset(datasetWithoutNegatives, { requireNegativeTests: true });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('negative_tests'))).toBe(true);
    });

    test('should validate when negative tests are present and required', () => {
      const datasetWithNegatives = {
        metadata: {
          name: 'test',
          version: '1.0.0',
          created: '2026-01-23',
          description: 'Test dataset'
        },
        qa: Array(50).fill(null).map((_, i) => ({
          question: `Question ${i}?`,
          answer: 'Test answer that is long enough to pass validation requirements.',
          context: 'Context',
          category: 'operational',
          persona: 'Ops'
        })),
        negative_tests: [
          {
            id: 'neg-001',
            question: 'Negative test?',
            expectedAnswer: 'Insufficient information to answer.',
            expectedOutcome: 'insufficient_information',
            category: 'operational',
            persona: 'Ops',
            expectedEntities: []
          }
        ]
      };

      const result = validateDataset(datasetWithNegatives, { requireNegativeTests: true });
      expect(result.valid).toBe(true);
    });
  });

  describe('loadAndValidateDataset', () => {
    test('should throw for non-existent file', () => {
      expect(() => {
        loadAndValidateDataset('/nonexistent/path.json');
      }).toThrow('Dataset file not found');
    });

    test('should load and validate real dataset', () => {
      const result = loadAndValidateDataset(DATASET_PATH);
      expect(result.dataset).toBeDefined();
      expect(result.validation).toBeDefined();
      expect(result.validation.valid).toBe(true);
    });
  });

  describe('generateValidationReport', () => {
    test('should generate text report', () => {
      const result = validateDataset({ metadata: { name: 'test' }, qa: [] });
      const report = generateValidationReport(result, 'text');
      expect(report).toContain('DATASET VALIDATION REPORT');
      expect(report).toContain('Status:');
    });

    test('should generate markdown report', () => {
      const result = validateDataset({ metadata: { name: 'test' }, qa: [] });
      const report = generateValidationReport(result, 'markdown');
      expect(report).toContain('# Dataset Validation Report');
      expect(report).toContain('**Status:**');
    });

    test('should generate JSON report', () => {
      const result = validateDataset({ metadata: { name: 'test' }, qa: [] });
      const report = generateValidationReport(result, 'json');
      const parsed = JSON.parse(report);
      expect(parsed).toHaveProperty('valid');
      expect(parsed).toHaveProperty('errors');
      expect(parsed).toHaveProperty('warnings');
    });
  });
});
