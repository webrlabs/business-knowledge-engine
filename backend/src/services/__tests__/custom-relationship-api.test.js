const request = require('supertest');

// Mock dependencies
jest.mock('../../middleware/auth', () => ({
  authenticateJwt: (req, res, next) => {
    req.user = { id: 'test-user', roles: ['admin'] };
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

// Mock CustomOntologyService
const mockAddCustomRelationshipType = jest.fn();
const mockDeleteCustomRelationshipType = jest.fn();
const mockGetCustomRelationshipTypes = jest.fn();

jest.mock('../custom-ontology-service', () => ({
  getCustomOntologyService: jest.fn(() => ({
    getCustomEntityTypes: jest.fn().mockResolvedValue([]),
    getCustomRelationshipTypes: mockGetCustomRelationshipTypes,
    addCustomRelationshipType: mockAddCustomRelationshipType,
    deleteCustomRelationshipType: mockDeleteCustomRelationshipType,
    getCustomEntityTypeByName: jest.fn().mockResolvedValue(null),
    getCustomRelationshipTypeByName: jest.fn().mockImplementation(async (name) => {
        const types = await mockGetCustomRelationshipTypes();
        return types.find(t => t.name === name) || null;
    })
  }))
}));

describe('Custom Relationship API', () => {
  let app;

  beforeAll(() => {
    // Setup default mock responses
    mockGetCustomRelationshipTypes.mockResolvedValue([
      { name: 'EXISTING_REL', domain: ['Entity'], range: ['Entity'] }
    ]);
    mockAddCustomRelationshipType.mockResolvedValue({
        name: 'NEW_REL',
        domain: ['Entity'],
        range: ['Entity']
    });
    mockDeleteCustomRelationshipType.mockResolvedValue(true);

    app = require('../../index');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default behavior
    mockGetCustomRelationshipTypes.mockResolvedValue([
      { name: 'EXISTING_REL', domain: ['Entity'], range: ['Entity'] }
    ]);
  });

  describe('GET /api/ontology/custom-relationship-types', () => {
    it('should return all custom relationship types', async () => {
      const response = await request(app)
        .get('/api/ontology/custom-relationship-types')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.relationships).toHaveLength(1);
      expect(response.body.relationships[0].name).toBe('EXISTING_REL');
    });
  });

  describe('POST /api/ontology/custom-relationship-types', () => {
    it('should create a custom relationship type', async () => {
      const def = {
        name: 'NEW_REL',
        domain: 'Entity',
        range: 'Entity'
      };

      mockAddCustomRelationshipType.mockResolvedValue(def);

      const response = await request(app)
        .post('/api/ontology/custom-relationship-types')
        .send(def)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.relationship.name).toBe('NEW_REL');
      expect(mockAddCustomRelationshipType).toHaveBeenCalledWith(expect.objectContaining({
        name: 'NEW_REL'
      }));
    });

    it('should handle validation errors', async () => {
        mockAddCustomRelationshipType.mockRejectedValue(new Error('Relationship type name is required'));

        const response = await request(app)
            .post('/api/ontology/custom-relationship-types')
            .send({})
            .expect(400);
        
        expect(response.body.error).toBe('Failed to add custom relationship type');
        expect(response.body.message).toBe('Relationship type name is required');
    });
  });

  describe('DELETE /api/ontology/custom-relationship-types/:name', () => {
    it('should delete a custom relationship type', async () => {
      const response = await request(app)
        .delete('/api/ontology/custom-relationship-types/EXISTING_REL')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockDeleteCustomRelationshipType).toHaveBeenCalledWith('EXISTING_REL');
    });

    it('should handle errors during deletion', async () => {
        mockDeleteCustomRelationshipType.mockRejectedValue(new Error('Relationship type "UNKNOWN" not found'));

        const response = await request(app)
            .delete('/api/ontology/custom-relationship-types/UNKNOWN')
            .expect(400);

        expect(response.body.error).toBe('Failed to delete custom relationship type');
        expect(response.body.message).toContain('not found');
    });
  });
});
