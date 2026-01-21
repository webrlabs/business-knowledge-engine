'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';


interface PendingDocument {
  id: string;
  filename: string;
  title: string;
  mimeType: string;
  status: string;
  uploadedAt: string;
  entityCount?: number;
  relationshipCount?: number;
  avgConfidence?: number;
}

interface ReviewStats {
  approvedThisWeek: number;
  rejectedThisWeek: number;
  avgReviewTimeMinutes: number | null;
}

export default function ReviewPage() {
  const router = useRouter();
  const { user, roles, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [accessDenied, setAccessDenied] = useState(false);
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPendingDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch pending review documents
      const docsResponse = await authFetch(
        `${API_BASE_URL}/api/documents?status=pending_review`
      );

      if (!docsResponse.ok) {
        throw new Error('Failed to fetch pending documents');
      }

      const docsData = await docsResponse.json();
      setDocuments(docsData.documents || []);

      // Fetch review stats
      try {
        const statsResponse = await authFetch(`${API_BASE_URL}/api/review/stats`);

        if (statsResponse.ok) {
          const statsData = await statsResponse.json();
          setStats(statsData);
        }
      } catch {
        // Stats endpoint may not exist yet, ignore
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    // Check if user has required role for review
    console.log('Current user roles:', roles); // Debugging
    const canReview = roles.some((role) => ['Admin', 'Reviewer'].includes(role));

    if (!canReview) {
      setAccessDenied(true);
      return;
    }

    fetchPendingDocuments();
  }, [isAuthenticated, roles, router, fetchPendingDocuments]);

  if (!user) {
    return null;
  }

  if (accessDenied) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg p-8 text-center">
          <svg
            className="w-16 h-16 text-red-600 dark:text-red-400 mx-auto mb-4"
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
          <h2 className="text-2xl font-bold text-red-900 dark:text-red-100 mb-2">Access Denied</h2>
          <p className="text-red-800 dark:text-red-300 mb-4">
            You do not have permission to access the review queue.
          </p>
          <p className="text-sm text-red-700 dark:text-red-400 mb-6">
            Review access requires one of the following roles: <strong>Admin</strong> or <strong>Reviewer</strong>.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Return to Dashboard
          </button>
        </div>
      </div>

    );
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex mb-6" aria-label="Breadcrumb">
        <ol className="inline-flex items-center space-x-1 md:space-x-3">
          <li className="inline-flex items-center">
            <a href="/dashboard" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              Home
            </a>
          </li>
          <li>
            <div className="flex items-center">
              <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              <span className="text-gray-700 dark:text-gray-200 font-medium">Review Queue</span>
            </div>
          </li>
        </ol>
      </nav>

      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Review Queue</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Review and approve extracted entities from processed documents
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="px-4 py-2 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg font-medium">
            {documents.length} Pending
          </span>
          <button
            onClick={fetchPendingDocuments}
            disabled={isLoading}
            className="btn-secondary btn-sm"
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12">
          <div className="flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading pending documents...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 mb-6">
          <div className="flex items-center">
            <svg className="w-6 h-6 text-red-600 dark:text-red-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-lg font-medium text-red-900 dark:text-red-100">Error loading documents</h3>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">{error}</p>
            </div>
          </div>
          <button onClick={fetchPendingDocuments} className="mt-4 btn-secondary btn-sm">
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && documents.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-12">
          <div className="max-w-md mx-auto text-center">
            <svg
              className="w-24 h-24 text-gray-300 dark:text-gray-600 mx-auto mb-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
              No Documents Pending Review
            </h3>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              All documents have been reviewed. Upload and process new documents to see them here.
            </p>
            <button
              onClick={() => router.push('/dashboard/upload')}
              className="btn-primary inline-flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload Documents
            </button>
          </div>
        </div>
      )}

      {/* Pending Documents List */}
      {!isLoading && !error && documents.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-200 dark:border-gray-700">
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="p-6 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors duration-150"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">
                        <svg className="w-10 h-10 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                          {doc.title || doc.filename}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {doc.mimeType} • Uploaded {formatDate(doc.uploadedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center space-x-6 text-sm text-gray-600 dark:text-gray-400">
                      {doc.entityCount !== undefined && (
                        <div className="flex items-center space-x-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          <span>{doc.entityCount} entities extracted</span>
                        </div>
                      )}
                      {doc.relationshipCount !== undefined && (
                        <div className="flex items-center space-x-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span>{doc.relationshipCount} relationships</span>
                        </div>
                      )}
                      {doc.avgConfidence !== undefined && (
                        <div className="flex items-center space-x-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Avg. confidence: {Math.round(doc.avgConfidence * 100)}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="ml-6">
                    <button
                      onClick={() => router.push(`/dashboard/review/${doc.id}`)}
                      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
                    >
                      Review
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Help Text */}
      <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3 mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
              About the review process:
            </p>
            <ul className="text-sm text-blue-800 dark:text-blue-300 space-y-1 list-disc list-inside">
              <li>Uploaded documents are analyzed by Azure AI</li>
              <li>Entities and relationships are automatically extracted</li>
              <li>Click &ldquo;Review&rdquo; to see a split-screen view with the document and extracted graph</li>
              <li>You can approve, reject, or modify entities before they enter the graph</li>
              <li>Only approved entities become part of the knowledge graph</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved This Week</h4>
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {stats?.approvedThisWeek ?? 0}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Entities approved</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">Rejected This Week</h4>
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {stats?.rejectedThisWeek ?? 0}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Entities rejected</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">Average Review Time</h4>
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">
            {stats?.avgReviewTimeMinutes ? `${stats.avgReviewTimeMinutes}m` : '-'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {stats?.avgReviewTimeMinutes ? 'Per document' : 'No data yet'}
          </p>
        </div>
      </div>
    </div>

  );
}
