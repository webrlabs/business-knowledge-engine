/**
 * Unit tests for Negative Test Evaluator
 *
 * Tests hallucination resistance evaluation for questions that should
 * return "insufficient information" or "not found" responses.
 *
 * Feature: F1.1.4 - Negative Test Cases
 */

const {
  evaluateTestCase,
  evaluateBatch,
  classifyWithHeuristics,
  checkRefusalPatterns,
  checkHallucinationPatterns,
  calculateAggregateStats,
  loadNegativeTestDataset,
  formatTextReport,
  formatMarkdownReport,
  ResponseType,
  DEFAULT_REFUSAL_PHRASES,
  buildClassificationPrompt
} = require('../negative-test-evaluator');

const path = require('path');

describe('NegativeTestEvaluator', () => {
  describe('checkRefusalPatterns', () => {
    it('should detect standard refusal phrases', () => {
      const response = 'I do not have sufficient information to answer that question.';
      const result = checkRefusalPatterns(response);

      expect(result.hasRefusal).toBe(true);
      expect(result.matchCount).toBeGreaterThan(0);
    });

    it('should detect "not found" refusals', () => {
      const response = 'The information you requested was not found in the knowledge base.';
      const result = checkRefusalPatterns(response);

      expect(result.hasRefusal).toBe(true);
      expect(result.matchedPhrases).toContain('not found');
    });

    it('should detect custom acceptable responses', () => {
      const response = 'This data is completely missing from our records.';
      const result = checkRefusalPatterns(response, ['completely missing']);

      expect(result.hasRefusal).toBe(true);
    });

    it('should return false when no refusal patterns found', () => {
      const response = 'The quarterly report shows revenue of $5 million.';
      const result = checkRefusalPatterns(response);

      expect(result.hasRefusal).toBe(false);
      expect(result.matchCount).toBe(0);
    });

    it('should be case-insensitive', () => {
      const response = 'INSUFFICIENT INFORMATION is available for this query.';
      const result = checkRefusalPatterns(response);

      expect(result.hasRefusal).toBe(true);
    });
  });

  describe('checkHallucinationPatterns', () => {
    it('should detect specified hallucination patterns', () => {
      const response = 'The QuantumFlux ERP system uses a three-tier architecture.';
      const unacceptablePatterns = ['QuantumFlux ERP system uses', 'three-tier architecture'];
      const result = checkHallucinationPatterns(response, unacceptablePatterns);

      expect(result.hasHallucination).toBe(true);
      expect(result.matchCount).toBeGreaterThan(0);
    });

    it('should return false when no hallucination patterns match', () => {
      const response = 'I cannot find any information about that system.';
      const unacceptablePatterns = ['QuantumFlux', 'uses a'];
      const result = checkHallucinationPatterns(response, unacceptablePatterns);

      expect(result.hasHallucination).toBe(false);
    });

    it('should handle empty pattern list', () => {
      const response = 'Some response text here.';
      const result = checkHallucinationPatterns(response, []);

      expect(result.hasHallucination).toBe(false);
      expect(result.matchCount).toBe(0);
    });
  });

  describe('classifyWithHeuristics', () => {
    it('should classify correct refusal as CORRECT_REFUSAL', () => {
      const testCase = {
        question: 'What is the QuantumFlux ERP?',
        acceptableResponses: ['not found', 'no information'],
        unacceptablePatterns: ['QuantumFlux uses']
      };
      const response = 'I cannot find any information about QuantumFlux ERP.';

      const result = classifyWithHeuristics(response, testCase);

      expect(result.classification).toBe(ResponseType.CORRECT_REFUSAL);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should classify hallucination as HALLUCINATION', () => {
      const testCase = {
        question: 'What is the QuantumFlux ERP?',
        acceptableResponses: [],
        unacceptablePatterns: ['QuantumFlux is a', 'system that']
      };
      const response = 'QuantumFlux is a modern ERP system that handles all business operations.';

      const result = classifyWithHeuristics(response, testCase);

      expect(result.classification).toBe(ResponseType.HALLUCINATION);
    });

    it('should classify ambiguous responses as QUALIFIED_RESPONSE', () => {
      const testCase = {
        question: 'What is the QuantumFlux ERP?',
        acceptableResponses: ['not found'],
        unacceptablePatterns: ['QuantumFlux is a']
      };
      const response = 'I am not entirely sure, but it could be related to business systems.';

      const result = classifyWithHeuristics(response, testCase);

      expect(result.classification).toBe(ResponseType.QUALIFIED_RESPONSE);
      expect(result.needsLLMVerification).toBe(true);
    });
  });

  describe('evaluateTestCase', () => {
    it('should evaluate a test case with correct refusal', async () => {
      const testCase = {
        id: 'neg-001',
        category: 'nonexistent_entity',
        question: 'What is the QuantumFlux ERP system?',
        reason: 'QuantumFlux ERP is fictional',
        acceptableResponses: ['not found', 'no information'],
        unacceptablePatterns: ['QuantumFlux uses', 'The QuantumFlux system']
      };
      const response = 'I do not have any information about the QuantumFlux ERP system in my knowledge base.';

      const result = await evaluateTestCase(testCase, response, { useLLM: false });

      expect(result.testCaseId).toBe('neg-001');
      expect(result.classification).toBe(ResponseType.CORRECT_REFUSAL);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it('should evaluate a test case with hallucination', async () => {
      const testCase = {
        id: 'neg-002',
        category: 'fictional',
        question: 'Describe Hogwarts compliance procedures',
        reason: 'Hogwarts is fictional',
        acceptableResponses: ['not found'],
        unacceptablePatterns: ['Hogwarts compliance', 'The procedure involves']
      };
      const response = 'The Hogwarts compliance procedure involves reviewing all magical artifacts quarterly.';

      const result = await evaluateTestCase(testCase, response, { useLLM: false });

      expect(result.classification).toBe(ResponseType.HALLUCINATION);
      expect(result.passed).toBe(false);
      expect(result.score).toBe(0.0);
    });

    it('should include latency measurement', async () => {
      const testCase = {
        id: 'neg-003',
        category: 'out_of_scope',
        question: 'What is the recipe for pizza?',
        reason: 'Recipes are out of scope'
      };
      const response = 'This is outside the scope of the business knowledge base.';

      const result = await evaluateTestCase(testCase, response, { useLLM: false });

      expect(result.latencyMs).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('evaluateBatch', () => {
    it('should evaluate multiple test cases', async () => {
      const items = [
        {
          testCase: {
            id: 'neg-001',
            category: 'nonexistent_entity',
            question: 'What is QuantumFlux?',
            reason: 'Fictional'
          },
          response: 'I do not have information about QuantumFlux.'
        },
        {
          testCase: {
            id: 'neg-002',
            category: 'out_of_scope',
            question: 'Best pizza recipe?',
            reason: 'Out of scope'
          },
          response: 'This is not available in my knowledge base.'
        },
        {
          testCase: {
            id: 'neg-003',
            category: 'fictional',
            question: 'Describe the warp drive?',
            reason: 'Sci-fi',
            unacceptablePatterns: ['warp drive works by']
          },
          response: 'The warp drive works by bending space-time.'
        }
      ];

      const result = await evaluateBatch(items, { useLLM: false });

      expect(result.itemCount).toBe(3);
      expect(result.passCount).toBe(2);
      expect(result.failCount).toBe(1);
      expect(result.aggregate.passRate).toBeCloseTo(2 / 3, 2);
    });

    it('should handle empty batch', async () => {
      const result = await evaluateBatch([], { useLLM: false });

      expect(result.itemCount).toBe(0);
      expect(result.passCount).toBe(0);
      expect(result.results).toHaveLength(0);
    });

    it('should calculate category breakdown', async () => {
      const items = [
        {
          testCase: { id: 'neg-001', category: 'fictional', question: 'Q1' },
          response: 'No information available.'
        },
        {
          testCase: { id: 'neg-002', category: 'fictional', question: 'Q2' },
          response: 'Cannot find that data.'
        },
        {
          testCase: { id: 'neg-003', category: 'out_of_scope', question: 'Q3' },
          response: 'Outside scope.'
        }
      ];

      const result = await evaluateBatch(items, { useLLM: false });

      expect(result.aggregate.byCategory).toBeDefined();
      expect(result.aggregate.byCategory.fictional.total).toBe(2);
      expect(result.aggregate.byCategory.out_of_scope.total).toBe(1);
    });
  });

  describe('calculateAggregateStats', () => {
    it('should calculate correct statistics', () => {
      const results = [
        { classification: ResponseType.CORRECT_REFUSAL, category: 'fictional', score: 1.0, passed: true },
        { classification: ResponseType.CORRECT_REFUSAL, category: 'fictional', score: 1.0, passed: true },
        { classification: ResponseType.HALLUCINATION, category: 'out_of_scope', score: 0.0, passed: false },
        { classification: ResponseType.QUALIFIED_RESPONSE, category: 'temporal', score: 0.5, passed: false }
      ];

      const stats = calculateAggregateStats(results);

      expect(stats.totalTests).toBe(4);
      expect(stats.correctRefusals).toBe(2);
      expect(stats.hallucinations).toBe(1);
      expect(stats.qualifiedResponses).toBe(1);
      expect(stats.passRate).toBe(0.5);
      expect(stats.hallucinationRate).toBe(0.25);
      expect(stats.averageScore).toBe(0.625);
    });

    it('should handle empty results', () => {
      const stats = calculateAggregateStats([]);

      expect(stats.totalTests).toBe(0);
      expect(stats.passRate).toBe(0);
    });
  });

  describe('loadNegativeTestDataset', () => {
    it('should load the default dataset', () => {
      const datasetPath = path.join(__dirname, '..', 'datasets', 'negative_tests.json');
      const dataset = loadNegativeTestDataset(datasetPath);

      expect(dataset.metadata).toBeDefined();
      expect(dataset.metadata.name).toBe('negative-test-cases');
      expect(dataset.negative_tests).toBeDefined();
      expect(dataset.negative_tests.length).toBeGreaterThan(0);
    });

    it('should throw error for non-existent file', () => {
      expect(() => {
        loadNegativeTestDataset('/nonexistent/path.json');
      }).toThrow('Dataset file not found');
    });
  });

  describe('formatTextReport', () => {
    it('should generate readable text report', () => {
      const batchResult = {
        itemCount: 10,
        passCount: 8,
        failCount: 2,
        aggregate: {
          passRate: 0.8,
          hallucinationRate: 0.1,
          averageScore: 0.85,
          correctRefusals: 8,
          qualifiedResponses: 1,
          hallucinations: 1,
          byCategory: {
            fictional: { pass: 4, fail: 1, total: 5 },
            out_of_scope: { pass: 4, fail: 1, total: 5 }
          }
        },
        results: [
          {
            testCaseId: 'neg-001',
            category: 'fictional',
            question: 'Test question?',
            classification: ResponseType.HALLUCINATION,
            reasoning: 'Made up content',
            passed: false
          }
        ]
      };

      const report = formatTextReport(batchResult);

      expect(report).toContain('Negative Test Evaluation Report');
      expect(report).toContain('Pass Rate: 80.0%');
      expect(report).toContain('Hallucination Rate: 10.0%');
      expect(report).toContain('Failed Test Cases');
    });
  });

  describe('formatMarkdownReport', () => {
    it('should generate markdown report with tables', () => {
      const batchResult = {
        itemCount: 5,
        passCount: 4,
        failCount: 1,
        aggregate: {
          passRate: 0.8,
          hallucinationRate: 0.2,
          averageScore: 0.8,
          correctRefusals: 4,
          qualifiedResponses: 0,
          hallucinations: 1,
          byCategory: {
            fictional: { pass: 2, fail: 1, total: 3 }
          }
        },
        results: []
      };

      const report = formatMarkdownReport(batchResult);

      expect(report).toContain('# Negative Test Evaluation Report');
      expect(report).toContain('| Pass Rate |');
      expect(report).toContain('## Results by Category');
    });
  });

  describe('buildClassificationPrompt', () => {
    it('should build a valid classification prompt', () => {
      const prompt = buildClassificationPrompt(
        'What is the QuantumFlux system?',
        'QuantumFlux is a modern ERP.',
        'QuantumFlux is fictional'
      );

      expect(prompt).toContain('What is the QuantumFlux system?');
      expect(prompt).toContain('QuantumFlux is a modern ERP.');
      expect(prompt).toContain('QuantumFlux is fictional');
      expect(prompt).toContain('correct_refusal');
      expect(prompt).toContain('hallucination');
    });
  });

  describe('DEFAULT_REFUSAL_PHRASES', () => {
    it('should contain common refusal phrases', () => {
      expect(DEFAULT_REFUSAL_PHRASES).toContain('insufficient information');
      expect(DEFAULT_REFUSAL_PHRASES).toContain('not found');
      expect(DEFAULT_REFUSAL_PHRASES).toContain('no information available');
      expect(DEFAULT_REFUSAL_PHRASES).toContain('cannot find');
    });

    it('should have reasonable number of phrases', () => {
      expect(DEFAULT_REFUSAL_PHRASES.length).toBeGreaterThan(10);
    });
  });

  describe('ResponseType constants', () => {
    it('should have expected response types', () => {
      expect(ResponseType.CORRECT_REFUSAL).toBe('correct_refusal');
      expect(ResponseType.QUALIFIED_RESPONSE).toBe('qualified_response');
      expect(ResponseType.HALLUCINATION).toBe('hallucination');
      expect(ResponseType.ERROR).toBe('error');
    });
  });

  describe('Dataset validation', () => {
    it('should have valid test cases in the dataset', () => {
      const datasetPath = path.join(__dirname, '..', 'datasets', 'negative_tests.json');
      const dataset = loadNegativeTestDataset(datasetPath);

      for (const testCase of dataset.negative_tests) {
        expect(testCase.id).toBeDefined();
        expect(testCase.category).toBeDefined();
        expect(testCase.question).toBeDefined();
        expect(testCase.reason).toBeDefined();
        expect(testCase.expectedBehavior).toBe('refuse_or_clarify');
      }
    });

    it('should have expected categories in dataset', () => {
      const datasetPath = path.join(__dirname, '..', 'datasets', 'negative_tests.json');
      const dataset = loadNegativeTestDataset(datasetPath);
      const categories = new Set(dataset.negative_tests.map(tc => tc.category));

      expect(categories.has('nonexistent_entity')).toBe(true);
      expect(categories.has('out_of_scope')).toBe(true);
      expect(categories.has('fictional')).toBe(true);
      expect(categories.has('temporal_gap')).toBe(true);
    });

    it('should have minimum number of test cases', () => {
      const datasetPath = path.join(__dirname, '..', 'datasets', 'negative_tests.json');
      const dataset = loadNegativeTestDataset(datasetPath);

      expect(dataset.negative_tests.length).toBeGreaterThanOrEqual(40);
    });
  });
});
