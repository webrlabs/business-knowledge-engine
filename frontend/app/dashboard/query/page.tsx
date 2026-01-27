'use client';

import { useState, useRef, useEffect } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';

import LoadingSpinner from '@/components/LoadingSpinner';
import { useToast, ToastContainer } from '@/components/Toast';
import HelpTooltip from '@/components/HelpTooltip';
import PersonaSelector from '@/components/PersonaSelector';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: string[];
  timestamp: Date;
  persona?: string;
}

export default function GraphRAGQueryPage() {
  const toast = useToast();
  const authFetch = useAuthFetch();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [inputError, setInputError] = useState('');
  const [inputTouched, setInputTouched] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState('default');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Validate query input
  const validateQuery = (value: string): string => {
    if (!value || !value.trim()) {
      return 'Please enter a question';
    }
    if (value.trim().length < 3) {
      return 'Question must be at least 3 characters';
    }
    if (value.trim().length > 500) {
      return 'Question must be less than 500 characters';
    }
    return '';
  };

  // Handle input change with validation
  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (inputTouched) {
      setInputError(validateQuery(value));
    }
  };

  // Handle input blur
  const handleInputBlur = () => {
    setInputTouched(true);
    setInputError(validateQuery(inputValue));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark as touched and validate
    setInputTouched(true);
    const error = validateQuery(inputValue);
    setInputError(error);

    if (error || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
      persona: selectedPersona,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await authFetch(`${API_BASE_URL}/api/graphrag/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: inputValue,
          options: {
            persona: selectedPersona,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Query failed');
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        citations: data.citations || [],
        timestamp: new Date(),
        persona: selectedPersona,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Show success toast
      toast.success(
        'Query Complete',
        'Your answer is ready with relevant sources',
        4000
      );
    } catch (error) {
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your query. Please try again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);

      // Show error toast with guidance
      toast.error(
        'Query Failed',
        'Unable to process your query. Please check your connection and try again.',
        7000,
        {
          label: 'Clear Chat',
          onClick: () => {
            setMessages([]);
          }
        }
      );
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <>
      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
      <div className="h-full flex flex-col">
        <div className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">GraphRAG Query</h2>
                <HelpTooltip
                  content="GraphRAG combines vector search with graph traversal to provide accurate, context-aware answers about your business processes. Ask natural language questions and get answers with citations linking back to source documents."
                  learnMoreLink="#"
                />
              </div>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Ask questions about your business processes and get AI-powered answers
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Response style:</span>
              <PersonaSelector
                selectedPersona={selectedPersona}
                onPersonaChange={setSelectedPersona}
                disabled={isLoading}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <svg
                    className="w-16 h-16 mx-auto mb-4 text-gray-300"
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
                  <p className="text-lg font-medium mb-2">Start a conversation</p>
                  <p className="text-sm">Ask about your business processes, workflows, or policies</p>
                  <div className="mt-6 space-y-2">
                    <p className="text-xs font-semibold text-gray-600">Try asking:</p>
                    <div className="space-y-1 text-xs text-gray-500">
                      <p>&ldquo;What are the steps in the procurement process?&rdquo;</p>
                      <p>&ldquo;Who is responsible for invoice approval?&rdquo;</p>
                      <p>&ldquo;What policies regulate data handling?&rdquo;</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-3xl rounded-lg px-4 py-3 ${message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                    }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-300">
                      <p className="text-xs font-semibold mb-2 text-gray-700">Sources:</p>
                      <div className="space-y-1">
                        {message.citations.map((citation, idx) => (
                          <p key={idx} className="text-xs text-gray-600">
                            {idx + 1}. {citation}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className={`text-xs mt-2 ${message.role === 'user' ? 'text-blue-200' : 'text-gray-500'
                    }`}>
                    {formatTimestamp(message.timestamp)}
                  </p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-3xl rounded-lg px-4 py-3 bg-gray-100">
                  <LoadingSpinner size="sm" color="gray" text="Processing your query..." />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-gray-200 p-4 bg-gray-50">
            <form onSubmit={handleSubmit} className="space-y-2">
              <div className="flex gap-3">
                <div className="flex-1">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onBlur={handleInputBlur}
                    placeholder="Ask a question about your business processes..."
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:border-transparent text-gray-900 placeholder-gray-400 transition-colors ${inputError && inputTouched
                        ? 'border-red-500 focus:ring-red-500'
                        : 'border-gray-300 focus:ring-blue-500'
                      }`}
                    disabled={isLoading}
                    aria-invalid={inputError && inputTouched ? 'true' : 'false'}
                    aria-describedby={inputError && inputTouched ? 'query-error' : undefined}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary flex items-center justify-center"
                >
                  {isLoading ? (
                    <LoadingSpinner size="sm" color="white" />
                  ) : (
                    'Send'
                  )}
                </button>
              </div>
              {inputError && inputTouched && (
                <p id="query-error" className="text-sm text-red-600 flex items-start px-1">
                  <svg className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {inputError}
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
