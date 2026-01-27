const Joi = require('joi');

/**
 * UUID validation pattern
 */
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Common validation schemas
 */
const schemas = {
  // Document ID parameter
  documentId: Joi.object({
    id: Joi.string().pattern(uuidPattern).required().messages({
      'string.pattern.base': 'Invalid document ID format. Must be a valid UUID.',
      'any.required': 'Document ID is required.',
    }),
  }),

  // GraphRAG query body
  graphragQuery: Joi.object({
    query: Joi.string().min(1).max(2000).required().messages({
      'string.min': 'Query must not be empty.',
      'string.max': 'Query must not exceed 2000 characters.',
      'any.required': 'Query is required.',
    }),
    options: Joi.object({
      maxResults: Joi.number().integer().min(1).max(50).default(10),
      includeGraph: Joi.boolean().default(true),
      documentIds: Joi.array().items(Joi.string().pattern(uuidPattern)).max(10),
      // Advanced GraphRAG options
      lazySummaries: Joi.boolean().optional(),
      minCommunitySize: Joi.number().integer().min(2).optional(),
      resolution: Joi.number().min(0.1).max(5.0).optional(),
      persona: Joi.string().valid('ops', 'it', 'leadership', 'compliance', 'default').optional(),
      includeCommunityContext: Joi.boolean().optional(),
      useImportanceWeighting: Joi.boolean().optional(),
      maxHops: Joi.number().integer().min(1).max(5).optional(),
      maxEntities: Joi.number().integer().min(1).max(100).optional(),
    }).optional(),
  }),

  // Document upload metadata
  documentUpload: Joi.object({
    title: Joi.string().max(255).optional(),
    description: Joi.string().max(2000).optional(),
    tags: Joi.alternatives()
      .try(
        Joi.array().items(Joi.string().max(50)).max(20),
        Joi.string().max(500) // Comma-separated string
      )
      .optional(),
  }),

  // Audit log query
  auditLogQuery: Joi.object({
    documentId: Joi.string().pattern(uuidPattern).optional(),
    entityId: Joi.string().pattern(uuidPattern).optional(),
    action: Joi.string().valid('approve', 'reject', 'edit', 'create', 'delete').optional(),
    userId: Joi.string().pattern(uuidPattern).optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().greater(Joi.ref('startDate')).optional(),
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),

  // Entity approval/rejection
  entityAction: Joi.object({
    entityId: Joi.string().pattern(uuidPattern).required(),
    action: Joi.string().valid('approve', 'reject').required(),
    reason: Joi.string().max(500).when('action', {
      is: 'reject',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    editedData: Joi.object().optional(),
  }),

  // Batch entity actions (with action field)
  batchEntityAction: Joi.object({
    action: Joi.string().valid('approve', 'reject').required(),
    reason: Joi.string().max(500).when('action', {
      is: 'reject',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  }),

  // Batch rejection (reason only, for reject-all endpoints)
  batchRejection: Joi.object({
    reason: Joi.string().min(1).max(500).required().messages({
      'string.min': 'Rejection reason is required.',
      'string.max': 'Rejection reason must not exceed 500 characters.',
      'any.required': 'Rejection reason is required.',
    }),
  }),

  // Pagination query parameters
  pagination: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).default(0),
    sortBy: Joi.string().valid('createdAt', 'updatedAt', 'title', 'status').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  // Document filter query
  documentFilter: Joi.object({
    status: Joi.string()
      .valid('pending', 'processing', 'completed', 'failed', 'pending_review')
      .optional(),
    mimeType: Joi.string().max(100).optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
  }),
};

/**
 * Middleware factory for validating request data
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {string} source - Source of data to validate ('body', 'query', 'params')
 * @returns {Function} Express middleware function
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];

    const { error, value } = schema.validate(data, {
      abortEarly: false, // Return all errors, not just the first
      stripUnknown: true, // Remove unknown keys
      convert: true, // Convert values to expected types
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // Replace request data with validated and sanitized data
    req[source] = value;
    next();
  };
}

/**
 * Middleware to validate document ID parameter
 */
const validateDocumentId = validate(schemas.documentId, 'params');

/**
 * Middleware to validate GraphRAG query body
 */
const validateGraphRAGQuery = validate(schemas.graphragQuery, 'body');

/**
 * Middleware to validate document upload metadata
 */
const validateDocumentUpload = validate(schemas.documentUpload, 'body');

/**
 * Middleware to validate audit log query
 */
const validateAuditLogQuery = validate(schemas.auditLogQuery, 'query');

/**
 * Middleware to validate entity action
 */
const validateEntityAction = validate(schemas.entityAction, 'body');

/**
 * Middleware to validate batch entity action
 */
const validateBatchEntityAction = validate(schemas.batchEntityAction, 'body');

/**
 * Middleware to validate batch rejection (reason only)
 */
const validateBatchRejection = validate(schemas.batchRejection, 'body');

/**
 * Middleware to validate pagination query parameters
 */
const validatePagination = validate(schemas.pagination, 'query');

/**
 * Middleware to validate document filter query
 */
const validateDocumentFilter = validate(schemas.documentFilter, 'query');

/**
 * Combined middleware for common document list request
 */
const validateDocumentListRequest = [
  validate(schemas.pagination, 'query'),
  validate(schemas.documentFilter, 'query'),
];

module.exports = {
  schemas,
  validate,
  validateDocumentId,
  validateGraphRAGQuery,
  validateDocumentUpload,
  validateAuditLogQuery,
  validateEntityAction,
  validateBatchEntityAction,
  validateBatchRejection,
  validatePagination,
  validateDocumentFilter,
  validateDocumentListRequest,
};
