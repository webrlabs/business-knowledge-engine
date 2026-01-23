const { createGremlinClient, closeGremlinClient } = require('../clients');
const { v4: uuidv4 } = require('uuid');
const { getCircuitBreakerService } = require('./circuit-breaker-service');

/**
 * Normalize an entity name for consistent matching.
 * Handles case variations, extra whitespace, and common formatting differences.
 */
function normalizeEntityName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')           // Collapse multiple spaces
    .replace(/[''`]/g, "'")         // Normalize quotes
    .replace(/[""]/g, '"')          // Normalize double quotes
    .replace(/[-–—]/g, '-');        // Normalize dashes
}

/**
 * Normalize a relationship type for consistent matching.
 * Maps common synonyms to canonical types.
 */
function normalizeRelationshipType(type) {
  if (!type) return 'RELATED_TO';

  const normalized = type.toLowerCase().trim().replace(/\s+/g, '_');

  // Map common synonyms to canonical relationship types
  const synonymMap = {
    'manages': 'MANAGES',
    'supervises': 'MANAGES',
    'oversees': 'MANAGES',
    'leads': 'MANAGES',
    'directs': 'MANAGES',
    'reports_to': 'REPORTS_TO',
    'reports': 'REPORTS_TO',
    'works_for': 'REPORTS_TO',
    'performs': 'PERFORMS',
    'executes': 'PERFORMS',
    'does': 'PERFORMS',
    'completes': 'PERFORMS',
    'uses': 'USES',
    'utilizes': 'USES',
    'employs': 'USES',
    'requires': 'REQUIRES',
    'needs': 'REQUIRES',
    'depends_on': 'REQUIRES',
    'contains': 'CONTAINS',
    'includes': 'CONTAINS',
    'has': 'CONTAINS',
    'part_of': 'PART_OF',
    'belongs_to': 'PART_OF',
    'member_of': 'PART_OF',
    'followed_by': 'FOLLOWED_BY',
    'precedes': 'PRECEDES',
    'before': 'PRECEDES',
    'after': 'FOLLOWED_BY',
    'triggers': 'TRIGGERS',
    'causes': 'TRIGGERS',
    'initiates': 'TRIGGERS',
    'produces': 'PRODUCES',
    'creates': 'PRODUCES',
    'generates': 'PRODUCES',
    'outputs': 'PRODUCES',
    'inputs': 'INPUTS',
    'receives': 'INPUTS',
    'consumes': 'INPUTS',
  };

  return synonymMap[normalized] || type.toUpperCase().replace(/\s+/g, '_');
}

class GraphService {
  constructor() {
    this.client = null;
    this._circuitBreaker = null;
  }

  async _getClient() {
    if (!this.client) {
      this.client = await createGremlinClient();
    }
    return this.client;
  }

  _getCircuitBreaker() {
    if (!this._circuitBreaker) {
      this._circuitBreaker = getCircuitBreakerService();
    }
    return this._circuitBreaker;
  }

  async close() {
    await closeGremlinClient();
    this.client = null;
  }

  async _submit(query, bindings = {}) {
    const client = await this._getClient();
    const cb = this._getCircuitBreaker();

    // Wrap Gremlin query execution with circuit breaker
    const gremlinOperation = async () => {
      try {
        const result = await client.submit(query, bindings);
        return result._items || [];
      } catch (error) {
        // Handle token expiration by reconnecting
        if (error.message?.includes('unauthorized') || error.message?.includes('401')) {
          this.client = null;
          const newClient = await this._getClient();
          const result = await newClient.submit(query, bindings);
          return result._items || [];
        }
        throw error;
      }
    };

    const breaker = cb.getBreaker('gremlin', gremlinOperation, { name: 'submit' });
    return breaker.fire();
  }

  async addVertex(entity) {
    const id = entity.id || uuidv4();
    // Ensure type/category is never null/undefined - Cosmos DB Graph requires a partition key
    // The partition key path is /ontologyType as defined in Terraform
    const entityType = (entity.type && entity.type !== 'null' && entity.type !== null)
      ? entity.type
      : 'Unknown';

    // Build the Gremlin query dynamically based on entity properties
    // Use 'ontologyType' as the partition key property (matches Terraform config)
    let query = `g.addV(label).property('id', id).property('ontologyType', ontologyType)`;
    const bindings = {
      label: entityType,
      id: id,
      ontologyType: entityType,
    };

    // Add standard properties
    if (entity.name) {
      query += `.property('name', name)`;
      bindings.name = entity.name;
      // Store normalized name for case-insensitive matching
      query += `.property('normalizedName', normalizedName)`;
      bindings.normalizedName = normalizeEntityName(entity.name);
    }

    if (entity.description) {
      query += `.property('description', description)`;
      bindings.description = entity.description;
    }

    if (entity.confidence !== undefined) {
      query += `.property('confidence', confidence)`;
      bindings.confidence = entity.confidence;
    }

    if (entity.sourceDocumentId) {
      query += `.property('sourceDocumentId', sourceDocumentId)`;
      bindings.sourceDocumentId = entity.sourceDocumentId;
    }

    if (entity.sourceSpan) {
      query += `.property('sourceSpan', sourceSpan)`;
      bindings.sourceSpan = entity.sourceSpan;
    }

    // Add timestamp
    const now = new Date().toISOString();
    query += `.property('createdAt', createdAt)`;
    bindings.createdAt = now;

    // Add temporal versioning fields (F2.3.1)
    // validFrom defaults to creation time if not specified
    const validFrom = entity.validFrom || now;
    query += `.property('validFrom', validFrom)`;
    bindings.validFrom = validFrom;

    // validTo is null/undefined for currently valid entities
    if (entity.validTo) {
      query += `.property('validTo', validTo)`;
      bindings.validTo = entity.validTo;
    }

    // supersededBy - reference to replacement entity ID
    if (entity.supersededBy) {
      query += `.property('supersededBy', supersededBy)`;
      bindings.supersededBy = entity.supersededBy;
    }

    // supersedes - reference to previous entity ID
    if (entity.supersedes) {
      query += `.property('supersedes', supersedes)`;
      bindings.supersedes = entity.supersedes;
    }

    // Compute temporal status
    const temporalStatus = this._computeTemporalStatus(entity, now);
    query += `.property('temporalStatus', temporalStatus)`;
    bindings.temporalStatus = temporalStatus;

    // Version sequence - defaults to 1 for new entities
    const versionSequence = entity.versionSequence || 1;
    query += `.property('versionSequence', versionSequence)`;
    bindings.versionSequence = versionSequence;

    const result = await this._submit(query, bindings);
    return { id, ...entity, temporalStatus, versionSequence };
  }

  /**
   * Compute the temporal status based on entity temporal fields.
   * @param {Object} entity - Entity with optional temporal fields
   * @param {string} [referenceTime] - Reference time for comparison (defaults to now)
   * @returns {string} One of: 'current', 'expired', 'pending', 'superseded'
   */
  _computeTemporalStatus(entity, referenceTime = null) {
    const now = referenceTime ? new Date(referenceTime) : new Date();

    // If entity has been superseded, it's superseded
    if (entity.supersededBy) {
      return 'superseded';
    }

    // Parse validFrom - defaults to epoch start (always valid)
    const validFrom = entity.validFrom ? new Date(entity.validFrom) : new Date(0);

    // If validFrom is in the future, entity is pending
    if (validFrom > now) {
      return 'pending';
    }

    // If validTo is set and has passed, entity is expired
    if (entity.validTo) {
      const validTo = new Date(entity.validTo);
      if (validTo < now) {
        return 'expired';
      }
    }

    // Default: entity is current
    return 'current';
  }

  async addEdge(relationship) {
    const id = relationship.id || uuidv4();
    const normalizedType = normalizeRelationshipType(relationship.type);
    const normalizedFromName = normalizeEntityName(relationship.from);
    const normalizedToName = normalizeEntityName(relationship.to);

    // Check if edge already exists between these vertices with this (normalized) type
    const existingEdge = await this.findEdge(
      relationship.from,
      relationship.to,
      relationship.type
    );

    if (existingEdge) {
      // Edge already exists - update properties if confidence is higher
      if (relationship.confidence > (existingEdge.confidence || 0)) {
        // Try normalized name first, fall back to exact name
        const updateQuery = `
          g.V().has('normalizedName', fromNormalizedName)
            .outE(edgeLabel)
            .where(inV().has('normalizedName', toNormalizedName))
            .property('confidence', confidence)
            .property('evidence', evidence)
            .property('updatedAt', updatedAt)
        `;
        await this._submit(updateQuery, {
          fromNormalizedName: normalizedFromName,
          toNormalizedName: normalizedToName,
          edgeLabel: normalizedType,
          confidence: relationship.confidence || 1.0,
          evidence: relationship.evidence || '',
          updatedAt: new Date().toISOString(),
        });
      }
      return { id: existingEdge.id, ...relationship, type: normalizedType, updated: true };
    }

    // Try to find vertices by normalized name first, then by exact name
    const query = `
      g.V().has('normalizedName', fromNormalizedName)
        .addE(edgeLabel)
        .to(g.V().has('normalizedName', toNormalizedName))
        .property('id', edgeId)
        .property('confidence', confidence)
        .property('evidence', evidence)
        .property('sourceDocumentId', sourceDocumentId)
        .property('originalFromName', originalFromName)
        .property('originalToName', originalToName)
        .property('originalType', originalType)
        .property('createdAt', createdAt)
    `;

    const bindings = {
      fromNormalizedName: normalizedFromName,
      toNormalizedName: normalizedToName,
      edgeLabel: normalizedType,
      edgeId: id,
      confidence: relationship.confidence || 1.0,
      evidence: relationship.evidence || '',
      sourceDocumentId: relationship.sourceDocumentId || '',
      originalFromName: relationship.from,
      originalToName: relationship.to,
      originalType: relationship.type,
      createdAt: new Date().toISOString(),
    };

    try {
      await this._submit(query, bindings);
      return { id, ...relationship, type: normalizedType };
    } catch (error) {
      // Fallback: try with exact names for legacy vertices without normalizedName
      const fallbackQuery = `
        g.V().has('name', fromName)
          .addE(edgeLabel)
          .to(g.V().has('name', toName))
          .property('id', edgeId)
          .property('confidence', confidence)
          .property('evidence', evidence)
          .property('sourceDocumentId', sourceDocumentId)
          .property('createdAt', createdAt)
      `;

      await this._submit(fallbackQuery, {
        fromName: relationship.from,
        toName: relationship.to,
        edgeLabel: normalizedType,
        edgeId: id,
        confidence: relationship.confidence || 1.0,
        evidence: relationship.evidence || '',
        sourceDocumentId: relationship.sourceDocumentId || '',
        createdAt: new Date().toISOString(),
      });
      return { id, ...relationship, type: normalizedType };
    }
  }

  async findEdge(fromName, toName, edgeType) {
    const normalizedFromName = normalizeEntityName(fromName);
    const normalizedToName = normalizeEntityName(toName);
    const normalizedType = normalizeRelationshipType(edgeType);

    // Try to find by normalized names first
    let query = `
      g.V().has('normalizedName', fromNormalizedName)
        .outE(edgeLabel)
        .where(inV().has('normalizedName', toNormalizedName))
        .valueMap(true)
    `;

    let result = await this._submit(query, {
      fromNormalizedName: normalizedFromName,
      toNormalizedName: normalizedToName,
      edgeLabel: normalizedType,
    });

    // Fallback: try exact names for legacy vertices
    if (result.length === 0) {
      query = `
        g.V().has('name', fromName)
          .outE(edgeLabel)
          .where(inV().has('name', toName))
          .valueMap(true)
      `;
      result = await this._submit(query, {
        fromName,
        toName,
        edgeLabel: normalizedType,
      });
    }

    // Also try with original edge type in case it wasn't normalized
    if (result.length === 0 && edgeType !== normalizedType) {
      query = `
        g.V().has('normalizedName', fromNormalizedName)
          .outE(originalEdgeLabel)
          .where(inV().has('normalizedName', toNormalizedName))
          .valueMap(true)
      `;
      result = await this._submit(query, {
        fromNormalizedName: normalizedFromName,
        toNormalizedName: normalizedToName,
        originalEdgeLabel: edgeType,
      });
    }

    if (result.length === 0) {
      return null;
    }

    // Normalize edge properties (Gremlin returns arrays)
    const edge = result[0];
    return {
      id: edge.id,
      type: normalizedType,
      confidence: Array.isArray(edge.confidence) ? edge.confidence[0] : edge.confidence,
      evidence: Array.isArray(edge.evidence) ? edge.evidence[0] : edge.evidence,
      sourceDocumentId: Array.isArray(edge.sourceDocumentId) ? edge.sourceDocumentId[0] : edge.sourceDocumentId,
    };
  }

  async findVertexByName(name) {
    // Use normalized name for case-insensitive matching
    const normalizedName = normalizeEntityName(name);

    // First try to find by normalizedName property (for newer vertices)
    let query = `g.V().has('normalizedName', normalizedName).valueMap(true)`;
    let result = await this._submit(query, { normalizedName });

    // Fallback: try exact name match for older vertices without normalizedName
    if (result.length === 0) {
      query = `g.V().has('name', name).valueMap(true)`;
      result = await this._submit(query, { name });
    }

    if (result.length === 0) {
      return null;
    }

    return this._normalizeVertex(result[0]);
  }

  async findVertexByNormalizedName(normalizedName) {
    // Direct search by normalized name
    const query = `g.V().has('normalizedName', normalizedName).valueMap(true)`;
    const result = await this._submit(query, { normalizedName });

    if (result.length === 0) {
      return null;
    }

    return this._normalizeVertex(result[0]);
  }

  async upsertVertex(entity) {
    // Check if vertex already exists by normalized name
    const normalizedName = normalizeEntityName(entity.name);
    const existing = await this.findVertexByName(entity.name);

    if (existing) {
      // Update existing vertex if new data has higher confidence or adds new info
      const shouldUpdate =
        (entity.confidence && entity.confidence > (existing.confidence || 0)) ||
        (entity.description && !existing.description) ||
        !existing.normalizedName; // Update if missing normalizedName

      if (shouldUpdate) {
        // Find by either normalizedName or exact name
        let updateQuery = existing.normalizedName
          ? `g.V().has('normalizedName', normalizedName)`
          : `g.V().has('name', existingName)`;
        const bindings = existing.normalizedName
          ? { normalizedName: existing.normalizedName }
          : { existingName: existing.name };

        if (entity.description && !existing.description) {
          updateQuery += `.property('description', description)`;
          bindings.description = entity.description;
        }

        if (entity.confidence && entity.confidence > (existing.confidence || 0)) {
          updateQuery += `.property('confidence', confidence)`;
          bindings.confidence = entity.confidence;
        }

        // Ensure normalizedName is set (for legacy vertices)
        if (!existing.normalizedName) {
          updateQuery += `.property('normalizedName', newNormalizedName)`;
          bindings.newNormalizedName = normalizedName;
        }

        updateQuery += `.property('updatedAt', updatedAt)`;
        bindings.updatedAt = new Date().toISOString();

        await this._submit(updateQuery, bindings);
        return { ...existing, ...entity, updated: true };
      }

      return { ...existing, skipped: true };
    }

    // Create new vertex
    return this.addVertex(entity);
  }

  /**
   * Increment the mention count for an entity and track source document.
   * Used for F3.2.3 - Mention Frequency Tracking.
   *
   * @param {string} entityName - Name of the entity to update
   * @param {string} documentId - ID of the document that mentions this entity
   * @param {number} mentionCountInDoc - Number of times entity is mentioned in the document (default: 1)
   * @returns {Promise<Object>} Update result
   */
  async incrementMentionCount(entityName, documentId, mentionCountInDoc = 1) {
    const normalizedName = normalizeEntityName(entityName);

    // First, get the current vertex to check existing values
    const existing = await this.findVertexByName(entityName);
    if (!existing) {
      return { success: false, error: 'Entity not found' };
    }

    // Parse existing sourceDocumentIds (stored as comma-separated string in Gremlin)
    const existingDocIds = existing.sourceDocumentIds
      ? existing.sourceDocumentIds.split(',').filter(id => id.trim())
      : [];

    // Check if this document already contributed to the mention count
    if (existingDocIds.includes(documentId)) {
      // Document already tracked, skip to avoid double-counting
      return {
        success: true,
        skipped: true,
        entityName,
        documentId,
        currentMentionCount: existing.mentionCount || 1,
      };
    }

    // Add new document to the list
    const updatedDocIds = [...existingDocIds, documentId];
    const newMentionCount = (existing.mentionCount || 1) + mentionCountInDoc;

    // Build update query
    const query = existing.normalizedName
      ? `g.V().has('normalizedName', normalizedName)
          .property('mentionCount', newMentionCount)
          .property('sourceDocumentIds', sourceDocumentIds)
          .property('lastMentionedAt', lastMentionedAt)
          .property('updatedAt', updatedAt)`
      : `g.V().has('name', entityName)
          .property('mentionCount', newMentionCount)
          .property('sourceDocumentIds', sourceDocumentIds)
          .property('lastMentionedAt', lastMentionedAt)
          .property('updatedAt', updatedAt)`;

    const bindings = existing.normalizedName
      ? {
          normalizedName: existing.normalizedName,
          newMentionCount,
          sourceDocumentIds: updatedDocIds.join(','),
          lastMentionedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      : {
          entityName: existing.name,
          newMentionCount,
          sourceDocumentIds: updatedDocIds.join(','),
          lastMentionedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

    await this._submit(query, bindings);

    return {
      success: true,
      entityName,
      documentId,
      previousMentionCount: existing.mentionCount || 1,
      newMentionCount,
      documentCount: updatedDocIds.length,
    };
  }

  /**
   * Get mention statistics for an entity.
   * Returns mention count and list of source documents.
   *
   * @param {string} entityName - Name of the entity
   * @returns {Promise<Object|null>} Mention statistics or null if not found
   */
  async getEntityMentionStats(entityName) {
    const vertex = await this.findVertexByName(entityName);
    if (!vertex) {
      return null;
    }

    // Parse sourceDocumentIds
    const sourceDocumentIds = vertex.sourceDocumentIds
      ? vertex.sourceDocumentIds.split(',').filter(id => id.trim())
      : [];

    return {
      id: vertex.id,
      name: vertex.name,
      type: vertex.type,
      mentionCount: vertex.mentionCount || 1,
      documentCount: sourceDocumentIds.length || 1,
      sourceDocumentIds,
      lastMentionedAt: vertex.lastMentionedAt,
      createdAt: vertex.createdAt,
      updatedAt: vertex.updatedAt,
    };
  }

  /**
   * Get top entities by mention count.
   *
   * @param {number} limit - Maximum number of entities to return
   * @returns {Promise<Array>} Array of entities sorted by mention count (descending)
   */
  async getTopEntitiesByMentionCount(limit = 50) {
    // Gremlin query to get vertices sorted by mentionCount
    const query = `g.V()
      .has('mentionCount')
      .order()
      .by('mentionCount', desc)
      .limit(${limit})
      .valueMap(true)`;

    const results = await this._submit(query);

    return results.map(v => {
      const vertex = this._normalizeVertex(v);
      const sourceDocumentIds = vertex.sourceDocumentIds
        ? vertex.sourceDocumentIds.split(',').filter(id => id.trim())
        : [];

      return {
        id: vertex.id,
        name: vertex.name,
        type: vertex.type,
        mentionCount: vertex.mentionCount || 1,
        documentCount: sourceDocumentIds.length || 1,
        sourceDocumentIds,
        lastMentionedAt: vertex.lastMentionedAt,
      };
    });
  }

  /**
   * Batch update mention counts for multiple entities from a document.
   * More efficient than calling incrementMentionCount for each entity.
   *
   * @param {Array<{name: string, mentionCount: number}>} entities - Entities with their mention counts
   * @param {string} documentId - Source document ID
   * @returns {Promise<Object>} Summary of updates
   */
  async batchUpdateMentionCounts(entities, documentId) {
    const results = {
      updated: 0,
      skipped: 0,
      notFound: 0,
      errors: 0,
      details: [],
    };

    for (const entity of entities) {
      try {
        const result = await this.incrementMentionCount(
          entity.name,
          documentId,
          entity.mentionCount || 1
        );

        if (!result.success) {
          if (result.error === 'Entity not found') {
            results.notFound++;
          } else {
            results.errors++;
          }
        } else if (result.skipped) {
          results.skipped++;
        } else {
          results.updated++;
        }

        results.details.push(result);
      } catch (error) {
        results.errors++;
        results.details.push({
          success: false,
          entityName: entity.name,
          error: error.message,
        });
      }
    }

    return results;
  }

  async findVerticesByType(type, limit = 100) {
    const query = `g.V().hasLabel(type).limit(limit).valueMap(true)`;
    const result = await this._submit(query, { type, limit });
    return result.map((v) => this._normalizeVertex(v));
  }

  /**
   * Find vertices by type with polymorphic expansion (includes subtypes)
   * Feature: F2.1.2 - Type Inheritance / Polymorphic Queries
   *
   * @param {string[]} types - Array of types to match (parent + subtypes)
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results (default: 100)
   * @param {string} options.orderBy - Field to order by (e.g., 'name', 'createdAt')
   * @param {boolean} options.descending - Order descending (default: false)
   * @returns {Promise<Array>} Matching vertices
   */
  async findVerticesByTypesPolymorphic(types, options = {}) {
    const { limit = 100, orderBy, descending = false } = options;

    if (!types || types.length === 0) {
      return [];
    }

    // Use within() predicate for matching multiple types
    let query = `g.V().hasLabel(within(types))`;

    // Add ordering if specified
    if (orderBy) {
      const orderDirection = descending ? 'desc' : 'asc';
      query += `.order().by(coalesce(values('${orderBy}'), constant('')), ${orderDirection})`;
    }

    query += `.limit(limit).valueMap(true)`;

    const result = await this._submit(query, { types, limit });
    return result.map((v) => this._normalizeVertex(v));
  }

  async findRelatedEntities(entityNames, depth = 2) {
    if (!entityNames || entityNames.length === 0) {
      return { entities: [], relationships: [] };
    }

    // Find vertices matching the entity names and traverse outward
    const query = `
      g.V().has('name', within(names))
        .repeat(both().simplePath())
        .times(depth)
        .path()
        .by(valueMap(true))
    `;

    const result = await this._submit(query, {
      names: entityNames,
      depth: depth,
    });

    return this._normalizePathResults(result);
  }

  async findPathBetween(entityName1, entityName2, maxDepth = 4) {
    const query = `
      g.V().has('name', name1)
        .repeat(both().simplePath())
        .until(has('name', name2).or().loops().is(maxDepth))
        .has('name', name2)
        .path()
        .by(valueMap(true))
        .limit(5)
    `;

    const result = await this._submit(query, {
      name1: entityName1,
      name2: entityName2,
      maxDepth: maxDepth,
    });

    return this._normalizePathResults(result);
  }

  async getSubgraph(entityIds, includeRelationships = true) {
    // Get vertices
    const vertexQuery = `g.V().has('id', within(ids)).valueMap(true)`;
    const vertices = await this._submit(vertexQuery, { ids: entityIds });

    const entities = vertices.map((v) => this._normalizeVertex(v));

    if (!includeRelationships) {
      return { entities, relationships: [] };
    }

    // Get edges between these vertices
    const edgeQuery = `
      g.V().has('id', within(ids))
        .bothE()
        .where(otherV().has('id', within(ids)))
        .project('from', 'to', 'type', 'properties')
        .by(outV().values('name'))
        .by(inV().values('name'))
        .by(label())
        .by(valueMap())
    `;

    const edges = await this._submit(edgeQuery, { ids: entityIds });

    const relationships = edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type,
      confidence: e.properties?.confidence?.[0] || 1.0,
      evidence: e.properties?.evidence?.[0] || '',
    }));

    return { entities, relationships };
  }

  async deleteVertexByDocumentId(documentId) {
    const query = `g.V().has('sourceDocumentId', documentId).drop()`;
    await this._submit(query, { documentId });
    return { success: true };
  }

  async deleteEdgesByDocumentId(documentId) {
    const query = `g.E().has('sourceDocumentId', documentId).drop()`;
    await this._submit(query, { documentId });
    return { success: true };
  }

  async getStats() {
    const vertexCountQuery = `g.V().count()`;
    const edgeCountQuery = `g.E().count()`;
    const labelCountQuery = `g.V().label().groupCount()`;

    const [vertexCount, edgeCount, labelCounts] = await Promise.all([
      this._submit(vertexCountQuery),
      this._submit(edgeCountQuery),
      this._submit(labelCountQuery),
    ]);

    const counts = labelCounts[0] || {};

    return {
      totalNodes: vertexCount[0] || 0,
      totalEdges: edgeCount[0] || 0,
      vertexCount: vertexCount[0] || 0,
      edgeCount: edgeCount[0] || 0,
      labelCounts: counts,
      processCount: counts['Process'] || 0,
      taskCount: counts['Task'] || 0,
      roleCount: counts['Role'] || 0,
      systemCount: counts['System'] || 0,
    };
  }

  async getAllEntities(limit = 500) {
    // Get vertices with limit
    const vertexQuery = `g.V().limit(${limit}).valueMap(true)`;
    const vertices = await this._submit(vertexQuery);

    const nodes = vertices.map((v) => {
      const node = this._normalizeVertex(v);
      return {
        id: node.id,
        label: node.name || node.id,
        type: node.type || 'Unknown',
        ...node,
      };
    });

    // Get edges - use a simpler query that works with Cosmos DB Gremlin API
    const edgeQuery = `g.E().limit(${limit * 2}).project('id', 'label', 'outV', 'inV').by(id).by(label).by(outV().id()).by(inV().id())`;
    const edgeResults = await this._submit(edgeQuery);

    const edges = edgeResults.map((e) => ({
      id: e.id,
      source: e.outV,
      target: e.inV,
      label: e.label || 'RELATED_TO',
      type: e.label || 'RELATED_TO',
    }));

    return { nodes, edges };
  }

  _normalizeVertex(rawVertex) {
    // Gremlin returns properties as arrays
    const vertex = {};

    for (const [key, value] of Object.entries(rawVertex)) {
      if (key === 'id') {
        vertex.id = value;
      } else if (key === 'label') {
        vertex.type = value;
      } else if (Array.isArray(value)) {
        vertex[key] = value[0];
      } else {
        vertex[key] = value;
      }
    }

    return vertex;
  }

  /**
   * Get entities modified since a specific timestamp.
   * Used for incremental community detection (F3.1.4).
   *
   * @param {string} sinceTimestamp - ISO timestamp to filter from
   * @param {number} limit - Maximum entities to return
   * @returns {Promise<Object>} Object with new and modified entities
   */
  async getEntitiesModifiedSince(sinceTimestamp, limit = 1000) {
    // Query for vertices created or updated after the timestamp
    const query = `g.V()
      .or(
        has('createdAt', gte(sinceTimestamp)),
        has('updatedAt', gte(sinceTimestamp))
      )
      .limit(${limit})
      .valueMap(true)`;

    try {
      const results = await this._submit(query, { sinceTimestamp });
      const entities = results.map((v) => this._normalizeVertex(v));

      // Separate new vs modified
      const newEntities = entities.filter(e => !e.updatedAt || e.createdAt === e.updatedAt);
      const modifiedEntities = entities.filter(e => e.updatedAt && e.createdAt !== e.updatedAt);

      return {
        newEntities,
        modifiedEntities,
        total: entities.length,
        sinceTimestamp,
      };
    } catch (error) {
      // Fallback for Cosmos DB Gremlin API which may not support gte
      // Return empty result, will trigger full recomputation
      log.warn('Could not query entities by timestamp, falling back', { error: error.message });
      return {
        newEntities: [],
        modifiedEntities: [],
        total: 0,
        sinceTimestamp,
        fallback: true,
      };
    }
  }

  /**
   * Get edges created since a specific timestamp.
   * Used for incremental community detection (F3.1.4).
   *
   * @param {string} sinceTimestamp - ISO timestamp to filter from
   * @param {number} limit - Maximum edges to return
   * @returns {Promise<Object>} Object with new edges
   */
  async getEdgesCreatedSince(sinceTimestamp, limit = 2000) {
    const query = `g.E()
      .has('createdAt', gte(sinceTimestamp))
      .limit(${limit})
      .project('id', 'label', 'outV', 'inV', 'createdAt')
      .by(id)
      .by(label)
      .by(outV().id())
      .by(inV().id())
      .by(values('createdAt'))`;

    try {
      const results = await this._submit(query, { sinceTimestamp });

      const edges = results.map((e) => ({
        id: e.id,
        source: e.outV,
        target: e.inV,
        type: e.label || 'RELATED_TO',
        createdAt: e.createdAt,
      }));

      return {
        newEdges: edges,
        total: edges.length,
        sinceTimestamp,
      };
    } catch (error) {
      log.warn('Could not query edges by timestamp, falling back', { error: error.message });
      return {
        newEdges: [],
        total: 0,
        sinceTimestamp,
        fallback: true,
      };
    }
  }

  /**
   * Get current graph timestamp (most recent modification).
   * Used to track last community detection state.
   *
   * @returns {Promise<string|null>} Most recent timestamp or null
   */
  async getLatestGraphTimestamp() {
    // Get the most recent createdAt or updatedAt from vertices
    const query = `g.V()
      .values('createdAt', 'updatedAt')
      .order()
      .by(desc)
      .limit(1)`;

    try {
      const results = await this._submit(query);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      log.warn('Could not get latest graph timestamp', { error: error.message });
      return null;
    }
  }

  /**
   * Get graph change summary since last timestamp.
   * Provides high-level stats for incremental detection decisions.
   *
   * @param {string} sinceTimestamp - ISO timestamp to compare from
   * @returns {Promise<Object>} Change summary
   */
  async getGraphChangeSummary(sinceTimestamp) {
    try {
      const [entityChanges, edgeChanges, currentStats] = await Promise.all([
        this.getEntitiesModifiedSince(sinceTimestamp, 100),
        this.getEdgesCreatedSince(sinceTimestamp, 200),
        this.getStats(),
      ]);

      const hasChanges = entityChanges.total > 0 || edgeChanges.total > 0;
      const changeRatio = currentStats.totalNodes > 0
        ? (entityChanges.total + edgeChanges.total) / (currentStats.totalNodes + currentStats.totalEdges)
        : 1;

      return {
        hasChanges,
        newEntityCount: entityChanges.newEntities.length,
        modifiedEntityCount: entityChanges.modifiedEntities.length,
        newEdgeCount: edgeChanges.total,
        totalChanges: entityChanges.total + edgeChanges.total,
        changeRatio,
        // Recommend incremental if changes are less than 20% of graph
        recommendIncremental: hasChanges && changeRatio < 0.2,
        currentStats,
        sinceTimestamp,
      };
    } catch (error) {
      log.warn('Could not get graph change summary', { error: error.message });
      return {
        hasChanges: true,
        recommendIncremental: false,
        error: error.message,
      };
    }
  }

  // ============================================================================
  // Temporal Query Methods (F2.3.1 - Temporal Schema Fields)
  // ============================================================================

  /**
   * Find entities that are currently valid (temporal status = 'current').
   * An entity is current if:
   * - It has no supersededBy
   * - Its validFrom is <= now
   * - Its validTo is null OR > now
   *
   * @param {string} [type] - Optional entity type filter
   * @param {number} [limit=100] - Maximum results
   * @returns {Promise<Array>} Array of current entities
   */
  async findCurrentEntities(type = null, limit = 100) {
    let query;
    const bindings = { limit };

    if (type) {
      query = `g.V()
        .hasLabel(type)
        .has('temporalStatus', 'current')
        .limit(limit)
        .valueMap(true)`;
      bindings.type = type;
    } else {
      query = `g.V()
        .has('temporalStatus', 'current')
        .limit(limit)
        .valueMap(true)`;
    }

    const results = await this._submit(query, bindings);
    return results.map((v) => this._normalizeVertex(v));
  }

  /**
   * Find entities that are valid at a specific point in time.
   * Uses validFrom and validTo to determine validity.
   *
   * @param {string} pointInTime - ISO timestamp to query at
   * @param {string} [type] - Optional entity type filter
   * @param {number} [limit=100] - Maximum results
   * @returns {Promise<Array>} Array of entities valid at the given time
   */
  async findEntitiesValidAt(pointInTime, type = null, limit = 100) {
    // Note: Cosmos DB Gremlin API has limited support for date comparisons
    // We'll retrieve candidates and filter in-memory for accuracy
    let query;
    const bindings = { limit };

    if (type) {
      query = `g.V()
        .hasLabel(type)
        .has('validFrom')
        .limit(${limit * 3})
        .valueMap(true)`;
      bindings.type = type;
    } else {
      query = `g.V()
        .has('validFrom')
        .limit(${limit * 3})
        .valueMap(true)`;
    }

    const results = await this._submit(query, bindings);
    const targetTime = new Date(pointInTime);

    // Filter in-memory for precise temporal matching
    const validEntities = results
      .map((v) => this._normalizeVertex(v))
      .filter((entity) => {
        const validFrom = new Date(entity.validFrom);
        if (validFrom > targetTime) return false;

        if (entity.validTo) {
          const validTo = new Date(entity.validTo);
          if (validTo < targetTime) return false;
        }

        return true;
      })
      .slice(0, limit);

    return validEntities;
  }

  /**
   * Get the version history of an entity by name.
   * Follows the supersededBy/supersedes chain to find all versions.
   *
   * @param {string} entityName - Name of the entity
   * @returns {Promise<Array>} Array of entity versions, ordered from oldest to newest
   */
  async getEntityVersionHistory(entityName) {
    const currentEntity = await this.findVertexByName(entityName);
    return this._getEntityVersionHistoryFromEntity(currentEntity);
  }

  /**
   * Get the version history of an entity by ID.
   * Follows the supersededBy/supersedes chain to find all versions.
   *
   * @param {string} entityId - ID of the entity
   * @returns {Promise<Array>} Array of entity versions, ordered from oldest to newest
   */
  async getEntityVersionHistoryById(entityId) {
    const currentEntity = await this.findVertexById(entityId);
    return this._getEntityVersionHistoryFromEntity(currentEntity);
  }

  async _getEntityVersionHistoryFromEntity(entity) {
    if (!entity) {
      return [];
    }

    const versions = [];
    const visited = new Set();

    // First, traverse backward (supersedes) to find the original
    let oldest = entity;
    while (oldest.supersedes && !visited.has(oldest.supersedes)) {
      visited.add(oldest.supersedes);
      const previous = await this.findVertexById(oldest.supersedes);
      if (previous) {
        oldest = previous;
      } else {
        break;
      }
    }

    // Now traverse forward (supersededBy) to collect all versions
    visited.clear();
    let current = oldest;
    while (current && !visited.has(current.id)) {
      versions.push({
        ...current,
        isCurrentVersion: current.temporalStatus === 'current',
      });
      visited.add(current.id);

      if (current.supersededBy) {
        current = await this.findVertexById(current.supersededBy);
      } else {
        current = null;
      }
    }

    return versions;
  }

  /**
   * Find a vertex by its ID.
   *
   * @param {string} id - Vertex ID
   * @returns {Promise<Object|null>} Vertex or null if not found
   */
  async findVertexById(id) {
    const query = `g.V().has('id', id).valueMap(true)`;
    const result = await this._submit(query, { id });

    if (result.length === 0) {
      return null;
    }

    return this._normalizeVertex(result[0]);
  }

  /**
   * Create a new version of an entity, marking the old one as superseded.
   * This preserves the original entity with a SUPERSEDED_BY relationship.
   *
   * @param {string} entityName - Name of entity to version
   * @param {Object} updates - Updated fields for the new version
   * @returns {Promise<Object>} New entity version
   */
  async createEntityVersion(entityName, updates) {
    // Find current version
    const currentVersion = await this.findVertexByName(entityName);
    if (!currentVersion) {
      throw new Error(`Entity not found: ${entityName}`);
    }

    if (currentVersion.temporalStatus === 'superseded') {
      throw new Error(`Entity "${entityName}" is already superseded. Use the current version.`);
    }

    const now = new Date().toISOString();

    // Create new version
    const newVersionData = {
      ...currentVersion,
      ...updates,
      id: null, // Generate new ID
      supersedes: currentVersion.id,
      supersededBy: null,
      validFrom: now,
      validTo: null,
      temporalStatus: 'current',
      versionSequence: (currentVersion.versionSequence || 1) + 1,
      createdAt: now,
      updatedAt: now,
    };

    // Don't copy the old ID
    delete newVersionData.id;

    const newVersion = await this.addVertex(newVersionData);

    // Update old version to mark it as superseded
    const updateQuery = `g.V().has('id', oldId)
      .property('supersededBy', newId)
      .property('temporalStatus', 'superseded')
      .property('validTo', validTo)
      .property('updatedAt', updatedAt)`;

    await this._submit(updateQuery, {
      oldId: currentVersion.id,
      newId: newVersion.id,
      validTo: now,
      updatedAt: now,
    });

    // Create SUPERSEDED_BY edge
    await this.addEdge({
      from: currentVersion.name,
      to: newVersion.name,
      type: 'SUPERSEDED_BY',
      confidence: 1.0,
      evidence: `Version ${newVersionData.versionSequence} created at ${now}`,
    });

    return newVersion;
  }

  /**
   * Get entities by temporal status.
   *
   * @param {string} status - One of: 'current', 'expired', 'pending', 'superseded'
   * @param {number} [limit=100] - Maximum results
   * @returns {Promise<Array>} Array of entities with the given status
   */
  async findEntitiesByTemporalStatus(status, limit = 100) {
    const validStatuses = ['current', 'expired', 'pending', 'superseded'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid temporal status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    const query = `g.V()
      .has('temporalStatus', status)
      .limit(limit)
      .valueMap(true)`;

    const results = await this._submit(query, { status, limit });
    return results.map((v) => this._normalizeVertex(v));
  }

  /**
   * Update an entity's temporal status based on current time.
   * Call this periodically or on-demand to refresh status.
   *
   * @param {string} entityId - Entity ID to update
   * @returns {Promise<Object>} Updated entity with new status
   */
  async refreshTemporalStatus(entityId) {
    const entity = await this.findVertexById(entityId);
    if (!entity) {
      throw new Error(`Entity not found: ${entityId}`);
    }

    const newStatus = this._computeTemporalStatus(entity);

    if (newStatus !== entity.temporalStatus) {
      const updateQuery = `g.V().has('id', id)
        .property('temporalStatus', temporalStatus)
        .property('updatedAt', updatedAt)`;

      await this._submit(updateQuery, {
        id: entityId,
        temporalStatus: newStatus,
        updatedAt: new Date().toISOString(),
      });

      return { ...entity, temporalStatus: newStatus };
    }

    return entity;
  }

  /**
   * Batch refresh temporal status for all entities.
   * Useful for periodic maintenance.
   *
   * @returns {Promise<Object>} Summary of status updates
   */
  async refreshAllTemporalStatuses() {
    const query = `g.V().has('validFrom').valueMap(true)`;
    const results = await this._submit(query);
    const entities = results.map((v) => this._normalizeVertex(v));

    const updates = {
      checked: entities.length,
      updated: 0,
      byStatus: { current: 0, expired: 0, pending: 0, superseded: 0 },
    };

    for (const entity of entities) {
      const newStatus = this._computeTemporalStatus(entity);
      updates.byStatus[newStatus]++;

      if (newStatus !== entity.temporalStatus) {
        await this.refreshTemporalStatus(entity.id);
        updates.updated++;
      }
    }

    return updates;
  }

  // ============================================================================
  // Time-Aware Graph Queries (F2.3.4)
  // ============================================================================

  /**
   * Get a point-in-time snapshot of the graph.
   * Returns entities and relationships that were valid at the specified time.
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * @param {string} pointInTime - ISO timestamp for the snapshot
   * @param {Object} options - Query options
   * @param {string} options.type - Filter by entity type
   * @param {number} options.limit - Maximum entities to return (default: 500)
   * @param {boolean} options.includeRelationships - Include relationships (default: true)
   * @returns {Promise<Object>} Graph snapshot with entities and relationships
   */
  async getGraphSnapshotAt(pointInTime, options = {}) {
    const { type = null, limit = 500, includeRelationships = true } = options;
    const targetTime = new Date(pointInTime);

    // Get all entities with temporal fields
    let query;
    const bindings = { limit: limit * 3 }; // Over-fetch to allow for filtering

    if (type) {
      query = `g.V()
        .hasLabel(type)
        .has('validFrom')
        .limit(${limit * 3})
        .valueMap(true)`;
      bindings.type = type;
    } else {
      query = `g.V()
        .has('validFrom')
        .limit(${limit * 3})
        .valueMap(true)`;
    }

    const results = await this._submit(query, bindings);

    // Filter entities that were valid at the point in time
    const validEntities = results
      .map((v) => this._normalizeVertex(v))
      .filter((entity) => this._isEntityValidAt(entity, targetTime))
      .slice(0, limit);

    const entityIds = validEntities.map(e => e.id);
    const entityNames = new Set(validEntities.map(e => e.name));

    let relationships = [];

    if (includeRelationships && entityIds.length > 0) {
      // Get edges between valid entities
      const edgeQuery = `g.V().has('id', within(ids))
        .bothE()
        .where(otherV().has('id', within(ids)))
        .project('id', 'label', 'outV', 'outVName', 'inV', 'inVName', 'createdAt', 'confidence')
        .by(id)
        .by(label)
        .by(outV().id())
        .by(outV().values('name'))
        .by(inV().id())
        .by(inV().values('name'))
        .by(coalesce(values('createdAt'), constant('')))
        .by(coalesce(values('confidence'), constant(1.0)))
        .dedup()`;

      const edgeResults = await this._submit(edgeQuery, { ids: entityIds });

      // Filter edges that existed at the point in time
      relationships = edgeResults
        .filter((e) => {
          // Edge must have been created before the target time
          if (e.createdAt) {
            const createdAt = new Date(e.createdAt);
            if (createdAt > targetTime) return false;
          }
          // Both endpoints must be in our valid entity set
          return entityNames.has(e.outVName) && entityNames.has(e.inVName);
        })
        .map((e) => ({
          id: e.id,
          from: e.outVName,
          to: e.inVName,
          type: e.label || 'RELATED_TO',
          confidence: e.confidence,
          createdAt: e.createdAt,
        }));

      // Deduplicate edges
      const seenEdges = new Set();
      relationships = relationships.filter((r) => {
        const key = `${r.from}-${r.type}-${r.to}`;
        if (seenEdges.has(key)) return false;
        seenEdges.add(key);
        return true;
      });
    }

    return {
      pointInTime: pointInTime,
      entities: validEntities,
      relationships,
      metadata: {
        entityCount: validEntities.length,
        relationshipCount: relationships.length,
        queryType: type || 'all',
        snapshotTimestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Check if an entity was valid at a specific point in time.
   * @private
   */
  _isEntityValidAt(entity, targetTime) {
    // If validFrom exists, entity must have been created before target time
    if (entity.validFrom) {
      const validFrom = new Date(entity.validFrom);
      if (validFrom > targetTime) return false;
    }

    // If validTo exists, entity must still be valid at target time
    if (entity.validTo) {
      const validTo = new Date(entity.validTo);
      if (validTo < targetTime) return false;
    }

    // For superseded entities, check if they were superseded before target time
    if (entity.supersededBy && entity.validTo) {
      const validTo = new Date(entity.validTo);
      if (validTo < targetTime) return false;
    }

    return true;
  }

  /**
   * Find neighbors of an entity that were valid at a specific point in time.
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * @param {string} entityName - Name of the entity
   * @param {string} pointInTime - ISO timestamp
   * @param {Object} options - Query options
   * @param {number} options.maxNeighbors - Maximum neighbors to return (default: 20)
   * @param {string} options.direction - 'outgoing', 'incoming', or 'both' (default: 'both')
   * @returns {Promise<Array>} Array of valid neighbors with relationship info
   */
  async findNeighborsValidAt(entityName, pointInTime, options = {}) {
    const { maxNeighbors = 20, direction = 'both' } = options;
    const targetTime = new Date(pointInTime);
    const neighbors = [];

    // First check if the source entity itself was valid at the target time
    const sourceEntity = await this.findVertexByName(entityName);
    if (!sourceEntity) {
      return { neighbors: [], error: 'Source entity not found' };
    }

    if (!this._isEntityValidAt(sourceEntity, targetTime)) {
      return {
        neighbors: [],
        sourceEntityValid: false,
        message: `Entity "${entityName}" was not valid at ${pointInTime}`,
      };
    }

    // Get outgoing neighbors
    if (direction === 'outgoing' || direction === 'both') {
      const outQuery = `
        g.V().has('name', name)
          .outE()
          .project('type', 'target', 'createdAt', 'confidence')
          .by(label())
          .by(inV().valueMap(true))
          .by(coalesce(values('createdAt'), constant('')))
          .by(coalesce(values('confidence'), constant(1.0)))
          .limit(${maxNeighbors * 2})
      `;

      const outResults = await this._submit(outQuery, { name: entityName });

      for (const r of outResults) {
        const neighborEntity = this._normalizeVertex(r.target);

        // Check if neighbor was valid at target time
        if (!this._isEntityValidAt(neighborEntity, targetTime)) continue;

        // Check if edge existed at target time
        if (r.createdAt) {
          const edgeCreatedAt = new Date(r.createdAt);
          if (edgeCreatedAt > targetTime) continue;
        }

        neighbors.push({
          entity: neighborEntity,
          relationshipType: r.type,
          direction: 'outgoing',
          confidence: r.confidence,
          edgeCreatedAt: r.createdAt,
        });
      }
    }

    // Get incoming neighbors
    if (direction === 'incoming' || direction === 'both') {
      const inQuery = `
        g.V().has('name', name)
          .inE()
          .project('type', 'source', 'createdAt', 'confidence')
          .by(label())
          .by(outV().valueMap(true))
          .by(coalesce(values('createdAt'), constant('')))
          .by(coalesce(values('confidence'), constant(1.0)))
          .limit(${maxNeighbors * 2})
      `;

      const inResults = await this._submit(inQuery, { name: entityName });

      for (const r of inResults) {
        const neighborEntity = this._normalizeVertex(r.source);

        // Check if neighbor was valid at target time
        if (!this._isEntityValidAt(neighborEntity, targetTime)) continue;

        // Check if edge existed at target time
        if (r.createdAt) {
          const edgeCreatedAt = new Date(r.createdAt);
          if (edgeCreatedAt > targetTime) continue;
        }

        neighbors.push({
          entity: neighborEntity,
          relationshipType: r.type,
          direction: 'incoming',
          confidence: r.confidence,
          edgeCreatedAt: r.createdAt,
        });
      }
    }

    return {
      neighbors: neighbors.slice(0, maxNeighbors),
      sourceEntity,
      sourceEntityValid: true,
      pointInTime,
      totalFound: neighbors.length,
    };
  }

  /**
   * Traverse the graph from seed entities at a specific point in time.
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * @param {Array<string>} seedEntityNames - Names of seed entities
   * @param {string} pointInTime - ISO timestamp
   * @param {Object} options - Traversal options
   * @param {number} options.maxDepth - Maximum traversal depth (default: 2)
   * @param {number} options.maxEntities - Maximum entities to return (default: 50)
   * @returns {Promise<Object>} Subgraph valid at the point in time
   */
  async traverseGraphAt(seedEntityNames, pointInTime, options = {}) {
    const { maxDepth = 2, maxEntities = 50 } = options;
    const targetTime = new Date(pointInTime);

    const visitedEntities = new Map();
    const relationships = [];
    const invalidSeeds = [];

    // Process seed entities
    const entitiesToProcess = [];
    for (const name of seedEntityNames) {
      const entity = await this.findVertexByName(name);
      if (!entity) {
        invalidSeeds.push({ name, error: 'not found' });
        continue;
      }

      if (!this._isEntityValidAt(entity, targetTime)) {
        invalidSeeds.push({
          name,
          error: 'not valid at target time',
          validFrom: entity.validFrom,
          validTo: entity.validTo,
        });
        continue;
      }

      visitedEntities.set(entity.name, { ...entity, depth: 0 });
      entitiesToProcess.push({ entity, depth: 0 });
    }

    // BFS traversal
    while (entitiesToProcess.length > 0 && visitedEntities.size < maxEntities) {
      const { entity: current, depth } = entitiesToProcess.shift();

      if (depth >= maxDepth) continue;

      // Get valid neighbors at this point in time
      const neighborsResult = await this.findNeighborsValidAt(current.name, pointInTime, {
        maxNeighbors: 20,
      });

      for (const neighbor of neighborsResult.neighbors || []) {
        // Add relationship
        const relKey =
          neighbor.direction === 'outgoing'
            ? `${current.name}-${neighbor.relationshipType}-${neighbor.entity.name}`
            : `${neighbor.entity.name}-${neighbor.relationshipType}-${current.name}`;

        if (!relationships.find((r) => `${r.from}-${r.type}-${r.to}` === relKey)) {
          relationships.push({
            from: neighbor.direction === 'outgoing' ? current.name : neighbor.entity.name,
            to: neighbor.direction === 'outgoing' ? neighbor.entity.name : current.name,
            type: neighbor.relationshipType,
            confidence: neighbor.confidence,
          });
        }

        // Queue neighbor for further expansion if not visited
        if (!visitedEntities.has(neighbor.entity.name)) {
          visitedEntities.set(neighbor.entity.name, {
            ...neighbor.entity,
            depth: depth + 1,
          });

          if (depth + 1 < maxDepth && visitedEntities.size < maxEntities) {
            entitiesToProcess.push({
              entity: neighbor.entity,
              depth: depth + 1,
            });
          }
        }
      }
    }

    return {
      pointInTime,
      entities: Array.from(visitedEntities.values()),
      relationships,
      metadata: {
        seedEntities: seedEntityNames,
        invalidSeeds,
        entityCount: visitedEntities.size,
        relationshipCount: relationships.length,
        maxDepthReached: maxDepth,
        maxEntitiesReached: visitedEntities.size >= maxEntities,
        queryTimestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Compare graph state between two points in time.
   * Feature: F2.3.4 - Time-Aware Graph Queries
   *
   * @param {string} time1 - First point in time (ISO timestamp)
   * @param {string} time2 - Second point in time (ISO timestamp)
   * @param {Object} options - Comparison options
   * @param {string} options.type - Filter by entity type
   * @param {number} options.limit - Maximum entities per snapshot (default: 100)
   * @returns {Promise<Object>} Comparison showing added, removed, and changed entities
   */
  async compareGraphStates(time1, time2, options = {}) {
    const { type = null, limit = 100 } = options;

    // Get snapshots at both times
    const [snapshot1, snapshot2] = await Promise.all([
      this.getGraphSnapshotAt(time1, { type, limit, includeRelationships: false }),
      this.getGraphSnapshotAt(time2, { type, limit, includeRelationships: false }),
    ]);

    const entitiesAt1 = new Map(snapshot1.entities.map((e) => [e.id, e]));
    const entitiesAt2 = new Map(snapshot2.entities.map((e) => [e.id, e]));

    // Find added entities (in time2 but not time1)
    const added = [];
    for (const [id, entity] of entitiesAt2) {
      if (!entitiesAt1.has(id)) {
        added.push(entity);
      }
    }

    // Find removed entities (in time1 but not time2)
    const removed = [];
    for (const [id, entity] of entitiesAt1) {
      if (!entitiesAt2.has(id)) {
        removed.push(entity);
      }
    }

    // Find entities that existed at both times but may have changed
    const persisted = [];
    for (const [id, entity1] of entitiesAt1) {
      if (entitiesAt2.has(id)) {
        const entity2 = entitiesAt2.get(id);
        persisted.push({
          id,
          name: entity1.name,
          type: entity1.type,
          atTime1: entity1,
          atTime2: entity2,
        });
      }
    }

    return {
      time1,
      time2,
      comparison: {
        added: added.length,
        removed: removed.length,
        persisted: persisted.length,
      },
      addedEntities: added,
      removedEntities: removed,
      persistedEntities: persisted,
      metadata: {
        type,
        entitiesAtTime1: snapshot1.entities.length,
        entitiesAtTime2: snapshot2.entities.length,
        comparisonTimestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get temporal statistics for the graph.
   *
   * @returns {Promise<Object>} Statistics about entity temporal status
   */
  async getTemporalStats() {
    const statusQuery = `g.V()
      .has('temporalStatus')
      .values('temporalStatus')
      .groupCount()`;

    const versionQuery = `g.V()
      .has('versionSequence')
      .values('versionSequence')
      .max()`;

    const supersededCountQuery = `g.V()
      .has('supersededBy')
      .count()`;

    try {
      const [statusCounts, maxVersion, supersededCount] = await Promise.all([
        this._submit(statusQuery),
        this._submit(versionQuery),
        this._submit(supersededCountQuery),
      ]);

      return {
        statusCounts: statusCounts[0] || {},
        maxVersionSequence: maxVersion[0] || 1,
        supersededEntityCount: supersededCount[0] || 0,
        temporalFieldsEnabled: true,
      };
    } catch (error) {
      return {
        statusCounts: {},
        maxVersionSequence: 1,
        supersededEntityCount: 0,
        temporalFieldsEnabled: false,
        error: error.message,
      };
    }
  }

  _normalizePathResults(paths) {
    const entitiesMap = new Map();
    const relationshipsSet = new Set();
    const relationships = [];

    for (const path of paths) {
      if (!path.objects) continue;

      let prevEntity = null;

      for (const obj of path.objects) {
        if (obj.id && obj.label) {
          // This is a vertex
          const entity = this._normalizeVertex(obj);
          entitiesMap.set(entity.id, entity);

          if (prevEntity) {
            // Create a relationship between consecutive vertices
            const relKey = `${prevEntity.name}-${entity.name}`;
            if (!relationshipsSet.has(relKey)) {
              relationshipsSet.add(relKey);
              relationships.push({
                from: prevEntity.name,
                to: entity.name,
                type: 'RELATED_TO', // Generic relationship for path traversal
              });
            }
          }

          prevEntity = entity;
        }
      }
    }

    return {
      entities: Array.from(entitiesMap.values()),
      relationships,
    };
  }
}

// Singleton instance
let instance = null;

function getGraphService() {
  if (!instance) {
    instance = new GraphService();
  }
  return instance;
}

module.exports = {
  GraphService,
  getGraphService,
  normalizeEntityName,
  normalizeRelationshipType,
};
