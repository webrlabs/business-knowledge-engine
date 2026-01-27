# Baseline Metrics Documentation

> **Feature:** F1.3.3 - Baseline Documentation
> **Created:** 2026-01-25
> **Version:** 1.0.0

This document establishes the baseline metrics for the GraphRAG system evaluation suite. All future improvements and regressions should be measured against these baselines.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Evaluation Suites Overview](#evaluation-suites-overview)
3. [Metric Definitions](#metric-definitions)
4. [Baseline Targets (SLOs)](#baseline-targets-slos)
5. [Running Benchmarks](#running-benchmarks)
6. [Interpreting Results](#interpreting-results)
7. [Regression Detection](#regression-detection)
8. [Trend Analysis](#trend-analysis)

---

## Executive Summary

The GraphRAG evaluation suite measures system quality across 9 evaluation dimensions:

| Suite | Primary Metric | Baseline Target | Priority |
|-------|----------------|-----------------|----------|
| Retrieval | MRR | ≥ 0.70 | P0 |
| Answer Quality | Normalized Score | ≥ 0.70 | P0 |
| Grounding | Average Score | ≥ 0.80 | P0 |
| Citation | Average Score | ≥ 0.75 | P1 |
| Entity Extraction | F1 Score | ≥ 0.75 | P0 |
| Relationship Extraction | F1 Score | ≥ 0.70 | P1 |
| Community Summary | Overall Score | ≥ 0.70 | P1 |
| Lazy vs Eager | Quality Score | ≥ 3.5/5.0 | P2 |
| Negative Tests | Pass Rate | ≥ 0.85 | P0 |

**Threshold for Regression:** A metric is considered regressed if it drops by more than 5% from baseline.

---

## Evaluation Suites Overview

### 1. Retrieval Metrics (`retrieval`)

Measures the quality of document retrieval for user queries.

**Purpose:** Ensure the system retrieves relevant documents from the knowledge base.

**Test Data:** Query-document relevance judgments from `qa_benchmark.json`

**Key Metrics:**
- MRR (Mean Reciprocal Rank)
- MAP (Mean Average Precision)
- Precision@K, Recall@K, F1@K
- NDCG@K (Normalized Discounted Cumulative Gain)
- Hit Rate@K

### 2. Answer Quality (`answer-quality`)

Uses LLM-as-Judge (GPT-4) to evaluate generated answers on multiple dimensions.

**Purpose:** Ensure answers are helpful, accurate, and complete.

**Test Data:** Q&A pairs with context from `qa_benchmark.json`

**Key Metrics:**
- Helpfulness (1-5 scale)
- Accuracy (1-5 scale)
- Completeness (1-5 scale)
- Normalized Overall Score (0-1)

### 3. Grounding Score (`grounding`)

Measures how well answers are grounded in retrieved context (anti-hallucination).

**Purpose:** Detect and penalize unsupported claims.

**Test Data:** Answer-context pairs from `qa_benchmark.json`

**Key Metrics:**
- Average Score (0-1)
- Average Weighted Score (0-1)
- Supported Claims Count
- Unsupported Claims Count

### 4. Citation Accuracy (`citation`)

Verifies that citations in answers match actual source content.

**Purpose:** Ensure traceability and verifiability of answers.

**Test Data:** Answers with source references from `qa_benchmark.json`

**Key Metrics:**
- Average Score (0-1)
- Verified Citations Count
- Total Citations Count

### 5. Entity Extraction (`entity-extraction`)

Compares extracted entities against ground truth annotations.

**Purpose:** Measure extraction quality for knowledge graph construction.

**Test Data:** Document-entity annotations from `entity_ground_truth.json`

**Key Metrics:**
- Precision (0-1)
- Recall (0-1)
- F1 Score (0-1)
- Macro-averaged metrics
- Per-type metrics (18 entity types)

**Matching Modes:**
- `STRICT`: Exact match on normalized name AND type
- `PARTIAL`: Fuzzy name matching (Levenshtein ≥ 0.85) with exact type
- `TYPE_ONLY`: Correct type regardless of name similarity

### 6. Relationship Extraction (`relationship-extraction`)

Compares extracted relationships against ground truth annotations.

**Purpose:** Measure relationship extraction quality for knowledge graph edges.

**Test Data:** Document-relationship annotations from `qa_benchmark.json`

**Key Metrics:**
- Precision (0-1)
- Recall (0-1)
- F1 Score (0-1)
- Direction Accuracy (0-1)
- Per-type metrics (25 relationship types)

**Matching Modes:**
- `STRICT`: Exact match on source, target, and type
- `PARTIAL`: Fuzzy entity name matching with exact type
- `DIRECTION_AGNOSTIC`: Ignores relationship direction
- `TYPE_ONLY`: Correct type regardless of entity names

### 7. Community Summary (`community-summary`)

Evaluates the quality of generated community summaries.

**Purpose:** Ensure community summaries accurately represent graph clusters.

**Test Data:** Community-summary pairs from `qa_benchmark.json`

**Key Metrics:**
- Accuracy (1-5 scale): Factual correctness
- Relevance (1-5 scale): Coverage of key entities
- Coherence (1-5 scale): Logical flow and readability
- Entity Coverage (0-1): Programmatic entity mention check
- Overall Score (1-5 scale)

### 8. Lazy vs Eager Comparison (`lazy-vs-eager`)

Compares on-demand (lazy) vs pre-computed (eager) GraphRAG strategies.

**Purpose:** Evaluate latency/quality trade-offs between strategies.

**Test Data:** Query set from `lazy_vs_eager_benchmark.json`

**Key Metrics:**
- Eager Latency Average (ms)
- Lazy Latency Average (ms)
- Latency Difference (%)
- Eager Quality Score (1-5)
- Lazy Quality Score (1-5)
- Winner determination

### 9. Negative Tests (`negative-tests`)

Tests system response to questions that should NOT be answerable.

**Purpose:** Measure hallucination resistance and appropriate refusal behavior.

**Test Data:** Negative test cases from `negative_tests.json`

**Categories:**
- `nonexistent_entity`: Questions about entities not in the knowledge base
- `out_of_scope`: Questions outside the system's domain
- `temporal_gap`: Questions about future or unavailable time periods
- `fictional`: Questions about fictional scenarios
- `specificity_trap`: Overly specific questions that can't be answered
- `cross_domain`: Questions mixing unrelated domains
- `counterfactual`: "What if" hypothetical questions

**Key Metrics:**
- Pass Rate (0-1): Fraction of correct refusals
- Hallucination Rate (0-1): Fraction of inappropriate answers
- Average Score (0-1)
- Per-category statistics

---

## Metric Definitions

### Retrieval Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **Precision@K** | `\|Retrieved ∩ Relevant\| / K` | Fraction of top-K results that are relevant |
| **Recall@K** | `\|Retrieved ∩ Relevant\| / \|Relevant\|` | Fraction of all relevant docs in top-K |
| **F1@K** | `2 × (P×R) / (P+R)` | Harmonic mean of Precision and Recall |
| **MRR** | `avg(1/rank of first relevant)` | Average reciprocal rank of first relevant result |
| **MAP** | `avg(Average Precision)` | Mean of average precision across queries |
| **NDCG@K** | `DCG@K / IDCG@K` | Normalized discounted cumulative gain (0-1) |
| **Hit Rate@K** | `avg(1 if any relevant in top-K else 0)` | Fraction of queries with ≥1 relevant in top-K |

### Answer Quality Metrics (LLM-as-Judge)

| Metric | Scale | Description |
|--------|-------|-------------|
| **Helpfulness** | 1-5 | Does the answer address the user's question? |
| **Accuracy** | 1-5 | Is the answer factually correct based on context? |
| **Completeness** | 1-5 | Does the answer cover all relevant aspects? |
| **Normalized Score** | 0-1 | `(overall - 1) / 4` for threshold comparison |

**Score Interpretation:**
- 5: Excellent
- 4: Good
- 3: Adequate
- 2: Poor
- 1: Very Poor

### Grounding Metrics

| Metric | Description |
|--------|-------------|
| **Supported Claims** | Claims directly stated or implied by context |
| **Partially Supported** | Some details verified, others not |
| **Not Supported** | Claims contradicting context or fabricated |
| **Not Verifiable** | Claims about topics not in context |
| **Grounding Score** | Weighted average of claim verification status |

**Status Weights:**
- Supported: 1.0
- Partially Supported: 0.5
- Not Supported: 0.0
- Not Verifiable: 0.0

### Extraction Metrics

| Metric | Formula | Description |
|--------|---------|-------------|
| **Precision** | `TP / (TP + FP)` | Fraction of extractions that are correct |
| **Recall** | `TP / (TP + FN)` | Fraction of ground truth items extracted |
| **F1 Score** | `2 × (P×R) / (P+R)` | Harmonic mean (balance of P and R) |
| **Macro-F1** | `avg(F1 per type)` | Average F1 across all types |
| **Direction Accuracy** | `correct_dir / total` | Relationship direction correctness |

---

## Baseline Targets (SLOs)

These are the Service Level Objectives for the GraphRAG system:

### Tier 1: Critical (P0)

Must pass for production deployment:

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Retrieval MRR | ≥ 0.70 | Users must find relevant docs quickly |
| Answer Quality (Normalized) | ≥ 0.70 | Answers must be useful |
| Grounding Score | ≥ 0.80 | Minimal hallucination tolerance |
| Entity Extraction F1 | ≥ 0.75 | Accurate knowledge graph construction |
| Negative Test Pass Rate | ≥ 0.85 | System must refuse appropriately |

### Tier 2: Important (P1)

Should pass for quality releases:

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Citation Accuracy | ≥ 0.75 | Traceability for compliance |
| Relationship Extraction F1 | ≥ 0.70 | Complete knowledge graph edges |
| Community Summary Overall | ≥ 0.70 (normalized: ≥ 3.8/5.0) | Meaningful cluster summaries |

### Tier 3: Nice-to-Have (P2)

Bonus quality indicators:

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Lazy vs Eager Quality | ≥ 3.5/5.0 | On-demand strategy viability |
| NDCG@10 | ≥ 0.75 | Optimal ranking quality |
| Precision@1 | ≥ 0.80 | First result highly relevant |

### Regression Thresholds

A metric is flagged as regressed if:

| Severity | Threshold | Action |
|----------|-----------|--------|
| **Critical** | > 10% drop in P0 metrics | Block deployment |
| **Warning** | > 5% drop in any metric | Review required |
| **Notice** | > 2% drop in any metric | Monitor closely |

---

## Running Benchmarks

### Quick Start

```bash
# Run all evaluation suites with default settings
cd backend
node src/evaluation/run-benchmark.js

# Run with the full benchmark dataset
node src/evaluation/run-benchmark.js \
  --dataset src/evaluation/datasets/qa_benchmark.json \
  --output text

# Run specific suite only
node src/evaluation/run-benchmark.js --suite retrieval
node src/evaluation/run-benchmark.js --suite answer-quality
node src/evaluation/run-benchmark.js --suite grounding
node src/evaluation/run-benchmark.js --suite entity-extraction
node src/evaluation/run-benchmark.js --suite negative-tests
```

### Save Results for Trend Analysis

```bash
# Save results with metadata
node src/evaluation/run-benchmark.js \
  --dataset src/evaluation/datasets/qa_benchmark.json \
  --save-results \
  --run-name "Sprint 15 Release" \
  --git-branch main \
  --git-commit $(git rev-parse HEAD)

# Compare against baseline
node src/evaluation/run-benchmark.js \
  --save-results \
  --compare-baseline \
  --baseline-name "v2.0-baseline"

# Set new baseline after successful release
node src/evaluation/run-benchmark.js \
  --save-results \
  --set-baseline \
  --baseline-name "v2.1-baseline"
```

### Output Formats

```bash
# JSON output (for programmatic consumption)
node src/evaluation/run-benchmark.js --output json --output-file results.json

# Markdown output (for documentation)
node src/evaluation/run-benchmark.js --output markdown --output-file results.md

# Text output (for terminal)
node src/evaluation/run-benchmark.js --output text
```

### CI/CD Integration

```bash
# Fail if below threshold (for CI pipelines)
node src/evaluation/run-benchmark.js \
  --threshold 0.7 \
  --fail-on-threshold \
  --compare-baseline

# Exit code: 0 = passed, 1 = failed
```

### Using Config Files

```bash
# Load configuration from file
node src/evaluation/run-benchmark.js --config benchmark-config.json
```

Example `benchmark-config.json`:
```json
{
  "suite": "all",
  "threshold": 0.7,
  "kValues": [1, 3, 5, 10],
  "verbose": true,
  "saveResults": true,
  "runName": "Nightly Build",
  "tags": {
    "environment": "staging",
    "team": "platform"
  }
}
```

---

## Interpreting Results

### Sample Output

```
============================================================
BENCHMARK EVALUATION RESULTS
============================================================

Timestamp: 2026-01-25T10:30:00.000Z
Dataset: qa-benchmark
Threshold: 0.7

------------------------------------------------------------
SUMMARY
------------------------------------------------------------
Total Suites: 9
Passed: 8
Failed: 1
Skipped: 0
Errors: 0
Overall: FAILED

------------------------------------------------------------
SUITE: RETRIEVAL
------------------------------------------------------------
Status: success
Passed: YES
Threshold: 0.7

Metrics:
  mrr: 0.7850
  map: 0.7200
  queryCount: 15
  atK:
    @1:
      precision: 0.8000
      recall: 0.4500
      f1: 0.5760
      ndcg: 0.8000
      hitRate: 0.8000
    @5:
      precision: 0.5200
      recall: 0.8500
      f1: 0.6450
      ndcg: 0.8200
      hitRate: 0.9300
Latency: 45ms

------------------------------------------------------------
SUITE: GROUNDING
------------------------------------------------------------
Status: success
Passed: YES
Threshold: 0.7

Metrics:
  averageScore: 0.8500
  averageWeightedScore: 0.8200
  totalClaims: 120
  supportedClaims: 102
  unsupportedClaims: 18
  evaluationCount: 10
Latency: 2340ms
```

### Status Interpretation

| Status | Meaning |
|--------|---------|
| `success` | Suite ran and produced metrics |
| `skipped` | No test data available for suite |
| `error` | Suite failed to execute |

### Pass/Fail Determination

A suite **passes** if its primary metric meets the threshold:
- Retrieval: MRR ≥ threshold
- Answer Quality: Normalized score ≥ threshold
- Grounding: Average score ≥ threshold
- Entity/Relationship Extraction: F1 ≥ threshold
- Negative Tests: Pass rate ≥ threshold

The **overall result** passes only if ALL suites pass.

---

## Regression Detection

### Automatic Detection

When using `--compare-baseline`, the system automatically:

1. Loads the baseline metrics
2. Compares each metric to current values
3. Flags improvements and regressions
4. Reports percent change

### Example Output

```
--- Baseline Comparison ---
Baseline: v2.0-baseline
Improvements: 3
Regressions: 1
Unchanged: 5

Regressions detected:
  - grounding.averageScore: 0.8500 -> 0.7900 (-7.1%)

Improvements:
  + retrieval.mrr: 0.7500 -> 0.7850 (+4.7%)
  + entityExtraction.f1: 0.7200 -> 0.7600 (+5.6%)
  + negativeTests.passRate: 0.8200 -> 0.8800 (+7.3%)
```

### Manual Baseline Comparison

```bash
# List all stored runs
curl http://localhost:3001/api/evaluation/runs

# Get specific run details
curl http://localhost:3001/api/evaluation/runs/{runId}

# Compare two runs
curl http://localhost:3001/api/evaluation/compare?runId1={id1}&runId2={id2}

# Get trend for specific metric
curl http://localhost:3001/api/evaluation/trend?metric=retrieval.mrr&days=30
```

---

## Trend Analysis

### Viewing Trends via API

```bash
# Get evaluation dashboard
curl http://localhost:3001/api/evaluation/dashboard

# Get metric trends
curl http://localhost:3001/api/evaluation/dashboard/comparison

# Get health status
curl http://localhost:3001/api/evaluation/dashboard/status
```

### Dashboard Metrics

The evaluation dashboard provides:

1. **Sparkline Trends**: ASCII visualization of metric history
2. **Health Scoring**: Overall system health (healthy/warning/critical)
3. **Baseline Comparison**: Current vs baseline with % change
4. **Regression Detection**: Automatic flagging of drops

### Example Dashboard Output

```
EVALUATION DASHBOARD
====================

Overall Health: HEALTHY (Score: 0.92)

Metric Trends (last 10 runs):
  retrieval.mrr:        ▁▂▃▄▅▆▆▇▇█  0.78 (+4.0%)
  grounding.score:      ▅▅▅▆▆▅▆▆▇▇  0.85 (+2.4%)
  entity.f1:            ▃▄▅▅▆▆▇▇▇█  0.76 (+8.6%)
  negative.passRate:    ▅▆▆▇▇▇▇███  0.88 (+7.3%)

Baseline: v2.0-baseline (2026-01-15)
  3 improvements, 0 regressions
```

---

## Best Practices

### Before Major Releases

1. Run full benchmark suite with `--verbose`
2. Compare against current baseline with `--compare-baseline`
3. If all metrics pass, set new baseline with `--set-baseline`
4. Document any significant changes in release notes

### Continuous Integration

1. Add benchmark step to CI pipeline
2. Use `--fail-on-threshold` to block PRs with regressions
3. Store results with `--save-results` for trend analysis
4. Auto-comment on PRs with metric summary

### Investigating Regressions

1. Identify which suite(s) regressed
2. Check per-type metrics for extraction issues
3. Review recent code changes to related components
4. Run suite in `--verbose` mode for detailed diagnostics
5. Compare sample outputs before/after change

### Setting Baselines

1. Only set baselines on stable, tested releases
2. Use descriptive names: `v2.1-baseline`, `sprint-15-baseline`
3. Document baseline context in release notes
4. Keep historical baselines for comparison

---

## Appendix: Dataset Files

| File | Purpose | Records |
|------|---------|---------|
| `qa_benchmark.json` | Main benchmark dataset | 52 Q&A pairs, 15 retrieval queries |
| `entity_ground_truth.json` | Entity extraction ground truth | 25 documents, 322 entities |
| `negative_tests.json` | Hallucination resistance tests | 45 test cases |
| `lazy_vs_eager_benchmark.json` | Strategy comparison queries | 15 queries |
| `adversarial_tests.json` | Security/prompt injection tests | 89 test cases |
| `ci_benchmark.json` | Lightweight CI dataset | 8 queries, 3 Q&A pairs |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-25 | Initial baseline documentation |

---

*Generated for Feature F1.3.3 - Baseline Documentation*
