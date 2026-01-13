const { createGremlinClient, closeGremlinClient } = require('../clients');
const { v4: uuidv4 } = require('uuid');

class GraphService {
  constructor() {
    this.client = null;
  }

  async _getClient() {
    if (!this.client) {
      this.client = await createGremlinClient();
    }
    return this.client;
  }

  async close() {
    await closeGremlinClient();
    this.client = null;
  }

  async _submit(query, bindings = {}) {
    const client = await this._getClient();

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
  }

  async addVertex(entity) {
    const id = entity.id || uuidv4();
    const category = entity.type || 'Unknown';

    // Build the Gremlin query dynamically based on entity properties
    let query = `g.addV(label).property('id', id).property('pk', category)`;
    const bindings = {
      label: entity.type,
      id: id,
      category: category,
    };

    // Add standard properties
    if (entity.name) {
      query += `.property('name', name)`;
      bindings.name = entity.name;
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
    query += `.property('createdAt', createdAt)`;
    bindings.createdAt = new Date().toISOString();

    const result = await this._submit(query, bindings);
    return { id, ...entity };
  }

  async addEdge(relationship) {
    const id = relationship.id || uuidv4();

    const query = `
      g.V().has('name', fromName)
        .addE(edgeLabel)
        .to(g.V().has('name', toName))
        .property('id', edgeId)
        .property('confidence', confidence)
        .property('evidence', evidence)
        .property('sourceDocumentId', sourceDocumentId)
        .property('createdAt', createdAt)
    `;

    const bindings = {
      fromName: relationship.from,
      toName: relationship.to,
      edgeLabel: relationship.type,
      edgeId: id,
      confidence: relationship.confidence || 1.0,
      evidence: relationship.evidence || '',
      sourceDocumentId: relationship.sourceDocumentId || '',
      createdAt: new Date().toISOString(),
    };

    await this._submit(query, bindings);
    return { id, ...relationship };
  }

  async findVertexByName(name) {
    const query = `g.V().has('name', name).valueMap(true)`;
    const result = await this._submit(query, { name });

    if (result.length === 0) {
      return null;
    }

    return this._normalizeVertex(result[0]);
  }

  async findVerticesByType(type, limit = 100) {
    const query = `g.V().hasLabel(type).limit(limit).valueMap(true)`;
    const result = await this._submit(query, { type, limit });
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

    return {
      vertexCount: vertexCount[0] || 0,
      edgeCount: edgeCount[0] || 0,
      labelCounts: labelCounts[0] || {},
    };
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
};
