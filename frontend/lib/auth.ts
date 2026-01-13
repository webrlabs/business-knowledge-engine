'use client';

import { useMemo } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

export function useAuth() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const account = accounts[0];

  const user = useMemo<AuthUser | null>(() => {
    if (!account) {
      return null;
    }
    const claims = account.idTokenClaims as Record<string, unknown> | undefined;
    const roles = Array.isArray(claims?.roles) ? (claims?.roles as string[]) : [];
    const email =
      (claims?.preferred_username as string | undefined) ||
      account.username ||
      '';
    const id =
      (claims?.oid as string | undefined) ||
      (claims?.sub as string | undefined) ||
      account.homeAccountId ||
      email;
    const name =
      account.name ||
      (claims?.name as string | undefined) ||
      email;

    return {
      id,
      name,
      email,
      roles,
    };
  }, [account]);

  const logout = () => {
    if (account) {
      return instance.logoutRedirect({ account });
    }
    return instance.logoutRedirect();
  };

  return { account, user, roles: user?.roles || [], isAuthenticated, logout, instance };
}
