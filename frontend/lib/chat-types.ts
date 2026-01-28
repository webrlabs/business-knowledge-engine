export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  timestamp: string; // ISO string for serialization
  persona?: string;
  feedback?: 'up' | 'down' | null;
  isStreaming?: boolean;
  thinkingContent?: string;
  isError?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  persona: string;
  createdAt: string;
  updatedAt: string;
}

export type ConversationSortOrder = 'newest' | 'oldest';
