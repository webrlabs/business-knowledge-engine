const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Business Process Knowledge Platform API',
      version: '1.0.0',
      description: 'API documentation for the Intelligent Business Process Knowledge Platform - Enterprise Azure Edition',
      contact: {
        name: 'API Support',
        email: 'support@contoso.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:8081',
        description: 'Development server',
      },
      {
        url: 'http://localhost:8080',
        description: 'Alternative development server',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your bearer token in the format: Bearer <token>',
        },
      },
      schemas: {
        Document: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Document ID',
              example: 1,
            },
            filename: {
              type: 'string',
              description: 'Stored filename',
              example: '1735690123456-789-report.pdf',
            },
            originalName: {
              type: 'string',
              description: 'Original filename',
              example: 'report.pdf',
            },
            title: {
              type: 'string',
              description: 'Document title',
              example: 'Quarterly Report',
            },
            description: {
              type: 'string',
              description: 'Document description',
              example: 'Q4 2024 financial report',
            },
            tags: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Document tags',
              example: ['finance', 'quarterly'],
            },
            size: {
              type: 'integer',
              description: 'File size in bytes',
              example: 1024567,
            },
            uploadedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Upload timestamp',
              example: '2024-01-05T10:30:00.000Z',
            },
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'completed', 'failed'],
              description: 'Processing status',
              example: 'pending',
            },
          },
        },
        DashboardStats: {
          type: 'object',
          properties: {
            totalDocuments: {
              type: 'integer',
              description: 'Total number of documents',
              example: 42,
            },
            totalEntities: {
              type: 'integer',
              description: 'Total number of entities extracted',
              example: 630,
            },
            pendingReviews: {
              type: 'integer',
              description: 'Number of pending reviews',
              example: 5,
            },
            completedDocuments: {
              type: 'integer',
              description: 'Number of completed documents',
              example: 37,
            },
            failedDocuments: {
              type: 'integer',
              description: 'Number of failed documents',
              example: 0,
            },
            graphSize: {
              type: 'object',
              properties: {
                nodes: {
                  type: 'integer',
                  description: 'Number of graph nodes',
                  example: 630,
                },
                edges: {
                  type: 'integer',
                  description: 'Number of graph edges',
                  example: 504,
                },
              },
            },
            recentActivity: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'integer',
                    example: 42,
                  },
                  type: {
                    type: 'string',
                    example: 'document_upload',
                  },
                  title: {
                    type: 'string',
                    example: 'Quarterly Report',
                  },
                  timestamp: {
                    type: 'string',
                    format: 'date-time',
                    example: '2024-01-05T10:30:00.000Z',
                  },
                  status: {
                    type: 'string',
                    example: 'pending',
                  },
                },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
              example: 'Invalid request',
            },
            message: {
              type: 'string',
              description: 'Detailed error message',
              example: 'The provided data is invalid',
            },
          },
        },
        HealthCheck: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              example: 'healthy',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2024-01-05T10:30:00.000Z',
            },
          },
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Authentication',
        description: 'Authentication and authorization endpoints',
      },
      {
        name: 'Documents',
        description: 'Document management endpoints',
      },
      {
        name: 'Statistics',
        description: 'Dashboard and analytics endpoints',
      },
    ],
  },
  apis: [require('path').join(__dirname, 'index.js')], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = specs;
