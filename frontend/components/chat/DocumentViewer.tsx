'use client';

import { useEffect, useRef, useMemo } from 'react';

interface DocumentViewerProps {
  content: string;
  highlightPassages: string[];
  scrollToPassage?: string;
}

/**
 * Displays document text with highlighted passages.
 * Auto-scrolls to the first highlighted passage.
 */
export default function DocumentViewer({
  content,
  highlightPassages,
  scrollToPassage,
}: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  // Create highlighted content by wrapping matching passages with <mark> tags
  const highlightedContent = useMemo(() => {
    if (!content || highlightPassages.length === 0) {
      return content;
    }

    let result = content;
    let markIndex = 0;

    highlightPassages.forEach((passage) => {
      if (!passage || passage.length < 10) return; // Skip very short passages

      // Escape special regex characters
      const escaped = passage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Create a case-insensitive regex that handles whitespace variations
      // Replace multiple whitespace with flexible whitespace matcher
      const flexiblePattern = escaped.replace(/\s+/g, '\\s+');

      try {
        const regex = new RegExp(`(${flexiblePattern})`, 'gi');
        result = result.replace(regex, (match) => {
          markIndex++;
          return `<mark class="bg-yellow-200 dark:bg-yellow-700/50 px-0.5 rounded" data-cite="${markIndex}">${match}</mark>`;
        });
      } catch {
        // If regex fails, try simple substring match
        const lowerContent = result.toLowerCase();
        const lowerPassage = passage.toLowerCase();
        const index = lowerContent.indexOf(lowerPassage);
        if (index !== -1) {
          markIndex++;
          const before = result.substring(0, index);
          const matchedText = result.substring(index, index + passage.length);
          const after = result.substring(index + passage.length);
          result = `${before}<mark class="bg-yellow-200 dark:bg-yellow-700/50 px-0.5 rounded" data-cite="${markIndex}">${matchedText}</mark>${after}`;
        }
      }
    });

    return result;
  }, [content, highlightPassages]);

  // Auto-scroll to first highlighted passage
  useEffect(() => {
    if (!containerRef.current || hasScrolled.current) return;

    // Give the DOM time to render
    const timer = setTimeout(() => {
      const firstMark = containerRef.current?.querySelector('mark[data-cite="1"]');
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hasScrolled.current = true;
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [highlightedContent, scrollToPassage]);

  // Reset scroll flag when passage changes
  useEffect(() => {
    hasScrolled.current = false;
  }, [scrollToPassage]);

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        <p>No document content available</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto px-4 py-3"
    >
      <div
        className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-gray-700 dark:text-gray-300 font-mono text-xs leading-relaxed"
        dangerouslySetInnerHTML={{ __html: highlightedContent }}
      />
    </div>
  );
}
