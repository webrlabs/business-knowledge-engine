/**
 * Unit tests for Pagination Service (F5.2.4)
 */

const {
  encodeCursor,
  decodeCursor,
  createKeysetCursor,
  createContinuationCursor,
  createOffsetCursor,
  createPaginatedResponse,
  parsePaginationParams,
  paginateArray,
  buildPaginatedCosmosQuery,
  processPaginatedResults,
  paginationMiddleware,
  DEFAULTS,
  CURSOR_TYPES,
  PaginationService,
  getPaginationService,
} = require('../pagination-service');

describe('Pagination Service', () => {
  describe('Cursor Encoding/Decoding', () => {
    test('encodeCursor should encode object to base64 string', () => {
      const data = { type: 'keyset', sortValue: '2026-01-01', id: 'abc123' };
      const encoded = encodeCursor(data);

      expect(typeof encoded).toBe('string');
      expect(encoded).not.toEqual(JSON.stringify(data));
    });

    test('decodeCursor should decode base64 string to object', () => {
      const original = { type: 'keyset', sortValue: '2026-01-01', id: 'abc123' };
      const encoded = encodeCursor(original);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(original);
    });

    test('encodeCursor should return null for null input', () => {
      expect(encodeCursor(null)).toBeNull();
      expect(encodeCursor(undefined)).toBeNull();
    });

    test('decodeCursor should return null for null input', () => {
      expect(decodeCursor(null)).toBeNull();
      expect(decodeCursor(undefined)).toBeNull();
    });

    test('decodeCursor should return null for invalid base64', () => {
      expect(decodeCursor('not-valid-base64!!!')).toBeNull();
    });

    test('decodeCursor should return null for non-JSON content', () => {
      const invalidJson = Buffer.from('not json').toString('base64');
      expect(decodeCursor(invalidJson)).toBeNull();
    });
  });

  describe('Cursor Creators', () => {
    test('createKeysetCursor should create cursor with type and sortField', () => {
      const record = { id: 'doc123', timestamp: '2026-01-15T10:00:00Z', name: 'Test' };
      const cursor = createKeysetCursor(record, 'timestamp');
      const decoded = decodeCursor(cursor);

      expect(decoded.type).toBe(CURSOR_TYPES.KEYSET);
      expect(decoded.sortValue).toBe('2026-01-15T10:00:00Z');
      expect(decoded.id).toBe('doc123');
      expect(decoded.sortField).toBe('timestamp');
    });

    test('createKeysetCursor should use timestamp as default sortField', () => {
      const record = { id: 'doc123', timestamp: '2026-01-15T10:00:00Z' };
      const cursor = createKeysetCursor(record);
      const decoded = decodeCursor(cursor);

      expect(decoded.sortField).toBe('timestamp');
    });

    test('createKeysetCursor should return null for null record', () => {
      expect(createKeysetCursor(null)).toBeNull();
    });

    test('createContinuationCursor should create continuation cursor', () => {
      const token = 'cosmos-continuation-token-xyz';
      const cursor = createContinuationCursor(token);
      const decoded = decodeCursor(cursor);

      expect(decoded.type).toBe(CURSOR_TYPES.CONTINUATION);
      expect(decoded.token).toBe(token);
    });

    test('createContinuationCursor should return null for null token', () => {
      expect(createContinuationCursor(null)).toBeNull();
    });

    test('createOffsetCursor should create offset cursor', () => {
      const cursor = createOffsetCursor(20, 10);
      const decoded = decodeCursor(cursor);

      expect(decoded.type).toBe(CURSOR_TYPES.OFFSET);
      expect(decoded.offset).toBe(30); // 20 + 10
      expect(decoded.limit).toBe(10);
    });
  });

  describe('createPaginatedResponse', () => {
    test('should create standard paginated response', () => {
      const items = [{ id: '1' }, { id: '2' }];
      const response = createPaginatedResponse(items, {
        nextCursor: 'cursor123',
        hasMore: true,
        pageSize: 10,
      });

      expect(response.items).toEqual(items);
      expect(response.pagination.nextCursor).toBe('cursor123');
      expect(response.pagination.hasMore).toBe(true);
      expect(response.pagination.pageSize).toBe(10);
      expect(response.pagination.itemCount).toBe(2);
    });

    test('should include optional fields when provided', () => {
      const items = [{ id: '1' }];
      const response = createPaginatedResponse(items, {
        totalCount: 100,
        currentPage: 3,
      });

      expect(response.pagination.totalCount).toBe(100);
      expect(response.pagination.currentPage).toBe(3);
    });

    test('should not include optional fields when not provided', () => {
      const items = [{ id: '1' }];
      const response = createPaginatedResponse(items, {});

      expect(response.pagination).not.toHaveProperty('totalCount');
      expect(response.pagination).not.toHaveProperty('currentPage');
    });

    test('should handle empty items array', () => {
      const response = createPaginatedResponse([], {
        hasMore: false,
      });

      expect(response.items).toEqual([]);
      expect(response.pagination.itemCount).toBe(0);
      expect(response.pagination.hasMore).toBe(false);
    });
  });

  describe('parsePaginationParams', () => {
    test('should parse cursor from query', () => {
      const params = parsePaginationParams({ cursor: 'abc123' });
      expect(params.cursor).toBe('abc123');
    });

    test('should parse pageSize from query', () => {
      const params = parsePaginationParams({ pageSize: '25' });
      expect(params.pageSize).toBe(25);
    });

    test('should support limit alias for pageSize', () => {
      const params = parsePaginationParams({ limit: '30' });
      expect(params.pageSize).toBe(30);
    });

    test('should use default pageSize when not provided', () => {
      const params = parsePaginationParams({});
      expect(params.pageSize).toBe(DEFAULTS.PAGE_SIZE);
    });

    test('should enforce max pageSize', () => {
      const params = parsePaginationParams({ pageSize: '1000' });
      expect(params.pageSize).toBe(DEFAULTS.MAX_PAGE_SIZE);
    });

    test('should use default for invalid pageSize', () => {
      const params = parsePaginationParams({ pageSize: 'invalid' });
      expect(params.pageSize).toBe(DEFAULTS.PAGE_SIZE);
    });

    test('should use default for negative pageSize', () => {
      const params = parsePaginationParams({ pageSize: '-5' });
      expect(params.pageSize).toBe(DEFAULTS.PAGE_SIZE);
    });

    test('should parse sortBy field', () => {
      const params = parsePaginationParams({ sortBy: 'createdAt' });
      expect(params.sortField).toBe('createdAt');
    });

    test('should default sortField to timestamp', () => {
      const params = parsePaginationParams({});
      expect(params.sortField).toBe('timestamp');
    });

    test('should parse sortOrder', () => {
      const params = parsePaginationParams({ sortOrder: 'asc' });
      expect(params.sortOrder).toBe('ASC');
    });

    test('should default sortOrder to DESC', () => {
      const params = parsePaginationParams({});
      expect(params.sortOrder).toBe('DESC');
    });
  });

  describe('paginateArray', () => {
    const testItems = [
      { id: '1', timestamp: '2026-01-01', name: 'A' },
      { id: '2', timestamp: '2026-01-02', name: 'B' },
      { id: '3', timestamp: '2026-01-03', name: 'C' },
      { id: '4', timestamp: '2026-01-04', name: 'D' },
      { id: '5', timestamp: '2026-01-05', name: 'E' },
    ];

    test('should paginate first page', () => {
      const result = paginateArray(testItems, { pageSize: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).not.toBeNull();
      expect(result.pagination.totalCount).toBe(5);
    });

    test('should paginate with cursor to next page', () => {
      const firstPage = paginateArray(testItems, { pageSize: 2 });
      const secondPage = paginateArray(testItems, {
        pageSize: 2,
        cursor: firstPage.pagination.nextCursor,
      });

      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.items[0].id).toBe('3');
      expect(secondPage.items[1].id).toBe('4');
      expect(secondPage.pagination.hasMore).toBe(true);
    });

    test('should return last page correctly', () => {
      const firstPage = paginateArray(testItems, { pageSize: 2 });
      const secondPage = paginateArray(testItems, {
        pageSize: 2,
        cursor: firstPage.pagination.nextCursor,
      });
      const thirdPage = paginateArray(testItems, {
        pageSize: 2,
        cursor: secondPage.pagination.nextCursor,
      });

      expect(thirdPage.items).toHaveLength(1);
      expect(thirdPage.items[0].id).toBe('5');
      expect(thirdPage.pagination.hasMore).toBe(false);
      expect(thirdPage.pagination.nextCursor).toBeNull();
    });

    test('should sort by specified field', () => {
      const result = paginateArray(testItems, {
        pageSize: 3,
        sortField: 'name',
        sortOrder: 'ASC',
      });

      expect(result.items[0].name).toBe('A');
      expect(result.items[1].name).toBe('B');
      expect(result.items[2].name).toBe('C');
    });

    test('should sort descending', () => {
      const result = paginateArray(testItems, {
        pageSize: 3,
        sortField: 'name',
        sortOrder: 'DESC',
      });

      expect(result.items[0].name).toBe('E');
      expect(result.items[1].name).toBe('D');
      expect(result.items[2].name).toBe('C');
    });

    test('should handle empty array', () => {
      const result = paginateArray([], { pageSize: 10 });

      expect(result.items).toEqual([]);
      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.totalCount).toBe(0);
    });

    test('should return all items when pageSize > array length', () => {
      const result = paginateArray(testItems, { pageSize: 100 });

      expect(result.items).toHaveLength(5);
      expect(result.pagination.hasMore).toBe(false);
    });

    test('should include currentPage in response', () => {
      const firstPage = paginateArray(testItems, { pageSize: 2 });
      expect(firstPage.pagination.currentPage).toBe(1);

      const secondPage = paginateArray(testItems, {
        pageSize: 2,
        cursor: firstPage.pagination.nextCursor,
      });
      expect(secondPage.pagination.currentPage).toBe(2);
    });
  });

  describe('buildPaginatedCosmosQuery', () => {
    test('should build query with ORDER BY and LIMIT', () => {
      const { query, parameters, pageSize } = buildPaginatedCosmosQuery(
        'SELECT * FROM c',
        { pageSize: 10 }
      );

      expect(query).toContain('ORDER BY c.timestamp DESC, c.id DESC');
      expect(query).toContain('OFFSET 0 LIMIT @pageSize');
      expect(parameters.find(p => p.name === '@pageSize').value).toBe(11); // +1 for hasMore
      expect(pageSize).toBe(10);
    });

    test('should add keyset conditions for cursor', () => {
      const cursor = createKeysetCursor(
        { id: 'doc123', timestamp: '2026-01-15' },
        'timestamp'
      );

      const { query, parameters } = buildPaginatedCosmosQuery(
        'SELECT * FROM c',
        { cursor, pageSize: 10 }
      );

      expect(query).toContain('WHERE');
      expect(query).toContain('c.timestamp < @cursorSortValue');
      expect(query).toContain('c.id < @cursorId');
      expect(parameters.find(p => p.name === '@cursorSortValue').value).toBe('2026-01-15');
      expect(parameters.find(p => p.name === '@cursorId').value).toBe('doc123');
    });

    test('should use AND for keyset with existing WHERE', () => {
      const cursor = createKeysetCursor(
        { id: 'doc123', timestamp: '2026-01-15' },
        'timestamp'
      );

      const { query } = buildPaginatedCosmosQuery(
        'SELECT * FROM c WHERE c.status = "active"',
        { cursor, pageSize: 10 }
      );

      expect(query).toContain('AND (c.timestamp < @cursorSortValue');
    });

    test('should use > operator for ASC sort order', () => {
      const cursor = createKeysetCursor(
        { id: 'doc123', timestamp: '2026-01-15' },
        'timestamp'
      );

      const { query } = buildPaginatedCosmosQuery(
        'SELECT * FROM c',
        { cursor, sortOrder: 'ASC', pageSize: 10 }
      );

      expect(query).toContain('c.timestamp > @cursorSortValue');
      expect(query).toContain('ORDER BY c.timestamp ASC');
    });

    test('should use custom sortField', () => {
      const { query } = buildPaginatedCosmosQuery(
        'SELECT * FROM c',
        { sortField: 'createdAt', pageSize: 10 }
      );

      expect(query).toContain('ORDER BY c.createdAt DESC');
    });
  });

  describe('processPaginatedResults', () => {
    test('should detect hasMore when results exceed pageSize', () => {
      const results = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const response = processPaginatedResults(results, { pageSize: 2 });

      expect(response.items).toHaveLength(2);
      expect(response.pagination.hasMore).toBe(true);
      expect(response.pagination.nextCursor).not.toBeNull();
    });

    test('should not have more when results equal pageSize', () => {
      const results = [{ id: '1' }, { id: '2' }];
      const response = processPaginatedResults(results, { pageSize: 2 });

      expect(response.items).toHaveLength(2);
      expect(response.pagination.hasMore).toBe(false);
      expect(response.pagination.nextCursor).toBeNull();
    });

    test('should create cursor from last item', () => {
      const results = [
        { id: '1', timestamp: '2026-01-01' },
        { id: '2', timestamp: '2026-01-02' },
        { id: '3', timestamp: '2026-01-03' },
      ];
      const response = processPaginatedResults(results, { pageSize: 2 });

      const decoded = decodeCursor(response.pagination.nextCursor);
      expect(decoded.id).toBe('2');
      expect(decoded.sortValue).toBe('2026-01-02');
    });
  });

  describe('paginationMiddleware', () => {
    test('should add pagination to request', () => {
      const middleware = paginationMiddleware();
      const req = { query: { pageSize: '15', cursor: 'abc' } };
      const res = { json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.pagination).toBeDefined();
      expect(req.pagination.pageSize).toBe(15);
      expect(req.pagination.cursor).toBe('abc');
      expect(next).toHaveBeenCalled();
    });

    test('should add paginate helper to response', () => {
      const middleware = paginationMiddleware();
      const req = { query: {} };
      const res = { json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.paginate).toBeDefined();
      expect(typeof res.paginate).toBe('function');
    });

    test('res.paginate should send paginated response', () => {
      const middleware = paginationMiddleware();
      const req = { query: {} };
      const res = { json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);
      res.paginate([{ id: '1' }], { hasMore: false });

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          items: [{ id: '1' }],
          pagination: expect.objectContaining({ hasMore: false }),
        })
      );
    });

    test('should use custom default page size', () => {
      const middleware = paginationMiddleware({ defaultPageSize: 50 });
      const req = { query: {} };
      const res = { json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(req.pagination.pageSize).toBe(50);
    });
  });

  describe('PaginationService class', () => {
    test('should create singleton instance', () => {
      const service1 = getPaginationService();
      const service2 = getPaginationService();
      expect(service1).toBe(service2);
    });

    test('should provide encode/decode methods', () => {
      const service = new PaginationService();
      const data = { test: true };
      const encoded = service.encodeCursor(data);
      const decoded = service.decodeCursor(encoded);
      expect(decoded).toEqual(data);
    });

    test('should provide parseParams method', () => {
      const service = new PaginationService({ defaultPageSize: 25 });
      const params = service.parseParams({ pageSize: '10' });
      expect(params.pageSize).toBe(10);
    });

    test('should use custom defaults', () => {
      const service = new PaginationService({ defaultPageSize: 50 });
      const params = service.parseParams({});
      expect(params.pageSize).toBe(50);
    });

    test('should provide paginateArray method', () => {
      const service = new PaginationService({ defaultPageSize: 2 });
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const result = service.paginateArray(items, {});

      expect(result.items).toHaveLength(2);
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle items with null sortField values', () => {
      const items = [
        { id: '1', timestamp: null },
        { id: '2', timestamp: '2026-01-01' },
      ];

      const result = paginateArray(items, { sortField: 'timestamp', pageSize: 10 });
      expect(result.items).toHaveLength(2);
    });

    test('should handle items with undefined sortField values', () => {
      const items = [
        { id: '1' },
        { id: '2', timestamp: '2026-01-01' },
      ];

      const result = paginateArray(items, { sortField: 'timestamp', pageSize: 10 });
      expect(result.items).toHaveLength(2);
    });

    test('should handle very large pageSize request', () => {
      const params = parsePaginationParams({ pageSize: '999999' });
      expect(params.pageSize).toBe(DEFAULTS.MAX_PAGE_SIZE);
    });

    test('should handle special characters in cursor', () => {
      const data = { type: 'keyset', sortValue: 'test<script>alert(1)</script>', id: 'x"y\'z' };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(data);
    });

    test('should handle Unicode in cursor', () => {
      const data = { type: 'keyset', sortValue: '日本語テスト', id: '🎉' };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(data);
    });
  });
});
