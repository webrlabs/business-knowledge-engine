/**
 * Unit tests for Community Summary Evaluator
 * Feature: F6.1.5
 */

const {
  evaluateCommunitySummary,
  evaluateBatchCommunitySummaries,
  calculateEntityCoverage,
  SUMMARY_RUBRICS
} = require('../community-summary-evaluator');

// Mock the OpenAI client and config
jest.mock('../../clients/openai', () => ({
  createOpenAIClient: jest.fn(),
  getOpenAIConfig: jest.fn(() => ({
    deploymentName: 'gpt-4',
    embeddingDeployment: 'text-embedding-ada-002',
    apiVersion: '2024-10-21'
  }))
}));

// Mock the logger
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Community Summary Evaluator', () => {
  describe('SUMMARY_RUBRICS', () => {
    it('should have required dimensions', () => {
      expect(SUMMARY_RUBRICS.accuracy).toBeDefined();
      expect(SUMMARY_RUBRICS.relevance).toBeDefined();
      expect(SUMMARY_RUBRICS.coherence).toBeDefined();
    });

    it('should have 5 criteria levels per dimension', () => {
      Object.values(SUMMARY_RUBRICS).forEach(rubric => {
        expect(rubric.criteria).toHaveLength(5);
        expect(rubric.criteria.map(c => c.score)).toEqual([5, 4, 3, 2, 1]);
      });
    });
  });

  describe('calculateEntityCoverage', () => {
    it('should return 0 for empty inputs', () => {
      expect(calculateEntityCoverage('', ['Entity'])).toBe(0);
      expect(calculateEntityCoverage('Text', [])).toBe(0);
    });

    it('should calculate correct coverage percentage', () => {
      const text = "The community includes Entity A and Entity B.";
      const entities = ["Entity A", "Entity B", "Entity C", "Entity D"];
      // 2 out of 4 = 0.5
      expect(calculateEntityCoverage(text, entities)).toBe(0.5);
    });

    it('should be case insensitive', () => {
      const text = "the community includes entity a.";
      const entities = ["Entity A"];
      expect(calculateEntityCoverage(text, entities)).toBe(1.0);
    });

    it('should handle partial matches correctly', () => {
      // "Entity A" is in text, "Entity B" is not.
      const text = "Entity A is here.";
      const entities = ["Entity A", "Entity B"];
      expect(calculateEntityCoverage(text, entities)).toBe(0.5);
    });
  });

  describe('evaluateCommunitySummary', () => {
    let mockCreate;

    beforeEach(() => {
      const { createOpenAIClient } = require('../../clients/openai');
      mockCreate = jest.fn();
      createOpenAIClient.mockReturnValue({
        chat: {
          completions: {
            create: mockCreate
          }
        }
      });
    });

    it('should evaluate a summary successfully', async () => {
      // Mock OpenAI response
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              accuracy: { score: 5, justification: 'Accurate' },
              relevance: { score: 4, justification: 'Relevant' },
              coherence: { score: 5, justification: 'Coherent' }
            })
          }
        }]
      });

      const item = {
        generatedSummary: {
          title: 'Test Community',
          summary: 'This community contains Alpha and Beta.',
          keyEntities: ['Alpha', 'Beta']
        },
        groundTruth: {
          id: 1,
          members: ['Alpha', 'Beta', 'Gamma'],
          dominantType: 'Type1',
          typeCounts: { Type1: 3 },
          relationships: []
        }
      };

      const result = await evaluateCommunitySummary(item);

      expect(result.overallScore).toBeDefined();
      expect(result.metrics.entityCoverage).toBeCloseTo(0.67, 2); // 2/3 (Alpha, Beta match Alpha, Beta, Gamma)
      // Check OpenAI call
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('Evaluate the following summary');
    });

    it('should use summary keyEntities if ground truth members missing', async () => {
       mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              accuracy: { score: 5, justification: '' },
              relevance: { score: 5, justification: '' },
              coherence: { score: 5, justification: '' }
            })
          }
        }]
      });

      const item = {
        generatedSummary: {
          title: 'Test',
          summary: 'Mentions Alpha.',
          keyEntities: ['Alpha', 'Beta']
        },
        groundTruth: {
          id: 1,
          // no members
        }
      };

      const result = await evaluateCommunitySummary(item);
      expect(result.metrics.entityCoverage).toBe(0.5); // Mentions Alpha out of [Alpha, Beta]
    });
  });

  describe('evaluateBatchCommunitySummaries', () => {
     let mockCreate;

    beforeEach(() => {
      const { createOpenAIClient } = require('../../clients/openai');
      mockCreate = jest.fn();
      createOpenAIClient.mockReturnValue({
        chat: {
          completions: {
            create: mockCreate
          }
        }
      });
    });

    it('should evaluate a batch and aggregate results', async () => {
      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              accuracy: { score: 5, justification: '' },
              relevance: { score: 5, justification: '' },
              coherence: { score: 5, justification: '' }
            })
          }
        }]
      });

      const items = [
        {
          generatedSummary: { title: 'T1', summary: 'Summary mentions Alpha', keyEntities: ['Alpha'] },
          groundTruth: { id: 1, members: ['Alpha'] }
        },
        {
          generatedSummary: { title: 'T2', summary: 'Summary mentions Beta', keyEntities: ['Beta'] },
          groundTruth: { id: 2, members: ['Beta'] }
        }
      ];

      const result = await evaluateBatchCommunitySummaries(items);

      expect(result.itemCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.aggregate.overall.mean).toBe(5);
      expect(result.aggregate.entityCoverage.mean).toBe(1);
    });
  });
});
