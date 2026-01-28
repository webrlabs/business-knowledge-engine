'use client';

import { useState, useRef, useCallback } from 'react';
import PersonaSelector from '@/components/PersonaSelector';
import StopButton from './StopButton';
import FileUpload from './FileUpload';
import FilePreview from './FilePreview';

interface ChatInputProps {
  onSubmit: (query: string, files?: File[]) => void;
  onStop?: () => void;
  isLoading: boolean;
  isStreaming?: boolean;
  selectedPersona: string;
  onPersonaChange: (persona: string) => void;
}

export default function ChatInput({
  onSubmit,
  onStop,
  isLoading,
  isStreaming = false,
  selectedPersona,
  onPersonaChange,
}: ChatInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [inputError, setInputError] = useState('');
  const [inputTouched, setInputTouched] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineHeight = 24;
    const maxHeight = lineHeight * 6;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  const validateQuery = (value: string): string => {
    if (!value || !value.trim()) return 'Please enter a question';
    if (value.trim().length < 3) return 'Question must be at least 3 characters';
    if (value.trim().length > 500) return 'Question must be less than 500 characters';
    return '';
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    // Clear error as soon as user types valid content
    if (value.trim().length >= 3) {
      setInputError('');
    } else if (inputTouched) {
      setInputError(validateQuery(value));
    }
  };

  const handleInputFocus = () => {
    // Clear error when user focuses back into the input
    setInputError('');
  };

  const handleInputBlur = () => {
    setInputTouched(true);
    setInputError(validateQuery(inputValue));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInputTouched(true);
    const error = validateQuery(inputValue);
    setInputError(error);
    if (error || isLoading) return;

    onSubmit(inputValue, attachedFiles.length > 0 ? attachedFiles : undefined);
    setInputValue('');
    setInputTouched(false);
    setInputError('');
    setAttachedFiles([]);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const showStop = isStreaming && onStop;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 p-3 sm:p-4 bg-gray-50 dark:bg-gray-800/50">
      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-shadow">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              handleInputChange(e.target.value);
              autoResizeTextarea();
            }}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Ask a question..."
            rows={1}
            className="w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-0"
            disabled={isLoading}
            aria-invalid={inputError && inputTouched ? 'true' : 'false'}
            aria-describedby={inputError && inputTouched ? 'query-error' : undefined}
          />
          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {attachedFiles.map((file, idx) => (
                <FilePreview
                  key={`${file.name}-${idx}`}
                  file={file}
                  onRemove={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                />
              ))}
            </div>
          )}
          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-1">
              <FileUpload
                files={attachedFiles}
                onFilesChange={setAttachedFiles}
                disabled={isLoading}
              />
              <PersonaSelector
                selectedPersona={selectedPersona}
                onPersonaChange={onPersonaChange}
                disabled={isLoading}
              />
            </div>
            {showStop ? (
              <StopButton onClick={onStop} />
            ) : (
              <button
                type="submit"
                disabled={isLoading || !inputValue.trim()}
                className="relative flex items-center justify-center h-8 w-8 rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-blue-500 dark:hover:bg-blue-600 group/send"
                aria-label="Send message"
              >
                {isLoading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                  </svg>
                )}
                <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-700 px-2 py-1 text-[11px] text-white opacity-0 group-hover/send:opacity-100 transition-opacity">
                  Send
                </span>
              </button>
            )}
          </div>
        </div>
        {inputError && inputTouched && (
          <p id="query-error" className="mt-1.5 text-xs text-red-500 px-1">
            {inputError}
          </p>
        )}
        <div className="flex items-center justify-between mt-1.5 px-1">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Press Enter to send, Shift+Enter for a new line
          </p>
          {inputValue.length > 0 && (
            <p className={`text-[11px] tabular-nums ${
              inputValue.trim().length > 450
                ? inputValue.trim().length > 500
                  ? 'text-red-500'
                  : 'text-amber-500 dark:text-amber-400'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
              {inputValue.trim().length}/500
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
