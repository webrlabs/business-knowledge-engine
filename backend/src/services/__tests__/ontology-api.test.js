/**
 * Tests for Ontology API Endpoints
 *
 * Feature: F2.1.5 - Ontology API Endpoint
 * GET /api/ontology/types - Return current ontology for UI/clients
 */

const request = require('supertest');

// Mock dependencies before requiring app
jest.mock('../../middleware/auth', () => ({
  authenticateJwt: (req, res, next) => {
    req.user = { id: 'test-user', email: 'test@example.com' };
    next();
  }
}));

jest.mock('../../utils/telemetry', () => ({
  initializeTelemetry: jest.fn(),
  telemetryMiddleware: (req, res, next) => next(),
  trackException: jest.fn(),
  flushTelemetry: jest.fn()
}));

jest.mock('../../utils/env-validator', () => ({
  validateAndReport: jest.fn(() => true),
  getConfigurationSummary: jest.fn(() => ({
    cosmos: { status: 'configured' },
    blob: { status: 'configured' }
  }))
}));

describe('Ontology API Endpoints (F2.1.5)', () => {
  let app;

  beforeAll(() => {
    // Import app after mocks are set up
    app = require('../../index');
  });

  describe('GET /api/ontology/types', () => {
    it('should return full ontology by default', async () => {
      const response = await request(app)
        .get('/api/ontology/types')
        .expect(200);

      expect(response.body).toHaveProperty('metadata');
      expect(response.body).toHaveProperty('entityTypes');
      expect(response.body).toHaveProperty('relationshipTypes');
      expect(response.body.metadata).toHaveProperty('version');
      expect(response.body.metadata).toHaveProperty('entityTypeCount');
      expect(response.body.metadata).toHaveProperty('relationshipTypeCount');
      expect(Array.isArray(response.body.entityTypes)).toBe(true);
      expect(Array.isArray(response.body.relationshipTypes)).toBe(true);
    });

    it('should return entity types only with view=entity-types', async () => {
      const response = await request(app)
        .get('/api/ontology/types?view=entity-types')
        .expect(200);

      expect(response.body).toHaveProperty('entityTypes');
      expect(response.body).toHaveProperty('count');
      expect(response.body).not.toHaveProperty('relationshipTypes');
      expect(response.body).not.toHaveProperty('metadata');
      expect(Array.isArray(response.body.entityTypes)).toBe(true);
      expect(response.body.count).toBe(response.body.entityTypes.length);
    });

    it('should return relationship types only with view=relationship-types', async () => {
      const response = await request(app)
        .get('/api/ontology/types?view=relationship-types')
        .expect(200);

      expect(response.body).toHaveProperty('relationshipTypes');
      expect(response.body).toHaveProperty('count');
      expect(response.body).not.toHaveProperty('entityTypes');
      expect(Array.isArray(response.body.relationshipTypes)).toBe(true);

      // Verify relationship type structure
      const relType = response.body.relationshipTypes[0];
      expect(relType).toHaveProperty('name');
      expect(relType).toHaveProperty('domain');
      expect(relType).toHaveProperty('range');
    });

    it('should return hierarchy for all types with view=hierarchy', async () => {
      const response = await request(app)
        .get('/api/ontology/types?view=hierarchy')
        .expect(200);

      expect(response.body).toHaveProperty('hierarchy');
      expect(typeof response.body.hierarchy).toBe('object');

      // Check that hierarchy contains type info
      const hierarchyKeys = Object.keys(response.body.hierarchy);
      expect(hierarchyKeys.length).toBeGreaterThan(0);

      // Verify hierarchy structure
      const firstType = response.body.hierarchy[hierarchyKeys[0]];
      expect(firstType).toHaveProperty('parent');
      expect(firstType).toHaveProperty('ancestors');
      expect(firstType).toHaveProperty('subtypes');
    });

    it('should return hierarchy for specific type with view=hierarchy&type=Process', async () => {
      const response = await request(app)
        .get('/api/ontology/types?view=hierarchy&type=Process')
        .expect(200);

      expect(response.body).toHaveProperty('type', 'Process');
      expect(response.body).toHaveProperty('ancestors');
      expect(response.body).toHaveProperty('subtypes');
      expect(response.body).toHaveProperty('isValid', true);
      expect(Array.isArray(response.body.ancestors)).toBe(true);
      expect(Array.isArray(response.body.subtypes)).toBe(true);
    });

    it('should return metadata only with view=metadata', async () => {
      const response = await request(app)
        .get('/api/ontology/types?view=metadata')
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('label');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('entityTypeCount');
      expect(response.body).toHaveProperty('relationshipTypeCount');
      expect(response.body).not.toHaveProperty('entityTypes');
      expect(response.body).not.toHaveProperty('relationshipTypes');
    });

    it('entity types should have required fields', async () => {
      const response = await request(app)
        .get('/api/ontology/types?view=entity-types')
        .expect(200);

      expect(response.body.entityTypes.length).toBeGreaterThan(0);

      // Check Process type exists
      const processType = response.body.entityTypes.find(t => t.name === 'Process');
      expect(processType).toBeDefined();
      expect(processType).toHaveProperty('name', 'Process');
      expect(processType).toHaveProperty('label');
      expect(processType).toHaveProperty('comment');
      expect(processType).toHaveProperty('parent');
    });

    it('relationship types should include domain and range constraints', async () => {
      const response = await request(app)
        .get('/api/ontology/types?view=relationship-types')
        .expect(200);

      // Check EXECUTES relationship
      const executesRel = response.body.relationshipTypes.find(r => r.name === 'EXECUTES');
      expect(executesRel).toBeDefined();
      expect(executesRel.domain).toBe('OrganizationalEntity');
      expect(executesRel.range).toBe('BusinessFlowEntity');
    });
  });

  describe('POST /api/ontology/validate', () => {
    it('should validate valid entities and relationships', async () => {
      const response = await request(app)
        .post('/api/ontology/validate')
        .send({
          entities: [
            { name: 'Order Processing', type: 'Process' },
            { name: 'Finance Manager', type: 'Role' }
          ],
          relationships: [
            { from: 'Finance Manager', to: 'Order Processing', type: 'EXECUTES' }
          ]
        })
        .expect(200);

      expect(response.body).toHaveProperty('valid');
      expect(response.body).toHaveProperty('entityReport');
      expect(response.body).toHaveProperty('relationshipReport');
      expect(response.body).toHaveProperty('summary');
    });

    it('should detect invalid entity types', async () => {
      const response = await request(app)
        .post('/api/ontology/validate')
        .send({
          entities: [
            { name: 'Invalid Thing', type: 'InvalidType' }
          ],
          relationships: []
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.entityReport.invalid).toBe(1);
      expect(response.body.entityReport.issues.length).toBe(1);
    });

    it('should detect domain/range violations', async () => {
      const response = await request(app)
        .post('/api/ontology/validate')
        .send({
          entities: [
            { name: 'SAP System', type: 'System' },
            { name: 'Order Process', type: 'Process' }
          ],
          relationships: [
            { from: 'SAP System', to: 'Order Process', type: 'EXECUTES' }
          ]
        })
        .expect(200);

      expect(response.body.valid).toBe(false);
      expect(response.body.relationshipReport.domainViolations).toBe(1);
    });

    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/api/ontology/validate')
        .send({})
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.entityReport.total).toBe(0);
      expect(response.body.relationshipReport.total).toBe(0);
    });
  });

  describe('POST /api/ontology/normalize', () => {
    it('should normalize relationship types using synonym mappings', async () => {
      const response = await request(app)
        .post('/api/ontology/normalize')
        .send({
          types: ['manages', 'supervises', 'utilizes', 'performs']
        })
        .expect(200);

      expect(response.body).toHaveProperty('normalizedTypes');
      expect(Array.isArray(response.body.normalizedTypes)).toBe(true);
      expect(response.body.normalizedTypes.length).toBe(4);

      const normalized = response.body.normalizedTypes;
      expect(normalized.find(n => n.original === 'manages').normalized).toBe('MANAGES');
      expect(normalized.find(n => n.original === 'supervises').normalized).toBe('MANAGES');
      expect(normalized.find(n => n.original === 'utilizes').normalized).toBe('USES');
      expect(normalized.find(n => n.original === 'performs').normalized).toBe('PERFORMS');
    });

    it('should handle empty types array', async () => {
      const response = await request(app)
        .post('/api/ontology/normalize')
        .send({ types: [] })
        .expect(200);

      expect(response.body.normalizedTypes).toEqual([]);
    });

    it('should uppercase unknown relationship types', async () => {
      const response = await request(app)
        .post('/api/ontology/normalize')
        .send({ types: ['unknownRelation'] })
        .expect(200);

      expect(response.body.normalizedTypes[0].normalized).toBe('UNKNOWNRELATION');
    });
  });
});
