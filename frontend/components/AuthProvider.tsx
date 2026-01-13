'use client';

import { ReactNode, useEffect } from 'react';
import { MsalProvider } from '@azure/msal-react';
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from '@/lib/auth-config';

interface AuthProviderProps {
  children: ReactNode;
}

const msalInstance = new PublicClientApplication(msalConfig);

export function AuthProvider({ children }: AuthProviderProps) {
  useEffect(() => {
    msalInstance.handleRedirectPromise().catch((error) => {
      console.error('MSAL redirect handling error:', error);
    });
  }, []);

  return (
    <MsalProvider instance={msalInstance}>
      {children}
    </MsalProvider>
  );
}
