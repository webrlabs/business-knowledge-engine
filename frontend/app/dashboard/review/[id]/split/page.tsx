'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { useStagingState } from '@/hooks/useStagingState';
import { StagedEntity } from '@/lib/staging-store';
import PDFViewer from '@/components/review/PDFViewer';
import InteractiveGraph from '@/components/review/InteractiveGraph';
import EntityTypeModal from '@/components/review/EntityTypeModal';
import RelationshipModal from '@/components/review/RelationshipModal';
import StagingPanel from '@/components/review/StagingPanel';

interface DocumentData {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  blobUrl: string;
  status: string;
  uploadedAt: string;
}

export default function SplitReviewPage() {
  const router = useRouter();
  const params = useParams();
  const { user, roles, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const documentId = params.id as string;

  // State
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  // Modal states
  const [editingEntity, setEditingEntity] = useState<StagedEntity | null>(null);
  const [showRelationshipModal, setShowRelationshipModal] = useState(false);
  const [relationshipSource, setRelationshipSource] = useState<string | undefined>();
  const [relationshipTarget, setRelationshipTarget] = useState<string | undefined>();

  // Staging state
  const {
    session,
    isLoading,
    error,
    hasChanges,
    selectedEntityId,
    selectEntity,
    initSession,
    commitChanges,
    discardSession,
    getPreview,
    updateEntity,
    deleteEntity,
    addRelationship,
    deleteRelationship,
    updateEntityPosition,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useStagingState();

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Check authentication and permissions
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    const canReview = roles.some((role) =>
      ['admin', 'reviewer'].includes(role.toLowerCase())
    );

    if (!canReview) {
      setAccessDenied(true);
      setPageLoading(false);
      return;
    }

    // Fetch document data
    const fetchDocument = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL}/api/documents/${documentId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setPageError('Document not found');
          } else {
            throw new Error('Failed to fetch document');
          }
          return;
        }

        const data = await response.json();
        setDocument({
          id: data.id,
          title: data.title || data.originalName,
          originalName: data.originalName,
          mimeType: data.mimeType,
          blobUrl: data.blobUrl || '',
          status: data.status,
          uploadedAt: data.uploadedAt,
        });

        // Initialize staging session
        await initSession(documentId);
      } catch (err) {
        setPageError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setPageLoading(false);
      }
    };

    fetchDocument();
  }, [isAuthenticated, roles, router, documentId, authFetch, initSession]);

  // Handle entity edit from graph
  const handleEntityEdit = useCallback((entity: StagedEntity) => {
    setEditingEntity(entity);
  }, []);

  // Handle relationship creation
  const handleRelationshipCreate = useCallback((source: string, target: string) => {
    setRelationshipSource(source);
    setRelationshipTarget(target);
    setShowRelationshipModal(true);
  }, []);

  // Handle commit
  const handleCommit = useCallback(async () => {
    const success = await commitChanges();
    if (success) {
      router.push('/dashboard/review');
    }
  }, [commitChanges, router]);

  // Handle discard
  const handleDiscard = useCallback(async () => {
    const success = await discardSession();
    if (success) {
      router.push('/dashboard/review');
    }
  }, [discardSession, router]);

  // Scroll to entity in PDF when selected from graph
  const [scrollToEntityId, setScrollToEntityId] = useState<string | null>(null);

  const handleEntitySelectFromGraph = useCallback(
    (entityId: string | null) => {
      selectEntity(entityId);
      if (entityId) {
        setScrollToEntityId(entityId);
        // Clear after a short delay
        setTimeout(() => setScrollToEntityId(null), 100);
      }
    },
    [selectEntity]
  );

  // Loading state
  if (pageLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading document...</p>
        </div>
      </div>
    );
  }

  // Access denied
  if (accessDenied) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
          <svg
            className="w-16 h-16 text-red-500 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access Denied</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            You need Admin or Reviewer role to access this page.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (pageError) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 text-center">
          <svg
            className="w-16 h-16 text-red-500 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Error</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{pageError}</p>
          <button
            onClick={() => router.push('/dashboard/review')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Return to Review Queue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/dashboard/review')}
              className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              title="Back to Review Queue"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                {document?.title || 'Document Review'}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Split View - Edit entities and relationships
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {session && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Session: {session.id.substring(0, 8)}...
              </span>
            )}
            {error && (
              <span className="text-sm text-red-500">{error}</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content - Split View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - PDF Viewer */}
        <div className="w-1/2 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          {document?.blobUrl ? (
            <PDFViewer
              url={document.blobUrl}
              entities={session?.entities || []}
              selectedEntityId={selectedEntityId}
              onEntityClick={selectEntity}
              scrollToEntityId={scrollToEntityId}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <svg
                  className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <p className="text-gray-500 dark:text-gray-400">
                  No PDF available for preview
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                  View entities in the graph on the right
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Interactive Graph */}
        <div className="w-1/2 bg-white dark:bg-gray-800">
          <InteractiveGraph
            entities={session?.entities || []}
            relationships={session?.relationships || []}
            selectedEntityId={selectedEntityId}
            onEntitySelect={handleEntitySelectFromGraph}
            onEntityPositionChange={updateEntityPosition}
            onEntityDelete={deleteEntity}
            onEntityEdit={handleEntityEdit}
            onRelationshipCreate={handleRelationshipCreate}
            onRelationshipDelete={deleteRelationship}
          />
        </div>
      </div>

      {/* Bottom Panel - Staging Controls */}
      <StagingPanel
        session={session}
        hasChanges={hasChanges}
        isLoading={isLoading}
        canUndo={canUndo()}
        canRedo={canRedo()}
        onUndo={undo}
        onRedo={redo}
        onCommit={handleCommit}
        onDiscard={handleDiscard}
        onGetPreview={getPreview}
      />

      {/* Edit Entity Modal */}
      <EntityTypeModal
        entity={editingEntity}
        isOpen={editingEntity !== null}
        onClose={() => setEditingEntity(null)}
        onSave={(entityId, updates) => {
          updateEntity(entityId, updates);
          setEditingEntity(null);
        }}
      />

      {/* Create Relationship Modal */}
      <RelationshipModal
        isOpen={showRelationshipModal}
        onClose={() => {
          setShowRelationshipModal(false);
          setRelationshipSource(undefined);
          setRelationshipTarget(undefined);
        }}
        entities={session?.entities || []}
        sourceEntityId={relationshipSource}
        targetEntityId={relationshipTarget}
        onSave={(relationship) => {
          addRelationship(relationship);
          setShowRelationshipModal(false);
          setRelationshipSource(undefined);
          setRelationshipTarget(undefined);
        }}
      />
    </div>
  );
}
