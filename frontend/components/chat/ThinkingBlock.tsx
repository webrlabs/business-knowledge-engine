'use client';

import { useState } from 'react';
import type { ThinkingStep } from '@/lib/chat-types';

interface ThinkingBlockProps {
  steps?: ThinkingStep[];
  content?: string; // Legacy support
}

function StatusIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function EntityIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
    </svg>
  );
}

function RelationshipIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}

function ReasoningIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}

function getStepIcon(type: ThinkingStep['type']) {
  switch (type) {
    case 'documents':
      return <DocumentIcon />;
    case 'entities':
      return <EntityIcon />;
    case 'relationships':
      return <RelationshipIcon />;
    case 'reasoning':
      return <ReasoningIcon />;
    default:
      return <StatusIcon />;
  }
}

function ThinkingStepItem({ step }: { step: ThinkingStep }) {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {getStepIcon(step.type)}
        <span className="text-gray-600 dark:text-gray-300 text-sm">
          {step.message}
        </span>
      </div>

      {/* Document items as pills */}
      {step.type === 'documents' && step.items && step.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 ml-5.5 pl-0.5">
          {step.items.map((item, idx) => {
            const title = typeof item === 'string' ? item : item.title;
            return (
              <span
                key={idx}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                title={title}
              >
                {title.length > 30 ? `${title.slice(0, 30)}...` : title}
              </span>
            );
          })}
        </div>
      )}

      {/* Entity items as colored tags */}
      {step.type === 'entities' && step.items && step.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 ml-5.5 pl-0.5">
          {step.items.map((item, idx) => {
            const name = typeof item === 'string' ? item : item.title;
            return (
              <span
                key={idx}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
              >
                {name}
              </span>
            );
          })}
        </div>
      )}

      {/* Reasoning content - collapsible for long content */}
      {step.type === 'reasoning' && step.content && (
        <div className="ml-5.5 pl-0.5">
          {step.content.length > 200 ? (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
                {reasoningExpanded ? step.content : `${step.content.slice(0, 200)}...`}
              </p>
              <button
                onClick={() => setReasoningExpanded(!reasoningExpanded)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-1"
              >
                {reasoningExpanded ? 'Show less' : 'Show more'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
              {step.content}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ThinkingBlock({ steps, content }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Support legacy string content
  const hasSteps = steps && steps.length > 0;
  const hasContent = content && content.trim().length > 0;

  if (!hasSteps && !hasContent) return null;

  // Count items for summary (prefer count field, fallback to items length)
  const docCount = steps?.filter(s => s.type === 'documents').reduce((acc, s) => acc + (s.count ?? s.items?.length ?? 0), 0) || 0;
  const entityCount = steps?.filter(s => s.type === 'entities').reduce((acc, s) => acc + (s.count ?? s.items?.length ?? 0), 0) || 0;
  const hasReasoning = steps?.some(s => s.type === 'reasoning');

  return (
    <details
      open={isOpen}
      onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
      className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 overflow-hidden"
    >
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span className="font-medium">Thinking</span>

        {/* Summary badges */}
        {hasSteps && (
          <div className="flex items-center gap-1.5 ml-2">
            {docCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                <DocumentIcon />
                {docCount}
              </span>
            )}
            {entityCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                <EntityIcon />
                {entityCount}
              </span>
            )}
            {hasReasoning && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                <ReasoningIcon />
              </span>
            )}
          </div>
        )}

        <svg
          className={`w-3.5 h-3.5 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>

      <div className="px-3 pb-3 pt-2 border-t border-gray-200 dark:border-gray-700">
        {hasSteps ? (
          <div className="space-y-3">
            {steps.map((step, idx) => (
              <ThinkingStepItem key={idx} step={step} />
            ))}
          </div>
        ) : (
          // Legacy: plain text content
          <div className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">
            {content}
          </div>
        )}
      </div>
    </details>
  );
}
