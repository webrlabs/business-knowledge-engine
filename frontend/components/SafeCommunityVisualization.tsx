'use client';

import React, { forwardRef } from 'react';
import ErrorBoundary, { CompactErrorFallback } from './ErrorBoundary';
import CommunityVisualization, {
  CommunityVisualizationProps,
  CommunityVisualizationHandle,
} from './CommunityVisualization';

/**
 * CommunityVisualization wrapped with an error boundary.
 * If the visualization fails to render, shows a friendly error message
 * instead of crashing the entire page.
 */
const SafeCommunityVisualization = forwardRef<CommunityVisualizationHandle, CommunityVisualizationProps>(
  (props, ref) => {
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
              message="Failed to render community visualization"
              onRetry={handleRetry}
            />
          </div>
        }
        onError={(error) => {
          if (process.env.NODE_ENV === 'development') {
            console.error('CommunityVisualization error:', error);
          }
        }}
      >
        <CommunityVisualization ref={ref} {...props} />
      </ErrorBoundary>
    );
  }
);

SafeCommunityVisualization.displayName = 'SafeCommunityVisualization';

export default SafeCommunityVisualization;
