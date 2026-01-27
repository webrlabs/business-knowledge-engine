const { evaluateNegativeTestCase, evaluateBatchHallucination, Outcome } = require('../hallucination-evaluator');

describe('Hallucination Evaluator', () => {
  const mockTestCase = {
    id: 'test-001',
    question: 'What is the secret?',
    expectedOutcome: Outcome.NOT_FOUND,
    context: 'This is some unrelated context.'
  };

  describe('evaluateNegativeTestCase', () => {
    it('should pass when answer indicates lack of information', async () => {
      const answer = 'I am sorry, but I do not have information about that.';
      const result = await evaluateNegativeTestCase(mockTestCase, answer);
      
      expect(result.passed).toBe(true);
      expect(result.detectedNegative).toBe(true);
    });

    it('should fail when answer does not indicate lack of information', async () => {
      const answer = 'The secret is that the company is doing great.';
      const result = await evaluateNegativeTestCase(mockTestCase, answer);
      
      // Note: Grounding check might still pass or fail depending on context,
      // but without negative detection, it should generally fail for a negative test.
      expect(result.detectedNegative).toBe(false);
    });

    it('should handle different negative phrases', async () => {
      const answers = [
        'Insufficient information in context.',
        'Not found in documents.',
        'Out of scope for this assistant.',
        'I cannot provide that information.'
      ];

      for (const answer of answers) {
        const result = await evaluateNegativeTestCase(mockTestCase, answer);
        expect(result.detectedNegative).toBe(true);
      }
    });
  });

  describe('evaluateBatchHallucination', () => {
    it('should aggregate results correctly', async () => {
      const testCases = [
        { id: '1', question: 'Q1', expectedOutcome: Outcome.NOT_FOUND },
        { id: '2', question: 'Q2', expectedOutcome: Outcome.NOT_FOUND }
      ];
      const answers = [
        'I do not know.',
        'The answer is 42.' // Hallucination
      ];

      const batchResult = await evaluateBatchHallucination(testCases, answers);
      
      expect(batchResult.aggregate.totalCount).toBe(2);
      expect(batchResult.aggregate.passedCount).toBe(1);
      expect(batchResult.aggregate.failedCount).toBe(1);
      expect(batchResult.aggregate.passRate).toBe(0.5);
    });
  });
});
