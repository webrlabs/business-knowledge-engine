'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';

import { InlineLoader } from '@/components/LoadingSpinner';
import { useToast, ToastContainer } from '@/components/Toast';

interface Document {
  id: string;
  filename: string;
  originalName: string;
  title: string;
  description: string;
  tags: string[];
  size: number;
  uploadedAt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  processingResults?: {
    extractedText: string;
    tables: Array<{
      id: string;
      rows: number;
      columns: number;
      data: string[][];
    }>;
    hierarchy: {
      sections: Array<{
        level: number;
        title: string;
        page: number;
      }>;
    };
    checkboxes: Array<{
      page: number;
      checked: boolean;
      label: string;
    }>;
    metadata: {
      pageCount: number;
      language: string;
      processingDate: string;
      confidence: number;
      modelVersion: string;
    };
    formattingMetadata?: {
      styles: string[];
      fonts: string[];
      hasImages: boolean;
      hasHyperlinks: boolean;
    };
  };
}

export default function DocumentsPage() {
  const router = useRouter();
  const { toasts, dismissToast, error: showError, success: showSuccess } = useToast();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents`);
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      showError('Error', 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [authFetch, showError]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }
    fetchDocuments();
  }, [fetchDocuments, isAuthenticated, router]);

  const processDocument = async (documentId: string) => {
    setProcessing(documentId);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${documentId}/process`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Processing failed');
      }

      showSuccess('Processing Started', 'Document is being processed with Azure AI Document Intelligence');

      // Poll for completion (every 3 seconds to reduce load)
      const pollInterval = setInterval(async () => {
        try {
          const docResponse = await authFetch(`${API_BASE_URL}/api/documents/${documentId}`);
          const docData = await docResponse.json();

          if (docData.status === 'completed') {
            clearInterval(pollInterval);
            setProcessing(null);
            showSuccess('Processing Complete', 'Document has been successfully processed');
            fetchDocuments();
          } else if (docData.status === 'failed') {
            clearInterval(pollInterval);
            setProcessing(null);
            showError('Processing Failed', docData.processingError || 'Document processing encountered an error');
            fetchDocuments();
          }
        } catch (pollError) {
          console.warn('Polling error:', pollError);
        }
      }, 3000);

      // Clear interval after 5 minutes and reset state
      setTimeout(() => {
        clearInterval(pollInterval);
        setProcessing(null);
        fetchDocuments(); // Refresh to show current status
      }, 300000);
    } catch (error) {
      console.error('Error processing document:', error);
      showError('Error', 'Failed to start document processing');
      setProcessing(null);
    }
  };

  const viewDocument = async (documentId: string) => {
    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${documentId}`);
      const data = await response.json();
      setSelectedDocument(data);
    } catch (error) {
      console.error('Error viewing document:', error);
      showError('Error', 'Failed to load document details');
    }
  };

  const deleteDocumentHandler = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document? This action cannot be undone.')) {
      return;
    }

    setDeleting(documentId);
    try {
      const response = await authFetch(`${API_BASE_URL}/api/documents/${documentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Delete failed (${response.status})`);
      }

      showSuccess('Document Deleted', 'Document has been successfully deleted');

      // Clear selected document if it was the one being deleted
      if (selectedDocument?.id === documentId) {
        setSelectedDocument(null);
      }

      // Refresh the document list
      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete document';
      showError('Delete Failed', message);
    } finally {
      setDeleting(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'processing': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'failed': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    }
  };

  if (!user) {
    return null; // DashboardLayout will handle loading state
  }

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
            Documents
          </h2>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            View and process uploaded documents
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <InlineLoader text="Loading documents..." />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No documents</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Get started by uploading a document.
            </p>
            <div className="mt-6">
              <button
                onClick={() => router.push('/dashboard/upload')}
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Upload Document
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Document List */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Uploaded Documents ({documents.length})
              </h3>
              <div className="space-y-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => viewDocument(doc.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {doc.title}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {doc.originalName}
                        </p>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(doc.status)}`}>
                            {doc.status}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {formatFileSize(doc.size)}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(doc.uploadedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4 flex-shrink-0 flex items-center gap-2">
                        {(doc.status === 'pending' || doc.status === 'failed' || doc.status === 'completed') && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              processDocument(doc.id);
                            }}
                            disabled={processing === doc.id || deleting === doc.id}
                            className={`inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                              doc.status === 'failed'
                                ? 'bg-orange-600 hover:bg-orange-700 focus:ring-orange-500'
                                : doc.status === 'completed'
                                ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500'
                                : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                            }`}
                          >
                            {processing === doc.id ? (
                              <>
                                <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Processing...
                              </>
                            ) : doc.status === 'failed' ? (
                              <>
                                <svg className="-ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Retry
                              </>
                            ) : doc.status === 'completed' ? (
                              <>
                                <svg className="-ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                Reprocess
                              </>
                            ) : (
                              'Process'
                            )}
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteDocumentHandler(doc.id);
                          }}
                          disabled={deleting === doc.id || processing === doc.id}
                          className="inline-flex items-center px-2 py-1.5 border border-transparent text-xs font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed dark:text-red-200 dark:bg-red-900 dark:hover:bg-red-800"
                          title="Delete document"
                        >
                          {deleting === doc.id ? (
                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Document Viewer */}
            <div className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)]">
              {selectedDocument ? (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 overflow-auto max-h-[calc(100vh-6rem)]">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Document Details
                    </h3>
                    <div className="flex items-center gap-2">
                      {selectedDocument.status === 'completed' && (
                        <button
                          onClick={() => processDocument(selectedDocument.id)}
                          disabled={processing === selectedDocument.id || deleting === selectedDocument.id}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {processing === selectedDocument.id ? (
                            <>
                              <svg className="animate-spin -ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Reprocessing...
                            </>
                          ) : (
                            <>
                              <svg className="-ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Reprocess
                            </>
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => deleteDocumentHandler(selectedDocument.id)}
                        disabled={deleting === selectedDocument.id}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed dark:text-red-200 dark:bg-red-900 dark:hover:bg-red-800"
                      >
                      {deleting === selectedDocument.id ? (
                        <>
                          <svg className="animate-spin -ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Deleting...
                        </>
                      ) : (
                        <>
                          <svg className="-ml-0.5 mr-1.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </>
                      )}
                    </button>
                    </div>
                  </div>

                  {/* Document Info */}
                  <div className="mb-6 space-y-2">
                    <div>
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Title:</span>
                      <p className="text-sm text-gray-900 dark:text-white">{selectedDocument.title}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Filename:</span>
                      <p className="text-sm text-gray-900 dark:text-white">{selectedDocument.originalName}</p>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Status:</span>
                      <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(selectedDocument.status)}`}>
                        {selectedDocument.status}
                      </span>
                    </div>
                  </div>

                  {/* Processing Results */}
                  {selectedDocument.processingResults ? (
                    <div className="space-y-6">
                      {/* Metadata */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                          Processing Metadata
                        </h4>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-1 text-sm">
                          <p className="text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Pages:</span> {selectedDocument.processingResults.metadata?.pageCount ?? 'N/A'}
                          </p>
                          <p className="text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Language:</span> {selectedDocument.processingResults.metadata?.language ?? 'N/A'}
                          </p>
                          <p className="text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Confidence:</span> {selectedDocument.processingResults.metadata?.confidence != null ? (selectedDocument.processingResults.metadata.confidence * 100).toFixed(1) + '%' : 'N/A'}
                          </p>
                          <p className="text-gray-700 dark:text-gray-300">
                            <span className="font-medium">Model:</span> {selectedDocument.processingResults.metadata?.modelVersion ?? 'N/A'}
                          </p>
                        </div>
                      </div>

                      {/* Document Hierarchy */}
                      {selectedDocument.processingResults.hierarchy?.sections?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                            Document Structure
                          </h4>
                          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                            <ul className="space-y-1">
                              {selectedDocument.processingResults.hierarchy?.sections?.map((section, idx) => (
                                <li
                                  key={idx}
                                  className="text-sm text-gray-700 dark:text-gray-300"
                                  style={{ paddingLeft: `${(section.level - 1) * 16}px` }}
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

                      {/* Extracted Text */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                          Extracted Text
                        </h4>
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto">
                          <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                            {selectedDocument.processingResults.extractedText}
                          </pre>
                        </div>
                      </div>

                      {/* Tables */}
                      {selectedDocument.processingResults.tables?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                            Extracted Tables ({selectedDocument.processingResults.tables.length})
                          </h4>
                          <div className="space-y-4">
                            {selectedDocument.processingResults.tables.map((table, idx) => (
                              <div key={table.id} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 overflow-x-auto">
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                  Table {idx + 1}: {table.rows} rows × {table.columns} columns
                                </p>
                                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                  <thead>
                                    <tr>
                                      {table.data[0].map((header, colIdx) => (
                                        <th
                                          key={colIdx}
                                          className="px-3 py-2 text-left text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wider bg-gray-100 dark:bg-gray-800"
                                        >
                                          {header}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {table.data.slice(1).map((row, rowIdx) => (
                                      <tr key={rowIdx}>
                                        {row.map((cell, cellIdx) => (
                                          <td
                                            key={cellIdx}
                                            className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                                          >
                                            {cell}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Checkboxes */}
                      {selectedDocument.processingResults.checkboxes?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                            Detected Checkboxes
                          </h4>
                          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                            <ul className="space-y-2">
                              {selectedDocument.processingResults.checkboxes.map((checkbox, idx) => (
                                <li key={idx} className="flex items-center text-sm text-gray-700 dark:text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={checkbox.checked}
                                    readOnly
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                                  />
                                  <span>{checkbox.label}</span>
                                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                                    (Page {checkbox.page})
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Formatting Metadata (Word documents) */}
                      {selectedDocument.processingResults.formattingMetadata && (
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                            Formatting Metadata
                          </h4>
                          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 space-y-2 text-sm">
                            <p className="text-gray-700 dark:text-gray-300">
                              <span className="font-medium">Styles:</span> {selectedDocument.processingResults.formattingMetadata.styles?.join(', ') || 'None'}
                            </p>
                            <p className="text-gray-700 dark:text-gray-300">
                              <span className="font-medium">Fonts:</span> {selectedDocument.processingResults.formattingMetadata.fonts?.join(', ') || 'None'}
                            </p>
                            <p className="text-gray-700 dark:text-gray-300">
                              <span className="font-medium">Contains Images:</span> {selectedDocument.processingResults.formattingMetadata.hasImages ? 'Yes' : 'No'}
                            </p>
                            <p className="text-gray-700 dark:text-gray-300">
                              <span className="font-medium">Contains Hyperlinks:</span> {selectedDocument.processingResults.formattingMetadata.hasHyperlinks ? 'Yes' : 'No'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : selectedDocument.status === 'pending' ? (
                    <div className="text-center py-8">
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        This document has not been processed yet.
                      </p>
                      <button
                        onClick={() => processDocument(selectedDocument.id)}
                        disabled={processing === selectedDocument.id}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        {processing === selectedDocument.id ? 'Processing...' : 'Process Document'}
                      </button>
                    </div>
                  ) : selectedDocument.status === 'processing' ? (
                    <div className="text-center py-8">
                      <InlineLoader text="Processing..." />
                      <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                        Processing document with Azure AI Document Intelligence...
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <svg className="mx-auto h-12 w-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <p className="mt-4 text-sm text-red-600 dark:text-red-400">
                        Document processing failed.
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        There was an error processing this document. You can try again.
                      </p>
                      <button
                        onClick={() => processDocument(selectedDocument.id)}
                        disabled={processing === selectedDocument.id}
                        className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-orange-600 hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50"
                      >
                        {processing === selectedDocument.id ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Retrying...
                          </>
                        ) : (
                          <>
                            <svg className="-ml-0.5 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Retry Processing
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-12 text-center">
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                    Select a document to view its details
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
