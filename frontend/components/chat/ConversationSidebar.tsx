'use client';

import { useState, useMemo } from 'react';
import { useChatStore } from '@/lib/chat-store';
import ConversationItem from './ConversationItem';

interface ConversationSidebarProps {
  onNewChat: () => void;
}

function groupByDate(conversations: { id: string; updatedAt: string }[]) {
  const groups: Record<string, string[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  for (const conv of conversations) {
    const d = new Date(conv.updatedAt);
    let label: string;
    if (d >= today) label = 'Today';
    else if (d >= yesterday) label = 'Yesterday';
    else if (d >= weekAgo) label = 'Previous 7 Days';
    else label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    if (!groups[label]) groups[label] = [];
    groups[label].push(conv.id);
  }

  return groups;
}

export default function ConversationSidebar({ onNewChat }: ConversationSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    renameConversation,
    deleteConversation,
    searchConversations,
  } = useChatStore();

  const filtered = useMemo(
    () => (searchQuery ? searchConversations(searchQuery) : conversations),
    [searchQuery, searchConversations, conversations]
  );

  const groups = useMemo(() => groupByDate(filtered), [filtered]);
  const conversationMap = useMemo(() => {
    const map = new Map<string, (typeof conversations)[0]>();
    for (const c of filtered) map.set(c.id, c);
    return map;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 ? (
          <div className="text-center py-8 px-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {searchQuery ? 'No conversations found' : 'No conversations yet'}
            </p>
            {!searchQuery && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Start a new chat to begin
              </p>
            )}
          </div>
        ) : (
          Object.entries(groups).map(([label, ids]) => (
            <div key={label} className="mt-1.5 first:mt-0">
              <p className="px-2 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {label}
              </p>
              <div className="space-y-0.5">
                {ids.map((id) => {
                  const conv = conversationMap.get(id);
                  if (!conv) return null;
                  return (
                    <ConversationItem
                      key={conv.id}
                      id={conv.id}
                      title={conv.title}
                      isActive={conv.id === activeConversationId}
                      updatedAt={conv.updatedAt}
                      messageCount={conv.messages.length}
                      onClick={() => setActiveConversation(conv.id)}
                      onRename={renameConversation}
                      onDelete={deleteConversation}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
