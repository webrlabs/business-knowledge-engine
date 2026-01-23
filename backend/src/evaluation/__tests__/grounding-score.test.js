/**
 * Unit tests for Grounding Score Calculator
 * Feature: F1.2.3 - Grounding Score Calculator
 */

const {
  calculateGroundingScore,
  calculateBatchGroundingScore,
  quickGroundingCheck,
  extractClaims,
  verifyClaims,
  calculateScoreFromVerifications,
  buildClaimExtractionPrompt,
  buildClaimVerificationPrompt,
  formatGroundingScore,
  formatBatchGroundingScore,
  ClaimStatus,
  STATUS_WEIGHTS
} = require('../grounding-score');

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

const { createOpenAIClient, getOpenAIConfig } = require('../../clients/openai');
const { log } = require('../../utils/logger');

describe('Grounding Score Calculator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ClaimStatus constants', () => {
    it('should have all claim status types', () => {
      expect(ClaimStatus.SUPPORTED).toBe('supported');
      expect(ClaimStatus.PARTIALLY_SUPPORTED).toBe('partially_supported');
      expect(ClaimStatus.NOT_SUPPORTED).toBe('not_supported');
      expect(ClaimStatus.NOT_VERIFIABLE).toBe('not_verifiable');
    });
  });

  describe('STATUS_WEIGHTS', () => {
    it('should have correct weights for each status', () => {
      expect(STATUS_WEIGHTS[ClaimStatus.SUPPORTED]).toBe(1.0);
      expect(STATUS_WEIGHTS[ClaimStatus.PARTIALLY_SUPPORTED]).toBe(0.5);
      expect(STATUS_WEIGHTS[ClaimStatus.NOT_SUPPORTED]).toBe(0.0);
      expect(STATUS_WEIGHTS[ClaimStatus.NOT_VERIFIABLE]).toBe(0.0);
    });
  });

  describe('buildClaimExtractionPrompt', () => {
    it('should include the answer to analyze', () => {
      const prompt = buildClaimExtractionPrompt('The company was founded in 2020 and has 100 employees.');

      expect(prompt).toContain('The company was founded in 2020 and has 100 employees.');
    });

    it('should request JSON output format', () => {
      const prompt = buildClaimExtractionPrompt('Test answer');

      expect(prompt).toContain('JSON format');
      expect(prompt).toContain('"claims"');
    });

    it('should include instructions for atomic claims', () => {
      const prompt = buildClaimExtractionPrompt('Test answer');

      expect(prompt).toContain('atomic');
      expect(prompt).toContain('self-contained');
      expect(prompt).toContain('verifiable');
    });
  });

  describe('buildClaimVerificationPrompt', () => {
    it('should include all claims to verify', () => {
      const claims = ['Claim one', 'Claim two', 'Claim three'];
      const context = 'Source document content';

      const prompt = buildClaimVerificationPrompt(claims, context);

      expect(prompt).toContain('1. "Claim one"');
      expect(prompt).toContain('2. "Claim two"');
      expect(prompt).toContain('3. "Claim three"');
    });

    it('should include the source context', () => {
      const claims = ['Test claim'];
      const context = 'This is the source document context for verification.';

      const prompt = buildClaimVerificationPrompt(claims, context);

      expect(prompt).toContain('This is the source document context for verification.');
    });

    it('should include all verification categories', () => {
      const prompt = buildClaimVerificationPrompt(['Claim'], 'Context');

      expect(prompt).toContain('supported');
      expect(prompt).toContain('partially_supported');
      expect(prompt).toContain('not_supported');
      expect(prompt).toContain('not_verifiable');
    });

    it('should request JSON output with required fields', () => {
      const prompt = buildClaimVerificationPrompt(['Claim'], 'Context');

      expect(prompt).toContain('JSON format');
      expect(prompt).toContain('claim_index');
      expect(prompt).toContain('status');
      expect(prompt).toContain('evidence');
      expect(prompt).toContain('confidence');
    });
  });

  describe('calculateScoreFromVerifications', () => {
    it('should return perfect score for all supported claims', () => {
      const verifications = [
        { status: ClaimStatus.SUPPORTED, confidence: 0.9 },
        { status: ClaimStatus.SUPPORTED, confidence: 0.95 },
        { status: ClaimStatus.SUPPORTED, confidence: 0.85 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(1.0);
      expect(result.supportedCount).toBe(3);
      expect(result.unsupportedCount).toBe(0);
      expect(result.totalClaims).toBe(3);
    });

    it('should return zero score for all unsupported claims', () => {
      const verifications = [
        { status: ClaimStatus.NOT_SUPPORTED, confidence: 0.8 },
        { status: ClaimStatus.NOT_SUPPORTED, confidence: 0.9 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(0);
      expect(result.supportedCount).toBe(0);
      expect(result.unsupportedCount).toBe(2);
    });

    it('should calculate partial score for mixed results', () => {
      const verifications = [
        { status: ClaimStatus.SUPPORTED, confidence: 1.0 },
        { status: ClaimStatus.NOT_SUPPORTED, confidence: 1.0 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(0.5);
      expect(result.supportedCount).toBe(1);
      expect(result.unsupportedCount).toBe(1);
    });

    it('should handle partially supported claims with 0.5 weight', () => {
      const verifications = [
        { status: ClaimStatus.PARTIALLY_SUPPORTED, confidence: 1.0 },
        { status: ClaimStatus.PARTIALLY_SUPPORTED, confidence: 1.0 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(0.5);
      expect(result.partialCount).toBe(2);
    });

    it('should return score of 1.0 for empty verifications array', () => {
      const result = calculateScoreFromVerifications([]);

      expect(result.score).toBe(1.0);
      expect(result.totalClaims).toBe(0);
    });

    it('should track not verifiable claims', () => {
      const verifications = [
        { status: ClaimStatus.NOT_VERIFIABLE, confidence: 0.5 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.notVerifiableCount).toBe(1);
      expect(result.score).toBe(0);
    });

    it('should calculate weighted score using confidence', () => {
      const verifications = [
        { status: ClaimStatus.SUPPORTED, confidence: 1.0 },
        { status: ClaimStatus.NOT_SUPPORTED, confidence: 0.0 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      // With confidence, weightedScore should be 1.0 (only the confident claim counts)
      expect(result.weightedScore).toBe(1.0);
    });
  });

  describe('calculateGroundingScore', () => {
    it('should throw error when answer is missing', async () => {
      await expect(calculateGroundingScore({ answer: '', context: 'Some context' }))
        .rejects.toThrow('Answer is required');
    });

    it('should throw error when answer is not a string', async () => {
      await expect(calculateGroundingScore({ answer: 123, context: 'Some context' }))
        .rejects.toThrow('Answer is required and must be a string');
    });

    it('should throw error when context is missing', async () => {
      await expect(calculateGroundingScore({ answer: 'Test answer', context: '' }))
        .rejects.toThrow('Context is required');
    });

    it('should throw error when context is not a string', async () => {
      await expect(calculateGroundingScore({ answer: 'Test answer', context: null }))
        .rejects.toThrow('Context is required and must be a string');
    });

    it('should return perfect score for empty answer', async () => {
      const result = await calculateGroundingScore({ answer: '   ', context: 'Some context' });

      expect(result.score).toBe(1.0);
      expect(result.totalClaims).toBe(0);
    });

    it('should return zero score for empty context', async () => {
      const result = await calculateGroundingScore({ answer: 'Test answer', context: '   ' });

      expect(result.score).toBe(0.0);
      expect(result.totalClaims).toBe(1);
      expect(result.unsupportedClaims.length).toBe(1);
    });

    it('should throw error when deployment name is missing', async () => {
      getOpenAIConfig.mockReturnValueOnce({ deploymentName: null });

      await expect(calculateGroundingScore({
        answer: 'Test answer',
        context: 'Test context'
      })).rejects.toThrow('AZURE_OPENAI_DEPLOYMENT_NAME is required');
    });

    it('should call OpenAI API for claim extraction and verification', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                claims: ['The company has 100 employees']
              })
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                verifications: [{
                  claim_index: 1,
                  status: 'supported',
                  evidence: 'Document states 100 employees',
                  confidence: 0.95
                }]
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
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await calculateGroundingScore({
        answer: 'The company has 100 employees.',
        context: 'According to the annual report, the company has 100 employees.'
      });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.score).toBe(1.0);
      expect(result.totalClaims).toBe(1);
      expect(result.supportedClaims).toBe(1);
    });

    it('should include verifications when option is set', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{
            message: { content: '{"claims": ["Claim 1"]}' }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                verifications: [{
                  claim_index: 1,
                  status: 'supported',
                  evidence: 'Found in doc',
                  confidence: 0.9
                }]
              })
            }
          }]
        });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await calculateGroundingScore(
        { answer: 'Test answer', context: 'Test context' },
        { includeVerifications: true }
      );

      expect(result.verifications).toBeDefined();
      expect(result.verifications.length).toBe(1);
    });

    it('should include latencyMs and evaluatedAt in result', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"claims": []}' } }]
        });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await calculateGroundingScore({
        answer: 'Simple test',
        context: 'Test context'
      });

      expect(result.latencyMs).toBeDefined();
      expect(typeof result.latencyMs).toBe('number');
      expect(result.evaluatedAt).toBeDefined();
      expect(new Date(result.evaluatedAt)).toBeInstanceOf(Date);
    });

    it('should include breakdown in result', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"claims": ["C1", "C2", "C3"]}' } }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                verifications: [
                  { claim_index: 1, status: 'supported', evidence: '', confidence: 0.9 },
                  { claim_index: 2, status: 'partially_supported', evidence: '', confidence: 0.8 },
                  { claim_index: 3, status: 'not_supported', evidence: '', confidence: 0.85 }
                ]
              })
            }
          }]
        });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await calculateGroundingScore({
        answer: 'Multi-claim answer',
        context: 'Context for verification'
      });

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.supported).toBe(1);
      expect(result.breakdown.partiallySupported).toBe(1);
      expect(result.breakdown.notSupported).toBe(1);
    });
  });

  describe('calculateBatchGroundingScore', () => {
    it('should return empty results for empty input', async () => {
      const result = await calculateBatchGroundingScore([]);

      expect(result.results).toEqual([]);
      expect(result.itemCount).toBe(0);
      expect(result.successCount).toBe(0);
    });

    it('should return empty results for null input', async () => {
      const result = await calculateBatchGroundingScore(null);

      expect(result.results).toEqual([]);
      expect(result.itemCount).toBe(0);
    });

    it('should process multiple items', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValue({
          choices: [{ message: { content: '{"claims": []}' } }]
        });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const items = [
        { answer: 'Answer 1', context: 'Context 1' },
        { answer: 'Answer 2', context: 'Context 2' }
      ];

      const result = await calculateBatchGroundingScore(items);

      expect(result.itemCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.results.length).toBe(2);
    });

    it('should handle individual item failures gracefully', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"claims": []}' } }]
        })
        .mockRejectedValueOnce(new Error('API Error'));

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const items = [
        { answer: 'Good answer', context: 'Context 1' },
        { answer: 'Bad answer', context: 'Context 2' }
      ];

      const result = await calculateBatchGroundingScore(items, { concurrency: 1 });

      expect(result.itemCount).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBeDefined();
    });

    it('should calculate aggregate statistics', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"claims": ["C1"]}' } }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                verifications: [{ claim_index: 1, status: 'supported', evidence: '', confidence: 0.9 }]
              })
            }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: '{"claims": ["C1"]}' } }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                verifications: [{ claim_index: 1, status: 'not_supported', evidence: '', confidence: 0.9 }]
              })
            }
          }]
        });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const items = [
        { answer: 'Grounded answer', context: 'Supporting context' },
        { answer: 'Ungrounded answer', context: 'Different context' }
      ];

      const result = await calculateBatchGroundingScore(items, { concurrency: 1 });

      expect(result.aggregate.score).toBeDefined();
      expect(result.aggregate.score.mean).toBe(0.5);
      expect(result.aggregate.score.min).toBe(0);
      expect(result.aggregate.score.max).toBe(1);
      expect(result.aggregate.claims).toBeDefined();
      expect(result.aggregate.claims.total).toBe(2);
    });

    it('should respect concurrency option', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"claims": []}' } }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const items = Array(5).fill({ answer: 'Test', context: 'Context' });

      await calculateBatchGroundingScore(items, { concurrency: 2 });

      // With concurrency 2 and 5 items, should make calls in batches
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should truncate long answers in results', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: '{"claims": []}' } }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const longAnswer = 'A'.repeat(200);
      const items = [{ answer: longAnswer, context: 'Context' }];

      const result = await calculateBatchGroundingScore(items);

      expect(result.results[0].answer.length).toBeLessThan(200);
      expect(result.results[0].answer).toContain('...');
    });
  });

  describe('quickGroundingCheck', () => {
    it('should return score and isGrounded', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: '{"score": 85, "reason": "Most claims supported"}'
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await quickGroundingCheck('Answer', 'Context');

      expect(result.score).toBe(0.85);
      expect(result.isGrounded).toBe(true);
      expect(result.reason).toBe('Most claims supported');
    });

    it('should mark as not grounded below 70%', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: { content: '{"score": 50, "reason": "Half supported"}' }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await quickGroundingCheck('Answer', 'Context');

      expect(result.score).toBe(0.5);
      expect(result.isGrounded).toBe(false);
    });

    it('should clamp scores to valid range', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: { content: '{"score": 150, "reason": "Overcounting"}' }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await quickGroundingCheck('Answer', 'Context');

      expect(result.score).toBe(1.0); // Clamped to max
    });

    it('should handle parse failures gracefully', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: { content: 'Invalid JSON response' }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await quickGroundingCheck('Answer', 'Context');

      expect(result.score).toBe(0.5); // Default
      expect(result.isGrounded).toBe(false);
    });

    it('should throw error when deployment name is missing', async () => {
      getOpenAIConfig.mockReturnValueOnce({ deploymentName: null });

      await expect(quickGroundingCheck('Answer', 'Context'))
        .rejects.toThrow('AZURE_OPENAI_DEPLOYMENT_NAME is required');
    });
  });

  describe('formatGroundingScore', () => {
    it('should format grounding score result', () => {
      const result = {
        score: 0.75,
        weightedScore: 0.8,
        totalClaims: 4,
        evaluatedAt: '2026-01-22T10:00:00Z',
        latencyMs: 1500,
        breakdown: {
          supported: 2,
          partiallySupported: 1,
          notSupported: 1,
          notVerifiable: 0
        },
        unsupportedClaims: [
          { claim: 'Unsupported claim', status: 'not_supported', reason: 'Not in context' }
        ]
      };

      const formatted = formatGroundingScore(result);

      expect(formatted).toContain('Grounding Score Evaluation');
      expect(formatted).toContain('75.0%');
      expect(formatted).toContain('80.0%');
      expect(formatted).toContain('Total Claims: 4');
      expect(formatted).toContain('Supported: 2');
      expect(formatted).toContain('Partially Supported: 1');
      expect(formatted).toContain('Not Supported: 1');
      expect(formatted).toContain('Unsupported Claims:');
      expect(formatted).toContain('Unsupported claim');
    });

    it('should handle null input', () => {
      const formatted = formatGroundingScore(null);

      expect(formatted).toBe('No grounding evaluation available');
    });

    it('should handle result without breakdown', () => {
      const result = {
        score: 0.9,
        weightedScore: 0.9,
        totalClaims: 2,
        evaluatedAt: '2026-01-22T10:00:00Z',
        latencyMs: 500
      };

      const formatted = formatGroundingScore(result);

      expect(formatted).toContain('90.0%');
      expect(formatted).not.toContain('Claim Breakdown:');
    });

    it('should handle result without unsupported claims', () => {
      const result = {
        score: 1.0,
        weightedScore: 1.0,
        totalClaims: 3,
        evaluatedAt: '2026-01-22T10:00:00Z',
        latencyMs: 800,
        breakdown: {
          supported: 3,
          partiallySupported: 0,
          notSupported: 0,
          notVerifiable: 0
        },
        unsupportedClaims: []
      };

      const formatted = formatGroundingScore(result);

      expect(formatted).toContain('100.0%');
      expect(formatted).not.toContain('Unsupported Claims:');
    });
  });

  describe('formatBatchGroundingScore', () => {
    it('should format batch results', () => {
      const batchResult = {
        itemCount: 5,
        successCount: 4,
        aggregate: {
          score: {
            mean: 0.75,
            min: 0.5,
            max: 1.0,
            stdDev: 0.15
          },
          claims: {
            total: 12,
            supported: 9,
            supportRate: 0.75
          }
        }
      };

      const formatted = formatBatchGroundingScore(batchResult);

      expect(formatted).toContain('Batch Grounding Score Evaluation');
      expect(formatted).toContain('Total Items: 5');
      expect(formatted).toContain('Successful: 4');
      expect(formatted).toContain('Failed: 1');
      expect(formatted).toContain('Mean Score: 75.0%');
      expect(formatted).toContain('50.0% - 100.0%');
      expect(formatted).toContain('Total Claims Evaluated: 12');
      expect(formatted).toContain('Claims Supported: 9');
      expect(formatted).toContain('Overall Support Rate: 75.0%');
    });

    it('should handle empty batch result', () => {
      const formatted = formatBatchGroundingScore({ itemCount: 0 });

      expect(formatted).toBe('No batch grounding evaluation results');
    });

    it('should handle null input', () => {
      const formatted = formatBatchGroundingScore(null);

      expect(formatted).toBe('No batch grounding evaluation results');
    });

    it('should handle result without aggregate', () => {
      const batchResult = {
        itemCount: 2,
        successCount: 0,
        aggregate: {}
      };

      const formatted = formatBatchGroundingScore(batchResult);

      expect(formatted).toContain('Total Items: 2');
      expect(formatted).toContain('Successful: 0');
      expect(formatted).not.toContain('Mean Score');
    });
  });

  describe('extractClaims', () => {
    it('should extract claims from answer using LLM', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              claims: ['Company founded in 2020', 'Has 100 employees']
            })
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };

      const claims = await extractClaims('Company founded in 2020 with 100 employees', mockClient, 'gpt-4');

      expect(claims).toHaveLength(2);
      expect(claims[0]).toBe('Company founded in 2020');
      expect(claims[1]).toBe('Has 100 employees');
    });

    it('should handle markdown wrapped JSON', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: '```json\n{"claims": ["Single claim"]}\n```'
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };

      const claims = await extractClaims('Test', mockClient, 'gpt-4');

      expect(claims).toHaveLength(1);
      expect(claims[0]).toBe('Single claim');
    });

    it('should fallback to answer as single claim on parse failure', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: { content: 'Invalid response' }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };

      const claims = await extractClaims('Full answer text', mockClient, 'gpt-4');

      expect(claims).toHaveLength(1);
      expect(claims[0]).toBe('Full answer text');
    });
  });

  describe('verifyClaims', () => {
    it('should verify claims against context', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              verifications: [
                { claim_index: 1, status: 'supported', evidence: 'Found in doc', confidence: 0.95 },
                { claim_index: 2, status: 'not_supported', evidence: 'Not found', confidence: 0.9 }
              ]
            })
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };

      const verifications = await verifyClaims(
        ['Claim 1', 'Claim 2'],
        'Context text',
        mockClient,
        'gpt-4'
      );

      expect(verifications).toHaveLength(2);
      expect(verifications[0].status).toBe('supported');
      expect(verifications[0].claim).toBe('Claim 1');
      expect(verifications[1].status).toBe('not_supported');
    });

    it('should return empty array for empty claims', async () => {
      const mockClient = { chat: { completions: { create: jest.fn() } } };

      const verifications = await verifyClaims([], 'Context', mockClient, 'gpt-4');

      expect(verifications).toEqual([]);
    });

    it('should normalize invalid status values', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              verifications: [
                { claim_index: 1, status: 'invalid_status', evidence: '', confidence: 0.5 }
              ]
            })
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };

      const verifications = await verifyClaims(['Claim'], 'Context', mockClient, 'gpt-4');

      expect(verifications[0].status).toBe(ClaimStatus.NOT_VERIFIABLE);
    });

    it('should clamp confidence values to 0-1 range', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              verifications: [
                { claim_index: 1, status: 'supported', evidence: '', confidence: 1.5 }
              ]
            })
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };

      const verifications = await verifyClaims(['Claim'], 'Context', mockClient, 'gpt-4');

      expect(verifications[0].confidence).toBe(1.0);
    });

    it('should default to not_verifiable on parse failure', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: { content: 'Not valid JSON' }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };

      const verifications = await verifyClaims(['Claim'], 'Context', mockClient, 'gpt-4');

      expect(verifications[0].status).toBe(ClaimStatus.NOT_VERIFIABLE);
      expect(verifications[0].evidence).toBe('Verification failed');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle fully grounded answer', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{
            message: { content: '{"claims": ["The sky is blue"]}' }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                verifications: [{
                  claim_index: 1,
                  status: 'supported',
                  evidence: 'Document confirms sky color',
                  confidence: 0.98
                }]
              })
            }
          }]
        });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await calculateGroundingScore({
        answer: 'The sky is blue.',
        context: 'Scientific fact: The sky appears blue due to Rayleigh scattering.'
      });

      expect(result.score).toBe(1.0);
      expect(result.unsupportedClaims).toHaveLength(0);
    });

    it('should handle completely ungrounded answer', async () => {
      const mockCreate = jest.fn()
        .mockResolvedValueOnce({
          choices: [{
            message: { content: '{"claims": ["The moon is made of cheese"]}' }
          }]
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              content: JSON.stringify({
                verifications: [{
                  claim_index: 1,
                  status: 'not_supported',
                  evidence: 'No evidence of cheese composition in context',
                  confidence: 0.99
                }]
              })
            }
          }]
        });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const result = await calculateGroundingScore({
        answer: 'The moon is made of cheese.',
        context: 'The moon is a rocky celestial body composed of silicate rocks.'
      });

      expect(result.score).toBe(0);
      expect(result.unsupportedClaims.length).toBe(1);
    });
  });
});
