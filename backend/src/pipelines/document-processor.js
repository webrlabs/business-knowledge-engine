const { getDocumentIntelligenceService } = require('../services/docint-service');
const { getOpenAIService } = require('../services/openai-service');
const { getSearchService } = require('../services/search-service');
const { getGraphService } = require('../services/graph-service');
const { getEntityExtractorService } = require('../services/entity-extractor');
const { generateSasUrl, getBlobNameFromUrl } = require('../storage/blob');
const { v4: uuidv4 } = require('uuid');
const { log } = require('../utils/logger');

const CHUNK_SIZE = 500; // tokens (approximate)
const CHUNK_OVERLAP = 50; // tokens

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

      // Stage 2: Chunk content
      await this._updateStatus(documentId, 'chunking');
      const chunks = this._createChunks(extractedContent, documentId, options);

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

      // Stage 4: Generate embeddings
      await this._updateStatus(documentId, 'generating_embeddings');
      const embeddedChunks = await this._generateEmbeddings(chunks, entities);

      // Stage 5: Index to search
      await this._updateStatus(documentId, 'indexing_search');
      await this.search.ensureIndexExists();
      const indexResult = await this.search.indexDocuments(embeddedChunks);

      // Stage 6: Update graph
      await this._updateStatus(documentId, 'updating_graph');
      await this._updateGraph(entities, relationships, documentId);

      // Complete
      const processingTime = Date.now() - startTime;
      await this._updateStatus(documentId, 'completed', {
        // Store entities and relationships for graph rebuilding if needed
        entities: entities.map(e => ({
          name: e.name,
          type: e.type,
          description: e.description,
          confidence: e.confidence,
        })),
        relationships: relationships.map(r => ({
          from: r.from,
          to: r.to,
          type: r.type,
          confidence: r.confidence,
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
            relationshipsExtracted: relationships.length,
            processingTimeMs: processingTime,
            modelId: extractedContent.metadata.modelId,
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
          relationshipsExtracted: relationships.length,
          processingTimeMs: processingTime,
        },
      };
    } catch (error) {
      await this._updateStatus(documentId, 'failed', {
        processingError: error.message,
      });

      throw error;
    }
  }

  _createChunks(extractedContent, documentId, options) {
    const chunks = [];
    const docIntelService = this.docIntelligence;

    // Get structured chunks from Document Intelligence
    const textChunks = docIntelService.extractTextWithMetadata(extractedContent);

    // Process full content into smaller chunks with overlap
    const fullContent = extractedContent.content;
    if (fullContent) {
      const contentChunks = this._splitIntoChunks(fullContent, CHUNK_SIZE, CHUNK_OVERLAP);

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
          },
        });
      });
    }

    // Add section-based chunks
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

    // Add table chunks
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
    // Add entities as vertices
    for (const entity of entities) {
      try {
        // Check if entity already exists
        const existing = await this.graph.findVertexByName(entity.name);

        if (!existing) {
          await this.graph.addVertex({
            ...entity,
            sourceDocumentId: documentId,
          });
        } else {
          // Update confidence if new is higher
          // For now, we just skip duplicates
        }
      } catch (error) {
        log.warn('Failed to add entity to graph', {
          entityName: entity.name,
          documentId,
          error: error.message,
        });
      }
    }

    // Add relationships as edges
    for (const relationship of relationships) {
      try {
        await this.graph.addEdge({
          ...relationship,
          sourceDocumentId: documentId,
        });
      } catch (error) {
        log.warn('Failed to add relationship to graph', {
          from: relationship.from,
          to: relationship.to,
          documentId,
          error: error.message,
        });
      }
    }
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
    // Clean up existing data for this document
    await this.search.deleteDocumentsByDocumentId(documentId);
    await this.graph.deleteEdgesByDocumentId(documentId);
    await this.graph.deleteVertexByDocumentId(documentId);

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
};
