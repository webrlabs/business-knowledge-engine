# Feature Backlog: SOTA GraphRAG Implementation

> Generated from SOTA Gap Analysis - January 2026
>
> This document captures all features needed to achieve state-of-the-art GraphRAG capabilities.
> Use this as a reference for sprint planning and progress tracking.

---

## Feature Status Legend

| Status | Meaning |
|--------|---------|
| 🔴 Not Started | Feature not yet implemented |
| 🟡 In Progress | Feature currently being developed |
| 🟢 Complete | Feature fully implemented and tested |
| ⚪ Deferred | Feature postponed to future phase |

---

## Phase 1: Evaluation Foundation

**Goal:** Establish measurement capability before making changes
**Priority:** P0 - Critical
**Estimated Duration:** 2-3 weeks

### 1.1 Evaluation Dataset Creation

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F1.1.1 | Q&A Benchmark Dataset | Create 50+ curated question-answer pairs covering operational, technical, compliance, and leadership questions | 🔴 Not Started | Include expected entities and source docs |
| F1.1.2 | Entity Ground Truth | Annotated dataset of correct entity extractions from sample documents | 🔴 Not Started | For measuring extraction precision/recall |
| F1.1.3 | Relationship Ground Truth | Annotated dataset of correct relationships from sample documents | 🔴 Not Started | For measuring relationship extraction accuracy |
| F1.1.4 | Negative Test Cases | Questions that should return "insufficient information" or "not found" | 🔴 Not Started | Tests hallucination resistance |
| F1.1.5 | Persona-Tagged Questions | Tag each Q&A with target persona (Ops, IT, Compliance, Leadership) | 🔴 Not Started | For persona-specific evaluation |

### 1.2 Evaluation Metrics Pipeline

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F1.2.1 | Retrieval Metrics Service | Implement Recall@K, Precision@K, MRR, NDCG calculations | 🟢 Complete | `/backend/src/evaluation/metrics.js` |
| F1.2.2 | Citation Accuracy Checker | Verify citations in answers match actual source content | 🟢 Complete | `/backend/src/evaluation/citation-accuracy.js` - Multi-method verification with text matching + LLM |
| F1.2.3 | Grounding Score Calculator | Measure how well answers are grounded in retrieved context | 🟢 Complete | `/backend/src/evaluation/grounding-score.js` - Claim-based verification with LLM |
| F1.2.4 | LLM-as-Judge Evaluator | Use GPT-4 with rubrics to score helpfulness, accuracy, completeness | 🟢 Complete | `/backend/src/evaluation/llm-judge.js` |
| F1.2.5 | Entity Extraction Evaluator | Compare extracted entities against ground truth (F1, precision, recall) | 🟢 Complete | `/backend/src/evaluation/entity-extraction-evaluator.js` - Strict/partial/type-only matching, per-type metrics, batch evaluation |
| F1.2.6 | Relationship Extraction Evaluator | Compare extracted relationships against ground truth | 🟢 Complete | `/backend/src/evaluation/relationship-extraction-evaluator.js` - Strict/partial/direction-agnostic/type-only matching, direction accuracy tracking, per-type metrics, batch evaluation |

### 1.3 Benchmark Infrastructure

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F1.3.1 | Benchmark Runner Script | CLI tool to run full evaluation suite against current system | 🟢 Complete | `/backend/src/evaluation/run-benchmark.js` - CLI with 6 suites, JSON/text/markdown output, CI/CD threshold checks |
| F1.3.2 | Results Storage | Store evaluation results with timestamps for trend analysis | 🟢 Complete | `/backend/src/evaluation/results-storage-service.js` - Cosmos DB + local JSON fallback, trend analysis, baseline comparison, regression detection; API: `/api/evaluation/*` |
| F1.3.3 | Baseline Documentation | Document initial baseline metrics for all measures | 🔴 Not Started | `/docs/BASELINE_METRICS.md` |
| F1.3.4 | CI Regression Check | Automated check that metrics don't regress on PRs | 🟢 Complete | `/.github/workflows/ci.yml` - evaluation-regression job with benchmark dataset, PR comments, artifact upload, threshold enforcement; Dataset: `/backend/src/evaluation/datasets/ci_benchmark.json` |
| F1.3.5 | Evaluation Dashboard | Visual dashboard showing metric trends over time | 🟢 Complete | `/backend/src/evaluation/dashboard-service.js` - ASCII sparkline trends, health scoring, baseline comparison reports, markdown/JSON output; API: GET `/api/evaluation/dashboard`, `/api/evaluation/dashboard/comparison`, `/api/evaluation/dashboard/status` |

---

## Phase 2: Ontology & Temporal Modeling

**Goal:** Enable schema evolution and temporal reasoning
**Priority:** P0 - Critical
**Estimated Duration:** 2-3 weeks

### 2.1 Formal Ontology Definition

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F2.1.1 | JSON-LD Ontology Schema | Define all entity types and relationships in JSON-LD format | 🟢 Complete | `/ontology/business-process.jsonld` |
| F2.1.2 | Type Inheritance | Define type hierarchy (e.g., Task subClassOf Activity) | 🟢 Complete | `/backend/src/services/ontology-service.js` - `expandTypeWithSubtypes()`, `getTypeTree()`; `/backend/src/services/graph-rag-service.js` - `queryByType()`, `queryWithTypeFilter()`, `getTypeHierarchy()`; API: GET `/api/ontology/types/:type/subtree`, GET `/api/graphrag/query-by-type`, POST `/api/graphrag/query-with-type-filter` |
| F2.1.3 | Relationship Domain/Range | Define valid source and target types for each relationship | 🟢 Complete | `/ontology/relationship-constraints.json` |
| F2.1.4 | Ontology Validation Service | Validate extracted entities/relationships against ontology | 🟢 Complete | `/backend/src/services/ontology-service.js` |
| F2.1.5 | Ontology API Endpoint | GET /api/ontology/types - Return current ontology for UI/clients | 🟢 Complete | `/backend/src/index.js` - GET /api/ontology/types (full, entity-types, relationship-types, hierarchy, metadata views), POST /api/ontology/validate, POST /api/ontology/normalize |

### 2.2 Ontology Versioning

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F2.2.1 | Ontology Version Field | Add version number to ontology definition | 🟢 Complete | `/ontology/business-process.jsonld` - owl:versionIRI, owl:priorVersion, bke:versionMetadata, bke:versionHistory; `/backend/src/services/ontology-service.js` - parseVersion(), compareVersions(), getVersionInfo(), getVersionHistory(), isVersionCompatible(), getVersionChangeType(), formatVersion(), validateVersion(), getNextVersion(); API: GET `/api/ontology/version`, `/api/ontology/version/history`, `/api/ontology/version/next`, POST `/api/ontology/version/compare`, `/api/ontology/version/validate` |
| F2.2.2 | Migration Framework | System for defining and running ontology migrations | 🟢 Complete | `/backend/src/services/ontology-migration-service.js` - Load migrations from `/ontology/migrations/`; track applied migrations in Cosmos DB or file storage; execute in version order; support dry-run preview; MigrationContext for change tracking (addEntityType, addRelationshipType, etc.); JSON/JS migration file formats with up/down/validate functions; `/backend/src/services/migration-storage-adapter.js` - Cosmos DB + file-based storage adapters; Example migration at `/ontology/migrations/1.1.0-add-project-entity-type.js`; API endpoints: GET `/api/ontology/migrations`, `/api/ontology/migrations/pending`, `/api/ontology/migrations/preview/:version`, POST `/api/ontology/migrations/run/:version`, `/api/ontology/migrations/run-all`, `/api/ontology/migrations/rollback/:version`, `/api/ontology/migrations/create`; 32 unit tests |
| F2.2.3 | Type Deprecation Support | Mark types as deprecated with replacement mapping | 🟢 Complete | `/backend/src/services/ontology-service.js` - isTypeDeprecated(), getDeprecationInfo(), getReplacementType(), getDeprecatedTypes(), deprecateType(), undeprecateType(), getDeprecationWarning(), getMigrationPath(), validateDeprecations(); Deprecation properties in ontology: owl:deprecated, bke:replacedBy, bke:deprecationReason, bke:deprecationDate, bke:removalVersion, bke:migrationGuide; Validation integration with deprecation warnings; API endpoints: GET `/api/ontology/deprecated`, `/api/ontology/deprecated/:type`, `/api/ontology/deprecated/:type/migration-path`, `/api/ontology/deprecated/validate`, POST `/api/ontology/deprecate`, `/api/ontology/undeprecate`; 36 unit tests |
| F2.2.4 | Migration Dry-Run | Preview migration impact before applying | 🟢 Complete | Implemented as part of F2.2.2 - `dryRun: true` option in runMigration(); GET `/api/ontology/migrations/preview/:version` endpoint; shows expected entity/relationship type changes without applying |
| F2.2.5 | Rollback Capability | Ability to rollback failed migrations | 🟢 Complete | Implemented as part of F2.2.2 - `down()` function in migrations for rollback logic; `rollbackMigration()` method; POST `/api/ontology/migrations/rollback/:version` endpoint; supports dry-run rollback preview |

### 2.3 Temporal Entity Modeling

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F2.3.1 | Temporal Schema Fields | Add valid_from, valid_to, superseded_by to entity schema | 🟢 Complete | `/ontology/business-process.jsonld` - 6 temporal properties (validFrom, validTo, supersededBy, supersedes, temporalStatus, versionSequence); SUPERSEDED_BY/SUPERSEDES relationships; TemporalStatusDefinition class; `/ontology/migrations/1.2.0-add-temporal-schema-fields.js` - Migration with up/down/validate; `/backend/src/services/graph-service.js` - _computeTemporalStatus(), findCurrentEntities(), findEntitiesValidAt(), getEntityVersionHistory(), findVertexById(), createEntityVersion(), findEntitiesByTemporalStatus(), refreshTemporalStatus(), refreshAllTemporalStatuses(), getTemporalStats(); `/backend/src/services/temporal-service.js` - Validation, status computation, filtering, sorting, version chain validation; 43 unit tests |
| F2.3.2 | REPLACED_BY Relationship | New relationship type for entity succession | 🟢 Complete | `REPLACED_BY` and `REPLACES` relationships for entity succession tracking (e.g., system replacements); added to ontology v1.3.0 and migration 1.3.0; 14 unit tests |
| F2.3.3 | DEPRECATED_BY Relationship | New relationship type for deprecation tracking | 🟢 Complete | `DEPRECATED_BY` and `DEPRECATES` relationships for soft deprecation tracking between entities; added to ontology v1.3.0 and migration 1.3.0; 14 unit tests |
| F2.3.4 | Time-Aware Graph Queries | Query graph state at specific point in time | 🟢 Complete | `/backend/src/services/graph-service.js` - getGraphSnapshotAt(), findNeighborsValidAt(), traverseGraphAt(), compareGraphStates(); `/backend/src/services/graph-rag-service.js` - queryAtTime(), generateAnswerAtTime(), getGraphSnapshot(); API endpoints: POST `/api/graphrag/temporal/query`, `/api/graphrag/temporal/answer`, `/api/graphrag/temporal/traverse`, GET `/api/graphrag/temporal/snapshot`, `/api/graphrag/temporal/compare`, `/api/graphrag/temporal/neighbors`; 26 unit tests |
| F2.3.5 | Entity History API | GET /api/entities/:id/history - Return entity version history | 🟢 Complete | API endpoint wired to graph temporal version chain with metadata |
| F2.3.6 | Entity History UI | Timeline visualization of entity changes | 🔴 Not Started | Frontend component |

---

## Phase 3: Advanced Graph Analytics

**Goal:** Enable sophisticated graph-based insights
**Priority:** P1 - High Value
**Estimated Duration:** 2-3 weeks

### 3.1 Community Detection

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F3.1.1 | Louvain Algorithm | Implement Louvain community detection algorithm | 🟢 Complete | `/backend/src/algorithms/louvain.js` |
| F3.1.2 | Community Storage | Store detected communities in dedicated index | 🟢 Complete | `/backend/src/services/community-storage-service.js` - Cosmos DB persistent storage with API endpoints |
| F3.1.3 | Community Summary Generation | Generate LLM summaries for each community | 🟢 Complete | `/backend/src/services/community-summary-service.js` |
| F3.1.4 | Incremental Community Updates | Update communities when new documents added | 🟢 Complete | `/backend/src/algorithms/louvain.js` - DF Louvain incremental detection; `/backend/src/services/graph-service.js` - change tracking; `/backend/src/services/community-summary-service.js` - selective regeneration; API: POST /api/graphrag/communities/incremental |
| F3.1.5 | Community Context in GraphRAG | Include community summaries in query context | 🟢 Complete | `/backend/src/services/graph-rag-service.js` - Auto-includes in regular queries + globalQuery map-reduce |
| F3.1.6 | Community Visualization | UI to explore detected communities | 🔴 Not Started | Color-coded graph clusters |

### 3.2 Entity Importance Metrics

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F3.2.1 | PageRank Algorithm | Calculate PageRank scores for all entities | 🟢 Complete | `/backend/src/algorithms/pagerank.js` |
| F3.2.2 | Betweenness Centrality | Calculate betweenness centrality scores | 🟢 Complete | `/backend/src/algorithms/betweenness.js` |
| F3.2.3 | Mention Frequency Tracking | Track how often each entity is mentioned across docs | 🟢 Complete | `graph-service.js` - incrementMentionCount(), batchUpdateMentionCounts(); `importance-service.js` - getEntityMentionStats(), getMentionFrequencyAnalysis(); API: GET /api/entities/:id/mention-stats, /api/entities/top-mentioned, /api/entities/mention-analysis |
| F3.2.4 | Importance Field on Entities | Store computed importance score on each entity | 🟢 Complete | `/backend/src/services/importance-service.js` |
| F3.2.5 | Importance-Weighted Retrieval | Use importance scores to rank retrieval results | 🟢 Complete | `/backend/src/services/graph-rag-service.js` - PageRank+RRF weighted retrieval |
| F3.2.6 | Importance API Endpoint | GET /api/entities/important - Return top entities by importance | 🟢 Complete | `/backend/src/index.js` - supports pagerank, betweenness, combined algorithms |

### 3.3 Impact Analysis

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F3.3.1 | Upstream Dependency Traversal | "What does X depend on?" query | 🟢 Complete | `/backend/src/services/impact-analysis-service.js` - getUpstreamDependencies() |
| F3.3.2 | Downstream Impact Traversal | "What depends on X?" query | 🟢 Complete | `/backend/src/services/impact-analysis-service.js` - getDownstreamImpact() |
| F3.3.3 | Impact Scoring | Score impact based on path length and entity importance | 🟢 Complete | `/backend/src/services/impact-analysis-service.js` - calculateImpactScore() with decay factor |
| F3.3.4 | Impact Analysis API | POST /api/graphrag/impact - Return impact analysis | 🟢 Complete | `/backend/src/index.js` - GET/POST /api/graphrag/impact/* endpoints |
| F3.3.5 | Impact Visualization | UI showing dependency tree with impact scores | 🔴 Not Started | Expandable tree or radial layout |
| F3.3.6 | Change Simulation | "What if we remove X?" simulation | 🟢 Complete | `/backend/src/services/impact-analysis-service.js` - simulateRemoval() |

---

## Phase 4: Improved Ingestion

**Goal:** Better document understanding and integration
**Priority:** P1 - High Value
**Estimated Duration:** 2-3 weeks

### 4.1 Semantic Chunking

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F4.1.1 | Topic Detection | Use embeddings to detect topic boundaries | 🟢 Complete | `/backend/src/chunking/semantic-chunker.js` - Percentile-based breakpoint detection with configurable threshold |
| F4.1.2 | Semantic Chunk Splitter | Split documents at topic boundaries, not fixed tokens | 🟢 Complete | `/backend/src/chunking/semantic-chunker.js` - LlamaIndex-style semantic splitting with buffer context |
| F4.1.3 | Chunk Coherence Score | Measure semantic coherence within each chunk | 🟢 Complete | `/backend/src/chunking/chunk-coherence-score.js` - Centroid-based + pairwise coherence, variance score; API: POST `/api/chunking/coherence`, `/api/chunking/coherence/batch`, `/api/chunking/semantic` with `includeCoherence` option |
| F4.1.4 | A/B Chunking Comparison | Compare retrieval quality: semantic vs fixed-size | 🟢 Complete | `/backend/src/evaluation/chunking-comparison.js` - Full A/B comparison with MRR/MAP/NDCG metrics, winner determination, improvement percentages; API: POST `/api/evaluation/chunking/compare`, `/api/evaluation/chunking/compare/report`, `/api/evaluation/chunking/benchmark` |
| F4.1.5 | Configurable Chunking Strategy | Allow selection of chunking method per document type | 🟢 Complete | `CHUNKING_STRATEGY` in document-processor.js - supports 'fixed', 'semantic', 'auto' |

### 4.2 External Connectors

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F4.2.1 | SharePoint Site Connector | Connect to SharePoint sites for document ingestion | 🔴 Not Started | `/backend/src/connectors/sharepoint-connector.js` |
| F4.2.2 | SharePoint Permission Sync | Sync document permissions/ACLs from SharePoint | 🔴 Not Started | Map to allowedGroups field |
| F4.2.3 | ADLS Gen2 Connector | Connect to Azure Data Lake Storage | 🔴 Not Started | `/backend/src/connectors/adls-connector.js` |
| F4.2.4 | ADLS ACL Sync | Sync ACLs from ADLS to document permissions | 🔴 Not Started | RBAC and POSIX ACL support |
| F4.2.5 | Incremental Sync | Only process new/changed documents | 🔴 Not Started | Track last sync timestamp |
| F4.2.6 | Deletion Sync | Remove documents when deleted from source | 🔴 Not Started | Soft delete with grace period |
| F4.2.7 | Connector Health Monitoring | Track connector status and sync errors | 🔴 Not Started | Dashboard widget |

### 4.3 Extraction Quality Improvements

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F4.3.1 | Relationship Validation Rules | Enforce domain/range constraints during extraction | 🟢 Complete | `/backend/src/validation/relationship-validator.js` - Validates entities/relationships against ontology domain/range constraints during document processing; applies confidence penalties for violations; 33 unit tests |
| F4.3.2 | Confidence Penalty for Violations | Reduce confidence for constraint-violating extractions | 🟢 Complete | `/backend/src/validation/relationship-validator.js` - Implemented via CONFIDENCE_PENALTIES (domain: 0.85, range: 0.85, both: 0.7, unknown type: 0.7) |
| F4.3.3 | Extraction Warnings in Staging | Show validation warnings in review UI | 🟢 Complete | `/backend/src/services/staging-service.js` - getValidationWarnings() method returns entities/relationships with warnings categorized by type; preview includes validationSummary |
| F4.3.4 | Custom Entity Type Definitions | Allow admins to add custom entity types | 🟢 Complete | `/backend/src/services/custom-ontology-service.js`, `/backend/src/services/ontology-service.js`, POST/DELETE `/api/ontology/custom-types`; Persists to Cosmos DB |
| F4.3.5 | Custom Relationship Definitions | Allow admins to add custom relationship types | 🟢 Complete | `/backend/src/services/custom-ontology-service.js` - CRUD for custom relationship types with domain/range constraints; `/backend/src/services/ontology-service.js` - runtime registration; API endpoints: GET/POST `/api/ontology/custom-relationship-types`, DELETE `/api/ontology/custom-relationship-types/:name`; 35 unit tests |
| F4.3.6 | Extraction Prompt Tuning | A/B test different extraction prompts | 🔴 Not Started | Track which prompts perform better |

---

## Phase 5: Production Hardening

**Goal:** Enterprise-ready operations
**Priority:** P1 - High Value
**Estimated Duration:** 2-3 weeks

### 5.1 Persistent Audit Logging

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F5.1.1 | Audit Log Cosmos Container | Create dedicated container for audit logs | 🟢 Complete | Partition by date or userId |
| F5.1.2 | Audit Persistence Service | Service to write/query persistent audit logs | 🟢 Complete | `/backend/src/services/audit-persistence-service.js` |
| F5.1.3 | Denial Log Persistence | Persist access denial logs (currently in-memory) | 🟢 Complete | Critical for security audits |
| F5.1.4 | Audit Log Retention Policy | Automatically archive/delete old audit logs | 🟢 Complete | Config-driven retention (Cosmos TTL) + Manual Archive API; API: `POST /api/audit/retention` |
| F5.1.5 | Audit Log Export | Export audit logs to CSV/JSON for compliance | 🟢 Complete | `/backend/src/services/audit-export-service.js` - CSV/JSON/NDJSON export with date/action/entity filters; file and streaming exports; scheduled periodic exports with interval configuration; job tracking and statistics; API endpoints: GET `/api/audit/export` (with download option), POST `/api/audit/export/file`, GET/DELETE `/api/audit/export/files`, GET/POST/DELETE `/api/audit/export/schedule`, POST `/api/audit/export/schedule/:name/run`, GET `/api/audit/export/stats`, GET `/api/audit/export/jobs`; admin/auditor role protection; 39 unit tests |
| F5.1.6 | Suspicious Activity Alerts | Alert on unusual access patterns | 🟢 Complete | `/backend/src/services/suspicious-activity-service.js` - Real-time detection of 9 suspicious patterns (excessive_denials, high_query_volume, off_hours_access, rapid_requests, bulk_document_access, auth_failure_spike, rate_limit_violation, data_exfiltration_pattern, unusual_entity_access); configurable thresholds via env vars; alert cooldown to prevent spam; severity levels (low/medium/high/critical); Azure Monitor integration via Application Insights (trackSecurityEvent, trackMetric); historical log analysis; integrated with security-trimming-service and user-rate-limit-service for automatic tracking; API endpoints: GET `/api/security/suspicious-activity/stats`, `/api/security/suspicious-activity/users`, `/api/security/suspicious-activity/users/:userId`, `/api/security/suspicious-activity/azure-monitor-config`, POST `/api/security/suspicious-activity/analyze`, `/api/security/suspicious-activity/reset`; 38 unit tests |

### 5.2 Performance Optimization

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F5.2.2 | Entity Resolution Caching | Cache entity resolution lookups | 🟢 Complete | `/backend/src/services/entity-resolution-cache.js` - LRU caching for resolved entities, embeddings, similarity scores, canonical entities, and similar entities; configurable TTL and max sizes via env vars (CACHE_*); cache statistics tracking with hit rates; health monitoring; API endpoints: GET `/api/entities/cache/stats`, `/api/entities/cache/health`, POST `/api/entities/cache/clear`, `/api/entities/cache/invalidate/:name`, `/api/entities/cache/invalidate-document/:documentId`, `/api/entities/cache/reset-stats`, `/api/entities/cache/toggle`; integrated into EntityResolutionService; 37 unit tests |
| F5.2.3 | Gremlin Query Optimization | Optimize common traversal patterns | 🟢 Complete | Profile/logging added; Partition key optimizations for findVertexById/findVerticesByType; Parallel batch updates |
| F5.2.4 | Pagination for All Lists | Add cursor-based pagination to all list endpoints | 🟢 Complete | `/backend/src/services/pagination-service.js` - Cursor-based pagination with keyset, continuation token, and offset strategies; standardized response format with `{ items, pagination: { nextCursor, hasMore, pageSize, itemCount } }`; Cosmos DB and in-memory array support; pagination middleware for Express; API endpoints: GET `/api/documents/paginated`, `/api/audit/logs/paginated`; updated `listDocumentsPaginated()` in cosmos.js, `queryLogsPaginated()` in audit-persistence-service.js; backward compatible with existing `limit` parameter; 57 unit tests |
| F5.2.5 | Latency Budgets | Define and enforce latency SLOs | 🟢 Complete | `/backend/src/services/latency-budget-service.js` - Percentile tracking (P50/P95/P99) via time-bucketed rolling windows; operation-specific SLOs (query: 3s, processing: 5min, search: 1.5s, etc.); warning/critical/breach severity detection; telemetry alerts integration; API endpoints: GET `/api/latency-budgets`, `/api/latency-budgets/stats`, `/api/latency-budgets/health`, `/api/latency-budgets/:operation`, POST `/api/latency-budgets/:operation/reset`, `/api/latency-budgets/record`; middleware at `/backend/src/middleware/latency-budget.js` for automatic request tracking; 54 unit tests |
| F5.2.6 | Circuit Breakers | Add circuit breakers for external services | 🟢 Complete | `/backend/src/services/circuit-breaker-service.js` - opossum-based circuit breakers for OpenAI, Search, Gremlin services; configurable thresholds via env vars; event logging/telemetry; API endpoints: GET `/api/circuit-breakers`, `/api/circuit-breakers/:service`, `/api/circuit-breakers/open`, POST `/api/circuit-breakers/:key/reset`, `/api/circuit-breakers/reset-all`; 32 unit tests |
| F5.2.7 | Performance Dashboard | Real-time latency and throughput monitoring | 🟢 Complete | `/backend/src/services/performance-dashboard-service.js` - Aggregates metrics from latency budgets, circuit breakers, entity resolution cache, and rate limits; ThroughputTracker with rolling windows for RPS and error rate; HistoryStorage for metric snapshots; ASCII sparkline visualization; health score calculation (healthy/warning/critical); throughput middleware for automatic request tracking; configurable via env vars (PERF_*); API endpoints: GET `/api/performance`, `/api/performance/health`, `/api/performance/throughput`, `/api/performance/latency`, `/api/performance/circuit-breakers`, `/api/performance/cache`, `/api/performance/rate-limits`, `/api/performance/history`, `/api/performance/report`, POST `/api/performance/reset`; 56 unit tests |

### 5.3 Security Hardening

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F5.3.1 | Adversarial Test Dataset | Create prompt injection and jailbreak test cases | 🟢 Complete | `/backend/src/evaluation/datasets/adversarial_tests.json` - 89 test cases covering 19 attack categories (instructionOverride, systemPromptExtraction, rolePlayManipulation, delimiterInjection, codeExecution, dataExfiltration, jailbreakPhrases, promptLeaking, indirectInjection, obfuscation, typoglycemia, payloadSplitting, flipAttack, sugarCoated, multiTurn, structuralAttacks, ragPoisoning, agentAttacks, negativeTests); 4 multi-turn sequences; OWASP LLM01:2025 compliant; Evaluator at `/backend/src/evaluation/adversarial-evaluator.js` with precision/recall/F1 metrics, per-category analysis, markdown/text reports; 42 unit tests |
| F5.3.2 | Prompt Injection Detection | Detect and block prompt injection attempts | 🟢 Complete | `/backend/src/services/prompt-injection-service.js` - Multi-layered defense with 9 attack pattern categories (instructionOverride, systemPromptExtraction, rolePlayManipulation, delimiterInjection, codeExecution, dataExfiltration, jailbreakPhrases, promptLeaking, indirectInjection); heuristic scoring with configurable threshold; structural analysis for hidden Unicode, base64, and long text; sanitization for neutralizing detected patterns; cross-message analysis for chat formats; configurable via env vars (PROMPT_INJECTION_ENABLED, PROMPT_INJECTION_HEURISTIC_THRESHOLD, PROMPT_INJECTION_BLOCK_HIGH); Middleware at `/backend/src/middleware/prompt-injection.js` with guard/monitor/sanitizer modes; API endpoints: POST `/api/security/prompt-injection/analyze`, `/api/security/prompt-injection/sanitize`, GET `/api/security/prompt-injection/stats`, `/api/security/prompt-injection/patterns`, POST `/api/security/prompt-injection/stats/reset`; integrated with GraphRAG query endpoint; 110 unit tests |
| F5.3.3 | Information Leakage Tests | Test for relationship-based information leakage | 🟢 Complete | `/backend/src/services/__tests__/information-leakage.test.js` - 58 unit tests covering 12 leakage categories (cross-role classification, role escalation, graph traversal, multi-hop inference, pending entity status, ownership/visibility, sensitive field trimming, denial message leakage, group isolation, department isolation, combined access control, OData injection); tests relationship-based inference attacks (transitive, diamond patterns, entity existence); validates security trimming for documents and graph entities/relationships; 58 unit tests |
| F5.3.4 | Security Trimming Bypass Tests | Attempt to bypass security filters | 🟡 In Progress | Red-team exercise |
| F5.3.5 | Rate Limiting Enhancements | Per-user rate limits, not just global | 🟢 Complete | `/backend/src/services/user-rate-limit-service.js` - Per-user rate limiting using user ID from JWT; role-based tiered limits with configurable multipliers (admin: 3x, reviewer: 2x, contributor: 1.5x, reader: 1x); fallback to IP for unauthenticated requests; combined user+IP key for sensitive endpoints; statistics tracking and monitoring; configurable via env vars (RATE_LIMIT_*_MULTIPLIER, RATE_LIMIT_*_WINDOW_MS, RATE_LIMIT_*_MAX_*); API endpoints: GET `/api/rate-limits`, `/api/rate-limits/config`, `/api/rate-limits/me`, `/api/rate-limits/user/:userId`, POST `/api/rate-limits/reset`; integrated with express-rate-limit v7; 43 unit tests |
| F5.3.6 | Security Test Automation | Automated security tests in CI pipeline | 🟢 Complete | `/backend/src/evaluation/run-security-tests.js` - CLI runner with 47 unit tests; `/.github/workflows/ci.yml` - `security-tests` job with adversarial evaluation, JSON/Markdown reports, artifact upload, PR comments, threshold enforcement (F1: 0.85, precision: 0.80, recall: 0.85, critical detection: 0.95); supports --verbose, --category filters, --no-multi-turn; CI/CD metadata tracking (git commit/branch/tags) |

---

## Phase 6: Advanced GraphRAG

**Goal:** State-of-the-art global question answering
**Priority:** P2 - Nice to Have
**Estimated Duration:** 3-4 weeks

### 6.1 GraphRAG Summarization

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F6.1.1 | Map Phase: Community Summaries | Generate summary for each detected community | 🔴 Not Started | At indexing time |
| F6.1.2 | Reduce Phase: Cross-Community Synthesis | Synthesize community summaries into global answer | 🔴 Not Started | At query time |
| F6.1.3 | Summary Caching | Cache generated summaries for reuse | 🔴 Not Started | Invalidate on community change |
| F6.1.4 | Incremental Summary Updates | Update summaries when documents added/changed | 🔴 Not Started | Avoid full recomputation |
| F6.1.5 | Summary Quality Evaluation | Measure summary accuracy and coverage | 🔴 Not Started | Add to evaluation framework |

### 6.2 LazyGraphRAG

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F6.2.1 | On-Demand Community Detection | Detect communities at query time, not indexing | 🔴 Not Started | For changing graphs |
| F6.2.2 | Query-Time Summarization | Generate summaries on-the-fly | 🔴 Not Started | Higher latency, fresher data |
| F6.2.3 | Lazy Summary Caching | Cache lazy-generated summaries | 🔴 Not Started | LRU cache with TTL |
| F6.2.4 | Lazy vs Eager Comparison | Compare latency and quality of both approaches | 🔴 Not Started | Use evaluation framework |
| F6.2.5 | Configurable GraphRAG Mode | API option to choose lazy vs pre-computed | 🔴 Not Started | Per-query configuration |

### 6.3 Persona-Specific Views

| ID | Feature | Description | Status | Notes |
|----|---------|-------------|--------|-------|
| F6.3.1 | Persona Definitions | Define personas: Ops, IT, Leadership, Compliance | 🟢 Complete | `/backend/src/personas/index.js` - 5 personas (Ops, IT, Leadership, Compliance, Default) with entity type weights, category weights, relationship weights, summary styles (technical/executive/operational/compliance/balanced), context preferences, example queries; PersonaService singleton with entity scoring, ranking, filtering; validation utilities; 80 unit tests |
| F6.3.2 | Persona Retrieval Weights | Different weights for entity types per persona | 🟢 Complete | `/backend/src/services/graph-rag-service.js` - Integrated `PersonaService.calculateEntityScore()` into graph expansion and chunk ranking; adds priority scoring to entities and relationships |
| F6.3.3 | Persona Summary Style | Different summary styles per persona | 🟢 Complete | `/backend/src/services/graph-rag-service.js` - `generateAnswer()` injects `PersonaService.getPromptHint()` into system prompt for tailored response style |
| F6.3.4 | Persona Selection API | Query parameter to specify persona | 🟢 Complete | `/backend/src/index.js` - `GET /api/personas`; `POST /api/graphrag/search` and `/answer` support `options.persona`; Swagger docs updated |
| F6.3.5 | Persona Selection UI | Dropdown to select persona in query interface | 🔴 Not Started | Frontend component |
| F6.3.6 | Persona-Based Filtering | Optionally filter results by persona relevance | 🔴 Not Started | Hide technical details from execs |

---

## Cross-Cutting Features

These features span multiple phases and should be considered throughout.

| ID | Feature | Description | Status | Priority |
|----|---------|-------------|--------|----------|
| FC.1 | Feature Flags | Enable/disable features without deployment | 🟢 Complete | `/backend/src/services/feature-flags-service.js` - Centralized flag management with 23 flags across 7 categories (security, performance, ingestion, graphrag, evaluation, ui, experimental); environment variable overrides (FF_* pattern); runtime override API; change listeners; API endpoints: GET `/api/feature-flags`, `/api/feature-flags/stats`, `/api/feature-flags/by-category`, `/api/feature-flags/:key`, `/api/feature-flags/:key/enabled`, POST `/api/feature-flags/:key/override`, DELETE `/api/feature-flags/:key/override`, `/api/feature-flags/overrides`; 51 unit tests |
| FC.2 | Configuration Management | Centralized config for all thresholds and settings | 🟢 Complete | `/backend/src/services/configuration-service.js` - Centralized configuration management with 50+ settings across 13 categories (openai, search, document_processing, chunking, cache, circuit_breaker, rate_limiting, graph, evaluation, entity_resolution, security, storage, telemetry); environment variable overrides (CFG_* pattern or specific envVar); schema validation with type checking (number, string, boolean, array, object); min/max range constraints; string options validation; runtime override API with change listeners; restart-required indicators; sensitive value masking; API endpoints: GET `/api/config`, `/api/config/stats`, `/api/config/by-category`, `/api/config/validate`, `/api/config/export`, `/api/config/:key`, `/api/config/:key/value`, POST `/api/config/:key/override`, DELETE `/api/config/:key/override`, `/api/config/overrides`; 57 unit tests |
| FC.3 | Comprehensive Logging | Structured logging for all operations | 🟢 Complete | - |
| FC.4 | Error Handling Standards | Consistent error responses across all endpoints | 🟢 Complete | - |
| FC.5 | API Versioning | Version API endpoints for backward compatibility | 🔴 Not Started | P2 |
| FC.6 | Documentation Generation | Auto-generate API docs from code | 🟢 Complete | - |
| FC.7 | Health Check Enhancements | Detailed health checks for all dependencies | 🟢 Complete | `/backend/src/services/health-check-service.js` - Comprehensive health checks for 6 dependencies (Cosmos DB, Gremlin, OpenAI, Azure Search, Blob Storage, Doc Intelligence); Kubernetes-compatible liveness/readiness probes; cached health results with configurable TTL; startup validation with retry logic; health history tracking; status change listeners; circuit breaker integration; API endpoints: GET `/health/live`, `/health/ready`, `/health/dependencies`, `/health/dependencies/:dependency`, `/health/summary`, `/health/history`, `/health/startup`, `/health/cache`, `/health/config`, DELETE `/health/cache`; 39 unit tests |

---

## Summary Statistics

| Phase | Total Features | Not Started | In Progress | Complete |
|-------|---------------|-------------|-------------|----------|
| Phase 1: Evaluation | 15 | 5 | 0 | 10 |
| Phase 2: Ontology | 16 | 1 | 0 | 15 |
| Phase 3: Analytics | 18 | 2 | 0 | 16 |
| Phase 4: Ingestion | 17 | 8 | 0 | 9 |
| Phase 5: Hardening | 17 | 0 | 1 | 16 |
| Phase 6: GraphRAG | 16 | 15 | 0 | 1 |
| Cross-Cutting | 7 | 1 | 0 | 6 |
| **Total** | **106** | **31** | **1** | **73** |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-22 | Initial feature backlog from SOTA gap analysis |
| 1.1 | 2026-01-22 | Completed F3.1.3 (Community Summary Generation) and F3.1.5 (Community Context in GraphRAG) |
| 1.2 | 2026-01-22 | Completed F3.3.1-F3.3.4 and F3.3.6 (Impact Analysis Service with upstream/downstream traversal, scoring, API, and simulation) |
| 1.3 | 2026-01-22 | Completed F3.1.2 (Community Storage) - Cosmos DB persistent storage with API endpoints at `/api/graphrag/communities/storage/*` |
| 1.4 | 2026-01-22 | Completed F1.2.3 (Grounding Score Calculator) - LLM-based claim verification for hallucination detection at `/backend/src/evaluation/grounding-score.js` |
| 1.5 | 2026-01-22 | Completed F3.2.3 (Mention Frequency Tracking) - Entity mention counting during document processing, mention stats API endpoints at `/api/entities/:id/mention-stats`, `/api/entities/top-mentioned`, `/api/entities/mention-analysis` |
| 1.6 | 2026-01-22 | Completed F1.2.2 (Citation Accuracy Checker) - Multi-method citation verification with n-gram/keyword overlap + LLM verification at `/backend/src/evaluation/citation-accuracy.js` |
| 1.7 | 2026-01-22 | Completed F1.2.5 (Entity Extraction Evaluator) - Precision/recall/F1 with strict/partial/type-only matching modes, per-type metrics, batch evaluation at `/backend/src/evaluation/entity-extraction-evaluator.js` |
| 1.8 | 2026-01-22 | Completed F1.3.1 (Benchmark Runner Script) - CLI tool with 6 evaluation suites (retrieval, answer-quality, grounding, citation, entity-extraction, relationship-extraction), JSON/text/markdown output, CI/CD threshold checks at `/backend/src/evaluation/run-benchmark.js` |
| 1.9 | 2026-01-22 | Completed F1.2.6 (Relationship Extraction Evaluator) - Compare extracted relationships against ground truth with direction accuracy tracking, strict/partial/direction-agnostic/type-only matching modes, per-type metrics, batch evaluation at `/backend/src/evaluation/relationship-extraction-evaluator.js` |
| 1.10 | 2026-01-22 | Completed F1.3.2 (Results Storage) - Persistent storage for benchmark evaluation results with Cosmos DB + local JSON fallback, trend analysis, baseline comparison, regression detection; CLI integration `--save-results`; API endpoints at `/api/evaluation/*` |
| 1.11 | 2026-01-22 | Completed F3.1.4 (Incremental Community Updates) - Dynamic Frontier Louvain algorithm for incremental detection; graph change tracking via `getEntitiesModifiedSince()`/`getEdgesCreatedSince()`; selective summary regeneration for changed communities only; API endpoint at `POST /api/graphrag/communities/incremental` |
| 1.12 | 2026-01-22 | Completed F4.1.1 (Topic Detection), F4.1.2 (Semantic Chunk Splitter), F4.1.5 (Configurable Chunking Strategy) - LlamaIndex-style semantic chunking with percentile-based topic boundary detection, buffer context for embeddings, configurable strategy ('fixed'/'semantic'/'auto') in document processor at `/backend/src/chunking/semantic-chunker.js` |
| 1.13 | 2026-01-22 | Completed F2.1.1 (JSON-LD Ontology Schema) - Formal ontology with 18 entity types, 25 relationship types, type hierarchy (subClassOf), domain/range constraints, Schema.org mappings, and relationship synonym normalization at `/ontology/business-process.jsonld` |
| 1.14 | 2026-01-22 | Completed F2.1.4 (Ontology Validation Service) - Validates entities/relationships against JSON-LD ontology with type hierarchy awareness, domain/range constraint checking, relationship normalization via synonym mappings, batch validation reports, and Levenshtein-based type suggestions at `/backend/src/services/ontology-service.js` |
| 1.15 | 2026-01-22 | Completed F2.1.5 (Ontology API Endpoint) - GET /api/ontology/types with views (full, entity-types, relationship-types, hierarchy, metadata), POST /api/ontology/validate for batch validation, POST /api/ontology/normalize for relationship type normalization; enables dynamic UI generation |
| 1.16 | 2026-01-22 | Completed F1.3.4 (CI Regression Check) - GitHub Actions `evaluation-regression` job in `/.github/workflows/ci.yml`; runs after backend tests; uses CI benchmark dataset with 8 retrieval queries, 3 QA pairs, 3 entity/relationship docs; generates JSON/Markdown reports; uploads artifacts; auto-comments on PRs; fails on threshold regression (0.6); dataset at `/backend/src/evaluation/datasets/ci_benchmark.json` |
| 1.17 | 2026-01-22 | Completed F4.1.3 (Chunk Coherence Score) - Centroid-based + pairwise similarity coherence scoring with variance measure; API endpoints at POST `/api/chunking/coherence`, `/api/chunking/coherence/batch`, `/api/chunking/semantic` (with `includeCoherence` option); integrated with semantic chunker via `chunkTextWithCoherence()` method; at `/backend/src/chunking/chunk-coherence-score.js` |
| 1.18 | 2026-01-22 | Completed F4.1.4 (A/B Chunking Comparison) - Full A/B comparison of semantic vs fixed-size chunking strategies with MRR/MAP/Precision/Recall/NDCG metrics, winner determination algorithm, improvement percentage calculations, benchmark dataset support; API endpoints at POST `/api/evaluation/chunking/compare`, `/api/evaluation/chunking/compare/report`, `/api/evaluation/chunking/benchmark`; 39 unit tests at `/backend/src/evaluation/__tests__/chunking-comparison.test.js` |
| 1.19 | 2026-01-22 | Completed F1.3.5 (Evaluation Dashboard) - Visual dashboard with ASCII sparkline trends, overall health scoring (healthy/warning/critical), baseline comparison reports, regression/improvement detection, markdown/JSON output formats; API endpoints at GET `/api/evaluation/dashboard`, `/api/evaluation/dashboard/comparison`, `/api/evaluation/dashboard/status`; 18 unit tests at `/backend/src/evaluation/__tests__/dashboard-service.test.js` |
| 1.20 | 2026-01-22 | Completed F4.3.1, F4.3.2, F4.3.3 (Relationship Validation Rules, Confidence Penalty, Extraction Warnings in Staging) - RelationshipValidator service at `/backend/src/validation/relationship-validator.js` validates entities/relationships against ontology domain/range constraints during document processing; applies configurable confidence penalties (domain: 0.85, range: 0.85, both: 0.7, unknown type: 0.7); integrated into document-processor.js pipeline; staging-service.js includes getValidationWarnings() method and validation summary in preview; 33 unit tests |
| 1.21 | 2026-01-22 | Completed F2.1.2 (Type Inheritance / Polymorphic Queries) - `expandTypeWithSubtypes()`, `getTypeTree()` methods in ontology-service.js for type hierarchy expansion; `queryByType()`, `queryWithTypeFilter()`, `getTypeHierarchy()` methods in graph-rag-service.js for polymorphic querying; `findVerticesByTypesPolymorphic()` in graph-service.js; API endpoints: GET `/api/ontology/types/:type/subtree`, GET `/api/graphrag/query-by-type`, POST `/api/graphrag/query-with-type-filter`; 16 new unit tests for polymorphic functionality |
| 1.22 | 2026-01-22 | Completed F2.2.1 (Ontology Version Field) - Semantic versioning support with owl:versionIRI, owl:priorVersion, bke:versionMetadata (major/minor/patch, releaseNotes, deprecations), bke:versionHistory at `/ontology/business-process.jsonld`; Version utilities in ontology-service.js: parseVersion(), compareVersions(), isVersionCompatible(), getVersionChangeType(), getVersionInfo(), getVersionHistory(), formatVersion(), validateVersion(), getNextVersion(), getChangesFromVersion(); API endpoints: GET `/api/ontology/version`, `/api/ontology/version/history`, `/api/ontology/version/next`, POST `/api/ontology/version/compare`, `/api/ontology/version/validate`; 35 new unit tests for versioning functionality |
| 1.23 | 2026-01-22 | Completed F5.2.6 (Circuit Breakers) - Production-grade circuit breaker implementation using opossum library at `/backend/src/services/circuit-breaker-service.js`; wraps OpenAI, Search, and Gremlin services; configurable thresholds via env vars (CB_*_TIMEOUT, CB_*_ERROR_THRESHOLD, CB_*_RESET_TIMEOUT, CB_*_VOLUME_THRESHOLD); event-based monitoring with telemetry/logging; API endpoints: GET `/api/circuit-breakers`, `/api/circuit-breakers/:service`, `/api/circuit-breakers/open`, POST `/api/circuit-breakers/:key/reset`, `/api/circuit-breakers/reset-all`; 32 unit tests |
| 1.24 | 2026-01-22 | Completed F5.2.2 (Entity Resolution Caching) - LRU-based caching layer at `/backend/src/services/entity-resolution-cache.js` using lru-cache v11; five specialized caches: resolved entities, embeddings (avoid API calls), similarity scores, canonical entities, similar entities; configurable TTL and max sizes via env vars (CACHE_RESOLVED_ENTITIES_MAX, CACHE_EMBEDDINGS_TTL_MS, etc.); cache statistics tracking with hit rates, evictions, invalidations; health monitoring; integrated into EntityResolutionService with automatic cache invalidation on entity create/merge; API endpoints: GET `/api/entities/cache/stats`, `/api/entities/cache/health`, POST `/api/entities/cache/clear`, `/api/entities/cache/invalidate/:name`, `/api/entities/cache/invalidate-document/:documentId`, `/api/entities/cache/reset-stats`, `/api/entities/cache/toggle`; 37 unit tests |
| 1.25 | 2026-01-22 | Completed F5.3.1 (Adversarial Test Dataset) - Comprehensive prompt injection and jailbreak test dataset at `/backend/src/evaluation/datasets/adversarial_tests.json` with 89 test cases across 19 attack categories (instructionOverride, systemPromptExtraction, rolePlayManipulation, delimiterInjection, codeExecution, dataExfiltration, jailbreakPhrases, promptLeaking, indirectInjection, obfuscation, typoglycemia, payloadSplitting, flipAttack, sugarCoated, multiTurn, structuralAttacks, ragPoisoning, agentAttacks, negativeTests); 4 multi-turn conversation sequences; based on OWASP LLM01:2025, FlipAttack research, Sugar-Coated Poison techniques; Evaluator at `/backend/src/evaluation/adversarial-evaluator.js` with precision/recall/F1/specificity metrics, per-category and per-severity analysis, confusion matrix, markdown/text report generation; 42 unit tests |
| 1.26 | 2026-01-22 | Completed F5.3.2 (Prompt Injection Detection) - Multi-layered prompt injection defense at `/backend/src/services/prompt-injection-service.js`; 9 attack pattern categories with 50+ regex patterns (instructionOverride, systemPromptExtraction, rolePlayManipulation, delimiterInjection, codeExecution, dataExfiltration, jailbreakPhrases, promptLeaking, indirectInjection); heuristic scoring with 19 indicators and configurable threshold; structural analysis for hidden Unicode, base64-encoded content, excessive repetition, and long text attacks; text sanitization for neutralizing detected patterns; cross-message analysis for multi-turn attack detection; 5 severity levels (none/low/medium/high/critical) with configurable actions (allow/warn/sanitize/block); configurable via env vars; Middleware at `/backend/src/middleware/prompt-injection.js` with guard/monitor/sanitizer modes for flexible integration; API endpoints for analysis, sanitization, and statistics; integrated with GraphRAG query endpoint; 110 unit tests |
| 1.27 | 2026-01-22 | Completed F5.1.1, F5.1.2, F5.1.3 (Audit Persistence) - Dedicated `AuditPersistenceService` at `/backend/src/services/audit-persistence-service.js` using Cosmos DB; persists audit logs and access denials; supports querying with filters; refactored `backend/src/index.js`, `staging-service.js`, and `security-trimming-service.js` to use the new service; removed legacy audit logic from `cosmos.js`; verified with test script. |
| 1.27 | 2026-01-22 | Completed FC.1 (Feature Flags) - Centralized feature flag management service at `/backend/src/services/feature-flags-service.js`; 23 pre-defined flags across 7 categories (security, performance, ingestion, graphrag, evaluation, ui, experimental); environment variable overrides via FF_* pattern; runtime override API for testing/admin; change listeners for reactive updates; statistics and health monitoring; API endpoints: GET `/api/feature-flags`, `/api/feature-flags/stats`, `/api/feature-flags/by-category`, `/api/feature-flags/:key`, `/api/feature-flags/:key/enabled`, POST `/api/feature-flags/:key/override`, DELETE `/api/feature-flags/:key/override`, `/api/feature-flags/overrides`; 51 unit tests |
| 1.28 | 2026-01-22 | Completed FC.2 (Configuration Management) - Centralized configuration management service at `/backend/src/services/configuration-service.js`; 50+ settings across 13 categories (openai, search, document_processing, chunking, cache, circuit_breaker, rate_limiting, graph, evaluation, entity_resolution, security, storage, telemetry); schema validation with type checking and constraints; environment variable overrides via CFG_* pattern or specific envVar; runtime override API with validation; change listeners; restart-required indicators; sensitive value masking; configuration export for documentation; API endpoints: GET `/api/config`, `/api/config/stats`, `/api/config/by-category`, `/api/config/validate`, `/api/config/export`, `/api/config/:key`, `/api/config/:key/value`, POST `/api/config/:key/override`, DELETE `/api/config/:key/override`, `/api/config/overrides`; 57 unit tests |
| 1.29 | 2026-01-23 | Completed F5.3.5 (Rate Limiting Enhancements) - Per-user rate limiting service at `/backend/src/services/user-rate-limit-service.js`; uses user ID from JWT for authenticated users with fallback to IP; role-based tiered multipliers (admin: 3x, reviewer: 2x, contributor: 1.5x, reader: 1x); combined user+IP key for sensitive endpoints; statistics tracking with top blocked users, request volume analysis; configurable via env vars (RATE_LIMIT_*_MULTIPLIER, RATE_LIMIT_*_WINDOW_MS); integrated with express-rate-limit v7; API endpoints: GET `/api/rate-limits`, `/api/rate-limits/config`, `/api/rate-limits/me`, `/api/rate-limits/user/:userId`, POST `/api/rate-limits/reset`; 43 unit tests |
| 1.30 | 2026-01-23 | Completed F5.3.6 (Security Test Automation) - CLI security test runner at `/backend/src/evaluation/run-security-tests.js` with 47 unit tests; GitHub Actions `security-tests` job in `/.github/workflows/ci.yml` runs adversarial evaluation on PRs; generates JSON/Markdown reports; uploads artifacts; auto-comments on PRs with security status; enforces thresholds (F1: 0.85, precision: 0.80, recall: 0.85, critical detection: 0.95); supports --verbose, --category filters, --no-multi-turn; CI/CD metadata tracking (git commit/branch/tags); based on OWASP LLM01:2025 best practices |
| 1.31 | 2026-01-23 | Completed F2.2.2, F2.2.4, F2.2.5 (Ontology Migration Framework with Dry-Run and Rollback) - OntologyMigrationService at `/backend/src/services/ontology-migration-service.js` loads migrations from `/ontology/migrations/`; tracks applied migrations via Cosmos DB or file storage; MigrationContext class for change tracking (addEntityType, removeEntityType, addRelationshipType, etc.); supports JS and JSON migration formats with up/down/validate functions; MigrationStorageAdapter interface with Cosmos DB and file-based implementations at `/backend/src/services/migration-storage-adapter.js`; example migration at `/ontology/migrations/1.1.0-add-project-entity-type.js`; API endpoints: GET `/api/ontology/migrations`, `/api/ontology/migrations/pending`, `/api/ontology/migrations/preview/:version`, POST `/api/ontology/migrations/run/:version`, `/api/ontology/migrations/run-all`, `/api/ontology/migrations/rollback/:version`, `/api/ontology/migrations/create`; 32 unit tests; based on [LinkML](https://academic.oup.com/gigascience/advance-article-pdf/doi/10.1093/gigascience/giaf152/65854805/giaf152.pdf) and [Knex](https://blog.logrocket.com/how-to-migrate-a-database-schema-at-scale/) migration patterns |
| 1.32 | 2026-01-23 | Completed F5.1.4 (Audit Log Retention Policy) - Config-driven retention sweep with optional archiving, container TTL enforcement, and scheduled cleanup at `/backend/src/services/audit-persistence-service.js`; scheduler startup wired in `/backend/src/index.js`; config additions in `/backend/src/services/configuration-service.js`; unit tests at `/backend/src/services/__tests__/audit-retention-service.test.js` |
| 1.33 | 2026-01-23 | Completed F2.3.1 (Temporal Schema Fields) - Added 6 temporal properties (validFrom, validTo, supersededBy, supersedes, temporalStatus, versionSequence) and 2 version relationships (SUPERSEDED_BY, SUPERSEDES) to ontology at `/ontology/business-process.jsonld`; Migration at `/ontology/migrations/1.2.0-add-temporal-schema-fields.js` with up/down/validate functions; Graph service temporal methods: _computeTemporalStatus(), findCurrentEntities(), findEntitiesValidAt(), getEntityVersionHistory(), findVertexById(), createEntityVersion(), findEntitiesByTemporalStatus(), refreshTemporalStatus(), refreshAllTemporalStatuses(), getTemporalStats(); Temporal service at `/backend/src/services/temporal-service.js` with validation, status computation, filtering, sorting, version chain validation; 43 unit tests at `/backend/src/services/__tests__/temporal-service.test.js` |
| 1.34 | 2026-01-23 | Completed F2.2.3 (Type Deprecation Support) - Soft delete deprecation mechanism at `/backend/src/services/ontology-service.js`: isTypeDeprecated(), getDeprecationInfo(), getReplacementType(), getDeprecatedTypes(), deprecateType(), undeprecateType(), getDeprecationWarning(), getMigrationPath(), validateDeprecations(); OWL-compliant deprecation properties added to `/ontology/business-process.jsonld`: owl:deprecated, bke:replacedBy, bke:deprecationReason, bke:deprecationDate, bke:removalVersion, bke:migrationGuide; Deprecation warnings integrated into validateEntityType(), validateRelationship(), generateValidationReport() with deprecationReport section; API endpoints: GET `/api/ontology/deprecated`, `/api/ontology/deprecated/:type`, `/api/ontology/deprecated/:type/migration-path`, `/api/ontology/deprecated/validate`, POST `/api/ontology/deprecate`, `/api/ontology/undeprecate`; 36 unit tests at `/backend/src/services/__tests__/type-deprecation-service.test.js` |
| 1.35 | 2026-01-23 | Completed F2.3.5 (Entity History API) - Added GET `/api/entities/:id/history` to return temporal version history with metadata; GraphService now supports history lookup by ID via `getEntityVersionHistoryById()` |
| 1.35 | 2026-01-23 | Implemented F5.1.4 (Audit Log Retention Policy) - Actual code implementation; Added `updateRetentionPolicy` to `AuditPersistenceService` at `/backend/src/services/audit-persistence-service.js`; integrated with `ConfigurationService`; added `archiveOldLogs` placeholder; added API endpoint `POST /api/audit/retention` in `/backend/src/index.js`; added unit tests at `/backend/src/services/__tests__/audit-persistence-service.test.js`. (Replaces previous placeholder entry 1.32 which referenced non-existent code) |
| 1.36 | 2026-01-23 | Completed F2.3.2 (REPLACED_BY Relationship) and F2.3.3 (DEPRECATED_BY Relationship) - Added lifecycle relationship types `REPLACED_BY`, `REPLACES`, `DEPRECATED_BY`, and `DEPRECATES` to ontology v1.3.0 and created migration `1.3.0-add-succession-relationships.js`; updated `RelationshipNormalizationMapping` with 8 new synonyms; fixed `MigrationContext` in `ontology-migration-service.js` to support `addProperty`/`removeProperty`/`modifyProperty` methods required by migrations; added 14 unit tests at `/backend/src/services/__tests__/succession-relationships.test.js` |
| 1.36 | 2026-01-23 | Completed F5.1.5 (Audit Log Export) - AuditExportService at `/backend/src/services/audit-export-service.js` with CSV/JSON/NDJSON export formats; date range, action, entity type, and user filtering; file export to configurable archive directory; streaming download support; scheduled periodic exports with configurable intervals; export job tracking with status (pending/in_progress/completed/failed); statistics and monitoring; API endpoints: GET `/api/audit/export` (with `?download=true` option), POST `/api/audit/export/file`, GET/DELETE `/api/audit/export/files[/:filename]`, GET/POST/DELETE `/api/audit/export/schedule[/:name]`, POST `/api/audit/export/schedule/:name/run`, GET `/api/audit/export/stats`, GET `/api/audit/export/jobs[/:jobId]`; admin/auditor role protection; graceful shutdown of scheduled exports; 39 unit tests |
| 1.37 | 2026-01-23 | Completed F2.3.4 (Time-Aware Graph Queries) - Point-in-time graph snapshots and temporal queries at `/backend/src/services/graph-service.js`: getGraphSnapshotAt(), findNeighborsValidAt(), traverseGraphAt(), compareGraphStates(); GraphRAG temporal query methods at `/backend/src/services/graph-rag-service.js`: queryAtTime(), generateAnswerAtTime(), getGraphSnapshot(); enables queries like "Show org structure as of 2024-01-01"; API endpoints: POST `/api/graphrag/temporal/query`, `/api/graphrag/temporal/answer`, `/api/graphrag/temporal/traverse`, GET `/api/graphrag/temporal/snapshot`, `/api/graphrag/temporal/compare`, `/api/graphrag/temporal/neighbors`; 26 unit tests at `/backend/src/services/__tests__/temporal-graph-queries.test.js` |


| 1.38 | 2026-01-23 | Completed F4.3.4 (Custom Entity Type Definitions) - Runtime custom entity type management via CustomOntologyService at /backend/src/services/custom-ontology-service.js; persists types to Cosmos DB; integrated with OntologyService for transparent usage; API endpoints: POST /api/ontology/custom-types, DELETE /api/ontology/custom-types/:name; 9 unit tests at /backend/src/services/__tests__/custom-ontology-service.test.js and /backend/src/services/__tests__/ontology-service-custom.test.js |
| 1.39 | 2026-01-23 | Completed F5.2.4 (Pagination for All Lists) - Cursor-based pagination service at `/backend/src/services/pagination-service.js` with multiple strategies: Cosmos DB continuation tokens, keyset-based pagination (timestamp + id), and offset-based fallback; standardized response format `{ items, pagination: { nextCursor, hasMore, pageSize, itemCount } }`; helper functions: encodeCursor(), decodeCursor(), createKeysetCursor(), buildPaginatedCosmosQuery(), processPaginatedResults(), paginateArray(); Express middleware for automatic pagination param parsing; updated cosmos.js with listDocumentsPaginated(), audit-persistence-service.js with queryLogsPaginated(); API endpoints: GET `/api/documents/paginated`, `/api/audit/logs/paginated` with cursor, pageSize, sortBy, sortOrder parameters; backward compatible with existing limit parameter; 57 unit tests |
| 1.40 | 2026-01-23 | Completed F4.3.5 (Custom Relationship Definitions) - Implemented API endpoints for Custom Relationship Types at `/backend/src/index.js` (GET/POST `/api/ontology/custom-relationship-types`, DELETE `/api/ontology/custom-relationship-types/:name`); Logic in `CustomOntologyService` and `OntologyService` was already in place; Added comprehensive API tests at `/backend/src/services/__tests__/custom-relationship-api.test.js` covering creation, retrieval, deletion and validation of custom relationships with domain/range constraints; 35 total unit tests |
| 1.40 | 2026-01-23 | Completed F4.3.5 (Custom Relationship Definitions) - Custom relationship type management at `/backend/src/services/custom-ontology-service.js` with domain/range constraints; UPPER_SNAKE_CASE naming validation; inverse relationship support with auto-registration; bidirectional flag; category-based grouping; integrated into OntologyService at `/backend/src/services/ontology-service.js` for runtime registration, type hierarchy validation, and constraint checking via `validateRelationshipConstraints()`; API endpoints: GET `/api/ontology/custom-relationships`, POST `/api/ontology/custom-relationships`, GET/PUT/DELETE `/api/ontology/custom-relationships/:name`, POST `/api/ontology/custom-relationships/validate`; 30 unit tests |
| 1.41 | 2026-01-23 | Completed F5.2.3 (Gremlin Query Optimization) - Added profiling and slow query logging (>200ms) to `GraphService._submit` using `utils/logger`; optimized `findVertexById` to optionally use `ontologyType` partition key; optimized `findVerticesByType` to query by `ontologyType` property; refactored `batchUpdateMentionCounts` to use parallel execution (`Promise.all`) for 3x+ throughput improvement; verified with mocked unit test script `backend/scripts/unit-test-graph-optimization.js` |
| 1.41 | 2026-01-23 | Completed F5.2.5 (Latency Budgets) - LatencyBudgetService at `/backend/src/services/latency-budget-service.js` with percentile tracking (P50/P95/P99) via time-bucketed rolling windows; operation-specific SLOs (query: 3s, processing: 5min, graph_traversal: 5s, entity_resolution: 2s, search: 1.5s, openai: 30s); warning (70%)/critical (90%)/breach (>100%) severity detection with telemetry alerts; configurable via 13 settings in configuration-service.js (LATENCY_BUDGET_*); listener pattern for reactive monitoring; async/sync function wrappers with `withBudget()`; Express middleware at `/backend/src/middleware/latency-budget.js` for automatic request tracking with path-based operation detection; API endpoints: GET `/api/latency-budgets`, `/api/latency-budgets/stats`, `/api/latency-budgets/health`, `/api/latency-budgets/operations`, `/api/latency-budgets/:operation`, `/api/latency-budgets/:operation/status`, POST `/api/latency-budgets/:operation/reset`, `/api/latency-budgets/reset-all`, `/api/latency-budgets/record`; 54 unit tests |
| 1.42 | 2026-01-23 | Completed F5.1.6 (Suspicious Activity Alerts) - SuspiciousActivityService at `/backend/src/services/suspicious-activity-service.js` with real-time detection of 9 patterns (excessive_denials, high_query_volume, off_hours_access, rapid_requests, bulk_document_access, auth_failure_spike, rate_limit_violation, data_exfiltration_pattern, unusual_entity_access); ActivityWindow class for time-based event tracking; UserActivityTracker for per-user monitoring; configurable thresholds via env vars; alert cooldown to prevent spam (5 min default); 4 severity levels (low/medium/high/critical); Azure Monitor integration via Application Insights trackSecurityEvent/trackMetric; historical audit log analysis; integrated with security-trimming-service.js for automatic denial tracking and user-rate-limit-service.js for rate limit violation tracking; API endpoints: GET `/api/security/suspicious-activity/stats`, `/api/security/suspicious-activity/users`, `/api/security/suspicious-activity/users/:userId`, `/api/security/suspicious-activity/azure-monitor-config`, POST `/api/security/suspicious-activity/analyze`, `/api/security/suspicious-activity/reset`; 38 unit tests |
| 1.43 | 2026-01-23 | Completed FC.7 (Health Check Enhancements) - Comprehensive HealthCheckService at `/backend/src/services/health-check-service.js` with health checks for 6 external dependencies (Cosmos DB, Gremlin, OpenAI, Azure Search, Blob Storage, Document Intelligence); Kubernetes-compatible probes: `/health/live` (liveness) and `/health/ready` (readiness); cached health results with configurable TTL (30s default); startup validation with retry logic (3 retries, 5s delay); health history tracking for trend analysis; status change listener pattern for reactive monitoring; circuit breaker service integration; per-dependency health checks with latency tracking; configurable via env vars (HEALTH_CHECK_TIMEOUT_MS, HEALTH_CHECK_CACHE_MS, HEALTH_CHECK_HISTORY_SIZE, HEALTH_CHECK_STARTUP_RETRIES); API endpoints: GET `/health/live`, `/health/ready`, `/health/dependencies`, `/health/dependencies/:dependency`, `/health/summary`, `/health/history`, `/health/startup`, `/health/cache`, `/health/config`, DELETE `/health/cache`; integrated startup validation in server bootstrap; 39 unit tests |
| 1.43 | 2026-01-23 | Completed F5.2.7 (Performance Dashboard) - PerformanceDashboardService at `/backend/src/services/performance-dashboard-service.js` aggregates metrics from latency budgets, circuit breakers, entity resolution cache, and rate limit services; ThroughputTracker class with rolling window buckets for real-time RPS and error rate calculation; HistoryStorage for metric snapshots with configurable retention; ASCII sparkline visualization via generateSparkline(); health score calculation combining all component statuses (healthy/warning/critical); throughputMiddleware() for automatic request tracking; configurable via env vars (PERF_THROUGHPUT_WINDOW_MS, PERF_HISTORY_MAX_ENTRIES, PERF_HEALTH_*_THRESHOLD); API endpoints: GET `/api/performance` (full dashboard), `/api/performance/health`, `/api/performance/throughput`, `/api/performance/latency`, `/api/performance/circuit-breakers`, `/api/performance/cache`, `/api/performance/rate-limits`, `/api/performance/history`, `/api/performance/report` (ASCII text), POST `/api/performance/reset`; 56 unit tests |
| 1.44 | 2026-01-23 | Completed F6.3.2, F6.3.3, F6.3.4 (Persona-Specific GraphRAG) - Integrated `PersonaService` into GraphRAG pipeline; `_expandEntityGraph` now uses persona-weighted priority scoring for entity expansion; `_findRelevantChunks` uses persona weights for chunk ranking; `generateAnswer` injects persona-specific system prompts (e.g., "Speak like an Ops manager"); Added `GET /api/personas` endpoint; Updated `POST /api/graphrag/search` and `/answer` to support `options.persona`; 6 new unit tests at `/backend/src/services/__tests__/graph-rag-persona.test.js` |
| 1.44 | 2026-01-23 | Completed F6.3.1 (Persona Definitions) - PersonaService at `/backend/src/personas/index.js` with 5 personas (Ops, IT, Leadership, Compliance, Default) for personalized GraphRAG responses; entity type weights (0-1 scale) per persona prioritizing relevant entities (Ops: Process/Task, IT: System/Application/Database, Leadership: Metric/KPI, Compliance: Policy/Regulation/Standard); category weights for entity groupings; relationship type weights for traversal preferences; summary styles (TECHNICAL, EXECUTIVE, OPERATIONAL, COMPLIANCE, BALANCED) with maxLength, promptHint, and formatting preferences; context preferences (maxEntities, maxRelationships, maxHops); entity scoring with calculateEntityScore(), rankEntitiesByPersona(), filterEntitiesByPersona(); prompt hint generation via getPromptHint(); persona validation and normalization; singleton pattern with getPersonaService(); example queries per persona; 80 unit tests |
| 1.45 | 2026-01-23 | Completed F5.3.3 (Information Leakage Tests) - Comprehensive test suite at `/backend/src/services/__tests__/information-leakage.test.js` with 58 unit tests covering 12 leakage categories: cross-role classification enforcement, role escalation prevention, graph traversal leakage (direct/multi-hop), pending entity status leakage, ownership/visibility protection, sensitive field trimming (internalNotes, reviewerComments, processingMetadata, uploadedBy, allowedViewers, allowedGroups), denial message security, group-based isolation, department-based isolation, combined multi-factor access control, OData injection prevention; relationship inference attack scenarios (transitive, diamond patterns, entity existence); validates security trimming service for documents and graph entities/relationships; tests based on OWASP API Security best practices |
