'use client';

import { useRef, useEffect, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Document,
  formatFileSize,
  formatDate,
  getStatusLabel,
  getStatusColor,
  isProcessingStatus,
} from '@/hooks/useDocuments';

interface DocumentListProps {
  documents: Document[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  isFiltered?: boolean;
}

interface DocumentListItemProps {
  document: Document;
  isSelected: boolean;
  onSelect: (id: string) => void;
  style: React.CSSProperties;
}

// Memoized list item to prevent unnecessary re-renders
const DocumentListItem = memo(function DocumentListItem({
  document,
  isSelected,
  onSelect,
  style,
}: DocumentListItemProps) {
  const isProcessing = isProcessingStatus(document.status);

  return (
    <div style={style}>
      <button
        type="button"
        onClick={() => onSelect(document.id)}
        className={`
          w-full h-full p-4 text-left border-b border-gray-100 dark:border-gray-800
          hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors
          ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-600' : ''}
        `}
      >
        <h3 className="font-medium text-sm text-gray-900 dark:text-white truncate mb-1">
          {document.title || document.originalName}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-2">
          {document.originalName}
        </p>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${getStatusColor(document.status)}`}
          >
            {isProcessing && (
              <svg
                className="w-3 h-3 mr-1 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {getStatusLabel(document.status)}
          </span>
          <span className="text-gray-400 dark:text-gray-500">
            {formatFileSize(document.size)}
          </span>
          <span className="text-gray-400 dark:text-gray-500">
            {formatDate(document.uploadedAt)}
          </span>
        </div>
      </button>
    </div>
  );
});

// Skeleton loader for initial loading state
function DocumentSkeleton() {
  return (
    <div className="p-4 border-b border-gray-100 dark:border-gray-800 animate-pulse">
      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
      <div className="flex gap-2">
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-20" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-16" />
        <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-24" />
      </div>
    </div>
  );
}

export default function DocumentList({
  documents,
  selectedId,
  onSelect,
  isLoading,
  hasMore,
  onLoadMore,
  isFiltered = false,
}: DocumentListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: documents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88, // Estimated item height in pixels
    overscan: 5, // Render 5 extra items above and below viewport
  });

  // Infinite scroll detection
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1];

    if (!lastItem) return;

    if (
      lastItem.index >= documents.length - 1 &&
      hasMore &&
      !isLoading
    ) {
      onLoadMore();
    }
  }, [virtualItems, documents.length, hasMore, isLoading, onLoadMore]);

  // Show skeleton loaders during initial load
  if (isLoading && documents.length === 0) {
    return (
      <div className="flex-1 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <DocumentSkeleton key={i} />
        ))}
      </div>
    );
  }

  // Empty state - no documents exist
  if (documents.length === 0 && !isLoading && !isFiltered) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600"
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
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No documents yet
          </p>
          <p className="text-xs mt-1 text-gray-400 dark:text-gray-500">
            Upload your first document above to get started
          </p>
        </div>
      </div>
    );
  }

  // Empty state - no results from filter/search
  if (documents.length === 0 && !isLoading && isFiltered) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No documents match your criteria
          </p>
          <p className="text-xs mt-1 text-gray-400 dark:text-gray-500">
            Try adjusting your search or filters
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-auto"
      style={{ contain: 'strict' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualItems.map((virtualRow) => {
          const doc = documents[virtualRow.index];
          return (
            <DocumentListItem
              key={doc.id}
              document={doc}
              isSelected={doc.id === selectedId}
              onSelect={onSelect}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          );
        })}
      </div>

      {/* Loading indicator for infinite scroll */}
      {isLoading && documents.length > 0 && (
        <div className="p-4 text-center">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}
    </div>
  );
}
