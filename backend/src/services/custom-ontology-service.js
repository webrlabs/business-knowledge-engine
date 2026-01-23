/**
 * Custom Ontology Service
 *
 * Manages custom entity and relationship type definitions stored in Cosmos DB.
 * Allows runtime extension of the ontology without code changes.
 *
 * Feature: F4.3.4 - Custom Entity Type Definitions
 * Feature: F4.3.5 - Custom Relationship Definitions
 */

const {
  createDocument,
  queryDocuments,
  deleteDocument,
  updateDocument
} = require('../storage/cosmos');
const { log } = require('../utils/logger');
const crypto = require('crypto');

const ENTITY_TYPE_DOC = 'custom_entity_type';
const RELATIONSHIP_TYPE_DOC = 'custom_relationship_type';

class CustomOntologyService {
  /**
   * Get all custom entity definitions
   * @returns {Promise<Array>} List of custom type definitions
   */
  async getCustomEntityTypes() {
    try {
      const querySpec = {
        query: 'SELECT * FROM c WHERE c.documentType = @type',
        parameters: [
          { name: '@type', value: ENTITY_TYPE_DOC }
        ]
      };

      const resources = await queryDocuments(querySpec);
      return resources.map(this._sanitizeResource);
    } catch (error) {
      log.errorWithStack('Failed to fetch custom entity types', error);
      return [];
    }
  }

  /**
   * Add a new custom entity type
   * @param {Object} definition - Type definition
   * @param {string} definition.name - Unique type name (e.g. "Vendor")
   * @param {string} definition.label - Display label
   * @param {string} definition.description - Description
   * @param {string} definition.parentType - Parent type to inherit from
   * @returns {Promise<Object>} Created definition
   */
  async addCustomEntityType(definition) {
    const { name, label, description, parentType } = definition;

    if (!name) {
      throw new Error('Type name is required');
    }

    // Check if it already exists
    const existing = await this.getCustomEntityTypeByName(name);
    if (existing) {
      throw new Error(`Custom type "${name}" already exists`);
    }

    const doc = {
      id: crypto.randomUUID(),
      documentType: ENTITY_TYPE_DOC,
      name,
      label: label || name,
      description: description || '',
      parentType: parentType || 'Entity',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const saved = await createDocument(doc);
      log.info(`Created custom entity type: ${name}`, { id: saved.id });
      return this._sanitizeResource(saved);
    } catch (error) {
      log.errorWithStack(`Failed to create custom entity type ${name}`, error);
      throw error;
    }
  }

  /**
   * Get a custom entity type by name
   * @param {string} name 
   * @returns {Promise<Object|null>}
   */
  async getCustomEntityTypeByName(name) {
    const querySpec = {
      query: 'SELECT * FROM c WHERE c.documentType = @type AND c.name = @name',
      parameters: [
        { name: '@type', value: ENTITY_TYPE_DOC },
        { name: '@name', value: name }
      ]
    };

    const resources = await queryDocuments(querySpec);
    return resources.length > 0 ? this._sanitizeResource(resources[0]) : null;
  }

  /**
   * Delete a custom entity type
   * @param {string} name - Type name to delete
   * @returns {Promise<boolean>} Success
   */
  async deleteCustomEntityType(name) {
    const typeDoc = await this.getCustomEntityTypeByName(name);

    if (!typeDoc) {
      return false;
    }

    try {
      await deleteDocument(typeDoc.id);
      log.info(`Deleted custom entity type: ${name}`, { id: typeDoc.id });
      return true;
    } catch (error) {
      log.errorWithStack(`Failed to delete custom entity type ${name}`, error);
      throw error;
    }
  }

  // ==================== Custom Relationship Types ====================
  // Feature: F4.3.5 - Custom Relationship Definitions

  /**
   * Get all custom relationship type definitions
   * @returns {Promise<Array>} List of custom relationship definitions
   */
  async getCustomRelationshipTypes() {
    try {
      const querySpec = {
        query: 'SELECT * FROM c WHERE c.documentType = @type',
        parameters: [
          { name: '@type', value: RELATIONSHIP_TYPE_DOC }
        ]
      };

      const resources = await queryDocuments(querySpec);
      return resources.map(this._sanitizeResource);
    } catch (error) {
      log.errorWithStack('Failed to fetch custom relationship types', error);
      return [];
    }
  }

  /**
   * Add a new custom relationship type with domain/range constraints
   * @param {Object} definition - Relationship type definition
   * @param {string} definition.name - Unique relationship type name (e.g. "COLLABORATES_WITH")
   * @param {string} definition.label - Display label
   * @param {string} definition.description - Description of the relationship
   * @param {string|string[]} definition.domain - Source entity type(s) allowed (e.g. "Person" or ["Person", "Team"])
   * @param {string|string[]} definition.range - Target entity type(s) allowed
   * @param {string} definition.inverse - Inverse relationship name (optional)
   * @param {string} definition.category - Category for grouping (optional, defaults to "Custom")
   * @param {boolean} definition.bidirectional - Whether the relationship is bidirectional (optional)
   * @returns {Promise<Object>} Created definition
   */
  async addCustomRelationshipType(definition) {
    const { name, label, description, domain, range, inverse, category, bidirectional } = definition;

    if (!name) {
      throw new Error('Relationship type name is required');
    }

    // Validate name format (typically UPPER_SNAKE_CASE)
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error('Relationship type name must be UPPER_SNAKE_CASE (e.g., COLLABORATES_WITH)');
    }

    if (!domain) {
      throw new Error('Domain (source entity type) is required');
    }

    if (!range) {
      throw new Error('Range (target entity type) is required');
    }

    // Check if it already exists
    const existing = await this.getCustomRelationshipTypeByName(name);
    if (existing) {
      throw new Error(`Custom relationship type "${name}" already exists`);
    }

    // Normalize domain and range to arrays
    const normalizedDomain = Array.isArray(domain) ? domain : [domain];
    const normalizedRange = Array.isArray(range) ? range : [range];

    const doc = {
      id: crypto.randomUUID(),
      documentType: RELATIONSHIP_TYPE_DOC,
      name,
      label: label || name.replace(/_/g, ' ').toLowerCase(),
      description: description || '',
      domain: normalizedDomain,
      range: normalizedRange,
      inverse: inverse || null,
      category: category || 'Custom',
      bidirectional: bidirectional || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const saved = await createDocument(doc);
      log.info(`Created custom relationship type: ${name}`, {
        id: saved.id,
        domain: normalizedDomain,
        range: normalizedRange
      });
      return this._sanitizeResource(saved);
    } catch (error) {
      log.errorWithStack(`Failed to create custom relationship type ${name}`, error);
      throw error;
    }
  }

  /**
   * Get a custom relationship type by name
   * @param {string} name - Relationship type name
   * @returns {Promise<Object|null>}
   */
  async getCustomRelationshipTypeByName(name) {
    const querySpec = {
      query: 'SELECT * FROM c WHERE c.documentType = @type AND c.name = @name',
      parameters: [
        { name: '@type', value: RELATIONSHIP_TYPE_DOC },
        { name: '@name', value: name }
      ]
    };

    const resources = await queryDocuments(querySpec);
    return resources.length > 0 ? this._sanitizeResource(resources[0]) : null;
  }

  /**
   * Update an existing custom relationship type
   * @param {string} name - Relationship type name to update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated definition
   */
  async updateCustomRelationshipType(name, updates) {
    const typeDoc = await this.getCustomRelationshipTypeByName(name);

    if (!typeDoc) {
      throw new Error(`Custom relationship type "${name}" not found`);
    }

    // Prevent changing the name
    if (updates.name && updates.name !== name) {
      throw new Error('Cannot change relationship type name. Delete and recreate instead.');
    }

    // Normalize domain and range if provided
    if (updates.domain) {
      updates.domain = Array.isArray(updates.domain) ? updates.domain : [updates.domain];
    }
    if (updates.range) {
      updates.range = Array.isArray(updates.range) ? updates.range : [updates.range];
    }

    const updatedDoc = {
      ...typeDoc,
      ...updates,
      name, // Ensure name doesn't change
      updatedAt: new Date().toISOString()
    };

    try {
      const saved = await updateDocument(typeDoc.id, updatedDoc);
      log.info(`Updated custom relationship type: ${name}`, { id: saved.id });
      return this._sanitizeResource(saved);
    } catch (error) {
      log.errorWithStack(`Failed to update custom relationship type ${name}`, error);
      throw error;
    }
  }

  /**
   * Delete a custom relationship type
   * @param {string} name - Relationship type name to delete
   * @returns {Promise<boolean>} Success
   */
  async deleteCustomRelationshipType(name) {
    const typeDoc = await this.getCustomRelationshipTypeByName(name);

    if (!typeDoc) {
      return false;
    }

    try {
      await deleteDocument(typeDoc.id);
      log.info(`Deleted custom relationship type: ${name}`, { id: typeDoc.id });
      return true;
    } catch (error) {
      log.errorWithStack(`Failed to delete custom relationship type ${name}`, error);
      throw error;
    }
  }

  /**
   * Validate if a relationship is valid according to custom type constraints
   * @param {string} relationshipType - The relationship type name
   * @param {string} sourceType - The source entity type
   * @param {string} targetType - The target entity type
   * @returns {Promise<{valid: boolean, errors: string[]}>}
   */
  async validateCustomRelationship(relationshipType, sourceType, targetType) {
    const typeDef = await this.getCustomRelationshipTypeByName(relationshipType);

    if (!typeDef) {
      return { valid: true, errors: [] }; // Not a custom type, skip validation
    }

    const errors = [];

    // Check domain constraint
    if (!typeDef.domain.includes(sourceType) && !typeDef.domain.includes('Entity')) {
      errors.push(`Source type "${sourceType}" is not in the allowed domain: [${typeDef.domain.join(', ')}]`);
    }

    // Check range constraint
    if (!typeDef.range.includes(targetType) && !typeDef.range.includes('Entity')) {
      errors.push(`Target type "${targetType}" is not in the allowed range: [${typeDef.range.join(', ')}]`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get custom relationship types grouped by category
   * @returns {Promise<Object>} Map of category -> relationship types
   */
  async getCustomRelationshipTypesByCategory() {
    const types = await this.getCustomRelationshipTypes();
    const grouped = {};

    for (const type of types) {
      const category = type.category || 'Custom';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(type);
    }

    return grouped;
  }

  /**
   * Remove internal Cosmos properties
   */
  _sanitizeResource(resource) {
    const { _rid, _self, _etag, _attachments, _ts, ...rest } = resource;
    return rest;
  }
}

// Singleton instance
let instance = null;

function getCustomOntologyService() {
  if (!instance) {
    instance = new CustomOntologyService();
  }
  return instance;
}

module.exports = {
  CustomOntologyService,
  getCustomOntologyService
};
