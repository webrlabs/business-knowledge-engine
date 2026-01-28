'use client';

import { useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock from './CodeBlock';

interface StreamingTextProps {
  content: string;
  isStreaming: boolean;
}

export default function StreamingText({ content, isStreaming }: StreamingTextProps) {
  const prevLinesRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Split content into lines/paragraphs for animation
  const lines = useMemo(() => {
    return content.split(/\n\n+/).filter(line => line.trim());
  }, [content]);

  // Track new lines and apply animation
  useEffect(() => {
    if (!containerRef.current || !isStreaming) return;

    const children = containerRef.current.children;
    const newLineCount = lines.length;

    // Animate only the newest lines
    for (let i = prevLinesRef.current; i < newLineCount; i++) {
      if (children[i]) {
        const el = children[i] as HTMLElement;
        el.style.animation = 'none';
        el.offsetHeight; // Trigger reflow
        el.style.animation = 'fadeSlideIn 0.3s ease-out forwards';
      }
    }

    prevLinesRef.current = newLineCount;
  }, [lines.length, isStreaming]);

  // Reset line count when not streaming (new message)
  useEffect(() => {
    if (!isStreaming) {
      prevLinesRef.current = 0;
    }
  }, [isStreaming]);

  if (!isStreaming) {
    // Non-streaming: render normally without animation
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-p:leading-relaxed prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-strong:text-gray-900 dark:prose-strong:text-white prose-code:text-sm prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:!p-0 prose-pre:!bg-transparent prose-pre:!m-0 prose-a:text-blue-600 dark:prose-a:text-blue-400">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            code(props) {
              const { className, children, ...rest } = props;
              const isInline = !className;
              if (isInline) {
                return <code className={className} {...rest}>{children}</code>;
              }
              return <CodeBlock className={className}>{children}</CodeBlock>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  // Streaming: render each paragraph with animation wrapper
  return (
    <div
      ref={containerRef}
      className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-700 dark:prose-p:text-gray-300 prose-p:leading-relaxed prose-li:text-gray-700 dark:prose-li:text-gray-300 prose-strong:text-gray-900 dark:prose-strong:text-white prose-code:text-sm prose-code:bg-gray-100 dark:prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:!p-0 prose-pre:!bg-transparent prose-pre:!m-0 prose-a:text-blue-600 dark:prose-a:text-blue-400"
    >
      {lines.map((line, idx) => (
        <div
          key={idx}
          className="animate-fade-slide-in"
          style={{
            opacity: 0,
            animation: 'fadeSlideIn 0.3s ease-out forwards',
            animationDelay: idx >= prevLinesRef.current ? '0ms' : '0ms'
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              code(props) {
                const { className, children, ...rest } = props;
                const isInline = !className;
                if (isInline) {
                  return <code className={className} {...rest}>{children}</code>;
                }
                return <CodeBlock className={className}>{children}</CodeBlock>;
              },
            }}
          >
            {line}
          </ReactMarkdown>
        </div>
      ))}
      {/* Blinking cursor */}
      <span className="inline-block w-2 h-4 ml-0.5 bg-gray-800 dark:bg-gray-200 animate-cursor-blink align-text-bottom" />
    </div>
  );
}
