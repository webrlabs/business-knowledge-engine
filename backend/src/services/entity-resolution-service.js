/**
 * Entity Resolution Service
 *
 * Implements state-of-the-art entity resolution for GraphRAG using:
 * - Embedding-based semantic similarity matching
 * - Configurable similarity thresholds
 * - Cross-document entity linking
 * - Community detection for entity clusters
 *
 * Based on Microsoft GraphRAG and modern entity resolution techniques.
 */

const { SearchClient, SearchIndexClient } = require('@azure/search-documents');
const { AzureKeyCredential } = require('@azure/core-auth');
const { DefaultAzureCredential } = require('@azure/identity');
const { getOpenAIService } = require('./openai-service');
const { getGraphService, normalizeEntityName, normalizeRelationshipType } = require('./graph-service');
const { getEntityResolutionCache } = require('./entity-resolution-cache');
const { v4: uuidv4 } = require('uuid');
const { log } = require('../utils/logger');

// Configuration
const CONFIG = {
  // Similarity thresholds (cosine similarity, 0-1)
  EXACT_MATCH_THRESHOLD: 0.98,      // Almost certainly the same entity
  HIGH_SIMILARITY_THRESHOLD: 0.92,  // Very likely the same entity (auto-merge)
  MEDIUM_SIMILARITY_THRESHOLD: 0.85, // Possibly the same entity (create SAME_AS edge)
  LOW_SIMILARITY_THRESHOLD: 0.75,   // Related but different (create SIMILAR_TO edge)

  // Search parameters
  MAX_CANDIDATES: 20,               // Max candidates to consider for matching
  MIN_DESCRIPTION_LENGTH: 10,       // Min description length for meaningful embedding

  // Entity index configuration
  ENTITY_INDEX_NAME: process.env.AZURE_SEARCH_ENTITY_INDEX || 'entities',
};

// Entity index schema for Azure AI Search
const ENTITY_INDEX_SCHEMA = {
  name: CONFIG.ENTITY_INDEX_NAME,
  fields: [
    { name: 'id', type: 'Edm.String', key: true, filterable: true },
    { name: 'canonicalId', type: 'Edm.String', filterable: true }, // Points to canonical entity if merged
    { name: 'name', type: 'Edm.String', searchable: true, filterable: true },
    { name: 'normalizedName', type: 'Edm.String', searchable: true, filterable: true },
    { name: 'type', type: 'Edm.String', filterable: true, facetable: true },
    { name: 'description', type: 'Edm.String', searchable: true },
    { name: 'nameVector', type: 'Collection(Edm.Single)', searchable: true, vectorSearchDimensions: 1536, vectorSearchProfileName: 'entity-vector-profile' },
    { name: 'descriptionVector', type: 'Collection(Edm.Single)', searchable: true, vectorSearchDimensions: 1536, vectorSearchProfileName: 'entity-vector-profile' },
    { name: 'combinedVector', type: 'Collection(Edm.Single)', searchable: true, vectorSearchDimensions: 1536, vectorSearchProfileName: 'entity-vector-profile' },
    { name: 'sourceDocumentIds', type: 'Collection(Edm.String)', filterable: true },
    { name: 'aliases', type: 'Collection(Edm.String)', searchable: true }, // Alternative names
    { name: 'confidence', type: 'Edm.Double', filterable: true, sortable: true },
    { name: 'mentionCount', type: 'Edm.Int32', sortable: true }, // How many times entity appears
    { name: 'createdAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
    { name: 'updatedAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
    { name: 'mergedFrom', type: 'Collection(Edm.String)', filterable: true }, // IDs of merged entities
  ],
  vectorSearch: {
    algorithms: [
      {
        name: 'entity-hnsw',
        kind: 'hnsw',
        parameters: {
          m: 4,
          efConstruction: 400,
          efSearch: 500,
          metric: 'cosine',
        },
      },
    ],
    profiles: [
      {
        name: 'entity-vector-profile',
        algorithmConfigurationName: 'entity-hnsw',
      },
    ],
  },
  semantic: {
    configurations: [
      {
        name: 'entity-semantic-config',
        prioritizedFields: {
          contentFields: [{ fieldName: 'description' }],
          titleField: { fieldName: 'name' },
          keywordsFields: [{ fieldName: 'aliases' }],
        },
      },
    ],
  },
};

class EntityResolutionService {
  constructor() {
    this.searchClient = null;
    this.indexClient = null;
    this.openai = getOpenAIService();
    this.graph = getGraphService();
    this.cache = getEntityResolutionCache();
    this.endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    this.apiKey = process.env.AZURE_SEARCH_API_KEY;
  }

  _getCredential() {
    if (this.apiKey) {
      return new AzureKeyCredential(this.apiKey);
    }
    return new DefaultAzureCredential();
  }

  async _getSearchClient() {
    if (!this.searchClient) {
      if (!this.endpoint) {
        throw new Error('AZURE_SEARCH_ENDPOINT is required');
      }
      this.searchClient = new SearchClient(
        this.endpoint,
        CONFIG.ENTITY_INDEX_NAME,
        this._getCredential()
      );
    }
    return this.searchClient;
  }

  async _getIndexClient() {
    if (!this.indexClient) {
      if (!this.endpoint) {
        throw new Error('AZURE_SEARCH_ENDPOINT is required');
      }
      this.indexClient = new SearchIndexClient(this.endpoint, this._getCredential());
    }
    return this.indexClient;
  }

  /**
   * Ensure the entity index exists with proper schema
   */
  async ensureEntityIndexExists() {
    const indexClient = await this._getIndexClient();

    try {
      await indexClient.getIndex(CONFIG.ENTITY_INDEX_NAME);
      log.info('Entity index already exists');
    } catch (error) {
      if (error.statusCode === 404) {
        log.info('Creating entity index...');
        await indexClient.createIndex(ENTITY_INDEX_SCHEMA);
        log.info('Entity index created successfully');
      } else {
        throw error;
      }
    }
  }

  /**
   * Generate embedding for an entity (combines name and description)
   * Uses caching to avoid repeated API calls for the same entity
   */
  async generateEntityEmbedding(entity) {
    const description = entity.description || '';

    // Check cache first
    const cachedEmbeddings = this.cache.getEmbeddings(entity.name, entity.type, description);
    if (cachedEmbeddings) {
      log.debug('Using cached embeddings', { entityName: entity.name });
      return cachedEmbeddings;
    }

    const textsToEmbed = [];

    // Name embedding
    textsToEmbed.push(entity.name);

    // Description embedding (if meaningful)
    const hasDescription = description && description.length >= CONFIG.MIN_DESCRIPTION_LENGTH;
    if (hasDescription) {
      textsToEmbed.push(description);
    }

    // Combined text for better semantic matching
    const combinedText = hasDescription
      ? `${entity.name}: ${description}`
      : entity.name;
    textsToEmbed.push(combinedText);

    const embeddings = await this.openai.getEmbeddings(textsToEmbed);

    const result = {
      nameVector: embeddings[0],
      descriptionVector: hasDescription ? embeddings[1] : embeddings[0], // Use name if no description
      combinedVector: hasDescription ? embeddings[2] : embeddings[0],
    };

    // Store in cache
    this.cache.setEmbeddings(entity.name, entity.type, description, result);

    return result;
  }

  /**
   * Find similar entities using vector search
   * Uses caching to avoid repeated searches for the same entity
   */
  async findSimilarEntities(entity, options = {}) {
    const normalizedName = normalizeEntityName(entity.name);

    // Check cache first
    const cachedResults = this.cache.getSimilarEntities(normalizedName, entity.type, options);
    if (cachedResults) {
      log.debug('Using cached similar entities', { entityName: entity.name, count: cachedResults.length });
      return cachedResults;
    }

    const client = await this._getSearchClient();
    const { combinedVector } = await this.generateEntityEmbedding(entity);

    const searchOptions = {
      top: options.maxCandidates || CONFIG.MAX_CANDIDATES,
      select: ['id', 'canonicalId', 'name', 'normalizedName', 'type', 'description', 'aliases', 'sourceDocumentIds', 'confidence', 'mentionCount'],
      vectorSearchOptions: {
        queries: [
          {
            kind: 'vector',
            vector: combinedVector,
            fields: ['combinedVector'],
            kNearestNeighborsCount: options.maxCandidates || CONFIG.MAX_CANDIDATES,
          },
        ],
      },
    };

    // Optionally filter by type
    if (options.filterByType && entity.type) {
      searchOptions.filter = `type eq '${entity.type}'`;
    }

    // Optionally exclude current document
    if (options.excludeDocumentId) {
      const filter = `not sourceDocumentIds/any(d: d eq '${options.excludeDocumentId}')`;
      searchOptions.filter = searchOptions.filter
        ? `${searchOptions.filter} and ${filter}`
        : filter;
    }

    const results = [];
    try {
      const searchResults = await client.search('*', searchOptions);

      for await (const result of searchResults.results) {
        results.push({
          ...result.document,
          similarity: result.score, // Cosine similarity from vector search
        });
      }
    } catch (error) {
      // Index might not exist yet
      if (error.statusCode !== 404) {
        throw error;
      }
    }

    // Store in cache
    this.cache.setSimilarEntities(normalizedName, entity.type, options, results);

    return results;
  }

  /**
   * Calculate precise cosine similarity between two vectors
   */
  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Resolve an entity - find canonical version or create new
   * Returns: { entity, action, similarity, canonicalEntity }
   * action: 'created' | 'merged' | 'linked_same_as' | 'linked_similar'
   */
  async resolveEntity(entity, documentId, options = {}) {
    const normalizedName = normalizeEntityName(entity.name);

    // Generate embeddings for the new entity
    const embeddings = await this.generateEntityEmbedding(entity);

    // Find similar entities in the index
    const candidates = await this.findSimilarEntities(entity, {
      excludeDocumentId: options.excludeSameDocument ? documentId : null,
      filterByType: options.strictTypeMatching,
    });

    // Calculate precise similarity for top candidates
    const scoredCandidates = [];
    for (const candidate of candidates.slice(0, 10)) {
      // Fetch the candidate's embedding for precise comparison
      const candidateDoc = await this._getEntityFromIndex(candidate.id);
      if (candidateDoc && candidateDoc.combinedVector) {
        const similarity = this.cosineSimilarity(embeddings.combinedVector, candidateDoc.combinedVector);
        scoredCandidates.push({
          ...candidate,
          preciseSimilarity: similarity,
        });
      }
    }

    // Sort by precise similarity
    scoredCandidates.sort((a, b) => b.preciseSimilarity - a.preciseSimilarity);

    const bestMatch = scoredCandidates[0];
    const bestSimilarity = bestMatch?.preciseSimilarity || 0;

    log.debug('Entity resolution candidate analysis', {
      entityName: entity.name,
      bestMatchName: bestMatch?.name,
      bestSimilarity,
      candidateCount: scoredCandidates.length,
    });

    // Decision logic based on similarity thresholds
    if (bestSimilarity >= CONFIG.EXACT_MATCH_THRESHOLD) {
      // Exact match - use existing entity
      return {
        entity: bestMatch,
        action: 'exact_match',
        similarity: bestSimilarity,
        canonicalEntity: bestMatch,
      };
    }

    if (bestSimilarity >= CONFIG.HIGH_SIMILARITY_THRESHOLD) {
      // High similarity - merge into existing entity
      const merged = await this._mergeEntities(bestMatch, entity, documentId, embeddings);
      return {
        entity: merged,
        action: 'merged',
        similarity: bestSimilarity,
        canonicalEntity: bestMatch,
      };
    }

    if (bestSimilarity >= CONFIG.MEDIUM_SIMILARITY_THRESHOLD) {
      // Medium similarity - create new entity but link with SAME_AS
      const newEntity = await this._createEntityInIndex(entity, documentId, embeddings);
      await this._createSameAsEdge(newEntity, bestMatch, bestSimilarity);
      return {
        entity: newEntity,
        action: 'linked_same_as',
        similarity: bestSimilarity,
        canonicalEntity: bestMatch,
      };
    }

    if (bestSimilarity >= CONFIG.LOW_SIMILARITY_THRESHOLD) {
      // Low similarity - create new entity but link with SIMILAR_TO
      const newEntity = await this._createEntityInIndex(entity, documentId, embeddings);
      await this._createSimilarToEdge(newEntity, bestMatch, bestSimilarity);
      return {
        entity: newEntity,
        action: 'linked_similar',
        similarity: bestSimilarity,
        canonicalEntity: null,
      };
    }

    // No good match - create new entity
    const newEntity = await this._createEntityInIndex(entity, documentId, embeddings);
    return {
      entity: newEntity,
      action: 'created',
      similarity: bestSimilarity,
      canonicalEntity: null,
    };
  }

  /**
   * Get entity from the search index by ID
   */
  async _getEntityFromIndex(entityId) {
    const client = await this._getSearchClient();
    try {
      return await client.getDocument(entityId);
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create a new entity in the search index
   */
  async _createEntityInIndex(entity, documentId, embeddings) {
    const client = await this._getSearchClient();
    const id = entity.id || uuidv4();
    const now = new Date().toISOString();
    const normalizedName = normalizeEntityName(entity.name);

    const indexEntity = {
      id,
      canonicalId: id, // Points to itself initially
      name: entity.name,
      normalizedName,
      type: entity.type || 'Unknown',
      description: entity.description || '',
      nameVector: embeddings.nameVector,
      descriptionVector: embeddings.descriptionVector,
      combinedVector: embeddings.combinedVector,
      sourceDocumentIds: [documentId],
      aliases: [],
      confidence: entity.confidence || 0.8,
      mentionCount: 1,
      createdAt: now,
      updatedAt: now,
      mergedFrom: [],
    };

    await client.uploadDocuments([indexEntity]);

    // Invalidate related caches since a new entity was created
    this.cache.invalidateEntity(normalizedName);

    log.info('Created new entity in index', {
      entityId: id,
      name: entity.name,
      type: entity.type,
      documentId,
    });

    return { ...indexEntity, id };
  }

  /**
   * Merge a new entity into an existing canonical entity
   */
  async _mergeEntities(canonical, newEntity, documentId, embeddings) {
    const client = await this._getSearchClient();
    const now = new Date().toISOString();

    // Get current canonical entity data
    const current = await this._getEntityFromIndex(canonical.id);
    if (!current) {
      // Canonical no longer exists, create new
      return this._createEntityInIndex(newEntity, documentId, embeddings);
    }

    // Update canonical entity with merged data
    const updatedEntity = {
      id: canonical.id,
      canonicalId: canonical.id,
      name: canonical.name, // Keep original name
      normalizedName: canonical.normalizedName,
      type: canonical.type,
      // Merge descriptions if new one is better
      description: (newEntity.description && newEntity.description.length > (current.description?.length || 0))
        ? newEntity.description
        : current.description,
      // Keep existing vectors (canonical is authoritative)
      nameVector: current.nameVector,
      descriptionVector: current.descriptionVector,
      combinedVector: current.combinedVector,
      // Add document ID to sources
      sourceDocumentIds: [...new Set([...(current.sourceDocumentIds || []), documentId])],
      // Add new name as alias if different
      aliases: [...new Set([
        ...(current.aliases || []),
        ...(newEntity.name !== canonical.name ? [newEntity.name] : []),
      ])],
      // Update confidence (average)
      confidence: ((current.confidence || 0.8) + (newEntity.confidence || 0.8)) / 2,
      mentionCount: (current.mentionCount || 1) + 1,
      createdAt: current.createdAt,
      updatedAt: now,
      mergedFrom: current.mergedFrom || [],
    };

    await client.mergeDocuments([updatedEntity]);

    // Invalidate caches for both the canonical and merged entity names
    const canonicalNormalizedName = normalizeEntityName(canonical.name);
    const newEntityNormalizedName = normalizeEntityName(newEntity.name);
    this.cache.invalidateEntity(canonicalNormalizedName);
    if (newEntityNormalizedName !== canonicalNormalizedName) {
      this.cache.invalidateEntity(newEntityNormalizedName);
    }

    log.info('Merged entity into canonical', {
      canonicalId: canonical.id,
      canonicalName: canonical.name,
      mergedName: newEntity.name,
      documentId,
      newAliasCount: updatedEntity.aliases.length,
    });

    return updatedEntity;
  }

  /**
   * Create SAME_AS edge between two entities (high-confidence link)
   */
  async _createSameAsEdge(entity1, entity2, similarity) {
    try {
      await this.graph.addEdge({
        from: entity1.name,
        to: entity2.name,
        type: 'SAME_AS',
        confidence: similarity,
        evidence: `Embedding similarity: ${similarity.toFixed(4)}`,
        sourceDocumentId: 'entity_resolution',
      });

      log.info('Created SAME_AS edge', {
        from: entity1.name,
        to: entity2.name,
        similarity,
      });
    } catch (error) {
      log.warn('Failed to create SAME_AS edge', {
        from: entity1.name,
        to: entity2.name,
        error: error.message,
      });
    }
  }

  /**
   * Create SIMILAR_TO edge between two entities (lower-confidence link)
   */
  async _createSimilarToEdge(entity1, entity2, similarity) {
    try {
      await this.graph.addEdge({
        from: entity1.name,
        to: entity2.name,
        type: 'SIMILAR_TO',
        confidence: similarity,
        evidence: `Embedding similarity: ${similarity.toFixed(4)}`,
        sourceDocumentId: 'entity_resolution',
      });

      log.info('Created SIMILAR_TO edge', {
        from: entity1.name,
        to: entity2.name,
        similarity,
      });
    } catch (error) {
      log.warn('Failed to create SIMILAR_TO edge', {
        from: entity1.name,
        to: entity2.name,
        error: error.message,
      });
    }
  }

  /**
   * Process all entities from a document with resolution
   * Returns resolved entities with their canonical mappings
   */
  async resolveDocumentEntities(entities, documentId, options = {}) {
    await this.ensureEntityIndexExists();

    const results = {
      resolved: [],
      created: 0,
      merged: 0,
      linkedSameAs: 0,
      linkedSimilar: 0,
      exactMatch: 0,
    };

    // First pass: resolve entities within the same document to avoid self-duplicates
    const seenInDocument = new Map(); // normalizedName -> resolved entity

    for (const entity of entities) {
      const normalizedName = normalizeEntityName(entity.name);

      // Check if we've already resolved a similar entity in this document
      if (seenInDocument.has(normalizedName)) {
        const existing = seenInDocument.get(normalizedName);
        results.resolved.push({
          original: entity,
          resolved: existing.entity,
          action: 'deduplicated_in_document',
          similarity: 1.0,
        });
        continue;
      }

      // Resolve against the global entity index
      const resolution = await this.resolveEntity(entity, documentId, options);

      seenInDocument.set(normalizedName, resolution);
      results.resolved.push({
        original: entity,
        resolved: resolution.entity,
        action: resolution.action,
        similarity: resolution.similarity,
        canonicalEntity: resolution.canonicalEntity,
      });

      // Update stats
      switch (resolution.action) {
        case 'created': results.created++; break;
        case 'merged': results.merged++; break;
        case 'linked_same_as': results.linkedSameAs++; break;
        case 'linked_similar': results.linkedSimilar++; break;
        case 'exact_match': results.exactMatch++; break;
      }
    }

    log.info('Document entity resolution complete', {
      documentId,
      totalEntities: entities.length,
      ...results,
    });

    return results;
  }

  /**
   * Discover cross-document relationships
   * Finds entities from other documents that are similar to entities in the current document
   */
  async discoverCrossDocumentRelationships(documentId, options = {}) {
    const client = await this._getSearchClient();

    // Get all entities from the current document
    const searchResults = await client.search('*', {
      filter: `sourceDocumentIds/any(d: d eq '${documentId}')`,
      select: ['id', 'name', 'type', 'combinedVector', 'sourceDocumentIds'],
      top: 1000,
    });

    const documentEntities = [];
    for await (const result of searchResults.results) {
      documentEntities.push(result.document);
    }

    const discoveries = [];

    for (const entity of documentEntities) {
      // Find similar entities from OTHER documents
      const candidates = await this.findSimilarEntities(
        { name: entity.name, type: entity.type },
        {
          excludeDocumentId: documentId,
          maxCandidates: 10,
        }
      );

      for (const candidate of candidates) {
        // Calculate precise similarity
        if (entity.combinedVector && candidate.combinedVector) {
          const similarity = this.cosineSimilarity(entity.combinedVector, candidate.combinedVector);

          if (similarity >= CONFIG.LOW_SIMILARITY_THRESHOLD) {
            discoveries.push({
              entity1: { id: entity.id, name: entity.name, documentIds: entity.sourceDocumentIds },
              entity2: { id: candidate.id, name: candidate.name, documentIds: candidate.sourceDocumentIds },
              similarity,
              relationshipType: similarity >= CONFIG.MEDIUM_SIMILARITY_THRESHOLD ? 'SAME_AS' : 'SIMILAR_TO',
            });
          }
        }
      }
    }

    log.info('Cross-document relationship discovery complete', {
      documentId,
      entitiesAnalyzed: documentEntities.length,
      relationshipsDiscovered: discoveries.length,
    });

    return discoveries;
  }

  /**
   * Get the canonical entity for a given entity name
   * Follows SAME_AS chains to find the authoritative entity
   * Uses caching for improved performance
   */
  async getCanonicalEntity(entityName) {
    const normalizedName = normalizeEntityName(entityName);

    // Check cache first
    const cachedCanonical = this.cache.getCanonicalEntity(normalizedName);
    if (cachedCanonical) {
      log.debug('Using cached canonical entity', { entityName, normalizedName });
      return cachedCanonical;
    }

    const client = await this._getSearchClient();

    try {
      // Search by normalized name
      const results = await client.search('*', {
        filter: `normalizedName eq '${normalizedName}'`,
        select: ['id', 'canonicalId', 'name', 'type', 'description', 'aliases', 'sourceDocumentIds'],
        top: 1,
      });

      for await (const result of results.results) {
        const entity = result.document;

        // If this entity points to a different canonical, fetch that
        if (entity.canonicalId && entity.canonicalId !== entity.id) {
          const canonical = await this._getEntityFromIndex(entity.canonicalId);
          const resultEntity = canonical || entity;
          // Cache the canonical entity
          this.cache.setCanonicalEntity(normalizedName, resultEntity);
          return resultEntity;
        }

        // Cache the canonical entity
        this.cache.setCanonicalEntity(normalizedName, entity);
        return entity;
      }

      // Try searching in aliases
      const aliasResults = await client.search(entityName, {
        searchFields: ['aliases'],
        select: ['id', 'canonicalId', 'name', 'type', 'description', 'aliases', 'sourceDocumentIds'],
        top: 1,
      });

      for await (const result of aliasResults.results) {
        const entity = result.document;
        // Cache the canonical entity
        this.cache.setCanonicalEntity(normalizedName, entity);
        return entity;
      }

      // Cache null result to avoid repeated lookups for non-existent entities
      // Using a special marker object to distinguish from uncached
      return null;
    } catch (error) {
      if (error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get all entities related to a given entity (via SAME_AS and SIMILAR_TO)
   */
  async getRelatedEntities(entityName, options = {}) {
    const canonical = await this.getCanonicalEntity(entityName);
    if (!canonical) {
      return { entity: null, related: [] };
    }

    // Get entities linked via SAME_AS or SIMILAR_TO from the graph
    const graph = this.graph;
    const related = [];

    try {
      // Find entities connected by SAME_AS
      const sameAsResults = await graph._submit(`
        g.V().has('name', name)
          .both('SAME_AS')
          .valueMap(true)
          .limit(limit)
      `, { name: canonical.name, limit: options.maxRelated || 20 });

      for (const v of sameAsResults) {
        related.push({
          ...graph._normalizeVertex(v),
          relationshipType: 'SAME_AS',
        });
      }

      // Find entities connected by SIMILAR_TO
      if (options.includeSimilar !== false) {
        const similarResults = await graph._submit(`
          g.V().has('name', name)
            .both('SIMILAR_TO')
            .valueMap(true)
            .limit(limit)
        `, { name: canonical.name, limit: options.maxRelated || 20 });

        for (const v of similarResults) {
          related.push({
            ...graph._normalizeVertex(v),
            relationshipType: 'SIMILAR_TO',
          });
        }
      }
    } catch (error) {
      log.warn('Failed to fetch related entities from graph', {
        entityName,
        error: error.message,
      });
    }

    return {
      entity: canonical,
      related,
    };
  }

  /**
   * Batch update entity index (for reindexing or maintenance)
   */
  async reindexEntitiesFromGraph() {
    await this.ensureEntityIndexExists();

    const graph = this.graph;
    const client = await this._getSearchClient();

    // Get all vertices from the graph
    const vertices = await graph._submit('g.V().valueMap(true).limit(10000)');

    let indexed = 0;
    let errors = 0;

    for (const v of vertices) {
      try {
        const entity = graph._normalizeVertex(v);

        // Generate embeddings
        const embeddings = await this.generateEntityEmbedding(entity);

        const indexEntity = {
          id: entity.id,
          canonicalId: entity.id,
          name: entity.name,
          normalizedName: normalizeEntityName(entity.name),
          type: entity.type || 'Unknown',
          description: entity.description || '',
          nameVector: embeddings.nameVector,
          descriptionVector: embeddings.descriptionVector,
          combinedVector: embeddings.combinedVector,
          sourceDocumentIds: entity.sourceDocumentId ? [entity.sourceDocumentId] : [],
          aliases: [],
          confidence: entity.confidence || 0.8,
          mentionCount: 1,
          createdAt: entity.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          mergedFrom: [],
        };

        await client.uploadDocuments([indexEntity]);
        indexed++;
      } catch (error) {
        log.warn('Failed to index entity', { entityId: v.id, error: error.message });
        errors++;
      }
    }

    log.info('Entity reindexing complete', { indexed, errors, total: vertices.length });

    return { indexed, errors, total: vertices.length };
  }

  // ===================
  // Cache Management
  // ===================

  /**
   * Get cache statistics for monitoring
   * @returns {object} Cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Get cache health summary
   * @returns {object} Health summary
   */
  getCacheHealth() {
    return this.cache.getHealthSummary();
  }

  /**
   * Clear all entity resolution caches
   */
  clearCache() {
    this.cache.clear();
    log.info('Entity resolution cache cleared');
  }

  /**
   * Invalidate cache for a specific entity
   * @param {string} entityName - The entity name
   */
  invalidateEntityCache(entityName) {
    const normalizedName = normalizeEntityName(entityName);
    return this.cache.invalidateEntity(normalizedName);
  }

  /**
   * Invalidate cache for a specific document
   * @param {string} documentId - The document ID
   */
  invalidateDocumentCache(documentId) {
    return this.cache.invalidateDocument(documentId);
  }

  /**
   * Reset cache statistics (keeps cached data)
   */
  resetCacheStats() {
    this.cache.resetStats();
    log.info('Entity resolution cache statistics reset');
  }

  /**
   * Enable or disable caching at runtime
   * @param {boolean} enabled - Whether to enable caching
   */
  setCacheEnabled(enabled) {
    this.cache.setEnabled(enabled);
  }
}

// Singleton instance
let instance = null;

function getEntityResolutionService() {
  if (!instance) {
    instance = new EntityResolutionService();
  }
  return instance;
}

module.exports = {
  EntityResolutionService,
  getEntityResolutionService,
  CONFIG,
  ENTITY_INDEX_SCHEMA,
};
