import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, Conversation } from './chat-types';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function deriveTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  if (trimmed.length <= 50) return trimmed;
  return trimmed.slice(0, 47) + '...';
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  sidebarOpen: boolean;

  // Computed-like getters
  getActiveConversation: () => Conversation | undefined;
  getMessages: () => ChatMessage[];

  // Conversation CRUD
  createConversation: (persona?: string) => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setActiveConversation: (id: string | null) => void;

  // Message CRUD
  addMessage: (message: Omit<ChatMessage, 'id'>) => string;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setMessageFeedback: (messageId: string, feedback: 'up' | 'down' | null) => void;

  // UI
  setSidebarOpen: (open: boolean) => void;

  // Search
  searchConversations: (query: string) => Conversation[];
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      sidebarOpen: true,

      getActiveConversation: () => {
        const { conversations, activeConversationId } = get();
        return conversations.find((c) => c.id === activeConversationId);
      },

      getMessages: () => {
        const conv = get().getActiveConversation();
        return conv?.messages ?? [];
      },

      createConversation: (persona = 'default') => {
        const id = generateId();
        const now = new Date().toISOString();
        const conversation: Conversation = {
          id,
          title: 'New Chat',
          messages: [],
          persona,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          conversations: [conversation, ...state.conversations],
          activeConversationId: id,
        }));
        return id;
      },

      deleteConversation: (id) => {
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== id);
          const newActive =
            state.activeConversationId === id
              ? filtered[0]?.id ?? null
              : state.activeConversationId;
          return { conversations: filtered, activeConversationId: newActive };
        });
      },

      renameConversation: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c
          ),
        }));
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id });
      },

      addMessage: (message) => {
        const id = generateId();
        const fullMessage: ChatMessage = { ...message, id };

        set((state) => {
          const convId = state.activeConversationId;
          if (!convId) return state;

          return {
            conversations: state.conversations.map((c) => {
              if (c.id !== convId) return c;
              const updated = {
                ...c,
                messages: [...c.messages, fullMessage],
                updatedAt: new Date().toISOString(),
              };
              // Auto-title from first user message
              if (
                message.role === 'user' &&
                c.messages.length === 0 &&
                c.title === 'New Chat'
              ) {
                updated.title = deriveTitle(message.content);
              }
              return updated;
            }),
          };
        });
        return id;
      },

      updateMessage: (id, updates) => {
        set((state) => ({
          conversations: state.conversations.map((c) => {
            const idx = c.messages.findIndex((m) => m.id === id);
            if (idx === -1) return c;
            const newMessages = [...c.messages];
            newMessages[idx] = { ...newMessages[idx], ...updates };
            return { ...c, messages: newMessages, updatedAt: new Date().toISOString() };
          }),
        }));
      },

      setMessageFeedback: (messageId, feedback) => {
        get().updateMessage(messageId, { feedback });
      },

      setSidebarOpen: (open) => {
        set({ sidebarOpen: open });
      },

      searchConversations: (query) => {
        const { conversations } = get();
        if (!query.trim()) return conversations;
        const lower = query.toLowerCase();
        return conversations.filter(
          (c) =>
            c.title.toLowerCase().includes(lower) ||
            c.messages.some((m) => m.content.toLowerCase().includes(lower))
        );
      },
    }),
    {
      name: 'bke-chat-store',
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
