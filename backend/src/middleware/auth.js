/**
 * JWT Authentication Middleware for Azure AD / Entra ID
 *
 * Validates incoming JWT tokens against Azure AD using JWKS.
 * Extracts user information and roles from the token claims.
 *
 * Environment Variables:
 *   AZURE_AD_TENANT_ID - Azure AD tenant ID
 *   AZURE_AD_CLIENT_ID - Application (client) ID
 *   AZURE_AD_AUDIENCE - API audience (usually api://{client-id})
 */

const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { log } = require('../utils/logger');

// Configuration
const tenantId = process.env.AZURE_AD_TENANT_ID;
const clientId = process.env.AZURE_AD_CLIENT_ID;
const audience = process.env.AZURE_AD_AUDIENCE || clientId;

// Validate configuration at startup
const isConfigured = !!(tenantId && (audience || clientId));

if (!isConfigured) {
  log.warn('Azure AD authentication not configured', {
    hasTenantId: !!tenantId,
    hasClientId: !!clientId,
    hasAudience: !!audience,
    message: 'Auth will fail until AZURE_AD_TENANT_ID and AZURE_AD_CLIENT_ID are configured',
  });
}

// Azure AD v2.0 endpoints
const issuer = tenantId
  ? `https://login.microsoftonline.com/${tenantId}/v2.0`
  : null;

const jwksUri = tenantId
  ? `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
  : null;

// JWKS client for fetching signing keys
const jwksClient = jwksUri
  ? jwksRsa({
      jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    })
  : null;

/**
 * Get the signing key for JWT verification
 * @param {Object} header - JWT header containing 'kid'
 * @param {Function} callback - Callback with (error, signingKey)
 */
function getSigningKey(header, callback) {
  if (!jwksClient) {
    callback(new Error('JWKS client not configured - missing tenant ID'));
    return;
  }

  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) {
      log.error('Failed to get signing key', {
        kid: header.kid,
        error: err.message,
      });
      callback(err);
      return;
    }

    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

/**
 * Extract user information from decoded token
 * @param {Object} decoded - Decoded JWT payload
 * @returns {Object} - Normalized user object
 */
function extractUserFromToken(decoded) {
  return {
    // User identifiers
    id: decoded.oid || decoded.sub,
    oid: decoded.oid,
    sub: decoded.sub,

    // User info
    name: decoded.name,
    email: decoded.preferred_username || decoded.email || decoded.upn,
    upn: decoded.upn,

    // Roles and groups
    roles: decoded.roles || [],
    groups: decoded.groups || [],

    // Tenant info
    tenantId: decoded.tid,

    // Token metadata
    tokenIssuer: decoded.iss,
    tokenAudience: decoded.aud,
    tokenExpiry: decoded.exp ? new Date(decoded.exp * 1000) : null,
    tokenIssuedAt: decoded.iat ? new Date(decoded.iat * 1000) : null,

    // Original claims (for advanced scenarios)
    claims: decoded,
  };
}

/**
 * JWT Authentication Middleware
 * Validates the Bearer token and attaches user info to req.user
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
function authenticateJwt(req, res, next) {
  const authHeader = req.headers.authorization || '';

  // Check for Bearer token
  if (!authHeader.startsWith('Bearer ')) {
    log.debug('Auth failed: Missing bearer token', { path: req.path });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid authorization header',
      code: 'MISSING_TOKEN',
    });
  }

  // Check configuration
  if (!isConfigured) {
    log.error('Auth failed: Server not configured', { path: req.path });
    return res.status(500).json({
      error: 'Server Configuration Error',
      message: 'Authentication is not properly configured',
      code: 'AUTH_NOT_CONFIGURED',
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer '

  // Store raw token for OBO flows
  req.accessToken = token;

  // Verify the token
  jwt.verify(
    token,
    getSigningKey,
    {
      audience: audience,
      issuer: issuer,
      algorithms: ['RS256'],
    },
    (err, decoded) => {
      if (err) {
        let errorCode = 'INVALID_TOKEN';
        let message = 'Invalid or expired token';

        if (err.name === 'TokenExpiredError') {
          errorCode = 'TOKEN_EXPIRED';
          message = 'Token has expired';
        } else if (err.name === 'JsonWebTokenError') {
          errorCode = 'MALFORMED_TOKEN';
          message = 'Token is malformed';
        } else if (err.name === 'NotBeforeError') {
          errorCode = 'TOKEN_NOT_ACTIVE';
          message = 'Token is not yet active';
        }

        log.debug('Auth failed: Token verification failed', {
          path: req.path,
          error: err.message,
          errorCode,
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message,
          code: errorCode,
        });
      }

      // Extract and attach user information
      req.user = extractUserFromToken(decoded);

      log.debug('Auth successful', {
        userId: req.user.id,
        email: req.user.email,
        roles: req.user.roles,
        path: req.path,
      });

      next();
    }
  );
}

/**
 * Optional authentication middleware
 * Attempts to authenticate but allows unauthenticated requests
 * Sets req.user to null if no valid token
 */
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ') || !isConfigured) {
    req.user = null;
    req.accessToken = null;
    return next();
  }

  const token = authHeader.substring(7);
  req.accessToken = token;

  jwt.verify(
    token,
    getSigningKey,
    {
      audience: audience,
      issuer: issuer,
      algorithms: ['RS256'],
    },
    (err, decoded) => {
      if (err) {
        req.user = null;
        log.debug('Optional auth: Token invalid', { path: req.path });
      } else {
        req.user = extractUserFromToken(decoded);
        log.debug('Optional auth: Token valid', {
          userId: req.user.id,
          path: req.path,
        });
      }
      next();
    }
  );
}

/**
 * Role-based authorization middleware factory
 * @param {string[]} allowedRoles - Array of role names that are allowed
 * @returns {Function} - Express middleware
 */
function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'NOT_AUTHENTICATED',
      });
    }

    const userRoles = req.user.roles || [];
    const hasRole = allowedRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      log.warn('Authorization failed: Insufficient roles', {
        userId: req.user.id,
        userRoles,
        requiredRoles: allowedRoles,
        path: req.path,
      });

      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions',
        code: 'INSUFFICIENT_ROLES',
      });
    }

    next();
  };
}

/**
 * Check if auth is properly configured
 * @returns {boolean}
 */
function isAuthConfigured() {
  return isConfigured;
}

module.exports = {
  authenticateJwt,
  optionalAuthenticate,
  requireRoles,
  isAuthConfigured,
  extractUserFromToken,
};
