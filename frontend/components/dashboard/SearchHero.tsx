'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import type { SearchSuggestion } from '@/lib/gamification-types';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

interface SearchHeroProps {
  firstName?: string;
}

const SAMPLE_QUESTIONS = [
  'What are the key risks identified in our latest audit?',
  'Show me all contracts expiring in the next 90 days',
  'Which suppliers have the highest compliance scores?',
  'Summarize recent changes to our data governance policies',
  'What entities are connected to Project Alpha?',
  'Find documents mentioning revenue forecasts for Q3',
];

export default function SearchHero({ firstName }: SearchHeroProps) {
  const router = useRouter();
  const authFetch = useAuthFetch();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flatten suggestions into a single navigable list
  const flatSuggestions = useCallback((): string[] => {
    if (!suggestions) return [];
    const items: string[] = [];
    suggestions.entities.forEach((e) => items.push(e.name));
    suggestions.popularQueries.forEach((q) => items.push(q.query));
    return items;
  }, [suggestions]);

  // Fetch autocomplete suggestions with 300ms debounce
  const fetchSuggestions = useCallback(
    (searchQuery: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (!searchQuery.trim() || searchQuery.trim().length < 2) {
        setSuggestions(null);
        setIsLoadingSuggestions(false);
        return;
      }

      setIsLoadingSuggestions(true);

      debounceTimerRef.current = setTimeout(async () => {
        try {
          const response = await authFetch(
            `${API_BASE_URL}/api/search/suggest?q=${encodeURIComponent(searchQuery)}`
          );
          if (response.ok) {
            const data: SearchSuggestion = await response.json();
            setSuggestions(data);
          } else {
            setSuggestions(null);
          }
        } catch {
          setSuggestions(null);
        } finally {
          setIsLoadingSuggestions(false);
        }
      }, 300);
    },
    [authFetch]
  );

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24; // ~text-base line-height
    const maxHeight = lineHeight * 4;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setQuery(value);
    setSelectedSuggestionIndex(-1);
    fetchSuggestions(value);
    autoResize();
  };

  // Handle search submission
  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSuggestions(null);
    router.push(`/dashboard/query?q=${encodeURIComponent(trimmed)}`);
  };

  // Select a suggestion
  const handleSelectSuggestion = (text: string) => {
    setQuery(text);
    setSuggestions(null);
    setSelectedSuggestionIndex(-1);
    router.push(`/dashboard/query?q=${encodeURIComponent(text)}`);
  };

  // Select a sample question
  const handleSelectSample = (question: string) => {
    setQuery(question);
    setSuggestions(null);
    router.push(`/dashboard/query?q=${encodeURIComponent(question)}`);
  };

  // "/" keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        !document.activeElement?.getAttribute('contenteditable')
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Keyboard navigation within suggestions
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const items = flatSuggestions();

    if (e.key === 'ArrowDown' && hasSuggestions) {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev < items.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp' && hasSuggestions) {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev > 0 ? prev - 1 : items.length - 1
      );
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0 && selectedSuggestionIndex < items.length) {
        handleSelectSuggestion(items[selectedSuggestionIndex]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'Escape') {
      setSuggestions(null);
      setSelectedSuggestionIndex(-1);
      inputRef.current?.blur();
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setSuggestions(null);
        setSelectedSuggestionIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const hasSuggestions =
    suggestions &&
    (suggestions.entities.length > 0 || suggestions.popularQueries.length > 0);

  let flatIndex = 0;

  return (
    <div className="w-full">
      <div className="mx-auto max-w-3xl">
        {/* Greeting */}
        <h1 className="mb-4 text-center text-2xl font-semibold text-gray-900 dark:text-white">
          {getGreeting()}{firstName ? `, ${firstName}` : ''}
        </h1>

        {/* Search Input + Mode Toggle */}
        <form onSubmit={handleSubmit} className="relative">
          <div
            className={`relative rounded-xl transition-all ${
              isFocused
                ? 'ring-2 ring-blue-500/40 shadow-md shadow-blue-500/10 dark:ring-blue-400/30 dark:shadow-blue-500/5'
                : 'ring-1 ring-gray-200 dark:ring-gray-700'
            }`}
          >
            <div className="relative flex items-start rounded-xl bg-white dark:bg-gray-900">
              {/* Search Icon */}
              <div className="pointer-events-none pl-4 pt-3 text-gray-400 dark:text-gray-500">
                <svg
                  className="h-5 w-5"
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
              </div>

              <textarea
                ref={inputRef}
                value={query}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder="Ask a question about your knowledge base..."
                rows={1}
                className="w-full resize-none border-0 bg-transparent px-3 py-3 text-sm text-gray-900 placeholder-gray-400 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 dark:text-white dark:placeholder-gray-500 sm:text-base"
                autoComplete="off"
                aria-label="Search knowledge base"
                aria-expanded={!!hasSuggestions}
                role="combobox"
                aria-controls="search-suggestions"
                aria-activedescendant={
                  selectedSuggestionIndex >= 0
                    ? `suggestion-${selectedSuggestionIndex}`
                    : undefined
                }
              />

              {/* Loading spinner */}
              {isLoadingSuggestions && (
                <div className="pr-2 pt-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 dark:border-gray-600 dark:border-t-blue-400" />
                </div>
              )}

              {/* Keyboard shortcut hint */}
              {!isFocused && !query && (
                <div className="pr-3 pt-2">
                  <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500">
                    /
                  </kbd>
                </div>
              )}

              {/* Submit button */}
              {query && (
                <button
                  type="submit"
                  className="mr-2 mt-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  Search
                </button>
              )}
            </div>
          </div>

          {/* Autocomplete Dropdown */}
          {hasSuggestions && (
            <div
              ref={dropdownRef}
              id="search-suggestions"
              role="listbox"
              className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
            >
              {/* Entity Suggestions */}
              {suggestions.entities.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Entities
                  </div>
                  {suggestions.entities.map((entity) => {
                    const currentIndex = flatIndex++;
                    return (
                      <button
                        key={`entity-${entity.name}-${entity.type}`}
                        id={`suggestion-${currentIndex}`}
                        role="option"
                        aria-selected={selectedSuggestionIndex === currentIndex}
                        type="button"
                        onClick={() => handleSelectSuggestion(entity.name)}
                        onMouseEnter={() => setSelectedSuggestionIndex(currentIndex)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          selectedSuggestionIndex === currentIndex
                            ? 'bg-blue-50 dark:bg-blue-900/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-sm font-medium text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                          {entity.type.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                            {entity.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {entity.type}
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {Math.round(entity.score * 100)}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Popular Queries */}
              {suggestions.popularQueries.length > 0 && (
                <div>
                  {suggestions.entities.length > 0 && (
                    <div className="border-t border-gray-100 dark:border-gray-800" />
                  )}
                  <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Popular Searches
                  </div>
                  {suggestions.popularQueries.map((pq) => {
                    const currentIndex = flatIndex++;
                    return (
                      <button
                        key={`query-${pq.query}`}
                        id={`suggestion-${currentIndex}`}
                        role="option"
                        aria-selected={selectedSuggestionIndex === currentIndex}
                        type="button"
                        onClick={() => handleSelectSuggestion(pq.query)}
                        onMouseEnter={() => setSelectedSuggestionIndex(currentIndex)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          selectedSuggestionIndex === currentIndex
                            ? 'bg-blue-50 dark:bg-blue-900/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                          {pq.query}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {pq.count} searches
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </form>

        {/* Sample Questions (shown when input is empty) */}
        {!query && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">Try:</span>
            {SAMPLE_QUESTIONS.slice(0, 4).map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => handleSelectSample(question)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:border-blue-600 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
              >
                {question}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
