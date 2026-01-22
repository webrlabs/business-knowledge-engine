// Load environment variables first
require('dotenv').config();

// Validate environment configuration before initializing services
const { validateAndReport, getConfigurationSummary } = require('./utils/env-validator');
const envValid = validateAndReport({
  exitOnError: process.env.NODE_ENV === 'production', // Only exit on error in production
  logWarnings: true,
});

// Initialize Application Insights first (before other imports for best auto-collection)
const { initializeTelemetry, telemetryMiddleware, trackException, flushTelemetry } = require('./utils/telemetry');
initializeTelemetry();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger');
const { authenticateJwt } = require('./middleware/auth');
const { log, httpLogger, logStartup } = require('./utils/logger');
const {
  generalLimiter,
  strictLimiter,
  processingLimiter,
  queryLimiter,
  uploadLimiter,
} = require('./middleware/rate-limit');
const {
  validateDocumentId,
  validateGraphRAGQuery,
  validateDocumentUpload,
  validateEntityAction,
  validateBatchRejection,
} = require('./middleware/validation');
const { uploadBuffer, deleteBlob, getBlobNameFromUrl } = require('./storage/blob');
const {
  createDocument,
  listDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  createAuditLog,
  queryAuditLogs,
} = require('./storage/cosmos');
const { getSearchService } = require('./services/search-service');
const { DocumentProcessor } = require('./pipelines/document-processor');
const { getGraphRAGQueryPipeline } = require('./pipelines/graphrag-query');
const { getGraphService } = require('./services/graph-service');
const { LeaderboardService } = require('./services/leaderboard-service');
const { getStagingService } = require('./services/staging-service');

const app = express();
const PORT = process.env.PORT || process.env.API_PORT || 8080; // Port configuration

// Configure multer for file uploads (memory, then upload to Blob Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only specific file types
    const allowedTypes = ['.pdf', '.docx', '.pptx', '.xlsx', '.vsdx', '.doc', '.ppt', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`));
    }
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Application Insights telemetry
app.use(telemetryMiddleware);

// HTTP request logging
app.use(httpLogger);

// Apply general rate limiting to all API routes
app.use('/api', generalLimiter);

// Require Entra ID JWT for API routes
app.use('/api', authenticateJwt);

// Apply strict rate limiting to auth endpoints
app.use('/api/auth', strictLimiter);

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Business Process Knowledge Platform API',
}));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check if the API server is running and healthy
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /health/detailed:
 *   get:
 *     summary: Detailed health check
 *     description: Check API health with configuration status
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Detailed health information
 */
app.get('/health/detailed', (req, res) => {
  const configSummary = getConfigurationSummary();
  const allConfigured = Object.values(configSummary).every((s) => s.status === 'configured');

  res.json({
    status: allConfigured ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    configuration: configSummary,
    version: process.env.npm_package_version || '1.0.0',
  });
});

/**
 * @swagger
 * /api/telemetry:
 *   post:
 *     summary: Receive frontend telemetry
 *     description: Relay frontend telemetry events to Application Insights
 *     tags: [Telemetry]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               events:
 *                 type: array
 *               exceptions:
 *                 type: array
 *     responses:
 *       200:
 *         description: Telemetry received
 */
app.post('/api/telemetry', express.json(), (req, res) => {
  const { events = [], exceptions = [] } = req.body;
  const { trackEvent, trackException: backendTrackException } = require('./utils/telemetry');

  // Relay events to Application Insights
  for (const event of events) {
    trackEvent(`frontend.${event.name}`, {
      ...event.properties,
      source: 'frontend',
      timestamp: event.timestamp,
    }, event.measurements || {});
  }

  // Relay exceptions to Application Insights
  for (const exception of exceptions) {
    const error = new Error(exception.message);
    error.stack = exception.stack;
    backendTrackException(error, {
      ...exception.properties,
      source: 'frontend',
      timestamp: exception.timestamp,
    });
  }

  res.json({ received: events.length + exceptions.length });
});

/**
 * @swagger
 * /api/auth/verify:
 *   post:
 *     summary: Verify authentication token
 *     description: Verify a bearer token and return user information
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Token is valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: true
 *                 userId:
 *                   type: string
 *                   example: 00000000-0000-0000-0000-000000000000
 *                 message:
 *                   type: string
 *                   example: Token verified successfully
 *       401:
 *         description: Invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/auth/verify', (req, res) => {
  const user = req.user || {};
  const userId = user.oid || user.sub || user.preferred_username || user.upn || 'unknown';

  res.json({
    valid: true,
    userId,
    message: 'Token verified successfully',
  });
});

/**
 * @swagger
 * /api/user/profile:
 *   get:
 *     summary: Get user profile
 *     description: Get the authenticated user's profile information
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   example: admin@contoso.com
 *                 name:
 *                   type: string
 *                   example: Test User
 *                 email:
 *                   type: string
 *                   example: test@contoso.com
 *                 roles:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: [Contributor]
 *       401:
 *         description: Unauthorized - missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/user/profile', (req, res) => {
  const user = req.user || {};
  const email = user.preferred_username || user.upn || '';
  const name = user.name || email;
  const roles = user.roles || [];

  res.json({
    id: user.oid || user.sub || email,
    name,
    email,
    roles,
  });
});

// Helper to build audit log entry
function buildAuditLogEntry(action, entityType, entityId, user, details = {}) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    entityType,
    entityId,
    userId: user.oid || user.sub || user.preferred_username || 'unknown',
    userEmail: user.preferred_username || user.upn || '',
    userName: user.name || user.preferred_username || 'Unknown User',
    details,
    immutable: true,
  };
}

/**
 * @swagger
 * /api/documents/upload:
 *   post:
 *     summary: Upload a document
 *     description: Upload a document file (PDF, Word, PowerPoint, Excel, Visio). Processing starts automatically after upload.
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Document file to upload
 *               title:
 *                 type: string
 *                 description: Document title (optional, defaults to filename)
 *                 example: Quarterly Report
 *               description:
 *                 type: string
 *                 description: Document description (optional)
 *                 example: Q4 2024 financial report
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags (optional)
 *                 example: finance,quarterly
 *     responses:
 *       201:
 *         description: Document uploaded and processing started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Document uploaded and processing started
 *                 document:
 *                   $ref: '#/components/schemas/Document'
 *       400:
 *         description: Bad request - no file uploaded or invalid file type
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error during upload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/documents/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Extract metadata from request body
    const { title, description, tags } = req.body;
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const blobName = `${uniqueSuffix}-${req.file.originalname}`;
    const blobResult = await uploadBuffer(
      req.file.buffer,
      blobName,
      req.file.mimetype
    );

    // Create document record
    const document = {
      id: crypto.randomUUID(),
      documentType: 'document',
      filename: blobName,
      originalName: req.file.originalname,
      title: title || req.file.originalname,
      description: description || '',
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      status: 'pending', // pending, processing, completed, failed
      blobUrl: blobResult.url,
    };

    const saved = await createDocument(document);

    // Automatically start processing
    const processingStartedAt = new Date().toISOString();
    await updateDocument(saved.id, {
      status: 'processing',
      processingStartedAt,
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded and processing started',
      document: {
        id: saved.id,
        filename: saved.filename,
        originalName: saved.originalName,
        title: saved.title,
        description: saved.description,
        tags: saved.tags,
        size: saved.size,
        uploadedAt: saved.uploadedAt,
        status: 'processing',
      },
    });

    // Process document asynchronously (after response is sent)
    const cosmosService = {
      updateDocument,
      getDocument: getDocumentById,
    };

    const processor = new DocumentProcessor(cosmosService);
    processor
      .processDocument(saved.id, saved.blobUrl, {
        mimeType: saved.mimeType,
        filename: saved.filename,
        title: saved.title,
      })
      .then((result) => {
        log.documentProcessing(saved.id, 'completed', { stats: result?.stats });
      })
      .catch((err) => {
        log.errorWithStack(`Document ${saved.id} processing failed`, err, { documentId: saved.id });
      });
  } catch (error) {
    log.errorWithStack('Upload error', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/documents:
 *   get:
 *     summary: Get all documents
 *     description: Retrieve a list of all uploaded documents
 *     tags: [Documents]
 *     responses:
 *       200:
 *         description: List of documents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 documents:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Document'
 *                 total:
 *                   type: integer
 *                   description: Total number of documents
 *                   example: 42
 */
app.get('/api/documents', async (req, res) => {
  const docs = await listDocuments();
  res.json({
    documents: docs.map(doc => ({
      id: doc.id,
      filename: doc.filename,
      originalName: doc.originalName,
      title: doc.title,
      description: doc.description,
      tags: doc.tags,
      size: doc.size,
      uploadedAt: doc.uploadedAt,
      status: doc.status,
    })),
    total: docs.length,
  });
});

/**
 * @swagger
 * /api/stats/dashboard:
 *   get:
 *     summary: Get dashboard statistics
 *     description: Retrieve key metrics and recent activity for the dashboard
 *     tags: [Statistics]
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardStats'
 */
app.get('/api/stats/dashboard', async (req, res) => {
  const docs = await listDocuments();
  const totalDocuments = docs.length;
  const pendingReviews = docs.filter(doc => doc.status === 'pending').length;
  const completedDocuments = docs.filter(doc => doc.status === 'completed').length;
  const failedDocuments = docs.filter(doc => doc.status === 'failed').length;

  // Try to get real graph stats, fall back to estimates if unavailable
  let graphStats = { vertexCount: 0, edgeCount: 0 };
  try {
    const graphService = getGraphService();
    graphStats = await graphService.getStats();
  } catch {
    // Graph service may not be configured yet, use estimates
    graphStats = {
      vertexCount: totalDocuments * 15,
      edgeCount: totalDocuments * 12,
    };
  }

  const stats = {
    totalDocuments,
    totalEntities: graphStats.vertexCount,
    pendingReviews,
    completedDocuments,
    failedDocuments,
    graphSize: {
      nodes: graphStats.vertexCount,
      edges: graphStats.edgeCount,
    },
    recentActivity: docs
      .slice(-5)
      .reverse()
      .map(doc => ({
        id: doc.id,
        type: 'document_upload',
        title: doc.title,
        timestamp: doc.uploadedAt,
        status: doc.status,
      })),
  };

  res.json(stats);
});

/**
 * @swagger
 * /api/documents/{id}:
 *   get:
 *     summary: Get document by ID
 *     description: Retrieve a specific document by its ID
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *         example: 1
 *     responses:
 *       200:
 *         description: Document retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Document'
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get('/api/documents/:id', validateDocumentId, async (req, res) => {
  const id = req.params.id;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.json({
    id: document.id,
    filename: document.filename,
    originalName: document.originalName,
    title: document.title,
    description: document.description,
    tags: document.tags,
    size: document.size,
    uploadedAt: document.uploadedAt,
    status: document.status,
    extractedText: document.extractedText || '',
    entities: document.entities || [],
    relationships: document.relationships || [],
    processingResults: document.processingResults || null,
  });
});

/**
 * @swagger
 * /api/documents/{id}:
 *   delete:
 *     summary: Delete a document
 *     description: Delete a document and all associated data (blob storage, search index, graph)
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 deletedResources:
 *                   type: object
 *                   properties:
 *                     document:
 *                       type: boolean
 *                     blob:
 *                       type: boolean
 *                     searchIndex:
 *                       type: boolean
 *                     graph:
 *                       type: boolean
 *       404:
 *         description: Document not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.delete('/api/documents/:id', validateDocumentId, async (req, res) => {
  const id = req.params.id;
  const deletedResources = {
    document: false,
    blob: false,
    searchIndex: false,
    graph: false,
  };

  try {
    // Get document to find blob URL
    const document = await getDocumentById(id);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Delete from search index
    try {
      const searchService = getSearchService();
      await searchService.deleteDocumentsByDocumentId(id);
      deletedResources.searchIndex = true;
    } catch (error) {
      log.warn({ documentId: id, error: error.message }, 'Failed to delete from search index');
    }

    // Delete from graph
    try {
      const graphService = getGraphService();
      await graphService.deleteEdgesByDocumentId(id);
      await graphService.deleteVertexByDocumentId(id);
      deletedResources.graph = true;
    } catch (error) {
      log.warn({ documentId: id, error: error.message }, 'Failed to delete from graph');
    }

    // Delete blob from storage
    if (document.blobUrl) {
      try {
        const blobName = getBlobNameFromUrl(document.blobUrl);
        await deleteBlob(blobName);
        deletedResources.blob = true;
      } catch (error) {
        log.warn({ documentId: id, error: error.message }, 'Failed to delete blob');
      }
    }

    // Delete document from Cosmos DB
    try {
      const deleted = await deleteDocument(id);
      deletedResources.document = deleted;
    } catch (error) {
      log.error({ documentId: id, error: error.message }, 'Failed to delete from Cosmos DB');
      // If we can't delete from Cosmos, return an error
      return res.status(500).json({ error: `Failed to delete document from database: ${error.message}` });
    }

    // Create audit log (don't fail if this fails)
    try {
      await createAuditLog({
        entityType: 'document',
        entityId: id,
        action: 'delete',
        timestamp: new Date().toISOString(),
        details: { deletedResources },
      });
    } catch (error) {
      log.warn({ documentId: id, error: error.message }, 'Failed to create audit log for deletion');
    }

    res.json({
      message: 'Document deleted successfully',
      deletedResources,
    });
  } catch (error) {
    log.error({ documentId: id, error: error.message, stack: error.stack }, 'Error deleting document');
    res.status(500).json({ error: `Failed to delete document: ${error.message}` });
  }
});

/**
 * @swagger
 * /api/documents/{id}/entities/approve-all:
 *   post:
 *     summary: Approve all entities for a document
 *     description: Batch approve all extracted entities from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     responses:
 *       200:
 *         description: All entities approved successfully
 *       404:
 *         description: Document not found
 */
app.post('/api/documents/:id/entities/approve-all', validateDocumentId, async (req, res) => {
  const id = req.params.id;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const user = req.user || {};
  const entities = document.entities || [];
  const auditEntries = [];

  // Create audit log entries for all entities
  for (const entity of entities) {
    const auditEntry = buildAuditLogEntry('approve', 'entity', entity.id, user, {
      entityName: entity.name,
      entityCategory: entity.type,
      confidenceScore: entity.confidence,
      documentId: id,
      batchOperation: true,
    });
    auditEntries.push(auditEntry);
  }

  // Save all audit entries
  for (const entry of auditEntries) {
    await createAuditLog(entry);
  }

  // Update document status to completed
  await updateDocument(id, {
    status: 'completed',
    reviewedAt: new Date().toISOString(),
    reviewedBy: user.oid || user.sub || user.preferred_username || 'unknown',
  });

  res.json({
    success: true,
    message: `All ${entities.length} entities approved successfully`,
    approvedCount: entities.length,
    documentId: id,
  });
});

/**
 * @swagger
 * /api/documents/{id}/entities/reject-all:
 *   post:
 *     summary: Reject all entities for a document
 *     description: Batch reject all extracted entities from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for rejection
 *     responses:
 *       200:
 *         description: All entities rejected successfully
 *       404:
 *         description: Document not found
 */
app.post('/api/documents/:id/entities/reject-all', validateDocumentId, validateBatchRejection, async (req, res) => {
  const id = req.params.id;
  const { reason } = req.body;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const user = req.user || {};
  const entities = document.entities || [];
  const auditEntries = [];

  // Create audit log entries for all entities
  for (const entity of entities) {
    const auditEntry = buildAuditLogEntry('reject', 'entity', entity.id, user, {
      entityName: entity.name,
      entityCategory: entity.type,
      confidenceScore: entity.confidence,
      documentId: id,
      reason,
      batchOperation: true,
    });
    auditEntries.push(auditEntry);
  }

  // Save all audit entries
  for (const entry of auditEntries) {
    await createAuditLog(entry);
  }

  // Update document status to pending (can be reprocessed)
  await updateDocument(id, {
    status: 'pending',
    rejectedAt: new Date().toISOString(),
    rejectedBy: user.oid || user.sub || user.preferred_username || 'unknown',
    rejectionReason: reason,
  });

  res.json({
    success: true,
    message: `All ${entities.length} entities rejected successfully`,
    rejectedCount: entities.length,
    documentId: id,
    reason,
  });
});

/**
 * @swagger
 * /api/documents/{id}/entities/{entityId}/approve:
 *   post:
 *     summary: Approve a single entity
 *     description: Approve a specific extracted entity from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     responses:
 *       200:
 *         description: Entity approved successfully
 *       404:
 *         description: Document or entity not found
 */
app.post('/api/documents/:id/entities/:entityId/approve', validateDocumentId, async (req, res) => {
  const { id, entityId } = req.params;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const entity = (document.entities || []).find(e => e.id === entityId);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  const user = req.user || {};
  const auditEntry = buildAuditLogEntry('approve', 'entity', entityId, user, {
    entityName: entity.name,
    entityCategory: entity.type,
    confidenceScore: entity.confidence,
    documentId: id,
  });

  await createAuditLog(auditEntry);

  res.json({
    success: true,
    message: 'Entity approved successfully',
    entityId,
    documentId: id,
  });
});

/**
 * @swagger
 * /api/documents/{id}/entities/{entityId}/reject:
 *   post:
 *     summary: Reject a single entity
 *     description: Reject a specific extracted entity from a document
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Document ID
 *       - in: path
 *         name: entityId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entity ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for rejection
 *     responses:
 *       200:
 *         description: Entity rejected successfully
 *       404:
 *         description: Document or entity not found
 */
app.post('/api/documents/:id/entities/:entityId/reject', validateDocumentId, async (req, res) => {
  const { id, entityId } = req.params;
  const { reason } = req.body;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const entity = (document.entities || []).find(e => e.id === entityId);
  if (!entity) {
    return res.status(404).json({ error: 'Entity not found' });
  }

  const user = req.user || {};
  const auditEntry = buildAuditLogEntry('reject', 'entity', entityId, user, {
    entityName: entity.name,
    entityCategory: entity.type,
    confidenceScore: entity.confidence,
    documentId: id,
    reason: reason || '',
  });

  await createAuditLog(auditEntry);

  res.json({
    success: true,
    message: 'Entity rejected successfully',
    entityId,
    documentId: id,
    reason: reason || '',
  });
});

/**
 * @swagger
 * /api/documents/{id}/process:
 *   post:
 *     summary: Process a document with Azure AI Document Intelligence
 *     description: Start OCR processing on an uploaded document to extract text, tables, and structure
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Processing started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 document:
 *                   $ref: '#/components/schemas/Document'
 *       404:
 *         description: Document not found
 *       500:
 *         description: Processing error
 */
app.post('/api/documents/:id/process', processingLimiter, async (req, res) => {
  const id = req.params.id;
  const document = await getDocumentById(id);

  if (!document) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Check if already processing
  if (document.status === 'processing') {
    return res.status(409).json({
      error: 'Document is already being processed',
      status: document.status,
    });
  }

  const processingStartedAt = new Date().toISOString();

  // Return immediately, process asynchronously
  res.json({
    success: true,
    message: 'Document processing started',
    document: {
      id: document.id,
      status: 'processing',
      processingStartedAt,
    },
  });

  // Create cosmos service wrapper for the processor
  const cosmosService = {
    updateDocument,
    getDocument: getDocumentById,
  };

  // Process document asynchronously
  const processor = new DocumentProcessor(cosmosService);

  processor
    .processDocument(id, document.blobUrl, {
      mimeType: document.mimeType,
      filename: document.filename,
      title: document.title,
    })
    .then((result) => {
      log.documentProcessing(id, 'completed', { stats: result.stats });
    })
    .catch((err) => {
      log.errorWithStack(`Document ${id} processing failed`, err, { documentId: id });
    });
});

/**
 * @swagger
 * /api/audit/logs:
 *   get:
 *     summary: Get audit logs
 *     description: Retrieve audit logs with optional filtering by entity ID, action type, or date range
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: entityId
 *         schema:
 *           type: string
 *         description: Filter by entity ID
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *           enum: [approve, reject, create, update, delete]
 *         description: Filter by action type
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *           enum: [entity, relationship, document]
 *         description: Filter by entity type
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of logs to return
 *     responses:
 *       200:
 *         description: Audit logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AuditLog'
 *                 total:
 *                   type: integer
 */
app.get('/api/audit/logs', async (req, res) => {
  const { entityId, action, entityType, limit = 100 } = req.query;
  const logs = await queryAuditLogs({
    entityId,
    action,
    entityType,
    limit: Number(limit),
  });

  res.json({
    logs,
    total: logs.length,
  });
});

/**
 * @swagger
 * /api/audit/log:
 *   post:
 *     summary: Create audit log entry
 *     description: Create a new audit log entry for entity approval, rejection, or other actions
 *     tags: [Audit]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - entityType
 *               - entityId
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [approve, reject, create, update, delete]
 *                 example: approve
 *               entityType:
 *                 type: string
 *                 enum: [entity, relationship, document]
 *                 example: entity
 *               entityId:
 *                 type: string
 *                 example: entity-123
 *               details:
 *                 type: object
 *                 description: Additional context about the action
 *                 properties:
 *                   entityName:
 *                     type: string
 *                   entityCategory:
 *                     type: string
 *                   confidenceScore:
 *                     type: number
 *                   reason:
 *                     type: string
 *     responses:
 *       201:
 *         description: Audit log entry created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuditLog'
 *       400:
 *         description: Invalid request
 */
app.post('/api/audit/log', async (req, res) => {
  const { action, entityType, entityId, details = {} } = req.body;
  const user = req.user || {};

  if (!action || !entityType || !entityId) {
    return res.status(400).json({
      error: 'Missing required fields: action, entityType, entityId'
    });
  }

  const validActions = ['approve', 'reject', 'create', 'update', 'delete'];
  if (!validActions.includes(action)) {
    return res.status(400).json({
      error: `Invalid action. Must be one of: ${validActions.join(', ')}`
    });
  }

  const validEntityTypes = ['entity', 'relationship', 'document'];
  if (!validEntityTypes.includes(entityType)) {
    return res.status(400).json({
      error: `Invalid entityType. Must be one of: ${validEntityTypes.join(', ')}`
    });
  }

  const auditEntry = buildAuditLogEntry(action, entityType, entityId, user, details);
  const saved = await createAuditLog(auditEntry);

  res.status(201).json(saved);
});

/**
 * @swagger
 * /api/graphrag/stats:
 *   get:
 *     summary: Get graph statistics
 *     description: Get counts of nodes and edges in the knowledge graph
 *     tags: [GraphRAG]
 *     responses:
 *       200:
 *         description: Graph statistics retrieved successfully
 */
app.get('/api/graphrag/stats', async (req, res) => {
  try {
    const graphService = getGraphService();
    const stats = await graphService.getStats();
    res.json(stats);
  } catch (error) {
    log.errorWithStack('Graph stats error', error);
    res.status(500).json({
      error: 'Failed to fetch graph statistics',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graph/entities:
 *   get:
 *     summary: Get graph entities and relationships
 *     description: Get all entities and their relationships for visualization
 *     tags: [GraphRAG]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 500
 *         description: Maximum number of entities to return
 *     responses:
 *       200:
 *         description: Graph data retrieved successfully
 */
app.get('/api/graph/entities', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const graphService = getGraphService();
    const data = await graphService.getAllEntities(limit);
    res.json(data);
  } catch (error) {
    log.errorWithStack('Graph entities error', error);
    res.status(500).json({
      error: 'Failed to fetch graph entities',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/graphrag/query:
 *   post:
 *     summary: Submit a GraphRAG query
 *     description: Submit a natural language query to the GraphRAG system for processing
 *     tags: [GraphRAG]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 description: Natural language query about business processes
 *                 example: What are the steps in the procurement process?
 *     responses:
 *       200:
 *         description: Query processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                   description: AI-generated answer to the query
 *                 citations:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Source documents used to generate the answer
 *                 responseTime:
 *                   type: number
 *                   description: Query processing time in milliseconds
 *       400:
 *         description: Invalid query
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post('/api/graphrag/query', queryLimiter, async (req, res) => {
  const { query, options = {} } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query is required and must be a non-empty string' });
  }

  try {
    const pipeline = getGraphRAGQueryPipeline();

    // Pass user context for security trimming and audit
    const result = await pipeline.processQueryWithFallback(query, {
      topK: options.topK || 10,
      graphDepth: options.graphDepth || 2,
      includeGraphContext: options.includeGraphContext !== false,
      semantic: options.semantic !== false,
      user: req.user, // Pass authenticated user for security trimming
    });

    res.json(result);
  } catch (error) {
    log.errorWithStack('GraphRAG query error', error);
    res.status(500).json({
      error: 'Query processing failed',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/leaderboard:
 *   get:
 *     summary: Get user leaderboard
 *     description: Retrieve the gamification leaderboard
 *     tags: [Gamification]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of top users to return
 *     responses:
 *       200:
 *         description: Leaderboard retrieved successfully
 */
app.get('/api/leaderboard', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const scores = await LeaderboardService.getLeaderboard(limit);
  res.json(scores);
});

// ============================================
// Staging API Routes
// ============================================

/**
 * @swagger
 * /api/staging/sessions:
 *   post:
 *     summary: Create a staging session
 *     description: Create a new staging session for reviewing and editing document entities
 *     tags: [Staging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - documentId
 *             properties:
 *               documentId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Staging session created successfully
 *       404:
 *         description: Document not found
 */
app.post('/api/staging/sessions', async (req, res) => {
  try {
    const { documentId } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: 'documentId is required' });
    }

    const user = req.user || {};
    const stagingService = getStagingService();
    const session = await stagingService.createSession(
      documentId,
      user.oid || user.sub || 'unknown',
      user.preferred_username || user.upn || '',
      user.name || 'Unknown User'
    );

    res.status(201).json(session);
  } catch (error) {
    log.errorWithStack('Create staging session error', error);
    if (error.message === 'Document not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create staging session', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}:
 *   get:
 *     summary: Get a staging session
 *     description: Retrieve a staging session by ID with all staged entities and changes
 *     tags: [Staging]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staging session retrieved successfully
 *       404:
 *         description: Staging session not found
 */
app.get('/api/staging/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();
    const session = await stagingService.getSession(id, documentId);

    if (!session) {
      return res.status(404).json({ error: 'Staging session not found' });
    }

    res.json(session);
  } catch (error) {
    log.errorWithStack('Get staging session error', error);
    res.status(500).json({ error: 'Failed to get staging session', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}:
 *   delete:
 *     summary: Discard a staging session
 *     description: Discard all changes and delete the staging session
 *     tags: [Staging]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Staging session discarded successfully
 *       404:
 *         description: Staging session not found
 */
app.delete('/api/staging/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const user = req.user || {};
    const stagingService = getStagingService();

    await stagingService.discardSession(id, documentId, user);
    res.json({ success: true, message: 'Staging session discarded' });
  } catch (error) {
    log.errorWithStack('Discard staging session error', error);
    if (error.message === 'Staging session not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to discard staging session', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities:
 *   post:
 *     summary: Add a new entity to staging
 *     description: Add a new entity to the staging session
 *     tags: [Staging]
 */
app.post('/api/staging/sessions/:id/entities', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const entityData = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.addEntity(id, documentId, entityData);
    res.status(201).json(session);
  } catch (error) {
    log.errorWithStack('Add entity to staging error', error);
    res.status(500).json({ error: 'Failed to add entity', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities/{entityId}:
 *   patch:
 *     summary: Modify an entity in staging
 *     description: Update an entity's properties in the staging session
 *     tags: [Staging]
 */
app.patch('/api/staging/sessions/:id/entities/:entityId', async (req, res) => {
  try {
    const { id, entityId } = req.params;
    const { documentId } = req.query;
    const updates = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.modifyEntity(id, documentId, entityId, updates);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Modify entity in staging error', error);
    res.status(500).json({ error: 'Failed to modify entity', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities/{entityId}:
 *   delete:
 *     summary: Delete an entity from staging
 *     description: Mark an entity as deleted in the staging session
 *     tags: [Staging]
 */
app.delete('/api/staging/sessions/:id/entities/:entityId', async (req, res) => {
  try {
    const { id, entityId } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();

    const session = await stagingService.deleteEntity(id, documentId, entityId);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Delete entity from staging error', error);
    res.status(500).json({ error: 'Failed to delete entity', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/entities/{entityId}/position:
 *   patch:
 *     summary: Update entity position
 *     description: Update an entity's position in the graph layout
 *     tags: [Staging]
 */
app.patch('/api/staging/sessions/:id/entities/:entityId/position', async (req, res) => {
  try {
    const { id, entityId } = req.params;
    const { documentId } = req.query;
    const { position } = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.updateEntityPosition(id, documentId, entityId, position);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Update entity position error', error);
    res.status(500).json({ error: 'Failed to update entity position', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/relationships:
 *   post:
 *     summary: Add a new relationship to staging
 *     description: Add a new relationship between entities in the staging session
 *     tags: [Staging]
 */
app.post('/api/staging/sessions/:id/relationships', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const relationshipData = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.addRelationship(id, documentId, relationshipData);
    res.status(201).json(session);
  } catch (error) {
    log.errorWithStack('Add relationship to staging error', error);
    res.status(500).json({ error: 'Failed to add relationship', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/relationships/{relId}:
 *   patch:
 *     summary: Modify a relationship in staging
 *     description: Update a relationship's properties in the staging session
 *     tags: [Staging]
 */
app.patch('/api/staging/sessions/:id/relationships/:relId', async (req, res) => {
  try {
    const { id, relId } = req.params;
    const { documentId } = req.query;
    const updates = req.body;
    const stagingService = getStagingService();

    const session = await stagingService.modifyRelationship(id, documentId, relId, updates);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Modify relationship in staging error', error);
    res.status(500).json({ error: 'Failed to modify relationship', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/relationships/{relId}:
 *   delete:
 *     summary: Delete a relationship from staging
 *     description: Mark a relationship as deleted in the staging session
 *     tags: [Staging]
 */
app.delete('/api/staging/sessions/:id/relationships/:relId', async (req, res) => {
  try {
    const { id, relId } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();

    const session = await stagingService.deleteRelationship(id, documentId, relId);
    res.json(session);
  } catch (error) {
    log.errorWithStack('Delete relationship from staging error', error);
    res.status(500).json({ error: 'Failed to delete relationship', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/preview:
 *   get:
 *     summary: Preview staging changes
 *     description: Get a preview of all changes that will be applied when committing
 *     tags: [Staging]
 */
app.get('/api/staging/sessions/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const stagingService = getStagingService();

    const preview = await stagingService.getPreview(id, documentId);
    res.json(preview);
  } catch (error) {
    log.errorWithStack('Get staging preview error', error);
    res.status(500).json({ error: 'Failed to get preview', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/{id}/commit:
 *   post:
 *     summary: Commit staging changes
 *     description: Commit all staged changes to the production knowledge graph
 *     tags: [Staging]
 */
app.post('/api/staging/sessions/:id/commit', async (req, res) => {
  try {
    const { id } = req.params;
    const { documentId } = req.query;
    const user = req.user || {};
    const stagingService = getStagingService();

    const result = await stagingService.commitSession(id, documentId, user);
    res.json(result);
  } catch (error) {
    log.errorWithStack('Commit staging session error', error);
    res.status(500).json({ error: 'Failed to commit changes', message: error.message });
  }
});

/**
 * @swagger
 * /api/staging/sessions/document/{documentId}:
 *   get:
 *     summary: Get staging session by document ID
 *     description: Retrieve the active staging session for a document
 *     tags: [Staging]
 */
app.get('/api/staging/sessions/document/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const stagingService = getStagingService();

    const session = await stagingService.getSessionByDocument(documentId);
    if (!session) {
      return res.status(404).json({ error: 'No staging session found for this document' });
    }

    res.json(session);
  } catch (error) {
    log.errorWithStack('Get staging session by document error', error);
    res.status(500).json({ error: 'Failed to get staging session', message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  const errorContext = {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id || req.user?.email,
  };

  log.errorWithStack('Unhandled error', err, errorContext);

  // Track exception in Application Insights
  trackException(err, errorContext);

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

// Start server
const server = app.listen(PORT, () => {
  // Log configuration summary
  const configSummary = getConfigurationSummary();
  log.info('Configuration status:', configSummary);

  logStartup(PORT, {
    healthCheck: `http://localhost:${PORT}/health`,
    swagger: `http://localhost:${PORT}/api-docs`,
  });
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  log.info(`${signal} received, starting graceful shutdown`);

  // Stop accepting new connections
  server.close(async () => {
    log.info('HTTP server closed');

    // Flush telemetry before exit
    await flushTelemetry();

    log.info('Graceful shutdown completed');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
