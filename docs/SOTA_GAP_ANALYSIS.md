# State-of-the-Art Gap Analysis & Implementation Plan

## Executive Summary

This document analyzes the Business Knowledge Engine against the 10-point SOTA framework for enterprise GraphRAG systems. The current implementation covers approximately **65% of SOTA requirements** with strong fundamentals but gaps in evaluation, ontology management, and advanced graph analytics.

---

## Gap Analysis by SOTA Area

### 1. Hybrid RAG + GraphRAG Pattern

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Vector RAG for fast semantic retrieval | ✅ Azure AI Search with HNSW | None |
| Knowledge graph retrieval for relationships | ✅ Cosmos Gremlin with multi-hop traversal | None |
| GraphRAG-style summarization | ⚠️ Basic community detection (connected components) | Medium |
| LazyGraphRAG for reduced indexing costs | ❌ Full upfront indexing required | Medium |

**Current Implementation:**
- Hybrid search combining vector + keyword + graph expansion
- Entity-centric retrieval with canonical resolution
- Context assembly from entities, relationships, and chunks

**Gaps:**
1. Community detection uses naive connected-components, not Louvain/Leiden algorithms
2. No intermediate summarization layer (GraphRAG's "map-reduce" pattern)
3. No lazy/incremental indexing option for high-volume ingestion

---

### 2. Ingestion & Document Understanding

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Layout-aware extraction | ✅ Azure Document Intelligence Layout model | None |
| Hierarchical structure (sections/subsections) | ✅ Sections extracted and chunked separately | None |
| Figure detection | ✅ Figures detected, GPT-4o visual extraction | Low |
| Tables with cell geometry | ⚠️ Tables extracted but geometry not preserved | Medium |
| Reading order | ✅ Maintained via chunk ordering | None |
| Structure-aware chunking | ✅ Section-based + sliding window hybrid | None |
| Table-aware chunking | ✅ Tables chunked as units | None |
| Citation-ready chunks | ⚠️ Page/section tracked, but no character offsets | Low |
| Semantic chunking (topic shifts) | ❌ Fixed 500-token window | Medium |

**Current Implementation:**
- 8-stage pipeline with Document Intelligence
- Three chunk types: content (sliding), section (structural), table
- Visual extraction from diagrams using GPT-4o vision
- Metadata: documentId, pageNumber, sectionTitle, chunkType

**Gaps:**
1. Table cell coordinates not preserved (limits precise citation)
2. No semantic chunking based on topic detection
3. Character-level offsets not tracked for highlighting
4. PDF figure cropping not implemented (requires sharp/canvas)

---

### 3. Knowledge Graph Construction

#### 3.1 Ontology Strategy

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Business capabilities/functions | ⚠️ Implicit in Process/Task types | Medium |
| Processes | ✅ Process entity type defined | None |
| Systems/apps | ✅ System, Application, Database types | None |
| Data entities | ⚠️ Document, Form, Template only | Medium |
| Roles/teams | ✅ Role, Department, Stakeholder types | None |
| Controls/policies | ✅ Policy, Regulation, Standard types | None |
| Metrics/KPIs | ✅ Metric, KPI types defined | None |
| Ontology versioning | ❌ No versioning or evolution tracking | High |
| Ontology customization per tenant | ❌ Fixed schema | High |

**Current Ontology (20 types):**
```
Process, Task, Activity, Decision, Role, Department, Stakeholder,
System, Application, Database, Document, Form, Template,
Policy, Regulation, Standard, Metric, KPI
```

**Gaps:**
1. No formal ontology definition (OWL/RDFS) - just prompt-embedded types
2. No versioning or migration support
3. Cannot add custom types without code changes
4. No type inheritance (e.g., Task is-a Activity)

#### 3.2 Extraction: Multi-pass, Typed Outputs, Confidence

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Entity candidates from structured chunks | ✅ Per-chunk extraction with context | None |
| Strict JSON schema | ✅ JSON response format enforced | None |
| Normalization (canonical names) | ✅ normalizeEntityName() function | None |
| Synonyms/acronyms handling | ⚠️ Aliases stored but not proactively resolved | Medium |
| Entity resolution (merge duplicates) | ✅ Embedding-based with 4-tier thresholds | None |
| Edge validation | ⚠️ Only validates entity existence | Medium |
| Human review sampling | ⚠️ Staging UI exists but no sampling workflow | Medium |

**Current Extraction:**
- LLM extraction with batch parallelism (3 chunks)
- Confidence scoring (0-1 range, defaults: 0.8 entity, 0.7 relationship)
- Source span tracking for entities
- Within-document deduplication via fuzzy matching

**Gaps:**
1. No rule-based validation of relationships (e.g., Role cannot PRECEDES Role)
2. No automated sampling for human review quality metrics
3. Acronym expansion not proactive (relies on LLM to include in name)

#### 3.3 Fusion (Dedup/Merge)

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Synonymy handling | ✅ Embedding similarity catches semantic equivalence | None |
| Acronym handling | ⚠️ Partial via similarity | Medium |
| Org-specific language | ⚠️ No custom dictionary | Medium |
| Reorganization tracking | ❌ No temporal entity versioning | High |
| System migrations | ❌ No "replaces" relationship type | High |
| Canonical IDs | ✅ canonicalId in entity index | None |
| Temporal attributes | ❌ No valid_from/valid_to | High |
| Provenance links to evidence | ✅ sourceDocumentId, sourceSpan | None |

**Current Resolution:**
```
≥0.98 similarity → Use existing (exact match)
≥0.92 similarity → Merge into canonical (add alias)
≥0.85 similarity → Create SAME_AS edge
≥0.75 similarity → Create SIMILAR_TO edge
```

**Gaps:**
1. No temporal modeling (entities change over time)
2. No "replaces" or "deprecated_by" relationship types
3. Custom org terminology requires manual threshold tuning
4. Thresholds are heuristic, not data-driven

---

### 4. Retrieval & Answering

#### 4.1 Two-Stage Retrieval

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Vector retrieval for candidate evidence | ✅ Azure AI Search vector + semantic | None |
| Graph expansion 1-2 hops | ✅ Configurable up to 3 hops | None |
| Add authoritative nodes | ❌ No concept of authoritative sources | Medium |
| Query subgraph assembly | ✅ Implemented in GraphRAGService | None |
| Strict citation requirements | ⚠️ Citations generated but not enforced | Low |

**Current Retrieval:**
1. Query → Extract entities (LLM)
2. Resolve entities to canonical forms
3. Vector search for relevant chunks
4. Graph expansion from discovered entities
5. Context assembly with weighted sources

**Gaps:**
1. No "authoritative source" designation for priority retrieval
2. Citation presence not validated before returning response
3. No relevance scoring for graph-retrieved context

#### 4.2 Question Patterns That Benefit Most

| Pattern | Current Support | Gap Level |
|---------|-----------------|-----------|
| "How does X depend on Y?" | ✅ Graph traversal shows connections | None |
| "What breaks if we change Y?" | ⚠️ Requires explicit relationship modeling | Medium |
| "Who owns process Z?" | ✅ OWNS relationship type defined | None |
| "Upstream/downstream impacts" | ⚠️ DEPENDS_ON exists but not impact analysis | Medium |
| "End-to-end process summary" | ⚠️ Community summarization is basic | Medium |

**Gaps:**
1. No automated impact analysis traversal
2. No "what-if" simulation capability
3. End-to-end summarization limited by naive community detection

---

### 5. Graph Store Choices

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Managed property graph | ✅ Azure Cosmos DB Gremlin API | None |
| Azure ecosystem fit | ✅ Native integration | None |
| Gremlin traversals | ✅ Implemented | None |
| Complex query patterns | ⚠️ Limited by Cosmos Gremlin subset | Medium |
| Join with relational data | ❌ No SQL integration | Medium |

**Current Implementation:**
- Cosmos DB Gremlin API with partition key on ontologyType
- Connection pooling and token caching
- Fallback authentication (Key or Azure AD)

**Gaps:**
1. No Postgres AGE option for teams preferring SQL
2. Cannot join graph with relational business data
3. Some Gremlin features unavailable in Cosmos (e.g., complex aggregations)

---

### 6. Security: Document-Level Authorization

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Document-level access control | ✅ Full implementation | None |
| Pre-query security trimming | ✅ OData filter injection | None |
| Post-query security trimming | ✅ Double-check after search | None |
| Graph security trimming | ✅ Entity/relationship filtering | None |
| ACL/RBAC from ADLS Gen2 | ❌ Manual permission assignment | High |
| KG relationship leakage prevention | ✅ Filters relationships by accessible entities | None |

**Current Security Model:**
- 5-layer access control (Classification, Role, Group, Department, Ownership)
- Role-based classification access (Reader→Internal, Admin→All)
- Audit denial logging (in-memory)
- Field-level trimming for sensitive metadata

**Gaps:**
1. No automatic ACL sync from SharePoint/ADLS
2. Denial log is in-memory (lost on restart)
3. No time-based access control
4. No ABAC (attribute-based) beyond current model

---

### 7. Evaluation: Treat Like ML System

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Curated question sets | ❌ No evaluation dataset | High |
| Grounding checks | ❌ No automated citation verification | High |
| Consistency checks | ❌ No KG answer vs source validation | High |
| Latency/cost budgets | ⚠️ Processing time tracked but no alerts | Medium |
| Answer helpfulness (human judge) | ❌ No human evaluation pipeline | High |
| LLM-judge with rubrics | ❌ Not implemented | High |
| Citation correctness | ❌ Not validated | High |
| Retrieval recall/precision | ❌ Not measured | High |
| Graph accuracy spot-checks | ❌ No sampling workflow | High |
| Security correctness tests | ✅ Unit tests exist | Low |

**Current Evaluation:**
- Unit tests for security trimming
- Processing metrics (time, counts) stored
- Jest test framework

**Gaps:**
1. No evaluation dataset or ground truth
2. No automated quality metrics (NDCG, MRR, F1)
3. No LLM-as-judge evaluation
4. No regression testing for answer quality
5. No A/B testing infrastructure

---

### 8. High-Value Use Cases

| Use Case | Current Support | Gap Level |
|----------|-----------------|-----------|
| Operational Q&A with traceability | ✅ Core functionality | None |
| Impact analysis | ⚠️ Basic graph traversal only | Medium |
| Duplicate work reduction | ⚠️ Entity resolution helps | Medium |
| Onboarding acceleration | ❌ No guided paths | High |
| Audit & compliance readiness | ⚠️ Provenance exists, no compliance views | Medium |

**Gaps:**
1. No "guided tour" feature for onboarding
2. No compliance-specific views or reports
3. Impact analysis requires manual query construction

---

### 9. Implementation Roadmap Alignment

| Phase | SOTA Requirement | Current State |
|-------|------------------|---------------|
| **A: Trustworthy Retrieval** | | |
| ADLS/SharePoint ingestion | ⚠️ Blob upload only | Medium gap |
| Doc Intelligence extraction | ✅ Implemented | Complete |
| AI Search with security trimming | ✅ Implemented | Complete |
| Strong chunking + citations | ✅ Implemented | Complete |
| Evaluation harness | ❌ Not implemented | High gap |
| **B: Thin KG** | | |
| Define ontology + canonical IDs | ✅ 20 types, canonical IDs | Complete |
| LLM extraction + resolution | ✅ Implemented | Complete |
| Provenance | ✅ Implemented | Complete |
| Graph store | ✅ Cosmos Gremlin | Complete |
| Hybrid retrieval | ✅ Implemented | Complete |
| **C: GraphRAG for Global Questions** | | |
| GraphRAG patterns | ⚠️ Basic implementation | Medium gap |
| LazyGraphRAG | ❌ Not implemented | High gap |
| Persona-specific summaries | ❌ Not implemented | High gap |
| Continuous eval | ❌ Not implemented | High gap |
| Red-team tests | ❌ Not implemented | High gap |

---

### 10. Verifiable Grounding (North Star)

| Requirement | Current State | Gap Level |
|-------------|---------------|-----------|
| Every claim maps to evidence spans | ⚠️ Citations exist but not enforced | Medium |
| Every graph edge has provenance | ✅ sourceDocumentId on all edges | None |
| Every retrieval is security-trimmed | ✅ Pre and post filtering | None |
| Every release evaluated against benchmark | ❌ No benchmarks exist | High |

---

## Priority Matrix

### Critical Gaps (Must Address)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Evaluation framework | Cannot measure quality | High | P0 |
| Temporal entity modeling | Cannot track changes | Medium | P0 |
| Ontology versioning | Cannot evolve schema | Medium | P0 |
| ACL sync from SharePoint/ADLS | Manual permission management | High | P0 |

### High-Value Gaps (Should Address)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| Community detection (Louvain) | Poor global summarization | Medium | P1 |
| Semantic chunking | Suboptimal retrieval | Medium | P1 |
| Impact analysis queries | Missing key use case | Medium | P1 |
| LLM-as-judge evaluation | Cannot automate QA | Medium | P1 |
| Relationship validation rules | Noisy graph | Low | P1 |

### Nice-to-Have Gaps (Could Address)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| LazyGraphRAG | Ingestion cost | High | P2 |
| Postgres AGE option | Team preference | High | P2 |
| Guided onboarding paths | UX improvement | Medium | P2 |
| Compliance-specific views | Audit readiness | Medium | P2 |

---

## Implementation Plan

### Phase 1: Evaluation Foundation (2-3 weeks)

**Goal:** Establish measurement capability before making changes

#### 1.1 Create Evaluation Dataset
```
Tasks:
- Create 50+ curated Q&A pairs covering all question types
- Annotate with expected entities, relationships, and source documents
- Include negative examples (questions that should return "not found")
- Categorize by persona: Ops, IT, Compliance, Leadership

Deliverables:
- /evaluation/datasets/qa_benchmark.json
- /evaluation/datasets/entity_ground_truth.json
- /evaluation/datasets/relationship_ground_truth.json
```

#### 1.2 Build Evaluation Pipeline
```
Tasks:
- Implement retrieval metrics: Recall@K, Precision@K, MRR, NDCG
- Implement answer metrics: Citation accuracy, grounding score
- Implement LLM-as-judge with rubrics (helpfulness, accuracy, completeness)
- Create regression test suite

Deliverables:
- /backend/src/evaluation/metrics.js
- /backend/src/evaluation/llm-judge.js
- /backend/src/evaluation/run-benchmark.js
- /evaluation/results/ (automated output)
```

#### 1.3 Establish Baselines
```
Tasks:
- Run current system against benchmark
- Document baseline metrics
- Identify worst-performing question categories

Deliverables:
- /docs/BASELINE_METRICS.md
- Automated CI check for metric regression
```

### Phase 2: Ontology & Temporal Modeling (2-3 weeks)

**Goal:** Enable schema evolution and temporal reasoning

#### 2.1 Formal Ontology Definition
```
Tasks:
- Define ontology in JSON-LD or OWL format
- Add type inheritance (Task subClassOf Activity)
- Add relationship constraints (domain/range)
- Implement ontology validation in extraction

Deliverables:
- /ontology/business-process.jsonld
- /backend/src/services/ontology-service.js
- /backend/src/validation/ontology-validator.js
```

#### 2.2 Ontology Versioning
```
Tasks:
- Add version field to ontology
- Implement migration scripts for type changes
- Support deprecated types with mapping
- API endpoint for ontology introspection

Deliverables:
- /ontology/migrations/
- /backend/src/services/ontology-migration-service.js
- GET /api/ontology/types endpoint
```

#### 2.3 Temporal Entity Modeling
```
Tasks:
- Add valid_from/valid_to to entity schema
- Add REPLACED_BY, DEPRECATED_BY relationship types
- Implement time-aware graph queries
- UI for viewing entity history

Deliverables:
- Schema migration for temporal fields
- /backend/src/services/temporal-graph-service.js
- Time slider in graph visualization UI
```

### Phase 3: Advanced Graph Analytics (2-3 weeks)

**Goal:** Enable sophisticated graph-based insights

#### 3.1 Community Detection
```
Tasks:
- Implement Louvain algorithm for community detection
- Generate community summaries at ingestion time
- Store communities in dedicated index
- Include community context in GraphRAG queries

Deliverables:
- /backend/src/algorithms/louvain.js
- /backend/src/services/community-service.js
- Community summary storage (Cosmos or Search)
```

#### 3.2 Entity Importance Metrics
```
Tasks:
- Calculate PageRank for all entities
- Calculate betweenness centrality
- Track mention frequency across documents
- Use importance for retrieval ranking

Deliverables:
- /backend/src/algorithms/pagerank.js
- importance field on entities
- Importance-weighted retrieval option
```

#### 3.3 Impact Analysis Queries
```
Tasks:
- Implement "what depends on X" traversal
- Implement "what does X affect" traversal
- Add impact scoring based on path length
- UI for impact visualization

Deliverables:
- /backend/src/services/impact-analysis-service.js
- POST /api/graphrag/impact endpoint
- Impact visualization component
```

### Phase 4: Improved Ingestion (2-3 weeks)

**Goal:** Better document understanding and integration

#### 4.1 Semantic Chunking
```
Tasks:
- Implement topic detection using embeddings
- Split chunks at topic boundaries
- Preserve semantic coherence within chunks
- Compare retrieval quality vs. fixed-size

Deliverables:
- /backend/src/chunking/semantic-chunker.js
- A/B comparison in evaluation pipeline
```

#### 4.2 SharePoint/ADLS Integration
```
Tasks:
- Implement SharePoint site connector
- Sync document permissions (ACLs)
- Incremental sync for updates/deletes
- Map SharePoint metadata to entity types

Deliverables:
- /backend/src/connectors/sharepoint-connector.js
- /backend/src/connectors/adls-connector.js
- Permission sync job
```

#### 4.3 Relationship Validation Rules
```
Tasks:
- Define valid domain/range for each relationship type
- Implement validation during extraction
- Add confidence penalty for constraint violations
- Surface violations in review UI

Deliverables:
- /ontology/relationship-constraints.json
- /backend/src/validation/relationship-validator.js
- Validation warnings in staging UI
```

### Phase 5: Production Hardening (2-3 weeks)

**Goal:** Enterprise-ready operations

#### 5.1 Persistent Audit Logging
```
Tasks:
- Move denial log to Cosmos DB
- Add audit log retention policies
- Implement audit log export
- Add alerting for suspicious access patterns

Deliverables:
- Cosmos audit-logs container
- /backend/src/services/audit-persistence-service.js
- Azure Monitor alert rules
```

#### 5.2 Performance Optimization
```
Tasks:
- Implement caching layer for frequent queries
- Add query result pagination
- Optimize Gremlin queries for common patterns
- Add latency budgets with circuit breakers

Deliverables:
- Redis cache integration
- Pagination across all list endpoints
- Query performance dashboard
```

#### 5.3 Red-Team Testing
```
Tasks:
- Create adversarial test cases (prompt injection, jailbreaks)
- Test security trimming bypass attempts
- Test information leakage through relationships
- Document and fix vulnerabilities

Deliverables:
- /evaluation/datasets/adversarial_tests.json
- Security test results report
- Remediation documentation
```

### Phase 6: Advanced GraphRAG (3-4 weeks)

**Goal:** State-of-the-art global question answering

#### 6.1 GraphRAG Map-Reduce Summarization
```
Tasks:
- Implement map phase: per-community summaries
- Implement reduce phase: cross-community synthesis
- Cache summaries for fast retrieval
- Incremental summary updates on new documents

Deliverables:
- /backend/src/services/graphrag-summarization-service.js
- Community summary index
- Incremental update logic
```

#### 6.2 LazyGraphRAG Option
```
Tasks:
- Implement on-demand community extraction
- Query-time summarization with caching
- Compare latency vs. pre-computed approach
- Make configurable per query

Deliverables:
- /backend/src/services/lazy-graphrag-service.js
- Configuration option in query API
- Performance comparison report
```

#### 6.3 Persona-Specific Views
```
Tasks:
- Define persona profiles (Ops, IT, Leadership, Compliance)
- Customize retrieval weights per persona
- Generate persona-appropriate summaries
- Add persona selection to query API

Deliverables:
- /backend/src/personas/
- Persona-aware GraphRAG queries
- UI persona selector
```

---

## Success Metrics

### Phase 1 Exit Criteria
- [ ] 50+ evaluation Q&A pairs created
- [ ] Baseline metrics documented
- [ ] CI pipeline includes metric regression check

### Phase 2 Exit Criteria
- [ ] Ontology defined in JSON-LD
- [ ] Temporal queries working (show entity at time T)
- [ ] Schema migration tested

### Phase 3 Exit Criteria
- [ ] Louvain communities computed for existing graph
- [ ] PageRank available on all entities
- [ ] Impact analysis API returning valid paths

### Phase 4 Exit Criteria
- [ ] Semantic chunking improves retrieval metrics by >5%
- [ ] SharePoint connector syncing permissions
- [ ] Relationship validation reducing noise

### Phase 5 Exit Criteria
- [ ] Audit logs persisted and queryable
- [ ] P95 latency within budget (<3s for queries)
- [ ] Zero critical findings in red-team tests

### Phase 6 Exit Criteria
- [ ] Global questions answered with community context
- [ ] LazyGraphRAG latency within 2x of pre-computed
- [ ] Persona-specific answers demonstrably different

---

## Resource Estimates

| Phase | Duration | Backend Effort | Frontend Effort | Data Effort |
|-------|----------|---------------|-----------------|-------------|
| 1. Evaluation | 2-3 weeks | Medium | Low | High |
| 2. Ontology | 2-3 weeks | High | Low | Medium |
| 3. Graph Analytics | 2-3 weeks | High | Medium | Low |
| 4. Ingestion | 2-3 weeks | High | Low | Medium |
| 5. Hardening | 2-3 weeks | High | Low | Low |
| 6. Advanced GraphRAG | 3-4 weeks | High | Medium | Medium |

**Total estimated duration: 13-18 weeks**

---

## Appendix: File Structure for New Components

```
backend/
├── src/
│   ├── algorithms/
│   │   ├── louvain.js              # Community detection
│   │   └── pagerank.js             # Entity importance
│   ├── chunking/
│   │   └── semantic-chunker.js     # Topic-based chunking
│   ├── connectors/
│   │   ├── sharepoint-connector.js # SharePoint integration
│   │   └── adls-connector.js       # ADLS Gen2 integration
│   ├── evaluation/
│   │   ├── metrics.js              # Retrieval/answer metrics
│   │   ├── llm-judge.js            # LLM-as-judge evaluation
│   │   └── run-benchmark.js        # Benchmark runner
│   ├── personas/
│   │   ├── index.js                # Persona definitions
│   │   └── retrieval-weights.js    # Per-persona weights
│   ├── services/
│   │   ├── ontology-service.js     # Ontology management
│   │   ├── ontology-migration-service.js
│   │   ├── temporal-graph-service.js
│   │   ├── community-service.js
│   │   ├── impact-analysis-service.js
│   │   ├── graphrag-summarization-service.js
│   │   ├── lazy-graphrag-service.js
│   │   └── audit-persistence-service.js
│   └── validation/
│       ├── ontology-validator.js
│       └── relationship-validator.js
├── ontology/
│   ├── business-process.jsonld     # Formal ontology
│   ├── relationship-constraints.json
│   └── migrations/
│       └── v1-to-v2.js
└── evaluation/
    ├── datasets/
    │   ├── qa_benchmark.json
    │   ├── entity_ground_truth.json
    │   ├── relationship_ground_truth.json
    │   └── adversarial_tests.json
    └── results/
        └── (auto-generated)
```
