'use client';

import { useMemo, useEffect, useState } from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { loginRequest } from './auth-config';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

/**
 * Check if a user has any of the required roles.
 * Uses case-insensitive partial matching to handle various role naming conventions
 * (e.g., "Admin", "admin", "App.Admin", "KnowledgePlatform.Reviewer")
 */
export function hasRole(userRoles: string[], requiredRoles: string[]): boolean {
  if (!userRoles || userRoles.length === 0) return false;

  return userRoles.some((userRole) => {
    const roleLower = userRole.toLowerCase();
    return requiredRoles.some((required) => roleLower.includes(required.toLowerCase()));
  });
}

/**
 * Check if user has admin role
 */
export function isAdmin(roles: string[]): boolean {
  return hasRole(roles, ['admin']);
}

/**
 * Check if user can review documents (admin or reviewer)
 */
export function canReview(roles: string[]): boolean {
  return hasRole(roles, ['admin', 'reviewer']);
}

/**
 * Check if user can upload documents (admin, reviewer, or contributor)
 */
export function canUpload(roles: string[]): boolean {
  return hasRole(roles, ['admin', 'reviewer', 'contributor']);
}

/**
 * Check if roles have been loaded from the token.
 * Returns true if we're still waiting for roles to load.
 */
export function isLoadingRoles(user: AuthUser | null, roles: string[]): boolean {
  return user !== null && roles.length === 0;
}

/**
 * Decode JWT payload without verification (for reading claims only)
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

// Auth hook using Entra ID (MSAL)
export function useAuth() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const account = accounts[0];
  const [accessTokenRoles, setAccessTokenRoles] = useState<string[]>([]);

  // Fetch access token to get roles (roles are in access token, not ID token)
  useEffect(() => {
    async function fetchRoles() {
      if (!account) {
        setAccessTokenRoles([]);
        return;
      }

      try {
        const tokenResponse = await instance.acquireTokenSilent({
          ...loginRequest,
          account,
        });

        const payload = decodeJwtPayload(tokenResponse.accessToken);
        if (payload && Array.isArray(payload.roles)) {
          setAccessTokenRoles(payload.roles as string[]);
        } else {
          setAccessTokenRoles([]);
        }
      } catch (error) {
        console.error('Failed to fetch access token for roles:', error);
        setAccessTokenRoles([]);
      }
    }

    fetchRoles();
  }, [account, instance]);

  const user = useMemo<AuthUser | null>(() => {
    if (!account) {
      return null;
    }
    const claims = account.idTokenClaims as Record<string, unknown> | undefined;
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
      roles: accessTokenRoles,
    };
  }, [account, accessTokenRoles]);

  const logout = () => {
    if (account) {
      return instance.logoutRedirect({ account });
    }
    return instance.logoutRedirect();
  };

  return { account, user, roles: accessTokenRoles, isAuthenticated, logout, instance };
}
