import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';

export interface Document {
  id: string;
  filename: string;
  originalName: string;
  title: string;
  description: string;
  tags: string[];
  size: number;
  uploadedAt: string;
  status: string;
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

interface UseDocumentsParams {
  searchQuery?: string;
  statusFilter?: string[];
  sortBy?: 'date' | 'name' | 'size';
  pageSize?: number;
}

interface UseDocumentsReturn {
  documents: Document[];
  totalCount: number;
  isLoading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refreshDocuments: () => void;
  error: string | null;
}

export function useDocuments({
  searchQuery = '',
  statusFilter = ['all'],
  sortBy = 'date',
  pageSize = 50,
}: UseDocumentsParams = {}): UseDocumentsReturn {
  const authFetch = useAuthFetch();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(1);

  const fetchDocuments = useCallback(
    async (pageNum: number, append = false) => {
      setIsLoading(true);
      setError(null);

      try {
        // Fetch all documents and filter/sort client-side for now
        // (The backend doesn't have full pagination support yet)
        const response = await authFetch(`${API_BASE_URL}/api/documents`);

        if (!response.ok) {
          throw new Error('Failed to fetch documents');
        }

        const data = await response.json();
        let fetchedDocs: Document[] = data.documents || [];

        // Client-side filtering
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          fetchedDocs = fetchedDocs.filter(
            (doc) =>
              doc.title?.toLowerCase().includes(query) ||
              doc.originalName?.toLowerCase().includes(query) ||
              doc.description?.toLowerCase().includes(query) ||
              doc.tags?.some((tag) => tag.toLowerCase().includes(query))
          );
        }

        if (statusFilter[0] !== 'all') {
          fetchedDocs = fetchedDocs.filter((doc) =>
            statusFilter.includes(doc.status)
          );
        }

        // Client-side sorting
        fetchedDocs.sort((a, b) => {
          if (sortBy === 'date') {
            return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
          }
          if (sortBy === 'name') {
            return (a.title || a.originalName).localeCompare(b.title || b.originalName);
          }
          if (sortBy === 'size') {
            return b.size - a.size;
          }
          return 0;
        });

        setTotalCount(fetchedDocs.length);

        // Client-side pagination
        const start = (pageNum - 1) * pageSize;
        const paginatedDocs = fetchedDocs.slice(start, start + pageSize);

        if (append) {
          setDocuments((prev) => [...prev, ...paginatedDocs]);
        } else {
          setDocuments(paginatedDocs);
        }

        setHasMore(start + paginatedDocs.length < fetchedDocs.length);
      } catch (err) {
        console.error('Failed to fetch documents:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch documents');
      } finally {
        setIsLoading(false);
      }
    },
    [authFetch, searchQuery, statusFilter, sortBy, pageSize]
  );

  // Reset and fetch when filters change
  // Note: Debouncing should be handled by the caller using useDebounce hook
  useEffect(() => {
    pageRef.current = 1;
    setDocuments([]);
    fetchDocuments(1, false);
  }, [searchQuery, statusFilter, sortBy, fetchDocuments]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      const nextPage = pageRef.current + 1;
      pageRef.current = nextPage;
      fetchDocuments(nextPage, true);
    }
  }, [isLoading, hasMore, fetchDocuments]);

  const refreshDocuments = useCallback(() => {
    pageRef.current = 1;
    setDocuments([]);
    fetchDocuments(1, false);
  }, [fetchDocuments]);

  return {
    documents,
    totalCount,
    isLoading,
    hasMore,
    loadMore,
    refreshDocuments,
    error,
  };
}

// Helper function to check if status indicates processing
export function isProcessingStatus(status: string): boolean {
  return status === 'processing' || [
    'extracting_content', 'extracting_visuals', 'chunking',
    'extracting_entities', 'validating_extraction', 'resolving_entities',
    'generating_embeddings', 'indexing_search', 'updating_graph',
    'tracking_mentions', 'discovering_cross_document_links',
  ].includes(status);
}

// Helper function to get human-readable status label
export function getStatusLabel(status: string): string {
  if (isProcessingStatus(status)) {
    const labels: Record<string, string> = {
      extracting_content: 'Extracting content',
      extracting_visuals: 'Extracting visuals',
      chunking: 'Chunking',
      extracting_entities: 'Extracting entities',
      validating_extraction: 'Validating',
      resolving_entities: 'Resolving entities',
      generating_embeddings: 'Generating embeddings',
      indexing_search: 'Indexing',
      updating_graph: 'Updating graph',
      tracking_mentions: 'Tracking mentions',
      discovering_cross_document_links: 'Discovering links',
    };
    return labels[status] || 'Processing';
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Helper function to get status color classes
export function getStatusColor(status: string): string {
  if (status === 'completed') return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200';
  if (isProcessingStatus(status)) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200';
  if (status === 'failed') return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

// Helper function to format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to format date
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Helper function to format date with time
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
