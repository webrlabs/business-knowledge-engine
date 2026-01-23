/**
 * Unit tests for Citation Accuracy Checker
 * Feature: F1.2.2 - Citation Accuracy Checker
 */

const {
  calculateCitationAccuracy,
  calculateBatchCitationAccuracy,
  quickCitationCheck,
  extractCitations,
  calculateNgramOverlap,
  calculateKeywordOverlap,
  findBestMatchingSource,
  calculateScoreFromVerifications,
  buildVerificationPrompt,
  formatCitationAccuracy,
  formatBatchCitationAccuracy,
  CitationStatus,
  STATUS_WEIGHTS,
  CITATION_PATTERNS
} = require('../citation-accuracy');

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

describe('Citation Accuracy Checker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CitationStatus constants', () => {
    it('should have all citation status types', () => {
      expect(CitationStatus.ACCURATE).toBe('accurate');
      expect(CitationStatus.PARTIALLY_ACCURATE).toBe('partially_accurate');
      expect(CitationStatus.INACCURATE).toBe('inaccurate');
      expect(CitationStatus.SOURCE_NOT_FOUND).toBe('source_not_found');
      expect(CitationStatus.FABRICATED).toBe('fabricated');
    });
  });

  describe('STATUS_WEIGHTS', () => {
    it('should have correct weights for each status', () => {
      expect(STATUS_WEIGHTS[CitationStatus.ACCURATE]).toBe(1.0);
      expect(STATUS_WEIGHTS[CitationStatus.PARTIALLY_ACCURATE]).toBe(0.6);
      expect(STATUS_WEIGHTS[CitationStatus.INACCURATE]).toBe(0.0);
      expect(STATUS_WEIGHTS[CitationStatus.SOURCE_NOT_FOUND]).toBe(0.0);
      expect(STATUS_WEIGHTS[CitationStatus.FABRICATED]).toBe(0.0);
    });
  });

  describe('extractCitations', () => {
    it('should extract bracketed number citations [1]', () => {
      const answer = 'The process takes 5 days [1] and requires 3 approvals [2].';
      const citations = extractCitations(answer);

      expect(citations.length).toBe(2);
      expect(citations[0].text).toBe('[1]');
      expect(citations[1].text).toBe('[2]');
    });

    it('should extract source file citations', () => {
      const answer = 'According to the policy (Source: policy.pdf), employees must complete training.';
      const citations = extractCitations(answer);

      expect(citations.length).toBeGreaterThan(0);
      expect(citations.some(c => c.text.includes('policy.pdf'))).toBe(true);
    });

    it('should extract "according to" attributions', () => {
      const answer = 'According to the annual report, revenue increased by 15%.';
      const citations = extractCitations(answer);

      expect(citations.length).toBeGreaterThan(0);
      expect(citations.some(c => c.patternType === 'attribution')).toBe(true);
    });

    it('should extract page references', () => {
      const answer = 'The procedure is detailed in section 3.2 (p. 45).';
      const citations = extractCitations(answer);

      expect(citations.length).toBeGreaterThan(0);
      expect(citations.some(c => c.text.includes('45'))).toBe(true);
    });

    it('should return empty array for answer without citations', () => {
      const answer = 'The sky is blue and grass is green.';
      const citations = extractCitations(answer);

      expect(citations.length).toBe(0);
    });

    it('should extract cited content before citation marker', () => {
      const answer = 'The company was founded in 2020 with an initial investment of $5 million [1].';
      const citations = extractCitations(answer);

      expect(citations.length).toBe(1);
      expect(citations[0].citedContent).toContain('founded');
    });

    it('should handle multiple citation formats in same answer', () => {
      const answer = 'Revenue grew 15% [1] according to the annual report (p. 23).';
      const citations = extractCitations(answer);

      expect(citations.length).toBeGreaterThanOrEqual(2);
    });

    it('should sort citations by position', () => {
      const answer = 'First claim [2]. Second claim [1]. Third claim [3].';
      const citations = extractCitations(answer);

      for (let i = 1; i < citations.length; i++) {
        expect(citations[i].position).toBeGreaterThan(citations[i - 1].position);
      }
    });
  });

  describe('calculateNgramOverlap', () => {
    it('should return 1.0 for identical texts', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const score = calculateNgramOverlap(text, text);

      expect(score).toBe(1.0);
    });

    it('should return 0 for completely different texts', () => {
      const text1 = 'apple banana cherry date elderberry';
      const text2 = 'xylophone zebra umbrella violin trumpet';
      const score = calculateNgramOverlap(text1, text2);

      expect(score).toBe(0);
    });

    it('should return partial score for partially matching texts', () => {
      const text1 = 'The company has 100 employees';
      const text2 = 'The company has grown to 100 employees this year';
      const score = calculateNgramOverlap(text1, text2);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('should handle empty strings', () => {
      expect(calculateNgramOverlap('', 'text')).toBe(0);
      expect(calculateNgramOverlap('text', '')).toBe(0);
      expect(calculateNgramOverlap('', '')).toBe(0);
    });

    it('should be case insensitive', () => {
      const score1 = calculateNgramOverlap('HELLO WORLD', 'hello world');
      const score2 = calculateNgramOverlap('hello world', 'hello world');

      expect(score1).toBe(score2);
    });

    it('should handle very short texts', () => {
      const score = calculateNgramOverlap('hi', 'hi');

      expect(score).toBeGreaterThan(0);
    });
  });

  describe('calculateKeywordOverlap', () => {
    it('should return high score for matching keywords', () => {
      const citedContent = 'The company revenue increased 15%';
      const sourceContent = 'Annual report shows company revenue increased by 15 percent';
      const result = calculateKeywordOverlap(citedContent, sourceContent);

      expect(result.score).toBeGreaterThan(0.5);
      expect(result.matchedKeywords.length).toBeGreaterThan(0);
    });

    it('should filter out stop words', () => {
      const citedContent = 'the and for are but not';
      const sourceContent = 'different content here';
      const result = calculateKeywordOverlap(citedContent, sourceContent);

      expect(result.totalKeywords).toBe(0);
    });

    it('should handle empty inputs', () => {
      expect(calculateKeywordOverlap('', 'content').score).toBe(0);
      expect(calculateKeywordOverlap('content', '').score).toBe(0);
    });

    it('should return unique matched keywords', () => {
      const citedContent = 'revenue revenue revenue growth';
      const sourceContent = 'revenue growth expected';
      const result = calculateKeywordOverlap(citedContent, sourceContent);

      const uniqueMatches = [...new Set(result.matchedKeywords)];
      expect(result.matchedKeywords.length).toBe(uniqueMatches.length);
    });
  });

  describe('findBestMatchingSource', () => {
    const sources = [
      { id: 'doc1', content: 'The company was founded in 2020 and has grown significantly.' },
      { id: 'doc2', content: 'Revenue increased by 15% in the last fiscal year.' },
      { id: 'doc3', content: 'Employee count reached 500 people this quarter.' }
    ];

    it('should find best matching source', () => {
      const citedContent = 'The company was founded in 2020';
      const match = findBestMatchingSource(citedContent, sources);

      expect(match).not.toBeNull();
      expect(match.source.id).toBe('doc1');
      expect(match.combinedScore).toBeGreaterThan(0);
    });

    it('should return null for empty sources array', () => {
      const match = findBestMatchingSource('Some content', []);

      expect(match).toBeNull();
    });

    it('should return null for null sources', () => {
      const match = findBestMatchingSource('Some content', null);

      expect(match).toBeNull();
    });

    it('should include match scores in result', () => {
      const citedContent = 'Revenue increased by 15%';
      const match = findBestMatchingSource(citedContent, sources);

      expect(match).not.toBeNull();
      expect(match.ngramScore).toBeDefined();
      expect(match.keywordScore).toBeDefined();
      expect(match.combinedScore).toBeDefined();
    });
  });

  describe('calculateScoreFromVerifications', () => {
    it('should return perfect score for all accurate citations', () => {
      const verifications = [
        { status: CitationStatus.ACCURATE, confidence: 0.9 },
        { status: CitationStatus.ACCURATE, confidence: 0.95 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(1.0);
      expect(result.accurateCount).toBe(2);
      expect(result.totalCitations).toBe(2);
    });

    it('should return zero score for all inaccurate citations', () => {
      const verifications = [
        { status: CitationStatus.INACCURATE, confidence: 0.8 },
        { status: CitationStatus.FABRICATED, confidence: 0.9 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(0);
      expect(result.inaccurateCount).toBe(1);
      expect(result.fabricatedCount).toBe(1);
    });

    it('should calculate partial score for mixed results', () => {
      const verifications = [
        { status: CitationStatus.ACCURATE, confidence: 1.0 },
        { status: CitationStatus.INACCURATE, confidence: 1.0 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(0.5);
    });

    it('should handle partially accurate citations with 0.6 weight', () => {
      const verifications = [
        { status: CitationStatus.PARTIALLY_ACCURATE, confidence: 1.0 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.score).toBe(0.6);
      expect(result.partialCount).toBe(1);
    });

    it('should return score of 1.0 for empty verifications array', () => {
      const result = calculateScoreFromVerifications([]);

      expect(result.score).toBe(1.0);
      expect(result.totalCitations).toBe(0);
    });

    it('should track source not found citations', () => {
      const verifications = [
        { status: CitationStatus.SOURCE_NOT_FOUND, confidence: 0.5 }
      ];

      const result = calculateScoreFromVerifications(verifications);

      expect(result.notFoundCount).toBe(1);
      expect(result.score).toBe(0);
    });
  });

  describe('buildVerificationPrompt', () => {
    it('should include cited content', () => {
      const prompt = buildVerificationPrompt(
        'The company has 100 employees',
        'Source document content',
        '[1]'
      );

      expect(prompt).toContain('The company has 100 employees');
    });

    it('should include source content', () => {
      const prompt = buildVerificationPrompt(
        'Citation',
        'This is the actual source document content',
        '[1]'
      );

      expect(prompt).toContain('This is the actual source document content');
    });

    it('should include citation reference', () => {
      const prompt = buildVerificationPrompt(
        'Citation',
        'Source',
        'policy.pdf'
      );

      expect(prompt).toContain('policy.pdf');
    });

    it('should include all verification categories', () => {
      const prompt = buildVerificationPrompt('C', 'S', '[1]');

      expect(prompt).toContain('accurate');
      expect(prompt).toContain('partially_accurate');
      expect(prompt).toContain('inaccurate');
      expect(prompt).toContain('fabricated');
    });

    it('should request JSON output', () => {
      const prompt = buildVerificationPrompt('C', 'S', '[1]');

      expect(prompt).toContain('JSON');
      expect(prompt).toContain('status');
      expect(prompt).toContain('confidence');
    });
  });

  describe('calculateCitationAccuracy', () => {
    it('should throw error when answer is missing', async () => {
      await expect(calculateCitationAccuracy({ answer: '', sources: [] }))
        .rejects.toThrow('Answer is required');
    });

    it('should throw error when answer is not a string', async () => {
      await expect(calculateCitationAccuracy({ answer: 123, sources: [] }))
        .rejects.toThrow('Answer is required and must be a string');
    });

    it('should throw error when sources is not an array', async () => {
      await expect(calculateCitationAccuracy({ answer: 'Test', sources: 'not-array' }))
        .rejects.toThrow('Sources must be an array');
    });

    it('should return perfect score for empty answer', async () => {
      const result = await calculateCitationAccuracy({ answer: '   ', sources: [] });

      expect(result.score).toBe(1.0);
      expect(result.totalCitations).toBe(0);
    });

    it('should return perfect score when no citations found', async () => {
      const result = await calculateCitationAccuracy({
        answer: 'The sky is blue.',
        sources: [{ id: 'doc1', content: 'Sky color information' }]
      });

      expect(result.score).toBe(1.0);
      expect(result.totalCitations).toBe(0);
      expect(result.noCitationsFound).toBe(true);
    });

    it('should use text matching for high-confidence matches', async () => {
      const sources = [
        { id: 'doc1', content: 'The company was founded in 2020 and has grown significantly since then.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'The company was founded in 2020 [1].',
        sources
      }, { useLLM: false });

      expect(result.totalCitations).toBe(1);
      expect(result.latencyMs).toBeDefined();
    });

    it('should include breakdown in result', async () => {
      const sources = [
        { id: 'doc1', content: 'Revenue increased by 15% in the fiscal year 2024.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'Revenue increased by 15% [1].',
        sources
      }, { useLLM: false });

      expect(result.breakdown).toBeDefined();
      expect(typeof result.breakdown.accurate).toBe('number');
      expect(typeof result.breakdown.inaccurate).toBe('number');
    });

    it('should include verifications when includeDetails is true', async () => {
      const sources = [
        { id: 'doc1', content: 'The process takes 5 days to complete.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'The process takes 5 days [1].',
        sources
      }, { useLLM: false, includeDetails: true });

      expect(result.verifications).toBeDefined();
      expect(result.verifications.length).toBeGreaterThan(0);
    });

    it('should include evaluatedAt timestamp', async () => {
      const result = await calculateCitationAccuracy({
        answer: 'Test answer.',
        sources: []
      });

      expect(result.evaluatedAt).toBeDefined();
      expect(new Date(result.evaluatedAt)).toBeInstanceOf(Date);
    });

    it('should use LLM verification when enabled and text match is low', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              status: 'accurate',
              confidence: 0.9,
              matchedPassage: 'Found passage',
              discrepancies: [],
              reasoning: 'Citation matches source'
            })
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const sources = [
        { id: 'doc1', content: 'Completely different content that will not match well.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'The specific policy requirement states X [1].',
        sources
      }, { useLLM: true, textMatchThreshold: 0.9 });

      expect(mockCreate).toHaveBeenCalled();
    });
  });

  describe('calculateBatchCitationAccuracy', () => {
    it('should return empty results for empty input', async () => {
      const result = await calculateBatchCitationAccuracy([]);

      expect(result.results).toEqual([]);
      expect(result.itemCount).toBe(0);
      expect(result.successCount).toBe(0);
    });

    it('should return empty results for null input', async () => {
      const result = await calculateBatchCitationAccuracy(null);

      expect(result.results).toEqual([]);
      expect(result.itemCount).toBe(0);
    });

    it('should process multiple items', async () => {
      const items = [
        { answer: 'Answer 1 without citations.', sources: [{ id: 'doc1', content: 'Source 1' }] },
        { answer: 'Answer 2 without citations.', sources: [{ id: 'doc2', content: 'Source 2' }] }
      ];

      const result = await calculateBatchCitationAccuracy(items);

      expect(result.itemCount).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.results.length).toBe(2);
    });

    it('should handle individual item failures gracefully', async () => {
      const items = [
        { answer: 'Valid answer.', sources: [] },
        { answer: null, sources: [] } // This will fail
      ];

      const result = await calculateBatchCitationAccuracy(items);

      expect(result.itemCount).toBe(2);
      expect(result.successCount).toBe(1);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toBeDefined();
    });

    it('should calculate aggregate statistics', async () => {
      const items = [
        { answer: 'Answer 1.', sources: [] },
        { answer: 'Answer 2.', sources: [] }
      ];

      const result = await calculateBatchCitationAccuracy(items);

      expect(result.aggregate).toBeDefined();
      if (result.successCount > 0) {
        expect(result.aggregate.score).toBeDefined();
        expect(result.aggregate.citations).toBeDefined();
      }
    });

    it('should truncate long answers in results', async () => {
      const longAnswer = 'A'.repeat(200);
      const items = [{ answer: longAnswer, sources: [] }];

      const result = await calculateBatchCitationAccuracy(items);

      expect(result.results[0].answer.length).toBeLessThan(200);
      expect(result.results[0].answer).toContain('...');
    });
  });

  describe('quickCitationCheck', () => {
    it('should return hasCitations: false when no citations found', async () => {
      const result = await quickCitationCheck(
        'The sky is blue.',
        'Source content'
      );

      expect(result.hasCitations).toBe(false);
      expect(result.citationCount).toBe(0);
      expect(result.estimatedAccuracy).toBe(1.0);
    });

    it('should detect citations and estimate accuracy', async () => {
      const result = await quickCitationCheck(
        'The company was founded in 2020 [1].',
        'The company was founded in 2020 and has grown significantly.'
      );

      expect(result.hasCitations).toBe(true);
      expect(result.citationCount).toBeGreaterThan(0);
      expect(result.estimatedAccuracy).toBeGreaterThanOrEqual(0);
      expect(result.estimatedAccuracy).toBeLessThanOrEqual(1);
    });

    it('should indicate likely accuracy status', async () => {
      const result = await quickCitationCheck(
        'Revenue increased 15% [1].',
        'Annual report shows revenue increased by 15 percent year over year.'
      );

      expect(result.likelyAccurate).toBeDefined();
      expect(typeof result.likelyAccurate).toBe('boolean');
    });

    it('should provide descriptive message', async () => {
      const result = await quickCitationCheck(
        'Test answer.',
        'Source content'
      );

      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe('string');
    });
  });

  describe('formatCitationAccuracy', () => {
    it('should format citation accuracy result', () => {
      const result = {
        score: 0.8,
        weightedScore: 0.85,
        totalCitations: 5,
        accurateCitations: 4,
        evaluatedAt: '2026-01-22T10:00:00Z',
        latencyMs: 1500,
        breakdown: {
          accurate: 4,
          partiallyAccurate: 0,
          inaccurate: 1,
          sourceNotFound: 0,
          fabricated: 0
        },
        inaccurateCitations: [
          { citation: '[2]', citedContent: 'Wrong claim', status: 'inaccurate', discrepancies: ['Fact error'] }
        ]
      };

      const formatted = formatCitationAccuracy(result);

      expect(formatted).toContain('Citation Accuracy Evaluation');
      expect(formatted).toContain('80.0%');
      expect(formatted).toContain('Total Citations: 5');
      expect(formatted).toContain('Accurate: 4');
      expect(formatted).toContain('Inaccurate: 1');
      expect(formatted).toContain('Inaccurate Citations:');
    });

    it('should handle null input', () => {
      const formatted = formatCitationAccuracy(null);

      expect(formatted).toBe('No citation accuracy evaluation available');
    });

    it('should handle result with no citations', () => {
      const result = {
        score: 1.0,
        weightedScore: 1.0,
        totalCitations: 0,
        noCitationsFound: true,
        evaluatedAt: '2026-01-22T10:00:00Z',
        latencyMs: 100
      };

      const formatted = formatCitationAccuracy(result);

      expect(formatted).toContain('No citations were found');
    });

    it('should handle result without breakdown', () => {
      const result = {
        score: 0.9,
        weightedScore: 0.9,
        totalCitations: 2,
        evaluatedAt: '2026-01-22T10:00:00Z',
        latencyMs: 500
      };

      const formatted = formatCitationAccuracy(result);

      expect(formatted).toContain('90.0%');
      expect(formatted).not.toContain('Citation Breakdown:');
    });
  });

  describe('formatBatchCitationAccuracy', () => {
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
          citations: {
            total: 12,
            accurate: 9,
            accuracyRate: 0.75
          }
        }
      };

      const formatted = formatBatchCitationAccuracy(batchResult);

      expect(formatted).toContain('Batch Citation Accuracy Evaluation');
      expect(formatted).toContain('Total Items: 5');
      expect(formatted).toContain('Successful: 4');
      expect(formatted).toContain('Failed: 1');
      expect(formatted).toContain('Mean Score: 75.0%');
      expect(formatted).toContain('Total Citations Evaluated: 12');
    });

    it('should handle empty batch result', () => {
      const formatted = formatBatchCitationAccuracy({ itemCount: 0 });

      expect(formatted).toBe('No batch citation accuracy evaluation results');
    });

    it('should handle null input', () => {
      const formatted = formatBatchCitationAccuracy(null);

      expect(formatted).toBe('No batch citation accuracy evaluation results');
    });
  });

  describe('CITATION_PATTERNS', () => {
    it('should be an array of regex patterns', () => {
      expect(Array.isArray(CITATION_PATTERNS)).toBe(true);
      CITATION_PATTERNS.forEach(pattern => {
        expect(pattern).toBeInstanceOf(RegExp);
      });
    });

    it('should include pattern for bracketed numbers', () => {
      const pattern = CITATION_PATTERNS.find(p => p.toString().includes('\\['));
      expect(pattern).toBeDefined();
      expect('[1]').toMatch(pattern);
      expect('[2, 3]').toMatch(pattern);
    });

    it('should include pattern for source files', () => {
      const pattern = CITATION_PATTERNS.find(p => p.toString().includes('pdf'));
      expect(pattern).toBeDefined();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle answer with accurate citations', async () => {
      const sources = [
        { id: 'annual-report', content: 'The company achieved 15% revenue growth in fiscal year 2024, reaching total revenue of $50 million.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'The company achieved 15% revenue growth [1], reaching $50 million in total revenue.',
        sources
      }, { useLLM: false });

      expect(result.totalCitations).toBeGreaterThan(0);
      expect(result.latencyMs).toBeDefined();
    });

    it('should handle answer with mixed citation accuracy', async () => {
      const sources = [
        { id: 'doc1', content: 'The project was completed in 2024.' },
        { id: 'doc2', content: 'Budget was $1 million.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'The project was completed in 2024 [1]. The budget was $5 million [2].',
        sources
      }, { useLLM: false });

      expect(result.totalCitations).toBeGreaterThan(0);
    });

    it('should handle answer with fabricated citations', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              status: 'fabricated',
              confidence: 0.95,
              matchedPassage: '',
              discrepancies: ['No mention of Mars colonization in sources'],
              reasoning: 'Citation refers to content not present in any source'
            })
          }
        }]
      });

      const mockClient = { chat: { completions: { create: mockCreate } } };
      createOpenAIClient.mockReturnValue(mockClient);

      const sources = [
        { id: 'doc1', content: 'Company focuses on software development.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'The company plans to colonize Mars by 2030 [1].',
        sources
      }, { useLLM: true, textMatchThreshold: 0.9 });

      // Should have detected the citation
      expect(result.totalCitations).toBe(1);
    });

    it('should handle multiple citation formats together', async () => {
      const sources = [
        { id: 'policy.pdf', content: 'All employees must complete safety training within 30 days of hire.' },
        { id: 'handbook.docx', content: 'The company offers 15 days of paid time off annually.' }
      ];

      const result = await calculateCitationAccuracy({
        answer: 'Safety training must be completed within 30 days [1] (Source: policy.pdf). ' +
                'PTO allowance is 15 days per the handbook (p. 23).',
        sources
      }, { useLLM: false });

      expect(result.totalCitations).toBeGreaterThanOrEqual(2);
    });
  });
});
