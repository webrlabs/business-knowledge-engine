'use client';

import { useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { initializeTelemetry, trackPageView, trackNavigation } from '@/lib/telemetry';

interface TelemetryProviderProps {
  children: ReactNode;
}

/**
 * TelemetryProvider initializes frontend telemetry and tracks page navigation.
 * Should be placed high in the component tree to capture all navigation events.
 */
export default function TelemetryProvider({ children }: TelemetryProviderProps) {
  const pathname = usePathname();

  // Initialize telemetry on mount
  useEffect(() => {
    initializeTelemetry();
  }, []);

  // Track page views on navigation
  useEffect(() => {
    if (pathname) {
      trackPageView(pathname, {
        referrer: typeof document !== 'undefined' ? document.referrer : '',
      });
    }
  }, [pathname]);

  return <>{children}</>;
}

/**
 * Hook for tracking navigation between pages
 */
export function useNavigationTracking() {
  const pathname = usePathname();

  const trackNav = (to: string, method: 'click' | 'keyboard' | 'programmatic' = 'click') => {
    if (pathname) {
      trackNavigation(pathname, to, method);
    }
  };

  return { trackNav, currentPath: pathname };
}
