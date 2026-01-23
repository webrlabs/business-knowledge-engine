/**
 * Unit tests for Security Bypass Evaluator (F5.3.4)
 *
 * Tests the red-team security bypass evaluation framework.
 */

const {
  SecurityBypassEvaluator,
  ClassificationBypassTester,
  GroupMembershipBypassTester,
  RoleEscalationTester,
  DepartmentBypassTester,
  ODataInjectionTester,
  SensitiveFieldTester,
  GraphTraversalBypassTester,
  NegativeTestExecutor,
  runSecurityBypassTests,
} = require('../security-bypass-evaluator');

const {
  createSecurityTrimmingService,
  CLASSIFICATION_LEVELS,
} = require('../../services/security-trimming-service');

const fs = require('fs');
const path = require('path');

describe('SecurityBypassEvaluator', () => {
  let evaluator;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    evaluator = new SecurityBypassEvaluator({ securityService });
  });

  describe('Dataset Loading', () => {
    test('should load security bypass test dataset', () => {
      const dataset = evaluator.loadDataset();
      expect(dataset).toBeDefined();
      expect(dataset.metadata).toBeDefined();
      expect(dataset.testCases).toBeDefined();
      expect(Array.isArray(dataset.testCases)).toBe(true);
      expect(dataset.testCases.length).toBeGreaterThan(0);
    });

    test('should have valid dataset metadata', () => {
      const dataset = evaluator.loadDataset();
      expect(dataset.metadata.name).toBe('Security Trimming Bypass Tests');
      expect(dataset.metadata.version).toBeDefined();
      expect(dataset.metadata.categories).toBeDefined();
      expect(dataset.metadata.categories.length).toBeGreaterThan(0);
    });

    test('should have test cases with required fields', () => {
      const dataset = evaluator.loadDataset();
      for (const testCase of dataset.testCases) {
        expect(testCase.id).toBeDefined();
        expect(testCase.category).toBeDefined();
        expect(testCase.name).toBeDefined();
        expect(testCase.expectedOutcome).toBeDefined();
      }
    });

    test('should have test sequences', () => {
      const dataset = evaluator.loadDataset();
      expect(dataset.testSequences).toBeDefined();
      expect(Array.isArray(dataset.testSequences)).toBe(true);
    });

    test('should have statistics section', () => {
      const dataset = evaluator.loadDataset();
      expect(dataset.statistics).toBeDefined();
      expect(dataset.statistics.totalTestCases).toBeGreaterThan(0);
      expect(dataset.statistics.byCategory).toBeDefined();
      expect(dataset.statistics.bySeverity).toBeDefined();
    });
  });

  describe('Full Evaluation', () => {
    test('should run full evaluation and return results', async () => {
      const results = await evaluator.runFullEvaluation();
      expect(results).toBeDefined();
      expect(results.timestamp).toBeDefined();
      expect(results.summary).toBeDefined();
      expect(results.tests).toBeDefined();
      expect(Array.isArray(results.tests)).toBe(true);
    });

    test('should calculate summary statistics', async () => {
      const results = await evaluator.runFullEvaluation();
      expect(results.summary.total).toBeGreaterThan(0);
      expect(results.summary.passed).toBeDefined();
      expect(results.summary.failed).toBeDefined();
      expect(results.summary.passRate).toBeDefined();
      expect(results.summary.total).toBe(results.summary.passed + results.summary.failed);
    });

    test('should categorize results', async () => {
      const results = await evaluator.runFullEvaluation();
      expect(results.summary.byCategory).toBeDefined();
      expect(Object.keys(results.summary.byCategory).length).toBeGreaterThan(0);
    });

    test('should generate recommendations', async () => {
      const results = await evaluator.runFullEvaluation();
      expect(results.recommendations).toBeDefined();
      expect(Array.isArray(results.recommendations)).toBe(true);
    });

    test('should record duration', async () => {
      const results = await evaluator.runFullEvaluation();
      expect(results.duration).toBeDefined();
      expect(typeof results.duration).toBe('number');
      expect(results.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Report Generation', () => {
    test('should generate JSON report', async () => {
      const results = await evaluator.runFullEvaluation();
      const report = evaluator.generateReport(results, 'json');
      expect(report).toBeDefined();
      const parsed = JSON.parse(report);
      expect(parsed.summary).toBeDefined();
    });

    test('should generate markdown report', async () => {
      const results = await evaluator.runFullEvaluation();
      const report = evaluator.generateReport(results, 'markdown');
      expect(report).toContain('# Security Bypass Test Report');
      expect(report).toContain('## Summary');
      expect(report).toContain('| Metric | Value |');
    });

    test('should generate text report', async () => {
      const results = await evaluator.runFullEvaluation();
      const report = evaluator.generateReport(results, 'text');
      expect(report).toContain('SECURITY BYPASS TEST REPORT');
      expect(report).toContain('SUMMARY');
    });
  });
});

describe('ClassificationBypassTester', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new ClassificationBypassTester(securityService);
  });

  describe('Classification Level Enforcement', () => {
    test('should block reader from accessing restricted', () => {
      const testCase = {
        id: 'CB-test-1',
        attackVector: {
          userRole: 'Reader',
          documentClassification: 'restricted',
        },
        expectedOutcome: 'blocked',
      };

      const result = tester.testClassificationEnforcement(testCase);
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
    });

    test('should allow admin to access restricted', () => {
      const testCase = {
        id: 'CB-test-2',
        attackVector: {
          userRole: 'Admin',
          documentClassification: 'restricted',
        },
        expectedOutcome: 'allowed',
      };

      const result = tester.testClassificationEnforcement(testCase);
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
    });

    test('should allow reader to access public', () => {
      const testCase = {
        id: 'CB-test-3',
        attackVector: {
          userRole: 'Reader',
          documentClassification: 'public',
        },
        expectedOutcome: 'allowed',
      };

      const result = tester.testClassificationEnforcement(testCase);
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
    });

    test('should allow reviewer to access confidential', () => {
      const testCase = {
        id: 'CB-test-4',
        attackVector: {
          userRole: 'Reviewer',
          documentClassification: 'confidential',
        },
        expectedOutcome: 'allowed',
      };

      const result = tester.testClassificationEnforcement(testCase);
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
    });
  });

  describe('Null Classification Handling', () => {
    test('should handle null classification safely', () => {
      const result = tester.testNullClassification();
      expect(result).toBeDefined();
      expect(result.testId).toBe('CB-003-runtime');
      // Null classification defaults to 'internal' which is accessible by Reader
      expect(result.actual).toBe('allowed');
    });
  });

  describe('Invalid Classification Handling', () => {
    test('should handle invalid classification values', () => {
      const result = tester.testInvalidClassification();
      expect(result).toBeDefined();
      expect(result.testId).toBe('CB-004-runtime');
    });
  });

  describe('Case Sensitivity', () => {
    test('should test classification case sensitivity', () => {
      const results = tester.testClassificationCaseSensitivity();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result.testId).toContain('CB-002-');
      }
    });
  });
});

describe('GroupMembershipBypassTester', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new GroupMembershipBypassTester(securityService);
  });

  describe('Empty Groups', () => {
    test('should block user with empty groups from group-restricted doc', () => {
      const result = tester.testEmptyGroupsArray();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
    });
  });

  describe('Null Groups', () => {
    test('should block user with null groups from group-restricted doc', () => {
      const result = tester.testNullGroups();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
    });
  });

  describe('Group Case Sensitivity', () => {
    test('should test group name case sensitivity', () => {
      const results = tester.testGroupCaseSensitivity();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(3);
    });
  });

  describe('Whitespace Handling', () => {
    test('should not match group with trailing whitespace', () => {
      const result = tester.testGroupWhitespace();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
    });
  });

  describe('Wildcard Injection', () => {
    test('should block wildcard group injection', () => {
      const result = tester.testWildcardInjection();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
      expect(result.severity).toBe('critical');
    });
  });

  describe('Prototype Pollution', () => {
    test('should resist prototype pollution attack', () => {
      const result = tester.testPrototypePollution();
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('critical');
    });
  });
});

describe('RoleEscalationTester', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new RoleEscalationTester(securityService);
  });

  describe('Admin Role', () => {
    test('should grant admin access to restricted documents', () => {
      const result = tester.testAdminRoleInjection();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
      expect(result.reason).toBe('admin_access');
    });
  });

  describe('Multiple Roles', () => {
    test('should use highest role when multiple roles present', () => {
      const result = tester.testMultipleRoles();
      expect(result.passed).toBe(true);
      expect(result.reason).toBe('admin_access');
    });
  });

  describe('Empty Roles', () => {
    test('should block user with empty roles from restricted', () => {
      const result = tester.testIsAdminFlagBehavior();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
    });
  });
});

describe('DepartmentBypassTester', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new DepartmentBypassTester(securityService);
  });

  describe('Case Sensitivity', () => {
    test('should test department case sensitivity', () => {
      const result = tester.testDepartmentCaseSensitivity();
      expect(result).toBeDefined();
      expect(result.testId).toBe('DP-001-runtime');
    });
  });

  describe('Null Department', () => {
    test('should block null department from department-restricted doc', () => {
      const result = tester.testNullDepartment();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
    });
  });

  describe('Wildcard Injection', () => {
    test('should block wildcard department injection', () => {
      const result = tester.testWildcardDepartment();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('blocked');
      expect(result.severity).toBe('critical');
    });
  });
});

describe('ODataInjectionTester', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new ODataInjectionTester(securityService);
  });

  describe('Group OData Injection', () => {
    test('should escape single quotes in group names', () => {
      const result = tester.testODataInjectionViaGroup();
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('critical');
      // The filter should not contain unescaped injection
      expect(result.details.generatedFilter).not.toContain("') or 1 eq 1");
    });
  });

  describe('Function Injection', () => {
    test('should prevent OData function injection', () => {
      const result = tester.testODataFunctionInjection();
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('critical');
    });
  });

  describe('Department OData Injection', () => {
    test('should escape department in OData filter', () => {
      const result = tester.testDepartmentODataInjection();
      expect(result.passed).toBe(true);
      expect(result.severity).toBe('critical');
    });
  });
});

describe('SensitiveFieldTester', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new SensitiveFieldTester(securityService);
  });

  describe('Reader Field Trimming', () => {
    test('should trim all sensitive fields for reader', () => {
      const result = tester.testReaderFieldTrimming();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('field_trimmed');
      expect(result.details.internalNotes).toBe(false);
      expect(result.details.reviewerComments).toBe(false);
      expect(result.details.uploadedBy).toBe(false);
    });
  });

  describe('Reviewer Field Trimming', () => {
    test('should show reviewer fields but hide admin fields', () => {
      const result = tester.testReviewerFieldTrimming();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('partial_trimmed');
      expect(result.details.internalNotes).toBe(true);
      expect(result.details.reviewerComments).toBe(true);
      expect(result.details.uploadedBy).toBe(false);
    });
  });

  describe('Admin Field Access', () => {
    test('should show all fields to admin', () => {
      const result = tester.testAdminSeesAllFields();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('all_fields_visible');
    });
  });
});

describe('GraphTraversalBypassTester', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new GraphTraversalBypassTester(securityService);
  });

  describe('Relationship Filtering', () => {
    test('should filter relationships with unauthorized endpoints', () => {
      const result = tester.testUnauthorizedRelationshipEndpoints();
      expect(result.passed).toBe(true);
      expect(result.details.inputRelationships).toBe(3);
      expect(result.details.filteredRelationships).toBe(1);
    });
  });

  describe('Entity Status Filtering', () => {
    test('should filter pending/rejected entities for readers', () => {
      const result = tester.testPendingEntityAccess();
      expect(result.passed).toBe(true);
      expect(result.details.filteredEntities).toBe(1);
      expect(result.details.deniedEntities).toBe(2);
    });
  });
});

describe('NegativeTestExecutor', () => {
  let tester;
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
    tester = new NegativeTestExecutor(securityService);
  });

  describe('Legitimate Access', () => {
    test('should allow admin to access restricted', () => {
      const result = tester.testAdminRestrictedAccess();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
    });

    test('should allow group member to access group document', () => {
      const result = tester.testGroupMemberAccess();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
    });

    test('should allow anyone to access public documents', () => {
      const result = tester.testPublicDocumentAccess();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
    });

    test('should allow reviewer to access confidential', () => {
      const result = tester.testReviewerConfidentialAccess();
      expect(result.passed).toBe(true);
      expect(result.actual).toBe('allowed');
    });
  });
});

describe('runSecurityBypassTests CLI', () => {
  test('should run tests via CLI helper', async () => {
    const results = await runSecurityBypassTests();
    expect(results).toBeDefined();
    expect(results.summary).toBeDefined();
    expect(results.tests.length).toBeGreaterThan(0);
  });

  test('should save report to file when output specified', async () => {
    const outputPath = path.join(__dirname, 'test-output-security-bypass.json');

    try {
      await runSecurityBypassTests({
        output: outputPath,
        format: 'json',
      });

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.summary).toBeDefined();
    } finally {
      // Cleanup
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    }
  });
});

describe('Integration Tests', () => {
  test('should have high pass rate for security controls', async () => {
    const evaluator = new SecurityBypassEvaluator();
    const results = await evaluator.runFullEvaluation();

    // Security controls should pass most tests
    expect(results.summary.passRate).toBeGreaterThan(80);
  });

  test('should detect and block critical attack vectors', async () => {
    const evaluator = new SecurityBypassEvaluator();
    const results = await evaluator.runFullEvaluation();

    // Find critical severity tests
    const criticalTests = results.tests.filter(t => t.severity === 'critical');
    const criticalPassed = criticalTests.filter(t => t.passed);

    // All critical tests should pass (security holds)
    expect(criticalPassed.length).toBe(criticalTests.length);
  });

  test('should test all major categories', async () => {
    const evaluator = new SecurityBypassEvaluator();
    const results = await evaluator.runFullEvaluation();

    const categories = Object.keys(results.summary.byCategory);
    const expectedCategories = [
      'classification_bypass',
      'group_membership_bypass',
      'role_escalation',
      'department_bypass',
      'odata_injection',
      'sensitive_field_access',
      'graph_traversal_bypass',
      'negative_tests',
    ];

    for (const expected of expectedCategories) {
      expect(categories).toContain(expected);
    }
  });

  test('should generate actionable recommendations', async () => {
    const evaluator = new SecurityBypassEvaluator();
    const results = await evaluator.runFullEvaluation();

    expect(results.recommendations.length).toBeGreaterThan(0);
    for (const rec of results.recommendations) {
      expect(rec.priority).toBeDefined();
      expect(rec.recommendation).toBeDefined();
    }
  });
});

describe('Edge Cases', () => {
  let securityService;

  beforeEach(() => {
    securityService = createSecurityTrimmingService();
  });

  test('should handle undefined user gracefully', () => {
    const document = { id: 'test', classification: 'public' };
    const result = securityService.checkDocumentAccess(document, undefined);
    // Should not throw, should return a decision
    expect(result).toBeDefined();
    expect(result.allowed).toBeDefined();
  });

  test('should handle empty results array', () => {
    const results = securityService.filterSearchResults([], { roles: ['Reader'] });
    expect(results.filteredResults).toEqual([]);
    expect(results.accessSummary.total).toBe(0);
  });

  test('should handle null results', () => {
    const results = securityService.filterSearchResults(null, { roles: ['Reader'] });
    expect(results.filteredResults).toEqual([]);
  });

  test('should handle entity without classification', () => {
    const document = { id: 'test', name: 'No Classification' };
    const user = { roles: ['Reader'], groups: [] };
    const result = securityService.checkDocumentAccess(document, user);
    // Should default to internal (accessible by reader)
    expect(result.allowed).toBe(true);
  });

  test('should handle deeply nested sensitive fields', () => {
    const document = {
      id: 'test',
      classification: 'public',
      nested: {
        internalNotes: 'should this be trimmed?',
        data: { deep: { processingMetadata: 'deep data' } },
      },
    };
    const user = { roles: ['Reader'], groups: [] };
    const results = securityService.filterSearchResults([document], user);
    const trimmed = results.filteredResults[0];

    // Top-level sensitive fields are trimmed, but nested aren't (current impl)
    expect(trimmed.nested).toBeDefined();
    // Note: Current impl only trims top-level fields
  });

  test('should handle special characters in group names', () => {
    const specialChars = ['group<script>', 'group"test"', "group'test'", 'group&amp;'];

    for (const group of specialChars) {
      const document = {
        id: 'test',
        classification: 'internal',
        allowedGroups: [group],
      };
      const user = { roles: ['Reader'], groups: [group] };

      const result = securityService.checkDocumentAccess(document, user);
      // Exact match should work regardless of special chars
      expect(result.allowed).toBe(true);
    }
  });

  test('should handle very long group names', () => {
    const longGroup = 'a'.repeat(1000);
    const document = {
      id: 'test',
      classification: 'internal',
      allowedGroups: [longGroup],
    };
    const user = { roles: ['Reader'], groups: [longGroup] };

    const result = securityService.checkDocumentAccess(document, user);
    expect(result.allowed).toBe(true);
  });

  test('should handle empty string group', () => {
    const document = {
      id: 'test',
      classification: 'internal',
      allowedGroups: [''],
    };
    const user = { roles: ['Reader'], groups: [''] };

    const result = securityService.checkDocumentAccess(document, user);
    // Empty string group matches empty string - allowed
    expect(result.allowed).toBe(true);
  });
});

describe('CLASSIFICATION_LEVELS constant', () => {
  test('should define all classification levels', () => {
    expect(CLASSIFICATION_LEVELS.public).toBe(0);
    expect(CLASSIFICATION_LEVELS.internal).toBe(1);
    expect(CLASSIFICATION_LEVELS.confidential).toBe(2);
    expect(CLASSIFICATION_LEVELS.restricted).toBe(3);
  });

  test('should have correct hierarchy (public < internal < confidential < restricted)', () => {
    expect(CLASSIFICATION_LEVELS.public).toBeLessThan(CLASSIFICATION_LEVELS.internal);
    expect(CLASSIFICATION_LEVELS.internal).toBeLessThan(CLASSIFICATION_LEVELS.confidential);
    expect(CLASSIFICATION_LEVELS.confidential).toBeLessThan(CLASSIFICATION_LEVELS.restricted);
  });
});
