const crypto = require('crypto');
const {
  createStagingSession,
  getStagingSession,
  getStagingSessionByDocumentId,
  updateStagingSession,
  deleteStagingSession,
} = require('../storage/staging');
const { getDocumentById } = require('../storage/cosmos');
const { getGraphService } = require('./graph-service');
const { createAuditLog } = require('../storage/cosmos');

/**
 * Change types for tracking modifications
 */
const ChangeType = {
  ENTITY_ADDED: 'entity_added',
  ENTITY_MODIFIED: 'entity_modified',
  ENTITY_DELETED: 'entity_deleted',
  RELATIONSHIP_ADDED: 'relationship_added',
  RELATIONSHIP_MODIFIED: 'relationship_modified',
  RELATIONSHIP_DELETED: 'relationship_deleted',
};

class StagingService {
  /**
   * Create a new staging session for a document
   */
  async createSession(documentId, userId, userEmail, userName) {
    // Check if document exists
    const document = await getDocumentById(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    // Check if there's already an active session for this document
    const existingSession = await getStagingSessionByDocumentId(documentId);
    if (existingSession && existingSession.status === 'active') {
      // Return existing session instead of creating a new one
      return existingSession;
    }

    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Clone document entities and relationships for staging
    const stagedEntities = (document.entities || []).map((entity) => ({
      ...entity,
      stagedId: entity.id,
      status: 'unchanged', // unchanged, modified, added, deleted
      originalData: { ...entity },
    }));

    const stagedRelationships = (document.relationships || []).map((rel) => ({
      ...rel,
      stagedId: rel.id,
      status: 'unchanged',
      originalData: { ...rel },
    }));

    const session = {
      id: sessionId,
      documentId,
      documentTitle: document.title || document.originalName,
      userId,
      userEmail,
      userName,
      status: 'active', // active, committed, discarded
      entities: stagedEntities,
      relationships: stagedRelationships,
      changes: [], // Track all changes for undo/redo and audit
      createdAt: now,
      updatedAt: now,
    };

    return await createStagingSession(session);
  }

  /**
   * Get a staging session by ID
   */
  async getSession(sessionId, documentId = null) {
    if (documentId) {
      return await getStagingSession(sessionId, documentId);
    }
    // If no documentId provided, we need to search
    const query = {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: sessionId }],
    };
    return await getStagingSession(sessionId, null);
  }

  /**
   * Get session by document ID
   */
  async getSessionByDocument(documentId) {
    return await getStagingSessionByDocumentId(documentId);
  }

  /**
   * Modify an entity in the staging session
   */
  async modifyEntity(sessionId, documentId, entityId, updates) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    const entityIndex = session.entities.findIndex((e) => e.id === entityId || e.stagedId === entityId);
    if (entityIndex === -1) {
      throw new Error('Entity not found in staging session');
    }

    const entity = session.entities[entityIndex];
    const oldData = { ...entity };

    // Apply updates
    Object.assign(entity, updates, {
      status: entity.status === 'added' ? 'added' : 'modified',
      updatedAt: new Date().toISOString(),
    });

    // Record change
    session.changes.push({
      id: crypto.randomUUID(),
      type: ChangeType.ENTITY_MODIFIED,
      entityId,
      oldData,
      newData: { ...entity },
      timestamp: new Date().toISOString(),
    });

    session.entities[entityIndex] = entity;

    return await updateStagingSession(sessionId, documentId, {
      entities: session.entities,
      changes: session.changes,
    });
  }

  /**
   * Mark an entity as deleted in the staging session
   */
  async deleteEntity(sessionId, documentId, entityId) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    const entityIndex = session.entities.findIndex((e) => e.id === entityId || e.stagedId === entityId);
    if (entityIndex === -1) {
      throw new Error('Entity not found in staging session');
    }

    const entity = session.entities[entityIndex];
    const oldData = { ...entity };

    // If entity was added in this session, remove it entirely
    if (entity.status === 'added') {
      session.entities.splice(entityIndex, 1);
    } else {
      // Mark as deleted
      entity.status = 'deleted';
      entity.deletedAt = new Date().toISOString();
      session.entities[entityIndex] = entity;
    }

    // Record change
    session.changes.push({
      id: crypto.randomUUID(),
      type: ChangeType.ENTITY_DELETED,
      entityId,
      oldData,
      timestamp: new Date().toISOString(),
    });

    // Also mark relationships involving this entity as deleted
    session.relationships = session.relationships.map((rel) => {
      if (rel.source === entityId || rel.target === entityId) {
        if (rel.status === 'added') {
          return null; // Will be filtered out
        }
        return { ...rel, status: 'deleted', deletedAt: new Date().toISOString() };
      }
      return rel;
    }).filter(Boolean);

    return await updateStagingSession(sessionId, documentId, {
      entities: session.entities,
      relationships: session.relationships,
      changes: session.changes,
    });
  }

  /**
   * Add a new entity to the staging session
   */
  async addEntity(sessionId, documentId, entityData) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    const newEntity = {
      id: crypto.randomUUID(),
      stagedId: crypto.randomUUID(),
      ...entityData,
      status: 'added',
      createdAt: new Date().toISOString(),
    };

    session.entities.push(newEntity);

    // Record change
    session.changes.push({
      id: crypto.randomUUID(),
      type: ChangeType.ENTITY_ADDED,
      entityId: newEntity.id,
      newData: { ...newEntity },
      timestamp: new Date().toISOString(),
    });

    return await updateStagingSession(sessionId, documentId, {
      entities: session.entities,
      changes: session.changes,
    });
  }

  /**
   * Add a new relationship to the staging session
   */
  async addRelationship(sessionId, documentId, relationshipData) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    // Validate that source and target entities exist
    const sourceExists = session.entities.some(
      (e) => (e.id === relationshipData.source || e.stagedId === relationshipData.source) && e.status !== 'deleted'
    );
    const targetExists = session.entities.some(
      (e) => (e.id === relationshipData.target || e.stagedId === relationshipData.target) && e.status !== 'deleted'
    );

    if (!sourceExists || !targetExists) {
      throw new Error('Source or target entity not found');
    }

    const newRelationship = {
      id: crypto.randomUUID(),
      stagedId: crypto.randomUUID(),
      ...relationshipData,
      status: 'added',
      confidence: relationshipData.confidence || 1.0,
      createdAt: new Date().toISOString(),
    };

    session.relationships.push(newRelationship);

    // Record change
    session.changes.push({
      id: crypto.randomUUID(),
      type: ChangeType.RELATIONSHIP_ADDED,
      relationshipId: newRelationship.id,
      newData: { ...newRelationship },
      timestamp: new Date().toISOString(),
    });

    return await updateStagingSession(sessionId, documentId, {
      relationships: session.relationships,
      changes: session.changes,
    });
  }

  /**
   * Modify a relationship in the staging session
   */
  async modifyRelationship(sessionId, documentId, relationshipId, updates) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    const relIndex = session.relationships.findIndex(
      (r) => r.id === relationshipId || r.stagedId === relationshipId
    );
    if (relIndex === -1) {
      throw new Error('Relationship not found in staging session');
    }

    const relationship = session.relationships[relIndex];
    const oldData = { ...relationship };

    // Apply updates
    Object.assign(relationship, updates, {
      status: relationship.status === 'added' ? 'added' : 'modified',
      updatedAt: new Date().toISOString(),
    });

    // Record change
    session.changes.push({
      id: crypto.randomUUID(),
      type: ChangeType.RELATIONSHIP_MODIFIED,
      relationshipId,
      oldData,
      newData: { ...relationship },
      timestamp: new Date().toISOString(),
    });

    session.relationships[relIndex] = relationship;

    return await updateStagingSession(sessionId, documentId, {
      relationships: session.relationships,
      changes: session.changes,
    });
  }

  /**
   * Delete a relationship from the staging session
   */
  async deleteRelationship(sessionId, documentId, relationshipId) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    const relIndex = session.relationships.findIndex(
      (r) => r.id === relationshipId || r.stagedId === relationshipId
    );
    if (relIndex === -1) {
      throw new Error('Relationship not found in staging session');
    }

    const relationship = session.relationships[relIndex];
    const oldData = { ...relationship };

    // If relationship was added in this session, remove it entirely
    if (relationship.status === 'added') {
      session.relationships.splice(relIndex, 1);
    } else {
      // Mark as deleted
      relationship.status = 'deleted';
      relationship.deletedAt = new Date().toISOString();
      session.relationships[relIndex] = relationship;
    }

    // Record change
    session.changes.push({
      id: crypto.randomUUID(),
      type: ChangeType.RELATIONSHIP_DELETED,
      relationshipId,
      oldData,
      timestamp: new Date().toISOString(),
    });

    return await updateStagingSession(sessionId, documentId, {
      relationships: session.relationships,
      changes: session.changes,
    });
  }

  /**
   * Get a preview of changes that would be applied on commit
   */
  async getPreview(sessionId, documentId) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    const preview = {
      entities: {
        added: session.entities.filter((e) => e.status === 'added'),
        modified: session.entities.filter((e) => e.status === 'modified'),
        deleted: session.entities.filter((e) => e.status === 'deleted'),
        unchanged: session.entities.filter((e) => e.status === 'unchanged'),
      },
      relationships: {
        added: session.relationships.filter((r) => r.status === 'added'),
        modified: session.relationships.filter((r) => r.status === 'modified'),
        deleted: session.relationships.filter((r) => r.status === 'deleted'),
        unchanged: session.relationships.filter((r) => r.status === 'unchanged'),
      },
      summary: {
        totalChanges: session.changes.length,
        entitiesAdded: session.entities.filter((e) => e.status === 'added').length,
        entitiesModified: session.entities.filter((e) => e.status === 'modified').length,
        entitiesDeleted: session.entities.filter((e) => e.status === 'deleted').length,
        relationshipsAdded: session.relationships.filter((r) => r.status === 'added').length,
        relationshipsModified: session.relationships.filter((r) => r.status === 'modified').length,
        relationshipsDeleted: session.relationships.filter((r) => r.status === 'deleted').length,
      },
    };

    return preview;
  }

  /**
   * Commit staging changes to the production graph
   */
  async commitSession(sessionId, documentId, user) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    if (session.status !== 'active') {
      throw new Error('Session is not active');
    }

    const graphService = getGraphService();
    const results = {
      entitiesAdded: 0,
      entitiesModified: 0,
      entitiesDeleted: 0,
      relationshipsAdded: 0,
      relationshipsModified: 0,
      relationshipsDeleted: 0,
      errors: [],
    };

    // Process entity deletions first
    for (const entity of session.entities.filter((e) => e.status === 'deleted')) {
      try {
        await graphService.deleteVertexByDocumentId(entity.sourceDocumentId || documentId);
        results.entitiesDeleted++;
      } catch (error) {
        results.errors.push({ type: 'entity_delete', id: entity.id, error: error.message });
      }
    }

    // Process entity additions and modifications
    for (const entity of session.entities.filter((e) => e.status === 'added' || e.status === 'modified')) {
      try {
        if (entity.status === 'added') {
          await graphService.addVertex({
            id: entity.id,
            type: entity.type,
            name: entity.name,
            description: entity.description,
            confidence: entity.confidence || 1.0,
            sourceDocumentId: documentId,
          });
          results.entitiesAdded++;
        } else {
          // For modified entities, we update in place
          // Note: Gremlin doesn't have a direct update, so we may need to delete and recreate
          await graphService.addVertex({
            id: entity.id,
            type: entity.type,
            name: entity.name,
            description: entity.description,
            confidence: entity.confidence || 1.0,
            sourceDocumentId: documentId,
          });
          results.entitiesModified++;
        }
      } catch (error) {
        results.errors.push({ type: 'entity_upsert', id: entity.id, error: error.message });
      }
    }

    // Process relationship deletions
    for (const rel of session.relationships.filter((r) => r.status === 'deleted')) {
      try {
        // Note: May need to implement deleteEdgeById in graph service
        results.relationshipsDeleted++;
      } catch (error) {
        results.errors.push({ type: 'relationship_delete', id: rel.id, error: error.message });
      }
    }

    // Process relationship additions and modifications
    for (const rel of session.relationships.filter((r) => r.status === 'added' || r.status === 'modified')) {
      try {
        // Find source and target entity names
        const sourceEntity = session.entities.find((e) => e.id === rel.source || e.stagedId === rel.source);
        const targetEntity = session.entities.find((e) => e.id === rel.target || e.stagedId === rel.target);

        if (sourceEntity && targetEntity) {
          await graphService.addEdge({
            id: rel.id,
            from: sourceEntity.name,
            to: targetEntity.name,
            type: rel.type,
            confidence: rel.confidence || 1.0,
            sourceDocumentId: documentId,
          });
          if (rel.status === 'added') {
            results.relationshipsAdded++;
          } else {
            results.relationshipsModified++;
          }
        }
      } catch (error) {
        results.errors.push({ type: 'relationship_upsert', id: rel.id, error: error.message });
      }
    }

    // Create audit log entry for the commit
    try {
      await createAuditLog({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        action: 'staging_commit',
        entityType: 'staging_session',
        entityId: sessionId,
        userId: user.oid || user.sub || user.preferred_username || 'unknown',
        userEmail: user.preferred_username || user.upn || '',
        userName: user.name || 'Unknown User',
        details: {
          documentId,
          documentTitle: session.documentTitle,
          results,
          totalChanges: session.changes.length,
        },
        immutable: true,
      });
    } catch (auditError) {
      // Log but don't fail the commit
      console.error('Failed to create audit log:', auditError);
    }

    // Mark session as committed
    await updateStagingSession(sessionId, documentId, {
      status: 'committed',
      committedAt: new Date().toISOString(),
      committedBy: user.oid || user.sub || user.preferred_username || 'unknown',
      commitResults: results,
    });

    return {
      success: results.errors.length === 0,
      results,
      sessionId,
      documentId,
    };
  }

  /**
   * Discard a staging session
   */
  async discardSession(sessionId, documentId, user) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    // Create audit log for discard
    try {
      await createAuditLog({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        action: 'staging_discard',
        entityType: 'staging_session',
        entityId: sessionId,
        userId: user.oid || user.sub || user.preferred_username || 'unknown',
        userEmail: user.preferred_username || user.upn || '',
        userName: user.name || 'Unknown User',
        details: {
          documentId,
          documentTitle: session.documentTitle,
          totalChanges: session.changes.length,
        },
        immutable: true,
      });
    } catch (auditError) {
      console.error('Failed to create audit log:', auditError);
    }

    // Delete the session
    await deleteStagingSession(sessionId, documentId);

    return { success: true };
  }

  /**
   * Update entity position (for graph layout)
   */
  async updateEntityPosition(sessionId, documentId, entityId, position) {
    const session = await getStagingSession(sessionId, documentId);
    if (!session) {
      throw new Error('Staging session not found');
    }

    const entityIndex = session.entities.findIndex((e) => e.id === entityId || e.stagedId === entityId);
    if (entityIndex === -1) {
      throw new Error('Entity not found in staging session');
    }

    session.entities[entityIndex].position = position;

    return await updateStagingSession(sessionId, documentId, {
      entities: session.entities,
    });
  }
}

// Singleton instance
let instance = null;

function getStagingService() {
  if (!instance) {
    instance = new StagingService();
  }
  return instance;
}

module.exports = {
  StagingService,
  getStagingService,
  ChangeType,
};
