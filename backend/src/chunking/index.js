/**
 * Chunking Module
 *
 * Exports chunking utilities for document processing:
 * - Semantic Chunker (F4.1.1, F4.1.2) - Topic-aware document splitting
 * - Chunk Coherence Score (F4.1.3) - Quality metric for chunk coherence
 */

const semanticChunker = require('./semantic-chunker');
const chunkCoherenceScore = require('./chunk-coherence-score');

module.exports = {
  // Semantic Chunker (F4.1.1, F4.1.2)
  SemanticChunker: semanticChunker.SemanticChunker,
  getSemanticChunker: semanticChunker.getSemanticChunker,
  SEMANTIC_CHUNKER_CONFIG: semanticChunker.DEFAULT_CONFIG,

  // Chunk Coherence Score (F4.1.3)
  ChunkCoherenceScorer: chunkCoherenceScore.ChunkCoherenceScorer,
  getChunkCoherenceScorer: chunkCoherenceScore.getChunkCoherenceScorer,
  formatCoherenceScore: chunkCoherenceScore.formatCoherenceScore,
  formatBatchCoherence: chunkCoherenceScore.formatBatchCoherence,
  COHERENCE_SCORER_CONFIG: chunkCoherenceScore.DEFAULT_CONFIG,
};
