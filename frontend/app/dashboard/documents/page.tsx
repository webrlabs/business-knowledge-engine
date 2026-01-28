'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, canUpload } from '@/lib/auth';
import { useDocuments } from '@/hooks/useDocuments';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast, ToastContainer } from '@/components/Toast';
import DocumentUpload from '@/components/documents/DocumentUpload';
import DocumentList from '@/components/documents/DocumentList';
import DocumentDetails from '@/components/documents/DocumentDetails';

export default function DocumentsPage() {
  const router = useRouter();
  const { user, roles, isAuthenticated } = useAuth();
  const { toasts, dismissToast, success: showSuccess } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [uploadExpanded, setUploadExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>(['all']);
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');

  // Debounce search query to avoid excessive filtering
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  const {
    documents,
    totalCount,
    isLoading,
    hasMore,
    loadMore,
    refreshDocuments,
    error,
  } = useDocuments({
    searchQuery: debouncedSearchQuery,
    statusFilter,
    sortBy,
  });

  // Check upload permission
  const hasUploadPermission = canUpload(roles);

  // Determine if filters are active
  const isFiltered = debouncedSearchQuery.length > 0 || statusFilter[0] !== 'all';

  // Collapse upload section after first successful upload
  const handleUploadSuccess = useCallback(() => {
    setUploadExpanded(false);
    refreshDocuments();
    showSuccess('Upload Successful', 'Document has been uploaded and queued for processing');
  }, [refreshDocuments, showSuccess]);

  // Handle document selection
  const handleSelectDocument = useCallback((id: string) => {
    setSelectedDocument(id);
    // Update selected index
    const index = documents.findIndex((d) => d.id === id);
    setSelectedIndex(index);
  }, [documents]);

  // Handle close details
  const handleCloseDetails = useCallback(() => {
    setSelectedDocument(null);
    setSelectedIndex(-1);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Only handle arrow keys when not in an input
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        // Allow escape to blur inputs
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      // Arrow key navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = selectedIndex < documents.length - 1 ? selectedIndex + 1 : 0;
        if (documents[nextIndex]) {
          handleSelectDocument(documents[nextIndex].id);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = selectedIndex > 0 ? selectedIndex - 1 : documents.length - 1;
        if (documents[prevIndex]) {
          handleSelectDocument(documents[prevIndex].id);
        }
      } else if (e.key === 'Escape') {
        handleCloseDetails();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, documents, handleSelectDocument, handleCloseDetails]);

  // Redirect if not authenticated
  if (!isAuthenticated) {
    router.push('/');
    return null;
  }

  if (!user) {
    return null; // DashboardLayout will handle loading state
  }

  // Generate count display
  const countDisplay = isFiltered
    ? `${documents.length} of ${totalCount} document${totalCount !== 1 ? 's' : ''}`
    : `${totalCount} document${totalCount !== 1 ? 's' : ''}`;

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <div className="h-full flex flex-col bg-white dark:bg-gray-900 rounded-lg shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Documents
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Upload and manage your business process documents
              </p>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {countDisplay}
              {isFiltered && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter(['all']);
                  }}
                  className="ml-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel: Upload + Document List */}
          <div className="w-full lg:w-2/5 flex flex-col border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            {/* Collapsible Upload Section */}
            {hasUploadPermission && (
              <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <button
                  type="button"
                  onClick={() => setUploadExpanded(!uploadExpanded)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform ${
                        uploadExpanded ? 'rotate-90' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <span className="font-medium text-gray-900 dark:text-white">
                      Upload Documents
                    </span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {uploadExpanded ? 'Collapse' : 'Expand'}
                  </span>
                </button>

                {uploadExpanded && (
                  <div className="px-4 pb-4">
                    <DocumentUpload onUploadSuccess={handleUploadSuccess} compact />
                  </div>
                )}
              </div>
            )}

            {/* Search and Filter Bar */}
            <div className="px-4 py-3 space-y-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-16 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center px-1.5 py-0.5 text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">
                  <span className="text-xs">⌘</span>K
                </kbd>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={statusFilter[0]}
                  onChange={(e) => setStatusFilter([e.target.value])}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Status</option>
                  <option value="completed">Completed</option>
                  <option value="processing">Processing</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'date' | 'name' | 'size')}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="date">Sort by Date</option>
                  <option value="name">Sort by Name</option>
                  <option value="size">Sort by Size</option>
                </select>
              </div>
            </div>

            {/* Keyboard Navigation Hint */}
            <div className="px-4 py-1.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 hidden sm:block">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">↑</kbd>
                <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px] ml-0.5">↓</kbd>
                <span className="ml-1.5">navigate</span>
                <span className="mx-2 text-gray-300 dark:text-gray-600">·</span>
                <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-[10px]">Esc</kbd>
                <span className="ml-1.5">close</span>
              </p>
            </div>

            {/* Error Display */}
            {error && (
              <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                {error}
                <button
                  type="button"
                  onClick={refreshDocuments}
                  className="ml-2 underline hover:no-underline"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Document List with Virtual Scrolling */}
            <DocumentList
              documents={documents}
              selectedId={selectedDocument}
              onSelect={handleSelectDocument}
              isLoading={isLoading}
              hasMore={hasMore}
              onLoadMore={loadMore}
              isFiltered={isFiltered}
            />
          </div>

          {/* Right Panel: Document Details */}
          <div className="hidden lg:flex flex-1 bg-white dark:bg-gray-900">
            <DocumentDetails
              documentId={selectedDocument}
              onClose={handleCloseDetails}
              onRefresh={refreshDocuments}
            />
          </div>
        </div>

        {/* Mobile Document Details Modal */}
        {selectedDocument && (
          <div className="lg:hidden fixed inset-0 z-50 bg-white dark:bg-gray-900">
            <DocumentDetails
              documentId={selectedDocument}
              onClose={handleCloseDetails}
              onRefresh={refreshDocuments}
            />
          </div>
        )}
      </div>
    </>
  );
}
