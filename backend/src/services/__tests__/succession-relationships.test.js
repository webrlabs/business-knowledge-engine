/**
 * Unit tests for Succession and Deprecation Relationships
 * Feature: F2.3.2 - REPLACED_BY Relationship
 * Feature: F2.3.3 - DEPRECATED_BY Relationship
 */

const { initializeOntologyService, getOntologyService } = require('../ontology-service');
const { initializeOntologyMigrationService } = require('../ontology-migration-service');
const path = require('path');
const fs = require('fs');

// Mock dependencies
jest.mock('../../utils/logger', () => ({
  log: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../utils/telemetry', () => ({
  trackEvent: jest.fn(),
}));

describe('Succession and Deprecation Relationships', () => {
  let ontologyService;
  let migrationService;

  beforeAll(async () => {
    ontologyService = await initializeOntologyService();
    migrationService = await initializeOntologyMigrationService({
      ontologyService,
    });
  });

  describe('Ontology Definitions', () => {
    test('should have REPLACED_BY relationship defined', () => {
      const rel = ontologyService.relationshipTypes.get('REPLACED_BY');
      expect(rel).toBeDefined();
      expect(rel.label).toBe('replaced by');
      expect(rel.category).toBe('EntityLifecycleRelationship');
      expect(rel.inverse).toBe('REPLACES');
    });

    test('should have DEPRECATED_BY relationship defined', () => {
      const rel = ontologyService.relationshipTypes.get('DEPRECATED_BY');
      expect(rel).toBeDefined();
      expect(rel.label).toBe('deprecated by');
      expect(rel.category).toBe('EntityLifecycleRelationship');
      expect(rel.inverse).toBe('DEPRECATES');
    });

    test('should have REPLACES relationship defined', () => {
      const rel = ontologyService.relationshipTypes.get('REPLACES');
      expect(rel).toBeDefined();
      expect(rel.inverse).toBe('REPLACED_BY');
    });

    test('should have DEPRECATES relationship defined', () => {
      const rel = ontologyService.relationshipTypes.get('DEPRECATES');
      expect(rel).toBeDefined();
      expect(rel.inverse).toBe('DEPRECATED_BY');
    });

    test('should have EntityLifecycleRelationship class defined', () => {
      const type = ontologyService.entityTypes.get('EntityLifecycleRelationship');
      expect(type).toBeDefined();
      expect(type.parent).toBe('Relationship');
    });
  });

  describe('Relationship Normalization', () => {
    test('should normalize "replaced_by" to "REPLACED_BY"', () => {
      const normalized = ontologyService.normalizeRelationshipType('replaced_by');
      expect(normalized).toBe('REPLACED_BY');
    });

    test('should normalize "succeeded_by" to "REPLACED_BY"', () => {
      const normalized = ontologyService.normalizeRelationshipType('succeeded_by');
      expect(normalized).toBe('REPLACED_BY');
    });

    test('should normalize "deprecated_by" to "DEPRECATED_BY"', () => {
      const normalized = ontologyService.normalizeRelationshipType('deprecated_by');
      expect(normalized).toBe('DEPRECATED_BY');
    });

    test('should normalize "obsoletes" to "DEPRECATES"', () => {
      const normalized = ontologyService.normalizeRelationshipType('obsoletes');
      expect(normalized).toBe('DEPRECATES');
    });
  });

  describe('Relationship Validation', () => {
    test('should validate REPLACED_BY between any entities', () => {
      const result = ontologyService.validateRelationship('REPLACED_BY', 'System', 'System');
      expect(result.valid).toBe(true);
    });

    test('should validate DEPRECATED_BY between any entities', () => {
      const result = ontologyService.validateRelationship('DEPRECATED_BY', 'Process', 'Process');
      expect(result.valid).toBe(true);
    });
  });
});

describe('MigrationContext property support', () => {
  const { MigrationContext } = require('../ontology-migration-service');

  test('should support addProperty and track it in changes', () => {
    const context = new MigrationContext({ logger: { debug: jest.fn() } });
    context.addProperty('newProp', { type: 'xsd:string' });

    const summary = context.getChangesSummary();
    expect(summary.addedProperties.length).toBe(1);
    expect(summary.addedProperties[0].propertyName).toBe('newProp');
    expect(summary.totalTypeChanges).toBe(1);
  });

  test('should support removeProperty and track it in changes', () => {
    const context = new MigrationContext({ logger: { debug: jest.fn() } });
    context.removeProperty('oldProp');

    const summary = context.getChangesSummary();
    expect(summary.removedProperties.length).toBe(1);
    expect(summary.removedProperties[0].propertyName).toBe('oldProp');
    expect(summary.totalTypeChanges).toBe(1);
  });

  test('should support modifyProperty and track it in changes', () => {
    const context = new MigrationContext({ logger: { debug: jest.fn() } });
    context.modifyProperty('prop', { label: 'New Label' });

    const summary = context.getChangesSummary();
    expect(summary.modifiedProperties.length).toBe(1);
    expect(summary.modifiedProperties[0].propertyName).toBe('prop');
    expect(summary.totalTypeChanges).toBe(1);
  });
});
