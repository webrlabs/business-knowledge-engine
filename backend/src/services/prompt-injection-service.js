/**
 * Prompt Injection Detection Service
 *
 * Implements multi-layered defense against prompt injection attacks:
 * 1. Pattern-based detection using regex for known attack signatures
 * 2. Heuristic scoring for suspicious language patterns
 * 3. Context-aware analysis for multi-message conversations
 *
 * Based on OWASP LLM01:2025 Prompt Injection guidelines and
 * Microsoft Prompt Shields defense-in-depth strategy.
 *
 * @see https://genai.owasp.org/llmrisk/llm01-prompt-injection/
 */

const { log } = require('../utils/telemetry');

// Detection severity levels
const SEVERITY = {
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

// Actions to take when injection is detected
const ACTION = {
  ALLOW: 'allow',
  WARN: 'warn',
  SANITIZE: 'sanitize',
  BLOCK: 'block',
};

/**
 * Known attack pattern categories with associated regex patterns
 * Based on research from Microsoft, OWASP, and security literature
 */
const ATTACK_PATTERNS = {
  // Direct instruction override attempts
  instructionOverride: {
    severity: SEVERITY.HIGH,
    patterns: [
      /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?|guidelines?)/i,
      /disregard\s+(?:all\s+)?(?:your\s+)?(?:previous|prior|above|earlier)?\s*(?:instructions?|prompts?|rules?|guidelines?)/i,
      /forget\s+(?:all\s+)?(?:everything\s+)?(?:you\s+were\s+told|previous|prior|above|earlier|your)\s*(?:instructions?|prompts?|context|before)?/i,
      /override\s+(?:all\s+)?(?:your\s+)?(?:previous|prior|system)?\s*(?:instructions?|prompts?|rules?)/i,
      /do\s+not\s+follow\s+(?:your\s+)?(?:the\s+)?(?:previous\s+)?(?:instructions?|rules?|guidelines?)/i,
      /stop\s+being\s+(?:an?\s+)?(?:assistant|AI|helpful)/i,
    ],
    description: 'Attempts to override system instructions',
  },

  // System prompt extraction attempts
  systemPromptExtraction: {
    severity: SEVERITY.HIGH,
    patterns: [
      /what\s+(?:are|is)\s+(?:your|the)\s+system\s+(?:prompt|instructions?|rules?)/i,
      /show\s+me\s+(?:your|the)\s+system\s+(?:prompt|instructions?|message)/i,
      /reveal\s+(?:your|the)\s+(?:system|hidden|secret)\s+(?:prompt|instructions?)/i,
      /repeat\s+(?:your|the)\s+(?:system|initial|original)\s+(?:prompt|instructions?|message)/i,
      /print\s+(?:your|the)\s+system\s+(?:prompt|instructions?|message)/i,
      /output\s+(?:your|the)\s+(?:system|initial)\s+(?:prompt|instructions?)/i,
      /tell\s+me\s+your\s+(?:system\s+)?(?:prompt|instructions?|rules?)/i,
      /what\s+were\s+you\s+(?:told|instructed|programmed)\s+to\s+do/i,
    ],
    description: 'Attempts to extract system prompt',
  },

  // Role-play manipulation
  rolePlayManipulation: {
    severity: SEVERITY.MEDIUM,
    patterns: [
      /you\s+are\s+now\s+(?:a|an)\s+\w+/i,
      /pretend\s+(?:you\s+are|to\s+be)\s+(?:a|an)\s+/i,
      /act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:a|an)\s+/i,
      /roleplay\s+as\s+(?:a|an)\s+/i,
      /assume\s+the\s+(?:role|identity|persona)\s+of/i,
      /from\s+now\s+on\s+you\s+(?:are|will\s+be)/i,
      /switch\s+(?:to|into)\s+(?:a|an)\s+(?:different|new)\s+(?:mode|persona|role)/i,
    ],
    description: 'Attempts to change AI behavior through role-play',
  },

  // Delimiter injection
  delimiterInjection: {
    severity: SEVERITY.MEDIUM,
    patterns: [
      /```\s*system/i,
      /\[\s*system\s*\]/i,
      /<\/?system>/i,
      /###\s*SYSTEM/i,
      /---\s*system\s*---/i,
      /\|\|\s*system\s*\|\|/i,
      /={3,}\s*system\s*={3,}/i,
    ],
    description: 'Attempts to inject fake system delimiters',
  },

  // Code execution attempts
  codeExecution: {
    severity: SEVERITY.CRITICAL,
    patterns: [
      /execute\s+(?:the\s+following\s+)?(?:code|script|command)/i,
      /run\s+(?:this|the\s+following)\s+(?:code|script|command)/i,
      /\beval\s*\(/i,
      /\bexec\s*\(/i,
      /\bsystem\s*\([^)]*\)/i,
      /\bsubprocess\b/i,
      /\bos\.system\b/i,
      /\bchild_process\b/i,
      /__import__/i,
    ],
    description: 'Attempts to execute code',
  },

  // Data exfiltration attempts
  dataExfiltration: {
    severity: SEVERITY.HIGH,
    patterns: [
      /send\s+(?:this|the)\s+(?:data|information|content)\s+to/i,
      /upload\s+(?:this|the)\s+(?:data|content)\s+to/i,
      /fetch\s+from\s+https?:\/\//i,
      /make\s+(?:a|an)\s+(?:http|api)\s+(?:request|call)\s+to/i,
      /\bcurl\s+https?:\/\//i,
      /\bwget\s+https?:\/\//i,
      /\bexfiltrate\b/i,
    ],
    description: 'Attempts to exfiltrate data',
  },

  // Jailbreak phrases
  jailbreakPhrases: {
    severity: SEVERITY.HIGH,
    patterns: [
      /\bDAN\s+mode\b/i,
      /\bDeveloper\s+Mode\b/i,
      /\bjailbreak\b/i,
      /bypass\s+(?:the\s+)?(?:safety|security|content|ethical)\s+(?:filters?|measures?|restrictions?)/i,
      /disable\s+(?:your|the)\s+(?:safety|security|content)\s+(?:filters?|measures?)/i,
      /remove\s+(?:your|the)\s+(?:restrictions?|limitations?|guardrails?)/i,
      /without\s+(?:any\s+)?(?:restrictions?|limitations?|filters?)/i,
      /\bunrestricted\s+mode\b/i,
    ],
    description: 'Known jailbreak phrases and techniques',
  },

  // Prompt leaking via completion
  promptLeaking: {
    severity: SEVERITY.MEDIUM,
    patterns: [
      /complete\s+(?:this|the)\s+(?:sentence|prompt|instruction)/i,
      /continue\s+(?:from|with)\s+["'][^"']*system/i,
      /finish\s+(?:this|the)\s+(?:sentence|thought|prompt)/i,
      /what\s+comes\s+(?:after|before)\s+["']/i,
      /system\s+prompt\s+says/i,
    ],
    description: 'Attempts to leak prompts via completion',
  },

  // Indirect injection markers
  indirectInjection: {
    severity: SEVERITY.MEDIUM,
    patterns: [
      /\[AI:\s*ignore/i,
      /<!--\s*instruction/i,
      /IMPORTANT:\s*ignore\s+(?:the\s+)?(?:above|previous)/i,
      /\[hidden\s+instruction\]/i,
      /BEGIN\s+INJECTION/i,
      /START\s+OVERRIDE/i,
    ],
    description: 'Markers for indirect prompt injection',
  },
};

/**
 * Heuristic indicators that may suggest prompt injection
 * These are weighted and combined for overall risk score
 */
const HEURISTIC_INDICATORS = [
  { pattern: /\bsystem\s+prompt\b/i, weight: 0.3, name: 'system_prompt_mention' },
  { pattern: /\bprevious\s+instructions?\b/i, weight: 0.2, name: 'previous_instructions_mention' },
  { pattern: /\bignore\b/i, weight: 0.15, name: 'ignore_keyword' },
  { pattern: /\boverride\b/i, weight: 0.2, name: 'override_keyword' },
  { pattern: /\bdisregard\b/i, weight: 0.2, name: 'disregard_keyword' },
  { pattern: /\bforget\b/i, weight: 0.1, name: 'forget_keyword' },
  { pattern: /\bpretend\b/i, weight: 0.15, name: 'pretend_keyword' },
  { pattern: /\broleplay\b/i, weight: 0.1, name: 'roleplay_keyword' },
  { pattern: /\bjailbreak\b/i, weight: 0.5, name: 'jailbreak_keyword' },
  { pattern: /\bbypass\b/i, weight: 0.2, name: 'bypass_keyword' },
  { pattern: /\bunrestricted\b/i, weight: 0.2, name: 'unrestricted_keyword' },
  { pattern: /\bhack\b/i, weight: 0.1, name: 'hack_keyword' },
  { pattern: /\bexploit\b/i, weight: 0.15, name: 'exploit_keyword' },
  { pattern: /you\s+are\s+now\b/i, weight: 0.25, name: 'identity_change' },
  { pattern: /act\s+as\s+(if|a|an)\b/i, weight: 0.15, name: 'act_as_phrase' },
  { pattern: /from\s+now\s+on\b/i, weight: 0.2, name: 'from_now_on_phrase' },
  { pattern: /new\s+(rules?|mode|persona)\b/i, weight: 0.2, name: 'new_mode_phrase' },
  { pattern: /```/g, weight: 0.05, name: 'code_block', countBased: true, threshold: 3 },
  { pattern: /[<>{}[\]]/g, weight: 0.02, name: 'special_chars', countBased: true, threshold: 10 },
];

/**
 * Default configuration for the service
 */
const DEFAULT_CONFIG = {
  enabled: true,
  blockOnHighSeverity: true,
  logAllDetections: true,
  heuristicThreshold: 0.5,
  action: {
    [SEVERITY.NONE]: ACTION.ALLOW,
    [SEVERITY.LOW]: ACTION.WARN,
    [SEVERITY.MEDIUM]: ACTION.WARN,
    [SEVERITY.HIGH]: ACTION.BLOCK,
    [SEVERITY.CRITICAL]: ACTION.BLOCK,
  },
};

/**
 * Prompt Injection Detection Service
 */
class PromptInjectionService {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Override from environment variables
    if (process.env.PROMPT_INJECTION_ENABLED !== undefined) {
      this.config.enabled = process.env.PROMPT_INJECTION_ENABLED === 'true';
    }
    if (process.env.PROMPT_INJECTION_BLOCK_HIGH !== undefined) {
      this.config.blockOnHighSeverity = process.env.PROMPT_INJECTION_BLOCK_HIGH === 'true';
    }
    if (process.env.PROMPT_INJECTION_HEURISTIC_THRESHOLD) {
      this.config.heuristicThreshold = parseFloat(process.env.PROMPT_INJECTION_HEURISTIC_THRESHOLD);
    }

    // Statistics tracking
    this.stats = {
      totalChecks: 0,
      detectionsBlocked: 0,
      detectionsWarned: 0,
      detectionsByCategory: {},
      detectionsBySeverity: {},
    };

    log.info('PromptInjectionService initialized', {
      enabled: this.config.enabled,
      blockOnHighSeverity: this.config.blockOnHighSeverity,
      heuristicThreshold: this.config.heuristicThreshold,
    });
  }

  /**
   * Analyze text for prompt injection attempts
   * @param {string} text - The text to analyze
   * @param {Object} options - Analysis options
   * @returns {Object} Analysis result with detections, severity, and recommended action
   */
  analyzeText(text, options = {}) {
    if (!this.config.enabled) {
      return this._createResult(SEVERITY.NONE, ACTION.ALLOW, []);
    }

    if (!text || typeof text !== 'string') {
      return this._createResult(SEVERITY.NONE, ACTION.ALLOW, []);
    }

    this.stats.totalChecks++;
    const detections = [];
    let maxSeverity = SEVERITY.NONE;

    // Phase 1: Pattern-based detection
    for (const [category, config] of Object.entries(ATTACK_PATTERNS)) {
      for (const pattern of config.patterns) {
        const match = text.match(pattern);
        if (match) {
          const detection = {
            category,
            severity: config.severity,
            description: config.description,
            matchedText: match[0],
            position: match.index,
            pattern: pattern.toString(),
          };
          detections.push(detection);

          // Track highest severity
          maxSeverity = this._getHigherSeverity(maxSeverity, config.severity);

          // Update stats
          this.stats.detectionsByCategory[category] = (this.stats.detectionsByCategory[category] || 0) + 1;
        }
      }
    }

    // Phase 2: Heuristic scoring
    const heuristicResult = this._calculateHeuristicScore(text);
    if (heuristicResult.score >= this.config.heuristicThreshold) {
      const heuristicSeverity = this._scoreToSeverity(heuristicResult.score);
      detections.push({
        category: 'heuristic',
        severity: heuristicSeverity,
        description: 'Suspicious pattern combination detected',
        score: heuristicResult.score,
        indicators: heuristicResult.matchedIndicators,
      });
      maxSeverity = this._getHigherSeverity(maxSeverity, heuristicSeverity);
    }

    // Phase 3: Structural analysis
    const structuralDetections = this._analyzeStructure(text);
    for (const detection of structuralDetections) {
      detections.push(detection);
      maxSeverity = this._getHigherSeverity(maxSeverity, detection.severity);
    }

    // Determine action based on severity
    const action = this._getAction(maxSeverity, options);

    // Update stats
    this.stats.detectionsBySeverity[maxSeverity] = (this.stats.detectionsBySeverity[maxSeverity] || 0) + 1;
    if (action === ACTION.BLOCK) {
      this.stats.detectionsBlocked++;
    } else if (action === ACTION.WARN) {
      this.stats.detectionsWarned++;
    }

    // Log detections
    if (detections.length > 0 && this.config.logAllDetections) {
      log.warn('Prompt injection patterns detected', {
        severity: maxSeverity,
        action,
        detectionCount: detections.length,
        categories: [...new Set(detections.map(d => d.category))],
        textLength: text.length,
        textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      });
    }

    return this._createResult(maxSeverity, action, detections, heuristicResult.score);
  }

  /**
   * Analyze an array of messages (conversation format)
   * @param {Array} messages - Array of message objects with role and content
   * @param {Object} options - Analysis options
   * @returns {Object} Combined analysis result
   */
  analyzeMessages(messages, options = {}) {
    if (!this.config.enabled || !Array.isArray(messages)) {
      return this._createResult(SEVERITY.NONE, ACTION.ALLOW, []);
    }

    const allDetections = [];
    let maxSeverity = SEVERITY.NONE;
    let maxHeuristicScore = 0;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (!message || !message.content) continue;

      // Analyze each message
      const result = this.analyzeText(message.content, {
        ...options,
        messageIndex: i,
        messageRole: message.role,
      });

      // Aggregate detections with message context
      for (const detection of result.detections) {
        allDetections.push({
          ...detection,
          messageIndex: i,
          messageRole: message.role,
        });
      }

      maxSeverity = this._getHigherSeverity(maxSeverity, result.severity);
      maxHeuristicScore = Math.max(maxHeuristicScore, result.heuristicScore || 0);
    }

    // Cross-message analysis for sophisticated attacks
    const crossMessageDetections = this._analyzeCrossMessage(messages);
    for (const detection of crossMessageDetections) {
      allDetections.push(detection);
      maxSeverity = this._getHigherSeverity(maxSeverity, detection.severity);
    }

    const action = this._getAction(maxSeverity, options);

    return this._createResult(maxSeverity, action, allDetections, maxHeuristicScore);
  }

  /**
   * Sanitize text by removing or neutralizing detected injection patterns
   * @param {string} text - The text to sanitize
   * @returns {Object} Sanitized text and modifications made
   */
  sanitizeText(text) {
    if (!text || typeof text !== 'string') {
      return { sanitized: text || '', modifications: [] };
    }

    let sanitized = text;
    const modifications = [];

    // Remove known delimiter injections
    for (const pattern of ATTACK_PATTERNS.delimiterInjection.patterns) {
      const match = sanitized.match(pattern);
      if (match) {
        sanitized = sanitized.replace(pattern, '[REMOVED]');
        modifications.push({
          type: 'delimiter_removed',
          original: match[0],
        });
      }
    }

    // Neutralize instruction override phrases
    const overrideNeutralizations = [
      { pattern: /ignore\s+(all\s+)?(previous|prior)/gi, replacement: '[instruction filtered]' },
      { pattern: /disregard\s+(all\s+)?(previous|prior)/gi, replacement: '[instruction filtered]' },
      { pattern: /forget\s+(all\s+)?(previous|prior)/gi, replacement: '[instruction filtered]' },
    ];

    for (const { pattern, replacement } of overrideNeutralizations) {
      const matches = sanitized.match(pattern);
      if (matches) {
        sanitized = sanitized.replace(pattern, replacement);
        modifications.push({
          type: 'instruction_neutralized',
          original: matches[0],
          replacement,
        });
      }
    }

    // Escape potential system delimiters
    sanitized = sanitized
      .replace(/```system/gi, '```[system]')
      .replace(/\[system\]/gi, '[[system]]')
      .replace(/<system>/gi, '<[system]>');

    if (sanitized !== text) {
      log.info('Text sanitized for prompt injection', {
        originalLength: text.length,
        sanitizedLength: sanitized.length,
        modificationsCount: modifications.length,
      });
    }

    return { sanitized, modifications };
  }

  /**
   * Get current detection statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      config: {
        enabled: this.config.enabled,
        blockOnHighSeverity: this.config.blockOnHighSeverity,
        heuristicThreshold: this.config.heuristicThreshold,
      },
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalChecks: 0,
      detectionsBlocked: 0,
      detectionsWarned: 0,
      detectionsByCategory: {},
      detectionsBySeverity: {},
    };
    log.info('PromptInjectionService stats reset');
  }

  // Private methods

  _createResult(severity, action, detections, heuristicScore = 0) {
    return {
      isRisky: severity !== SEVERITY.NONE,
      severity,
      action,
      shouldBlock: action === ACTION.BLOCK,
      detections,
      heuristicScore,
      detectionCount: detections.length,
      timestamp: new Date().toISOString(),
    };
  }

  _calculateHeuristicScore(text) {
    let score = 0;
    const matchedIndicators = [];

    for (const indicator of HEURISTIC_INDICATORS) {
      if (indicator.countBased) {
        const matches = text.match(indicator.pattern);
        const count = matches ? matches.length : 0;
        if (count >= (indicator.threshold || 1)) {
          const contribution = indicator.weight * Math.min(count / indicator.threshold, 2);
          score += contribution;
          matchedIndicators.push({
            name: indicator.name,
            count,
            contribution,
          });
        }
      } else {
        if (indicator.pattern.test(text)) {
          score += indicator.weight;
          matchedIndicators.push({
            name: indicator.name,
            contribution: indicator.weight,
          });
        }
      }
    }

    // Normalize score to 0-1 range (cap at 1)
    score = Math.min(score, 1);

    return { score, matchedIndicators };
  }

  _analyzeStructure(text) {
    const detections = [];

    // Check for unusually long text (potential prompt stuffing)
    if (text.length > 10000) {
      detections.push({
        category: 'structural',
        severity: SEVERITY.LOW,
        description: 'Unusually long input detected',
        textLength: text.length,
      });
    }

    // Check for excessive repetition (potential token smuggling)
    const words = text.split(/\s+/);
    const wordFreq = {};
    for (const word of words) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
    const maxFreq = Math.max(...Object.values(wordFreq));
    if (maxFreq > 50 && maxFreq > words.length * 0.2) {
      detections.push({
        category: 'structural',
        severity: SEVERITY.LOW,
        description: 'Excessive word repetition detected',
        maxFrequency: maxFreq,
      });
    }

    // Check for unusual Unicode characters (potential encoding attacks)
    const unusualUnicode = text.match(/[\u200B-\u200D\uFEFF\u2060-\u2064]/g);
    if (unusualUnicode && unusualUnicode.length > 0) {
      detections.push({
        category: 'structural',
        severity: SEVERITY.MEDIUM,
        description: 'Hidden Unicode characters detected',
        count: unusualUnicode.length,
      });
    }

    // Check for base64-encoded content (potential payload hiding)
    const base64Pattern = /[A-Za-z0-9+/]{50,}={0,2}/g;
    const base64Matches = text.match(base64Pattern);
    if (base64Matches && base64Matches.length > 0) {
      detections.push({
        category: 'structural',
        severity: SEVERITY.LOW,
        description: 'Potential base64-encoded content detected',
        count: base64Matches.length,
      });
    }

    return detections;
  }

  _analyzeCrossMessage(messages) {
    const detections = [];

    // Check for gradual instruction building across messages
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length >= 3) {
      const combinedText = userMessages.map(m => m.content).join(' ');
      const combinedResult = this.analyzeText(combinedText, { skipLogging: true });

      // If combined text is riskier than individual messages
      if (combinedResult.severity === SEVERITY.HIGH || combinedResult.severity === SEVERITY.CRITICAL) {
        const individualMaxSeverity = userMessages.reduce((max, m) => {
          const result = this.analyzeText(m.content, { skipLogging: true });
          return this._getHigherSeverity(max, result.severity);
        }, SEVERITY.NONE);

        if (this._severityToNumber(combinedResult.severity) > this._severityToNumber(individualMaxSeverity)) {
          detections.push({
            category: 'cross_message',
            severity: SEVERITY.MEDIUM,
            description: 'Potential multi-message injection attempt detected',
            messageCount: userMessages.length,
          });
        }
      }
    }

    return detections;
  }

  _getHigherSeverity(a, b) {
    const order = [SEVERITY.NONE, SEVERITY.LOW, SEVERITY.MEDIUM, SEVERITY.HIGH, SEVERITY.CRITICAL];
    return order.indexOf(a) > order.indexOf(b) ? a : b;
  }

  _severityToNumber(severity) {
    const order = [SEVERITY.NONE, SEVERITY.LOW, SEVERITY.MEDIUM, SEVERITY.HIGH, SEVERITY.CRITICAL];
    return order.indexOf(severity);
  }

  _scoreToSeverity(score) {
    if (score >= 0.8) return SEVERITY.HIGH;
    if (score >= 0.6) return SEVERITY.MEDIUM;
    if (score >= 0.4) return SEVERITY.LOW;
    return SEVERITY.NONE;
  }

  _getAction(severity, options = {}) {
    // Allow override via options
    if (options.forceAction) {
      return options.forceAction;
    }

    // Use configured action for severity level
    const configuredAction = this.config.action[severity];

    // Override to block for high severity if configured
    if (this.config.blockOnHighSeverity &&
        (severity === SEVERITY.HIGH || severity === SEVERITY.CRITICAL)) {
      return ACTION.BLOCK;
    }

    return configuredAction || ACTION.ALLOW;
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton instance of PromptInjectionService
 * @param {Object} config - Optional configuration (only used on first call)
 * @returns {PromptInjectionService}
 */
function getPromptInjectionService(config) {
  if (!instance) {
    instance = new PromptInjectionService(config);
  }
  return instance;
}

/**
 * Reset the singleton instance (primarily for testing)
 */
function resetPromptInjectionService() {
  instance = null;
}

module.exports = {
  PromptInjectionService,
  getPromptInjectionService,
  resetPromptInjectionService,
  SEVERITY,
  ACTION,
  ATTACK_PATTERNS,
};
