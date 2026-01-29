'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { GraphNode } from '@/lib/graph-store';
import { NODE_COLORS, getNodeColor } from '@/lib/graph-constants';

interface SearchAutocompleteProps {
  nodes: GraphNode[];
  onSelectNode: (node: GraphNode) => void;
  placeholder?: string;
}

interface SearchResult {
  id: string;
  name: string;
  type: string;
  description?: string;
  confidence?: number;
}


const RECENT_SEARCHES_KEY = 'bke-graph-recent-searches';
const MAX_RECENT_SEARCHES = 5;

export default function SearchAutocomplete({
  nodes,
  onSelectNode,
  placeholder = 'Search nodes...',
}: SearchAutocompleteProps) {
  const authFetch = useAuthFetch();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<SearchResult[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) {
        setRecentSearches(JSON.parse(saved));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Save recent search
  const addRecentSearch = useCallback((result: SearchResult) => {
    setRecentSearches((prev) => {
      const filtered = prev.filter((r) => r.id !== result.id);
      const updated = [result, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
      } catch {
        // Ignore localStorage errors
      }
      return updated;
    });
  }, []);

  // Search with debounce
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);

      try {
        // Try API search first
        const response = await authFetch(
          `${API_BASE_URL}/api/graphrag/search/autocomplete?q=${encodeURIComponent(searchQuery)}&limit=20`
        );

        if (response.ok) {
          const data = await response.json();
          const apiResults = (data.nodes || data.results || []).map((node: any) => ({
            id: node.id,
            name: node.name || node.label,
            type: node.type,
            description: node.description,
            confidence: node.confidence,
          }));
          setResults(apiResults);
        } else {
          // Fall back to local search
          performLocalSearch(searchQuery);
        }
      } catch {
        // Fall back to local search on error
        performLocalSearch(searchQuery);
      } finally {
        setLoading(false);
      }
    },
    [authFetch, nodes]
  );

  // Local search fallback
  const performLocalSearch = (searchQuery: string) => {
    const lowerQuery = searchQuery.toLowerCase();
    const localResults = nodes
      .filter(
        (node) =>
          node.label.toLowerCase().includes(lowerQuery) ||
          node.type.toLowerCase().includes(lowerQuery) ||
          (node.description && node.description.toLowerCase().includes(lowerQuery))
      )
      .slice(0, 20)
      .map((node) => ({
        id: node.id,
        name: node.label,
        type: node.type,
        description: node.description,
        confidence: node.confidence,
      }));
    setResults(localResults);
  };

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.trim()) {
      debounceRef.current = setTimeout(() => {
        performSearch(query);
      }, 300);
    } else {
      setResults([]);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, performSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = query.trim() ? results : recentSearches;

    if (!isOpen || items.length === 0) {
      if (e.key === 'Enter' && query.trim()) {
        // If no results, try to find exact match in nodes
        const exactMatch = nodes.find(
          (n) => n.label.toLowerCase() === query.toLowerCase()
        );
        if (exactMatch) {
          handleSelect({
            id: exactMatch.id,
            name: exactMatch.label,
            type: exactMatch.type,
          });
        }
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < items.length) {
          handleSelect(items[highlightIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  const handleSelect = (result: SearchResult) => {
    // Find the corresponding node from the nodes array
    const node = nodes.find(
      (n) => n.id === result.id || n.label === result.name
    );

    if (node) {
      addRecentSearch(result);
      onSelectNode(node);
      setQuery('');
      setIsOpen(false);
      setHighlightIndex(-1);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightIndex] as HTMLElement;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const showRecent = !query.trim() && recentSearches.length > 0;
  const items = showRecent ? recentSearches : results;

  return (
    <div className="relative">
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
          {loading ? (
            <div className="w-4 h-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"></div>
          ) : (
            <svg
              className="w-4 h-4 text-gray-400"
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
          )}
        </div>
        <input
          ref={inputRef}
          type="text"
          data-graph-search
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setHighlightIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full pl-8 pr-6 py-1.5 text-sm border-0 bg-transparent focus:ring-0 focus:outline-none text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 pr-1 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && items.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-64 overflow-y-auto"
        >
          {showRecent && (
            <li className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-gray-900">
              Recent Searches
            </li>
          )}
          {items.map((item, index) => (
            <li
              key={item.id}
              className={`flex items-start gap-3 px-3 py-2 cursor-pointer ${
                index === highlightIndex
                  ? 'bg-blue-50 dark:bg-blue-900/50'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              onClick={() => handleSelect(item)}
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0 mt-1"
                style={{ backgroundColor: NODE_COLORS[item.type] || '#64748B' }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {item.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                    {item.type}
                  </span>
                </div>
                {item.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {item.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* No Results */}
      {isOpen && query.trim() && !loading && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4 text-center">
          <svg
            className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No nodes found for "{query}"
          </p>
        </div>
      )}

      {/* Keyboard Shortcut Hint */}
      <div className="hidden sm:flex items-center gap-1 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
        <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">
          /
        </kbd>
      </div>
    </div>
  );
}
