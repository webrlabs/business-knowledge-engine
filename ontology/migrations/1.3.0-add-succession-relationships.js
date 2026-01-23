/**
 * Migration: Add Succession and Deprecation Relationships
 * Version: 1.3.0
 * Target Ontology Version: 1.3.0
 *
 * Adds relationship types for entity succession and deprecation tracking.
 * This enables:
 * - Tracking when one entity instance replaces another (e.g., system replacement)
 * - Explicitly marking entities as deprecated by other entities
 *
 * New relationship types:
 * - REPLACED_BY: Entity succession (e.g., Legacy System REPLACED_BY Modern System)
 * - REPLACES: Inverse of REPLACED_BY
 * - DEPRECATED_BY: Deprecation tracking
 * - DEPRECATES: Inverse of DEPRECATED_BY
 */

module.exports = {
  version: '1.3.0',
  name: 'add-succession-relationships',
  description: 'Add REPLACED_BY and DEPRECATED_BY relationship types for entity succession and lifecycle tracking',
  targetOntologyVersion: '1.3.0',

  /**
   * Apply the migration
   * @param {MigrationContext} context - Migration context with helpers
   */
  async up(context) {
    // Add EntityLifecycleRelationship class
    context.addEntityType('EntityLifecycleRelationship', {
      label: 'Entity Lifecycle Relationship',
      comment: 'Relationships for entity lifecycle, succession, and deprecation tracking',
      parent: 'Relationship',
    });

    // Add REPLACED_BY relationship type
    context.addRelationshipType('REPLACED_BY', {
      label: 'replaced by',
      comment: 'Indicates that the source entity has been replaced by the target entity (e.g., system replacement)',
      domain: 'Entity',
      range: 'Entity',
      category: 'EntityLifecycleRelationship',
      inverseOf: 'REPLACES',
    });

    // Add REPLACES relationship type
    context.addRelationshipType('REPLACES', {
      label: 'replaces',
      comment: 'Indicates that the source entity replaces the target entity',
      domain: 'Entity',
      range: 'Entity',
      category: 'EntityLifecycleRelationship',
      inverseOf: 'REPLACED_BY',
    });

    // Add DEPRECATED_BY relationship type
    context.addRelationshipType('DEPRECATED_BY', {
      label: 'deprecated by',
      comment: 'Indicates that the source entity is deprecated by the target entity',
      domain: 'Entity',
      range: 'Entity',
      category: 'EntityLifecycleRelationship',
      inverseOf: 'DEPRECATES',
    });

    // Add DEPRECATES relationship type
    context.addRelationshipType('DEPRECATES', {
      label: 'deprecates',
      comment: 'Indicates that the source entity deprecates the target entity',
      domain: 'Entity',
      range: 'Entity',
      category: 'EntityLifecycleRelationship',
      inverseOf: 'DEPRECATED_BY',
    });

    // Note: Data initialization for these relationships is not needed as they are new concepts
  },

  /**
   * Rollback the migration (reverse of up)
   * @param {MigrationContext} context - Migration context with helpers
   */
  async down(context) {
    // Remove relationship types
    context.removeRelationshipType('DEPRECATES');
    context.removeRelationshipType('DEPRECATED_BY');
    context.removeRelationshipType('REPLACES');
    context.removeRelationshipType('REPLACED_BY');

    // Remove the entity lifecycle relationship class
    context.removeEntityType('EntityLifecycleRelationship');
  },

  /**
   * Validate migration can be applied
   * @param {MigrationContext} context - Migration context
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  async validate(context) {
    const errors = [];
    const ontologyService = context.ontologyService;

    if (ontologyService) {
      // Check if relationship types already exist
      const existing = ['REPLACED_BY', 'REPLACES', 'DEPRECATED_BY', 'DEPRECATES'];
      for (const rel of existing) {
        if (ontologyService.relationshipTypes && ontologyService.relationshipTypes.has(rel)) {
          errors.push(`Relationship type "${rel}" already exists in ontology`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};
