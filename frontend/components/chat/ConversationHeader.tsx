'use client';

import { useState, useRef, useEffect } from 'react';

interface ConversationHeaderProps {
  title: string;
  persona?: string;
  onRename: (title: string) => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}

export default function ConversationHeader({
  title,
  persona,
  onRename,
  onToggleSidebar,
  sidebarOpen,
}: ConversationHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(title);
  }, [title]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title) {
      onRename(trimmed);
    } else {
      setEditValue(title);
    }
    setIsEditing(false);
  };

  const personaLabels: Record<string, string> = {
    ops: 'Operations',
    it: 'IT',
    leadership: 'Leadership',
    compliance: 'Compliance',
    default: 'General',
  };

  const personaColors: Record<string, string> = {
    ops: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    it: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    leadership: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    compliance: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      {/* Sidebar toggle */}
      <button
        type="button"
        onClick={onToggleSidebar}
        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {sidebarOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Title */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                setEditValue(title);
                setIsEditing(false);
              }
            }}
            className="flex-1 px-2 py-1 text-sm font-medium bg-white dark:bg-gray-900 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 dark:text-white"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="group/title flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="Click to rename"
          >
            <span className="truncate">{title}</span>
            <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover/title:opacity-60 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        )}

        {persona && persona !== 'default' && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${personaColors[persona] || personaColors.default}`}>
            {personaLabels[persona] || persona}
          </span>
        )}
      </div>
    </div>
  );
}
