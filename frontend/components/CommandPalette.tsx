'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface Command {
  id: string;
  label: string;
  description: string;
  action: () => void;
  keywords?: string[];
  category: 'navigation' | 'actions' | 'settings';
  icon?: string;
}

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Define all available commands
  const commands: Command[] = [
    // Navigation commands
    {
      id: 'nav-dashboard',
      label: 'Go to Dashboard',
      description: 'Navigate to the main dashboard',
      category: 'navigation',
      icon: '📊',
      keywords: ['home', 'main', 'overview'],
      action: () => {
        router.push('/dashboard');
        closeAndReset();
      }
    },
    {
      id: 'nav-upload',
      label: 'Upload Documents',
      description: 'Navigate to document upload page',
      category: 'navigation',
      icon: '📤',
      keywords: ['upload', 'add', 'documents', 'files'],
      action: () => {
        router.push('/dashboard/upload');
        closeAndReset();
      }
    },
    {
      id: 'nav-graph',
      label: 'Knowledge Graph',
      description: 'Navigate to knowledge graph visualization',
      category: 'navigation',
      icon: '🕸️',
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
      icon: '💬',
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
      icon: '✅',
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
      icon: '📝',
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
      icon: '⚙️',
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
      icon: '🏆',
      keywords: ['leaderboard', 'rankings', 'points', 'gamification'],
      action: () => {
        router.push('/dashboard/leaderboard');
        closeAndReset();
      }
    },
    {
      id: 'nav-achievements',
      label: 'My Achievements',
      description: 'View your badges and achievements',
      category: 'navigation',
      icon: '🎖️',
      keywords: ['badges', 'achievements', 'rewards', 'progress'],
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
      icon: '👥',
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
      icon: '📊',
      keywords: ['impact', 'analysis', 'dependencies'],
      action: () => {
        router.push('/dashboard/impact');
        closeAndReset();
      }
    },
    // Chat commands
    {
      id: 'action-new-chat',
      label: 'New Chat',
      description: 'Start a new chat conversation',
      category: 'actions',
      icon: '💬',
      keywords: ['new', 'chat', 'conversation', 'query'],
      action: () => {
        router.push('/dashboard/query');
        // Trigger new chat after navigation
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('bke:new-chat'));
        }, 100);
        closeAndReset();
      }
    },
    // Action commands
    {
      id: 'action-help',
      label: 'Show Keyboard Shortcuts',
      description: 'Display all available keyboard shortcuts',
      category: 'actions',
      icon: '❓',
      keywords: ['help', 'shortcuts', 'keys'],
      action: () => {
        // This will show the shortcuts help - we'll implement this
        alert('Keyboard Shortcuts:\n\nCtrl+K or Cmd+K - Open Command Palette\n? - Show Help\ng + d - Go to Dashboard\ng + u - Go to Upload\ng + g - Go to Graph\ng + q - Go to Query');
        closeAndReset();
      }
    },
    {
      id: 'action-sign-out',
      label: 'Sign Out',
      description: 'Sign out of your account',
      category: 'actions',
      icon: '🚪',
      keywords: ['logout', 'sign out', 'exit'],
      action: () => {
        // Clear auth and redirect to home
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

  const closeAndReset = useCallback(() => {
    setIsOpen(false);
    setSearch('');
    setSelectedIndex(0);
  }, []);

  const executeCommand = useCallback((command: Command) => {
    // Add to recent commands
    setRecentCommands(prev => {
      const filtered = prev.filter(id => id !== command.id);
      return [command.id, ...filtered].slice(0, 5); // Keep last 5
    });

    // Execute the command
    command.action();
  }, []);

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
            prev < sortedCommands.length - 1 ? prev + 1 : prev
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : 0);
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
        } catch (e) {
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
              id="command-list"
              className="max-h-96 scroll-py-2 overflow-y-auto py-2"
              role="listbox"
            >
              {sortedCommands.map((command, index) => {
                const isRecent = recentCommands.includes(command.id);

                return (
                  <li
                    key={command.id}
                    id={command.id}
                    className={`cursor-pointer select-none px-4 py-2 ${
                      index === selectedIndex
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                    onClick={() => executeCommand(command)}
                    role="option"
                    aria-selected={index === selectedIndex}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0 mt-0.5">
                        {command.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{command.label}</span>
                          {isRecent && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              index === selectedIndex
                                ? 'bg-indigo-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                            }`}>
                              Recent
                            </span>
                          )}
                        </div>
                        <p className={`text-sm mt-0.5 ${
                          index === selectedIndex
                            ? 'text-indigo-100'
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
