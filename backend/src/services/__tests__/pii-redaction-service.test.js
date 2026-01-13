const {
  PIIRedactionService,
  createPIIRedactionService,
  PII_PATTERNS,
  SEVERITY_LEVELS,
} = require('../pii-redaction-service');

describe('PII Redaction Service', () => {
  let service;

  beforeEach(() => {
    service = createPIIRedactionService({ enabled: true });
  });

  describe('Email redaction', () => {
    it('should redact email addresses', () => {
      const text = 'Contact john.doe@example.com for more info';
      const result = service.redact(text);

      expect(result.redactedText).toBe('Contact [EMAIL REDACTED] for more info');
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0].type).toBe('email');
      expect(result.detections[0].category).toBe('contact');
    });

    it('should redact multiple email addresses', () => {
      const text = 'Email alice@test.org or bob@company.net';
      const result = service.redact(text);

      expect(result.redactedText).toBe('Email [EMAIL REDACTED] or [EMAIL REDACTED]');
      expect(result.detections).toHaveLength(2);
    });
  });

  describe('Phone number redaction', () => {
    it('should redact US phone numbers', () => {
      const text = 'Call me at 555-123-4567';
      const result = service.redact(text);

      expect(result.redactedText).toBe('Call me at [PHONE REDACTED]');
      expect(result.detections[0].type).toBe('phone');
    });

    it('should redact phone with parentheses', () => {
      const text = 'Phone: (555) 123-4567';
      const result = service.redact(text);

      expect(result.redactedText).toContain('[PHONE REDACTED]');
    });

    it('should redact phone with country code', () => {
      const text = 'International: +1-555-123-4567';
      const result = service.redact(text);

      expect(result.redactedText).toContain('[PHONE REDACTED]');
    });
  });

  describe('SSN redaction', () => {
    it('should redact SSN with dashes', () => {
      const text = 'SSN: 123-45-6789';
      const result = service.redact(text);

      expect(result.redactedText).toBe('SSN: [SSN REDACTED]');
      expect(result.detections[0].type).toBe('ssn');
      expect(result.detections[0].severity).toBe('critical');
    });

    it('should redact SSN without dashes', () => {
      const text = 'SSN: 123456789';
      const result = service.redact(text);

      expect(result.redactedText).toBe('SSN: [SSN REDACTED]');
    });
  });

  describe('Credit card redaction', () => {
    it('should redact credit card numbers', () => {
      const text = 'Card: 4111-1111-1111-1111';
      const result = service.redact(text);

      expect(result.redactedText).toBe('Card: [CREDIT CARD REDACTED]');
      expect(result.detections[0].type).toBe('creditCard');
      expect(result.detections[0].severity).toBe('critical');
    });

    it('should redact credit card with spaces', () => {
      const text = 'Payment: 4111 1111 1111 1111';
      const result = service.redact(text);

      expect(result.redactedText).toContain('[CREDIT CARD REDACTED]');
    });
  });

  describe('IP address redaction', () => {
    it('should redact IPv4 addresses', () => {
      const text = 'Server IP: 192.168.1.100';
      const result = service.redact(text);

      expect(result.redactedText).toBe('Server IP: [IP ADDRESS REDACTED]');
      expect(result.detections[0].type).toBe('ipv4');
    });
  });

  describe('Multiple PII types', () => {
    it('should redact multiple PII types in same text', () => {
      const text = 'Contact john@test.com at 555-123-4567, SSN: 123-45-6789';
      const result = service.redact(text);

      expect(result.redactedText).toBe(
        'Contact [EMAIL REDACTED] at [PHONE REDACTED], SSN: [SSN REDACTED]'
      );
      expect(result.detections).toHaveLength(3);
    });
  });

  describe('Severity filtering', () => {
    it('should filter by minimum severity', () => {
      const highSeverityService = createPIIRedactionService({
        enabled: true,
        minSeverity: 'high',
      });

      // IP addresses are 'low' severity, should not be redacted
      const text = 'IP: 192.168.1.1, SSN: 123-45-6789';
      const result = highSeverityService.redact(text);

      // SSN (critical) should be redacted, IP (low) should not
      expect(result.redactedText).toContain('192.168.1.1');
      expect(result.redactedText).toContain('[SSN REDACTED]');
    });
  });

  describe('Category filtering', () => {
    it('should filter by category', () => {
      const contactOnlyService = createPIIRedactionService({
        enabled: true,
        categories: ['contact'],
      });

      const text = 'Email: test@example.com, SSN: 123-45-6789';
      const result = contactOnlyService.redact(text);

      // Email (contact) should be redacted, SSN (government_id) should not
      expect(result.redactedText).toContain('[EMAIL REDACTED]');
      expect(result.redactedText).toContain('123-45-6789');
    });
  });

  describe('Audit mode', () => {
    it('should detect but not redact in audit mode', () => {
      const auditService = createPIIRedactionService({
        enabled: true,
        auditMode: true,
      });

      const text = 'Email: test@example.com';
      const result = auditService.redact(text);

      expect(result.redactedText).toBe(text); // Original text preserved
      expect(result.detections).toHaveLength(1);
      expect(result.detections[0].original).toBe('test@example.com');
    });
  });

  describe('detect() method', () => {
    it('should detect PII without redacting', () => {
      const text = 'Contact john@test.com';
      const result = service.detect(text);

      expect(result.containsPII).toBe(true);
      expect(result.detections).toHaveLength(1);
    });

    it('should return false for text without PII', () => {
      const text = 'This is a normal document without sensitive data';
      const result = service.detect(text);

      expect(result.containsPII).toBe(false);
      expect(result.detections).toHaveLength(0);
    });
  });

  describe('Object redaction', () => {
    it('should redact PII from object properties', () => {
      const obj = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-123-4567',
        nested: {
          ssn: '123-45-6789',
        },
      };

      const { redactedObject, totalDetections } = service.redactObject(obj);

      expect(redactedObject.email).toBe('[EMAIL REDACTED]');
      expect(redactedObject.phone).toBe('[PHONE REDACTED]');
      expect(redactedObject.nested.ssn).toBe('[SSN REDACTED]');
      expect(totalDetections).toBe(3);
    });

    it('should redact only specified fields', () => {
      const obj = {
        email: 'john@example.com',
        content: 'Contact support@example.com',
      };

      const { redactedObject } = service.redactObject(obj, ['content']);

      expect(redactedObject.email).toBe('john@example.com'); // Not in field list
      expect(redactedObject.content).toBe('Contact [EMAIL REDACTED]');
    });
  });

  describe('Custom patterns', () => {
    it('should allow adding custom patterns', () => {
      service.addPattern({
        name: 'employeeId',
        pattern: /EMP-\d{6}/g,
        replacement: '[EMPLOYEE ID REDACTED]',
        category: 'internal',
        severity: 'medium',
      });

      const text = 'Employee EMP-123456 created the document';
      const result = service.redact(text);

      expect(result.redactedText).toBe('Employee [EMPLOYEE ID REDACTED] created the document');
    });
  });

  describe('Edge cases', () => {
    it('should handle null input', () => {
      const result = service.redact(null);
      expect(result.redactedText).toBe(null);
      expect(result.detections).toHaveLength(0);
    });

    it('should handle empty string', () => {
      const result = service.redact('');
      expect(result.redactedText).toBe('');
      expect(result.detections).toHaveLength(0);
    });

    it('should handle non-string input', () => {
      const result = service.redact(12345);
      expect(result.redactedText).toBe(12345);
      expect(result.detections).toHaveLength(0);
    });
  });

  describe('Disabled service', () => {
    it('should not redact when disabled', () => {
      const disabledService = createPIIRedactionService({ enabled: false });
      const text = 'Email: test@example.com';
      const result = disabledService.redact(text);

      expect(result.redactedText).toBe(text);
      expect(result.redactionApplied).toBe(false);
    });

    it('should redact when forceEnabled is passed', () => {
      const disabledService = createPIIRedactionService({ enabled: false });
      const text = 'Email: test@example.com';
      const result = disabledService.redact(text, { forceEnabled: true });

      expect(result.redactedText).toBe('Email: [EMAIL REDACTED]');
    });
  });

  describe('Summary generation', () => {
    it('should generate correct summary', () => {
      const text = 'Email: a@b.com, b@c.com, SSN: 123-45-6789';
      const result = service.redact(text);

      expect(result.summary.totalDetections).toBe(3);
      expect(result.summary.byCategory.contact).toBe(2);
      expect(result.summary.byCategory.government_id).toBe(1);
      expect(result.summary.hasCritical).toBe(true);
    });
  });
});
