'use client';

import { useEffect } from 'react';
import { PageErrorFallback } from '@/components/ErrorBoundary';
import { trackException } from '@/lib/telemetry';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Next.js App Router error boundary for the dashboard route.
 * This catches errors in the dashboard pages and displays a fallback UI.
 */
export default function DashboardError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Dashboard error:', error);
    }

    // Track exception in Application Insights
    trackException(error, {
      source: 'DashboardError',
      digest: error.digest || '',
      url: typeof window !== 'undefined' ? window.location.href : '',
    });
  }, [error]);

  return <PageErrorFallback error={error} reset={reset} />;
}
