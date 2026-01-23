/**
 * Audit Export Service
 *
 * Provides functionality to export audit logs to various formats (CSV, JSON)
 * for compliance reporting and analysis.
 *
 * Features:
 * - F5.1.5: Audit Log Export
 *   - Export to CSV format with proper escaping
 *   - Export to JSON format (array or newline-delimited)
 *   - Filtering by date range, action, entity type, user
 *   - File output to configurable directory
 *   - Scheduled periodic exports
 *   - Export job status tracking
 *
 * @module services/audit-export-service
 */

const fs = require('fs').promises;
const path = require('path');
const { log } = require('../utils/logger');
const { trackEvent } = require('../utils/telemetry');
const { getConfig, getConfigurationService } = require('./configuration-service');
const { getAuditPersistenceService } = require('./audit-persistence-service');

/**
 * Export formats supported
 */
const EXPORT_FORMATS = {
  CSV: 'csv',
  JSON: 'json',
  NDJSON: 'ndjson', // Newline-delimited JSON
};

/**
 * Export job status values
 */
const EXPORT_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/**
 * CSV columns for export
 */
const CSV_COLUMNS = [
  'id',
  'timestamp',
  'action',
  'entityType',
  'entityId',
  'userId',
  'userName',
  'userEmail',
  'details',
];

/**
 * Escape a value for CSV format
 * @param {*} value - Value to escape
 * @returns {string} - CSV-safe string
 */
function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }

  // Convert objects to JSON string
  if (typeof value === 'object') {
    value = JSON.stringify(value);
  }

  // Convert to string
  const str = String(value);

  // If contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Convert audit log entry to CSV row
 * @param {Object} entry - Audit log entry
 * @returns {string} - CSV row
 */
function toCSVRow(entry) {
  return CSV_COLUMNS.map((col) => escapeCSV(entry[col])).join(',');
}

/**
 * Generate export filename
 * @param {string} format - Export format
 * @param {Date} startDate - Start date filter
 * @param {Date} endDate - End date filter
 * @returns {string} - Filename
 */
function generateFilename(format, startDate, endDate) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  let dateRange = '';
  if (startDate && endDate) {
    const start = new Date(startDate).toISOString().slice(0, 10);
    const end = new Date(endDate).toISOString().slice(0, 10);
    dateRange = `_${start}_to_${end}`;
  } else if (startDate) {
    const start = new Date(startDate).toISOString().slice(0, 10);
    dateRange = `_from_${start}`;
  } else if (endDate) {
    const end = new Date(endDate).toISOString().slice(0, 10);
    dateRange = `_until_${end}`;
  }

  const extension = format === EXPORT_FORMATS.NDJSON ? 'ndjson' : format;
  return `audit-export_${timestamp}${dateRange}.${extension}`;
}

/**
 * Audit Export Service
 */
class AuditExportService {
  constructor() {
    this.jobs = new Map(); // Track export jobs
    this.scheduledJobs = new Map(); // Track scheduled exports
    this.nextJobId = 1;
  }

  /**
   * Get the export directory path
   * @returns {string} - Absolute path to export directory
   */
  getExportDirectory() {
    const configDir = getConfig('AUDIT_LOG_ARCHIVE_DIR') || 'audit-archives';
    // If absolute path, use as-is; otherwise, relative to cwd
    if (path.isAbsolute(configDir)) {
      return configDir;
    }
    return path.join(process.cwd(), configDir);
  }

  /**
   * Ensure export directory exists
   */
  async ensureExportDirectory() {
    const dir = this.getExportDirectory();
    try {
      await fs.mkdir(dir, { recursive: true });
      return dir;
    } catch (error) {
      log.errorWithStack('Failed to create export directory', error);
      throw new Error(`Failed to create export directory: ${error.message}`);
    }
  }

  /**
   * Export audit logs to a specified format
   *
   * @param {Object} options - Export options
   * @param {string} options.format - Export format ('csv', 'json', 'ndjson')
   * @param {Date} [options.startDate] - Filter: logs after this date
   * @param {Date} [options.endDate] - Filter: logs before this date
   * @param {string} [options.action] - Filter: specific action type
   * @param {string} [options.entityType] - Filter: specific entity type
   * @param {string} [options.userId] - Filter: specific user ID
   * @param {number} [options.limit] - Max records to export (default: 10000)
   * @param {boolean} [options.saveToFile] - Save to file (default: false, returns content)
   * @param {string} [options.filename] - Custom filename (auto-generated if not provided)
   * @returns {Promise<Object>} - Export result with content or file path
   */
  async exportLogs(options = {}) {
    const {
      format = EXPORT_FORMATS.JSON,
      startDate,
      endDate,
      action,
      entityType,
      userId,
      limit = 10000,
      saveToFile = false,
      filename: customFilename,
    } = options;

    // Validate format
    if (!Object.values(EXPORT_FORMATS).includes(format)) {
      throw new Error(`Invalid export format: ${format}. Supported: ${Object.values(EXPORT_FORMATS).join(', ')}`);
    }

    const jobId = this._createJob({
      format,
      startDate,
      endDate,
      action,
      entityType,
      userId,
      limit,
      saveToFile,
    });

    try {
      this._updateJobStatus(jobId, EXPORT_STATUS.IN_PROGRESS);

      // Query audit logs
      const auditService = getAuditPersistenceService();
      const logs = await auditService.queryLogs({
        startDate,
        endDate,
        action,
        entityType,
        userId,
        limit,
      });

      // Generate content based on format
      let content;
      let contentType;

      switch (format) {
        case EXPORT_FORMATS.CSV:
          content = this._formatAsCSV(logs);
          contentType = 'text/csv';
          break;
        case EXPORT_FORMATS.NDJSON:
          content = this._formatAsNDJSON(logs);
          contentType = 'application/x-ndjson';
          break;
        case EXPORT_FORMATS.JSON:
        default:
          content = this._formatAsJSON(logs);
          contentType = 'application/json';
          break;
      }

      const result = {
        jobId,
        format,
        recordCount: logs.length,
        contentType,
        exportedAt: new Date().toISOString(),
        filters: {
          startDate: startDate ? new Date(startDate).toISOString() : null,
          endDate: endDate ? new Date(endDate).toISOString() : null,
          action,
          entityType,
          userId,
          limit,
        },
      };

      // Save to file if requested
      if (saveToFile) {
        const dir = await this.ensureExportDirectory();
        const filename = customFilename || generateFilename(format, startDate, endDate);
        const filePath = path.join(dir, filename);

        await fs.writeFile(filePath, content, 'utf8');

        result.filePath = filePath;
        result.filename = filename;
        result.fileSize = Buffer.byteLength(content, 'utf8');

        log.info('Audit logs exported to file', {
          filePath,
          recordCount: logs.length,
          format,
          fileSize: result.fileSize,
        });

        trackEvent('audit_export_file', {
          format,
          recordCount: logs.length,
          fileSize: result.fileSize,
        });
      } else {
        result.content = content;
      }

      this._updateJobStatus(jobId, EXPORT_STATUS.COMPLETED, result);

      return result;
    } catch (error) {
      this._updateJobStatus(jobId, EXPORT_STATUS.FAILED, { error: error.message });
      log.errorWithStack('Audit log export failed', error);
      throw error;
    }
  }

  /**
   * Export logs as a downloadable stream (for large exports)
   *
   * @param {Object} options - Export options (same as exportLogs)
   * @param {Object} res - Express response object
   */
  async streamExport(options, res) {
    const {
      format = EXPORT_FORMATS.JSON,
      startDate,
      endDate,
      action,
      entityType,
      userId,
      limit = 10000,
    } = options;

    // Validate format
    if (!Object.values(EXPORT_FORMATS).includes(format)) {
      throw new Error(`Invalid export format: ${format}`);
    }

    // Query logs
    const auditService = getAuditPersistenceService();
    const logs = await auditService.queryLogs({
      startDate,
      endDate,
      action,
      entityType,
      userId,
      limit,
    });

    // Set response headers
    const filename = generateFilename(format, startDate, endDate);
    let contentType;

    switch (format) {
      case EXPORT_FORMATS.CSV:
        contentType = 'text/csv';
        break;
      case EXPORT_FORMATS.NDJSON:
        contentType = 'application/x-ndjson';
        break;
      case EXPORT_FORMATS.JSON:
      default:
        contentType = 'application/json';
        break;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream content
    switch (format) {
      case EXPORT_FORMATS.CSV:
        res.write(CSV_COLUMNS.join(',') + '\n');
        for (const log of logs) {
          res.write(toCSVRow(log) + '\n');
        }
        break;
      case EXPORT_FORMATS.NDJSON:
        for (const log of logs) {
          res.write(JSON.stringify(log) + '\n');
        }
        break;
      case EXPORT_FORMATS.JSON:
      default:
        res.write(JSON.stringify(logs, null, 2));
        break;
    }

    res.end();

    trackEvent('audit_export_stream', {
      format,
      recordCount: logs.length,
    });
  }

  /**
   * Schedule a periodic export job
   *
   * @param {Object} options - Schedule options
   * @param {string} options.name - Unique name for this schedule
   * @param {string} options.format - Export format
   * @param {number} options.intervalHours - Hours between exports
   * @param {Object} [options.filters] - Filters to apply
   * @returns {Object} - Schedule info
   */
  scheduleExport(options) {
    const {
      name,
      format = EXPORT_FORMATS.JSON,
      intervalHours = 24,
      filters = {},
    } = options;

    if (!name) {
      throw new Error('Schedule name is required');
    }

    if (this.scheduledJobs.has(name)) {
      throw new Error(`Schedule '${name}' already exists. Remove it first.`);
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    const job = {
      name,
      format,
      intervalHours,
      intervalMs,
      filters,
      createdAt: new Date().toISOString(),
      lastRun: null,
      nextRun: new Date(Date.now() + intervalMs).toISOString(),
      runCount: 0,
      lastResult: null,
    };

    // Create the interval
    const intervalId = setInterval(async () => {
      await this._runScheduledExport(name);
    }, intervalMs);

    job.intervalId = intervalId;
    this.scheduledJobs.set(name, job);

    log.info('Scheduled audit export created', {
      name,
      format,
      intervalHours,
    });

    trackEvent('audit_export_scheduled', {
      name,
      format,
      intervalHours,
    });

    return {
      name: job.name,
      format: job.format,
      intervalHours: job.intervalHours,
      nextRun: job.nextRun,
      createdAt: job.createdAt,
    };
  }

  /**
   * Run a scheduled export immediately
   * @param {string} name - Schedule name
   */
  async runScheduledExportNow(name) {
    if (!this.scheduledJobs.has(name)) {
      throw new Error(`Schedule '${name}' not found`);
    }

    return this._runScheduledExport(name);
  }

  /**
   * Remove a scheduled export
   * @param {string} name - Schedule name
   */
  removeScheduledExport(name) {
    const job = this.scheduledJobs.get(name);
    if (!job) {
      throw new Error(`Schedule '${name}' not found`);
    }

    clearInterval(job.intervalId);
    this.scheduledJobs.delete(name);

    log.info('Scheduled audit export removed', { name });

    return { removed: true, name };
  }

  /**
   * Get all scheduled exports
   * @returns {Object[]} - List of scheduled exports
   */
  getScheduledExports() {
    const schedules = [];
    for (const [name, job] of this.scheduledJobs) {
      schedules.push({
        name: job.name,
        format: job.format,
        intervalHours: job.intervalHours,
        filters: job.filters,
        createdAt: job.createdAt,
        lastRun: job.lastRun,
        nextRun: job.nextRun,
        runCount: job.runCount,
        lastResult: job.lastResult
          ? {
              status: job.lastResult.status,
              recordCount: job.lastResult.recordCount,
              filePath: job.lastResult.filePath,
            }
          : null,
      });
    }
    return schedules;
  }

  /**
   * Get export job status
   * @param {number} jobId - Job ID
   * @returns {Object|null} - Job status
   */
  getJobStatus(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Get recent export jobs
   * @param {number} limit - Max jobs to return
   * @returns {Object[]} - Recent jobs
   */
  getRecentJobs(limit = 20) {
    const jobs = Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
    return jobs;
  }

  /**
   * Get export statistics
   * @returns {Object} - Export statistics
   */
  getStatistics() {
    const jobs = Array.from(this.jobs.values());
    const completed = jobs.filter((j) => j.status === EXPORT_STATUS.COMPLETED);
    const failed = jobs.filter((j) => j.status === EXPORT_STATUS.FAILED);

    const totalRecords = completed.reduce((sum, j) => sum + (j.result?.recordCount || 0), 0);
    const totalSize = completed.reduce((sum, j) => sum + (j.result?.fileSize || 0), 0);

    return {
      totalJobs: jobs.length,
      completedJobs: completed.length,
      failedJobs: failed.length,
      pendingJobs: jobs.filter((j) => j.status === EXPORT_STATUS.PENDING || j.status === EXPORT_STATUS.IN_PROGRESS).length,
      totalRecordsExported: totalRecords,
      totalBytesExported: totalSize,
      scheduledExports: this.scheduledJobs.size,
      exportDirectory: this.getExportDirectory(),
    };
  }

  /**
   * List files in export directory
   * @returns {Promise<Object[]>} - List of export files
   */
  async listExportFiles() {
    const dir = this.getExportDirectory();

    try {
      const files = await fs.readdir(dir);
      const fileInfos = [];

      for (const filename of files) {
        if (filename.startsWith('audit-export')) {
          const filePath = path.join(dir, filename);
          const stats = await fs.stat(filePath);
          fileInfos.push({
            filename,
            path: filePath,
            size: stats.size,
            createdAt: stats.birthtime.toISOString(),
            modifiedAt: stats.mtime.toISOString(),
          });
        }
      }

      // Sort by creation date, newest first
      fileInfos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return fileInfos;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Delete an export file
   * @param {string} filename - Filename to delete
   * @returns {Promise<boolean>} - True if deleted
   */
  async deleteExportFile(filename) {
    // Security: Only allow deleting files that start with 'audit-export'
    if (!filename.startsWith('audit-export')) {
      throw new Error('Invalid filename. Can only delete audit export files.');
    }

    const dir = this.getExportDirectory();
    const filePath = path.join(dir, filename);

    try {
      await fs.unlink(filePath);
      log.info('Audit export file deleted', { filename, filePath });
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  // Private methods

  /**
   * Create a new export job
   * @private
   */
  _createJob(options) {
    const jobId = this.nextJobId++;
    this.jobs.set(jobId, {
      id: jobId,
      status: EXPORT_STATUS.PENDING,
      options,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: null,
    });

    // Cleanup old jobs (keep last 100)
    if (this.jobs.size > 100) {
      const oldest = Array.from(this.jobs.keys())
        .sort((a, b) => a - b)
        .slice(0, this.jobs.size - 100);
      oldest.forEach((id) => this.jobs.delete(id));
    }

    return jobId;
  }

  /**
   * Update job status
   * @private
   */
  _updateJobStatus(jobId, status, result = null) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      job.updatedAt = new Date().toISOString();
      if (result) {
        job.result = result;
      }
    }
  }

  /**
   * Format logs as CSV
   * @private
   */
  _formatAsCSV(logs) {
    const header = CSV_COLUMNS.join(',');
    const rows = logs.map(toCSVRow);
    return [header, ...rows].join('\n');
  }

  /**
   * Format logs as JSON
   * @private
   */
  _formatAsJSON(logs) {
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Format logs as newline-delimited JSON
   * @private
   */
  _formatAsNDJSON(logs) {
    return logs.map((log) => JSON.stringify(log)).join('\n');
  }

  /**
   * Run a scheduled export
   * @private
   */
  async _runScheduledExport(name) {
    const job = this.scheduledJobs.get(name);
    if (!job) {
      return;
    }

    log.info('Running scheduled audit export', { name });

    try {
      // Calculate date range for this interval
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - job.intervalMs);

      const result = await this.exportLogs({
        format: job.format,
        startDate,
        endDate,
        ...job.filters,
        saveToFile: true,
      });

      job.lastRun = new Date().toISOString();
      job.nextRun = new Date(Date.now() + job.intervalMs).toISOString();
      job.runCount++;
      job.lastResult = {
        status: 'success',
        recordCount: result.recordCount,
        filePath: result.filePath,
        exportedAt: result.exportedAt,
      };

      log.info('Scheduled audit export completed', {
        name,
        recordCount: result.recordCount,
        filePath: result.filePath,
      });

      return result;
    } catch (error) {
      job.lastRun = new Date().toISOString();
      job.nextRun = new Date(Date.now() + job.intervalMs).toISOString();
      job.lastResult = {
        status: 'failed',
        error: error.message,
        failedAt: new Date().toISOString(),
      };

      log.error('Scheduled audit export failed', { name, error: error.message });
      throw error;
    }
  }

  /**
   * Start default scheduled export based on configuration
   */
  startDefaultSchedule() {
    const archiveEnabled = getConfig('AUDIT_LOG_ARCHIVE_ENABLED');

    if (!archiveEnabled) {
      log.info('Audit log archiving is disabled');
      return null;
    }

    const sweepHours = getConfig('AUDIT_LOG_RETENTION_SWEEP_HOURS') || 24;

    // Check if default schedule already exists
    if (this.scheduledJobs.has('default-archive')) {
      log.info('Default audit archive schedule already exists');
      return this.scheduledJobs.get('default-archive');
    }

    return this.scheduleExport({
      name: 'default-archive',
      format: EXPORT_FORMATS.JSON,
      intervalHours: sweepHours,
      filters: {},
    });
  }

  /**
   * Shutdown all scheduled exports
   */
  shutdown() {
    for (const [name, job] of this.scheduledJobs) {
      clearInterval(job.intervalId);
      log.info('Stopped scheduled audit export', { name });
    }
    this.scheduledJobs.clear();
  }

  /**
   * Reset service (for testing)
   */
  reset() {
    this.shutdown();
    this.jobs.clear();
    this.nextJobId = 1;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the audit export service instance
 * @returns {AuditExportService}
 */
function getAuditExportService() {
  if (!instance) {
    instance = new AuditExportService();
  }
  return instance;
}

module.exports = {
  AuditExportService,
  getAuditExportService,
  EXPORT_FORMATS,
  EXPORT_STATUS,
  CSV_COLUMNS,
};
