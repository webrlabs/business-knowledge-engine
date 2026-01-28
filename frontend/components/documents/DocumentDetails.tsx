'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import {
  Document,
  formatFileSize,
  formatDateTime,
  getStatusLabel,
  getStatusColor,
  isProcessingStatus,
} from '@/hooks/useDocuments';
import { InlineLoader } from '@/components/LoadingSpinner';

interface DocumentDetailsProps {
  documentId: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

export default function DocumentDetails({
  documentId,
  onClose,
  onRefresh,
}: DocumentDetailsProps) {
  const authFetch = useAuthFetch();
  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = useCallback(async () => {
    if (!documentId) {
      setDocument(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${documentId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch document details');
      }
      const data = await response.json();
      setDocument(data);
    } catch (err) {
      console.error('Failed to fetch document details:', err);
      setError(err instanceof Error ? err.message : 'Failed to load document');
    } finally {
      setIsLoading(false);
    }
  }, [documentId, authFetch]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Poll for status updates when processing
  useEffect(() => {
    if (!document || !isProcessingStatus(document.status)) return;

    const interval = setInterval(fetchDetails, 3000);
    return () => clearInterval(interval);
  }, [document, fetchDetails]);

  const handleProcess = async () => {
    if (!documentId) return;

    setIsProcessing(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${documentId}/process`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to start processing');
      }

      // Refresh to show new status
      await fetchDetails();
      onRefresh();
    } catch (err) {
      console.error('Failed to process document:', err);
      setError(err instanceof Error ? err.message : 'Failed to start processing');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDelete = async () => {
    if (!documentId) return;

    if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${documentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete document');
      }

      onClose();
      onRefresh();
    } catch (err) {
      console.error('Failed to delete document:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete document');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!documentId) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm">Select a document to view details</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <InlineLoader text="Loading document..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500 dark:text-red-400">
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm">{error}</p>
          <button
            onClick={fetchDetails}
            className="mt-3 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!document) return null;

  const showProcessButton = ['pending', 'failed', 'completed'].includes(document.status) && !isProcessingStatus(document.status);
  const processing = isProcessingStatus(document.status);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate mb-1">
            {document.title || document.originalName}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
            {document.originalName}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-4 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="space-y-6">
          {/* Status and Actions */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Status
            </h3>
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(document.status)}`}
              >
                {processing && (
                  <svg className="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {getStatusLabel(document.status)}
              </span>
              {showProcessButton && (
                <button
                  type="button"
                  onClick={handleProcess}
                  disabled={isProcessing || isDeleting}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    document.status === 'failed'
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : document.status === 'completed'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isProcessing ? (
                    <span className="flex items-center">
                      <svg className="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Starting...
                    </span>
                  ) : document.status === 'failed' ? (
                    'Retry'
                  ) : document.status === 'completed' ? (
                    'Reprocess'
                  ) : (
                    'Process'
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={handleDelete}
                disabled={isProcessing || isDeleting}
                className="px-3 py-1.5 text-sm font-medium rounded-lg text-red-700 bg-red-100 hover:bg-red-200 dark:text-red-200 dark:bg-red-900/50 dark:hover:bg-red-900/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-1.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deleting...
                  </span>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>

          {/* Metadata */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Information
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600 dark:text-gray-400">File Size:</dt>
                <dd className="font-medium text-gray-900 dark:text-white">
                  {formatFileSize(document.size)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600 dark:text-gray-400">Uploaded:</dt>
                <dd className="font-medium text-gray-900 dark:text-white">
                  {formatDateTime(document.uploadedAt)}
                </dd>
              </div>
              {document.description && (
                <div className="flex justify-between">
                  <dt className="text-gray-600 dark:text-gray-400">Description:</dt>
                  <dd className="font-medium text-gray-900 dark:text-white text-right max-w-[60%]">
                    {document.description}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Tags */}
          {document.tags && document.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {document.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Processing Results */}
          {document.processingResults && (
            <>
              {/* Processing Metadata */}
              {document.processingResults.metadata && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Processing Metadata
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-1 text-sm">
                    <p className="text-gray-700 dark:text-gray-300">
                      <span className="font-medium">Pages:</span>{' '}
                      {document.processingResults.metadata.pageCount ?? 'N/A'}
                    </p>
                    <p className="text-gray-700 dark:text-gray-300">
                      <span className="font-medium">Language:</span>{' '}
                      {document.processingResults.metadata.language ?? 'N/A'}
                    </p>
                    {document.processingResults.metadata.confidence != null && (
                      <p className="text-gray-700 dark:text-gray-300">
                        <span className="font-medium">Confidence:</span>{' '}
                        {(document.processingResults.metadata.confidence * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Document Hierarchy */}
              {document.processingResults.hierarchy?.sections?.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Document Structure
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 max-h-48 overflow-y-auto">
                    <ul className="space-y-1">
                      {document.processingResults.hierarchy.sections.map((section, idx) => (
                        <li
                          key={idx}
                          className="text-sm text-gray-700 dark:text-gray-300"
                          style={{ paddingLeft: `${(section.level - 1) * 12}px` }}
                        >
                          <span className="font-medium">{section.title}</span>
                          <span className="text-gray-500 dark:text-gray-400 ml-2">
                            (Page {section.page})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Extracted Text Preview */}
              {document.processingResults.extractedText && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Extracted Text
                  </h3>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 max-h-64 overflow-y-auto">
                    <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                      {document.processingResults.extractedText}
                    </pre>
                  </div>
                </div>
              )}

              {/* Tables */}
              {document.processingResults.tables && document.processingResults.tables.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    Extracted Tables ({document.processingResults.tables.length})
                  </h3>
                  <div className="space-y-4">
                    {document.processingResults.tables.slice(0, 2).map((table, idx) => (
                      <div
                        key={table.id}
                        className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto"
                      >
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                          Table {idx + 1}: {table.rows} rows x {table.columns} columns
                        </p>
                        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-xs">
                          <thead>
                            <tr>
                              {table.data[0]?.map((header, colIdx) => (
                                <th
                                  key={colIdx}
                                  className="px-2 py-1 text-left font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {table.data.slice(1, 6).map((row, rowIdx) => (
                              <tr key={rowIdx}>
                                {row.map((cell, cellIdx) => (
                                  <td
                                    key={cellIdx}
                                    className="px-2 py-1 text-gray-900 dark:text-gray-100"
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {table.data.length > 6 && (
                          <p className="text-xs text-gray-400 mt-2">
                            + {table.data.length - 6} more rows
                          </p>
                        )}
                      </div>
                    ))}
                    {document.processingResults.tables.length > 2 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        + {document.processingResults.tables.length - 2} more tables
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Pending Status */}
          {document.status === 'pending' && (
            <div className="text-center py-8 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                This document has not been processed yet.
              </p>
              <button
                type="button"
                onClick={handleProcess}
                disabled={isProcessing}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isProcessing ? 'Starting...' : 'Process Document'}
              </button>
            </div>
          )}

          {/* Processing Status */}
          {processing && (
            <div className="text-center py-8 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <InlineLoader text={`${getStatusLabel(document.status)}...`} />
              <p className="mt-4 text-sm text-blue-700 dark:text-blue-300">
                This may take a few minutes for large documents.
              </p>
            </div>
          )}

          {/* Failed Status */}
          {document.status === 'failed' && (
            <div className="text-center py-8 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <svg
                className="mx-auto h-12 w-12 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <p className="mt-4 text-sm text-red-600 dark:text-red-400">
                Document processing failed.
              </p>
              <button
                type="button"
                onClick={handleProcess}
                disabled={isProcessing}
                className="mt-4 inline-flex items-center px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {isProcessing ? 'Starting...' : 'Retry Processing'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
