import { create } from 'zustand';

export type EntityType =
  | 'Process'
  | 'Task'
  | 'Role'
  | 'System'
  | 'DataAsset'
  | 'Form'
  | 'Policy'
  | 'Procedure'
  | 'Directive'
  | 'Guide';

export type RelationshipType =
  | 'PRECEDES'
  | 'RESPONSIBLE_FOR'
  | 'TRANSFORMS_INTO'
  | 'REGULATED_BY';

export type ChangeStatus = 'unchanged' | 'modified' | 'added' | 'deleted';

export interface StagedEntity {
  id: string;
  stagedId: string;
  type: EntityType;
  name: string;
  description?: string;
  confidence: number;
  startOffset?: number;
  endOffset?: number;
  pdfLocation?: {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  position?: { x: number; y: number };
  status: ChangeStatus;
  originalData?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

export interface StagedRelationship {
  id: string;
  stagedId: string;
  type: RelationshipType;
  source: string;
  target: string;
  confidence: number;
  status: ChangeStatus;
  originalData?: Record<string, unknown>;
}

export interface StagingChange {
  id: string;
  type: string;
  entityId?: string;
  relationshipId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  timestamp: string;
}

export interface StagingSession {
  id: string;
  documentId: string;
  documentTitle: string;
  userId: string;
  userEmail: string;
  userName: string;
  status: 'active' | 'committed' | 'discarded';
  entities: StagedEntity[];
  relationships: StagedRelationship[];
  changes: StagingChange[];
  createdAt: string;
  updatedAt: string;
}

interface UndoRedoState {
  undoStack: StagingChange[][];
  redoStack: StagingChange[][];
}

interface StagingState {
  // Session state
  sessionId: string | null;
  documentId: string | null;
  session: StagingSession | null;
  isLoading: boolean;
  error: string | null;

  // Selection state
  selectedEntityId: string | null;
  selectedRelationshipId: string | null;

  // Undo/Redo
  undoStack: StagingChange[][];
  redoStack: StagingChange[][];

  // Computed
  hasChanges: boolean;

  // Actions
  setSession: (session: StagingSession | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Selection
  selectEntity: (entityId: string | null) => void;
  selectRelationship: (relationshipId: string | null) => void;

  // Entity operations (local state updates)
  updateEntity: (entityId: string, updates: Partial<StagedEntity>) => void;
  markEntityDeleted: (entityId: string) => void;
  addEntity: (entity: Omit<StagedEntity, 'id' | 'stagedId' | 'status'>) => void;

  // Relationship operations
  updateRelationship: (relationshipId: string, updates: Partial<StagedRelationship>) => void;
  markRelationshipDeleted: (relationshipId: string) => void;
  addRelationship: (relationship: Omit<StagedRelationship, 'id' | 'stagedId' | 'status'>) => void;

  // Position updates
  updateEntityPosition: (entityId: string, position: { x: number; y: number }) => void;

  // Undo/Redo
  pushUndoState: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Reset
  reset: () => void;
}

const initialState = {
  sessionId: null,
  documentId: null,
  session: null,
  isLoading: false,
  error: null,
  selectedEntityId: null,
  selectedRelationshipId: null,
  undoStack: [],
  redoStack: [],
  hasChanges: false,
};

export const useStagingStore = create<StagingState>((set, get) => ({
  ...initialState,

  setSession: (session) => {
    set({
      session,
      sessionId: session?.id || null,
      documentId: session?.documentId || null,
      hasChanges: (session?.changes?.length ?? 0) > 0,
      undoStack: [],
      redoStack: [],
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  selectEntity: (entityId) => set({
    selectedEntityId: entityId,
    selectedRelationshipId: null,
  }),

  selectRelationship: (relationshipId) => set({
    selectedRelationshipId: relationshipId,
    selectedEntityId: null,
  }),

  updateEntity: (entityId, updates) => {
    const state = get();
    if (!state.session) return;

    // Push current state to undo stack
    get().pushUndoState();

    const entities = state.session.entities.map((entity) => {
      if (entity.id === entityId || entity.stagedId === entityId) {
        const newStatus = entity.status === 'added' ? 'added' : 'modified';
        return { ...entity, ...updates, status: newStatus as ChangeStatus };
      }
      return entity;
    });

    const change: StagingChange = {
      id: crypto.randomUUID(),
      type: 'entity_modified',
      entityId,
      newData: updates as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    };

    set({
      session: {
        ...state.session,
        entities,
        changes: [...state.session.changes, change],
      },
      hasChanges: true,
      redoStack: [],
    });
  },

  markEntityDeleted: (entityId) => {
    const state = get();
    if (!state.session) return;

    get().pushUndoState();

    const entities = state.session.entities.map((entity) => {
      if (entity.id === entityId || entity.stagedId === entityId) {
        if (entity.status === 'added') {
          return null; // Will be filtered out
        }
        return { ...entity, status: 'deleted' as ChangeStatus };
      }
      return entity;
    }).filter(Boolean) as StagedEntity[];

    // Also mark relationships involving this entity as deleted
    const relationships = state.session.relationships.map((rel) => {
      if (rel.source === entityId || rel.target === entityId) {
        if (rel.status === 'added') {
          return null;
        }
        return { ...rel, status: 'deleted' as ChangeStatus };
      }
      return rel;
    }).filter(Boolean) as StagedRelationship[];

    const change: StagingChange = {
      id: crypto.randomUUID(),
      type: 'entity_deleted',
      entityId,
      timestamp: new Date().toISOString(),
    };

    set({
      session: {
        ...state.session,
        entities,
        relationships,
        changes: [...state.session.changes, change],
      },
      hasChanges: true,
      selectedEntityId: null,
      redoStack: [],
    });
  },

  addEntity: (entityData) => {
    const state = get();
    if (!state.session) return;

    get().pushUndoState();

    const newEntity: StagedEntity = {
      ...entityData,
      id: crypto.randomUUID(),
      stagedId: crypto.randomUUID(),
      status: 'added',
    };

    const change: StagingChange = {
      id: crypto.randomUUID(),
      type: 'entity_added',
      entityId: newEntity.id,
      newData: { ...newEntity } as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    };

    set({
      session: {
        ...state.session,
        entities: [...state.session.entities, newEntity],
        changes: [...state.session.changes, change],
      },
      hasChanges: true,
      selectedEntityId: newEntity.id,
      redoStack: [],
    });
  },

  updateRelationship: (relationshipId, updates) => {
    const state = get();
    if (!state.session) return;

    get().pushUndoState();

    const relationships = state.session.relationships.map((rel) => {
      if (rel.id === relationshipId || rel.stagedId === relationshipId) {
        const newStatus = rel.status === 'added' ? 'added' : 'modified';
        return { ...rel, ...updates, status: newStatus as ChangeStatus };
      }
      return rel;
    });

    const change: StagingChange = {
      id: crypto.randomUUID(),
      type: 'relationship_modified',
      relationshipId,
      newData: updates as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    };

    set({
      session: {
        ...state.session,
        relationships,
        changes: [...state.session.changes, change],
      },
      hasChanges: true,
      redoStack: [],
    });
  },

  markRelationshipDeleted: (relationshipId) => {
    const state = get();
    if (!state.session) return;

    get().pushUndoState();

    const relationships = state.session.relationships.map((rel) => {
      if (rel.id === relationshipId || rel.stagedId === relationshipId) {
        if (rel.status === 'added') {
          return null;
        }
        return { ...rel, status: 'deleted' as ChangeStatus };
      }
      return rel;
    }).filter(Boolean) as StagedRelationship[];

    const change: StagingChange = {
      id: crypto.randomUUID(),
      type: 'relationship_deleted',
      relationshipId,
      timestamp: new Date().toISOString(),
    };

    set({
      session: {
        ...state.session,
        relationships,
        changes: [...state.session.changes, change],
      },
      hasChanges: true,
      selectedRelationshipId: null,
      redoStack: [],
    });
  },

  addRelationship: (relationshipData) => {
    const state = get();
    if (!state.session) return;

    get().pushUndoState();

    const newRelationship: StagedRelationship = {
      ...relationshipData,
      id: crypto.randomUUID(),
      stagedId: crypto.randomUUID(),
      status: 'added',
    };

    const change: StagingChange = {
      id: crypto.randomUUID(),
      type: 'relationship_added',
      relationshipId: newRelationship.id,
      newData: { ...newRelationship } as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    };

    set({
      session: {
        ...state.session,
        relationships: [...state.session.relationships, newRelationship],
        changes: [...state.session.changes, change],
      },
      hasChanges: true,
      selectedRelationshipId: newRelationship.id,
      redoStack: [],
    });
  },

  updateEntityPosition: (entityId, position) => {
    const state = get();
    if (!state.session) return;

    // Don't push to undo stack for position updates (they're visual only)
    const entities = state.session.entities.map((entity) => {
      if (entity.id === entityId || entity.stagedId === entityId) {
        return { ...entity, position };
      }
      return entity;
    });

    set({
      session: {
        ...state.session,
        entities,
      },
    });
  },

  pushUndoState: () => {
    const state = get();
    if (!state.session) return;

    set({
      undoStack: [...state.undoStack, [...state.session.changes]],
    });
  },

  undo: () => {
    const state = get();
    if (!state.session || state.undoStack.length === 0) return;

    const newUndoStack = [...state.undoStack];
    const previousChanges = newUndoStack.pop() || [];

    // Save current state to redo stack
    const currentChanges = [...state.session.changes];

    set({
      session: {
        ...state.session,
        changes: previousChanges,
      },
      undoStack: newUndoStack,
      redoStack: [...state.redoStack, currentChanges],
      hasChanges: previousChanges.length > 0,
    });
  },

  redo: () => {
    const state = get();
    if (!state.session || state.redoStack.length === 0) return;

    const newRedoStack = [...state.redoStack];
    const nextChanges = newRedoStack.pop() || [];

    // Save current state to undo stack
    const currentChanges = [...state.session.changes];

    set({
      session: {
        ...state.session,
        changes: nextChanges,
      },
      undoStack: [...state.undoStack, currentChanges],
      redoStack: newRedoStack,
      hasChanges: nextChanges.length > 0,
    });
  },

  canUndo: () => get().undoStack.length > 0,

  canRedo: () => get().redoStack.length > 0,

  reset: () => set(initialState),
}));
