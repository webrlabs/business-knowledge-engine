/**
 * Unit tests for LLM-as-Judge Evaluator
 * Feature: F1.2.4
 */

const {
  evaluateAnswer,
  evaluateBatch,
  buildEvaluationPrompt,
  parseEvaluationResponse,
  formatEvaluation,
  formatBatchEvaluation,
  getRubrics,
  RUBRICS
} = require('../llm-judge');

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

describe('LLM-as-Judge Evaluator', () => {
  describe('RUBRICS', () => {
    it('should have all three evaluation dimensions', () => {
      expect(RUBRICS.helpfulness).toBeDefined();
      expect(RUBRICS.accuracy).toBeDefined();
      expect(RUBRICS.completeness).toBeDefined();
    });

    it('should have 5 scoring levels for each dimension', () => {
      for (const [dim, rubric] of Object.entries(RUBRICS)) {
        expect(rubric.criteria).toHaveLength(5);
        expect(rubric.criteria.map(c => c.score)).toEqual([5, 4, 3, 2, 1]);
      }
    });

    it('should have descriptions for all criteria', () => {
      for (const [dim, rubric] of Object.entries(RUBRICS)) {
        expect(rubric.description).toBeTruthy();
        for (const criterion of rubric.criteria) {
          expect(criterion.description).toBeTruthy();
        }
      }
    });
  });

  describe('getRubrics', () => {
    it('should return the evaluation rubrics', () => {
      const rubrics = getRubrics();
      expect(rubrics).toEqual(RUBRICS);
    });
  });

  describe('buildEvaluationPrompt', () => {
    it('should include question, answer, and context', () => {
      const prompt = buildEvaluationPrompt(
        'What is the company policy?',
        'The policy states...',
        'Document context here'
      );

      expect(prompt).toContain('What is the company policy?');
      expect(prompt).toContain('The policy states...');
      expect(prompt).toContain('Document context here');
    });

    it('should include all default dimensions', () => {
      const prompt = buildEvaluationPrompt('Q', 'A', 'C');

      expect(prompt).toContain('Helpfulness');
      expect(prompt).toContain('Accuracy');
      expect(prompt).toContain('Completeness');
    });

    it('should include only specified dimensions', () => {
      const prompt = buildEvaluationPrompt('Q', 'A', 'C', ['helpfulness']);

      expect(prompt).toContain('Helpfulness');
      expect(prompt).not.toContain('### Accuracy');
      expect(prompt).not.toContain('### Completeness');
    });

    it('should include scoring criteria', () => {
      const prompt = buildEvaluationPrompt('Q', 'A', 'C', ['helpfulness']);

      expect(prompt).toContain('5:');
      expect(prompt).toContain('4:');
      expect(prompt).toContain('3:');
      expect(prompt).toContain('2:');
      expect(prompt).toContain('1:');
    });

    it('should request JSON output format', () => {
      const prompt = buildEvaluationPrompt('Q', 'A', 'C');

      expect(prompt).toContain('JSON format');
      expect(prompt).toContain('"score"');
      expect(prompt).toContain('"justification"');
    });
  });

  describe('parseEvaluationResponse', () => {
    it('should parse valid JSON response', () => {
      const response = JSON.stringify({
        helpfulness: { score: 4, justification: 'Good answer' },
        accuracy: { score: 5, justification: 'Fully accurate' },
        completeness: { score: 3, justification: 'Missing details' }
      });

      const result = parseEvaluationResponse(response, ['helpfulness', 'accuracy', 'completeness']);

      expect(result.helpfulness.score).toBe(4);
      expect(result.helpfulness.justification).toBe('Good answer');
      expect(result.accuracy.score).toBe(5);
      expect(result.completeness.score).toBe(3);
    });

    it('should handle JSON wrapped in markdown code blocks', () => {
      const response = '```json\n{"helpfulness": {"score": 4, "justification": "Test"}}\n```';

      const result = parseEvaluationResponse(response, ['helpfulness']);

      expect(result.helpfulness.score).toBe(4);
    });

    it('should handle plain code blocks', () => {
      const response = '```\n{"helpfulness": {"score": 4, "justification": "Test"}}\n```';

      const result = parseEvaluationResponse(response, ['helpfulness']);

      expect(result.helpfulness.score).toBe(4);
    });

    it('should clamp scores to valid range [1, 5]', () => {
      const response = JSON.stringify({
        helpfulness: { score: 10, justification: 'Too high' },
        accuracy: { score: -5, justification: 'Too low' }
      });

      const result = parseEvaluationResponse(response, ['helpfulness', 'accuracy']);

      expect(result.helpfulness.score).toBe(5); // Clamped to max
      expect(result.accuracy.score).toBe(1);    // Clamped to min
    });

    it('should handle missing dimensions gracefully', () => {
      const response = JSON.stringify({
        helpfulness: { score: 4, justification: 'Good' }
        // Missing accuracy and completeness
      });

      const result = parseEvaluationResponse(response, ['helpfulness', 'accuracy', 'completeness']);

      expect(result.helpfulness.score).toBe(4);
      expect(result.accuracy.score).toBe(3); // Default
      expect(result.completeness.score).toBe(3); // Default
    });

    it('should handle invalid JSON gracefully', () => {
      const response = 'This is not JSON';

      const result = parseEvaluationResponse(response, ['helpfulness', 'accuracy']);

      expect(result.helpfulness.score).toBe(3); // Default
      expect(result.accuracy.score).toBe(3); // Default
      expect(result.helpfulness.justification).toContain('Parse error');
    });

    it('should handle missing score in dimension', () => {
      const response = JSON.stringify({
        helpfulness: { justification: 'No score provided' }
      });

      const result = parseEvaluationResponse(response, ['helpfulness']);

      expect(result.helpfulness.score).toBe(3); // Default when parseInt returns NaN
    });
  });

  describe('evaluateAnswer', () => {
    it('should throw error if question is missing', async () => {
      await expect(evaluateAnswer({ answer: 'test' }))
        .rejects.toThrow('Question and answer are required');
    });

    it('should throw error if answer is missing', async () => {
      await expect(evaluateAnswer({ question: 'test' }))
        .rejects.toThrow('Question and answer are required');
    });

    it('should call OpenAI with correct parameters', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              helpfulness: { score: 4, justification: 'Good' },
              accuracy: { score: 5, justification: 'Accurate' },
              completeness: { score: 4, justification: 'Complete' }
            })
          }
        }]
      });

      const mockClient = {
        chat: {
          completions: {
            create: mockCreate
          }
        }
      };

      const result = await evaluateAnswer({
        question: 'What is X?',
        answer: 'X is Y',
        context: 'Document says X is Y'
      }, mockClient);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          temperature: 0.1,
          max_tokens: 500
        })
      );
    });

    it('should return evaluation with all dimensions', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: JSON.stringify({
                    helpfulness: { score: 4, justification: 'Good' },
                    accuracy: { score: 5, justification: 'Accurate' },
                    completeness: { score: 3, justification: 'Partial' }
                  })
                }
              }]
            })
          }
        }
      };

      const result = await evaluateAnswer({
        question: 'Test question',
        answer: 'Test answer',
        context: 'Test context'
      }, mockClient);

      expect(result.dimensions.helpfulness.score).toBe(4);
      expect(result.dimensions.accuracy.score).toBe(5);
      expect(result.dimensions.completeness.score).toBe(3);
      expect(result.overallScore).toBe(4); // (4+5+3)/3 = 4
      expect(result.evaluatedAt).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should evaluate only specified dimensions', async () => {
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: JSON.stringify({
                    helpfulness: { score: 4, justification: 'Good' }
                  })
                }
              }]
            })
          }
        }
      };

      const result = await evaluateAnswer({
        question: 'Test',
        answer: 'Answer',
        context: 'Context',
        dimensions: ['helpfulness']
      }, mockClient);

      expect(result.dimensions.helpfulness).toBeDefined();
      expect(result.dimensions.accuracy).toBeUndefined();
      expect(result.overallScore).toBe(4);
    });

    it('should handle default context when not provided', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              helpfulness: { score: 3, justification: 'OK' }
            })
          }
        }]
      });

      const mockClient = {
        chat: {
          completions: {
            create: mockCreate
          }
        }
      };

      await evaluateAnswer({
        question: 'Test',
        answer: 'Answer',
        dimensions: ['helpfulness']
      }, mockClient);

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[1].content).toContain('No context provided');
    });
  });

  describe('evaluateBatch', () => {
    it('should return empty results for empty input', async () => {
      const result = await evaluateBatch([]);

      expect(result.results).toEqual([]);
      expect(result.itemCount).toBe(0);
      expect(result.aggregate).toEqual({});
    });

    it('should evaluate multiple items', async () => {
      const { createOpenAIClient } = require('../../clients/openai');

      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              helpfulness: { score: 4, justification: 'Good' },
              accuracy: { score: 4, justification: 'Accurate' },
              completeness: { score: 4, justification: 'Complete' }
            })
          }
        }]
      });

      createOpenAIClient.mockReturnValue({
        chat: {
          completions: {
            create: mockCreate
          }
        }
      });

      const items = [
        { question: 'Q1', answer: 'A1', context: 'C1' },
        { question: 'Q2', answer: 'A2', context: 'C2' }
      ];

      const result = await evaluateBatch(items);

      expect(result.itemCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(true);
    });

    it('should calculate aggregate statistics', async () => {
      const { createOpenAIClient } = require('../../clients/openai');

      createOpenAIClient.mockReturnValue({
        chat: {
          completions: {
            create: jest.fn()
              .mockResolvedValueOnce({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      helpfulness: { score: 5, justification: 'Excellent' },
                      accuracy: { score: 4, justification: 'Good' },
                      completeness: { score: 3, justification: 'OK' }
                    })
                  }
                }]
              })
              .mockResolvedValueOnce({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      helpfulness: { score: 3, justification: 'OK' },
                      accuracy: { score: 4, justification: 'Good' },
                      completeness: { score: 5, justification: 'Complete' }
                    })
                  }
                }]
              })
          }
        }
      });

      const items = [
        { question: 'Q1', answer: 'A1', context: 'C1' },
        { question: 'Q2', answer: 'A2', context: 'C2' }
      ];

      const result = await evaluateBatch(items);

      expect(result.aggregate.helpfulness.mean).toBe(4); // (5+3)/2
      expect(result.aggregate.accuracy.mean).toBe(4);    // (4+4)/2
      expect(result.aggregate.completeness.mean).toBe(4); // (3+5)/2
      expect(result.aggregate.overall).toBeDefined();
    });

    it('should handle individual item failures gracefully', async () => {
      const { createOpenAIClient } = require('../../clients/openai');

      createOpenAIClient.mockReturnValue({
        chat: {
          completions: {
            create: jest.fn()
              .mockResolvedValueOnce({
                choices: [{
                  message: {
                    content: JSON.stringify({
                      helpfulness: { score: 4, justification: 'Good' },
                      accuracy: { score: 4, justification: 'Good' },
                      completeness: { score: 4, justification: 'Good' }
                    })
                  }
                }]
              })
              .mockRejectedValueOnce(new Error('API error'))
          }
        }
      });

      const items = [
        { question: 'Q1', answer: 'A1', context: 'C1' },
        { question: 'Q2', answer: 'A2', context: 'C2' }
      ];

      const result = await evaluateBatch(items);

      expect(result.itemCount).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBe('API error');
    });

    it('should respect concurrency option', async () => {
      const { createOpenAIClient } = require('../../clients/openai');

      let concurrentCalls = 0;
      let maxConcurrent = 0;

      createOpenAIClient.mockReturnValue({
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async () => {
              concurrentCalls++;
              maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
              await new Promise(resolve => setTimeout(resolve, 10));
              concurrentCalls--;
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({
                      helpfulness: { score: 4, justification: 'Good' }
                    })
                  }
                }]
              };
            })
          }
        }
      });

      const items = [
        { question: 'Q1', answer: 'A1', context: 'C1' },
        { question: 'Q2', answer: 'A2', context: 'C2' },
        { question: 'Q3', answer: 'A3', context: 'C3' },
        { question: 'Q4', answer: 'A4', context: 'C4' }
      ];

      await evaluateBatch(items, ['helpfulness'], { concurrency: 2 });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe('formatEvaluation', () => {
    it('should format evaluation results as readable string', () => {
      const evaluation = {
        dimensions: {
          helpfulness: { score: 4, justification: 'Good answer' },
          accuracy: { score: 5, justification: 'Fully accurate' },
          completeness: { score: 3, justification: 'Some gaps' }
        },
        overallScore: 4,
        evaluatedAt: '2026-01-22T10:00:00.000Z',
        latencyMs: 1500
      };

      const formatted = formatEvaluation(evaluation);

      expect(formatted).toContain('Overall Score: 4/5');
      expect(formatted).toContain('Helpfulness: 4/5');
      expect(formatted).toContain('Good answer');
      expect(formatted).toContain('Accuracy: 5/5');
      expect(formatted).toContain('Completeness: 3/5');
      expect(formatted).toContain('1500ms');
    });

    it('should handle missing evaluation gracefully', () => {
      expect(formatEvaluation(null)).toContain('No evaluation available');
      expect(formatEvaluation({})).toContain('No evaluation available');
    });
  });

  describe('formatBatchEvaluation', () => {
    it('should format batch results with aggregate statistics', () => {
      const batchResult = {
        results: [],
        itemCount: 10,
        successCount: 9,
        aggregate: {
          helpfulness: { mean: 4.2, min: 3, max: 5, stdDev: 0.5 },
          accuracy: { mean: 4.5, min: 4, max: 5, stdDev: 0.3 },
          completeness: { mean: 3.8, min: 2, max: 5, stdDev: 0.7 },
          overall: { mean: 4.17, min: 3.33, max: 4.67, stdDev: 0.4 }
        }
      };

      const formatted = formatBatchEvaluation(batchResult);

      expect(formatted).toContain('Total Items: 10');
      expect(formatted).toContain('Successful: 9');
      expect(formatted).toContain('Failed: 1');
      expect(formatted).toContain('Overall: 4.17/5');
      expect(formatted).toContain('Helpfulness: 4.20/5');
    });

    it('should handle empty batch results', () => {
      expect(formatBatchEvaluation(null)).toContain('No batch evaluation results');
      expect(formatBatchEvaluation({ itemCount: 0 })).toContain('No batch evaluation results');
    });
  });
});
