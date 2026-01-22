'use client';

import { ReactNode, useEffect, useState, useRef } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, IPublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from '@/lib/auth-config';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const msalInstanceRef = useRef<IPublicClientApplication | null>(null);

  useEffect(() => {
    const initializeMsal = async () => {
      try {
        // Only create MSAL instance on client side
        if (!msalInstanceRef.current) {
          msalInstanceRef.current = new PublicClientApplication(msalConfig);
        }
        await msalInstanceRef.current.initialize();
        await msalInstanceRef.current.handleRedirectPromise();
        setIsInitialized(true);
      } catch (error) {
        console.error('MSAL initialization error:', error);
        setIsInitialized(true); // Still render children to show error state
      }
    };

    initializeMsal();
  }, []);

  if (!isInitialized || !msalInstanceRef.current) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <MsalProvider instance={msalInstanceRef.current}>
      {children}
    </MsalProvider>
  );
}
