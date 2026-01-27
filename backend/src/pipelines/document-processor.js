const { getDocumentIntelligenceService } = require('../services/docint-service');
const { getOpenAIService } = require('../services/openai-service');
const { getSearchService } = require('../services/search-service');
const { getGraphService } = require('../services/graph-service');
const { getEntityExtractorService } = require('../services/entity-extractor');
const { getEntityResolutionService } = require('../services/entity-resolution-service');
const { initializeRelationshipValidator } = require('../validation/relationship-validator');
const { getSemanticChunker } = require('../chunking/semantic-chunker');
const { generateSasUrl, getBlobNameFromUrl } = require('../storage/blob');
const { v4: uuidv4 } = require('uuid');
const { log } = require('../utils/logger');

const CHUNK_SIZE = 500; // tokens (approximate)
const CHUNK_OVERLAP = 50; // tokens
const DEFAULT_SEMANTIC_MAX_CHARS = 200000; // Fallback to fixed chunking for very large docs
const DEFAULT_SEMANTIC_MAX_PAGES = 50;

function resolveSemanticLimit(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Chunking strategy options
const CHUNKING_STRATEGY = {
  FIXED: 'fixed',       // Traditional fixed-size word-based chunking
  SEMANTIC: 'semantic', // Semantic chunking using topic detection (F4.1.1, F4.1.2)
  AUTO: 'auto',         // Automatically select based on document characteristics
};

// Default chunking strategy - use semantic for better retrieval quality
const DEFAULT_CHUNKING_STRATEGY = CHUNKING_STRATEGY.SEMANTIC;

/**
 * Sanitize a string to be used as an Azure Search document key.
 * Keys can only contain letters, digits, underscore (_), dash (-), or equal sign (=).
 */
function sanitizeSearchKey(str) {
  return str
    .toLowerCase()
    .replace(/\s+/g, '_')           // Replace whitespace with underscore
    .replace(/[^a-z0-9_\-=]/g, '')  // Remove all invalid characters
    .replace(/_+/g, '_')            // Collapse multiple underscores
    .replace(/^_|_$/g, '')          // Remove leading/trailing underscores
    .substring(0, 100);             // Limit length to prevent overly long keys
}

class DocumentProcessor {
  constructor(cosmosService) {
    this.cosmos = cosmosService;
    this.docIntelligence = getDocumentIntelligenceService();
    this.openai = getOpenAIService();
    this.search = getSearchService();
    this.graph = getGraphService();
    this.entityExtractor = getEntityExtractorService();
    this.entityResolution = getEntityResolutionService();
    this.semanticChunker = getSemanticChunker();
    this.relationshipValidator = null; // Initialized lazily
  }

  /**
   * Initialize the relationship validator (lazy initialization).
   * Feature: F4.3.1 - Relationship Validation Rules
   */
  async _initializeValidator() {
    if (!this.relationshipValidator) {
      try {
        this.relationshipValidator = await initializeRelationshipValidator();
      } catch (error) {
        log.warn('Failed to initialize relationship validator, validation will be skipped', {
          error: error.message,
        });
      }
    }
    return this.relationshipValidator;
  }

  async processDocument(documentId, blobUrl, options = {}) {
    const startTime = Date.now();

    try {
      // Stage 1: Extract content with Document Intelligence
      await this._updateStatus(documentId, 'extracting_content');

      // Generate SAS URL for Document Intelligence to access the blob
      const blobName = getBlobNameFromUrl(blobUrl);
      const sasUrl = await generateSasUrl(blobName);

      const extractedContent = await this.docIntelligence.analyzeDocument(sasUrl, {
        mimeType: options.mimeType,
      });

      // Stage 1.5: Extract visual info using GPT-4o
      await this._updateStatus(documentId, 'extracting_visuals');
      const { visualEntities, visualRelationships } = await this._extractVisualInfo(
        extractedContent,
        documentId,
        sasUrl
      );

      // Stage 2: Chunk content (semantic or fixed-size based on strategy)
      await this._updateStatus(documentId, 'chunking');
      const chunks = await this._createChunks(extractedContent, documentId, options);

      // Stage 3: Extract entities
      await this._updateStatus(documentId, 'extracting_entities');
      let { entities, relationships } = await this.entityExtractor.processDocument(
        chunks,
        documentId,
        options.title || options.filename
      );

      // Merge visual entities/relationships
      entities = [...entities, ...visualEntities];
      relationships = [...relationships, ...visualRelationships];

      // Stage 3.5: Validate entities and relationships against ontology (F4.3.1)
      await this._updateStatus(documentId, 'validating_extraction');
      let validationSummary = null;
      const validator = await this._initializeValidator();
      if (validator) {
        const validationResult = validator.validateExtraction(entities, relationships, {
          applyPenalties: true,
          includeReport: false,
        });

        // Use validated entities and relationships (with warnings and adjusted confidence)
        entities = validationResult.entities;
        relationships = validationResult.relationships;
        validationSummary = validationResult.summary;

        log.info('Extraction validation completed', {
          documentId,
          entitiesWithWarnings: validationSummary.entitiesWithWarnings,
          relationshipsWithWarnings: validationSummary.relationshipsWithWarnings,
          domainViolations: validationSummary.domainViolations,
          rangeViolations: validationSummary.rangeViolations,
        });
      }

      // Stage 4: Entity Resolution - deduplicate and link across documents
      await this._updateStatus(documentId, 'resolving_entities');
      const resolutionResult = await this._resolveEntities(entities, documentId);

      // Use resolved entities (with canonical mappings)
      const resolvedEntities = resolutionResult.resolved.map(r => ({
        ...r.original,
        resolvedTo: r.resolved?.name,
        action: r.action,
        similarity: r.similarity,
      }));

      // Stage 5: Generate embeddings
      await this._updateStatus(documentId, 'generating_embeddings');
      const embeddedChunks = await this._generateEmbeddings(chunks, resolvedEntities);

      // Stage 6: Index to search
      await this._updateStatus(documentId, 'indexing_search');
      await this.search.ensureIndexExists();
      const indexResult = await this.search.indexDocuments(embeddedChunks);

      // Stage 7: Update graph with resolved entities
      await this._updateStatus(documentId, 'updating_graph');
      await this._updateGraph(resolvedEntities, relationships, documentId);

      // Stage 7.5: Update mention counts for entities (F3.2.3)
      await this._updateStatus(documentId, 'tracking_mentions');
      const mentionStats = await this._trackEntityMentions(chunks, resolvedEntities, documentId);

      // Stage 8: Discover cross-document relationships
      await this._updateStatus(documentId, 'discovering_cross_document_links');
      const crossDocLinks = await this._discoverCrossDocumentLinks(documentId);

      // Complete
      const processingTime = Date.now() - startTime;
      await this._updateStatus(documentId, 'completed', {
        // Store entities and relationships for staging/review
        entities: resolvedEntities.map((e, index) => ({
          id: e.id || `${documentId}_entity_${index}`,
          name: e.name,
          type: e.type,
          description: e.description,
          confidence: e.confidence,
          sourceDocumentId: documentId,
          resolvedTo: e.resolvedTo,
          resolutionAction: e.action,
          // F4.3.1: Include validation warnings for staging review
          validationWarnings: e.validationWarnings || [],
          validationPassed: e.validationPassed !== false,
        })),
        relationships: relationships.map((r, index) => ({
          id: r.id || `${documentId}_rel_${index}`,
          // Use both field names for compatibility (staging uses source/target, graph uses from/to)
          source: r.from,
          target: r.to,
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: r.confidence,
          sourceDocumentId: documentId,
          // F4.3.1: Include validation warnings for staging review
          validationWarnings: r.validationWarnings || [],
          validationPassed: r.validationPassed !== false,
          originalConfidence: r.originalConfidence,
        })),
        processingResults: {
          extractedText: extractedContent.content.substring(0, 5000), // First 5000 chars
          tables: extractedContent.tables,
          hierarchy: extractedContent.sections,
          metadata: {
            pageCount: extractedContent.metadata.pageCount,
            chunksCreated: chunks.length,
            chunksIndexed: indexResult.indexed,
            entitiesExtracted: entities.length,
            entitiesResolved: resolutionResult.resolved.length,
            entitiesMerged: resolutionResult.merged,
            entitiesLinked: resolutionResult.linkedSameAs + resolutionResult.linkedSimilar,
            crossDocumentLinks: crossDocLinks.length,
            relationshipsExtracted: relationships.length,
            processingTimeMs: processingTime,
            modelId: extractedContent.metadata.modelId,
            // Mention tracking stats (F3.2.3)
            uniqueEntitiesMentioned: mentionStats.uniqueEntitiesMentioned,
            totalEntityMentions: mentionStats.totalMentions,
            // Validation stats (F4.3.1)
            validationSummary: validationSummary || null,
          },
        },
      });

      return {
        success: true,
        documentId,
        stats: {
          pageCount: extractedContent.metadata.pageCount,
          chunksCreated: chunks.length,
          chunksIndexed: indexResult.indexed,
          entitiesExtracted: entities.length,
          entitiesResolved: resolutionResult.resolved.length,
          entitiesMerged: resolutionResult.merged,
          entitiesLinked: resolutionResult.linkedSameAs + resolutionResult.linkedSimilar,
          crossDocumentLinks: crossDocLinks.length,
          relationshipsExtracted: relationships.length,
          processingTimeMs: processingTime,
          // Mention tracking stats (F3.2.3)
          uniqueEntitiesMentioned: mentionStats.uniqueEntitiesMentioned,
          totalEntityMentions: mentionStats.totalMentions,
          // Validation stats (F4.3.1)
          validationSummary: validationSummary || null,
        },
      };
    } catch (error) {
      await this._updateStatus(documentId, 'failed', {
        processingError: error.message,
      });

      throw error;
    }
  }

  /**
   * Create chunks from extracted document content.
   * Supports multiple chunking strategies:
   * - 'semantic': Uses topic detection for intelligent boundaries (F4.1.1, F4.1.2)
   * - 'fixed': Traditional fixed-size word-based chunking
   * - 'auto': Automatically selects based on document characteristics
   *
   * @param {Object} extractedContent - Content extracted from Document Intelligence
   * @param {string} documentId - Document ID
   * @param {Object} options - Processing options including chunkingStrategy
   * @returns {Promise<Object[]>|Object[]} Array of chunk objects
   */
  async _createChunks(extractedContent, documentId, options) {
    const chunks = [];
    const docIntelService = this.docIntelligence;

    // Determine chunking strategy
    const strategy = options.chunkingStrategy || DEFAULT_CHUNKING_STRATEGY;
    const fullContent = extractedContent.content;
    const semanticMaxChars = resolveSemanticLimit(
      options.semanticMaxChars || process.env.SEMANTIC_CHUNKING_MAX_CHARS,
      DEFAULT_SEMANTIC_MAX_CHARS
    );
    const semanticMaxPages = resolveSemanticLimit(
      options.semanticMaxPages || process.env.SEMANTIC_CHUNKING_MAX_PAGES,
      DEFAULT_SEMANTIC_MAX_PAGES
    );
    const pageCount = extractedContent?.metadata?.pageCount || 0;
    const contentLength = fullContent ? fullContent.length : 0;
    const exceedsSemanticLimits =
      (semanticMaxChars > 0 && contentLength > semanticMaxChars) ||
      (semanticMaxPages > 0 && pageCount > semanticMaxPages);

    // Process full content into chunks based on strategy
    if (fullContent) {
      let contentChunks;
      let chunkingMethod = strategy;

      if ((strategy === CHUNKING_STRATEGY.SEMANTIC || strategy === CHUNKING_STRATEGY.AUTO) && exceedsSemanticLimits) {
        log.warn('Skipping semantic chunking for large document; using fixed-size chunking', {
          documentId,
          contentLength,
          pageCount,
          semanticMaxChars,
          semanticMaxPages,
        });
        contentChunks = this._splitIntoChunks(fullContent, CHUNK_SIZE, CHUNK_OVERLAP);
        chunkingMethod = 'fixed_large_doc';
      } else if (strategy === CHUNKING_STRATEGY.SEMANTIC || strategy === CHUNKING_STRATEGY.AUTO) {
        try {
          // Use semantic chunking with topic detection
          const semanticResult = await this.semanticChunker.chunkText(fullContent, {
            breakpointPercentileThreshold: options.semanticThreshold || 95,
            bufferSize: options.semanticBufferSize || 1,
          });

          contentChunks = semanticResult.chunks.map(c => c.content);
          chunkingMethod = semanticResult.metadata.method;

          log.info('Semantic chunking applied', {
            documentId,
            method: chunkingMethod,
            breakpoints: semanticResult.metadata.breakpoints.length,
            chunks: contentChunks.length,
            distanceStats: semanticResult.metadata.distanceStats,
          });
        } catch (error) {
          // Fall back to fixed-size chunking on error
          log.warn('Semantic chunking failed, falling back to fixed-size', {
            documentId,
            error: error.message,
          });
          contentChunks = this._splitIntoChunks(fullContent, CHUNK_SIZE, CHUNK_OVERLAP);
          chunkingMethod = 'fixed_fallback';
        }
      } else {
        // Use traditional fixed-size chunking
        contentChunks = this._splitIntoChunks(fullContent, CHUNK_SIZE, CHUNK_OVERLAP);
        chunkingMethod = 'fixed';
      }

      contentChunks.forEach((chunkText, index) => {
        chunks.push({
          id: `${documentId}_chunk_${index}`,
          documentId,
          chunkIndex: index,
          content: chunkText,
          chunkType: 'content',
          title: options.title || options.filename,
          sourceFile: options.filename,
          uploadedAt: new Date().toISOString(),
          metadata: {
            totalChunks: contentChunks.length,
            chunkingMethod,
          },
        });
      });
    }

    // Add section-based chunks (preserve document structure)
    for (const section of extractedContent.sections) {
      if (section.content && section.content.length > 0) {
        const sectionText = section.content.join('\n\n');
        if (sectionText.length > 50) { // Skip very short sections
          chunks.push({
            id: `${documentId}_section_${sanitizeSearchKey(section.title)}`,
            documentId,
            chunkIndex: chunks.length,
            content: sectionText,
            chunkType: 'section',
            title: options.title || options.filename,
            sourceFile: options.filename,
            sectionTitle: section.title,
            pageNumber: section.pageNumber,
            uploadedAt: new Date().toISOString(),
            metadata: {
              sectionLevel: section.level,
            },
          });
        }
      }
    }

    // Add table chunks (tables are naturally bounded)
    for (const table of extractedContent.tables) {
      const tableText = docIntelService._formatTableAsText(table);
      if (tableText) {
        chunks.push({
          id: `${documentId}_table_${table.tableIndex}`,
          documentId,
          chunkIndex: chunks.length,
          content: tableText,
          chunkType: 'table',
          title: options.title || options.filename,
          sourceFile: options.filename,
          pageNumber: table.boundingRegions?.[0]?.pageNumber || 1,
          uploadedAt: new Date().toISOString(),
          metadata: {
            rowCount: table.rowCount,
            columnCount: table.columnCount,
          },
        });
      }
    }

    return chunks;
  }

  _splitIntoChunks(text, chunkSize, overlap) {
    const chunks = [];
    const words = text.split(/\s+/);

    // Approximate tokens as words (rough estimate)
    const wordsPerChunk = chunkSize;
    const overlapWords = overlap;

    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + wordsPerChunk, words.length);
      const chunk = words.slice(start, end).join(' ');

      if (chunk.trim().length > 0) {
        chunks.push(chunk);
      }

      // Move start position with overlap
      start = end - overlapWords;

      // Ensure we make progress
      if (start <= chunks.length * (wordsPerChunk - overlapWords) - wordsPerChunk) {
        start = end;
      }
    }

    return chunks;
  }

  async _generateEmbeddings(chunks, entities) {
    const embeddedChunks = [];

    // Process in batches for efficiency
    const BATCH_SIZE = 16;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content);

      const embeddings = await this.openai.getEmbeddings(texts);

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const embedding = embeddings[j];

        // Find entities mentioned in this chunk
        const chunkEntities = entities
          .filter((e) => chunk.content.toLowerCase().includes(e.name.toLowerCase()))
          .map((e) => e.name);

        embeddedChunks.push({
          ...chunk,
          contentVector: embedding,
          entities: chunkEntities,
          processedAt: new Date().toISOString(),
        });
      }
    }

    return embeddedChunks;
  }

  async _updateGraph(entities, relationships, documentId) {
    const stats = {
      entitiesAdded: 0,
      entitiesUpdated: 0,
      entitiesSkipped: 0,
      edgesAdded: 0,
      edgesUpdated: 0,
      edgesSkipped: 0,
    };

    // Add/update entities as vertices using upsert (with throttling to avoid 429s)
    for (const entity of entities) {
      try {
        const result = await this.graph.upsertVertex({
          ...entity,
          sourceDocumentId: documentId,
        });

        if (result.skipped) {
          stats.entitiesSkipped++;
        } else if (result.updated) {
          stats.entitiesUpdated++;
        } else {
          stats.entitiesAdded++;
        }
      } catch (error) {
        log.warn('Failed to add/update entity in graph', {
          entityName: entity.name,
          documentId,
          error: error.message,
        });
      }
      // Throttle to avoid Cosmos DB rate limiting (429 errors)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Add/update relationships as edges (addEdge now handles duplicates)
    for (const relationship of relationships) {
      try {
        const result = await this.graph.addEdge({
          ...relationship,
          sourceDocumentId: documentId,
        });

        if (result.updated) {
          stats.edgesUpdated++;
        } else {
          stats.edgesAdded++;
        }
      } catch (error) {
        log.warn('Failed to add/update relationship in graph', {
          from: relationship.from,
          to: relationship.to,
          documentId,
          error: error.message,
        });
      }
      // Throttle to avoid Cosmos DB rate limiting (429 errors)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    log.info('Graph update completed', {
      documentId,
      ...stats,
    });

    return stats;
  }

  /**
   * Track entity mention frequencies across the document.
   * Counts how many times each entity is mentioned in all chunks and updates
   * the graph database with mention statistics.
   *
   * Feature: F3.2.3 - Mention Frequency Tracking
   *
   * @param {Array} chunks - Document chunks with content
   * @param {Array} entities - Resolved entities from the document
   * @param {string} documentId - Source document ID
   * @returns {Promise<Object>} Mention tracking statistics
   */
  async _trackEntityMentions(chunks, entities, documentId) {
    const mentionCounts = new Map();

    // Count entity mentions across all chunks
    for (const chunk of chunks) {
      const content = (chunk.content || '').toLowerCase();

      for (const entity of entities) {
        const entityName = entity.name;
        const normalizedName = entityName.toLowerCase();

        // Count occurrences of the entity name in this chunk
        // Use word boundary matching to avoid partial matches
        const regex = new RegExp(`\\b${this._escapeRegex(normalizedName)}\\b`, 'gi');
        const matches = content.match(regex);
        const count = matches ? matches.length : 0;

        if (count > 0) {
          const currentCount = mentionCounts.get(entityName) || 0;
          mentionCounts.set(entityName, currentCount + count);
        }
      }
    }

    // Prepare entities with mention counts for batch update
    const entitiesWithMentions = [];
    for (const [name, count] of mentionCounts.entries()) {
      entitiesWithMentions.push({ name, mentionCount: count });
    }

    // Batch update mention counts in the graph
    let updateResult = { updated: 0, skipped: 0, notFound: 0, errors: 0 };
    if (entitiesWithMentions.length > 0) {
      updateResult = await this.graph.batchUpdateMentionCounts(entitiesWithMentions, documentId);
    }

    log.info('Entity mention tracking completed', {
      documentId,
      uniqueEntitiesMentioned: mentionCounts.size,
      totalMentions: Array.from(mentionCounts.values()).reduce((sum, c) => sum + c, 0),
      updated: updateResult.updated,
      skipped: updateResult.skipped,
      notFound: updateResult.notFound,
    });

    return {
      uniqueEntitiesMentioned: mentionCounts.size,
      totalMentions: Array.from(mentionCounts.values()).reduce((sum, c) => sum + c, 0),
      mentionCounts: Object.fromEntries(mentionCounts),
      updateResult,
    };
  }

  /**
   * Escape special regex characters in a string.
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async _updateStatus(documentId, status, additionalFields = {}) {
    const updateData = {
      status,
      processingStage: status,
      [`${status}At`]: new Date().toISOString(),
      ...additionalFields,
    };

    if (status === 'completed') {
      updateData.processingCompletedAt = new Date().toISOString();
    }

    await this.cosmos.updateDocument(documentId, updateData);
  }

  async reprocessDocument(documentId) {
    log.info('Starting document reprocessing', { documentId });

    // Clean up search index data for this document
    await this.search.deleteDocumentsByDocumentId(documentId);

    // Delete edges created by this document
    // (edges have sourceDocumentId, so we can safely remove them)
    await this.graph.deleteEdgesByDocumentId(documentId);

    // NOTE: We do NOT delete vertices here because:
    // 1. Entities with the same name may be referenced by other documents
    // 2. The upsert logic in _updateGraph will handle updates
    // 3. Deleting shared entities would break relationships from other docs
    //
    // Orphaned vertices (entities only from this doc) will remain but
    // can be cleaned up with a separate maintenance job if needed.

    // Get document info and reprocess
    const document = await this.cosmos.getDocument(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    return this.processDocument(documentId, document.blobUrl, {
      mimeType: document.mimeType,
      filename: document.filename,
      title: document.title,
    });
  }
  /**
   * Resolve entities using embedding-based fuzzy matching
   * Handles deduplication within document and links to existing entities
   */
  async _resolveEntities(entities, documentId) {
    try {
      const result = await this.entityResolution.resolveDocumentEntities(
        entities,
        documentId,
        {
          excludeSameDocument: false, // Check all entities
          strictTypeMatching: false,  // Allow cross-type matches
        }
      );

      log.info('Entity resolution completed', {
        documentId,
        totalEntities: entities.length,
        created: result.created,
        merged: result.merged,
        linkedSameAs: result.linkedSameAs,
        linkedSimilar: result.linkedSimilar,
        exactMatch: result.exactMatch,
      });

      return result;
    } catch (error) {
      log.warn('Entity resolution failed, using original entities', {
        documentId,
        error: error.message,
      });

      // Fallback: return original entities without resolution
      return {
        resolved: entities.map(e => ({
          original: e,
          resolved: e,
          action: 'fallback',
          similarity: 1.0,
        })),
        created: entities.length,
        merged: 0,
        linkedSameAs: 0,
        linkedSimilar: 0,
        exactMatch: 0,
      };
    }
  }

  /**
   * Discover and create cross-document entity relationships
   */
  async _discoverCrossDocumentLinks(documentId) {
    try {
      const discoveries = await this.entityResolution.discoverCrossDocumentRelationships(
        documentId,
        { minSimilarity: 0.75 }
      );

      // Create edges for discovered relationships
      for (const discovery of discoveries) {
        try {
          await this.graph.addEdge({
            from: discovery.entity1.name,
            to: discovery.entity2.name,
            type: discovery.relationshipType,
            confidence: discovery.similarity,
            evidence: `Cross-document link: similarity ${discovery.similarity.toFixed(4)}`,
            sourceDocumentId: 'cross_document_discovery',
          });
        } catch (error) {
          log.warn('Failed to create cross-document edge', {
            from: discovery.entity1.name,
            to: discovery.entity2.name,
            error: error.message,
          });
        }
      }

      log.info('Cross-document relationship discovery completed', {
        documentId,
        linksDiscovered: discoveries.length,
      });

      return discoveries;
    } catch (error) {
      log.warn('Cross-document discovery failed', {
        documentId,
        error: error.message,
      });
      return [];
    }
  }

  async _extractVisualInfo(extractedContent, documentId, blobUrl) {
    const visualEntities = [];
    const visualRelationships = [];

    if (!extractedContent.figures || extractedContent.figures.length === 0) {
      return { visualEntities, visualRelationships };
    }

    for (const figure of extractedContent.figures) {
      try {
        // TODO: For PDF, we need to crop the image using a library like sharp or canvas
        // For now, if the blobUrl is directly an image, we use it.
        // If it's a PDF, we skip actual extraction unless we have an image service.
        let imageUrl = null;
        if (blobUrl.match(/\.(jpg|jpeg|png)$/i)) {
          imageUrl = blobUrl;
        }

        if (imageUrl) {
          const prompt = `Identify the process flow elements in this diagram.
            Extract 'Roles' (swimlanes), 'Tasks' (rectangles), 'Decisions' (diamonds).
            Return a JSON with 'entities' and 'relationships'.`;

          const response = await this.openai.getVisionCompletion(prompt, imageUrl, {
            responseFormat: { type: 'json_object' }
          });

          const result = JSON.parse(response.content);
          if (result.entities) visualEntities.push(...result.entities.map(e => ({ ...e, source: 'visual_extraction' })));
          if (result.relationships) visualRelationships.push(...result.relationships);
        }
      } catch (err) {
        log.warn('Failed to extract visual info from figure', { figureId: figure.id, error: err.message });
      }
    }

    return { visualEntities, visualRelationships };
  }
}

module.exports = {
  DocumentProcessor,
  CHUNKING_STRATEGY,
  DEFAULT_CHUNKING_STRATEGY,
};
