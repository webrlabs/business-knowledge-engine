/**
 * PII Redaction Service
 *
 * Detects and redacts Personally Identifiable Information (PII) from text content.
 * Supports multiple PII categories with configurable redaction policies.
 *
 * Usage:
 *   const { getPIIRedactionService } = require('./pii-redaction-service');
 *   const piiService = getPIIRedactionService();
 *   const redactedText = piiService.redact(text);
 */

// PII pattern definitions - ORDER MATTERS (more specific patterns first)
const PII_PATTERNS = {
  // Credit card numbers (16 digits, must match first before phone/SSN)
  creditCard: {
    pattern: /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    replacement: '[CREDIT CARD REDACTED]',
    category: 'financial',
    severity: 'critical',
    priority: 1, // Process first
  },

  // Social Security Numbers (US) - 9 digits in 3-2-4 pattern
  ssn: {
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    replacement: '[SSN REDACTED]',
    category: 'government_id',
    severity: 'critical',
    priority: 2,
  },

  // Email addresses
  email: {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    replacement: '[EMAIL REDACTED]',
    category: 'contact',
    severity: 'medium',
    priority: 3,
  },

  // Phone numbers (various formats)
  phone: {
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[PHONE REDACTED]',
    category: 'contact',
    severity: 'medium',
    priority: 4,
  },

  // IP addresses (IPv4)
  ipv4: {
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    replacement: '[IP ADDRESS REDACTED]',
    category: 'technical',
    severity: 'low',
  },

  // Date of birth patterns (various formats)
  dateOfBirth: {
    pattern: /\b(?:DOB|Date of Birth|Born|Birthday)[\s:]*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/gi,
    replacement: '[DOB REDACTED]',
    category: 'personal',
    severity: 'high',
  },

  // Passport numbers (generic pattern)
  passport: {
    pattern: /\b(?:passport[\s#:]*)?[A-Z]{1,2}\d{6,9}\b/gi,
    replacement: '[PASSPORT REDACTED]',
    category: 'government_id',
    severity: 'critical',
  },

  // Driver's license patterns (US format - varies by state)
  driversLicense: {
    pattern: /\b(?:DL|Driver'?s?\s*License)[\s#:]*[A-Z0-9]{5,15}\b/gi,
    replacement: '[DRIVERS LICENSE REDACTED]',
    category: 'government_id',
    severity: 'high',
  },

  // Bank account numbers (generic)
  bankAccount: {
    pattern: /\b(?:account|acct)[\s#:]*\d{8,17}\b/gi,
    replacement: '[BANK ACCOUNT REDACTED]',
    category: 'financial',
    severity: 'critical',
  },

  // Medicare/Medicaid numbers
  medicareId: {
    pattern: /\b\d{3}-?\d{2}-?\d{4}-?[A-Z]\b/g,
    replacement: '[MEDICARE ID REDACTED]',
    category: 'healthcare',
    severity: 'high',
  },

  // Street addresses (basic pattern)
  streetAddress: {
    pattern: /\b\d+\s+[A-Za-z]+(?:\s+[A-Za-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\b\.?/gi,
    replacement: '[ADDRESS REDACTED]',
    category: 'contact',
    severity: 'medium',
  },

  // ZIP codes (US)
  zipCode: {
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
    replacement: '[ZIP REDACTED]',
    category: 'contact',
    severity: 'low',
    // Only redact when preceded by location context
    contextRequired: /(?:zip|postal|code|address)/i,
  },
};

// Severity levels for filtering
const SEVERITY_LEVELS = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

class PIIRedactionService {
  constructor(options = {}) {
    this.enabled = options.enabled !== false && process.env.ENABLE_PII_REDACTION !== 'false';
    this.minSeverity = options.minSeverity || 'low';
    this.categories = options.categories || null; // null = all categories
    this.customPatterns = options.customPatterns || [];
    this.auditMode = options.auditMode || false; // Log detections without redacting
    this.preserveFormat = options.preserveFormat || false; // Keep character positions
  }

  /**
   * Redact PII from text content
   * @param {string} text - Input text to redact
   * @param {Object} options - Optional per-call overrides
   * @returns {Object} - { redactedText, detections }
   */
  redact(text, options = {}) {
    if (!this.enabled && !options.forceEnabled) {
      return { redactedText: text, detections: [], redactionApplied: false };
    }

    if (!text || typeof text !== 'string') {
      return { redactedText: text, detections: [], redactionApplied: false };
    }

    const detections = [];
    let redactedText = text;
    const minSeverityLevel = SEVERITY_LEVELS[options.minSeverity || this.minSeverity];
    const categories = options.categories || this.categories;

    // Sort patterns by priority (lower number = higher priority)
    const sortedPatterns = Object.entries(PII_PATTERNS).sort(
      ([, a], [, b]) => (a.priority || 99) - (b.priority || 99)
    );

    // Track positions that have been redacted to avoid overlapping
    const redactedRanges = [];

    // Apply built-in patterns in priority order
    for (const [name, config] of sortedPatterns) {
      // Check severity threshold
      if (SEVERITY_LEVELS[config.severity] < minSeverityLevel) {
        continue;
      }

      // Check category filter
      if (categories && !categories.includes(config.category)) {
        continue;
      }

      // Check context requirement if present
      if (config.contextRequired && !config.contextRequired.test(text)) {
        continue;
      }

      // Find all matches in original text
      const matches = [...text.matchAll(new RegExp(config.pattern.source, config.pattern.flags))];

      for (const match of matches) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;

        // Check if this position overlaps with an already-redacted range
        const isOverlapping = redactedRanges.some(
          (range) => matchStart < range.end && matchEnd > range.start
        );

        if (!isOverlapping) {
          detections.push({
            type: name,
            category: config.category,
            severity: config.severity,
            position: matchStart,
            length: match[0].length,
            // Only include original value in audit mode
            ...(this.auditMode && { original: match[0] }),
          });

          // Track this range as redacted
          redactedRanges.push({ start: matchStart, end: matchEnd, replacement: config.replacement });
        }
      }
    }

    // Apply all redactions from end to start to preserve positions
    if (!this.auditMode) {
      // Sort by position descending so we don't mess up indices
      redactedRanges.sort((a, b) => b.start - a.start);

      for (const range of redactedRanges) {
        const before = redactedText.slice(0, range.start);
        const after = redactedText.slice(range.end);

        if (this.preserveFormat) {
          const originalLength = range.end - range.start;
          if (originalLength > range.replacement.length) {
            redactedText = before + range.replacement + '*'.repeat(originalLength - range.replacement.length) + after;
          } else {
            redactedText = before + range.replacement.substring(0, originalLength) + after;
          }
        } else {
          redactedText = before + range.replacement + after;
        }
      }
    }

    // Apply custom patterns (after built-in patterns)
    const customRanges = [];
    for (const customPattern of this.customPatterns) {
      const matches = [...text.matchAll(new RegExp(customPattern.pattern.source, customPattern.pattern.flags))];

      for (const match of matches) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;

        // Check overlap with both built-in and other custom ranges
        const isOverlapping = [...redactedRanges, ...customRanges].some(
          (range) => matchStart < range.end && matchEnd > range.start
        );

        if (!isOverlapping) {
          detections.push({
            type: customPattern.name || 'custom',
            category: customPattern.category || 'custom',
            severity: customPattern.severity || 'medium',
            position: matchStart,
            length: match[0].length,
          });

          customRanges.push({
            start: matchStart,
            end: matchEnd,
            replacement: customPattern.replacement || '[CUSTOM REDACTED]',
          });
        }
      }
    }

    // Apply custom redactions
    if (!this.auditMode && customRanges.length > 0) {
      customRanges.sort((a, b) => b.start - a.start);
      for (const range of customRanges) {
        const before = redactedText.slice(0, range.start);
        const after = redactedText.slice(range.end);
        redactedText = before + range.replacement + after;
      }
    }

    return {
      redactedText,
      detections,
      redactionApplied: detections.length > 0 && !this.auditMode,
      summary: this._generateSummary(detections),
    };
  }

  /**
   * Redact PII from an object (recursively)
   * @param {Object} obj - Object to redact
   * @param {Array} fields - Specific fields to redact (optional)
   * @returns {Object} - Redacted object
   */
  redactObject(obj, fields = null) {
    if (!this.enabled) {
      return { redactedObject: obj, totalDetections: 0 };
    }

    if (!obj || typeof obj !== 'object') {
      return { redactedObject: obj, totalDetections: 0 };
    }

    let totalDetections = 0;
    const redactedObject = this._redactRecursive(obj, fields, (count) => {
      totalDetections += count;
    });

    return { redactedObject, totalDetections };
  }

  _redactRecursive(obj, fields, onDetect) {
    if (Array.isArray(obj)) {
      return obj.map((item) => this._redactRecursive(item, fields, onDetect));
    }

    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        // Check if this field should be redacted
        if (fields === null || fields.includes(key)) {
          if (typeof value === 'string') {
            const { redactedText, detections } = this.redact(value);
            result[key] = redactedText;
            onDetect(detections.length);
          } else {
            result[key] = this._redactRecursive(value, fields, onDetect);
          }
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    return obj;
  }

  /**
   * Check if text contains PII without redacting
   * @param {string} text - Text to check
   * @returns {Object} - { containsPII, detections }
   */
  detect(text) {
    const originalAuditMode = this.auditMode;
    this.auditMode = true;

    const result = this.redact(text);

    this.auditMode = originalAuditMode;

    return {
      containsPII: result.detections.length > 0,
      detections: result.detections,
      summary: result.summary,
    };
  }

  /**
   * Generate summary of detections
   */
  _generateSummary(detections) {
    const byCategory = {};
    const bySeverity = {};

    for (const detection of detections) {
      byCategory[detection.category] = (byCategory[detection.category] || 0) + 1;
      bySeverity[detection.severity] = (bySeverity[detection.severity] || 0) + 1;
    }

    return {
      totalDetections: detections.length,
      byCategory,
      bySeverity,
      hasCritical: bySeverity.critical > 0,
    };
  }

  /**
   * Add a custom pattern
   * @param {Object} pattern - { name, pattern, replacement, category, severity }
   */
  addPattern(pattern) {
    if (!pattern.pattern || !(pattern.pattern instanceof RegExp)) {
      throw new Error('Pattern must be a RegExp');
    }
    this.customPatterns.push(pattern);
  }

  /**
   * Check if redaction is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Enable/disable redaction
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

// Singleton instance
let instance = null;

function getPIIRedactionService(options = {}) {
  if (!instance) {
    instance = new PIIRedactionService(options);
  }
  return instance;
}

// Factory function for creating new instances (for testing)
function createPIIRedactionService(options = {}) {
  return new PIIRedactionService(options);
}

module.exports = {
  PIIRedactionService,
  getPIIRedactionService,
  createPIIRedactionService,
  PII_PATTERNS,
  SEVERITY_LEVELS,
};
