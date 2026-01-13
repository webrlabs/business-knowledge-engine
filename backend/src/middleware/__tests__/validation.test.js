const { schemas, validate } = require('../validation');

describe('Validation Middleware', () => {
  describe('Document ID validation', () => {
    const schema = schemas.documentId;

    it('should accept valid UUID', () => {
      const result = schema.validate({
        id: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid UUID', () => {
      const result = schema.validate({ id: 'invalid-id' });
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Invalid document ID format');
    });

    it('should reject missing ID', () => {
      const result = schema.validate({});
      expect(result.error).toBeDefined();
    });
  });

  describe('GraphRAG query validation', () => {
    const schema = schemas.graphragQuery;

    it('should accept valid query', () => {
      const result = schema.validate({
        query: 'What are the procurement processes?',
      });
      expect(result.error).toBeUndefined();
    });

    it('should accept query with options', () => {
      const result = schema.validate({
        query: 'Test query',
        options: {
          maxResults: 20,
          includeGraph: true,
        },
      });
      expect(result.error).toBeUndefined();
      expect(result.value.options.maxResults).toBe(20);
    });

    it('should use default values for options', () => {
      const result = schema.validate({
        query: 'Test query',
        options: {},
      });
      expect(result.error).toBeUndefined();
      expect(result.value.options.maxResults).toBe(10);
      expect(result.value.options.includeGraph).toBe(true);
    });

    it('should reject empty query', () => {
      const result = schema.validate({ query: '' });
      expect(result.error).toBeDefined();
    });

    it('should reject query over 2000 characters', () => {
      const result = schema.validate({ query: 'a'.repeat(2001) });
      expect(result.error).toBeDefined();
    });

    it('should reject maxResults over 50', () => {
      const result = schema.validate({
        query: 'Test',
        options: { maxResults: 100 },
      });
      expect(result.error).toBeDefined();
    });
  });

  describe('Document upload validation', () => {
    const schema = schemas.documentUpload;

    it('should accept valid metadata', () => {
      const result = schema.validate({
        title: 'Test Document',
        description: 'A test document',
        tags: ['test', 'sample'],
      });
      expect(result.error).toBeUndefined();
    });

    it('should accept comma-separated tags string', () => {
      const result = schema.validate({
        tags: 'test, sample, document',
      });
      expect(result.error).toBeUndefined();
    });

    it('should accept empty object (all optional)', () => {
      const result = schema.validate({});
      expect(result.error).toBeUndefined();
    });

    it('should reject title over 255 characters', () => {
      const result = schema.validate({ title: 'a'.repeat(256) });
      expect(result.error).toBeDefined();
    });
  });

  describe('Batch rejection validation', () => {
    const schema = schemas.batchRejection;

    it('should accept valid rejection with reason', () => {
      const result = schema.validate({
        reason: 'Document quality is poor',
      });
      expect(result.error).toBeUndefined();
    });

    it('should reject empty reason', () => {
      const result = schema.validate({ reason: '' });
      expect(result.error).toBeDefined();
    });

    it('should reject missing reason', () => {
      const result = schema.validate({});
      expect(result.error).toBeDefined();
    });

    it('should reject reason over 500 characters', () => {
      const result = schema.validate({ reason: 'a'.repeat(501) });
      expect(result.error).toBeDefined();
    });
  });

  describe('Audit log query validation', () => {
    const schema = schemas.auditLogQuery;

    it('should accept valid query parameters', () => {
      const result = schema.validate({
        action: 'approve',
        limit: 50,
      });
      expect(result.error).toBeUndefined();
    });

    it('should use default values', () => {
      const result = schema.validate({});
      expect(result.error).toBeUndefined();
      expect(result.value.limit).toBe(50);
      expect(result.value.offset).toBe(0);
    });

    it('should reject invalid action', () => {
      const result = schema.validate({ action: 'invalid' });
      expect(result.error).toBeDefined();
    });

    it('should reject limit over 100', () => {
      const result = schema.validate({ limit: 200 });
      expect(result.error).toBeDefined();
    });
  });

  describe('validate middleware factory', () => {
    it('should create middleware function', () => {
      const middleware = validate(schemas.documentId, 'params');
      expect(typeof middleware).toBe('function');
    });

    it('should call next() on valid input', () => {
      const middleware = validate(schemas.documentId, 'params');
      const req = {
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
      };
      const res = {};
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.params.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should return 400 on invalid input', () => {
      const middleware = validate(schemas.documentId, 'params');
      const req = { params: { id: 'invalid' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
          details: expect.any(Array),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });
});
