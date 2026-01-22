'use client';

import { useState } from 'react';
import { StagingSession } from '@/lib/staging-store';
import { StagingPreview } from '@/hooks/useStagingState';

interface StagingPanelProps {
  session: StagingSession | null;
  hasChanges: boolean;
  isLoading: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  onGetPreview: () => Promise<StagingPreview | null>;
}

export default function StagingPanel({
  session,
  hasChanges,
  isLoading,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCommit,
  onDiscard,
  onGetPreview,
}: StagingPanelProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<StagingPreview | null>(null);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);

  if (!session) return null;

  // Count changes by type
  const counts = {
    entitiesAdded: session.entities.filter((e) => e.status === 'added').length,
    entitiesModified: session.entities.filter((e) => e.status === 'modified').length,
    entitiesDeleted: session.entities.filter((e) => e.status === 'deleted').length,
    relationshipsAdded: session.relationships.filter((r) => r.status === 'added').length,
    relationshipsModified: session.relationships.filter((r) => r.status === 'modified').length,
    relationshipsDeleted: session.relationships.filter((r) => r.status === 'deleted').length,
  };

  const totalChanges =
    counts.entitiesAdded +
    counts.entitiesModified +
    counts.entitiesDeleted +
    counts.relationshipsAdded +
    counts.relationshipsModified +
    counts.relationshipsDeleted;

  const handleShowPreview = async () => {
    const data = await onGetPreview();
    setPreview(data);
    setShowPreview(true);
  };

  const handleCommit = () => {
    setShowPreview(false);
    onCommit();
  };

  const handleDiscard = () => {
    setShowConfirmDiscard(false);
    onDiscard();
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Change Summary */}
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Changes:
            </span>

            {counts.entitiesAdded > 0 && (
              <span className="flex items-center text-sm text-green-600 dark:text-green-400">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {counts.entitiesAdded} added
              </span>
            )}

            {counts.entitiesModified > 0 && (
              <span className="flex items-center text-sm text-yellow-600 dark:text-yellow-400">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                {counts.entitiesModified} modified
              </span>
            )}

            {counts.entitiesDeleted > 0 && (
              <span className="flex items-center text-sm text-red-600 dark:text-red-400">
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {counts.entitiesDeleted} deleted
              </span>
            )}

            {totalChanges === 0 && (
              <span className="text-sm text-gray-500 dark:text-gray-400">No changes</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-2">
            {/* Undo/Redo */}
            <div className="flex items-center space-x-1 mr-2">
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title="Undo (Ctrl+Z)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                className="p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title="Redo (Ctrl+Shift+Z)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                </svg>
              </button>
            </div>

            <button
              onClick={() => setShowConfirmDiscard(true)}
              disabled={!hasChanges || isLoading}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Discard
            </button>

            <button
              onClick={handleShowPreview}
              disabled={!hasChanges || isLoading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Committing...' : 'Commit Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && preview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Commit Preview
                </h2>
                <button
                  onClick={() => setShowPreview(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="overflow-y-auto max-h-96 space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {preview.summary.entitiesAdded + preview.summary.relationshipsAdded}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">Added</p>
                  </div>
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
                    <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                      {preview.summary.entitiesModified + preview.summary.relationshipsModified}
                    </p>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">Modified</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {preview.summary.entitiesDeleted + preview.summary.relationshipsDeleted}
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300">Deleted</p>
                  </div>
                </div>

                {/* Detailed changes */}
                {preview.entities.added.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      New Entities
                    </h4>
                    <ul className="space-y-1">
                      {preview.entities.added.map((e) => (
                        <li key={e.id} className="text-sm text-gray-600 dark:text-gray-400 flex items-center">
                          <span className="w-2 h-2 bg-green-500 rounded-full mr-2" />
                          {e.name} <span className="text-gray-400 ml-1">({e.type})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.entities.modified.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Modified Entities
                    </h4>
                    <ul className="space-y-1">
                      {preview.entities.modified.map((e) => (
                        <li key={e.id} className="text-sm text-gray-600 dark:text-gray-400 flex items-center">
                          <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2" />
                          {e.name} <span className="text-gray-400 ml-1">({e.type})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.entities.deleted.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Deleted Entities
                    </h4>
                    <ul className="space-y-1">
                      {preview.entities.deleted.map((e) => (
                        <li key={e.id} className="text-sm text-gray-600 dark:text-gray-400 flex items-center">
                          <span className="w-2 h-2 bg-red-500 rounded-full mr-2" />
                          {e.name} <span className="text-gray-400 ml-1">({e.type})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => setShowPreview(false)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCommit}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                >
                  Confirm Commit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Discard Confirmation Modal */}
      {showConfirmDiscard && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full mr-4">
                  <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  Discard Changes?
                </h2>
              </div>

              <p className="text-gray-600 dark:text-gray-400 mb-6">
                You have {totalChanges} unsaved change{totalChanges !== 1 ? 's' : ''}. Are you sure you want to discard all changes? This action cannot be undone.
              </p>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowConfirmDiscard(false)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium"
                >
                  Keep Editing
                </button>
                <button
                  onClick={handleDiscard}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
