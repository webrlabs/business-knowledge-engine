const express = require('express');
const request = require('supertest');
const { apiVersioning } = require('../api-versioning');

const buildApp = (options = {}) => {
  const app = express();
  app.use(apiVersioning(options));
  app.get('/api/ping', (req, res) => {
    res.json({
      ok: true,
      version: req.apiVersion,
      source: req.apiVersionSource,
    });
  });
  return app;
};

describe('apiVersioning middleware', () => {
  it('defaults to version 1 and sets response header', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/ping');

    expect(response.status).toBe(200);
    expect(response.headers['x-api-version']).toBe('1');
    expect(response.body.version).toBe('1');
    expect(response.body.source).toBe('default');
  });

  it('accepts version from path and rewrites route', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v1/ping');

    expect(response.status).toBe(200);
    expect(response.headers['x-api-version']).toBe('1');
    expect(response.body.version).toBe('1');
    expect(response.body.source).toBe('path');
  });

  it('accepts version from header', async () => {
    const app = buildApp();
    const response = await request(app)
      .get('/api/ping')
      .set('x-api-version', '1');

    expect(response.status).toBe(200);
    expect(response.body.version).toBe('1');
    expect(response.body.source).toBe('header');
  });

  it('accepts version from query parameter', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/ping?api-version=1');

    expect(response.status).toBe(200);
    expect(response.body.version).toBe('1');
    expect(response.body.source).toBe('query');
  });

  it('rejects unsupported versions from path', async () => {
    const app = buildApp();
    const response = await request(app).get('/api/v2/ping');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Unsupported API version');
    expect(response.body.supportedVersions).toContain('1');
  });

  it('rejects conflicting versions across sources', async () => {
    const app = buildApp();
    const response = await request(app)
      .get('/api/ping?api-version=1')
      .set('x-api-version', '2');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Conflicting API versions');
  });
});
