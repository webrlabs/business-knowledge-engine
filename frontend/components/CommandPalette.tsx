'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface Command {
  id: string;
  label: string;
  description: string;
  action: () => void;
  keywords?: string[];
  category: 'navigation' | 'actions' | 'settings';
  icon: React.ReactNode;
}

// Icons matching the Navigation component
const icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  documents: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  graph: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  ),
  chat: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  ),
  newChat: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  review: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  audit: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  leaderboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  communities: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  impact: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  integrations: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
    </svg>
  ),
  help: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  signOut: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
};

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const router = useRouter();
  const pathname = usePathname();

  const closeAndReset = useCallback(() => {
    setIsOpen(false);
    setSearch('');
    setSelectedIndex(0);
  }, []);

  // Define all available commands
  const commands: Command[] = [
    // Navigation commands
    {
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      description: 'Navigate to the main dashboard',
      category: 'navigation',
      icon: icons.dashboard,
      keywords: ['home', 'main', 'overview'],
      action: () => {
        router.push('/dashboard');
        closeAndReset();
      }
    },
    {
      id: 'nav-documents',
      label: 'Documents',
      description: 'Upload and manage documents',
      category: 'navigation',
      icon: icons.documents,
      keywords: ['upload', 'add', 'documents', 'files'],
      action: () => {
        router.push('/dashboard/documents');
        closeAndReset();
      }
    },
    {
      id: 'nav-graph',
      label: 'Knowledge Graph',
      description: 'Navigate to knowledge graph visualization',
      category: 'navigation',
      icon: icons.graph,
      keywords: ['graph', 'visualization', 'nodes', 'edges'],
      action: () => {
        router.push('/dashboard/graph');
        closeAndReset();
      }
    },
    {
      id: 'nav-query',
      label: 'Chat',
      description: 'Navigate to chat',
      category: 'navigation',
      icon: icons.chat,
      keywords: ['query', 'ask', 'search', 'graphrag', 'chat'],
      action: () => {
        router.push('/dashboard/query');
        closeAndReset();
      }
    },
    {
      id: 'nav-review',
      label: 'Review Queue',
      description: 'Navigate to pending review items',
      category: 'navigation',
      icon: icons.review,
      keywords: ['review', 'approve', 'pending', 'queue'],
      action: () => {
        router.push('/dashboard/review');
        closeAndReset();
      }
    },
    {
      id: 'nav-audit',
      label: 'Audit Log',
      description: 'Navigate to audit log',
      category: 'navigation',
      icon: icons.audit,
      keywords: ['audit', 'log', 'history', 'activity'],
      action: () => {
        router.push('/dashboard/audit');
        closeAndReset();
      }
    },
    {
      id: 'nav-settings',
      label: 'Settings',
      description: 'Navigate to settings page',
      category: 'navigation',
      icon: icons.settings,
      keywords: ['settings', 'preferences', 'configuration'],
      action: () => {
        router.push('/dashboard/settings');
        closeAndReset();
      }
    },
    {
      id: 'nav-leaderboard',
      label: 'Leaderboard',
      description: 'View gamification rankings',
      category: 'navigation',
      icon: icons.leaderboard,
      keywords: ['leaderboard', 'rankings', 'points', 'gamification'],
      action: () => {
        router.push('/dashboard/leaderboard');
        closeAndReset();
      }
    },
    {
      id: 'nav-communities',
      label: 'Communities',
      description: 'Explore entity communities',
      category: 'navigation',
      icon: icons.communities,
      keywords: ['communities', 'groups', 'clusters'],
      action: () => {
        router.push('/dashboard/communities');
        closeAndReset();
      }
    },
    {
      id: 'nav-impact',
      label: 'Impact Analysis',
      description: 'Analyze entity dependencies',
      category: 'navigation',
      icon: icons.impact,
      keywords: ['impact', 'analysis', 'dependencies'],
      action: () => {
        router.push('/dashboard/impact');
        closeAndReset();
      }
    },
    {
      id: 'nav-integrations',
      label: 'Integrations',
      description: 'Connect external data sources',
      category: 'navigation',
      icon: icons.integrations,
      keywords: ['integrations', 'connect', 'external'],
      action: () => {
        router.push('/dashboard/integrations');
        closeAndReset();
      }
    },
    // Chat commands
    {
      id: 'action-new-chat',
      label: 'New Chat',
      description: 'Start a new chat conversation',
      category: 'actions',
      icon: icons.newChat,
      keywords: ['new', 'chat', 'conversation', 'query'],
      action: () => {
        closeAndReset();
        // If already on query page, just dispatch the event
        if (pathname === '/dashboard/query') {
          window.dispatchEvent(new CustomEvent('bke:new-chat'));
        } else {
          // Navigate first, then dispatch the event after a delay
          router.push('/dashboard/query');
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('bke:new-chat'));
          }, 300);
        }
      }
    },
    // Action commands
    {
      id: 'action-help',
      label: 'Show Keyboard Shortcuts',
      description: 'Display all available keyboard shortcuts',
      category: 'actions',
      icon: icons.help,
      keywords: ['help', 'shortcuts', 'keys'],
      action: () => {
        alert('Keyboard Shortcuts:\n\nCtrl+K or Cmd+K - Open Command Palette\n? - Show Help\ng + d - Go to Dashboard\ng + u - Go to Upload\ng + g - Go to Graph\ng + q - Go to Query');
        closeAndReset();
      }
    },
    {
      id: 'action-sign-out',
      label: 'Sign Out',
      description: 'Sign out of your account',
      category: 'actions',
      icon: icons.signOut,
      keywords: ['logout', 'sign out', 'exit'],
      action: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('authToken');
          localStorage.removeItem('userProfile');
        }
        router.push('/');
        closeAndReset();
      }
    }
  ];

  // Filter commands based on search
  const filteredCommands = commands.filter(cmd => {
    if (!search) return true;

    const searchLower = search.toLowerCase();
    const matchesLabel = cmd.label.toLowerCase().includes(searchLower);
    const matchesDescription = cmd.description.toLowerCase().includes(searchLower);
    const matchesKeywords = cmd.keywords?.some(kw => kw.toLowerCase().includes(searchLower));

    return matchesLabel || matchesDescription || matchesKeywords;
  });

  // Sort by recent commands first
  const sortedCommands = [...filteredCommands].sort((a, b) => {
    const aRecent = recentCommands.indexOf(a.id);
    const bRecent = recentCommands.indexOf(b.id);

    if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent;
    if (aRecent !== -1) return -1;
    if (bRecent !== -1) return 1;
    return 0;
  });

  const executeCommand = useCallback((command: Command) => {
    // Add to recent commands
    setRecentCommands(prev => {
      const filtered = prev.filter(id => id !== command.id);
      return [command.id, ...filtered].slice(0, 5);
    });

    // Execute the command
    command.action();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const selectedItem = itemRefs.current.get(selectedIndex);
    if (selectedItem && listRef.current) {
      selectedItem.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [selectedIndex]);

  // Keyboard shortcut to open/close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K to open
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
        return;
      }

      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        closeAndReset();
        return;
      }

      // Arrow navigation when open
      if (isOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex(prev =>
            prev < sortedCommands.length - 1 ? prev + 1 : 0
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex(prev =>
            prev > 0 ? prev - 1 : sortedCommands.length - 1
          );
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (sortedCommands[selectedIndex]) {
            executeCommand(sortedCommands[selectedIndex]);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, sortedCommands, closeAndReset, executeCommand]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Load recent commands from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('recentCommands');
      if (stored) {
        try {
          setRecentCommands(JSON.parse(stored));
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, []);

  // Save recent commands to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('recentCommands', JSON.stringify(recentCommands));
    }
  }, [recentCommands]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={closeAndReset}
        aria-hidden="true"
      />

      {/* Command Palette */}
      <div
        className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6 md:p-20"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="mx-auto max-w-2xl transform divide-y divide-gray-200 dark:divide-gray-700 overflow-hidden rounded-xl bg-white dark:bg-gray-800 shadow-2xl ring-1 ring-black ring-opacity-5 transition-all">
          {/* Search Input */}
          <div className="relative">
            <svg
              className="pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-gray-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                clipRule="evenodd"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="h-12 w-full border-0 bg-transparent pl-11 pr-4 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
              placeholder="Type a command or search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-list"
              aria-activedescendant={sortedCommands[selectedIndex]?.id}
            />
            <div className="absolute top-3 right-4 text-xs text-gray-400 flex items-center gap-2">
              <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">ESC</kbd>
              <span>to close</span>
            </div>
          </div>

          {/* Command List */}
          {sortedCommands.length > 0 ? (
            <ul
              ref={listRef}
              id="command-list"
              className="max-h-96 scroll-py-2 overflow-y-auto py-2 list-none m-0 p-0"
              role="listbox"
            >
              {sortedCommands.map((command, index) => {
                const isRecent = recentCommands.includes(command.id);

                return (
                  <li
                    key={command.id}
                    ref={(el) => {
                      if (el) {
                        itemRefs.current.set(index, el);
                      } else {
                        itemRefs.current.delete(index);
                      }
                    }}
                    id={command.id}
                    className={`cursor-pointer select-none px-4 py-2 ${
                      index === selectedIndex
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                    onClick={() => executeCommand(command)}
                    role="option"
                    aria-selected={index === selectedIndex}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`flex-shrink-0 mt-0.5 ${
                        index === selectedIndex
                          ? 'text-white'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}>
                        {command.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{command.label}</span>
                          {isRecent && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              index === selectedIndex
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}>
                              Recent
                            </span>
                          )}
                        </div>
                        <p className={`text-sm mt-0.5 ${
                          index === selectedIndex
                            ? 'text-blue-100'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {command.description}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-14 px-4 text-center sm:px-14">
              <svg
                className="mx-auto h-6 w-6 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              <p className="mt-4 text-sm text-gray-900 dark:text-gray-100">
                No commands found
              </p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Try a different search term
              </p>
            </div>
          )}

          {/* Footer with tips */}
          <div className="flex flex-wrap items-center gap-2 bg-gray-50 dark:bg-gray-900 px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">↑↓</kbd>
              <span>Navigate</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">Enter</kbd>
              <span>Select</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600">K</kbd>
              <span>Toggle</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
