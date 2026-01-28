'use client';

import type { Citation } from '@/lib/chat-types';

interface CitationBadgeProps {
  citation: Citation | string;
  index: number;
  onClick?: (citation: Citation) => void;
}

/**
 * Clickable citation badge that displays citation number and document name.
 * For rich Citation objects, clicking opens the document panel.
 * For legacy string citations, displays as static badge.
 */
export default function CitationBadge({ citation, index, onClick }: CitationBadgeProps) {
  const isRichCitation = typeof citation !== 'string';

  const displayName = isRichCitation
    ? citation.documentName
    : citation;

  const handleClick = () => {
    if (isRichCitation && onClick) {
      onClick(citation);
    }
  };

  const baseClasses = 'inline-flex items-center rounded-md px-2 py-1 text-xs';

  if (isRichCitation && onClick) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={`${baseClasses} bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer group`}
        title={`View source: ${displayName}${citation.pageNumber ? ` (Page ${citation.pageNumber})` : ''}`}
      >
        <span className="font-medium mr-1.5">{index + 1}.</span>
        <span className="truncate max-w-[200px]">{displayName}</span>
        {citation.pageNumber && (
          <span className="ml-1 text-blue-500 dark:text-blue-400">p.{citation.pageNumber}</span>
        )}
        <svg
          className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </button>
    );
  }

  // Static badge for legacy string citations
  return (
    <span
      className={`${baseClasses} bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300`}
    >
      <span className="font-medium mr-1.5">{index + 1}.</span>
      <span className="truncate max-w-[200px]">{displayName}</span>
    </span>
  );
}
