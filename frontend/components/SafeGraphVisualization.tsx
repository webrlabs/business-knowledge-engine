'use client';

import React from 'react';
import ErrorBoundary, { CompactErrorFallback } from './ErrorBoundary';
import GraphVisualization, { GraphVisualizationProps } from './GraphVisualization';

/**
 * GraphVisualization wrapped with an error boundary.
 * If the graph fails to render, shows a friendly error message
 * instead of crashing the entire page.
 */
export default function SafeGraphVisualization(props: GraphVisualizationProps) {
  const [key, setKey] = React.useState(0);

  const handleRetry = () => {
    setKey((prev) => prev + 1);
  };

  return (
    <ErrorBoundary
      key={key}
      fallback={
        <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          <CompactErrorFallback
            message="Failed to render graph visualization"
            onRetry={handleRetry}
          />
        </div>
      }
      onError={(error) => {
        if (process.env.NODE_ENV === 'development') {
          console.error('GraphVisualization error:', error);
        }
      }}
    >
      <GraphVisualization {...props} />
    </ErrorBoundary>
  );
}
