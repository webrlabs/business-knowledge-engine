'use client';

import type { ChatMessage, Citation } from '@/lib/chat-types';
import MessageActions from './MessageActions';
import ThinkingBlock from './ThinkingBlock';
import StreamingText from './StreamingText';
import CitationBadge from './CitationBadge';

interface MessageBubbleProps {
  message: ChatMessage;
  onFeedback: (messageId: string, feedback: 'up' | 'down' | null) => void;
  onRetry?: () => void;
  isLastAssistant?: boolean;
  onCitationClick?: (citation: Citation) => void;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MessageBubble({
  message,
  onFeedback,
  onRetry,
  isLastAssistant = false,
  onCitationClick,
}: MessageBubbleProps) {
  if (message.role === 'user') {
    const handleCopyUser = async () => {
      try {
        await navigator.clipboard.writeText(message.content);
      } catch {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = message.content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    };

    return (
      <div className="flex justify-end">
        <div className="group/user flex flex-col items-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-2.5 shadow-sm">
            <p className="text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-100">{message.content}</p>
          </div>
          {/* Timestamp and copy - visible on hover */}
          <div className="flex items-center gap-2 mt-1 mr-1 opacity-0 group-hover/user:opacity-100 transition-opacity">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">
              {formatTimestamp(message.timestamp)}
            </span>
            <button
              type="button"
              onClick={handleCopyUser}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="Copy message"
              title="Copy"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="group flex gap-3">
      <div className="mt-1 flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
        <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        {(message.thinkingSteps || message.thinkingContent) && (
          <ThinkingBlock steps={message.thinkingSteps} content={message.thinkingContent} />
        )}
        <StreamingText content={message.content} isStreaming={message.isStreaming || false} />

        {message.citations && message.citations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {message.citations.map((citation, idx) => (
                <CitationBadge
                  key={typeof citation === 'string' ? idx : citation.id}
                  citation={citation}
                  index={idx}
                  onClick={onCitationClick}
                />
              ))}
            </div>
          </div>
        )}

        {!message.isStreaming && (
          <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="text-[11px] text-gray-400 dark:text-gray-500 leading-none py-1">
              {formatTimestamp(message.timestamp)}
            </span>
            <MessageActions
              content={message.content}
              messageId={message.id}
              feedback={message.feedback}
              onFeedback={onFeedback}
              onRetry={onRetry}
              showRetry={isLastAssistant}
            />
          </div>
        )}
      </div>
    </div>
  );
}
