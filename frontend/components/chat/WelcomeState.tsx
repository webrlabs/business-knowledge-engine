'use client';

import { useState, useMemo } from 'react';

interface WelcomeStateProps {
  onSendQuery: (query: string) => void;
}

type Category = 'all' | 'process' | 'people' | 'policy' | 'technical';

interface SuggestedQuestion {
  text: string;
  category: Category;
}

const suggestedQuestions: SuggestedQuestion[] = [
  { text: 'What are the steps in the procurement process?', category: 'process' },
  { text: 'How does the onboarding workflow function?', category: 'process' },
  { text: 'What is the change management process?', category: 'process' },
  { text: 'Who is responsible for invoice approval?', category: 'people' },
  { text: 'Who are the key stakeholders in IT governance?', category: 'people' },
  { text: 'Which teams handle compliance reviews?', category: 'people' },
  { text: 'What policies regulate data handling?', category: 'policy' },
  { text: 'What are the information security requirements?', category: 'policy' },
  { text: 'What are the data retention policies?', category: 'policy' },
  { text: 'How are API integrations managed?', category: 'technical' },
  { text: 'What systems support the HR workflow?', category: 'technical' },
  { text: 'How is the document processing pipeline structured?', category: 'technical' },
];

const categories: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'process', label: 'Process' },
  { id: 'people', label: 'People' },
  { id: 'policy', label: 'Policy' },
  { id: 'technical', label: 'Technical' },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function WelcomeState({ onSendQuery }: WelcomeStateProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('all');

  const greeting = useMemo(() => getGreeting(), []);

  const filtered = useMemo(
    () =>
      activeCategory === 'all'
        ? suggestedQuestions
        : suggestedQuestions.filter((q) => q.category === activeCategory),
    [activeCategory]
  );

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-2xl px-4">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
          <svg
            className="w-7 h-7 text-blue-500 dark:text-blue-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          {greeting}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Ask about your business processes, workflows, or policies
        </p>

        {/* Category tabs */}
        <div className="flex justify-center gap-1 mb-5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
                activeCategory === cat.id
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Suggested questions */}
        <div className="flex flex-wrap justify-center gap-2">
          {filtered.map((q) => (
            <button
              key={q.text}
              type="button"
              onClick={() => onSendQuery(q.text)}
              className="rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3.5 py-2 text-xs text-gray-600 dark:text-gray-300 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:hover:border-blue-600 dark:hover:bg-blue-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
            >
              {q.text}
            </button>
          ))}
        </div>

        <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
          Tip: Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-mono">Ctrl+Shift+N</kbd> to start a new chat anytime
        </p>
      </div>
    </div>
  );
}
