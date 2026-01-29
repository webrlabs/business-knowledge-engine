export interface Citation {
  id: string;              // Unique citation ID (e.g., "cite_1")
  documentId: string;      // Cosmos DB document ID
  documentName: string;    // Display name (e.g., "Procurement Policy.pdf")
  chunkId: string;         // Azure Search chunk ID
  passage: string;         // Exact text passage used (50-200 chars)
  pageNumber?: number;     // Page number if available
  sectionTitle?: string;   // Section title if available
}

export interface ThinkingStep {
  type: 'status' | 'documents' | 'entities' | 'relationships' | 'reasoning';
  message?: string;
  content?: string;
  items?: Array<string | { title: string; id?: string }>;
  count?: number; // Total count (items may be truncated)
}

export interface ActiveDocument {
  documentId: string;
  documentName: string;
  content: string;          // Full extracted text
  highlightPassages: string[]; // Passages to highlight
  scrollToPassage?: string; // Passage to scroll into view
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[] | string[]; // Support both rich Citation objects and legacy strings
  timestamp: string; // ISO string for serialization
  persona?: string;
  feedback?: 'up' | 'down' | null;
  isStreaming?: boolean;
  thinkingContent?: string;       // Legacy: accumulated thinking text
  thinkingSteps?: ThinkingStep[]; // New: structured thinking steps
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
