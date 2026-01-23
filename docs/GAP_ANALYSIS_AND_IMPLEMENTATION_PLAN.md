# Gap Analysis & Implementation Plan
## Business Knowledge Engine - Spec vs Implementation

---

## Executive Summary

After a comprehensive analysis of the codebase against the software specification, the project is approximately **70-75% complete**. The core infrastructure is solid, with Azure services properly integrated, authentication working, and the basic GraphRAG pipeline functional. However, several key features from the specification remain missing or partially implemented.

---

## 1. GAP ANALYSIS

### Legend
- ✅ **Fully Implemented** - Meets spec requirements
- ⚠️ **Partially Implemented** - Basic functionality exists, needs enhancement
- ❌ **Not Implemented** - Missing entirely
- 🔄 **Optional/Deferred** - Infrastructure exists but not deployed

---

### 1.1 Azure-Native Integration (Objective 1)

| Requirement | Status | Current State | Gap |
|-------------|--------|---------------|-----|
| Microsoft Entra ID | ✅ | Full OIDC/OAuth2 with MSAL | None |
| Azure App Service | ✅ | Frontend + Backend deployed | None |
| Azure OpenAI Service | ✅ | GPT-5.2 + embeddings configured | None |
| Azure AI Document Intelligence | ✅ | Layout model integrated | None |
| Azure Cosmos DB (Gremlin) | ✅ | Graph operations working | None |
| Azure AI Search | ✅ | Hybrid + semantic search | None |
| Azure Blob Storage | ✅ | Document storage + SAS URLs | None |
| Azure Functions (Durable) | ⚠️ | Regular Functions exist | **Need Durable Functions for orchestration** |

---

### 1.2 FR1: Azure-Native Ingestion Pipeline

#### FR1.1 Multi-Source Ingestion
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| SharePoint Online connector | ❌ | **No Logic Apps/Power Automate integration** |
| OneDrive for Business connector | ❌ | **No connector implemented** |
| Local file uploads | ✅ | Working with batch support |
| Office formats (Word, Excel, PPT, Visio) | ✅ | Supported via Document Intelligence |
| PDF support | ✅ | Full support |

**Priority: HIGH** - SharePoint/OneDrive integration is critical for enterprise adoption.

#### FR1.2 Advanced Layout & OCR
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Document Intelligence Layout Model | ✅ | Integrated |
| Table extraction | ✅ | Working |
| Checkbox/selection marks | ✅ | Extracted |
| Body Text vs Header/Footer distinction | ⚠️ | Hierarchy extracted but **not leveraged for processing prioritization** |
| Section hierarchy preservation | ⚠️ | Extracted but **not used in graph structure** |

**Priority: MEDIUM** - Enhance to use hierarchy in entity extraction.

#### FR1.3 Visual Extraction with GPT-4o
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Diagram image extraction from PPT/Visio | ⚠️ | **Basic extraction exists, needs enhancement** |
| GPT-4o vision analysis | ⚠️ | **Not using GPT-4o multimodal** |
| Swimlane → Role mapping | ❌ | **Not implemented** |
| Flowchart → Process/Task mapping | ❌ | **Not implemented** |
| JSON node/edge generation from visuals | ❌ | **Not implemented** |

**Priority: HIGH** - Visual extraction is a key differentiator.

#### FR1.4 Ontology Mapping
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Durable Functions orchestration | ❌ | Using async processing, **need Durable Functions** |
| Strict metamodel validation | ⚠️ | Entity types defined but **validation not enforced before write** |
| Entity type mapping (Actor vs Process distinction) | ⚠️ | **LLM extraction not constrained to metamodel** |

**Priority: MEDIUM** - Need strict ontology enforcement.

---

### 1.3 FR2: Knowledge Management & Interactive Review

#### FR2.1 Split-Screen Staging UI
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| PDF viewer (left pane) | ❌ | **Not implemented** |
| Graph visualization (right pane) | ⚠️ | Graph page exists but **not split-screen** |
| Side-by-side comparison | ❌ | **Not implemented** |
| Drag-and-drop entity corrections | ❌ | **Not implemented** |
| Temporary graph storage before commit | ❌ | **Direct commit to Cosmos DB** |
| Entity highlighting in source document | ❌ | **Not implemented** |

**Priority: CRITICAL** - This is the core "human-in-the-loop" feature.

#### FR2.2 GraphRAG
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Hybrid search (Vector + BM25) | ✅ | Working |
| Semantic ranking | ✅ | Enabled |
| Graph traversal | ✅ | BFS with depth=2 |
| LLM synthesis | ✅ | Working |
| Citation tracking | ✅ | Implemented |
| Security-trimmed context | ✅ | Working |

---

### 1.4 FR3: Security & Access Control

#### FR3.1 Entra ID Integration
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Security Group mapping | ⚠️ | Groups extracted but **mapping UI missing** |
| MSAL authentication | ✅ | Working |
| Role-based access | ✅ | 4-tier RBAC |
| Group-based permissions | ⚠️ | **Group → Permission mapping not configurable** |

#### FR3.2 Security Trimming in Search
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| group_ids field in search index | ✅ | Implemented as `allowedGroups` |
| OData filter injection | ✅ | Working |
| Pre-query filtering | ✅ | Implemented |
| Post-query verification | ✅ | Implemented |

#### FR3.3 Graph-Level Redaction
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| API-layer interception | ✅ | Working |
| Claim-based property removal | ⚠️ | **Field-level redaction exists but claim mapping hardcoded** |
| JobTitle-based filtering | ⚠️ | **Not using Entra claims dynamically** |
| Sensitive property redaction | ✅ | PII service working |

---

### 1.5 FR4: Gamification

#### FR4.1 Activity Tracking
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Activity logging | ✅ | Audit log captures actions |
| Cosmos DB Change Feed trigger | ⚠️ | **Trigger exists but scoring logic incomplete** |
| Point calculation | ⚠️ | **Basic scoring exists, needs enhancement** |
| Leaderboard | ✅ | Working |
| Azure Cache for Redis | ❌ | **Using Cosmos DB directly (slower)** |

**Priority: LOW** - Functional but could be optimized.

---

### 1.6 Administration & Governance

#### FR5.1 Private Connectivity
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Azure Private Link | 🔄 | **Terraform module exists, not deployed** |
| Disabled public access | 🔄 | **Not enforced** |

**Priority: HIGH** for production deployment.

#### FR5.2 Cost Management
| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| Token limits via APIM | 🔄 | **APIM module exists, not deployed** |
| Per-user/department quotas | ❌ | **Not implemented** |
| Usage tracking dashboard | ❌ | **Not implemented** |

---

### 1.7 Non-Functional Requirements

| Requirement | Status | Gap Description |
|-------------|--------|-----------------|
| NFR7.1 Data Residency | ✅ | Configurable via Terraform |
| NFR7.2 Cosmos Autoscale | ⚠️ | **Serverless mode, not autoscale RU/s** |
| NFR7.3 200ms Graph Latency | ⚠️ | **Not benchmarked** |

---

## 2. MISSING COMPONENTS SUMMARY

### Critical (Must Have)
1. **Split-Screen Review UI** - PDF viewer + graph + drag-drop corrections
2. **SharePoint/OneDrive Connectors** - Enterprise file source integration
3. **Visual Diagram Extraction** - GPT-4o multimodal for flowcharts/swimlanes

### High Priority
4. **Durable Functions Orchestration** - Proper pipeline orchestration with checkpoints
5. **Strict Ontology Validation** - Enforce metamodel before Cosmos writes
6. **Private Endpoint Deployment** - Zero-trust networking
7. **Temporary/Staging Graph** - Allow edits before committing to live graph

### Medium Priority
8. **Enhanced Hierarchy Processing** - Use document structure in entity extraction
9. **Dynamic Claim-Based Redaction** - Configure field → claim mappings
10. **Group Permission Admin UI** - Manage Entra Group → Permission mappings
11. **Redis Caching** - Leaderboard and hot-path optimization

### Low Priority
12. **APIM Token Quotas** - Cost management per user/department
13. **Usage Analytics Dashboard** - Track token consumption
14. **Performance Benchmarking** - Validate 200ms latency requirement

---

## 3. IMPLEMENTATION PLAN

### Phase 1: Split-Screen Review UI (2-3 sprints)
**Goal:** Implement the core "human-in-the-loop" staging interface

#### Tasks:
1. **Create PDF Viewer Component**
   - Integrate PDF.js or react-pdf library
   - Support blob URL loading with SAS tokens
   - Page navigation and zoom controls
   - Text selection and highlighting

2. **Build Split-Screen Layout**
   - Resizable split pane (react-split-pane or similar)
   - PDF on left, graph on right
   - Synchronized scrolling option

3. **Implement Staging Graph**
   - New Cosmos container for staging entities
   - Clone document entities to staging on review start
   - Track all edits with undo/redo

4. **Add Drag-Drop Entity Editing**
   - Entity node repositioning in Cytoscape
   - Edge creation/deletion via drag
   - Entity type change dropdown
   - Relationship type modification

5. **Source Document Highlighting**
   - Link entities to source spans
   - Click entity → highlight in PDF
   - Click PDF text → show related entities

6. **Commit/Discard Workflow**
   - "Commit to Live Graph" button
   - "Discard Changes" with confirmation
   - Diff view showing pending changes

#### New Files:
```
frontend/components/PDFViewer.tsx
frontend/components/SplitScreenReview.tsx
frontend/components/StagingGraph.tsx
frontend/components/EntityEditor.tsx
frontend/app/dashboard/review/[id]/split/page.tsx
backend/src/storage/staging.js
backend/src/services/staging-service.js
```

#### API Endpoints:
```
POST /api/staging/:documentId/start     - Clone to staging
GET  /api/staging/:documentId           - Get staging state
PUT  /api/staging/:documentId/entities  - Update staged entities
POST /api/staging/:documentId/commit    - Commit to live
DELETE /api/staging/:documentId         - Discard staging
```

---

### Phase 2: Multi-Source Ingestion (1-2 sprints)
**Goal:** Add SharePoint and OneDrive connectors

#### Tasks:
1. **SharePoint Connector**
   - Azure Logic App for SharePoint trigger
   - Or: Microsoft Graph API direct integration
   - Webhook for new document notifications
   - Folder/site configuration

2. **OneDrive Connector**
   - Microsoft Graph API integration
   - Folder watch configuration
   - Delta sync for changes

3. **Ingestion Queue**
   - Azure Service Bus or Storage Queue
   - Decouple source from processing
   - Retry logic for failed ingestion

4. **Source Tracking**
   - Store source type (local/SharePoint/OneDrive)
   - Original URL/path
   - Sync status tracking

#### New Files:
```
backend/src/connectors/sharepoint.js
backend/src/connectors/onedrive.js
backend/src/connectors/graph-api-client.js
functions/src/triggers/sharepoint-webhook/
functions/src/triggers/onedrive-delta/
frontend/app/dashboard/integrations/sharepoint/page.tsx
frontend/app/dashboard/integrations/onedrive/page.tsx
```

#### Configuration:
```
SHAREPOINT_SITE_ID=...
SHAREPOINT_LIBRARY_ID=...
ONEDRIVE_FOLDER_PATH=...
GRAPH_API_CLIENT_ID=...
```

---

### Phase 3: Visual Diagram Extraction (1-2 sprints)
**Goal:** Extract process knowledge from diagrams using GPT-4o vision

#### Tasks:
1. **Image Extraction Pipeline**
   - Extract images from PPTX/VSDX
   - Convert pages to images for PDF diagrams
   - Image quality optimization

2. **GPT-4o Vision Integration**
   - Update OpenAI client for vision API
   - Multimodal message format
   - Image encoding (base64)

3. **Diagram Analysis Prompts**
   - Swimlane detection → Role entities
   - Flowchart shapes → Process/Task entities
   - Arrows → PRECEDES/TRANSFORMS_INTO edges
   - Decision diamonds → Branch logic

4. **Merge Visual + Text Entities**
   - Deduplicate entities from text and visual
   - Confidence score combination
   - Source tracking (text vs visual)

#### New Files:
```
backend/src/services/image-extractor.js
backend/src/services/visual-analysis-service.js
backend/src/prompts/visual-extraction.js
backend/src/pipelines/visual-processor.js
```

#### Prompt Template (visual-extraction.js):
```javascript
const SWIMLANE_EXTRACTION_PROMPT = `
Analyze this business process diagram and extract:
1. SWIMLANES: Each horizontal/vertical lane represents a Role
2. SHAPES: Rectangles are Tasks, Rounded rectangles are Processes
3. ARROWS: Connecting arrows indicate PRECEDES relationships
4. DECISION POINTS: Diamonds indicate branching logic

Output JSON format:
{
  "entities": [
    { "name": "...", "type": "Role|Process|Task", "confidence": 0.0-1.0 }
  ],
  "relationships": [
    { "from": "...", "to": "...", "type": "PRECEDES|RESPONSIBLE_FOR", "confidence": 0.0-1.0 }
  ]
}
`;
```

---

### Phase 4: Durable Functions & Orchestration (1 sprint)
**Goal:** Implement proper Azure Durable Functions for pipeline orchestration

#### Tasks:
1. **Convert to Durable Functions**
   - Orchestrator function for document processing
   - Activity functions for each stage
   - Checkpoint/resume capability

2. **Pipeline Stages as Activities**
   - ExtractContent activity
   - ExtractVisuals activity
   - ChunkText activity
   - ExtractEntities activity
   - GenerateEmbeddings activity
   - IndexSearch activity
   - IngestGraph activity

3. **Error Handling & Retry**
   - Per-activity retry policies
   - Compensation logic for rollback
   - Dead letter handling

4. **Status Monitoring**
   - Query orchestration status
   - Stage progress tracking
   - Estimated completion

#### New Files:
```
functions/src/orchestrators/document-orchestrator.js
functions/src/activities/extract-content.js
functions/src/activities/extract-visuals.js
functions/src/activities/chunk-text.js
functions/src/activities/extract-entities.js
functions/src/activities/generate-embeddings.js
functions/src/activities/index-search.js
functions/src/activities/ingest-graph.js
```

#### Function Configuration (host.json):
```json
{
  "extensions": {
    "durableTask": {
      "storageProvider": {
        "type": "azure_storage"
      }
    }
  }
}
```

---

### Phase 5: Ontology Validation (1 sprint)
**Goal:** Enforce strict metamodel validation before graph writes

#### Tasks:
1. **Define Ontology Schema**
   - JSON Schema for entity types
   - Allowed relationship type per entity pair
   - Required properties per type

2. **Validation Middleware**
   - Pre-write validation hook
   - Schema validation errors
   - Suggest corrections for invalid entities

3. **Admin UI for Ontology**
   - View current metamodel
   - Add custom entity types (future)
   - View validation statistics

#### New Files:
```
backend/src/schemas/ontology.json
backend/src/services/ontology-validator.js
backend/src/middleware/ontology-validation.js
frontend/app/dashboard/admin/ontology/page.tsx
```

#### Ontology Schema (ontology.json):
```json
{
  "entityTypes": {
    "Process": {
      "requiredProperties": ["name", "description"],
      "allowedRelationships": {
        "outbound": ["PRECEDES", "TRANSFORMS_INTO", "REGULATED_BY"],
        "inbound": ["PRECEDES", "RESPONSIBLE_FOR"]
      }
    },
    "Role": {
      "requiredProperties": ["name"],
      "allowedRelationships": {
        "outbound": ["RESPONSIBLE_FOR"],
        "inbound": []
      }
    }
  },
  "relationshipTypes": {
    "PRECEDES": {
      "validPairs": [
        ["Process", "Process"],
        ["Task", "Task"],
        ["Task", "Process"]
      ]
    }
  }
}
```

---

### Phase 6: Security Hardening (1 sprint)
**Goal:** Deploy private endpoints and configure claim-based redaction

#### Tasks:
1. **Deploy Private Endpoints**
   - Enable Terraform private-endpoints module
   - Configure DNS for private resolution
   - Disable public network access

2. **Dynamic Claim-Based Redaction**
   - Admin UI for field → claim mappings
   - Store mappings in Cosmos DB
   - Runtime claim checking

3. **Group Permission Management**
   - UI to map Entra Groups to app roles
   - Sync group memberships
   - Role assignment audit

#### New Files:
```
backend/src/services/claim-redaction-service.js
backend/src/storage/security-config.js
frontend/app/dashboard/admin/security/page.tsx
frontend/app/dashboard/admin/groups/page.tsx
infrastructure/terraform/terraform.tfvars (enable private endpoints)
```

---

### Phase 7: Performance & Caching (1 sprint)
**Goal:** Add Redis caching and optimize for 200ms latency

#### Tasks:
1. **Deploy Azure Cache for Redis**
   - Add Terraform module
   - Configure connection

2. **Cache Hot Paths**
   - Leaderboard data (TTL: 5 min)
   - Graph statistics (TTL: 1 min)
   - Recent query results (TTL: 10 min)

3. **Performance Benchmarking**
   - Add latency logging
   - Create performance test suite
   - Optimize slow queries

#### New Files:
```
infrastructure/terraform/modules/redis/
backend/src/clients/redis.js
backend/src/services/cache-service.js
tests/performance/graph-latency.test.js
```

---

## 4. IMPLEMENTATION PRIORITY MATRIX

| Phase | Feature | Business Value | Effort | Priority |
|-------|---------|----------------|--------|----------|
| 1 | Split-Screen Review UI | Critical | High | **P0** |
| 2 | SharePoint/OneDrive Connectors | High | Medium | **P1** |
| 3 | Visual Diagram Extraction | High | Medium | **P1** |
| 4 | Durable Functions | Medium | Medium | **P2** |
| 5 | Ontology Validation | Medium | Low | **P2** |
| 6 | Security Hardening | High | Low | **P1** |
| 7 | Performance/Caching | Low | Low | **P3** |

---

## 5. RECOMMENDED SPRINT PLAN

### Sprint 1-2: Split-Screen Foundation
- PDF viewer component
- Split layout
- Basic entity editing

### Sprint 3: Split-Screen Complete
- Staging graph
- Drag-drop editing
- Commit workflow

### Sprint 4: SharePoint Connector
- Graph API integration
- Webhook triggers
- UI configuration

### Sprint 5: Visual Extraction
- GPT-4o vision integration
- Diagram prompts
- Entity merging

### Sprint 6: Security & Validation
- Private endpoints deployment
- Ontology validation
- Claim redaction UI

### Sprint 7: Polish & Performance
- Redis caching
- Performance testing
- Bug fixes

---

## 6. TECHNICAL DEBT TO ADDRESS

1. **Test Coverage** - Currently minimal; need comprehensive unit/integration tests
2. **Error Handling** - Some catch blocks just log; need user-friendly error messages
3. **Loading States** - Inconsistent loading indicators across UI
4. **Accessibility** - WCAG compliance audit needed
5. **Mobile Responsiveness** - Dashboard not optimized for mobile
6. **API Documentation** - Swagger exists but incomplete descriptions
7. **Environment Validation** - Add stricter startup checks

---

## 7. DEPENDENCIES & PREREQUISITES

### For Phase 1 (Split-Screen):
- PDF.js or react-pdf library
- react-split-pane or similar
- Enhanced Cytoscape plugins

### For Phase 2 (Connectors):
- Microsoft Graph API permissions
- Azure Logic Apps or Service Bus
- SharePoint site admin access

### For Phase 3 (Visual):
- GPT-4o model deployment
- Image processing libraries
- Increased OpenAI quota

### For Phase 6 (Security):
- Network team coordination for Private Link
- DNS configuration access
- Key Vault permissions

---

## 8. SUCCESS METRICS

| Metric | Target | Measurement |
|--------|--------|-------------|
| Review UI adoption | 80% of reviews use split-screen | Analytics tracking |
| Connector usage | 50% docs from SharePoint/OneDrive | Source type stats |
| Visual extraction accuracy | >85% entity recall from diagrams | Manual validation |
| Graph query latency | <200ms p95 | Application Insights |
| Ontology compliance | 100% entities pass validation | Validation logs |

---

## 9. RISKS & MITIGATIONS

| Risk | Impact | Mitigation |
|------|--------|------------|
| GPT-4o vision accuracy | Medium | Confidence thresholds + manual review |
| SharePoint permissions | High | Early access testing with IT |
| Private endpoint complexity | Medium | Staged rollout, test environment first |
| Performance at scale | Medium | Load testing before production |

---

## APPENDIX: File Change Summary

### New Frontend Files (17 files)
```
frontend/components/PDFViewer.tsx
frontend/components/SplitScreenReview.tsx
frontend/components/StagingGraph.tsx
frontend/components/EntityEditor.tsx
frontend/components/DragDropCanvas.tsx
frontend/app/dashboard/review/[id]/split/page.tsx
frontend/app/dashboard/integrations/sharepoint/page.tsx
frontend/app/dashboard/integrations/onedrive/page.tsx
frontend/app/dashboard/admin/ontology/page.tsx
frontend/app/dashboard/admin/security/page.tsx
frontend/app/dashboard/admin/groups/page.tsx
```

### New Backend Files (18 files)
```
backend/src/storage/staging.js
backend/src/services/staging-service.js
backend/src/connectors/sharepoint.js
backend/src/connectors/onedrive.js
backend/src/connectors/graph-api-client.js
backend/src/services/image-extractor.js
backend/src/services/visual-analysis-service.js
backend/src/prompts/visual-extraction.js
backend/src/pipelines/visual-processor.js
backend/src/schemas/ontology.json
backend/src/services/ontology-validator.js
backend/src/middleware/ontology-validation.js
backend/src/services/claim-redaction-service.js
backend/src/storage/security-config.js
backend/src/clients/redis.js
backend/src/services/cache-service.js
```

### New Functions Files (9 files)
```
functions/src/orchestrators/document-orchestrator.js
functions/src/activities/extract-content.js
functions/src/activities/extract-visuals.js
functions/src/activities/chunk-text.js
functions/src/activities/extract-entities.js
functions/src/activities/generate-embeddings.js
functions/src/activities/index-search.js
functions/src/activities/ingest-graph.js
functions/src/triggers/sharepoint-webhook/
```

### New Infrastructure Files (2 modules)
```
infrastructure/terraform/modules/redis/
infrastructure/terraform/modules/service-bus/
```

---

*Document generated: 2026-01-21*
*Analysis based on commit: 7523f97*
