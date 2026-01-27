const { getOpenAIService } = require('./openai-service');
const {
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT,
  buildEntityExtractionPrompt,
  buildRelationshipExtractionPrompt,
} = require('../prompts/entity-extraction');

class EntityExtractorService {
  constructor() {
    this.openaiService = getOpenAIService();
  }

  async extractEntities(text, documentContext = {}) {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const userPrompt = buildEntityExtractionPrompt(text, documentContext);

    const response = await this.openaiService.getJsonCompletion([
      { role: 'system', content: ENTITY_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    const entities = response.content?.entities || [];

    // Validate and normalize entities
    return entities
      .filter((e) => e.name && e.type)
      .map((e) => ({
        name: this._normalizeEntityName(e.name),
        type: ENTITY_TYPES.includes(e.type) ? e.type : 'Unknown',
        description: e.description || '',
        confidence: typeof e.confidence === 'number' ? Math.min(1, Math.max(0, e.confidence)) : 0.8,
        sourceSpan: e.sourceSpan || '',
      }));
  }

  async extractRelationships(text, entities, documentContext = {}) {
    if (!text || !entities || entities.length < 2) {
      return [];
    }

    const userPrompt = buildRelationshipExtractionPrompt(text, entities);

    const response = await this.openaiService.getJsonCompletion([
      { role: 'system', content: RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    const relationships = response.content?.relationships || [];

    // Validate relationships
    const entityNames = new Set(entities.map((e) => e.name));

    return relationships
      .filter((r) => {
        // Ensure both entities exist
        const fromExists = entityNames.has(r.from) || this._fuzzyMatchEntity(r.from, entityNames);
        const toExists = entityNames.has(r.to) || this._fuzzyMatchEntity(r.to, entityNames);
        return fromExists && toExists && r.type;
      })
      .map((r) => ({
        from: this._resolveEntityName(r.from, entityNames),
        to: this._resolveEntityName(r.to, entityNames),
        type: RELATIONSHIP_TYPES.includes(r.type) ? r.type : 'RELATED_TO',
        confidence: typeof r.confidence === 'number' ? Math.min(1, Math.max(0, r.confidence)) : 0.7,
        evidence: r.evidence || '',
      }));
  }

  async processChunk(chunk, existingEntities = [], documentContext = {}) {
    const text = chunk.content || chunk;

    // Extract entities from this chunk
    const newEntities = await this.extractEntities(text, documentContext);

    // Resolve against existing entities to avoid duplicates
    const resolvedEntities = this._resolveEntities(newEntities, existingEntities);

    // Extract relationships using all entities (existing + new)
    const allEntities = [...existingEntities, ...resolvedEntities.added];

    console.log(`[EntityExtractor] Chunk: ${newEntities.length} raw entities, ${resolvedEntities.added.length} new, ${resolvedEntities.merged.length} merged, ${allEntities.length} total for relationship extraction`);

    const relationships = await this.extractRelationships(
      text,
      allEntities,
      documentContext
    );

    if (relationships.length > 0) {
      console.log(`[EntityExtractor] Found ${relationships.length} relationships in chunk`);
    }

    return {
      entities: resolvedEntities.added,
      mergedEntities: resolvedEntities.merged,
      relationships,
    };
  }

  async processDocument(chunks, documentId, documentTitle) {
    const allEntities = [];
    const allRelationships = [];
    const entityMap = new Map();
    const startTime = Date.now();

    console.log(`[EntityExtractor] Starting entity extraction for ${chunks.length} chunks`);

    // Process chunks in batches to speed up processing
    const BATCH_SIZE = 3; // Process 3 chunks in parallel
    for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
      const batch = chunks.slice(batchStart, batchEnd);

      console.log(`[EntityExtractor] Processing chunks ${batchStart + 1}-${batchEnd} of ${chunks.length}`);

      // Process batch in parallel
      const batchPromises = batch.map((chunk, idx) => {
        const context = {
          title: documentTitle,
          section: chunk.metadata?.sectionTitle,
          pageNumber: chunk.metadata?.pageNumber,
        };
        return this.processChunk(chunk.content, allEntities, context)
          .catch(err => {
            console.error(`[EntityExtractor] Error processing chunk ${batchStart + idx + 1}:`, err.message);
            return { entities: [], relationships: [] };
          });
      });

      const batchResults = await Promise.all(batchPromises);

      // Collect results from batch
      for (const result of batchResults) {
        // Add document reference to entities
        for (const entity of result.entities) {
          entity.sourceDocumentId = documentId;
          if (!entityMap.has(entity.name)) {
            entityMap.set(entity.name, entity);
            allEntities.push(entity);
          }
        }

        // Add document reference to relationships
        for (const rel of result.relationships) {
          rel.sourceDocumentId = documentId;
          allRelationships.push(rel);
        }
      }
    }

    // Second pass: Extract relationships from chunks using the FULL entity list
    // This produces better results than per-chunk extraction because:
    // 1. The full entity list provides more context for the LLM
    // 2. Cross-chunk entity references can be resolved
    if (allEntities.length >= 2) {
      console.log(`[EntityExtractor] Second pass: extracting relationships with ${allEntities.length} entities across ${chunks.length} chunks`);

      // Sample chunks evenly across the document for relationship extraction
      const RELATIONSHIP_BATCH_SIZE = 3;
      const chunksToProcess = chunks.length <= 20 ? chunks : this._sampleChunks(chunks, 20);

      for (let i = 0; i < chunksToProcess.length; i += RELATIONSHIP_BATCH_SIZE) {
        const batch = chunksToProcess.slice(i, i + RELATIONSHIP_BATCH_SIZE);
        console.log(`[EntityExtractor] Relationship extraction batch ${Math.floor(i / RELATIONSHIP_BATCH_SIZE) + 1}/${Math.ceil(chunksToProcess.length / RELATIONSHIP_BATCH_SIZE)}`);

        const relPromises = batch.map(chunk => {
          // Combine adjacent chunks for more context
          const text = chunk.content || chunk;
          return this.extractRelationships(text, allEntities)
            .catch(err => {
              console.error(`[EntityExtractor] Relationship extraction error:`, err.message);
              return [];
            });
        });

        const relResults = await Promise.all(relPromises);
        for (const rels of relResults) {
          for (const rel of rels) {
            rel.sourceDocumentId = documentId;
            allRelationships.push(rel);
          }
        }
      }
    }

    // Deduplicate relationships
    const uniqueRelationships = this._deduplicateRelationships(allRelationships);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[EntityExtractor] Completed in ${elapsed}s: ${allEntities.length} entities, ${uniqueRelationships.length} relationships`);

    return {
      entities: allEntities,
      relationships: uniqueRelationships,
    };
  }

  _normalizeEntityName(name) {
    if (!name) return '';

    // Remove common prefixes/suffixes and normalize whitespace
    return name
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  _fuzzyMatchEntity(name, entityNames) {
    const normalizedName = this._normalizeEntityName(name).toLowerCase();

    for (const existingName of entityNames) {
      const normalizedExisting = existingName.toLowerCase();

      // Check for exact match after normalization
      if (normalizedName === normalizedExisting) {
        return true;
      }

      // Check if one contains the other
      if (normalizedName.includes(normalizedExisting) || normalizedExisting.includes(normalizedName)) {
        return true;
      }
    }

    return false;
  }

  _resolveEntityName(name, entityNames) {
    // First try exact match
    if (entityNames.has(name)) {
      return name;
    }

    // Try normalized match
    const normalizedName = this._normalizeEntityName(name);
    if (entityNames.has(normalizedName)) {
      return normalizedName;
    }

    // Try fuzzy match
    const lowerName = normalizedName.toLowerCase();
    for (const existingName of entityNames) {
      if (existingName.toLowerCase() === lowerName) {
        return existingName;
      }
    }

    return normalizedName;
  }

  _resolveEntities(newEntities, existingEntities) {
    const existingNames = new Map(existingEntities.map((e) => [e.name.toLowerCase(), e]));
    const added = [];
    const merged = [];

    for (const entity of newEntities) {
      const lowerName = entity.name.toLowerCase();

      if (existingNames.has(lowerName)) {
        // Entity exists - potentially merge information
        const existing = existingNames.get(lowerName);
        merged.push({
          existing,
          new: entity,
        });

        // Update confidence if new is higher
        if (entity.confidence > existing.confidence) {
          existing.confidence = entity.confidence;
        }

        // Append description if different
        if (entity.description && entity.description !== existing.description) {
          existing.description = existing.description
            ? `${existing.description}; ${entity.description}`
            : entity.description;
        }
      } else {
        // New entity
        added.push(entity);
        existingNames.set(lowerName, entity);
      }
    }

    return { added, merged };
  }

  _sampleChunks(chunks, maxChunks) {
    if (chunks.length <= maxChunks) return chunks;
    const step = chunks.length / maxChunks;
    const sampled = [];
    for (let i = 0; i < maxChunks; i++) {
      sampled.push(chunks[Math.floor(i * step)]);
    }
    return sampled;
  }

  _deduplicateRelationships(relationships) {
    const seen = new Map();

    for (const rel of relationships) {
      const key = `${rel.from}|${rel.type}|${rel.to}`;

      if (seen.has(key)) {
        // Keep the one with higher confidence
        const existing = seen.get(key);
        if (rel.confidence > existing.confidence) {
          seen.set(key, rel);
        }
      } else {
        seen.set(key, rel);
      }
    }

    return Array.from(seen.values());
  }
}

// Singleton instance
let instance = null;

function getEntityExtractorService() {
  if (!instance) {
    instance = new EntityExtractorService();
  }
  return instance;
}

module.exports = {
  EntityExtractorService,
  getEntityExtractorService,
};
