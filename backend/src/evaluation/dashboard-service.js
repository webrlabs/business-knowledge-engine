/**
 * Evaluation Dashboard Service
 *
 * Generates visual dashboards and reports showing metric trends over time.
 * Supports both Markdown reports for human viewing and JSON for API consumption.
 *
 * Feature: F1.3.5 - Evaluation Dashboard
 *
 * Key capabilities:
 * - ASCII sparkline visualizations for metric trends
 * - Regression/improvement detection with visual indicators
 * - Baseline comparison reports
 * - Summary statistics with trend analysis
 * - Exportable markdown reports
 *
 * Best practices implemented:
 * - Daily rollup with configurable time windows
 * - Central dashboard for all stakeholders
 * - Integration with results storage service
 *
 * @see https://www.evidentlyai.com/blog/mlops-monitoring - MLOps monitoring patterns
 * @see https://codezup.com/from-models-to-metrics-building-a-monitoring-dashboard-for-mlops/
 */

const { getResultsStorageService } = require('./results-storage-service');
const { log } = require('../utils/logger');

/**
 * Configuration for dashboard generation
 */
const CONFIG = {
  // Sparkline characters for trend visualization
  SPARKLINE_CHARS: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],

  // Status indicators
  INDICATORS: {
    IMPROVING: '📈',
    DEGRADING: '📉',
    STABLE: '➡️',
    REGRESSION: '🔴',
    IMPROVEMENT: '🟢',
    UNCHANGED: '⚪',
    PASSED: '✅',
    FAILED: '❌',
    WARNING: '⚠️',
  },

  // Metric display names and descriptions
  METRIC_INFO: {
    mrr: { name: 'Mean Reciprocal Rank', description: 'Retrieval relevance ranking quality', higher: true },
    map: { name: 'Mean Average Precision', description: 'Retrieval precision quality', higher: true },
    answerQuality: { name: 'Answer Quality', description: 'LLM-judged answer helpfulness and accuracy', higher: true },
    groundingScore: { name: 'Grounding Score', description: 'How well answers are grounded in context', higher: true },
    citationAccuracy: { name: 'Citation Accuracy', description: 'Accuracy of source citations', higher: true },
    entityF1: { name: 'Entity F1', description: 'Entity extraction F1 score', higher: true },
    entityPrecision: { name: 'Entity Precision', description: 'Entity extraction precision', higher: true },
    entityRecall: { name: 'Entity Recall', description: 'Entity extraction recall', higher: true },
    relationshipF1: { name: 'Relationship F1', description: 'Relationship extraction F1 score', higher: true },
    directionAccuracy: { name: 'Direction Accuracy', description: 'Relationship direction correctness', higher: true },
  },

  // Default settings
  DEFAULT_RUNS_LIMIT: 20,
  DEFAULT_SPARKLINE_WIDTH: 15,

  // Thresholds
  GOOD_THRESHOLD: 0.7,
  WARNING_THRESHOLD: 0.5,
};

/**
 * Generate ASCII sparkline for a series of values
 *
 * @param {number[]} values - Array of numeric values
 * @param {number} width - Max width of sparkline (default: 15)
 * @returns {string} ASCII sparkline
 */
function generateSparkline(values, width = CONFIG.DEFAULT_SPARKLINE_WIDTH) {
  if (!values || values.length === 0) {
    return '─'.repeat(width);
  }

  // Downsample if too many values
  let displayValues = values;
  if (values.length > width) {
    const step = values.length / width;
    displayValues = [];
    for (let i = 0; i < width; i++) {
      const idx = Math.floor(i * step);
      displayValues.push(values[idx]);
    }
  }

  const min = Math.min(...displayValues);
  const max = Math.max(...displayValues);
  const range = max - min;

  if (range === 0) {
    // All values are the same
    return CONFIG.SPARKLINE_CHARS[4].repeat(displayValues.length);
  }

  return displayValues
    .map((v) => {
      const normalized = (v - min) / range;
      const idx = Math.min(
        CONFIG.SPARKLINE_CHARS.length - 1,
        Math.floor(normalized * CONFIG.SPARKLINE_CHARS.length)
      );
      return CONFIG.SPARKLINE_CHARS[idx];
    })
    .join('');
}

/**
 * Format a number for display
 *
 * @param {number} value - Numeric value
 * @param {number} decimals - Decimal places (default: 3)
 * @returns {string} Formatted string
 */
function formatNumber(value, decimals = 3) {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  return value.toFixed(decimals);
}

/**
 * Format percentage change
 *
 * @param {number} percentChange - Percentage change value
 * @returns {string} Formatted string with sign
 */
function formatPercentChange(percentChange) {
  if (percentChange === null || percentChange === undefined) {
    return 'N/A';
  }
  const sign = percentChange >= 0 ? '+' : '';
  return `${sign}${percentChange.toFixed(1)}%`;
}

/**
 * Get status indicator for a metric trend
 *
 * @param {string} trend - Trend direction ('improving', 'degrading', 'stable')
 * @param {boolean} higherIsBetter - Whether higher values are better
 * @returns {string} Status indicator emoji
 */
function getTrendIndicator(trend, higherIsBetter = true) {
  if (trend === 'improving') {
    return higherIsBetter ? CONFIG.INDICATORS.IMPROVING : CONFIG.INDICATORS.DEGRADING;
  }
  if (trend === 'degrading') {
    return higherIsBetter ? CONFIG.INDICATORS.DEGRADING : CONFIG.INDICATORS.IMPROVING;
  }
  return CONFIG.INDICATORS.STABLE;
}

/**
 * Get health indicator based on metric value and thresholds
 *
 * @param {number} value - Metric value
 * @returns {string} Health indicator emoji
 */
function getHealthIndicator(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (value >= CONFIG.GOOD_THRESHOLD) {
    return CONFIG.INDICATORS.PASSED;
  }
  if (value >= CONFIG.WARNING_THRESHOLD) {
    return CONFIG.INDICATORS.WARNING;
  }
  return CONFIG.INDICATORS.FAILED;
}

/**
 * Dashboard Service
 * Generates evaluation dashboards and reports
 */
class DashboardService {
  constructor() {
    this.storageService = getResultsStorageService();
  }

  /**
   * Generate a comprehensive dashboard report
   *
   * @param {Object} options - Dashboard options
   * @param {number} options.limit - Number of recent runs to include
   * @param {string} options.gitBranch - Filter by git branch
   * @param {string} options.format - Output format ('markdown', 'json')
   * @returns {Promise<Object>} Dashboard data or formatted report
   */
  async generateDashboard(options = {}) {
    const { limit = CONFIG.DEFAULT_RUNS_LIMIT, gitBranch = null, format = 'json' } = options;

    try {
      // Gather all data
      const [stats, recentRuns, allTrends, baseline] = await Promise.all([
        this.storageService.getStats(),
        this.storageService.getRecentRuns({ limit, gitBranch }),
        this.storageService.getAllMetricTrends({ limit, gitBranch }),
        this.storageService.getBaseline('default').catch(() => null),
      ]);

      // Build dashboard data structure
      const dashboardData = {
        generatedAt: new Date().toISOString(),
        config: {
          runsIncluded: recentRuns.length,
          gitBranch: gitBranch || 'all',
        },
        summary: this._buildSummary(stats, recentRuns, baseline),
        latestRun: this._formatRunSummary(recentRuns[0]),
        baseline: baseline ? this._formatBaselineSummary(baseline) : null,
        trends: this._formatTrends(allTrends),
        recentRuns: recentRuns.slice(0, 5).map((r) => this._formatRunSummary(r)),
        health: this._calculateOverallHealth(allTrends),
      };

      if (format === 'markdown') {
        return this._renderMarkdown(dashboardData);
      }

      return dashboardData;
    } catch (error) {
      log.errorWithStack('Failed to generate dashboard', error);
      throw error;
    }
  }

  /**
   * Generate a comparison report between current and baseline
   *
   * @param {Object} options - Report options
   * @returns {Promise<Object>} Comparison report
   */
  async generateComparisonReport(options = {}) {
    const { format = 'json' } = options;

    try {
      const latestRun = await this.storageService.getLatestRun();
      if (!latestRun) {
        return { error: 'No runs available for comparison' };
      }

      const baseline = await this.storageService.getBaseline('default');
      if (!baseline) {
        return { error: 'No baseline set for comparison' };
      }

      const comparison = await this.storageService.compareToBaseline(latestRun.runId);

      const reportData = {
        generatedAt: new Date().toISOString(),
        baseline: {
          runId: baseline.sourceRunId,
          timestamp: baseline.sourceRunTimestamp,
          name: baseline.name,
        },
        current: {
          runId: latestRun.runId,
          timestamp: latestRun.timestamp,
          name: latestRun.name,
        },
        summary: {
          regressions: comparison.summary.regressionCount,
          improvements: comparison.summary.improvementCount,
          unchanged: comparison.summary.unchangedCount,
          hasRegressions: comparison.summary.hasRegressions,
        },
        metrics: Object.entries(comparison.metrics).map(([name, data]) => ({
          name,
          displayName: CONFIG.METRIC_INFO[name]?.name || name,
          baseline: data.baseline,
          current: data.current,
          diff: data.diff,
          percentChange: data.percentChange,
          status: data.diff < -0.05 ? 'regression' : data.diff > 0.05 ? 'improvement' : 'unchanged',
        })),
        regressions: comparison.regressions,
        improvements: comparison.improvements,
      };

      if (format === 'markdown') {
        return this._renderComparisonMarkdown(reportData);
      }

      return reportData;
    } catch (error) {
      log.errorWithStack('Failed to generate comparison report', error);
      throw error;
    }
  }

  /**
   * Generate a quick status summary
   *
   * @returns {Promise<Object>} Quick status data
   */
  async getQuickStatus() {
    try {
      const [stats, latestRun, baseline] = await Promise.all([
        this.storageService.getStats(),
        this.storageService.getLatestRun(),
        this.storageService.getBaseline('default').catch(() => null),
      ]);

      const status = {
        healthy: true,
        lastRunPassed: latestRun?.summary?.overallPassed ?? null,
        lastRunTimestamp: latestRun?.timestamp ?? null,
        totalRuns: stats.runCount,
        hasBaseline: !!baseline,
        keyMetrics: latestRun?.summary?.keyMetrics ?? {},
      };

      // Check for concerning metrics
      const metrics = status.keyMetrics;
      const concerns = [];

      for (const [name, value] of Object.entries(metrics)) {
        if (value < CONFIG.WARNING_THRESHOLD) {
          concerns.push(`${CONFIG.METRIC_INFO[name]?.name || name}: ${formatNumber(value)}`);
        }
      }

      if (concerns.length > 0) {
        status.concerns = concerns;
      }

      return status;
    } catch (error) {
      log.errorWithStack('Failed to get quick status', error);
      throw error;
    }
  }

  // ==================== Private Methods ====================

  /**
   * Build summary section of dashboard
   */
  _buildSummary(stats, recentRuns, baseline) {
    const passedRuns = recentRuns.filter((r) => r.summary?.overallPassed).length;
    const failedRuns = recentRuns.length - passedRuns;

    return {
      totalRuns: stats.runCount,
      recentRunsAnalyzed: recentRuns.length,
      passedRuns,
      failedRuns,
      passRate: recentRuns.length > 0 ? (passedRuns / recentRuns.length) * 100 : 0,
      hasBaseline: !!baseline,
      storageBackend: stats.backend,
    };
  }

  /**
   * Format a run for summary display
   */
  _formatRunSummary(run) {
    if (!run) return null;

    return {
      runId: run.runId,
      name: run.name,
      timestamp: run.timestamp,
      passed: run.summary?.overallPassed ?? false,
      keyMetrics: run.summary?.keyMetrics ?? {},
      gitCommit: run.source?.gitCommit,
      gitBranch: run.source?.gitBranch,
    };
  }

  /**
   * Format baseline for summary display
   */
  _formatBaselineSummary(baseline) {
    return {
      name: baseline.name,
      sourceRunId: baseline.sourceRunId,
      timestamp: baseline.sourceRunTimestamp,
      keyMetrics: baseline.keyMetrics,
    };
  }

  /**
   * Format all metric trends for display
   */
  _formatTrends(allTrends) {
    const formatted = {};

    for (const [metricName, trend] of Object.entries(allTrends)) {
      const values = trend.dataPoints.map((dp) => dp.value);
      const info = CONFIG.METRIC_INFO[metricName] || { name: metricName, higher: true };

      formatted[metricName] = {
        displayName: info.name,
        description: info.description,
        sparkline: generateSparkline(values),
        statistics: {
          ...trend.statistics,
          trendIndicator: getTrendIndicator(trend.statistics.trend, info.higher),
          healthIndicator: getHealthIndicator(trend.statistics.latest),
        },
        dataPointCount: trend.dataPoints.length,
      };
    }

    return formatted;
  }

  /**
   * Calculate overall health score based on trends
   */
  _calculateOverallHealth(allTrends) {
    const criticalMetrics = ['mrr', 'answerQuality', 'groundingScore', 'entityF1'];
    let healthScore = 0;
    let metricCount = 0;
    const issues = [];

    for (const metricName of criticalMetrics) {
      const trend = allTrends[metricName];
      if (trend && trend.statistics.latest !== null) {
        const value = trend.statistics.latest;
        healthScore += value;
        metricCount++;

        if (value < CONFIG.WARNING_THRESHOLD) {
          issues.push({
            metric: CONFIG.METRIC_INFO[metricName]?.name || metricName,
            value,
            severity: value < 0.3 ? 'critical' : 'warning',
          });
        }

        if (trend.statistics.trend === 'degrading') {
          issues.push({
            metric: CONFIG.METRIC_INFO[metricName]?.name || metricName,
            issue: 'Degrading trend detected',
            severity: 'warning',
          });
        }
      }
    }

    const overallScore = metricCount > 0 ? healthScore / metricCount : 0;

    return {
      score: overallScore,
      status:
        overallScore >= CONFIG.GOOD_THRESHOLD
          ? 'healthy'
          : overallScore >= CONFIG.WARNING_THRESHOLD
          ? 'warning'
          : 'critical',
      indicator:
        overallScore >= CONFIG.GOOD_THRESHOLD
          ? CONFIG.INDICATORS.PASSED
          : overallScore >= CONFIG.WARNING_THRESHOLD
          ? CONFIG.INDICATORS.WARNING
          : CONFIG.INDICATORS.FAILED,
      issues,
    };
  }

  /**
   * Render dashboard as Markdown
   */
  _renderMarkdown(data) {
    const lines = [];

    // Header
    lines.push('# Evaluation Dashboard');
    lines.push('');
    lines.push(`> Generated: ${new Date(data.generatedAt).toLocaleString()}`);
    lines.push(`> Runs analyzed: ${data.config.runsIncluded} | Branch: ${data.config.gitBranch}`);
    lines.push('');

    // Overall Health
    lines.push('## Overall Health');
    lines.push('');
    lines.push(`**Status:** ${data.health.indicator} ${data.health.status.toUpperCase()}`);
    lines.push(`**Score:** ${formatNumber(data.health.score * 100, 1)}%`);
    lines.push('');

    if (data.health.issues.length > 0) {
      lines.push('### Issues Detected');
      lines.push('');
      for (const issue of data.health.issues) {
        const icon = issue.severity === 'critical' ? '🔴' : '⚠️';
        lines.push(
          `- ${icon} **${issue.metric}**: ${issue.issue || `Value: ${formatNumber(issue.value)}`}`
        );
      }
      lines.push('');
    }

    // Summary Statistics
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total Runs | ${data.summary.totalRuns} |`);
    lines.push(`| Recent Pass Rate | ${formatNumber(data.summary.passRate, 1)}% |`);
    lines.push(`| Passed | ${data.summary.passedRuns} |`);
    lines.push(`| Failed | ${data.summary.failedRuns} |`);
    lines.push(`| Baseline Set | ${data.summary.hasBaseline ? 'Yes' : 'No'} |`);
    lines.push('');

    // Latest Run
    if (data.latestRun) {
      lines.push('## Latest Run');
      lines.push('');
      const passIcon = data.latestRun.passed ? CONFIG.INDICATORS.PASSED : CONFIG.INDICATORS.FAILED;
      lines.push(`**${data.latestRun.name}** ${passIcon}`);
      lines.push(`- Run ID: \`${data.latestRun.runId}\``);
      lines.push(`- Timestamp: ${new Date(data.latestRun.timestamp).toLocaleString()}`);
      if (data.latestRun.gitCommit) {
        lines.push(`- Commit: \`${data.latestRun.gitCommit.substring(0, 8)}\``);
      }
      if (data.latestRun.gitBranch) {
        lines.push(`- Branch: \`${data.latestRun.gitBranch}\``);
      }
      lines.push('');
    }

    // Metric Trends
    lines.push('## Metric Trends');
    lines.push('');
    lines.push('| Metric | Sparkline | Latest | Trend | Mean | Status |');
    lines.push('|--------|-----------|--------|-------|------|--------|');

    for (const [metricName, trend] of Object.entries(data.trends)) {
      if (trend.dataPointCount > 0) {
        lines.push(
          `| ${trend.displayName} | \`${trend.sparkline}\` | ${formatNumber(trend.statistics.latest)} | ${trend.statistics.trendIndicator} ${trend.statistics.trend} | ${formatNumber(trend.statistics.mean)} | ${trend.statistics.healthIndicator} |`
        );
      }
    }
    lines.push('');

    // Baseline Comparison
    if (data.baseline) {
      lines.push('## Baseline');
      lines.push('');
      lines.push(`**${data.baseline.name}**`);
      lines.push(`- Source Run: \`${data.baseline.sourceRunId}\``);
      lines.push(`- Set: ${new Date(data.baseline.timestamp).toLocaleString()}`);
      lines.push('');

      lines.push('### Baseline Metrics');
      lines.push('');
      lines.push('| Metric | Baseline Value |');
      lines.push('|--------|----------------|');
      for (const [name, value] of Object.entries(data.baseline.keyMetrics)) {
        const displayName = CONFIG.METRIC_INFO[name]?.name || name;
        lines.push(`| ${displayName} | ${formatNumber(value)} |`);
      }
      lines.push('');
    }

    // Recent Runs
    if (data.recentRuns && data.recentRuns.length > 0) {
      lines.push('## Recent Runs');
      lines.push('');
      lines.push('| Run | Status | Timestamp | Commit |');
      lines.push('|-----|--------|-----------|--------|');

      for (const run of data.recentRuns) {
        const status = run.passed ? CONFIG.INDICATORS.PASSED : CONFIG.INDICATORS.FAILED;
        const commit = run.gitCommit ? `\`${run.gitCommit.substring(0, 8)}\`` : 'N/A';
        const time = new Date(run.timestamp).toLocaleString();
        lines.push(`| ${run.name} | ${status} | ${time} | ${commit} |`);
      }
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('*Dashboard generated by Evaluation Dashboard Service (F1.3.5)*');

    return lines.join('\n');
  }

  /**
   * Render comparison report as Markdown
   */
  _renderComparisonMarkdown(data) {
    const lines = [];

    // Header
    lines.push('# Baseline Comparison Report');
    lines.push('');
    lines.push(`> Generated: ${new Date(data.generatedAt).toLocaleString()}`);
    lines.push('');

    // Summary
    const summaryIcon = data.summary.hasRegressions
      ? CONFIG.INDICATORS.REGRESSION
      : CONFIG.INDICATORS.IMPROVEMENT;
    lines.push(`## Summary ${summaryIcon}`);
    lines.push('');
    lines.push(`| Category | Count |`);
    lines.push(`|----------|-------|`);
    lines.push(`| 🟢 Improvements | ${data.summary.improvements} |`);
    lines.push(`| 🔴 Regressions | ${data.summary.regressions} |`);
    lines.push(`| ⚪ Unchanged | ${data.summary.unchanged} |`);
    lines.push('');

    // Comparison Details
    lines.push('## Runs Compared');
    lines.push('');
    lines.push(`**Baseline:** ${data.baseline.name} (\`${data.baseline.runId}\`)`);
    lines.push(`**Current:** ${data.current.name} (\`${data.current.runId}\`)`);
    lines.push('');

    // Metric Comparison Table
    lines.push('## Metric Comparison');
    lines.push('');
    lines.push('| Metric | Baseline | Current | Change | Status |');
    lines.push('|--------|----------|---------|--------|--------|');

    for (const metric of data.metrics) {
      const statusIcon =
        metric.status === 'regression'
          ? CONFIG.INDICATORS.REGRESSION
          : metric.status === 'improvement'
          ? CONFIG.INDICATORS.IMPROVEMENT
          : CONFIG.INDICATORS.UNCHANGED;
      lines.push(
        `| ${metric.displayName} | ${formatNumber(metric.baseline)} | ${formatNumber(metric.current)} | ${formatPercentChange(metric.percentChange)} | ${statusIcon} |`
      );
    }
    lines.push('');

    // Regressions
    if (data.regressions.length > 0) {
      lines.push('## ⚠️ Regressions');
      lines.push('');
      lines.push('The following metrics have regressed:');
      lines.push('');
      for (const reg of data.regressions) {
        const displayName = CONFIG.METRIC_INFO[reg.metric]?.name || reg.metric;
        lines.push(
          `- **${displayName}**: ${formatNumber(reg.baseline)} → ${formatNumber(reg.current)} (${formatPercentChange(reg.percentChange)})`
        );
      }
      lines.push('');
    }

    // Improvements
    if (data.improvements.length > 0) {
      lines.push('## 🎉 Improvements');
      lines.push('');
      lines.push('The following metrics have improved:');
      lines.push('');
      for (const imp of data.improvements) {
        const displayName = CONFIG.METRIC_INFO[imp.metric]?.name || imp.metric;
        lines.push(
          `- **${displayName}**: ${formatNumber(imp.baseline)} → ${formatNumber(imp.current)} (${formatPercentChange(imp.percentChange)})`
        );
      }
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('*Report generated by Evaluation Dashboard Service (F1.3.5)*');

    return lines.join('\n');
  }
}

// Singleton instance
let instance = null;

function getDashboardService() {
  if (!instance) {
    instance = new DashboardService();
  }
  return instance;
}

module.exports = {
  DashboardService,
  getDashboardService,
  generateSparkline,
  CONFIG,
};
