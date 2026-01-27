/**
 * Baseline Documentation Tests
 *
 * Validates that the baseline metrics documentation (F1.3.3) is complete
 * and contains all required sections.
 *
 * Feature: F1.3.3 - Baseline Documentation
 */

const fs = require('fs');
const path = require('path');

describe('Baseline Documentation (F1.3.3)', () => {
  const docsPath = path.join(__dirname, '../../../../docs');
  const baselineMetricsPath = path.join(docsPath, 'BASELINE_METRICS.md');
  let content;

  beforeAll(() => {
    if (fs.existsSync(baselineMetricsPath)) {
      content = fs.readFileSync(baselineMetricsPath, 'utf-8');
    }
  });

  describe('File Structure', () => {
    test('BASELINE_METRICS.md file exists', () => {
      expect(fs.existsSync(baselineMetricsPath)).toBe(true);
    });

    test('file is not empty', () => {
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(1000);
    });

    test('has feature ID reference', () => {
      expect(content).toMatch(/F1\.3\.3/);
    });
  });

  describe('Required Sections', () => {
    test('has Executive Summary section', () => {
      expect(content).toMatch(/## Executive Summary/);
    });

    test('has Evaluation Suites Overview section', () => {
      expect(content).toMatch(/## Evaluation Suites Overview/);
    });

    test('has Metric Definitions section', () => {
      expect(content).toMatch(/## Metric Definitions/);
    });

    test('has Baseline Targets (SLOs) section', () => {
      expect(content).toMatch(/## Baseline Targets/);
    });

    test('has Running Benchmarks section', () => {
      expect(content).toMatch(/## Running Benchmarks/);
    });

    test('has Interpreting Results section', () => {
      expect(content).toMatch(/## Interpreting Results/);
    });

    test('has Regression Detection section', () => {
      expect(content).toMatch(/## Regression Detection/);
    });

    test('has Trend Analysis section', () => {
      expect(content).toMatch(/## Trend Analysis/);
    });

    test('has Table of Contents', () => {
      expect(content).toMatch(/## Table of Contents/);
    });
  });

  describe('Evaluation Suites Documentation', () => {
    const suites = [
      'Retrieval Metrics',
      'Answer Quality',
      'Grounding Score',
      'Citation Accuracy',
      'Entity Extraction',
      'Relationship Extraction',
      'Community Summary',
      'Lazy vs Eager',
      'Negative Tests'
    ];

    test.each(suites)('documents %s suite', (suite) => {
      expect(content).toContain(suite);
    });

    test('documents retrieval suite code reference', () => {
      expect(content).toMatch(/`retrieval`/);
    });

    test('documents answer-quality suite code reference', () => {
      expect(content).toMatch(/`answer-quality`/);
    });

    test('documents grounding suite code reference', () => {
      expect(content).toMatch(/`grounding`/);
    });

    test('documents entity-extraction suite code reference', () => {
      expect(content).toMatch(/`entity-extraction`/);
    });

    test('documents negative-tests suite code reference', () => {
      expect(content).toMatch(/`negative-tests`/);
    });
  });

  describe('Metric Definitions', () => {
    describe('Retrieval Metrics', () => {
      const retrievalMetrics = [
        'Precision@K',
        'Recall@K',
        'F1@K',
        'MRR',
        'MAP',
        'NDCG',
        'Hit Rate'
      ];

      test.each(retrievalMetrics)('defines %s metric', (metric) => {
        expect(content).toContain(metric);
      });
    });

    describe('Answer Quality Metrics', () => {
      const answerMetrics = ['Helpfulness', 'Accuracy', 'Completeness'];

      test.each(answerMetrics)('defines %s dimension', (metric) => {
        expect(content).toContain(metric);
      });

      test('defines score scale (1-5)', () => {
        expect(content).toMatch(/1-5/);
      });
    });

    describe('Grounding Metrics', () => {
      const groundingConcepts = [
        'Supported Claims',
        'Partially Supported',
        'Not Supported',
        'Not Verifiable'
      ];

      test.each(groundingConcepts)('defines %s status', (concept) => {
        expect(content).toContain(concept);
      });
    });

    describe('Extraction Metrics', () => {
      const extractionMetrics = ['Precision', 'Recall', 'F1 Score'];

      test.each(extractionMetrics)('defines %s', (metric) => {
        expect(content).toContain(metric);
      });

      test('defines matching modes', () => {
        expect(content).toMatch(/STRICT/i);
        expect(content).toMatch(/PARTIAL/i);
        expect(content).toMatch(/TYPE_ONLY/i);
      });
    });
  });

  describe('Baseline Targets (SLOs)', () => {
    describe('Tier Classification', () => {
      test('defines Tier 1 (Critical/P0) metrics', () => {
        expect(content).toMatch(/Tier 1.*Critical.*P0/is);
      });

      test('defines Tier 2 (Important/P1) metrics', () => {
        expect(content).toMatch(/Tier 2.*Important.*P1/is);
      });

      test('defines Tier 3 (Nice-to-Have/P2) metrics', () => {
        expect(content).toMatch(/Tier 3.*Nice-to-Have.*P2/is);
      });
    });

    describe('Threshold Values', () => {
      test('defines Retrieval MRR threshold', () => {
        expect(content).toMatch(/MRR.*0\.70/i);
      });

      test('defines Grounding Score threshold', () => {
        expect(content).toMatch(/Grounding.*0\.80/i);
      });

      test('defines Entity Extraction F1 threshold', () => {
        expect(content).toMatch(/Entity.*F1.*0\.75/i);
      });

      test('defines Negative Test Pass Rate threshold', () => {
        expect(content).toMatch(/Negative.*Pass Rate.*0\.85/i);
      });
    });

    describe('Regression Thresholds', () => {
      test('defines Critical regression threshold', () => {
        expect(content).toMatch(/Critical.*10%/i);
      });

      test('defines Warning regression threshold', () => {
        expect(content).toMatch(/Warning.*5%/i);
      });
    });
  });

  describe('CLI Commands', () => {
    test('documents run-benchmark.js usage', () => {
      expect(content).toMatch(/node.*run-benchmark\.js/);
    });

    test('documents --dataset option', () => {
      expect(content).toMatch(/--dataset/);
    });

    test('documents --suite option', () => {
      expect(content).toMatch(/--suite/);
    });

    test('documents --threshold option', () => {
      expect(content).toMatch(/--threshold/);
    });

    test('documents --save-results option', () => {
      expect(content).toMatch(/--save-results/);
    });

    test('documents --compare-baseline option', () => {
      expect(content).toMatch(/--compare-baseline/);
    });

    test('documents --set-baseline option', () => {
      expect(content).toMatch(/--set-baseline/);
    });

    test('documents --fail-on-threshold option', () => {
      expect(content).toMatch(/--fail-on-threshold/);
    });

    test('documents output format options', () => {
      expect(content).toMatch(/--output json/);
      expect(content).toMatch(/--output markdown/);
      expect(content).toMatch(/--output text/);
    });
  });

  describe('Dataset References', () => {
    const datasets = [
      'qa_benchmark.json',
      'entity_ground_truth.json',
      'negative_tests.json',
      'lazy_vs_eager_benchmark.json',
      'adversarial_tests.json',
      'ci_benchmark.json'
    ];

    test.each(datasets)('references %s dataset', (dataset) => {
      expect(content).toContain(dataset);
    });
  });

  describe('Negative Test Categories', () => {
    const categories = [
      'nonexistent_entity',
      'out_of_scope',
      'temporal_gap',
      'fictional',
      'specificity_trap',
      'cross_domain',
      'counterfactual'
    ];

    test.each(categories)('documents %s category', (category) => {
      expect(content).toContain(category);
    });
  });

  describe('Best Practices', () => {
    test('has Best Practices section', () => {
      expect(content).toMatch(/## Best Practices/);
    });

    test('documents CI integration guidance', () => {
      expect(content).toMatch(/CI/i);
      expect(content).toMatch(/pipeline/i);
    });

    test('documents baseline setting guidance', () => {
      expect(content).toMatch(/Setting Baselines/i);
    });
  });

  describe('Version History', () => {
    test('has Version History section', () => {
      expect(content).toMatch(/## Version History/);
    });

    test('documents initial version', () => {
      expect(content).toMatch(/1\.0\.0/);
    });
  });
});

describe('Baseline Metrics Validation Service', () => {
  const {
    DEFAULT_CONFIG,
    SUITES
  } = require('../run-benchmark');

  describe('Default Configuration', () => {
    test('default threshold is defined', () => {
      expect(DEFAULT_CONFIG.threshold).toBeDefined();
      expect(typeof DEFAULT_CONFIG.threshold).toBe('number');
      expect(DEFAULT_CONFIG.threshold).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.threshold).toBeLessThanOrEqual(1);
    });

    test('default threshold matches documented value', () => {
      expect(DEFAULT_CONFIG.threshold).toBe(0.7);
    });

    test('default suite is ALL', () => {
      expect(DEFAULT_CONFIG.suite).toBe(SUITES.ALL);
    });

    test('kValues are defined', () => {
      expect(DEFAULT_CONFIG.kValues).toBeDefined();
      expect(Array.isArray(DEFAULT_CONFIG.kValues)).toBe(true);
      expect(DEFAULT_CONFIG.kValues).toContain(1);
      expect(DEFAULT_CONFIG.kValues).toContain(5);
      expect(DEFAULT_CONFIG.kValues).toContain(10);
    });
  });

  describe('Available Suites', () => {
    const expectedSuites = [
      'all',
      'retrieval',
      'answer-quality',
      'grounding',
      'citation',
      'entity-extraction',
      'relationship-extraction',
      'community-summary',
      'lazy-vs-eager',
      'negative-tests'
    ];

    test.each(expectedSuites)('%s suite is defined', (suite) => {
      const suiteValues = Object.values(SUITES);
      expect(suiteValues).toContain(suite);
    });

    test('SUITES object has expected count', () => {
      expect(Object.keys(SUITES).length).toBe(expectedSuites.length);
    });
  });
});

describe('Baseline Dataset Validation', () => {
  const datasetsPath = path.join(__dirname, '../datasets');

  describe('Required Datasets Exist', () => {
    const requiredDatasets = [
      'qa_benchmark.json',
      'entity_ground_truth.json',
      'negative_tests.json'
    ];

    test.each(requiredDatasets)('%s exists', (dataset) => {
      const datasetPath = path.join(datasetsPath, dataset);
      expect(fs.existsSync(datasetPath)).toBe(true);
    });
  });

  describe('QA Benchmark Dataset Structure', () => {
    let qaBenchmark;

    beforeAll(() => {
      const datasetPath = path.join(datasetsPath, 'qa_benchmark.json');
      if (fs.existsSync(datasetPath)) {
        qaBenchmark = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
      }
    });

    test('has metadata section', () => {
      expect(qaBenchmark.metadata).toBeDefined();
    });

    test('has retrieval queries', () => {
      expect(qaBenchmark.retrieval).toBeDefined();
      expect(Array.isArray(qaBenchmark.retrieval)).toBe(true);
      expect(qaBenchmark.retrieval.length).toBeGreaterThan(0);
    });

    test('retrieval queries have required fields', () => {
      const query = qaBenchmark.retrieval[0];
      expect(query.query).toBeDefined();
      expect(query.retrieved).toBeDefined();
      expect(query.relevant).toBeDefined();
    });
  });

  describe('Negative Tests Dataset Structure', () => {
    let negativeTests;

    beforeAll(() => {
      const datasetPath = path.join(datasetsPath, 'negative_tests.json');
      if (fs.existsSync(datasetPath)) {
        negativeTests = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
      }
    });

    test('has test cases', () => {
      expect(negativeTests).toBeDefined();
      // Could be array or object with negative_tests property
      const tests = Array.isArray(negativeTests)
        ? negativeTests
        : (negativeTests.negative_tests || negativeTests.tests);
      expect(Array.isArray(tests)).toBe(true);
      expect(tests.length).toBeGreaterThan(0);
    });
  });

  describe('Entity Ground Truth Dataset Structure', () => {
    let entityGroundTruth;

    beforeAll(() => {
      const datasetPath = path.join(datasetsPath, 'entity_ground_truth.json');
      if (fs.existsSync(datasetPath)) {
        entityGroundTruth = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
      }
    });

    test('has documents with entities', () => {
      expect(entityGroundTruth).toBeDefined();
      const documents = entityGroundTruth.documents || entityGroundTruth;
      expect(Array.isArray(documents)).toBe(true);
    });
  });
});
