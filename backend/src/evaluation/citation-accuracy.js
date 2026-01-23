/**
 * Citation Accuracy Checker
 *
 * Verifies that citations in answers match actual source content.
 * Detects misquotes, fabricated citations, and incorrect attributions.
 *
 * Feature: F1.2.2 - Citation Accuracy Checker
 *
 * Approach: Multi-method verification combining:
 * 1. Citation extraction from answers (multiple formats)
 * 2. N-gram and keyword overlap scoring
 * 3. Semantic similarity via embeddings
 * 4. LLM-based verification for complex cases
 *
 * @see https://arxiv.org/html/2504.15629v2 (CiteFix approach)
 * @see https://www.evidentlyai.com/llm-guide/rag-evaluation
 */

const { createOpenAIClient, getOpenAIConfig } = require('../clients/openai');
const { log } = require('../utils/logger');

/**
 * Citation verification status
 */
const CitationStatus = {
  ACCURATE: 'accurate',           // Citation matches source exactly or near-exactly
  PARTIALLY_ACCURATE: 'partially_accurate', // Citation partially matches, minor discrepancies
  INACCURATE: 'inaccurate',       // Citation doesn't match source content
  SOURCE_NOT_FOUND: 'source_not_found',     // Referenced source not in provided context
  FABRICATED: 'fabricated'        // Citation appears to be made up
};

/**
 * Weights for calculating citation accuracy score
 */
const STATUS_WEIGHTS = {
  [CitationStatus.ACCURATE]: 1.0,
  [CitationStatus.PARTIALLY_ACCURATE]: 0.6,
  [CitationStatus.INACCURATE]: 0.0,
  [CitationStatus.SOURCE_NOT_FOUND]: 0.0,
  [CitationStatus.FABRICATED]: 0.0
};

/**
 * Citation patterns to detect in answers
 * Ordered by specificity (most specific first)
 */
const CITATION_PATTERNS = [
  // Bracketed number citations: [1], [2, 3], [1-3]
  /\[(\d+(?:[-,]\s*\d+)*)\]/g,

  // Parenthetical source citations: (Source: doc.pdf), (document.pdf, p. 5)
  /\((?:Source:\s*)?([^)]+?\.(?:pdf|docx?|txt|md|html?)[^)]*)\)/gi,

  // "According to X" patterns
  /(?:according to|as (?:stated|mentioned|described) in|per|from)\s+["""]?([^"""\n,]+(?:\.[a-z]{2,4})?)["""]?/gi,

  // Page/section references: (p. 5), (page 12), (section 3.2)
  /\((?:p\.?|page|section|sec\.?)\s*([\d.]+)\)/gi,

  // Footnote-style: ¹, ², ³ (superscript numbers)
  /[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g,

  // Quote attribution: "quote" - Source
  /"([^"]+)"\s*[-–—]\s*([^,\n]+)/g
];

/**
 * Extract citations from an answer text
 *
 * @param {string} answer - The answer containing citations
 * @returns {Array<{text: string, reference: string, position: number, pattern: string}>}
 */
function extractCitations(answer) {
  const citations = [];
  const seenPositions = new Set();

  for (const pattern of CITATION_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(answer)) !== null) {
      const position = match.index;

      // Avoid duplicate detections at same position
      if (seenPositions.has(position)) continue;
      seenPositions.add(position);

      // Extract the cited content (text before the citation marker)
      const precedingText = answer.substring(Math.max(0, position - 200), position);
      const citedContent = extractCitedContent(precedingText);

      citations.push({
        text: match[0],                    // Full citation match
        reference: match[1] || match[0],   // Citation reference (source identifier)
        citedContent,                      // Content being cited
        position,
        patternType: getPatternType(pattern)
      });
    }
  }

  // Sort by position in text
  citations.sort((a, b) => a.position - b.position);

  return citations;
}

/**
 * Extract the content being cited (sentence or clause before citation)
 *
 * @param {string} precedingText - Text before the citation marker
 * @returns {string} The content being cited
 */
function extractCitedContent(precedingText) {
  // Find the last sentence or meaningful clause
  const sentences = precedingText.split(/(?<=[.!?])\s+/);
  const lastSentence = sentences[sentences.length - 1] || '';

  // Clean up and return
  return lastSentence.trim().replace(/^[,;:\s]+/, '');
}

/**
 * Get human-readable pattern type name
 *
 * @param {RegExp} pattern - The regex pattern
 * @returns {string} Pattern type name
 */
function getPatternType(pattern) {
  const patternStr = pattern.toString();
  if (patternStr.includes('\\[')) return 'bracketed_number';
  if (patternStr.includes('pdf|docx')) return 'source_file';
  if (patternStr.includes('according to')) return 'attribution';
  if (patternStr.includes('page|section')) return 'page_reference';
  if (patternStr.includes('superscript')) return 'footnote';
  if (patternStr.includes('"')) return 'quote_attribution';
  return 'other';
}

/**
 * Calculate n-gram overlap between two texts
 *
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @param {number} n - N-gram size (default 3)
 * @returns {number} Overlap score between 0 and 1
 */
function calculateNgramOverlap(text1, text2, n = 3) {
  if (!text1 || !text2) return 0;

  const normalize = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const t1 = normalize(text1);
  const t2 = normalize(text2);

  if (t1.length < n || t2.length < n) {
    // For very short texts, use character overlap
    const chars1 = new Set(t1.split(''));
    const chars2 = new Set(t2.split(''));
    const intersection = [...chars1].filter(c => chars2.has(c)).length;
    return intersection / Math.max(chars1.size, chars2.size);
  }

  // Generate n-grams
  const getNgrams = (text) => {
    const ngrams = new Set();
    const words = text.split(/\s+/);
    for (let i = 0; i <= words.length - n; i++) {
      ngrams.add(words.slice(i, i + n).join(' '));
    }
    return ngrams;
  };

  const ngrams1 = getNgrams(t1);
  const ngrams2 = getNgrams(t2);

  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

  const intersection = [...ngrams1].filter(ng => ngrams2.has(ng)).length;
  const union = new Set([...ngrams1, ...ngrams2]).size;

  return union > 0 ? intersection / union : 0;
}

/**
 * Calculate keyword overlap between cited content and source
 *
 * @param {string} citedContent - The content cited in the answer
 * @param {string} sourceContent - The actual source content
 * @returns {Object} Keyword overlap analysis
 */
function calculateKeywordOverlap(citedContent, sourceContent) {
  if (!citedContent || !sourceContent) {
    return { score: 0, matchedKeywords: [], totalKeywords: 0 };
  }

  // Extract keywords (nouns, proper nouns, numbers, technical terms)
  const extractKeywords = (text) => {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Filter out common stop words
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
      'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'were', 'they',
      'this', 'that', 'with', 'from', 'will', 'would', 'there', 'their', 'what',
      'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take',
      'into', 'year', 'your', 'some', 'them', 'than', 'then', 'could', 'other'
    ]);

    return words.filter(w => !stopWords.has(w));
  };

  const citedKeywords = extractKeywords(citedContent);
  const sourceKeywords = new Set(extractKeywords(sourceContent));

  if (citedKeywords.length === 0) {
    return { score: 1, matchedKeywords: [], totalKeywords: 0 };
  }

  const matchedKeywords = citedKeywords.filter(kw => sourceKeywords.has(kw));

  return {
    score: matchedKeywords.length / citedKeywords.length,
    matchedKeywords: [...new Set(matchedKeywords)],
    totalKeywords: citedKeywords.length,
    uniqueMatches: [...new Set(matchedKeywords)].length
  };
}

/**
 * Find the best matching source passage for a citation
 *
 * @param {string} citedContent - Content being cited
 * @param {Array<{id: string, content: string}>} sources - Available sources
 * @returns {Object|null} Best matching source with score
 */
function findBestMatchingSource(citedContent, sources) {
  if (!sources || sources.length === 0) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const source of sources) {
    // Calculate combined score
    const ngramScore = calculateNgramOverlap(citedContent, source.content);
    const keywordAnalysis = calculateKeywordOverlap(citedContent, source.content);

    // Weight: 60% n-gram, 40% keyword
    const combinedScore = (ngramScore * 0.6) + (keywordAnalysis.score * 0.4);

    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestMatch = {
        source,
        ngramScore,
        keywordScore: keywordAnalysis.score,
        combinedScore,
        matchedKeywords: keywordAnalysis.matchedKeywords
      };
    }
  }

  return bestMatch;
}

/**
 * Build prompt for LLM-based citation verification
 *
 * @param {string} citedContent - The content being cited
 * @param {string} sourceContent - The source to verify against
 * @param {string} citationReference - The citation reference
 * @returns {string} The verification prompt
 */
function buildVerificationPrompt(citedContent, sourceContent, citationReference) {
  return `You are an expert fact-checker verifying citation accuracy in a document.

## Task
Verify if the cited content accurately reflects what is in the source.

## Cited Content (from the answer)
"${citedContent}"

## Citation Reference
${citationReference}

## Source Content
${sourceContent}

## Verification Categories
- "accurate": The citation correctly and faithfully represents the source content
- "partially_accurate": The citation captures the main idea but has minor inaccuracies or omissions
- "inaccurate": The citation misrepresents or distorts what the source says
- "fabricated": The citation claims something that doesn't appear in the source at all

## Instructions
Compare the cited content to the source. Check for:
1. Factual accuracy - Are the facts correct?
2. Context preservation - Is the meaning preserved?
3. Quote accuracy - If it's a direct quote, is it exact?
4. Attribution accuracy - Is the source correctly identified?

Respond with only a JSON object (no markdown):
{
  "status": "accurate|partially_accurate|inaccurate|fabricated",
  "confidence": 0.0-1.0,
  "matchedPassage": "The relevant passage from the source, if found",
  "discrepancies": ["List any specific inaccuracies found"],
  "reasoning": "Brief explanation of the verification result"
}`;
}

/**
 * Verify a single citation using LLM
 *
 * @param {Object} citation - Citation to verify
 * @param {string} sourceContent - Source content to verify against
 * @param {Object} client - OpenAI client
 * @param {string} deploymentName - Model deployment name
 * @returns {Promise<Object>} Verification result
 */
async function verifyCitationWithLLM(citation, sourceContent, client, deploymentName) {
  const prompt = buildVerificationPrompt(
    citation.citedContent,
    sourceContent,
    citation.reference
  );

  try {
    const completion = await client.chat.completions.create({
      model: deploymentName,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at verifying citation accuracy. Respond only with valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 500
    });

    const responseText = completion.choices[0]?.message?.content || '';
    const parsed = parseJsonResponse(responseText);

    if (parsed && parsed.status) {
      return {
        status: Object.values(CitationStatus).includes(parsed.status)
          ? parsed.status
          : CitationStatus.INACCURATE,
        confidence: Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0.5)),
        matchedPassage: parsed.matchedPassage || '',
        discrepancies: Array.isArray(parsed.discrepancies) ? parsed.discrepancies : [],
        reasoning: parsed.reasoning || ''
      };
    }

    return {
      status: CitationStatus.INACCURATE,
      confidence: 0.5,
      matchedPassage: '',
      discrepancies: ['Unable to parse verification result'],
      reasoning: 'Verification parsing failed'
    };
  } catch (error) {
    log.warn('LLM citation verification failed', { error: error.message });
    return {
      status: CitationStatus.INACCURATE,
      confidence: 0,
      matchedPassage: '',
      discrepancies: [error.message],
      reasoning: 'LLM verification error'
    };
  }
}

/**
 * Parse JSON response from LLM, handling markdown code blocks
 *
 * @param {string} response - Raw LLM response
 * @returns {Object|null} Parsed JSON or null on failure
 */
function parseJsonResponse(response) {
  try {
    let cleanResponse = response.trim();

    // Remove markdown code blocks
    if (cleanResponse.startsWith('```json')) {
      cleanResponse = cleanResponse.slice(7);
    }
    if (cleanResponse.startsWith('```')) {
      cleanResponse = cleanResponse.slice(3);
    }
    if (cleanResponse.endsWith('```')) {
      cleanResponse = cleanResponse.slice(0, -3);
    }
    cleanResponse = cleanResponse.trim();

    return JSON.parse(cleanResponse);
  } catch (error) {
    log.warn('Failed to parse JSON response', { error: error.message });
    return null;
  }
}

/**
 * Calculate citation accuracy score from verification results
 *
 * @param {Object[]} verifications - Array of verification results
 * @returns {Object} Score details
 */
function calculateScoreFromVerifications(verifications) {
  if (verifications.length === 0) {
    return {
      score: 1.0,  // No citations = nothing to verify wrong
      accurateCount: 0,
      partialCount: 0,
      inaccurateCount: 0,
      notFoundCount: 0,
      fabricatedCount: 0,
      totalCitations: 0
    };
  }

  let accurateCount = 0;
  let partialCount = 0;
  let inaccurateCount = 0;
  let notFoundCount = 0;
  let fabricatedCount = 0;
  let weightedSum = 0;
  let confidenceWeightedSum = 0;
  let totalConfidence = 0;

  for (const v of verifications) {
    const weight = STATUS_WEIGHTS[v.status] || 0;
    weightedSum += weight;
    confidenceWeightedSum += weight * v.confidence;
    totalConfidence += v.confidence;

    switch (v.status) {
      case CitationStatus.ACCURATE:
        accurateCount++;
        break;
      case CitationStatus.PARTIALLY_ACCURATE:
        partialCount++;
        break;
      case CitationStatus.INACCURATE:
        inaccurateCount++;
        break;
      case CitationStatus.SOURCE_NOT_FOUND:
        notFoundCount++;
        break;
      case CitationStatus.FABRICATED:
        fabricatedCount++;
        break;
    }
  }

  const totalCitations = verifications.length;
  const score = weightedSum / totalCitations;
  const weightedScore = totalConfidence > 0
    ? confidenceWeightedSum / totalConfidence
    : score;

  return {
    score: Math.round(score * 1000) / 1000,
    weightedScore: Math.round(weightedScore * 1000) / 1000,
    accurateCount,
    partialCount,
    inaccurateCount,
    notFoundCount,
    fabricatedCount,
    totalCitations
  };
}

/**
 * Calculate citation accuracy for an answer
 *
 * @param {Object} params - Parameters
 * @param {string} params.answer - The answer containing citations
 * @param {Array<{id: string, content: string}>} params.sources - Source documents
 * @param {Object} [options] - Configuration options
 * @param {boolean} [options.useLLM=true] - Use LLM for verification
 * @param {number} [options.textMatchThreshold=0.7] - Threshold for text-based match
 * @param {boolean} [options.includeDetails=true] - Include detailed verifications
 * @param {Object} [openaiClient] - Optional OpenAI client (for testing)
 * @returns {Promise<Object>} Citation accuracy evaluation result
 */
async function calculateCitationAccuracy(
  { answer, sources },
  options = {},
  openaiClient = null
) {
  const startTime = Date.now();
  const {
    useLLM = true,
    textMatchThreshold = 0.5,
    includeDetails = true
  } = options;

  // Input validation
  if (!answer || typeof answer !== 'string') {
    throw new Error('Answer is required and must be a string');
  }

  if (!sources || !Array.isArray(sources)) {
    throw new Error('Sources must be an array');
  }

  // Handle empty answer
  if (answer.trim().length === 0) {
    return {
      score: 1.0,
      totalCitations: 0,
      accurateCitations: 0,
      inaccurateCitations: [],
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime
    };
  }

  // Step 1: Extract citations from answer
  log.info('Extracting citations from answer', { answerLength: answer.length });
  const citations = extractCitations(answer);

  if (citations.length === 0) {
    log.info('No citations found in answer');
    return {
      score: 1.0,  // No citations = nothing to verify wrong
      totalCitations: 0,
      accurateCitations: 0,
      inaccurateCitations: [],
      noCitationsFound: true,
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startTime
    };
  }

  log.info('Citations extracted', { count: citations.length });

  // Combine all source content for matching
  const combinedSourceContent = sources.map(s => s.content).join('\n\n---\n\n');

  const client = useLLM ? (openaiClient || createOpenAIClient()) : null;
  const config = useLLM ? getOpenAIConfig() : {};
  const deploymentName = config.deploymentName;

  if (useLLM && !deploymentName) {
    log.warn('No deployment name configured, falling back to text-only verification');
  }

  // Step 2: Verify each citation
  const verifications = [];

  for (const citation of citations) {
    // First try text-based matching
    const bestMatch = findBestMatchingSource(citation.citedContent, sources);

    let verification;

    if (bestMatch && bestMatch.combinedScore >= textMatchThreshold) {
      // High-confidence text match
      verification = {
        citation,
        status: bestMatch.combinedScore >= 0.8
          ? CitationStatus.ACCURATE
          : CitationStatus.PARTIALLY_ACCURATE,
        confidence: bestMatch.combinedScore,
        matchedSource: bestMatch.source.id,
        matchedPassage: bestMatch.source.content.substring(0, 200),
        textMatchScore: bestMatch.combinedScore,
        matchedKeywords: bestMatch.matchedKeywords,
        discrepancies: [],
        verificationMethod: 'text_matching'
      };
    } else if (useLLM && client && deploymentName) {
      // Use LLM for verification
      const llmResult = await verifyCitationWithLLM(
        citation,
        combinedSourceContent,
        client,
        deploymentName
      );

      verification = {
        citation,
        ...llmResult,
        matchedSource: bestMatch?.source?.id || null,
        textMatchScore: bestMatch?.combinedScore || 0,
        verificationMethod: 'llm'
      };
    } else {
      // No source found and no LLM available
      verification = {
        citation,
        status: bestMatch
          ? CitationStatus.INACCURATE
          : CitationStatus.SOURCE_NOT_FOUND,
        confidence: 0.5,
        matchedSource: bestMatch?.source?.id || null,
        matchedPassage: '',
        textMatchScore: bestMatch?.combinedScore || 0,
        discrepancies: ['Low text match score and LLM verification unavailable'],
        verificationMethod: 'text_matching'
      };
    }

    verifications.push(verification);
  }

  // Step 3: Calculate overall score
  const scoreDetails = calculateScoreFromVerifications(verifications);

  // Build inaccurate citations list
  const inaccurateCitations = verifications
    .filter(v =>
      v.status === CitationStatus.INACCURATE ||
      v.status === CitationStatus.FABRICATED ||
      v.status === CitationStatus.SOURCE_NOT_FOUND
    )
    .map(v => ({
      citation: v.citation.text,
      citedContent: v.citation.citedContent,
      status: v.status,
      discrepancies: v.discrepancies,
      reasoning: v.reasoning
    }));

  const result = {
    score: scoreDetails.score,
    weightedScore: scoreDetails.weightedScore,
    totalCitations: scoreDetails.totalCitations,
    accurateCitations: scoreDetails.accurateCount,
    partiallyAccurateCitations: scoreDetails.partialCount,
    inaccurateCitations,
    breakdown: {
      accurate: scoreDetails.accurateCount,
      partiallyAccurate: scoreDetails.partialCount,
      inaccurate: scoreDetails.inaccurateCount,
      sourceNotFound: scoreDetails.notFoundCount,
      fabricated: scoreDetails.fabricatedCount
    },
    evaluatedAt: new Date().toISOString(),
    latencyMs: Date.now() - startTime
  };

  // Optionally include full verifications
  if (includeDetails) {
    result.verifications = verifications.map(v => ({
      citationText: v.citation.text,
      citedContent: v.citation.citedContent,
      reference: v.citation.reference,
      patternType: v.citation.patternType,
      status: v.status,
      confidence: v.confidence,
      matchedSource: v.matchedSource,
      textMatchScore: v.textMatchScore,
      discrepancies: v.discrepancies,
      verificationMethod: v.verificationMethod
    }));
  }

  log.info('Citation accuracy calculation complete', {
    score: result.score,
    totalCitations: result.totalCitations,
    accurate: scoreDetails.accurateCount,
    inaccurate: scoreDetails.inaccurateCount + scoreDetails.fabricatedCount,
    latencyMs: result.latencyMs
  });

  return result;
}

/**
 * Calculate citation accuracy for multiple answer-sources pairs in batch
 *
 * @param {Array<{answer: string, sources: Array}>} items - Items to evaluate
 * @param {Object} [options] - Additional options
 * @param {number} [options.concurrency=2] - Number of concurrent evaluations
 * @param {boolean} [options.includeDetails=false] - Include detailed verifications
 * @returns {Promise<Object>} Batch evaluation results
 */
async function calculateBatchCitationAccuracy(items, options = {}) {
  const { concurrency = 2, includeDetails = false, ...passOptions } = options;

  if (!items || items.length === 0) {
    return {
      results: [],
      aggregate: {},
      itemCount: 0,
      successCount: 0
    };
  }

  const results = [];
  const client = createOpenAIClient();

  // Process in batches to respect rate limits
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchPromises = batch.map(async (item, idx) => {
      try {
        const evaluation = await calculateCitationAccuracy(
          { answer: item.answer, sources: item.sources },
          { includeDetails, ...passOptions },
          client
        );

        return {
          index: i + idx,
          answer: item.answer.substring(0, 100) + (item.answer.length > 100 ? '...' : ''),
          evaluation,
          success: true
        };
      } catch (error) {
        log.warn('Batch citation accuracy item failed', { index: i + idx, error: error.message });
        const answerPreview = item.answer
          ? item.answer.substring(0, 100) + (item.answer.length > 100 ? '...' : '')
          : '[invalid answer]';
        return {
          index: i + idx,
          answer: answerPreview,
          evaluation: null,
          success: false,
          error: error.message
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  // Calculate aggregate statistics
  const successfulResults = results.filter(r => r.success);
  const aggregate = {};

  if (successfulResults.length > 0) {
    const scores = successfulResults.map(r => r.evaluation.score);
    const totalCitations = successfulResults.reduce((sum, r) => sum + r.evaluation.totalCitations, 0);
    const totalAccurate = successfulResults.reduce((sum, r) => sum + r.evaluation.accurateCitations, 0);

    aggregate.score = {
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      min: Math.min(...scores),
      max: Math.max(...scores),
      stdDev: calculateStdDev(scores)
    };

    aggregate.citations = {
      total: totalCitations,
      accurate: totalAccurate,
      accuracyRate: totalCitations > 0 ? totalAccurate / totalCitations : 1.0
    };
  }

  log.info('Batch citation accuracy evaluation complete', {
    totalItems: items.length,
    successCount: successfulResults.length,
    failCount: results.length - successfulResults.length,
    meanScore: aggregate.score?.mean?.toFixed(3)
  });

  return {
    results,
    aggregate,
    itemCount: items.length,
    successCount: successfulResults.length
  };
}

/**
 * Calculate standard deviation
 *
 * @param {number[]} values - Array of numbers
 * @returns {number} Standard deviation
 */
function calculateStdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Format citation accuracy result for display/reporting
 *
 * @param {Object} result - Result from calculateCitationAccuracy
 * @returns {string} Formatted string
 */
function formatCitationAccuracy(result) {
  if (!result) {
    return 'No citation accuracy evaluation available';
  }

  const scorePercent = (result.score * 100).toFixed(1);
  const lines = [
    'Citation Accuracy Evaluation',
    '='.repeat(40),
    `Accuracy Score: ${scorePercent}%`,
    `Weighted Score: ${(result.weightedScore * 100).toFixed(1)}%`,
    `Total Citations: ${result.totalCitations}`,
    `Evaluated At: ${result.evaluatedAt}`,
    `Latency: ${result.latencyMs}ms`,
    ''
  ];

  if (result.noCitationsFound) {
    lines.push('Note: No citations were found in the answer.');
    lines.push('');
  }

  if (result.breakdown) {
    lines.push('Citation Breakdown:');
    lines.push(`  Accurate: ${result.breakdown.accurate}`);
    lines.push(`  Partially Accurate: ${result.breakdown.partiallyAccurate}`);
    lines.push(`  Inaccurate: ${result.breakdown.inaccurate}`);
    lines.push(`  Source Not Found: ${result.breakdown.sourceNotFound}`);
    lines.push(`  Fabricated: ${result.breakdown.fabricated}`);
    lines.push('');
  }

  if (result.inaccurateCitations && result.inaccurateCitations.length > 0) {
    lines.push('Inaccurate Citations:');
    result.inaccurateCitations.forEach((ic, idx) => {
      lines.push(`  ${idx + 1}. "${ic.citation}"`);
      lines.push(`     Content: "${ic.citedContent.substring(0, 80)}..."`);
      lines.push(`     Status: ${ic.status}`);
      if (ic.discrepancies && ic.discrepancies.length > 0) {
        lines.push(`     Issues: ${ic.discrepancies.join('; ')}`);
      }
    });
  }

  return lines.join('\n');
}

/**
 * Format batch citation accuracy results for reporting
 *
 * @param {Object} batchResult - Result from calculateBatchCitationAccuracy
 * @returns {string} Formatted string
 */
function formatBatchCitationAccuracy(batchResult) {
  if (!batchResult || batchResult.itemCount === 0) {
    return 'No batch citation accuracy evaluation results';
  }

  const lines = [
    'Batch Citation Accuracy Evaluation',
    '='.repeat(40),
    `Total Items: ${batchResult.itemCount}`,
    `Successful: ${batchResult.successCount}`,
    `Failed: ${batchResult.itemCount - batchResult.successCount}`,
    ''
  ];

  if (batchResult.aggregate.score) {
    lines.push('Aggregate Scores:');
    lines.push(`  Mean Score: ${(batchResult.aggregate.score.mean * 100).toFixed(1)}% (±${(batchResult.aggregate.score.stdDev * 100).toFixed(1)}%)`);
    lines.push(`  Score Range: ${(batchResult.aggregate.score.min * 100).toFixed(1)}% - ${(batchResult.aggregate.score.max * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('Citation Statistics:');
    lines.push(`  Total Citations Evaluated: ${batchResult.aggregate.citations.total}`);
    lines.push(`  Citations Accurate: ${batchResult.aggregate.citations.accurate}`);
    lines.push(`  Overall Accuracy Rate: ${(batchResult.aggregate.citations.accuracyRate * 100).toFixed(1)}%`);
  }

  return lines.join('\n');
}

/**
 * Quick citation check - simplified check without detailed analysis
 *
 * @param {string} answer - The answer to check
 * @param {string} sourceContent - Combined source content
 * @returns {Promise<Object>} Quick check result
 */
async function quickCitationCheck(answer, sourceContent) {
  const citations = extractCitations(answer);

  if (citations.length === 0) {
    return {
      hasCitations: false,
      citationCount: 0,
      estimatedAccuracy: 1.0,
      message: 'No citations found in answer'
    };
  }

  // Quick text-based assessment
  let matchCount = 0;
  for (const citation of citations) {
    const ngramScore = calculateNgramOverlap(citation.citedContent, sourceContent);
    const keywordAnalysis = calculateKeywordOverlap(citation.citedContent, sourceContent);
    const combinedScore = (ngramScore * 0.6) + (keywordAnalysis.score * 0.4);

    if (combinedScore >= 0.4) matchCount++;
  }

  const estimatedAccuracy = matchCount / citations.length;

  return {
    hasCitations: true,
    citationCount: citations.length,
    estimatedAccuracy,
    likelyAccurate: estimatedAccuracy >= 0.7,
    message: estimatedAccuracy >= 0.7
      ? 'Citations appear to match source content'
      : 'Some citations may not accurately reflect sources'
  };
}

module.exports = {
  // Core functions
  calculateCitationAccuracy,
  calculateBatchCitationAccuracy,
  quickCitationCheck,

  // Utility functions (exported for testing)
  extractCitations,
  calculateNgramOverlap,
  calculateKeywordOverlap,
  findBestMatchingSource,
  calculateScoreFromVerifications,

  // Prompt builders (exported for testing)
  buildVerificationPrompt,

  // Formatting
  formatCitationAccuracy,
  formatBatchCitationAccuracy,

  // Constants
  CitationStatus,
  STATUS_WEIGHTS,
  CITATION_PATTERNS
};
