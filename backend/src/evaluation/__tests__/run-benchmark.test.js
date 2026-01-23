/**
 * Unit tests for Benchmark Runner Script
 * Feature: F1.3.1
 */

const {
  parseArgs,
  runBenchmark,
  runRetrievalEvaluation,
  runEntityExtractionEvaluation,
  createSampleDataset,
  formatResults,
  formatAsText,
  formatAsMarkdown,
  SUITES,
  OUTPUT_FORMATS,
  DEFAULT_CONFIG
} = require('../run-benchmark');

describe('Benchmark Runner', () => {
  describe('parseArgs', () => {
    it('should return default config with no arguments', () => {
      const config = parseArgs([]);
      expect(config.suite).toBe(SUITES.ALL);
      expect(config.output).toBe(OUTPUT_FORMATS.TEXT);
      expect(config.threshold).toBe(0.7);
      expect(config.failOnThreshold).toBe(false);
      expect(config.verbose).toBe(false);
    });

    it('should parse --suite argument', () => {
      const config = parseArgs(['--suite', 'retrieval']);
      expect(config.suite).toBe('retrieval');
    });

    it('should parse -s short form', () => {
      const config = parseArgs(['-s', 'entity-extraction']);
      expect(config.suite).toBe('entity-extraction');
    });

    it('should parse --dataset argument', () => {
      const config = parseArgs(['--dataset', './data/benchmark.json']);
      expect(config.datasetPath).toBe('./data/benchmark.json');
    });

    it('should parse --output argument', () => {
      const config = parseArgs(['--output', 'json']);
      expect(config.output).toBe('json');
    });

    it('should parse --output-file argument', () => {
      const config = parseArgs(['--output-file', './results.json']);
      expect(config.outputFile).toBe('./results.json');
    });

    it('should parse --threshold argument', () => {
      const config = parseArgs(['--threshold', '0.85']);
      expect(config.threshold).toBe(0.85);
    });

    it('should parse --fail-on-threshold flag', () => {
      const config = parseArgs(['--fail-on-threshold']);
      expect(config.failOnThreshold).toBe(true);
    });

    it('should parse --verbose flag', () => {
      const config = parseArgs(['--verbose']);
      expect(config.verbose).toBe(true);
    });

    it('should parse -v short form', () => {
      const config = parseArgs(['-v']);
      expect(config.verbose).toBe(true);
    });

    it('should parse multiple arguments', () => {
      const config = parseArgs([
        '-s', 'retrieval',
        '-o', 'json',
        '-t', '0.9',
        '--fail-on-threshold',
        '-v'
      ]);
      expect(config.suite).toBe('retrieval');
      expect(config.output).toBe('json');
      expect(config.threshold).toBe(0.9);
      expect(config.failOnThreshold).toBe(true);
      expect(config.verbose).toBe(true);
    });
  });

  describe('createSampleDataset', () => {
    it('should create a valid sample dataset', () => {
      const dataset = createSampleDataset();

      expect(dataset.metadata).toBeDefined();
      expect(dataset.metadata.name).toBe('sample-benchmark');
      expect(dataset.metadata.version).toBe('1.0.0');

      expect(dataset.retrieval).toBeDefined();
      expect(Array.isArray(dataset.retrieval)).toBe(true);
      expect(dataset.retrieval.length).toBeGreaterThan(0);

      expect(dataset.qa).toBeDefined();
      expect(Array.isArray(dataset.qa)).toBe(true);

      expect(dataset.entities).toBeDefined();
      expect(Array.isArray(dataset.entities)).toBe(true);

      expect(dataset.relationships).toBeDefined();
      expect(Array.isArray(dataset.relationships)).toBe(true);
    });

    it('should have valid retrieval data format', () => {
      const dataset = createSampleDataset();
      const item = dataset.retrieval[0];

      expect(item.query).toBeDefined();
      expect(Array.isArray(item.retrieved)).toBe(true);
      expect(Array.isArray(item.relevant)).toBe(true);
    });

    it('should have valid entity data format', () => {
      const dataset = createSampleDataset();
      const item = dataset.entities[0];

      expect(Array.isArray(item.extracted)).toBe(true);
      expect(Array.isArray(item.groundTruth)).toBe(true);

      if (item.extracted.length > 0) {
        expect(item.extracted[0].name).toBeDefined();
        expect(item.extracted[0].type).toBeDefined();
      }
    });
  });

  describe('runRetrievalEvaluation', () => {
    it('should evaluate retrieval metrics correctly', async () => {
      const dataset = {
        retrieval: [
          { query: 'test', retrieved: ['a', 'b', 'c'], relevant: ['a', 'c'] },
          { query: 'test2', retrieved: ['d', 'e', 'f'], relevant: ['e'] }
        ]
      };
      const config = { threshold: 0.5, kValues: [1, 3] };

      const result = await runRetrievalEvaluation(dataset, config);

      expect(result.suite).toBe('retrieval');
      expect(result.status).toBe('success');
      expect(result.metrics.mrr).toBeDefined();
      expect(result.metrics.map).toBeDefined();
      expect(result.metrics.queryCount).toBe(2);
      expect(result.metrics.atK).toBeDefined();
      expect(result.passed).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should skip when no retrieval data', async () => {
      const dataset = { retrieval: [] };
      const config = { threshold: 0.5 };

      const result = await runRetrievalEvaluation(dataset, config);

      expect(result.status).toBe('skipped');
      expect(result.reason).toContain('No retrieval data');
    });

    it('should skip when retrieval is undefined', async () => {
      const dataset = {};
      const config = { threshold: 0.5 };

      const result = await runRetrievalEvaluation(dataset, config);

      expect(result.status).toBe('skipped');
    });
  });

  describe('runEntityExtractionEvaluation', () => {
    it('should evaluate entity extraction correctly', async () => {
      const dataset = {
        entities: [
          {
            extracted: [
              { name: 'Process A', type: 'Process' },
              { name: 'Task B', type: 'Task' }
            ],
            groundTruth: [
              { name: 'Process A', type: 'Process' },
              { name: 'Task B', type: 'Task' }
            ]
          }
        ]
      };
      const config = { threshold: 0.5 };

      const result = await runEntityExtractionEvaluation(dataset, config);

      expect(result.suite).toBe('entity-extraction');
      expect(result.status).toBe('success');
      expect(result.metrics.precision).toBe(1);
      expect(result.metrics.recall).toBe(1);
      expect(result.metrics.f1).toBe(1);
      expect(result.passed).toBe(true);
    });

    it('should handle partial matches', async () => {
      const dataset = {
        entities: [
          {
            extracted: [
              { name: 'Process A', type: 'Process' }
            ],
            groundTruth: [
              { name: 'Process A', type: 'Process' },
              { name: 'Task B', type: 'Task' }
            ]
          }
        ]
      };
      const config = { threshold: 0.5 };

      const result = await runEntityExtractionEvaluation(dataset, config);

      expect(result.status).toBe('success');
      expect(result.metrics.precision).toBe(1);
      expect(result.metrics.recall).toBe(0.5);
      expect(result.metrics.f1).toBeCloseTo(0.667, 2);
    });

    it('should skip when no entity data', async () => {
      const dataset = { entities: [] };
      const config = { threshold: 0.5 };

      const result = await runEntityExtractionEvaluation(dataset, config);

      expect(result.status).toBe('skipped');
      expect(result.reason).toContain('No entity data');
    });
  });

  describe('runBenchmark', () => {
    it('should run all suites with sample dataset', async () => {
      const config = {
        suite: SUITES.ALL,
        threshold: 0.5,
        kValues: [1, 3, 5]
      };

      const results = await runBenchmark(config);

      expect(results.metadata).toBeDefined();
      expect(results.metadata.timestamp).toBeDefined();
      expect(results.metadata.config.suite).toBe(SUITES.ALL);

      expect(results.suites).toBeDefined();
      expect(results.summary).toBeDefined();
      expect(results.summary.total).toBeGreaterThan(0);
    });

    it('should run single suite', async () => {
      const config = {
        suite: SUITES.RETRIEVAL,
        threshold: 0.5,
        kValues: [1, 3]
      };

      const results = await runBenchmark(config);

      expect(results.suites[SUITES.RETRIEVAL]).toBeDefined();
      expect(results.summary.total).toBe(1);
    });

    it('should calculate summary correctly', async () => {
      const config = {
        suite: SUITES.ENTITY_EXTRACTION,
        threshold: 0.5
      };

      const results = await runBenchmark(config);

      const { summary } = results;
      expect(summary.total).toBe(1);
      expect(summary.passed + summary.failed + summary.skipped + summary.errors).toBe(summary.total);
    });

    it('should track latency', async () => {
      const config = {
        suite: SUITES.RETRIEVAL,
        threshold: 0.5,
        kValues: [1]
      };

      const results = await runBenchmark(config);

      expect(results.metadata.totalLatencyMs).toBeGreaterThanOrEqual(0);
      expect(results.suites[SUITES.RETRIEVAL].latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatResults', () => {
    const sampleResults = {
      metadata: {
        timestamp: '2026-01-22T12:00:00Z',
        config: { suite: 'all', threshold: 0.7 },
        dataset: { name: 'test' },
        totalLatencyMs: 100
      },
      suites: {
        retrieval: {
          suite: 'retrieval',
          status: 'success',
          metrics: { mrr: 0.75, map: 0.65, queryCount: 10 },
          passed: true,
          threshold: 0.7,
          latencyMs: 50
        }
      },
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        errors: 0,
        overallPassed: true
      }
    };

    it('should format as JSON', () => {
      const output = formatResults(sampleResults, OUTPUT_FORMATS.JSON);
      const parsed = JSON.parse(output);

      expect(parsed.metadata.timestamp).toBe('2026-01-22T12:00:00Z');
      expect(parsed.suites.retrieval.metrics.mrr).toBe(0.75);
    });

    it('should format as text', () => {
      const output = formatResults(sampleResults, OUTPUT_FORMATS.TEXT);

      expect(output).toContain('BENCHMARK EVALUATION RESULTS');
      expect(output).toContain('RETRIEVAL'); // Suite names are uppercased in text format
      expect(output).toContain('PASSED');
      expect(output).toContain('0.7500');
    });

    it('should format as markdown', () => {
      const output = formatResults(sampleResults, OUTPUT_FORMATS.MARKDOWN);

      expect(output).toContain('# Benchmark Evaluation Results');
      expect(output).toContain('## Summary');
      expect(output).toContain('### retrieval');
      expect(output).toContain('| mrr |');
    });
  });

  describe('formatAsText', () => {
    it('should include all sections', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-22T12:00:00Z',
          config: { suite: 'all', threshold: 0.7 },
          dataset: { name: 'test' },
          totalLatencyMs: 100
        },
        suites: {
          retrieval: {
            suite: 'retrieval',
            status: 'success',
            metrics: { mrr: 0.8 },
            passed: true,
            threshold: 0.7,
            latencyMs: 50
          },
          grounding: {
            suite: 'grounding',
            status: 'skipped',
            reason: 'No data',
            latencyMs: 1
          }
        },
        summary: {
          total: 2,
          passed: 1,
          failed: 0,
          skipped: 1,
          errors: 0,
          overallPassed: true
        }
      };

      const output = formatAsText(results);

      expect(output).toContain('BENCHMARK EVALUATION RESULTS');
      expect(output).toContain('SUMMARY');
      expect(output).toContain('SUITE: RETRIEVAL');
      expect(output).toContain('SUITE: GROUNDING');
      expect(output).toContain('Status: skipped');
      expect(output).toContain('Reason: No data');
    });

    it('should format error status', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-22T12:00:00Z',
          config: { suite: 'all', threshold: 0.7 },
          totalLatencyMs: 100
        },
        suites: {
          retrieval: {
            suite: 'retrieval',
            status: 'error',
            error: 'Test error message',
            latencyMs: 5
          }
        },
        summary: {
          total: 1,
          passed: 0,
          failed: 0,
          skipped: 0,
          errors: 1,
          overallPassed: false
        }
      };

      const output = formatAsText(results);

      expect(output).toContain('Status: error');
      expect(output).toContain('Error: Test error message');
      expect(output).toContain('FAILED');
    });
  });

  describe('formatAsMarkdown', () => {
    it('should produce valid markdown', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-22T12:00:00Z',
          config: { suite: 'retrieval', threshold: 0.8 },
          dataset: { name: 'qa-benchmark' },
          totalLatencyMs: 250
        },
        suites: {
          retrieval: {
            suite: 'retrieval',
            status: 'success',
            metrics: {
              mrr: 0.85,
              map: 0.78,
              queryCount: 50
            },
            passed: true,
            threshold: 0.8,
            latencyMs: 200
          }
        },
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          skipped: 0,
          errors: 0,
          overallPassed: true
        }
      };

      const output = formatAsMarkdown(results);

      // Check markdown structure
      expect(output).toContain('# Benchmark Evaluation Results');
      expect(output).toContain('## Summary');
      expect(output).toContain('| Metric | Value |');
      expect(output).toContain('| Timestamp | 2026-01-22T12:00:00Z |');
      expect(output).toContain('### retrieval');
      expect(output).toContain('**Metrics:**');
      expect(output).toContain('| mrr | 0.8500 |');
    });
  });

  describe('SUITES constant', () => {
    it('should define all expected suites', () => {
      expect(SUITES.ALL).toBe('all');
      expect(SUITES.RETRIEVAL).toBe('retrieval');
      expect(SUITES.ANSWER_QUALITY).toBe('answer-quality');
      expect(SUITES.GROUNDING).toBe('grounding');
      expect(SUITES.CITATION).toBe('citation');
      expect(SUITES.ENTITY_EXTRACTION).toBe('entity-extraction');
      expect(SUITES.RELATIONSHIP_EXTRACTION).toBe('relationship-extraction');
    });
  });

  describe('OUTPUT_FORMATS constant', () => {
    it('should define all expected formats', () => {
      expect(OUTPUT_FORMATS.JSON).toBe('json');
      expect(OUTPUT_FORMATS.TEXT).toBe('text');
      expect(OUTPUT_FORMATS.MARKDOWN).toBe('markdown');
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG.suite).toBe('all');
      expect(DEFAULT_CONFIG.output).toBe('text');
      expect(DEFAULT_CONFIG.threshold).toBe(0.7);
      expect(DEFAULT_CONFIG.failOnThreshold).toBe(false);
      expect(DEFAULT_CONFIG.verbose).toBe(false);
      expect(DEFAULT_CONFIG.kValues).toEqual([1, 3, 5, 10]);
    });
  });
});
