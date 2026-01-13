/**
 * Frontend Telemetry Utility
 *
 * Provides client-side telemetry tracking for:
 * - Page views
 * - User interactions
 * - Errors/exceptions
 * - Performance metrics
 *
 * Uses a simple beacon-based approach that can be extended to use
 * Application Insights Browser SDK or other analytics services.
 *
 * Environment Variables:
 *   NEXT_PUBLIC_APPINSIGHTS_INSTRUMENTATIONKEY - Required for telemetry
 */

// Types
interface TelemetryEvent {
  name: string;
  properties?: Record<string, string | number | boolean>;
  measurements?: Record<string, number>;
  timestamp: string;
}

interface TelemetryException {
  message: string;
  stack?: string;
  properties?: Record<string, string | number | boolean>;
  timestamp: string;
}

interface TelemetryConfig {
  instrumentationKey: string | null;
  enabled: boolean;
  endpoint: string;
  flushInterval: number;
  maxBatchSize: number;
}

// Configuration
const config: TelemetryConfig = {
  instrumentationKey: process.env.NEXT_PUBLIC_APPINSIGHTS_INSTRUMENTATIONKEY || null,
  enabled: !!process.env.NEXT_PUBLIC_APPINSIGHTS_INSTRUMENTATIONKEY &&
           process.env.NEXT_PUBLIC_APPINSIGHTS_INSTRUMENTATIONKEY !== 'your-instrumentation-key',
  endpoint: '/api/telemetry', // Backend endpoint to relay telemetry
  flushInterval: 30000, // Flush every 30 seconds
  maxBatchSize: 25,
};

// Telemetry queue
let eventQueue: TelemetryEvent[] = [];
let exceptionQueue: TelemetryException[] = [];
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Initialize telemetry
 * Should be called once at app startup
 */
export function initializeTelemetry(): void {
  if (typeof window === 'undefined' || !config.enabled) {
    return;
  }

  // Start flush timer
  flushTimer = setInterval(flushTelemetry, config.flushInterval);

  // Track page views on navigation
  if (typeof window !== 'undefined') {
    // Flush on page unload
    window.addEventListener('beforeunload', () => {
      flushTelemetry();
    });

    // Track initial page view
    trackPageView(window.location.pathname);
  }

  console.log('Frontend telemetry initialized');
}

/**
 * Track a page view
 */
export function trackPageView(pageName: string, properties?: Record<string, string | number | boolean>): void {
  if (!config.enabled) return;

  trackEvent('pageView', {
    pageName,
    url: typeof window !== 'undefined' ? window.location.href : '',
    ...properties,
  });
}

/**
 * Track a custom event
 */
export function trackEvent(
  name: string,
  properties?: Record<string, string | number | boolean>,
  measurements?: Record<string, number>
): void {
  if (!config.enabled) return;

  const event: TelemetryEvent = {
    name,
    properties,
    measurements,
    timestamp: new Date().toISOString(),
  };

  eventQueue.push(event);

  // Flush if queue is full
  if (eventQueue.length >= config.maxBatchSize) {
    flushTelemetry();
  }
}

/**
 * Track an exception
 */
export function trackException(
  error: Error | string,
  properties?: Record<string, string | number | boolean>
): void {
  if (!config.enabled) return;

  const exception: TelemetryException = {
    message: error instanceof Error ? error.message : error,
    stack: error instanceof Error ? error.stack : undefined,
    properties,
    timestamp: new Date().toISOString(),
  };

  exceptionQueue.push(exception);

  // Exceptions are higher priority, flush immediately if we have a few
  if (exceptionQueue.length >= 5) {
    flushTelemetry();
  }
}

/**
 * Track a metric
 */
export function trackMetric(name: string, value: number, properties?: Record<string, string | number | boolean>): void {
  trackEvent('metric', { name, ...properties }, { [name]: value });
}

/**
 * Track user interaction
 */
export function trackInteraction(
  action: string,
  target: string,
  properties?: Record<string, string | number | boolean>
): void {
  trackEvent('interaction', {
    action,
    target,
    ...properties,
  });
}

/**
 * Track a timing metric (performance)
 */
export function trackTiming(name: string, durationMs: number, properties?: Record<string, string | number | boolean>): void {
  trackEvent('timing', { name, ...properties }, { duration: durationMs });
}

/**
 * Start a timing measurement
 * Returns a function to stop the timing and track it
 */
export function startTiming(name: string, properties?: Record<string, string | number | boolean>): () => void {
  const startTime = performance.now();
  return () => {
    const duration = performance.now() - startTime;
    trackTiming(name, duration, properties);
  };
}

/**
 * Flush telemetry to the server
 */
async function flushTelemetry(): Promise<void> {
  if (!config.enabled) return;
  if (eventQueue.length === 0 && exceptionQueue.length === 0) return;

  const events = [...eventQueue];
  const exceptions = [...exceptionQueue];

  // Clear queues
  eventQueue = [];
  exceptionQueue = [];

  // Use sendBeacon for reliability
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const payload = JSON.stringify({
      events,
      exceptions,
      instrumentationKey: config.instrumentationKey,
    });

    navigator.sendBeacon(config.endpoint, payload);
  } else {
    // Fallback to fetch
    try {
      await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events,
          exceptions,
          instrumentationKey: config.instrumentationKey,
        }),
        keepalive: true,
      });
    } catch (error) {
      // Silently fail - telemetry should not break the app
      console.warn('Failed to flush telemetry:', error);
    }
  }
}

// Domain-specific tracking helpers

/**
 * Track document upload
 */
export function trackDocumentUpload(
  filename: string,
  fileSize: number,
  success: boolean,
  properties?: Record<string, string | number | boolean>
): void {
  trackEvent('document.upload', {
    filename,
    success,
    ...properties,
  }, {
    fileSize,
  });
}

/**
 * Track query execution
 */
export function trackQuery(
  queryLength: number,
  responseTimeMs: number,
  resultCount: number,
  properties?: Record<string, string | number | boolean>
): void {
  trackEvent('query.execute', {
    ...properties,
  }, {
    queryLength,
    responseTime: responseTimeMs,
    resultCount,
  });
}

/**
 * Track entity review action
 */
export function trackEntityReview(
  action: 'approve' | 'reject' | 'edit',
  entityType: string,
  properties?: Record<string, string | number | boolean>
): void {
  trackEvent('entity.review', {
    action,
    entityType,
    ...properties,
  });
}

/**
 * Track graph interaction
 */
export function trackGraphInteraction(
  action: 'nodeClick' | 'edgeClick' | 'zoom' | 'pan' | 'layout',
  properties?: Record<string, string | number | boolean>
): void {
  trackEvent('graph.interaction', {
    action,
    ...properties,
  });
}

/**
 * Track navigation
 */
export function trackNavigation(
  from: string,
  to: string,
  method: 'click' | 'keyboard' | 'programmatic' = 'click'
): void {
  trackEvent('navigation', {
    from,
    to,
    method,
  });
}

/**
 * React hook for tracking component performance
 */
export function usePerformanceTracking(componentName: string): {
  trackRender: () => void;
  trackMount: () => void;
} {
  let renderStart = 0;

  return {
    trackRender: () => {
      renderStart = performance.now();
    },
    trackMount: () => {
      if (renderStart > 0) {
        const duration = performance.now() - renderStart;
        trackTiming('component.mount', duration, { component: componentName });
      }
    },
  };
}

/**
 * Check if telemetry is enabled
 */
export function isTelemetryEnabled(): boolean {
  return config.enabled;
}

/**
 * Get telemetry config (for debugging)
 */
export function getTelemetryConfig(): TelemetryConfig {
  return { ...config };
}
