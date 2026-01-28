'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Modal from './Modal';

interface Shortcut {
  keys: string;
  description: string;
  category: 'navigation' | 'actions' | 'general';
}

// Define shortcuts for display (outside component to avoid recreation)
const shortcutsForDisplay: Shortcut[] = [
  // General shortcuts
  { keys: '?', description: 'Show keyboard shortcuts', category: 'general' },
  { keys: 'Ctrl+K', description: 'Open command palette', category: 'general' },
  { keys: 'Esc', description: 'Close dialogs and modals', category: 'general' },

  // Navigation shortcuts (g + letter pattern)
  { keys: 'g d', description: 'Go to Dashboard', category: 'navigation' },
  { keys: 'g u', description: 'Go to Upload Documents', category: 'navigation' },
  { keys: 'g g', description: 'Go to Knowledge Graph', category: 'navigation' },
  { keys: 'g q', description: 'Go to GraphRAG Query', category: 'navigation' },
  { keys: 'g r', description: 'Go to Review Queue', category: 'navigation' },
  { keys: 'g a', description: 'Go to Audit Log', category: 'navigation' },
  { keys: 'g s', description: 'Go to Settings', category: 'navigation' },

  // Action shortcuts
  { keys: 'Ctrl+Shift+N', description: 'New chat', category: 'actions' },
  { keys: 'Ctrl+S', description: 'Save (where applicable)', category: 'actions' },
  { keys: 'Ctrl+Enter', description: 'Submit form', category: 'actions' },
  { keys: '/', description: 'Focus search', category: 'actions' },
  { keys: 'Esc', description: 'Stop generation / close dialogs', category: 'actions' },
];

export default function KeyboardShortcuts() {
  const [showHelp, setShowHelp] = useState(false);
  const [sequenceBuffer, setSequenceBuffer] = useState<string[]>([]);
  const [sequenceTimeout, setSequenceTimeout] = useState<NodeJS.Timeout | null>(null);
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        // Allow Ctrl+K even in inputs for command palette
        if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
          return; // Let it bubble up
        }
        return;
      }

      // Handle Escape to close help modal
      if (e.key === 'Escape' && showHelp) {
        e.preventDefault();
        setShowHelp(false);
        return;
      }

      // Handle '?' to show help
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowHelp(true);
        return;
      }

      // Handle Ctrl+Shift+N for new chat
      if (e.key === 'N' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        router.push('/dashboard/query');
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('bke:new-chat'));
        }, 100);
        return;
      }

      // Handle single-key shortcuts
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
        return;
      }

      // Handle 'g' key to start sequence
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey && sequenceBuffer.length === 0) {
        e.preventDefault();
        setSequenceBuffer(['g']);

        // Clear buffer after 1 second
        if (sequenceTimeout) clearTimeout(sequenceTimeout);
        const timeout = setTimeout(() => {
          setSequenceBuffer([]);
        }, 1000);
        setSequenceTimeout(timeout);
        return;
      }

      // Handle second key in 'g + letter' sequence
      if (sequenceBuffer.length === 1 && sequenceBuffer[0] === 'g') {
        e.preventDefault();

        // Clear the timeout
        if (sequenceTimeout) clearTimeout(sequenceTimeout);

        // Map keys to routes
        const routeMap: Record<string, string> = {
          'd': '/dashboard',
          'u': '/dashboard/upload',
          'g': '/dashboard/graph',
          'q': '/dashboard/query',
          'r': '/dashboard/review',
          'a': '/dashboard/audit',
          's': '/dashboard/settings',
        };

        const route = routeMap[e.key];
        if (route) {
          router.push(route);
        }

        setSequenceBuffer([]);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (sequenceTimeout) clearTimeout(sequenceTimeout);
    };
  }, [showHelp, sequenceBuffer, sequenceTimeout, router]);

  // Group shortcuts by category
  const groupedShortcuts = shortcutsForDisplay.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  const categoryNames = {
    general: 'General',
    navigation: 'Navigation',
    actions: 'Actions',
  };

  return (
    <>
      {showHelp && (
        <Modal
          isOpen={showHelp}
          onClose={() => setShowHelp(false)}
          title="Keyboard Shortcuts"
          size="large"
        >
          <div className="space-y-6">
            <p className="text-gray-600 dark:text-gray-400">
              Use these keyboard shortcuts to navigate and interact with the platform quickly.
            </p>

            {Object.entries(groupedShortcuts).map(([category, categoryShortcuts]) => (
              <div key={category}>
                <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">
                  {categoryNames[category as keyof typeof categoryNames]}
                </h3>
                <div className="space-y-2">
                  {categoryShortcuts.map((shortcut) => (
                    <div
                      key={shortcut.keys}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <span className="text-gray-700 dark:text-gray-300">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.split(' ').map((key, index) => (
                          <span key={index} className="flex items-center gap-1">
                            {index > 0 && (
                              <span className="text-gray-400 dark:text-gray-500 text-sm">
                                then
                              </span>
                            )}
                            <kbd
                              className="px-2 py-1 text-sm font-semibold text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded shadow-sm"
                            >
                              {key}
                            </kbd>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <strong>Tip:</strong> Press <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded">g</kbd> followed by a letter to quickly navigate to different pages.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* Visual indicator when 'g' is pressed */}
      {sequenceBuffer.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-50 px-4 py-2 bg-gray-900 dark:bg-gray-800 text-white rounded-lg shadow-lg border border-gray-700 flex items-center gap-2"
          role="status"
          aria-live="polite"
        >
          <kbd className="px-2 py-1 text-sm font-semibold bg-gray-800 dark:bg-gray-900 border border-gray-600 rounded">
            {sequenceBuffer.join(' ')}
          </kbd>
          <span className="text-sm text-gray-300">waiting for next key...</span>
        </div>
      )}
    </>
  );
}
