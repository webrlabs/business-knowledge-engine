# Architecture Overview

## Intelligent Business Process Knowledge Platform
### Enterprise Azure Edition

---

## Table of Contents
1. [System Architecture](#system-architecture)
2. [Component Design](#component-design)
3. [Data Flow](#data-flow)
4. [Security Architecture](#security-architecture)
5. [Scalability & Performance](#scalability--performance)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Microsoft Entra ID                          │
│                     (Authentication & Authorization)                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Azure API Management                            │
│              (Gateway, Throttling, OAuth2 Validation)                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         ┌──────────────────┐            ┌──────────────────┐
         │  Frontend (React) │            │  Backend API     │
         │  Azure App Service│            │  Express.js      │
         └──────────────────┘            └──────────────────┘
                                                   │
                    ┌──────────────────────────────┴───────────────────┐
                    ▼                              ▼                    ▼
         ┌────────────────────┐       ┌────────────────────┐  ┌────────────────┐
         │ Azure Functions     │       │  Durable Functions │  │ Azure OpenAI   │
         │ (Processing)        │       │  (Orchestration)   │  │ Service        │
         └────────────────────┘       └────────────────────┘  └────────────────┘
                    │
     ┌──────────────┼──────────────┬──────────────┬──────────────┐
     ▼              ▼              ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Cosmos  │  │Azure AI  │  │  Blob    │  │ Key Vault│
│ DB      │  │ Search   │  │ Storage  │  │          │
│(Gremlin)│  │          │  │(ADLS G2) │  │          │
└─────────┘  └──────────┘  └──────────┘  └──────────┘
```

### Network Architecture (Zero-Trust)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Azure Virtual Network                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      Private Endpoints                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │  │
│  │  │ Cosmos DB│  │AI Search │  │  Blob    │  │ Key Vault│      │  │
│  │  │ Private  │  │ Private  │  │ Private  │  │ Private  │      │  │
│  │  │ Endpoint │  │ Endpoint │  │ Endpoint │  │ Endpoint │      │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                Application Subnet (App Service)                 │  │
│  │  - Network Security Groups (NSG)                                │  │
│  │  - Service Endpoints enabled                                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                          (No Public Access)
```

---

## Component Design

### 1. Ingestion Pipeline

**Flow:**
Document Upload → Document Intelligence → Entity Extraction → Ontology Mapping → Staging → Approval → Graph Insertion

**Components:**
- **Upload Handler** (Azure Function): Receives documents, stores in Blob Storage
- **OCR Processor** (Azure Function): Calls Azure AI Document Intelligence
- **Entity Extractor** (Durable Function): Uses Azure OpenAI for multimodal analysis
- **Ontology Validator** (Azure Function): Validates against schema
- **Staging Queue** (Cosmos DB): Stores pending entities
- **Approval Workflow** (Backend API): RBAC-enforced approval process

### 2. Knowledge Graph

**Storage:** Azure Cosmos DB with Gremlin API

**Schema:**
- **Vertices (Entities):** Process, Task, Role, System, DataAsset, Form, Policy, Procedure, Directive, Guide
- **Edges (Relationships):** PRECEDES, RESPONSIBLE_FOR, TRANSFORMS_INTO, REGULATED_BY

**Metadata (Required):**
- `ontology_version`: String
- `source_document_id`: String
- `confidence_score`: Float (0.0-1.0)
- `review_status`: Enum (pending, approved, rejected)
- `created_by`: String (user ID)
- `created_at`: Timestamp
- `modified_at`: Timestamp

### 3. GraphRAG Query System

**Query Flow:**
1. **Authentication:** Validate Entra ID token
2. **Query Analysis:** Parse natural language query
3. **Vector Search:** Semantic search in Azure AI Search
4. **Security Filtering:** Apply user's group-based filters
5. **Graph Traversal:** Execute Gremlin queries based on initial results
6. **Context Assembly:** Combine search results + graph neighbors
7. **LLM Synthesis:** Azure OpenAI generates answer
8. **Citation Injection:** Add source references
9. **PII Redaction:** Apply redaction policies
10. **Response Return:** Send to client

### 4. Human-in-the-Loop UI

**Components:**
- **Document Viewer** (Left Panel): PDF/Office document rendering
- **Graph Editor** (Right Panel): Interactive Cytoscape.js visualization
- **Entity Details Panel:** Edit attributes, relationships
- **Approval Controls:** Approve/Reject/Comment buttons
- **Audit Trail:** Historical changes and reviews

---

## Data Flow

### Document Ingestion Flow

```
SharePoint/OneDrive/Upload
         │
         ▼
   Blob Storage (Raw)
         │
         ▼
  Azure AI Document Intelligence
         │
         ▼
   Structured JSON (Text, Tables, Layout)
         │
         ▼
  Azure OpenAI (Entity Extraction)
         │
         ▼
   Entity Candidates (JSON)
         │
         ▼
  Ontology Validation
         │
    ┌────┴────┐
    ▼         ▼
  Pass      Fail
    │         │
    ▼         ▼
Staging   Dead-Letter
  Queue      Queue
    │
    ▼
Human Review
    │
    ▼
Approval/Rejection
    │
    ▼
Cosmos DB (Graph)
    │
    ▼
Azure AI Search (Vector Index)
```

### Query Flow

```
User Query (NL)
      │
      ▼
Query Embedding (Azure OpenAI)
      │
      ▼
Vector Search (Azure AI Search) + Security Filter
      │
      ▼
Initial Results (Documents + Entities)
      │
      ▼
Graph Traversal (Cosmos DB Gremlin)
      │
      ▼
Expanded Context (Graph Neighbors)
      │
      ▼
Context Assembly (Merge Results)
      │
      ▼
LLM Prompt (Azure OpenAI)
      │
      ▼
Generated Answer + Citations
      │
      ▼
PII Redaction
      │
      ▼
Response to User
```

---

## Security Architecture

### Authentication & Authorization

**Authentication:**
- Microsoft Entra ID (Azure AD) via MSAL
- OAuth2 / OpenID Connect
- JWT tokens with claims

**Authorization:**
- **RBAC:** Entra ID App Roles (Admin, Reviewer, Viewer)
- **ABAC:** Entra ID group membership for data access
- **Security Trimming:** Filter results by user's group IDs

### Data Protection

**Encryption:**
- **In Transit:** TLS 1.2+
- **At Rest:** Azure-managed keys or customer-managed keys (CMK)

**Network Security:**
- Private Link for all Azure resources
- No public internet access
- Network Security Groups (NSGs)
- Service Endpoints

**Secrets Management:**
- All secrets in Azure Key Vault
- Managed Identity for service-to-service auth
- No credentials in code or config files

### Audit & Compliance

**Audit Logging:**
- All security events logged to Cosmos DB
- Immutable audit trail
- Retention: 7 years (configurable)

**Compliance:**
- GDPR: Data subject access requests (DSAR), right to erasure
- Regional data residency
- PII redaction policies

---

## Scalability & Performance

### Horizontal Scaling

- **Frontend:** Azure App Service autoscale (CPU/Memory triggers)
- **Backend API:** Stateless design, multiple instances
- **Azure Functions:** Consumption plan (auto-scales to demand)
- **Cosmos DB:** Autoscale RU/s (1000-10000)
- **Azure AI Search:** Replicas for read scaling

### Performance Optimization

- **CDN:** Static assets served from Azure CDN
- **Query Optimization:** Indexed properties in Cosmos DB
- **Connection Pooling:** Reuse connections to Azure services

### SLA Targets

- **P95 Query Latency:** < 2 seconds
- **Vector Search:** < 1 second
- **Document Processing:** < 5 minutes (typical document)
- **UI Page Load:** < 2 seconds
- **Uptime:** 99.9% (with multi-region failover)

---

## Technology Decisions

### Why Cosmos DB Gremlin API?
- Native graph traversal (superior to SQL JOINs for multi-hop queries)
- Global distribution and autoscale
- Azure-native with Managed Identity support

### Why Azure AI Search?
- Native vector search with semantic ranking
- Security filtering at query time
- Integrated with Azure ecosystem

### Why Durable Functions?
- Stateful orchestration for long-running processes
- Automatic checkpointing and replay
- Cost-effective (consumption-based pricing)

### Why React?
- Rich ecosystem for enterprise UI
- Excellent TypeScript support
- Strong community and Microsoft support

---

**Document Version:** 1.0
**Last Updated:** 2024-01-05
**Owner:** Enterprise Architecture Team
