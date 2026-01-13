# API Reference

## Overview

The Business Knowledge Platform API provides endpoints for document management, knowledge graph operations, and human-in-the-loop review workflows.

**Base URL:** `https://{your-api-domain}/api`

**Authentication:** All API endpoints (except `/health`) require Azure AD authentication via Bearer token.

## Authentication

Include the access token in the Authorization header:

```
Authorization: Bearer {access_token}
```

## Endpoints

### Health Check

#### GET /health

Check if the API server is running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### Documents

#### POST /api/documents/upload

Upload a document for processing.

**Content-Type:** `multipart/form-data`

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | Yes | Document file (PDF, DOCX, PPTX, XLSX, VSDX) |
| title | string | No | Document title |
| description | string | No | Document description |
| tags | string | No | Comma-separated tags |

**Response (201):**
```json
{
  "success": true,
  "message": "Document uploaded successfully",
  "document": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "1234567890-document.pdf",
    "originalName": "document.pdf",
    "title": "My Document",
    "status": "pending"
  }
}
```

#### GET /api/documents

List all documents.

**Response (200):**
```json
{
  "documents": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Document Title",
      "status": "completed",
      "uploadedAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

#### GET /api/documents/:id

Get a specific document by ID.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| id | UUID | Document ID |

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Document Title",
  "status": "completed",
  "extractedText": "...",
  "entities": [...],
  "relationships": [...]
}
```

#### POST /api/documents/:id/process

Start document processing (OCR + entity extraction).

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| id | UUID | Document ID |

**Response (200):**
```json
{
  "success": true,
  "message": "Document processing started",
  "document": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "processing"
  }
}
```

---

### Entity Review

#### POST /api/documents/:id/entities/:entityId/approve

Approve a single extracted entity.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| id | UUID | Document ID |
| entityId | string | Entity ID |

**Response (200):**
```json
{
  "success": true,
  "message": "Entity approved successfully",
  "entityId": "entity-123",
  "documentId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### POST /api/documents/:id/entities/:entityId/reject

Reject a single extracted entity.

**Request Body:**
```json
{
  "reason": "Incorrect entity type"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Entity rejected successfully",
  "entityId": "entity-123",
  "reason": "Incorrect entity type"
}
```

#### POST /api/documents/:id/entities/approve-all

Batch approve all entities in a document.

**Response (200):**
```json
{
  "success": true,
  "message": "All 10 entities approved successfully",
  "approvedCount": 10,
  "documentId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### POST /api/documents/:id/entities/reject-all

Batch reject all entities in a document.

**Request Body:**
```json
{
  "reason": "Document quality is poor"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "All 10 entities rejected successfully",
  "rejectedCount": 10,
  "reason": "Document quality is poor"
}
```

---

### GraphRAG Query

#### POST /api/graphrag/query

Query the knowledge graph using natural language.

**Request Body:**
```json
{
  "query": "What are the steps in the procurement process?"
}
```

**Response (200):**
```json
{
  "answer": "The procurement process includes...",
  "citations": [
    {
      "documentId": "...",
      "chunk": "..."
    }
  ],
  "graphContext": {
    "entities": [...],
    "relationships": [...]
  },
  "responseTime": 1234
}
```

---

### Audit Logs

#### GET /api/audit/logs

Retrieve audit logs with optional filtering.

**Query Parameters:**
| Name | Type | Description |
|------|------|-------------|
| entityId | UUID | Filter by entity ID |
| action | string | Filter by action (approve, reject, create, update, delete) |
| entityType | string | Filter by type (entity, relationship, document) |
| limit | number | Max results (default: 100, max: 100) |

**Response (200):**
```json
{
  "logs": [
    {
      "id": "log-123",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "action": "approve",
      "entityType": "entity",
      "entityId": "entity-123",
      "userId": "user@example.com",
      "details": {...}
    }
  ],
  "total": 1
}
```

#### POST /api/audit/log

Create an audit log entry.

**Request Body:**
```json
{
  "action": "approve",
  "entityType": "entity",
  "entityId": "entity-123",
  "details": {
    "entityName": "Procurement Process",
    "reason": "Verified as correct"
  }
}
```

---

### Dashboard Statistics

#### GET /api/stats/dashboard

Get dashboard statistics and metrics.

**Response (200):**
```json
{
  "totalDocuments": 42,
  "totalEntities": 630,
  "pendingReviews": 5,
  "completedDocuments": 35,
  "failedDocuments": 2,
  "graphSize": {
    "nodes": 630,
    "edges": 504
  },
  "recentActivity": [...]
}
```

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Error type",
  "message": "Detailed error message",
  "details": [...]
}
```

**Common HTTP Status Codes:**
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## Rate Limits

| Endpoint Type | Limit |
|---------------|-------|
| General API | 100 requests / 15 minutes |
| Auth endpoints | 5 requests / 15 minutes |
| Document processing | 10 requests / minute |
| GraphRAG queries | 30 requests / minute |
| Document uploads | 20 requests / hour |
