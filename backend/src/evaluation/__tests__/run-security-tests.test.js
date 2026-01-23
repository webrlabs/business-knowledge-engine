/**
 * Unit tests for Security Test Runner Script
 * Feature: F5.3.6 - Security Test Automation
 */

const {
  parseArgs,
  runSecurityTests,
  checkSecurityThresholds,
  calculateCriticalDetectionRate,
  calculateHighSeverityDetectionRate,
  formatResults,
  formatAsText,
  formatAsMarkdown,
  OUTPUT_FORMATS,
  DEFAULT_CONFIG,
  SECURITY_THRESHOLDS
} = require('../run-security-tests');

// Mock the logger
jest.mock('../../utils/telemetry', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock the prompt injection service for faster tests
jest.mock('../../services/prompt-injection-service', () => ({
  PromptInjectionService: class MockPromptInjectionService {
    constructor() {
      this.config = { enabled: true };
      this.stats = { totalAnalyzed: 0, detected: 0 };
    }
    analyzeText(text) {
      const isRisky = text.toLowerCase().includes('ignore') ||
                      text.toLowerCase().includes('jailbreak') ||
                      text.toLowerCase().includes('bypass');
      return {
        isRisky,
        severity: isRisky ? 'high' : 'none',
        heuristicScore: isRisky ? 75 : 10,
        detectionCount: isRisky ? 1 : 0,
        detections: isRisky ? [{ category: 'instructionOverride' }] : []
      };
    }
    analyzeMessages(messages) {
      const userMessages = messages.filter(m => m.role === 'user');
      const hasRisky = userMessages.some(m =>
        m.content.toLowerCase().includes('ignore') ||
        m.content.toLowerCase().includes('jailbreak')
      );
      return {
        isRisky: hasRisky,
        severity: hasRisky ? 'medium' : 'none',
        detectionCount: hasRisky ? 1 : 0,
        detections: hasRisky ? [{ category: 'cross_message' }] : []
      };
    }
    getStats() {
      return this.stats;
    }
  },
  getPromptInjectionService: () => new (require('../../services/prompt-injection-service').PromptInjectionService)(),
  resetPromptInjectionService: jest.fn(),
  SEVERITY: { NONE: 'none', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' }
}));

describe('Security Test Runner', () => {
  describe('parseArgs', () => {
    it('should return default config with no arguments', () => {
      const config = parseArgs([]);
      expect(config.output).toBe(OUTPUT_FORMATS.TEXT);
      expect(config.threshold).toBe(DEFAULT_CONFIG.threshold);
      expect(config.failOnThreshold).toBe(false);
      expect(config.verbose).toBe(false);
      expect(config.includeMultiTurn).toBe(true);
    });

    it('should parse --output argument', () => {
      const config = parseArgs(['--output', 'json']);
      expect(config.output).toBe('json');
    });

    it('should parse -o short form', () => {
      const config = parseArgs(['-o', 'markdown']);
      expect(config.output).toBe('markdown');
    });

    it('should parse --dataset argument', () => {
      const config = parseArgs(['--dataset', './custom-tests.json']);
      expect(config.datasetPath).toBe('./custom-tests.json');
    });

    it('should parse --threshold argument', () => {
      const config = parseArgs(['--threshold', '0.9']);
      expect(config.threshold).toBe(0.9);
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

    it('should parse --no-multi-turn flag', () => {
      const config = parseArgs(['--no-multi-turn']);
      expect(config.includeMultiTurn).toBe(false);
    });

    it('should parse --category argument', () => {
      const config = parseArgs(['-c', 'instructionOverride', '-c', 'jailbreakPhrases']);
      expect(config.categories).toEqual(['instructionOverride', 'jailbreakPhrases']);
    });

    it('should parse --output-file argument', () => {
      const config = parseArgs(['--output-file', './results.json']);
      expect(config.outputFile).toBe('./results.json');
    });

    it('should parse CI/CD arguments', () => {
      const config = parseArgs([
        '--save-results',
        '--run-name', 'CI Run',
        '--git-commit', 'abc123',
        '--git-branch', 'main',
        '--tag', 'env=test'
      ]);
      expect(config.saveResults).toBe(true);
      expect(config.runName).toBe('CI Run');
      expect(config.gitCommit).toBe('abc123');
      expect(config.gitBranch).toBe('main');
      expect(config.tags).toEqual({ env: 'test' });
    });

    it('should parse multiple arguments together', () => {
      const config = parseArgs([
        '-o', 'json',
        '-t', '0.9',
        '--fail-on-threshold',
        '-v',
        '-c', 'codeExecution'
      ]);
      expect(config.output).toBe('json');
      expect(config.threshold).toBe(0.9);
      expect(config.failOnThreshold).toBe(true);
      expect(config.verbose).toBe(true);
      expect(config.categories).toEqual(['codeExecution']);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have reasonable default threshold', () => {
      expect(DEFAULT_CONFIG.threshold).toBe(0.85);
    });

    it('should include multi-turn tests by default', () => {
      expect(DEFAULT_CONFIG.includeMultiTurn).toBe(true);
    });

    it('should not fail on threshold by default', () => {
      expect(DEFAULT_CONFIG.failOnThreshold).toBe(false);
    });
  });

  describe('SECURITY_THRESHOLDS', () => {
    it('should have critical detection rate threshold', () => {
      expect(SECURITY_THRESHOLDS.criticalDetectionRate).toBe(0.95);
    });

    it('should have recall threshold', () => {
      expect(SECURITY_THRESHOLDS.recall).toBe(0.85);
    });

    it('should have precision threshold', () => {
      expect(SECURITY_THRESHOLDS.precision).toBe(0.80);
    });

    it('should have f1 threshold', () => {
      expect(SECURITY_THRESHOLDS.f1).toBe(0.82);
    });

    it('should have specificity threshold', () => {
      expect(SECURITY_THRESHOLDS.specificity).toBe(0.70);
    });
  });

  describe('calculateCriticalDetectionRate', () => {
    it('should return 1.0 when no critical tests exist', () => {
      const results = {
        testCaseResults: [
          { expectedSeverity: 'high', wasDetected: true },
          { expectedSeverity: 'medium', wasDetected: false }
        ]
      };
      expect(calculateCriticalDetectionRate(results)).toBe(1.0);
    });

    it('should calculate correct rate for critical tests', () => {
      const results = {
        testCaseResults: [
          { expectedSeverity: 'critical', wasDetected: true },
          { expectedSeverity: 'critical', wasDetected: true },
          { expectedSeverity: 'critical', wasDetected: false },
          { expectedSeverity: 'high', wasDetected: false }
        ]
      };
      expect(calculateCriticalDetectionRate(results)).toBeCloseTo(0.667, 2);
    });

    it('should return 1.0 when all critical tests pass', () => {
      const results = {
        testCaseResults: [
          { expectedSeverity: 'critical', wasDetected: true },
          { expectedSeverity: 'critical', wasDetected: true }
        ]
      };
      expect(calculateCriticalDetectionRate(results)).toBe(1.0);
    });
  });

  describe('calculateHighSeverityDetectionRate', () => {
    it('should return 1.0 when no high/critical tests exist', () => {
      const results = {
        testCaseResults: [
          { expectedSeverity: 'low', wasDetected: false },
          { expectedSeverity: 'medium', wasDetected: true }
        ]
      };
      expect(calculateHighSeverityDetectionRate(results)).toBe(1.0);
    });

    it('should include both high and critical severity', () => {
      const results = {
        testCaseResults: [
          { expectedSeverity: 'critical', wasDetected: true },
          { expectedSeverity: 'high', wasDetected: true },
          { expectedSeverity: 'high', wasDetected: false },
          { expectedSeverity: 'medium', wasDetected: false }
        ]
      };
      expect(calculateHighSeverityDetectionRate(results)).toBeCloseTo(0.667, 2);
    });
  });

  describe('checkSecurityThresholds', () => {
    it('should pass when all metrics meet thresholds', () => {
      const results = {
        overall: {
          accuracy: 0.95,
          precision: 0.90,
          recall: 0.92,
          f1: 0.91,
          specificity: 0.85,
          falsePositiveRate: 0.05,
          falseNegativeRate: 0.08
        },
        testCaseResults: [
          { expectedSeverity: 'critical', wasDetected: true },
          { expectedSeverity: 'high', wasDetected: true }
        ]
      };

      const check = checkSecurityThresholds(results, 0.85);
      expect(check.passed).toBe(true);
      expect(check.summary.failedChecks).toBe(0);
    });

    it('should fail when f1 is below threshold', () => {
      const results = {
        overall: {
          accuracy: 0.95,
          precision: 0.90,
          recall: 0.92,
          f1: 0.70, // Below threshold
          specificity: 0.85
        },
        testCaseResults: []
      };

      const check = checkSecurityThresholds(results, 0.85);
      expect(check.passed).toBe(false);
      expect(check.failedChecks.some(c => c.name === 'f1')).toBe(true);
    });

    it('should fail when critical detection rate is low', () => {
      const results = {
        overall: {
          accuracy: 0.95,
          precision: 0.90,
          recall: 0.92,
          f1: 0.91,
          specificity: 0.85
        },
        testCaseResults: [
          { expectedSeverity: 'critical', wasDetected: true },
          { expectedSeverity: 'critical', wasDetected: false },
          { expectedSeverity: 'critical', wasDetected: false },
          { expectedSeverity: 'critical', wasDetected: false }
        ]
      };

      const check = checkSecurityThresholds(results, 0.85);
      expect(check.passed).toBe(false);
      expect(check.failedChecks.some(c => c.name === 'criticalDetection')).toBe(true);
    });

    it('should provide detailed check messages', () => {
      const results = {
        overall: {
          accuracy: 0.80,
          precision: 0.75,
          recall: 0.70,
          f1: 0.72,
          specificity: 0.60
        },
        testCaseResults: []
      };

      const check = checkSecurityThresholds(results, 0.85);
      expect(check.checks.f1.message).toContain('72.00%');
      expect(check.checks.precision.message).toContain('75.00%');
    });
  });

  describe('formatResults', () => {
    const mockResults = {
      metadata: {
        timestamp: '2026-01-23T10:00:00Z',
        datasetName: 'test-dataset',
        datasetVersion: '1.0.0',
        totalTestCases: 10,
        multiTurnSequences: 2,
        totalLatencyMs: 100
      },
      overall: {
        accuracy: 0.90,
        precision: 0.85,
        recall: 0.88,
        f1: 0.865,
        specificity: 0.80,
        falsePositiveRate: 0.10,
        falseNegativeRate: 0.12,
        criticalDetectionRate: 1.0,
        highSeverityDetectionRate: 0.95,
        counts: {
          truePositive: 7,
          trueNegative: 2,
          falsePositive: 1,
          falseNegative: 0
        }
      },
      thresholds: {
        passed: true,
        checks: {
          f1: { value: 0.865, threshold: 0.85, passed: true, message: 'F1 Score: 86.50%' },
          precision: { value: 0.85, threshold: 0.80, passed: true, message: 'Precision: 85.00%' },
          recall: { value: 0.88, threshold: 0.85, passed: true, message: 'Recall: 88.00%' },
          specificity: { value: 0.80, threshold: 0.70, passed: true, message: 'Specificity: 80.00%' },
          criticalDetection: { value: 1.0, threshold: 0.95, passed: true, message: 'Critical: 100%' },
          highSeverityDetection: { value: 0.95, threshold: 0.90, passed: true, message: 'High Severity: 95%' }
        },
        summary: { totalChecks: 6, passedChecks: 6, failedChecks: 0 },
        failedChecks: []
      },
      byCategory: {
        instructionOverride: { accuracy: 0.90, precision: 0.85, recall: 0.88, f1: 0.865, total: 5 }
      },
      bySeverity: {},
      failures: { count: 0, falsePositives: [], falseNegatives: [] },
      passed: true
    };

    it('should format as JSON', () => {
      const output = formatResults(mockResults, OUTPUT_FORMATS.JSON);
      const parsed = JSON.parse(output);
      expect(parsed.metadata.datasetName).toBe('test-dataset');
      expect(parsed.overall.f1).toBe(0.865);
    });

    it('should format as text', () => {
      const output = formatResults(mockResults, OUTPUT_FORMATS.TEXT);
      expect(output).toContain('SECURITY TEST RESULTS');
      expect(output).toContain('OVERALL METRICS');
      expect(output).toContain('THRESHOLD CHECKS');
      expect(output).toContain('86.50%'); // F1 score
    });

    it('should format as markdown', () => {
      const output = formatResults(mockResults, OUTPUT_FORMATS.MARKDOWN);
      expect(output).toContain('# ✅ Security Test Results');
      expect(output).toContain('## Summary');
      expect(output).toContain('## Overall Metrics');
      expect(output).toContain('| **F1 Score** |');
    });
  });

  describe('formatAsText', () => {
    it('should include confusion matrix', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-23T10:00:00Z',
          datasetName: 'test',
          datasetVersion: '1.0.0',
          totalTestCases: 10,
          multiTurnSequences: 0,
          totalLatencyMs: 50
        },
        overall: {
          accuracy: 0.90,
          precision: 0.85,
          recall: 0.88,
          f1: 0.865,
          specificity: 0.80,
          falsePositiveRate: 0.10,
          falseNegativeRate: 0.12,
          criticalDetectionRate: 1.0,
          highSeverityDetectionRate: 0.95,
          counts: {
            truePositive: 7,
            trueNegative: 2,
            falsePositive: 1,
            falseNegative: 0
          }
        },
        thresholds: {
          passed: true,
          checks: {},
          summary: { totalChecks: 0, passedChecks: 0, failedChecks: 0 },
          failedChecks: []
        },
        byCategory: {},
        failures: { count: 0, falsePositives: [], falseNegatives: [] }
      };

      const output = formatAsText(results);
      expect(output).toContain('CONFUSION MATRIX');
      expect(output).toContain('True Positives:  7');
      expect(output).toContain('False Negatives: 0');
    });

    it('should display failed checks', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-23T10:00:00Z',
          datasetName: 'test',
          datasetVersion: '1.0.0',
          totalTestCases: 10,
          multiTurnSequences: 0,
          totalLatencyMs: 50
        },
        overall: {
          accuracy: 0.70,
          precision: 0.60,
          recall: 0.65,
          f1: 0.625,
          specificity: 0.50,
          falsePositiveRate: 0.25,
          falseNegativeRate: 0.35,
          criticalDetectionRate: 0.80,
          highSeverityDetectionRate: 0.75,
          counts: {
            truePositive: 5,
            trueNegative: 2,
            falsePositive: 2,
            falseNegative: 1
          }
        },
        thresholds: {
          passed: false,
          checks: {
            f1: { value: 0.625, threshold: 0.85, passed: false, message: 'F1 Score: 62.50% (threshold: 85%)' }
          },
          summary: { totalChecks: 1, passedChecks: 0, failedChecks: 1 },
          failedChecks: [{ name: 'f1', passed: false, message: 'F1 Score: 62.50%' }]
        },
        byCategory: {},
        failures: { count: 0, falsePositives: [], falseNegatives: [] }
      };

      const output = formatAsText(results);
      expect(output).toContain('[✗]');
      expect(output).toContain('FAILED');
    });
  });

  describe('formatAsMarkdown', () => {
    it('should show passed emoji when tests pass', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-23T10:00:00Z',
          datasetName: 'test',
          datasetVersion: '1.0.0',
          totalTestCases: 10,
          multiTurnSequences: 0,
          totalLatencyMs: 50
        },
        overall: {
          accuracy: 0.95,
          precision: 0.90,
          recall: 0.92,
          f1: 0.91,
          specificity: 0.85,
          falsePositiveRate: 0.05,
          falseNegativeRate: 0.08,
          criticalDetectionRate: 1.0,
          highSeverityDetectionRate: 0.98,
          counts: { truePositive: 9, trueNegative: 1, falsePositive: 0, falseNegative: 0 }
        },
        thresholds: {
          passed: true,
          checks: {
            f1: { passed: true },
            precision: { passed: true },
            recall: { passed: true },
            specificity: { passed: true },
            criticalDetection: { passed: true },
            highSeverityDetection: { passed: true }
          },
          summary: { totalChecks: 6, passedChecks: 6, failedChecks: 0 },
          failedChecks: []
        },
        byCategory: {},
        failures: { count: 0, falsePositives: [], falseNegatives: [] },
        passed: true
      };

      const output = formatAsMarkdown(results);
      expect(output).toContain('# ✅ Security Test Results');
      expect(output).toContain('**PASSED**');
    });

    it('should show failed emoji when tests fail', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-23T10:00:00Z',
          datasetName: 'test',
          datasetVersion: '1.0.0',
          totalTestCases: 10,
          multiTurnSequences: 0,
          totalLatencyMs: 50
        },
        overall: {
          accuracy: 0.70,
          precision: 0.60,
          recall: 0.65,
          f1: 0.625,
          specificity: 0.50,
          falsePositiveRate: 0.25,
          falseNegativeRate: 0.35,
          criticalDetectionRate: 0.80,
          highSeverityDetectionRate: 0.75,
          counts: { truePositive: 5, trueNegative: 2, falsePositive: 2, falseNegative: 1 }
        },
        thresholds: {
          passed: false,
          checks: {
            f1: { passed: false },
            precision: { passed: false },
            recall: { passed: false },
            specificity: { passed: false },
            criticalDetection: { passed: false },
            highSeverityDetection: { passed: false }
          },
          summary: { totalChecks: 6, passedChecks: 0, failedChecks: 6 },
          failedChecks: [
            { name: 'f1', passed: false, message: 'F1: 62.50%' }
          ]
        },
        byCategory: {},
        failures: { count: 1, falsePositives: [], falseNegatives: [{ id: 'ADV-001', name: 'Test', category: 'test', expectedSeverity: 'high' }] },
        passed: false
      };

      const output = formatAsMarkdown(results);
      expect(output).toContain('# ❌ Security Test Results');
      expect(output).toContain('**FAILED**');
    });

    it('should include git metadata when provided', () => {
      const results = {
        metadata: {
          timestamp: '2026-01-23T10:00:00Z',
          datasetName: 'test',
          datasetVersion: '1.0.0',
          totalTestCases: 10,
          multiTurnSequences: 0,
          totalLatencyMs: 50,
          gitCommit: 'abc123def456',
          gitBranch: 'feature/security'
        },
        overall: {
          accuracy: 0.95,
          precision: 0.90,
          recall: 0.92,
          f1: 0.91,
          specificity: 0.85,
          falsePositiveRate: 0.05,
          falseNegativeRate: 0.08,
          criticalDetectionRate: 1.0,
          highSeverityDetectionRate: 0.98,
          counts: { truePositive: 9, trueNegative: 1, falsePositive: 0, falseNegative: 0 }
        },
        thresholds: {
          passed: true,
          checks: {
            f1: { passed: true },
            precision: { passed: true },
            recall: { passed: true },
            specificity: { passed: true },
            criticalDetection: { passed: true },
            highSeverityDetection: { passed: true }
          },
          summary: { totalChecks: 6, passedChecks: 6, failedChecks: 0 },
          failedChecks: []
        },
        byCategory: {},
        failures: { count: 0, falsePositives: [], falseNegatives: [] },
        passed: true
      };

      const output = formatAsMarkdown(results);
      expect(output).toContain('abc123de');
      expect(output).toContain('feature/security');
    });
  });

  describe('runSecurityTests', () => {
    it('should run with default config', async () => {
      const config = { ...DEFAULT_CONFIG, verbose: false };
      const results = await runSecurityTests(config);

      expect(results).toBeDefined();
      expect(results.metadata).toBeDefined();
      expect(results.overall).toBeDefined();
      expect(results.thresholds).toBeDefined();
      expect(typeof results.passed).toBe('boolean');
    });

    it('should include category breakdown', async () => {
      const config = { ...DEFAULT_CONFIG, verbose: false };
      const results = await runSecurityTests(config);

      expect(results.byCategory).toBeDefined();
      expect(typeof results.byCategory).toBe('object');
    });

    it('should calculate critical detection rate', async () => {
      const config = { ...DEFAULT_CONFIG, verbose: false };
      const results = await runSecurityTests(config);

      expect(results.overall.criticalDetectionRate).toBeDefined();
      expect(results.overall.criticalDetectionRate).toBeGreaterThanOrEqual(0);
      expect(results.overall.criticalDetectionRate).toBeLessThanOrEqual(1);
    });

    it('should include threshold check results', async () => {
      const config = { ...DEFAULT_CONFIG, threshold: 0.85 };
      const results = await runSecurityTests(config);

      expect(results.thresholds).toBeDefined();
      expect(results.thresholds.checks).toBeDefined();
      expect(results.thresholds.summary).toBeDefined();
      expect(results.thresholds.summary.totalChecks).toBeGreaterThan(0);
    });

    it('should include verbose results when enabled', async () => {
      const config = { ...DEFAULT_CONFIG, verbose: true };
      const results = await runSecurityTests(config);

      expect(results.testCaseResults).toBeDefined();
    });

    it('should exclude verbose results when disabled', async () => {
      const config = { ...DEFAULT_CONFIG, verbose: false };
      const results = await runSecurityTests(config);

      expect(results.testCaseResults).toBeUndefined();
    });
  });
});

describe('OUTPUT_FORMATS', () => {
  it('should have JSON format', () => {
    expect(OUTPUT_FORMATS.JSON).toBe('json');
  });

  it('should have TEXT format', () => {
    expect(OUTPUT_FORMATS.TEXT).toBe('text');
  });

  it('should have MARKDOWN format', () => {
    expect(OUTPUT_FORMATS.MARKDOWN).toBe('markdown');
  });
});
