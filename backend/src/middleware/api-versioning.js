const DEFAULT_API_VERSION = process.env.API_DEFAULT_VERSION || '1';

const HEADER_KEYS = ['x-api-version', 'api-version'];

function normalizeVersion(version) {
  if (!version) return null;
  const normalized = String(version).trim();
  if (!normalized) return null;
  if (/^v\d/i.test(normalized)) {
    return normalized.slice(1);
  }
  return normalized;
}

function normalizeSupportedVersions(value, fallback = []) {
  if (!value) return fallback;
  const list = Array.isArray(value) ? value : String(value).split(',');
  return list
    .map((version) => normalizeVersion(version))
    .filter(Boolean);
}

const SUPPORTED_API_VERSIONS = normalizeSupportedVersions(
  process.env.API_SUPPORTED_VERSIONS || DEFAULT_API_VERSION
);

function parseVersionFromPath(url) {
  if (!url) return null;
  const match = url.match(/^\/api\/v([^/?#]+)(?=\/|\?|$)/i);
  return match ? match[1] : null;
}

function getHeaderVersion(req) {
  for (const key of HEADER_KEYS) {
    const value = req.get(key);
    if (value) return value;
  }
  return null;
}

function getQueryVersion(req) {
  if (!req || !req.query) return null;
  return req.query['api-version'] || req.query.apiVersion || null;
}

function apiVersioning(options = {}) {
  const defaultVersion = normalizeVersion(options.defaultVersion || DEFAULT_API_VERSION);
  const supportedVersions = normalizeSupportedVersions(
    options.supportedVersions || SUPPORTED_API_VERSIONS
  );

  if (!supportedVersions.includes(defaultVersion)) {
    supportedVersions.push(defaultVersion);
  }

  return function apiVersionMiddleware(req, res, next) {
    const requestPath = req.path || req.url;
    if (!requestPath || (requestPath !== '/api' && !requestPath.startsWith('/api/'))) {
      return next();
    }

    const pathVersionRaw = parseVersionFromPath(req.url);
    const headerVersionRaw = getHeaderVersion(req);
    const queryVersionRaw = getQueryVersion(req);

    const specified = [
      { source: 'path', raw: pathVersionRaw },
      { source: 'header', raw: headerVersionRaw },
      { source: 'query', raw: queryVersionRaw },
    ].filter((entry) => entry.raw);

    const normalized = specified.map((entry) => ({
      ...entry,
      normalized: normalizeVersion(entry.raw),
    }));

    const uniqueVersions = new Set(normalized.map((entry) => entry.normalized).filter(Boolean));

    if (uniqueVersions.size > 1) {
      return res.status(400).json({
        error: 'Conflicting API versions',
        versions: normalized,
        supportedVersions,
        defaultVersion,
      });
    }

    const resolvedVersion =
      uniqueVersions.size === 1 ? Array.from(uniqueVersions)[0] : defaultVersion;

    if (!supportedVersions.includes(resolvedVersion)) {
      return res.status(400).json({
        error: 'Unsupported API version',
        requestedVersion: resolvedVersion,
        supportedVersions,
        defaultVersion,
      });
    }

    req.apiVersion = resolvedVersion;
    req.apiVersionSource = uniqueVersions.size === 1 ? normalized[0]?.source : 'default';
    res.setHeader('X-API-Version', resolvedVersion);

    if (pathVersionRaw) {
      req.url = req.url.replace(/^\/api\/v[^/?#]+(?=\/|\?|$)/i, '/api');
    }

    return next();
  };
}

module.exports = {
  apiVersioning,
  normalizeVersion,
  parseVersionFromPath,
  DEFAULT_API_VERSION,
  SUPPORTED_API_VERSIONS,
};
