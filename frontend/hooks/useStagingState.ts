'use client';

import { useCallback } from 'react';
import { useAuthFetch, API_BASE_URL } from '@/lib/api';
import {
  useStagingStore,
  StagedEntity,
  StagedRelationship,
  StagingSession,
} from '@/lib/staging-store';

export interface StagingPreview {
  entities: {
    added: StagedEntity[];
    modified: StagedEntity[];
    deleted: StagedEntity[];
    unchanged: StagedEntity[];
  };
  relationships: {
    added: StagedRelationship[];
    modified: StagedRelationship[];
    deleted: StagedRelationship[];
    unchanged: StagedRelationship[];
  };
  summary: {
    totalChanges: number;
    entitiesAdded: number;
    entitiesModified: number;
    entitiesDeleted: number;
    relationshipsAdded: number;
    relationshipsModified: number;
    relationshipsDeleted: number;
  };
}

export function useStagingState() {
  const authFetch = useAuthFetch();
  const store = useStagingStore();

  /**
   * Create or get existing staging session for a document
   */
  const initSession = useCallback(
    async (documentId: string): Promise<StagingSession | null> => {
      store.setLoading(true);
      store.setError(null);

      try {
        // First try to get existing session
        const existingResponse = await authFetch(
          `${API_BASE_URL}/api/staging/sessions/document/${documentId}`
        );

        if (existingResponse.ok) {
          const session = await existingResponse.json();
          store.setSession(session);
          return session;
        }

        // No existing session, create a new one
        const response = await authFetch(`${API_BASE_URL}/api/staging/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create staging session');
        }

        const session = await response.json();
        store.setSession(session);
        return session;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to initialize staging';
        store.setError(message);
        return null;
      } finally {
        store.setLoading(false);
      }
    },
    [authFetch, store]
  );

  /**
   * Sync entity modification with backend
   */
  const syncEntityUpdate = useCallback(
    async (entityId: string, updates: Partial<StagedEntity>) => {
      if (!store.sessionId || !store.documentId) return;

      try {
        const response = await authFetch(
          `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/entities/${entityId}?documentId=${store.documentId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          }
        );

        if (!response.ok) {
          console.warn('Failed to sync entity update');
        }
      } catch (error) {
        console.warn('Failed to sync entity update:', error);
      }
    },
    [authFetch, store.sessionId, store.documentId]
  );

  /**
   * Sync entity deletion with backend
   */
  const syncEntityDelete = useCallback(
    async (entityId: string) => {
      if (!store.sessionId || !store.documentId) return;

      try {
        const response = await authFetch(
          `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/entities/${entityId}?documentId=${store.documentId}`,
          {
            method: 'DELETE',
          }
        );

        if (!response.ok) {
          console.warn('Failed to sync entity deletion');
        }
      } catch (error) {
        console.warn('Failed to sync entity deletion:', error);
      }
    },
    [authFetch, store.sessionId, store.documentId]
  );

  /**
   * Sync new entity with backend
   */
  const syncEntityAdd = useCallback(
    async (entityData: Omit<StagedEntity, 'id' | 'stagedId' | 'status'>) => {
      if (!store.sessionId || !store.documentId) return;

      try {
        const response = await authFetch(
          `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/entities?documentId=${store.documentId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entityData),
          }
        );

        if (!response.ok) {
          console.warn('Failed to sync entity add');
        }
      } catch (error) {
        console.warn('Failed to sync entity add:', error);
      }
    },
    [authFetch, store.sessionId, store.documentId]
  );

  /**
   * Sync relationship modification with backend
   */
  const syncRelationshipUpdate = useCallback(
    async (relationshipId: string, updates: Partial<StagedRelationship>) => {
      if (!store.sessionId || !store.documentId) return;

      try {
        const response = await authFetch(
          `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/relationships/${relationshipId}?documentId=${store.documentId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
          }
        );

        if (!response.ok) {
          console.warn('Failed to sync relationship update');
        }
      } catch (error) {
        console.warn('Failed to sync relationship update:', error);
      }
    },
    [authFetch, store.sessionId, store.documentId]
  );

  /**
   * Sync relationship deletion with backend
   */
  const syncRelationshipDelete = useCallback(
    async (relationshipId: string) => {
      if (!store.sessionId || !store.documentId) return;

      try {
        const response = await authFetch(
          `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/relationships/${relationshipId}?documentId=${store.documentId}`,
          {
            method: 'DELETE',
          }
        );

        if (!response.ok) {
          console.warn('Failed to sync relationship deletion');
        }
      } catch (error) {
        console.warn('Failed to sync relationship deletion:', error);
      }
    },
    [authFetch, store.sessionId, store.documentId]
  );

  /**
   * Sync new relationship with backend
   */
  const syncRelationshipAdd = useCallback(
    async (relationshipData: Omit<StagedRelationship, 'id' | 'stagedId' | 'status'>) => {
      if (!store.sessionId || !store.documentId) return;

      try {
        const response = await authFetch(
          `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/relationships?documentId=${store.documentId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(relationshipData),
          }
        );

        if (!response.ok) {
          console.warn('Failed to sync relationship add');
        }
      } catch (error) {
        console.warn('Failed to sync relationship add:', error);
      }
    },
    [authFetch, store.sessionId, store.documentId]
  );

  /**
   * Sync entity position with backend (debounced externally)
   */
  const syncEntityPosition = useCallback(
    async (entityId: string, position: { x: number; y: number }) => {
      if (!store.sessionId || !store.documentId) return;

      try {
        await authFetch(
          `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/entities/${entityId}/position?documentId=${store.documentId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position }),
          }
        );
      } catch (error) {
        // Position sync is non-critical, ignore errors
      }
    },
    [authFetch, store.sessionId, store.documentId]
  );

  /**
   * Get preview of changes before commit
   */
  const getPreview = useCallback(async (): Promise<StagingPreview | null> => {
    if (!store.sessionId || !store.documentId) return null;

    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/preview?documentId=${store.documentId}`
      );

      if (!response.ok) {
        throw new Error('Failed to get preview');
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get preview:', error);
      return null;
    }
  }, [authFetch, store.sessionId, store.documentId]);

  /**
   * Commit all changes to the production graph
   */
  const commitChanges = useCallback(async (): Promise<boolean> => {
    if (!store.sessionId || !store.documentId) return false;

    store.setLoading(true);
    store.setError(null);

    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/staging/sessions/${store.sessionId}/commit?documentId=${store.documentId}`,
        {
          method: 'POST',
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to commit changes');
      }

      store.reset();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to commit changes';
      store.setError(message);
      return false;
    } finally {
      store.setLoading(false);
    }
  }, [authFetch, store]);

  /**
   * Discard all changes and delete the session
   */
  const discardSession = useCallback(async (): Promise<boolean> => {
    if (!store.sessionId || !store.documentId) return false;

    store.setLoading(true);
    store.setError(null);

    try {
      const response = await authFetch(
        `${API_BASE_URL}/api/staging/sessions/${store.sessionId}?documentId=${store.documentId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to discard session');
      }

      store.reset();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to discard session';
      store.setError(message);
      return false;
    } finally {
      store.setLoading(false);
    }
  }, [authFetch, store]);

  // Wrapper functions that update local state and sync with backend
  const updateEntity = useCallback(
    (entityId: string, updates: Partial<StagedEntity>) => {
      store.updateEntity(entityId, updates);
      syncEntityUpdate(entityId, updates);
    },
    [store, syncEntityUpdate]
  );

  const deleteEntity = useCallback(
    (entityId: string) => {
      store.markEntityDeleted(entityId);
      syncEntityDelete(entityId);
    },
    [store, syncEntityDelete]
  );

  const addEntity = useCallback(
    (entityData: Omit<StagedEntity, 'id' | 'stagedId' | 'status'>) => {
      store.addEntity(entityData);
      syncEntityAdd(entityData);
    },
    [store, syncEntityAdd]
  );

  const updateRelationship = useCallback(
    (relationshipId: string, updates: Partial<StagedRelationship>) => {
      store.updateRelationship(relationshipId, updates);
      syncRelationshipUpdate(relationshipId, updates);
    },
    [store, syncRelationshipUpdate]
  );

  const deleteRelationship = useCallback(
    (relationshipId: string) => {
      store.markRelationshipDeleted(relationshipId);
      syncRelationshipDelete(relationshipId);
    },
    [store, syncRelationshipDelete]
  );

  const addRelationship = useCallback(
    (relationshipData: Omit<StagedRelationship, 'id' | 'stagedId' | 'status'>) => {
      store.addRelationship(relationshipData);
      syncRelationshipAdd(relationshipData);
    },
    [store, syncRelationshipAdd]
  );

  const updateEntityPosition = useCallback(
    (entityId: string, position: { x: number; y: number }) => {
      store.updateEntityPosition(entityId, position);
      // Note: Position sync is typically debounced by the caller
    },
    [store]
  );

  return {
    // State
    session: store.session,
    sessionId: store.sessionId,
    documentId: store.documentId,
    isLoading: store.isLoading,
    error: store.error,
    hasChanges: store.hasChanges,

    // Selection
    selectedEntityId: store.selectedEntityId,
    selectedRelationshipId: store.selectedRelationshipId,
    selectEntity: store.selectEntity,
    selectRelationship: store.selectRelationship,

    // Session operations
    initSession,
    commitChanges,
    discardSession,
    getPreview,

    // Entity operations
    updateEntity,
    deleteEntity,
    addEntity,

    // Relationship operations
    updateRelationship,
    deleteRelationship,
    addRelationship,

    // Position
    updateEntityPosition,
    syncEntityPosition,

    // Undo/Redo
    undo: store.undo,
    redo: store.redo,
    canUndo: store.canUndo,
    canRedo: store.canRedo,

    // Reset
    reset: store.reset,
  };
}
