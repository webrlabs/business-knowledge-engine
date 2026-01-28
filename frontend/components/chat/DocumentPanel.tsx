'use client';

import { useChatStore } from '@/lib/chat-store';
import DocumentViewer from './DocumentViewer';

interface DocumentPanelProps {
  className?: string;
}

/**
 * Right-side panel for viewing document content with highlighted citations.
 * Includes a header with document name, close button, and context info.
 */
export default function DocumentPanel({ className = '' }: DocumentPanelProps) {
  const {
    activeDocument,
    documentLoading,
    clearActiveDocument,
  } = useChatStore();

  if (documentLoading) {
    return (
      <div className={`flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 ${className}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
            <span className="text-sm text-gray-500 dark:text-gray-400">Loading document...</span>
          </div>
          <button
            type="button"
            onClick={clearActiveDocument}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
            aria-label="Close panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Loading skeleton */}
        <div className="flex-1 p-4 space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-full" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-5/6" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (!activeDocument) {
    return null;
  }

  return (
    <div className={`flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Document icon */}
          <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {activeDocument.documentName}
          </h3>
        </div>

        <button
          type="button"
          onClick={clearActiveDocument}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors flex-shrink-0"
          aria-label="Close panel"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Context bar */}
      {activeDocument.highlightPassages.length > 0 && (
        <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-100 dark:border-yellow-800/30">
          <div className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-300">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              {activeDocument.highlightPassages.length} cited passage{activeDocument.highlightPassages.length !== 1 ? 's' : ''} highlighted
            </span>
          </div>
        </div>
      )}

      {/* Document content */}
      <div className="flex-1 overflow-hidden">
        <DocumentViewer
          content={activeDocument.content}
          highlightPassages={activeDocument.highlightPassages}
          scrollToPassage={activeDocument.scrollToPassage}
        />
      </div>
    </div>
  );
}
