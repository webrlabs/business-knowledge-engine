'use client';

import { useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from './auth-config';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export function useAuthFetch() {
  const { instance, accounts } = useMsal();

  return useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const account = accounts[0];
      if (!account) {
        throw new Error('Not authenticated');
      }

      const tokenResponse = await instance.acquireTokenSilent({
        ...loginRequest,
        account,
      });

      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Bearer ${tokenResponse.accessToken}`);

      return fetch(input, { ...init, headers });
    },
    [accounts, instance]
  );
}

export function useAuthToken() {
  const { instance, accounts } = useMsal();

  return useCallback(async (): Promise<string> => {
    const account = accounts[0];
    if (!account) {
      throw new Error('Not authenticated');
    }

    const tokenResponse = await instance.acquireTokenSilent({
      ...loginRequest,
      account,
    });

    return tokenResponse.accessToken;
  }, [accounts, instance]);
}
