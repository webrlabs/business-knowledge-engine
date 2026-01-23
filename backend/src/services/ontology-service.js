/**
 * Ontology Validation Service
 *
 * Validates extracted entities and relationships against the formal JSON-LD ontology.
 * Provides type hierarchy awareness, domain/range constraint checking, and
 * relationship normalization.
 *
 * Feature: F2.1.4 - Ontology Validation Service
 * @see /ontology/business-process.jsonld
 */

const fs = require('fs');
const path = require('path');
const { getCustomOntologyService } = require('./custom-ontology-service');

class OntologyService {
  constructor() {
    this.ontology = null;
    this.entityTypes = new Map();       // type -> { label, comment, parent, children }
    this.relationshipTypes = new Map(); // type -> { label, comment, domain, range, inverse }
    this.typeHierarchy = new Map();     // type -> Set of ancestor types
    this.synonymMappings = new Map();   // synonym -> canonical type
    this.deprecatedTypes = new Map();   // type -> { replacedBy, reason, date, removalVersion, migrationGuide }
    this.initialized = false;
  }

  /**
   * Initialize the service by loading and parsing the ontology
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      const ontologyPath = path.resolve(__dirname, '../../../ontology/business-process.jsonld');
      const ontologyContent = fs.readFileSync(ontologyPath, 'utf8');
      this.ontology = JSON.parse(ontologyContent);

      this._parseOntology();
      await this._loadCustomTypes(); // Load custom types from DB
      this._buildTypeHierarchy();
      this._loadSynonymMappings();
      this._loadDeprecations();

      this.initialized = true;
      console.log(`[OntologyService] Initialized with ${this.entityTypes.size} entity types, ${this.relationshipTypes.size} relationship types, ${this.deprecatedTypes.size} deprecated types`);
    } catch (error) {
      console.error('[OntologyService] Failed to initialize:', error.message);
      throw new Error(`Ontology initialization failed: ${error.message}`);
    }
  }

  /**
   * Load custom entity and relationship types from storage
   */
  async _loadCustomTypes() {
    try {
      const customService = getCustomOntologyService();

      // Load custom entity types
      const customEntityTypes = await customService.getCustomEntityTypes();
      for (const type of customEntityTypes) {
        this._registerCustomType(type);
      }
      if (customEntityTypes.length > 0) {
        console.log(`[OntologyService] Loaded ${customEntityTypes.length} custom entity types`);
      }

      // Load custom relationship types (F4.3.5)
      const customRelTypes = await customService.getCustomRelationshipTypes();
      for (const relType of customRelTypes) {
        this._registerCustomRelationshipType(relType);
      }
      if (customRelTypes.length > 0) {
        console.log(`[OntologyService] Loaded ${customRelTypes.length} custom relationship types`);
      }
    } catch (error) {
      console.warn('[OntologyService] Failed to load custom types (ignoring):', error.message);
    }
  }

  /**
   * Register a custom entity type in the internal maps
   */
  _registerCustomType(typeDef) {
    const { name, label, description, parentType } = typeDef;

    // Add to entity types map
    this.entityTypes.set(name, {
      id: `custom:${name}`,
      label: label || name,
      comment: description || '',
      parent: parentType || 'Entity',
      children: [],
      isCustom: true
    });

    // Add to parent's children list if parent exists
    if (parentType && this.entityTypes.has(parentType)) {
      this.entityTypes.get(parentType).children.push(name);
    }
  }

  /**
   * Register a custom relationship type in the internal maps
   * Feature: F4.3.5 - Custom Relationship Definitions
   */
  _registerCustomRelationshipType(relTypeDef) {
    const { name, label, description, domain, range, inverse, category, bidirectional } = relTypeDef;

    // Normalize domain and range to arrays
    const normalizedDomain = Array.isArray(domain) ? domain : [domain];
    const normalizedRange = Array.isArray(range) ? range : [range];

    // Add to relationship types map
    this.relationshipTypes.set(name, {
      id: `custom:${name}`,
      label: label || name.replace(/_/g, ' ').toLowerCase(),
      comment: description || '',
      domain: normalizedDomain,
      range: normalizedRange,
      inverse: inverse || null,
      category: category || 'Custom',
      bidirectional: bidirectional || false,
      isCustom: true
    });

    // If there's an inverse relationship, register the mapping
    if (inverse && !this.relationshipTypes.has(inverse)) {
      // Auto-create the inverse relationship if it doesn't exist
      this.relationshipTypes.set(inverse, {
        id: `custom:${inverse}`,
        label: inverse.replace(/_/g, ' ').toLowerCase(),
        comment: `Inverse of ${name}`,
        domain: normalizedRange, // Flip domain and range
        range: normalizedDomain,
        inverse: name,
        category: category || 'Custom',
        bidirectional: bidirectional || false,
        isCustom: true,
        isAutoInverse: true // Mark as auto-generated
      });
    }
  }

  /**
   * Add a new custom entity type (Runtime & Persistence)
   * Feature: F4.3.4 - Custom Entity Type Definitions
   * 
   * @param {Object} definition - Type definition
   * @returns {Promise<Object>} Created definition
   */
  async addCustomEntityType(definition) {
    this._ensureInitialized();
    
    // Validate
    if (!definition.name) throw new Error('Type name is required');
    if (this.entityTypes.has(definition.name)) {
      throw new Error(`Type "${definition.name}" already exists`);
    }
    if (definition.parentType && !this.entityTypes.has(definition.parentType)) {
      throw new Error(`Parent type "${definition.parentType}" does not exist`);
    }

    // Persist
    const customService = getCustomOntologyService();
    const saved = await customService.addCustomEntityType(definition);
    
    // Update in-memory state
    this._registerCustomType(saved);
    this._buildTypeHierarchy(); // Rebuild hierarchy to include new type
    
    return saved;
  }

  /**
   * Delete a custom entity type
   * @param {string} name - Type name
   */
  async deleteCustomEntityType(name) {
    this._ensureInitialized();
    
    const typeInfo = this.entityTypes.get(name);
    if (!typeInfo) throw new Error(`Type "${name}" not found`);
    if (!typeInfo.isCustom) throw new Error(`Type "${name}" is a core type and cannot be deleted`);

    // Persist deletion
    const customService = getCustomOntologyService();
    await customService.deleteCustomEntityType(name);
    
    // Update in-memory state
    this.entityTypes.delete(name);
    
    // Remove from parent's children
    if (typeInfo.parent && this.entityTypes.has(typeInfo.parent)) {
      const parent = this.entityTypes.get(typeInfo.parent);
      parent.children = parent.children.filter(c => c !== name);
    }
    
    this._buildTypeHierarchy();

    return true;
  }

  // ==================== Custom Relationship Type Methods ====================
  // Feature: F4.3.5 - Custom Relationship Definitions

  /**
   * Add a new custom relationship type (Runtime & Persistence)
   * @param {Object} definition - Relationship type definition
   * @param {string} definition.name - Unique relationship type name (e.g. "COLLABORATES_WITH")
   * @param {string} definition.label - Display label
   * @param {string} definition.description - Description
   * @param {string|string[]} definition.domain - Source entity type(s) allowed
   * @param {string|string[]} definition.range - Target entity type(s) allowed
   * @param {string} definition.inverse - Inverse relationship name (optional)
   * @param {string} definition.category - Category for grouping (optional)
   * @param {boolean} definition.bidirectional - Whether relationship is bidirectional (optional)
   * @returns {Promise<Object>} Created definition
   */
  async addCustomRelationshipType(definition) {
    this._ensureInitialized();

    // Validate
    if (!definition.name) throw new Error('Relationship type name is required');
    if (this.relationshipTypes.has(definition.name)) {
      throw new Error(`Relationship type "${definition.name}" already exists`);
    }
    if (!definition.domain) throw new Error('Domain (source entity type) is required');
    if (!definition.range) throw new Error('Range (target entity type) is required');

    // Validate domain types exist
    const domainTypes = Array.isArray(definition.domain) ? definition.domain : [definition.domain];
    for (const domType of domainTypes) {
      if (domType !== 'Entity' && !this.entityTypes.has(domType)) {
        throw new Error(`Domain type "${domType}" does not exist in the ontology`);
      }
    }

    // Validate range types exist
    const rangeTypes = Array.isArray(definition.range) ? definition.range : [definition.range];
    for (const rangeType of rangeTypes) {
      if (rangeType !== 'Entity' && !this.entityTypes.has(rangeType)) {
        throw new Error(`Range type "${rangeType}" does not exist in the ontology`);
      }
    }

    // Persist to storage
    const customService = getCustomOntologyService();
    const saved = await customService.addCustomRelationshipType(definition);

    // Update in-memory state
    this._registerCustomRelationshipType(saved);

    return saved;
  }

  /**
   * Update an existing custom relationship type
   * @param {string} name - Relationship type name to update
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated definition
   */
  async updateCustomRelationshipType(name, updates) {
    this._ensureInitialized();

    const typeInfo = this.relationshipTypes.get(name);
    if (!typeInfo) throw new Error(`Relationship type "${name}" not found`);
    if (!typeInfo.isCustom) throw new Error(`Relationship type "${name}" is a core type and cannot be modified`);

    // Validate domain types if being updated
    if (updates.domain) {
      const domainTypes = Array.isArray(updates.domain) ? updates.domain : [updates.domain];
      for (const domType of domainTypes) {
        if (domType !== 'Entity' && !this.entityTypes.has(domType)) {
          throw new Error(`Domain type "${domType}" does not exist in the ontology`);
        }
      }
    }

    // Validate range types if being updated
    if (updates.range) {
      const rangeTypes = Array.isArray(updates.range) ? updates.range : [updates.range];
      for (const rangeType of rangeTypes) {
        if (rangeType !== 'Entity' && !this.entityTypes.has(rangeType)) {
          throw new Error(`Range type "${rangeType}" does not exist in the ontology`);
        }
      }
    }

    // Persist update
    const customService = getCustomOntologyService();
    const updated = await customService.updateCustomRelationshipType(name, updates);

    // Update in-memory state
    this.relationshipTypes.delete(name);
    this._registerCustomRelationshipType(updated);

    return updated;
  }

  /**
   * Delete a custom relationship type
   * @param {string} name - Relationship type name
   * @returns {Promise<boolean>} Success
   */
  async deleteCustomRelationshipType(name) {
    this._ensureInitialized();

    const typeInfo = this.relationshipTypes.get(name);
    if (!typeInfo) throw new Error(`Relationship type "${name}" not found`);
    if (!typeInfo.isCustom) throw new Error(`Relationship type "${name}" is a core type and cannot be deleted`);

    // Persist deletion
    const customService = getCustomOntologyService();
    await customService.deleteCustomRelationshipType(name);

    // Update in-memory state - remove the type and any auto-generated inverse
    this.relationshipTypes.delete(name);

    if (typeInfo.inverse) {
      const inverseInfo = this.relationshipTypes.get(typeInfo.inverse);
      if (inverseInfo && inverseInfo.isAutoInverse) {
        this.relationshipTypes.delete(typeInfo.inverse);
      }
    }

    return true;
  }

  /**
   * Get all custom relationship types
   * @returns {Array} List of custom relationship type definitions
   */
  getCustomRelationshipTypes() {
    this._ensureInitialized();

    const customTypes = [];
    for (const [name, info] of this.relationshipTypes) {
      if (info.isCustom && !info.isAutoInverse) {
        customTypes.push({
          name,
          label: info.label,
          description: info.comment,
          domain: info.domain,
          range: info.range,
          inverse: info.inverse,
          category: info.category,
          bidirectional: info.bidirectional
        });
      }
    }
    return customTypes;
  }

  /**
   * Validate a relationship against domain/range constraints
   * @param {string} relationshipType - The relationship type name
   * @param {string} sourceType - The source entity type
   * @param {string} targetType - The target entity type
   * @returns {{valid: boolean, errors: string[], warnings: string[]}}
   */
  validateRelationshipConstraints(relationshipType, sourceType, targetType) {
    this._ensureInitialized();

    const typeInfo = this.relationshipTypes.get(relationshipType);
    if (!typeInfo) {
      return { valid: true, errors: [], warnings: [`Unknown relationship type: ${relationshipType}`] };
    }

    const errors = [];
    const warnings = [];

    // Get domain/range, handling both array and string formats
    const allowedDomains = Array.isArray(typeInfo.domain) ? typeInfo.domain : [typeInfo.domain];
    const allowedRanges = Array.isArray(typeInfo.range) ? typeInfo.range : [typeInfo.range];

    // Check domain constraint (with type hierarchy consideration)
    const sourceTypeMatches = this._typeMatchesDomainOrRange(sourceType, allowedDomains);
    if (!sourceTypeMatches) {
      errors.push(`Source type "${sourceType}" is not in the allowed domain: [${allowedDomains.join(', ')}]`);
    }

    // Check range constraint (with type hierarchy consideration)
    const targetTypeMatches = this._typeMatchesDomainOrRange(targetType, allowedRanges);
    if (!targetTypeMatches) {
      errors.push(`Target type "${targetType}" is not in the allowed range: [${allowedRanges.join(', ')}]`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Check if a type matches any of the allowed types (considering inheritance)
   * @private
   */
  _typeMatchesDomainOrRange(entityType, allowedTypes) {
    // Direct match
    if (allowedTypes.includes(entityType)) return true;

    // "Entity" matches everything
    if (allowedTypes.includes('Entity')) return true;

    // Check type hierarchy - if the entity type is a subtype of any allowed type
    const ancestors = this.typeHierarchy.get(entityType) || new Set();
    for (const allowedType of allowedTypes) {
      if (ancestors.has(allowedType)) return true;
    }

    return false;
  }

  /**
   * Parse the JSON-LD ontology and extract types and relationships
   */
  _parseOntology() {
    const graph = this.ontology['@graph'] || [];

    for (const node of graph) {
      const nodeType = node['@type'];
      const nodeId = node['@id'];

      if (!nodeId) continue;

      // Extract the local name from the full URI
      const localName = this._extractLocalName(nodeId);

      if (nodeType === 'rdfs:Class') {
        // This is an entity type
        const parentUri = node.subClassOf;
        const parent = parentUri ? this._extractLocalName(parentUri) : null;

        this.entityTypes.set(localName, {
          id: nodeId,
          label: node.label || localName,
          comment: node.comment || '',
          parent: parent,
          children: [],
          schemaMapping: node['schema:sameAs'] || null
        });
      } else if (nodeType === 'rdf:Property') {
        // This is a relationship type
        const domain = node.domain ? this._extractLocalName(node.domain) : 'Entity';
        const range = node.range ? this._extractLocalName(node.range) : 'Entity';
        const inverse = node.inverseOf ? this._extractLocalName(node.inverseOf) : null;
        const equivalent = node['owl:equivalentProperty'] ? this._extractLocalName(node['owl:equivalentProperty']) : null;

        this.relationshipTypes.set(localName, {
          id: nodeId,
          label: node.label || localName,
          comment: node.comment || '',
          domain: domain,
          range: range,
          inverse: inverse,
          equivalent: equivalent,
          category: node.subClassOf ? this._extractLocalName(node.subClassOf) : 'Relationship'
        });
      }
    }

    // Build parent-child relationships
    for (const [typeName, typeInfo] of this.entityTypes) {
      if (typeInfo.parent && this.entityTypes.has(typeInfo.parent)) {
        this.entityTypes.get(typeInfo.parent).children.push(typeName);
      }
    }
  }

  /**
   * Build the type hierarchy (transitive closure of subClassOf)
   */
  _buildTypeHierarchy() {
    for (const [typeName] of this.entityTypes) {
      const ancestors = new Set();
      let current = typeName;

      while (current) {
        const typeInfo = this.entityTypes.get(current);
        if (!typeInfo || !typeInfo.parent) break;

        ancestors.add(typeInfo.parent);
        current = typeInfo.parent;

        // Prevent infinite loops
        if (ancestors.size > 20) break;
      }

      this.typeHierarchy.set(typeName, ancestors);
    }
  }

  /**
   * Load relationship synonym mappings from ontology
   */
  _loadSynonymMappings() {
    const graph = this.ontology['@graph'] || [];

    for (const node of graph) {
      if (node['@id'] === 'bke:RelationshipNormalizationMapping' && node['bke:mappings']) {
        const mappings = node['bke:mappings'];
        for (const [synonym, canonical] of Object.entries(mappings)) {
          this.synonymMappings.set(synonym.toLowerCase(), canonical);
        }
      }
    }
  }

  /**
   * Load deprecation information from ontology
   * Feature: F2.2.3 - Type Deprecation Support
   */
  _loadDeprecations() {
    const graph = this.ontology['@graph'] || [];

    // Load deprecations from individual types that have owl:deprecated = true
    for (const node of graph) {
      const nodeId = node['@id'];
      if (!nodeId) continue;

      const localName = this._extractLocalName(nodeId);

      // Check if the type has deprecation info
      if (node['owl:deprecated'] === true || node['deprecated'] === true) {
        this.deprecatedTypes.set(localName, {
          deprecated: true,
          replacedBy: node['bke:replacedBy'] || node['replacedBy'] || null,
          reason: node['bke:deprecationReason'] || node['deprecationReason'] || null,
          date: node['bke:deprecationDate'] || node['deprecationDate'] || null,
          removalVersion: node['bke:removalVersion'] || node['removalVersion'] || null,
          migrationGuide: node['bke:migrationGuide'] || node['migrationGuide'] || null
        });
      }
    }

    // Also load from the bke:deprecatedTypes array in ontology metadata
    const versionMetadata = this.ontology['bke:versionMetadata'] || {};
    const deprecations = versionMetadata['bke:deprecations'] || [];

    for (const deprecation of deprecations) {
      const typeName = deprecation.type || deprecation.name;
      if (typeName && !this.deprecatedTypes.has(typeName)) {
        this.deprecatedTypes.set(typeName, {
          deprecated: true,
          replacedBy: deprecation.replacedBy || null,
          reason: deprecation.reason || null,
          date: deprecation.date || null,
          removalVersion: deprecation.removalVersion || null,
          migrationGuide: deprecation.migrationGuide || null
        });
      }
    }
  }

  /**
   * Extract local name from a URI (e.g., "bke:Process" -> "Process")
   */
  _extractLocalName(uri) {
    if (!uri) return null;

    if (uri.includes(':')) {
      return uri.split(':').pop();
    }
    if (uri.includes('/')) {
      return uri.split('/').pop();
    }
    if (uri.includes('#')) {
      return uri.split('#').pop();
    }
    return uri;
  }

  // ==================== Validation Methods ====================

  /**
   * Validate if an entity type is defined in the ontology
   * @param {string} type - The entity type to validate
   * @param {Object} options - Validation options
   * @param {boolean} options.warnOnDeprecated - Include deprecation warnings (default: true)
   * @returns {{ valid: boolean, message?: string, suggestion?: string, deprecated?: boolean, deprecationWarning?: string, replacement?: string }}
   */
  validateEntityType(type, options = {}) {
    this._ensureInitialized();

    const warnOnDeprecated = options.warnOnDeprecated !== false;

    if (!type) {
      return { valid: false, message: 'Entity type is required' };
    }

    // Check exact match
    if (this.entityTypes.has(type)) {
      const result = { valid: true };

      // Check for deprecation (F2.2.3)
      if (warnOnDeprecated && this.isTypeDeprecated(type)) {
        const info = this.getDeprecationInfo(type);
        result.deprecated = true;
        result.deprecationWarning = this.getDeprecationWarning(type);
        result.replacement = info?.replacedBy ? this._extractLocalName(info.replacedBy) : null;
      }

      return result;
    }

    // Check case-insensitive match
    const lowerType = type.toLowerCase();
    for (const [knownType] of this.entityTypes) {
      if (knownType.toLowerCase() === lowerType) {
        return {
          valid: false,
          message: `Entity type "${type}" not found, but "${knownType}" exists`,
          suggestion: knownType
        };
      }
    }

    // Find similar types
    const similar = this._findSimilarTypes(type, [...this.entityTypes.keys()]);
    if (similar.length > 0) {
      return {
        valid: false,
        message: `Entity type "${type}" is not defined in the ontology`,
        suggestion: similar[0]
      };
    }

    return {
      valid: false,
      message: `Entity type "${type}" is not defined in the ontology`
    };
  }

  /**
   * Validate a relationship including domain/range constraints
   * @param {string} relationshipType - The relationship type
   * @param {string} sourceEntityType - The source entity's type
   * @param {string} targetEntityType - The target entity's type
   * @param {Object} options - Validation options
   * @param {boolean} options.warnOnDeprecated - Include deprecation warnings (default: true)
   * @returns {{ valid: boolean, domainValid: boolean, rangeValid: boolean, warnings: string[], deprecated?: boolean, deprecationWarning?: string, replacement?: string }}
   */
  validateRelationship(relationshipType, sourceEntityType, targetEntityType, options = {}) {
    this._ensureInitialized();

    const warnOnDeprecated = options.warnOnDeprecated !== false;

    const result = {
      valid: true,
      domainValid: true,
      rangeValid: true,
      warnings: [],
      normalizedType: relationshipType
    };

    if (!relationshipType) {
      return { ...result, valid: false, warnings: ['Relationship type is required'] };
    }

    // Normalize the relationship type
    const normalizedType = this.normalizeRelationshipType(relationshipType);
    result.normalizedType = normalizedType;

    // Check if relationship type exists
    const relInfo = this.relationshipTypes.get(normalizedType);
    if (!relInfo) {
      result.valid = false;
      result.warnings.push(`Relationship type "${relationshipType}" is not defined in the ontology`);
      return result;
    }

    // Check for deprecation (F2.2.3)
    if (warnOnDeprecated && this.isTypeDeprecated(normalizedType)) {
      const info = this.getDeprecationInfo(normalizedType);
      result.deprecated = true;
      result.deprecationWarning = this.getDeprecationWarning(normalizedType);
      result.replacement = info?.replacedBy ? this._extractLocalName(info.replacedBy) : null;
      result.warnings.push(result.deprecationWarning);
    }

    // Check if source entity type is deprecated
    if (warnOnDeprecated && sourceEntityType && this.isTypeDeprecated(sourceEntityType)) {
      result.warnings.push(this.getDeprecationWarning(sourceEntityType));
    }

    // Check if target entity type is deprecated
    if (warnOnDeprecated && targetEntityType && this.isTypeDeprecated(targetEntityType)) {
      result.warnings.push(this.getDeprecationWarning(targetEntityType));
    }

    // Validate domain constraint (source entity type)
    if (sourceEntityType && relInfo.domain !== 'Entity') {
      const domainValid = this._isTypeCompatible(sourceEntityType, relInfo.domain);
      if (!domainValid) {
        result.domainValid = false;
        result.warnings.push(
          `Source type "${sourceEntityType}" violates domain constraint: ${relationshipType} expects ${relInfo.domain} or its subtypes`
        );
      }
    }

    // Validate range constraint (target entity type)
    if (targetEntityType && relInfo.range !== 'Entity') {
      const rangeValid = this._isTypeCompatible(targetEntityType, relInfo.range);
      if (!rangeValid) {
        result.rangeValid = false;
        result.warnings.push(
          `Target type "${targetEntityType}" violates range constraint: ${relationshipType} expects ${relInfo.range} or its subtypes`
        );
      }
    }

    // Set overall validity
    result.valid = result.domainValid && result.rangeValid;

    return result;
  }

  /**
   * Check if a type is compatible with a constraint (same type or subtype)
   */
  _isTypeCompatible(actualType, constraintType) {
    if (!actualType || !constraintType) return true;

    // Exact match
    if (actualType === constraintType) return true;

    // Check if actualType is a subtype of constraintType
    const ancestors = this.typeHierarchy.get(actualType);
    if (ancestors && ancestors.has(constraintType)) return true;

    return false;
  }

  /**
   * Normalize a relationship type using synonym mappings
   * @param {string} type - The relationship type to normalize
   * @returns {string} - The canonical relationship type
   */
  normalizeRelationshipType(type) {
    if (!type) return type;

    const upperType = type.toUpperCase();

    // Check if it's already a valid type
    if (this.relationshipTypes.has(upperType)) {
      return upperType;
    }

    // Check synonym mappings
    const lowerType = type.toLowerCase().replace(/_/g, '').replace(/-/g, '');
    const canonical = this.synonymMappings.get(lowerType) ||
                      this.synonymMappings.get(type.toLowerCase());

    return canonical || upperType;
  }

  // ==================== Query Methods ====================

  /**
   * Get all valid entity types
   * @returns {Array<{ name: string, label: string, comment: string, parent: string }>}
   */
  getValidEntityTypes() {
    this._ensureInitialized();

    return Array.from(this.entityTypes.entries())
      .filter(([name]) => !name.includes('Relationship') && !name.includes('Entity')) // Filter base classes
      .map(([name, info]) => ({
        name,
        label: info.label,
        comment: info.comment,
        parent: info.parent,
        isCustom: !!info.isCustom
      }));
  }

  /**
   * Get all valid relationship types with their constraints
   * @returns {Array<{ name: string, label: string, domain: string, range: string }>}
   */
  getValidRelationshipTypes() {
    this._ensureInitialized();

    return Array.from(this.relationshipTypes.entries())
      .map(([name, info]) => ({
        name,
        label: info.label,
        comment: info.comment,
        domain: info.domain,
        range: info.range,
        inverse: info.inverse,
        category: info.category
      }));
  }

  /**
   * Get the type hierarchy (all ancestors) for a type
   * @param {string} type - The entity type
   * @returns {string[]} - Array of ancestor types from immediate parent to root
   */
  getTypeAncestors(type) {
    this._ensureInitialized();

    const ancestors = [];
    let current = type;

    while (current) {
      const typeInfo = this.entityTypes.get(current);
      if (!typeInfo || !typeInfo.parent) break;

      ancestors.push(typeInfo.parent);
      current = typeInfo.parent;
    }

    return ancestors;
  }

  /**
   * Get all subtypes of a given type
   * @param {string} type - The parent type
   * @returns {string[]} - Array of subtype names
   */
  getSubtypes(type) {
    this._ensureInitialized();

    const typeInfo = this.entityTypes.get(type);
    if (!typeInfo) return [];

    const subtypes = [];
    const stack = [...typeInfo.children];

    while (stack.length > 0) {
      const child = stack.pop();
      subtypes.push(child);

      const childInfo = this.entityTypes.get(child);
      if (childInfo && childInfo.children) {
        stack.push(...childInfo.children);
      }
    }

    return subtypes;
  }

  /**
   * Check if a type is a subtype of another
   * @param {string} type - The potential subtype
   * @param {string} parentType - The potential parent type
   * @returns {boolean}
   */
  isSubtypeOf(type, parentType) {
    this._ensureInitialized();

    if (type === parentType) return true;

    const ancestors = this.typeHierarchy.get(type);
    return ancestors ? ancestors.has(parentType) : false;
  }

  /**
   * Expand a type to include itself and all subtypes (for polymorphic queries)
   * Feature: F2.1.2 - Type Inheritance / Polymorphic Queries
   *
   * @param {string} type - The parent type to expand
   * @param {Object} options - Options
   * @param {boolean} options.includeParent - Include the parent type itself (default: true)
   * @returns {{ types: string[], hierarchy: Object }}
   */
  expandTypeWithSubtypes(type, options = {}) {
    this._ensureInitialized();

    const includeParent = options.includeParent !== false;
    const types = [];
    const hierarchy = {};

    if (!type) {
      return { types: [], hierarchy: {} };
    }

    // Check if the type exists in ontology
    if (!this.entityTypes.has(type)) {
      // Try case-insensitive match
      const matchingType = [...this.entityTypes.keys()].find(
        t => t.toLowerCase() === type.toLowerCase()
      );
      if (matchingType) {
        type = matchingType;
      } else {
        // Type not found - return just the requested type for graceful degradation
        return {
          types: includeParent ? [type] : [],
          hierarchy: includeParent ? { [type]: { isLeaf: true, depth: 0 } } : {},
          warning: `Type "${type}" not found in ontology`
        };
      }
    }

    // Add parent type
    if (includeParent) {
      types.push(type);
      hierarchy[type] = { isLeaf: false, depth: 0, isRoot: true };
    }

    // Get all subtypes recursively
    const subtypes = this.getSubtypes(type);
    for (const subtype of subtypes) {
      types.push(subtype);

      // Calculate depth in hierarchy (number of hops from root type)
      let depth = 0;
      let current = subtype;
      while (current && current !== type) {
        const typeInfo = this.entityTypes.get(current);
        if (!typeInfo || !typeInfo.parent) break;
        current = typeInfo.parent;
        depth++;
      }

      const subtypeInfo = this.entityTypes.get(subtype);
      hierarchy[subtype] = {
        isLeaf: !subtypeInfo?.children || subtypeInfo.children.length === 0,
        depth: depth,
        parent: subtypeInfo?.parent
      };
    }

    // Update parent's isLeaf flag
    if (includeParent && subtypes.length > 0) {
      hierarchy[type].isLeaf = false;
    }

    return { types, hierarchy };
  }

  /**
   * Get the full type tree starting from a given type
   * Feature: F2.1.2 - Type Inheritance / Polymorphic Queries
   *
   * @param {string} type - The root type
   * @returns {Object} Tree structure with children
   */
  getTypeTree(type) {
    this._ensureInitialized();

    if (!type || !this.entityTypes.has(type)) {
      return null;
    }

    const typeInfo = this.entityTypes.get(type);

    const buildTree = (typeName) => {
      const info = this.entityTypes.get(typeName);
      if (!info) return null;

      return {
        name: typeName,
        label: info.label,
        comment: info.comment,
        children: (info.children || []).map(child => buildTree(child)).filter(Boolean)
      };
    };

    return buildTree(type);
  }

  /**
   * Get domain constraint for a relationship
   * @param {string} relationshipType
   * @returns {string|null}
   */
  getDomainForRelationship(relationshipType) {
    this._ensureInitialized();

    const normalized = this.normalizeRelationshipType(relationshipType);
    const relInfo = this.relationshipTypes.get(normalized);
    return relInfo ? relInfo.domain : null;
  }

  /**
   * Get range constraint for a relationship
   * @param {string} relationshipType
   * @returns {string|null}
   */
  getRangeForRelationship(relationshipType) {
    this._ensureInitialized();

    const normalized = this.normalizeRelationshipType(relationshipType);
    const relInfo = this.relationshipTypes.get(normalized);
    return relInfo ? relInfo.range : null;
  }

  /**
   * Get inverse relationship type if defined
   * @param {string} relationshipType
   * @returns {string|null}
   */
  getInverseRelationship(relationshipType) {
    this._ensureInitialized();

    const normalized = this.normalizeRelationshipType(relationshipType);
    const relInfo = this.relationshipTypes.get(normalized);
    return relInfo ? relInfo.inverse : null;
  }

  // ==================== Batch Validation ====================

  /**
   * Generate a comprehensive validation report for entities and relationships
   * @param {Array<{name: string, type: string}>} entities
   * @param {Array<{from: string, to: string, type: string}>} relationships
   * @param {Object} options - Validation options
   * @param {boolean} options.warnOnDeprecated - Include deprecation warnings (default: true)
   * @returns {{ valid: boolean, entityReport: object, relationshipReport: object, deprecationReport: object }}
   */
  generateValidationReport(entities, relationships, options = {}) {
    this._ensureInitialized();

    const warnOnDeprecated = options.warnOnDeprecated !== false;

    const entityReport = {
      total: entities.length,
      valid: 0,
      invalid: 0,
      deprecated: 0,
      issues: []
    };

    const relationshipReport = {
      total: relationships.length,
      valid: 0,
      domainViolations: 0,
      rangeViolations: 0,
      unknownTypes: 0,
      deprecated: 0,
      issues: []
    };

    const deprecationReport = {
      entityTypes: [],
      relationshipTypes: [],
      warnings: []
    };

    // Build entity type map for relationship validation
    const entityTypeMap = new Map();
    const seenDeprecatedTypes = new Set();

    // Validate entities
    for (const entity of entities) {
      const result = this.validateEntityType(entity.type, { warnOnDeprecated });
      if (result.valid) {
        entityReport.valid++;
        entityTypeMap.set(entity.name, entity.type);

        // Track deprecated entity types (F2.2.3)
        if (warnOnDeprecated && result.deprecated) {
          entityReport.deprecated++;
          if (!seenDeprecatedTypes.has(entity.type)) {
            seenDeprecatedTypes.add(entity.type);
            deprecationReport.entityTypes.push({
              type: entity.type,
              warning: result.deprecationWarning,
              replacement: result.replacement
            });
          }
          deprecationReport.warnings.push({
            entity: entity.name,
            type: entity.type,
            warning: result.deprecationWarning,
            replacement: result.replacement
          });
        }
      } else {
        entityReport.invalid++;
        entityReport.issues.push({
          entity: entity.name,
          type: entity.type,
          message: result.message,
          suggestion: result.suggestion
        });
        // Still add to map for relationship validation
        entityTypeMap.set(entity.name, entity.type);
      }
    }

    // Validate relationships
    for (const rel of relationships) {
      const sourceType = entityTypeMap.get(rel.from);
      const targetType = entityTypeMap.get(rel.to);

      const result = this.validateRelationship(rel.type, sourceType, targetType, { warnOnDeprecated });

      if (result.valid && result.warnings.length === 0) {
        relationshipReport.valid++;
      } else {
        if (!result.valid && !this.relationshipTypes.has(result.normalizedType)) {
          relationshipReport.unknownTypes++;
        }
        if (!result.domainValid) {
          relationshipReport.domainViolations++;
        }
        if (!result.rangeValid) {
          relationshipReport.rangeViolations++;
        }

        // Track deprecated relationship types (F2.2.3)
        if (warnOnDeprecated && result.deprecated) {
          relationshipReport.deprecated++;
          if (!seenDeprecatedTypes.has(result.normalizedType)) {
            seenDeprecatedTypes.add(result.normalizedType);
            deprecationReport.relationshipTypes.push({
              type: result.normalizedType,
              warning: result.deprecationWarning,
              replacement: result.replacement
            });
          }
        }

        if (result.warnings.length > 0) {
          relationshipReport.issues.push({
            from: rel.from,
            to: rel.to,
            type: rel.type,
            normalizedType: result.normalizedType,
            warnings: result.warnings,
            deprecated: result.deprecated || false
          });
        }
      }
    }

    return {
      valid: entityReport.invalid === 0 && relationshipReport.issues.length === 0,
      entityReport,
      relationshipReport,
      deprecationReport,
      summary: {
        totalIssues: entityReport.issues.length + relationshipReport.issues.length,
        entityTypeIssues: entityReport.invalid,
        domainViolations: relationshipReport.domainViolations,
        rangeViolations: relationshipReport.rangeViolations,
        unknownRelationshipTypes: relationshipReport.unknownTypes,
        deprecatedEntityTypes: entityReport.deprecated,
        deprecatedRelationshipTypes: relationshipReport.deprecated,
        totalDeprecationWarnings: deprecationReport.warnings.length
      }
    };
  }

  // ==================== Utility Methods ====================

  /**
   * Find similar type names using Levenshtein distance
   */
  _findSimilarTypes(type, validTypes, maxDistance = 3) {
    const similar = [];
    const lowerType = type.toLowerCase();

    for (const validType of validTypes) {
      const distance = this._levenshteinDistance(lowerType, validType.toLowerCase());
      if (distance <= maxDistance) {
        similar.push({ type: validType, distance });
      }
    }

    return similar
      .sort((a, b) => a.distance - b.distance)
      .map(s => s.type);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  _levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('OntologyService not initialized. Call initialize() first.');
    }
  }

  /**
   * Get ontology metadata
   */
  getOntologyMetadata() {
    this._ensureInitialized();

    return {
      id: this.ontology['@id'],
      label: this.ontology.label,
      version: this.ontology['owl:versionInfo'] || this.ontology['schema:version'],
      dateCreated: this.ontology['schema:dateCreated'],
      entityTypeCount: this.entityTypes.size,
      relationshipTypeCount: this.relationshipTypes.size,
      synonymMappingCount: this.synonymMappings.size
    };
  }

  // ==================== Versioning Methods (F2.2.1) ====================

  /**
   * Get comprehensive version information
   * Feature: F2.2.1 - Ontology Version Field
   *
   * @returns {Object} Complete version metadata
   */
  getVersionInfo() {
    this._ensureInitialized();

    const versionMetadata = this.ontology['bke:versionMetadata'] || {};

    return {
      version: this.ontology['owl:versionInfo'] || '0.0.0',
      versionIRI: this.ontology['owl:versionIRI'] || null,
      priorVersion: this.ontology['owl:priorVersion'] || null,
      backwardCompatibleWith: this.ontology['owl:backwardCompatibleWith'] || null,
      incompatibleWith: this.ontology['owl:incompatibleWith'] || null,

      parsed: this.parseVersion(this.ontology['owl:versionInfo'] || '0.0.0'),

      metadata: {
        major: versionMetadata['bke:major'] || 0,
        minor: versionMetadata['bke:minor'] || 0,
        patch: versionMetadata['bke:patch'] || 0,
        preRelease: versionMetadata['bke:preRelease'] || null,
        buildMetadata: versionMetadata['bke:buildMetadata'] || null,
        releaseNotes: versionMetadata['bke:releaseNotes'] || null,
        breakingChanges: versionMetadata['bke:breakingChanges'] || false,
        deprecations: versionMetadata['bke:deprecations'] || []
      },

      dates: {
        created: this.ontology['schema:dateCreated'] || this.ontology['pav:createdOn'] || null,
        modified: this.ontology['schema:dateModified'] || this.ontology['pav:lastUpdateOn'] || null
      },

      author: this.ontology['schema:author'] || null
    };
  }

  /**
   * Parse a semantic version string into components
   * Supports: major.minor.patch[-prerelease][+build]
   *
   * @param {string} versionString - The version string to parse (e.g., "1.2.3-beta.1+build.123")
   * @returns {{ major: number, minor: number, patch: number, preRelease: string|null, buildMetadata: string|null, valid: boolean }}
   */
  parseVersion(versionString) {
    if (!versionString || typeof versionString !== 'string') {
      return { major: 0, minor: 0, patch: 0, preRelease: null, buildMetadata: null, valid: false };
    }

    // Semantic versioning regex: major.minor.patch[-prerelease][+build]
    const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
    const match = versionString.match(semverRegex);

    if (!match) {
      // Try simple format: major.minor.patch
      const simpleMatch = versionString.match(/^(\d+)\.(\d+)\.(\d+)$/);
      if (simpleMatch) {
        return {
          major: parseInt(simpleMatch[1], 10),
          minor: parseInt(simpleMatch[2], 10),
          patch: parseInt(simpleMatch[3], 10),
          preRelease: null,
          buildMetadata: null,
          valid: true
        };
      }

      return { major: 0, minor: 0, patch: 0, preRelease: null, buildMetadata: null, valid: false };
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      preRelease: match[4] || null,
      buildMetadata: match[5] || null,
      valid: true
    };
  }

  /**
   * Compare two semantic versions
   *
   * @param {string} versionA - First version string
   * @param {string} versionB - Second version string
   * @returns {number} -1 if A < B, 0 if A == B, 1 if A > B
   */
  compareVersions(versionA, versionB) {
    const a = this.parseVersion(versionA);
    const b = this.parseVersion(versionB);

    // Compare major
    if (a.major !== b.major) {
      return a.major > b.major ? 1 : -1;
    }

    // Compare minor
    if (a.minor !== b.minor) {
      return a.minor > b.minor ? 1 : -1;
    }

    // Compare patch
    if (a.patch !== b.patch) {
      return a.patch > b.patch ? 1 : -1;
    }

    // Pre-release versions have lower precedence than release versions
    if (a.preRelease && !b.preRelease) return -1;
    if (!a.preRelease && b.preRelease) return 1;

    // Compare pre-release identifiers
    if (a.preRelease && b.preRelease) {
      const aParts = a.preRelease.split('.');
      const bParts = b.preRelease.split('.');

      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i];
        const bPart = bParts[i];

        if (aPart === undefined) return -1;
        if (bPart === undefined) return 1;

        const aNum = parseInt(aPart, 10);
        const bNum = parseInt(bPart, 10);

        // If both are numeric, compare as numbers
        if (!isNaN(aNum) && !isNaN(bNum)) {
          if (aNum !== bNum) return aNum > bNum ? 1 : -1;
        } else if (!isNaN(aNum)) {
          // Numeric identifiers have lower precedence than alphanumeric
          return -1;
        } else if (!isNaN(bNum)) {
          return 1;
        } else {
          // Compare as strings
          if (aPart !== bPart) return aPart > bPart ? 1 : -1;
        }
      }
    }

    return 0;
  }

  /**
   * Check if a version is compatible with another version
   * Compatible means same major version (for versions >= 1.0.0) or same minor version (for 0.x.x)
   *
   * @param {string} version - The version to check
   * @param {string} requiredVersion - The required/base version
   * @returns {{ compatible: boolean, reason: string }}
   */
  isVersionCompatible(version, requiredVersion) {
    const v = this.parseVersion(version);
    const r = this.parseVersion(requiredVersion);

    if (!v.valid || !r.valid) {
      return { compatible: false, reason: 'Invalid version format' };
    }

    // For 0.x.x versions, breaking changes can occur in minor versions
    if (r.major === 0) {
      if (v.major !== r.major || v.minor !== r.minor) {
        return {
          compatible: false,
          reason: `Pre-1.0 version: requires exact minor version match (${r.major}.${r.minor}.x)`
        };
      }
      return { compatible: true, reason: 'Same major and minor version (pre-1.0)' };
    }

    // For >= 1.0.0, same major version is compatible
    if (v.major !== r.major) {
      return {
        compatible: false,
        reason: `Major version mismatch: ${v.major} vs ${r.major}`
      };
    }

    return { compatible: true, reason: `Same major version (${r.major}.x.x)` };
  }

  /**
   * Determine the type of change between two versions
   *
   * @param {string} fromVersion - The original version
   * @param {string} toVersion - The new version
   * @returns {{ type: 'major'|'minor'|'patch'|'prerelease'|'none', breaking: boolean, description: string }}
   */
  getVersionChangeType(fromVersion, toVersion) {
    const from = this.parseVersion(fromVersion);
    const to = this.parseVersion(toVersion);

    if (!from.valid || !to.valid) {
      return { type: 'none', breaking: false, description: 'Invalid version format' };
    }

    if (to.major > from.major) {
      return {
        type: 'major',
        breaking: true,
        description: `Major version bump (${from.major} -> ${to.major}): may contain breaking changes`
      };
    }

    if (to.major < from.major) {
      return {
        type: 'major',
        breaking: true,
        description: `Major version downgrade (${from.major} -> ${to.major}): may cause incompatibilities`
      };
    }

    if (to.minor > from.minor) {
      return {
        type: 'minor',
        breaking: from.major === 0, // Pre-1.0 minor bumps can be breaking
        description: `Minor version bump (${from.minor} -> ${to.minor}): new features, backward compatible${from.major === 0 ? ' (pre-1.0: may be breaking)' : ''}`
      };
    }

    if (to.minor < from.minor) {
      return {
        type: 'minor',
        breaking: true,
        description: `Minor version downgrade (${from.minor} -> ${to.minor}): may miss features`
      };
    }

    if (to.patch !== from.patch) {
      return {
        type: 'patch',
        breaking: false,
        description: `Patch version change (${from.patch} -> ${to.patch}): bug fixes only`
      };
    }

    if (from.preRelease !== to.preRelease) {
      return {
        type: 'prerelease',
        breaking: false,
        description: `Pre-release change (${from.preRelease || 'release'} -> ${to.preRelease || 'release'})`
      };
    }

    return { type: 'none', breaking: false, description: 'No version change' };
  }

  /**
   * Get the version history from the ontology
   *
   * @returns {Array<Object>} Array of version records
   */
  getVersionHistory() {
    this._ensureInitialized();

    const history = this.ontology['bke:versionHistory'] || [];

    return history.map(record => ({
      version: record['bke:version'],
      versionIRI: record['bke:versionIRI'],
      releaseDate: record['bke:releaseDate'],
      description: record['bke:description'],
      changes: record['bke:changes'] || [],
      addedTypes: record['bke:addedTypes'] || [],
      removedTypes: record['bke:removedTypes'] || [],
      deprecatedTypes: record['bke:deprecatedTypes'] || [],
      modifiedTypes: record['bke:modifiedTypes'] || []
    }));
  }

  /**
   * Get changes between the current version and a specified version
   *
   * @param {string} fromVersion - The version to compare from (defaults to prior version)
   * @returns {Object|null} Changes summary or null if version not found
   */
  getChangesFromVersion(fromVersion = null) {
    this._ensureInitialized();

    const history = this.getVersionHistory();
    const currentVersion = this.ontology['owl:versionInfo'];

    if (!fromVersion) {
      fromVersion = this.ontology['owl:priorVersion'];
      if (!fromVersion) {
        return {
          from: null,
          to: currentVersion,
          changes: 'No prior version - this is the initial release',
          details: history.find(h => h.version === currentVersion) || null
        };
      }
    }

    // Find all versions between fromVersion and currentVersion
    const relevantRecords = history.filter(record => {
      const cmp = this.compareVersions(record.version, fromVersion);
      return cmp > 0 || (cmp === 0 && record.version !== fromVersion);
    });

    // Aggregate changes
    const allChanges = [];
    const allAddedTypes = [];
    const allRemovedTypes = [];
    const allDeprecatedTypes = [];

    for (const record of relevantRecords) {
      allChanges.push(...record.changes);
      allAddedTypes.push(...record.addedTypes);
      allRemovedTypes.push(...record.removedTypes);
      allDeprecatedTypes.push(...record.deprecatedTypes);
    }

    return {
      from: fromVersion,
      to: currentVersion,
      changeType: this.getVersionChangeType(fromVersion, currentVersion),
      versionRecords: relevantRecords.length,
      changes: allChanges,
      addedTypes: [...new Set(allAddedTypes)],
      removedTypes: [...new Set(allRemovedTypes)],
      deprecatedTypes: [...new Set(allDeprecatedTypes)]
    };
  }

  /**
   * Format a version string in a specific format
   *
   * @param {string} version - The version to format
   * @param {'full'|'short'|'semantic'|'iri'} format - The output format
   * @returns {string}
   */
  formatVersion(version, format = 'full') {
    const parsed = this.parseVersion(version);

    if (!parsed.valid) {
      return version; // Return as-is if invalid
    }

    switch (format) {
      case 'short':
        return `v${parsed.major}.${parsed.minor}`;

      case 'semantic':
        let sem = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
        if (parsed.preRelease) sem += `-${parsed.preRelease}`;
        if (parsed.buildMetadata) sem += `+${parsed.buildMetadata}`;
        return sem;

      case 'iri':
        const baseIRI = this.ontology['@id'] || 'https://business-knowledge-engine.io/ontology/business-process';
        return `${baseIRI}/${parsed.major}.${parsed.minor}.${parsed.patch}`;

      case 'full':
      default:
        return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.preRelease ? '-' + parsed.preRelease : ''}`;
    }
  }

  /**
   * Validate that a version string follows semantic versioning
   *
   * @param {string} version - The version string to validate
   * @returns {{ valid: boolean, errors: string[], normalized: string }}
   */
  validateVersion(version) {
    const errors = [];

    if (!version || typeof version !== 'string') {
      return { valid: false, errors: ['Version must be a non-empty string'], normalized: null };
    }

    const parsed = this.parseVersion(version);

    if (!parsed.valid) {
      errors.push('Version does not follow semantic versioning format (MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD])');
    }

    if (parsed.major < 0 || parsed.minor < 0 || parsed.patch < 0) {
      errors.push('Version numbers cannot be negative');
    }

    return {
      valid: errors.length === 0,
      errors,
      normalized: errors.length === 0 ? this.formatVersion(version, 'semantic') : null
    };
  }

  /**
   * Generate the next version number based on change type
   *
   * @param {'major'|'minor'|'patch'} changeType - The type of version bump
   * @param {string} preRelease - Optional pre-release identifier
   * @returns {string} The new version string
   */
  getNextVersion(changeType = 'patch', preRelease = null) {
    this._ensureInitialized();

    const current = this.parseVersion(this.ontology['owl:versionInfo'] || '0.0.0');

    let major = current.major;
    let minor = current.minor;
    let patch = current.patch;

    switch (changeType) {
      case 'major':
        major++;
        minor = 0;
        patch = 0;
        break;
      case 'minor':
        minor++;
        patch = 0;
        break;
      case 'patch':
      default:
        patch++;
        break;
    }

    let newVersion = `${major}.${minor}.${patch}`;
    if (preRelease) {
      newVersion += `-${preRelease}`;
    }

    return newVersion;
  }

  // ==================== Deprecation Methods (F2.2.3) ====================

  /**
   * Check if a type (entity or relationship) is deprecated
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {string} type - The type name to check
   * @returns {boolean} True if the type is deprecated
   */
  isTypeDeprecated(type) {
    this._ensureInitialized();

    if (!type) return false;
    return this.deprecatedTypes.has(type);
  }

  /**
   * Get deprecation information for a type
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {string} type - The type name
   * @returns {Object|null} Deprecation info or null if not deprecated
   */
  getDeprecationInfo(type) {
    this._ensureInitialized();

    if (!type) return null;
    return this.deprecatedTypes.get(type) || null;
  }

  /**
   * Get the replacement type for a deprecated type
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {string} type - The deprecated type name
   * @returns {string|null} The replacement type name or null
   */
  getReplacementType(type) {
    this._ensureInitialized();

    const info = this.deprecatedTypes.get(type);
    if (!info) return null;

    // Extract local name if it's a full URI
    const replacement = info.replacedBy;
    if (!replacement) return null;

    return this._extractLocalName(replacement);
  }

  /**
   * Get all deprecated types
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {Object} options - Filter options
   * @param {string} options.category - Filter by 'entity' or 'relationship'
   * @param {boolean} options.withReplacement - Only types with replacement defined
   * @returns {Array<{type: string, ...deprecationInfo}>}
   */
  getDeprecatedTypes(options = {}) {
    this._ensureInitialized();

    const { category, withReplacement } = options;
    const results = [];

    for (const [type, info] of this.deprecatedTypes) {
      // Filter by category if specified
      if (category === 'entity' && !this.entityTypes.has(type)) {
        continue;
      }
      if (category === 'relationship' && !this.relationshipTypes.has(type)) {
        continue;
      }

      // Filter by replacement availability
      if (withReplacement && !info.replacedBy) {
        continue;
      }

      results.push({
        type,
        category: this.entityTypes.has(type) ? 'entity' :
                  this.relationshipTypes.has(type) ? 'relationship' : 'unknown',
        ...info,
        replacement: info.replacedBy ? this._extractLocalName(info.replacedBy) : null
      });
    }

    return results;
  }

  /**
   * Deprecate a type programmatically (runtime only, does not persist)
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {string} type - The type to deprecate
   * @param {Object} options - Deprecation options
   * @param {string} options.replacedBy - The replacement type
   * @param {string} options.reason - Reason for deprecation
   * @param {string} options.removalVersion - Planned removal version
   * @param {string} options.migrationGuide - Migration instructions or URL
   * @returns {{ success: boolean, message: string }}
   */
  deprecateType(type, options = {}) {
    this._ensureInitialized();

    if (!type) {
      return { success: false, message: 'Type name is required' };
    }

    // Verify the type exists
    const isEntityType = this.entityTypes.has(type);
    const isRelationshipType = this.relationshipTypes.has(type);

    if (!isEntityType && !isRelationshipType) {
      return {
        success: false,
        message: `Type "${type}" is not defined in the ontology`
      };
    }

    // Verify replacement type if specified
    if (options.replacedBy) {
      const replacementExists = this.entityTypes.has(options.replacedBy) ||
                                this.relationshipTypes.has(options.replacedBy);
      if (!replacementExists) {
        return {
          success: false,
          message: `Replacement type "${options.replacedBy}" is not defined in the ontology`
        };
      }

      // Warn if trying to replace with a deprecated type
      if (this.deprecatedTypes.has(options.replacedBy)) {
        console.warn(`[OntologyService] Warning: Replacement type "${options.replacedBy}" is also deprecated`);
      }
    }

    // Add to deprecatedTypes map
    this.deprecatedTypes.set(type, {
      deprecated: true,
      replacedBy: options.replacedBy || null,
      reason: options.reason || null,
      date: options.date || new Date().toISOString().split('T')[0],
      removalVersion: options.removalVersion || null,
      migrationGuide: options.migrationGuide || null
    });

    console.log(`[OntologyService] Type "${type}" marked as deprecated${options.replacedBy ? ` (replaced by ${options.replacedBy})` : ''}`);

    return {
      success: true,
      message: `Type "${type}" has been deprecated`,
      info: this.deprecatedTypes.get(type)
    };
  }

  /**
   * Undeprecate a type programmatically (runtime only, does not persist)
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {string} type - The type to undeprecate
   * @returns {{ success: boolean, message: string }}
   */
  undeprecateType(type) {
    this._ensureInitialized();

    if (!type) {
      return { success: false, message: 'Type name is required' };
    }

    if (!this.deprecatedTypes.has(type)) {
      return { success: false, message: `Type "${type}" is not deprecated` };
    }

    this.deprecatedTypes.delete(type);
    console.log(`[OntologyService] Type "${type}" is no longer deprecated`);

    return {
      success: true,
      message: `Type "${type}" deprecation has been removed`
    };
  }

  /**
   * Generate a deprecation warning message for a type
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {string} type - The deprecated type
   * @returns {string|null} Warning message or null if not deprecated
   */
  getDeprecationWarning(type) {
    this._ensureInitialized();

    const info = this.deprecatedTypes.get(type);
    if (!info) return null;

    let warning = `Type "${type}" is deprecated`;

    if (info.replacedBy) {
      const replacement = this._extractLocalName(info.replacedBy);
      warning += `. Use "${replacement}" instead`;
    }

    if (info.reason) {
      warning += `. Reason: ${info.reason}`;
    }

    if (info.removalVersion) {
      warning += `. Will be removed in version ${info.removalVersion}`;
    }

    return warning;
  }

  /**
   * Get a migration path from a deprecated type to its replacement
   * Follows the replacement chain if multiple levels of deprecation exist
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @param {string} type - The deprecated type
   * @param {number} maxDepth - Maximum chain depth to follow (default: 5)
   * @returns {{ path: string[], currentType: string, migrationGuides: string[] }}
   */
  getMigrationPath(type, maxDepth = 5) {
    this._ensureInitialized();

    const path = [type];
    const migrationGuides = [];
    let current = type;
    let depth = 0;

    while (depth < maxDepth) {
      const info = this.deprecatedTypes.get(current);
      if (!info || !info.replacedBy) {
        break;
      }

      const replacement = this._extractLocalName(info.replacedBy);

      // Check for circular references
      if (path.includes(replacement)) {
        console.warn(`[OntologyService] Circular deprecation chain detected: ${path.join(' -> ')} -> ${replacement}`);
        break;
      }

      path.push(replacement);
      if (info.migrationGuide) {
        migrationGuides.push({
          from: current,
          to: replacement,
          guide: info.migrationGuide
        });
      }

      current = replacement;
      depth++;
    }

    return {
      path,
      currentType: current,
      isDeprecationChain: path.length > 2,
      migrationGuides
    };
  }

  /**
   * Check all deprecated types for issues (circular references, missing replacements, etc.)
   * Feature: F2.2.3 - Type Deprecation Support
   *
   * @returns {{ valid: boolean, issues: Array<{type: string, issue: string}> }}
   */
  validateDeprecations() {
    this._ensureInitialized();

    const issues = [];

    for (const [type, info] of this.deprecatedTypes) {
      // Check if replacement exists
      if (info.replacedBy) {
        const replacement = this._extractLocalName(info.replacedBy);
        const replacementExists = this.entityTypes.has(replacement) ||
                                  this.relationshipTypes.has(replacement);
        if (!replacementExists) {
          issues.push({
            type,
            issue: `Replacement type "${replacement}" does not exist in the ontology`
          });
        }

        // Check for circular references
        const migrationPath = this.getMigrationPath(type);
        if (migrationPath.path.length > 1 &&
            migrationPath.path[0] === migrationPath.path[migrationPath.path.length - 1]) {
          issues.push({
            type,
            issue: `Circular deprecation chain detected: ${migrationPath.path.join(' -> ')}`
          });
        }

        // Check if replacement is also deprecated without its own replacement
        const replacementInfo = this.deprecatedTypes.get(replacement);
        if (replacementInfo && !replacementInfo.replacedBy) {
          issues.push({
            type,
            issue: `Replacement "${replacement}" is also deprecated but has no replacement defined`,
            severity: 'warning'
          });
        }
      }

      // Check for missing reason
      if (!info.reason) {
        issues.push({
          type,
          issue: 'Missing deprecation reason',
          severity: 'warning'
        });
      }
    }

    return {
      valid: issues.filter(i => i.severity !== 'warning').length === 0,
      totalDeprecated: this.deprecatedTypes.size,
      issues
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton OntologyService instance
 * @returns {OntologyService}
 */
function getOntologyService() {
  if (!instance) {
    instance = new OntologyService();
  }
  return instance;
}

/**
 * Initialize and get the OntologyService
 * @returns {Promise<OntologyService>}
 */
async function initializeOntologyService() {
  const service = getOntologyService();
  await service.initialize();
  return service;
}

module.exports = {
  OntologyService,
  getOntologyService,
  initializeOntologyService
};
