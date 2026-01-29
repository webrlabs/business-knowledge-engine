'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE_URL, useAuthFetch, useAuthToken } from '@/lib/api';
import { streamChatResponse } from '@/lib/chat-stream';
import { useToast, ToastContainer } from '@/components/Toast';
import { useChatStore } from '@/lib/chat-store';
import type { ChatMessage, Citation, ThinkingStep } from '@/lib/chat-types';
import MessageBubble from './MessageBubble';
import ChatInput, { ChatInputHandle } from './ChatInput';
import WelcomeState from './WelcomeState';
import TypingIndicator from './TypingIndicator';
import DisclaimerFooter from './DisclaimerFooter';
import ConversationSidebar from './ConversationSidebar';
import ConversationHeader from './ConversationHeader';
import DocumentPanel from './DocumentPanel';

export default function ChatContainer() {
  const toast = useToast();
  const authFetch = useAuthFetch();
  const getAuthToken = useAuthToken();
  const searchParams = useSearchParams();

  const {
    activeConversationId,
    getActiveConversation,
    getMessages,
    createConversation,
    addMessage,
    updateMessage,
    setMessageFeedback,
    renameConversation,
    sidebarOpen,
    setSidebarOpen,
    documentPanelOpen,
    setActiveDocument,
  } = useChatStore();

  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const hasAutoSent = useRef(false);
  const personaRef = useRef('default');
  const abortControllerRef = useRef<AbortController | null>(null);

  const conversation = getActiveConversation();
  const messages = getMessages();

  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [streamingSpacer, setStreamingSpacer] = useState(0);
  const prevConversationId = useRef(activeConversationId);

  // Brief fade transition when switching conversations
  useEffect(() => {
    if (prevConversationId.current !== activeConversationId) {
      setIsSwitching(true);
      const timer = setTimeout(() => setIsSwitching(false), 150);
      prevConversationId.current = activeConversationId;
      return () => clearTimeout(timer);
    }
  }, [activeConversationId]);

  // Scroll to position the user's query at the very top when response starts
  const scrollUserQueryToTop = useCallback(() => {
    const container = messagesAreaRef.current;
    if (!container || messages.length < 1) return;

    // Find the last user message element
    const messageElements = container.querySelectorAll('[data-message-role]');
    const lastUserMessage = Array.from(messageElements)
      .reverse()
      .find(el => el.getAttribute('data-message-role') === 'user') as HTMLElement | undefined;

    if (lastUserMessage) {
      const containerHeight = container.clientHeight;
      const messageRect = lastUserMessage.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Calculate how much spacer we need so we can scroll the user message to the top
      // We want: spacer = container height - user message height - some padding for response to start
      const spacerNeeded = containerHeight - messageRect.height - 80;
      setStreamingSpacer(Math.max(0, spacerNeeded));

      // After spacer is added and rendered, scroll to position
      setTimeout(() => {
        const updatedRect = lastUserMessage.getBoundingClientRect();
        const scrollOffset = updatedRect.top - containerRect.top + container.scrollTop - 24;
        container.scrollTo({
          top: scrollOffset,
          behavior: 'smooth'
        });
      }, 50);
    }
  }, [messages.length]);

  // When streaming starts, scroll user query to top once
  const hasScrolledForStream = useRef(false);

  useEffect(() => {
    if (isStreaming && !hasScrolledForStream.current) {
      hasScrolledForStream.current = true;
      // Small delay to let the DOM update
      setTimeout(scrollUserQueryToTop, 100);
    }
    if (!isStreaming) {
      hasScrolledForStream.current = false;
      setStreamingSpacer(0); // Remove spacer when done
    }
  }, [isStreaming, scrollUserQueryToTop]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setIsLoading(false);
  }, []);

  const sendQuery = useCallback(
    async (queryText: string, files?: File[]) => {
      if (isLoading) return;

      // Ensure we have a conversation
      let convId = activeConversationId;
      if (!convId) {
        convId = createConversation(personaRef.current);
      }

      const userMessage: Omit<ChatMessage, 'id'> = {
        role: 'user',
        content: queryText,
        timestamp: new Date().toISOString(),
        persona: personaRef.current,
      };

      addMessage(userMessage);
      setIsLoading(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Create a placeholder assistant message
      const assistantMsgId = addMessage({
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        persona: personaRef.current,
        isStreaming: true,
      });

      setIsStreaming(true);

      try {
        if (files && files.length > 0) {
          // Use upload endpoint with FormData (non-streaming)
          const formData = new FormData();
          formData.append('query', queryText);
          formData.append('persona', personaRef.current);
          files.forEach((file) => formData.append('files', file));

          const response = await authFetch(`${API_BASE_URL}/api/graphrag/query/upload`, {
            method: 'POST',
            body: formData,
            signal: abortController.signal,
          });

          if (!response.ok) throw new Error('Query failed');
          const data = await response.json();

          updateMessage(assistantMsgId, {
            content: data.answer,
            citations: data.citations || [],
            isStreaming: false,
          });
        } else {
          // Use streaming endpoint
          const token = await getAuthToken();
          let accumulatedContent = '';
          const thinkingSteps: ThinkingStep[] = [];
          let citations: string[] = [];

          await streamChatResponse(
            `${API_BASE_URL}/api/graphrag/query/stream`,
            { query: queryText, options: { persona: personaRef.current } },
            { Authorization: `Bearer ${token}` },
            {
              onContent: (text) => {
                accumulatedContent += text;
                updateMessage(assistantMsgId, {
                  content: accumulatedContent,
                  thinkingSteps: thinkingSteps.length > 0 ? [...thinkingSteps] : undefined,
                  isStreaming: true,
                });
              },
              onThinking: (step: ThinkingStep) => {
                // For reasoning type, accumulate content into the last reasoning step
                if (step.type === 'reasoning') {
                  const lastStep = thinkingSteps[thinkingSteps.length - 1];
                  if (lastStep && lastStep.type === 'reasoning') {
                    lastStep.content = (lastStep.content || '') + (step.content || '');
                  } else {
                    thinkingSteps.push({ ...step });
                  }
                } else {
                  thinkingSteps.push(step);
                }
                updateMessage(assistantMsgId, {
                  content: accumulatedContent,
                  thinkingSteps: [...thinkingSteps],
                  isStreaming: true,
                });
              },
              onMetadata: (data) => {
                if (data.citations) {
                  citations = data.citations;
                }
              },
              onDone: () => {
                updateMessage(assistantMsgId, {
                  content: accumulatedContent,
                  citations,
                  thinkingSteps: thinkingSteps.length > 0 ? [...thinkingSteps] : undefined,
                  isStreaming: false,
                });
              },
              onError: (error) => {
                throw error;
              },
            },
            abortController.signal
          );
        }

      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          updateMessage(assistantMsgId, {
            content: 'Response generation was stopped.',
            isStreaming: false,
          });
        } else {
          updateMessage(assistantMsgId, {
            content: 'Sorry, I encountered an error processing your query. Please try again.',
            isStreaming: false,
            isError: true,
          });

          toast.error(
            'Query Failed',
            'Unable to process your query. Please check your connection and try again.',
            7000
          );
        }
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoading, activeConversationId, authFetch, getAuthToken, toast, addMessage, updateMessage, createConversation]
  );

  // Auto-send from URL search params — always start a new conversation
  useEffect(() => {
    if (hasAutoSent.current) return;
    const q = searchParams.get('q');
    if (q) {
      hasAutoSent.current = true;
      createConversation(personaRef.current);
      sendQuery(q);
    }
  }, [searchParams, sendQuery, createConversation]);

  const handleRetry = useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        sendQuery(messages[i].content);
        break;
      }
    }
  }, [messages, sendQuery]);

  const handleFeedback = useCallback(
    (messageId: string, feedback: 'up' | 'down' | null) => {
      setMessageFeedback(messageId, feedback);
    },
    [setMessageFeedback]
  );

  const handlePersonaChange = useCallback((persona: string) => {
    personaRef.current = persona;
  }, []);

  const handleNewChat = useCallback(() => {
    createConversation(personaRef.current);
    setMobileSidebarOpen(false);
  }, [createConversation]);

  const handleRenameConversation = useCallback(
    (title: string) => {
      if (activeConversationId) {
        renameConversation(activeConversationId, title);
      }
    },
    [activeConversationId, renameConversation]
  );

  const handleToggleSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setMobileSidebarOpen((prev) => !prev);
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  }, [sidebarOpen, setSidebarOpen]);

  // Keyboard shortcuts: Escape stops generation, letter keys auto-focus input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key stops generation
      if (e.key === 'Escape' && isStreaming) {
        handleStop();
        return;
      }

      // Auto-focus chat input when typing a letter key
      // Skip if modifier keys are held or if already focused on an input/textarea
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const activeEl = document.activeElement;
      const isInputFocused = activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';
      if (isInputFocused) return;

      // Check if it's a single printable character (letter, number, etc.)
      if (e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key)) {
        e.preventDefault();
        chatInputRef.current?.insertText(e.key);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStreaming, handleStop]);

  // Listen for new-chat event from CommandPalette
  useEffect(() => {
    const handler = () => handleNewChat();
    window.addEventListener('bke:new-chat', handler);
    return () => window.removeEventListener('bke:new-chat', handler);
  }, [handleNewChat]);

  // Find last assistant message index for retry button
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  // Handle citation click to open document panel
  const handleCitationClick = useCallback(
    (citation: Citation) => {
      setActiveDocument(citation, authFetch);
    },
    [setActiveDocument, authFetch]
  );

  return (
    <>
      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
      <div className="h-full flex">
        {/* Desktop sidebar */}
        <div
          className={`hidden lg:block flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
            sidebarOpen ? 'w-72' : 'w-0'
          }`}
        >
          <div className="w-72 h-full">
            <ConversationSidebar onNewChat={handleNewChat} />
          </div>
        </div>

        {/* Mobile sidebar overlay */}
        {mobileSidebarOpen && (
          <>
            <div
              className="lg:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="lg:hidden fixed inset-y-0 left-0 z-50 w-72 animate-slide-in">
              <ConversationSidebar onNewChat={handleNewChat} />
            </div>
          </>
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Conversation header */}
          <ConversationHeader
            title={conversation?.title || 'New Chat'}
            persona={conversation?.persona}
            onRename={handleRenameConversation}
            onToggleSidebar={handleToggleSidebar}
            sidebarOpen={sidebarOpen}
          />

          {/* Chat + Document Panel container */}
          <div className="flex-1 flex overflow-hidden">
            {/* Chat container */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900 min-w-0">
              {/* Messages Area */}
              <div ref={messagesAreaRef} className={`flex-1 overflow-y-auto px-4 py-6 sm:px-6 transition-opacity duration-150 ${isSwitching ? 'opacity-0' : 'opacity-100'}`}>
                {messages.length === 0 && !isLoading ? (
                  <WelcomeState onSendQuery={sendQuery} />
                ) : (
                  <div className="mx-auto max-w-3xl space-y-6">
                    {messages.map((message, idx) => (
                      <div key={message.id} data-message-role={message.role}>
                        <MessageBubble
                          message={message}
                          onFeedback={handleFeedback}
                          onRetry={handleRetry}
                          isLastAssistant={idx === lastAssistantIdx}
                          onCitationClick={handleCitationClick}
                        />
                      </div>
                    ))}

                    {isLoading && !isStreaming && <TypingIndicator />}

                    {/* Spacer to allow scrolling user query to top during streaming */}
                    {streamingSpacer > 0 && (
                      <div
                        style={{ height: streamingSpacer }}
                        className="transition-all duration-300 ease-out"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Input Area */}
              <ChatInput
                ref={chatInputRef}
                onSubmit={sendQuery}
                onStop={handleStop}
                isLoading={isLoading}
                isStreaming={isStreaming}
                selectedPersona={personaRef.current}
                onPersonaChange={handlePersonaChange}
              />
            </div>

            {/* Document Panel - Right side */}
            <div
              className={`hidden lg:block flex-shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
                documentPanelOpen ? 'w-96' : 'w-0'
              }`}
            >
              <DocumentPanel className="w-96 h-full" />
            </div>
          </div>

          <DisclaimerFooter />
        </div>
      </div>
    </>
  );
}
