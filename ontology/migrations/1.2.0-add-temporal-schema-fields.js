/**
 * Migration: Add Temporal Schema Fields
 * Version: 1.2.0
 * Target Ontology Version: 1.2.0
 *
 * Adds temporal versioning fields to support entity history and time-aware queries.
 * This enables:
 * - Tracking when entities become valid and expire
 * - Versioning entities when they change over time
 * - Querying the knowledge graph at specific points in time
 *
 * New properties:
 * - validFrom: When entity becomes valid (defaults to createdAt)
 * - validTo: When entity expires (null = currently valid)
 * - supersededBy: Reference to replacement entity
 * - supersedes: Reference to entity this replaces
 * - temporalStatus: 'current', 'expired', 'pending', or 'superseded'
 * - versionSequence: Version number for chronological ordering
 *
 * New relationship types:
 * - SUPERSEDED_BY: Entity version replacement relationship
 * - SUPERSEDES: Inverse of SUPERSEDED_BY
 */

module.exports = {
  version: '1.2.0',
  name: 'add-temporal-schema-fields',
  description: 'Add temporal versioning fields (validFrom, validTo, supersededBy, temporalStatus) for time-aware entity modeling',
  targetOntologyVersion: '1.2.0',

  /**
   * Apply the migration
   * @param {MigrationContext} context - Migration context with helpers
   */
  async up(context) {
    // Add temporal properties to Entity base class
    context.addProperty('validFrom', {
      type: 'xsd:dateTime',
      domain: 'Entity',
      description: 'The date/time when this entity version becomes valid. Defaults to createdAt if not specified.',
      equivalentProperty: 'schema:validFrom',
    });

    context.addProperty('validTo', {
      type: 'xsd:dateTime',
      domain: 'Entity',
      description: 'The date/time when this entity version expires. Null indicates currently valid with no expiration.',
      equivalentProperty: 'schema:validThrough',
    });

    context.addProperty('supersededBy', {
      type: '@id',
      domain: 'Entity',
      range: 'Entity',
      description: 'Reference to the entity that replaces this version.',
    });

    context.addProperty('supersedes', {
      type: '@id',
      domain: 'Entity',
      range: 'Entity',
      description: 'Reference to the previous entity version that this entity replaces.',
      inverseOf: 'supersededBy',
    });

    context.addProperty('temporalStatus', {
      type: 'xsd:string',
      domain: 'Entity',
      description: "Status: 'current' (valid now), 'expired' (validTo passed), 'pending' (validFrom in future), or 'superseded' (replaced).",
      allowedValues: ['current', 'expired', 'pending', 'superseded'],
      defaultValue: 'current',
    });

    context.addProperty('versionSequence', {
      type: 'xsd:integer',
      domain: 'Entity',
      description: 'Monotonically increasing version number for chronological ordering.',
      defaultValue: 1,
    });

    // Add EntityVersionRelationship class
    context.addEntityType('EntityVersionRelationship', {
      label: 'Entity Version Relationship',
      comment: 'Relationships for entity versioning and temporal modeling',
      parent: 'Relationship',
    });

    // Add SUPERSEDED_BY relationship type
    context.addRelationshipType('SUPERSEDED_BY', {
      label: 'superseded by',
      comment: 'Indicates that the source entity has been replaced by the target entity',
      domain: 'Entity',
      range: 'Entity',
      category: 'EntityVersionRelationship',
      inverseOf: 'SUPERSEDES',
    });

    // Add SUPERSEDES relationship type
    context.addRelationshipType('SUPERSEDES', {
      label: 'supersedes',
      comment: 'Indicates that the source entity replaces the target entity',
      domain: 'Entity',
      range: 'Entity',
      category: 'EntityVersionRelationship',
      inverseOf: 'SUPERSEDED_BY',
    });

    // Initialize temporal fields on existing entities if graph service is available
    if (!context.dryRun && context.graphService) {
      try {
        // Set default values for existing entities:
        // - validFrom = createdAt (or current time if no createdAt)
        // - temporalStatus = 'current'
        // - versionSequence = 1
        const updateQuery = `
          g.V()
            .hasNot('temporalStatus')
            .property('temporalStatus', 'current')
            .property('versionSequence', 1)
        `;

        await context.graphService._submit(updateQuery, {});

        // For entities with createdAt, copy it to validFrom
        const copyValidFromQuery = `
          g.V()
            .has('createdAt')
            .hasNot('validFrom')
            .as('v')
            .values('createdAt')
            .as('created')
            .select('v')
            .property('validFrom', select('created'))
        `;

        try {
          await context.graphService._submit(copyValidFromQuery, {});
          context.addWarning('Initialized temporal fields on existing entities');
        } catch (err) {
          // This query may not work on all Gremlin implementations
          // Fall back to individual updates if needed
          context.addWarning(`Could not batch copy validFrom: ${err.message}`);
        }
      } catch (error) {
        context.addWarning(`Data initialization skipped: ${error.message}`);
      }
    }
  },

  /**
   * Rollback the migration (reverse of up)
   * @param {MigrationContext} context - Migration context with helpers
   */
  async down(context) {
    // Remove relationship types first
    context.removeRelationshipType('SUPERSEDES');
    context.removeRelationshipType('SUPERSEDED_BY');

    // Remove the entity version relationship class
    context.removeEntityType('EntityVersionRelationship');

    // Remove properties
    context.removeProperty('versionSequence');
    context.removeProperty('temporalStatus');
    context.removeProperty('supersedes');
    context.removeProperty('supersededBy');
    context.removeProperty('validTo');
    context.removeProperty('validFrom');

    // Note: Existing property values on entities are preserved in the graph
    // They become "unschematized" properties after rollback
    if (!context.dryRun && context.graphService) {
      context.addWarning(
        'Temporal property values on existing entities have been preserved. ' +
        'To fully remove them, run a separate cleanup script.'
      );
    }
  },

  /**
   * Validate migration can be applied
   * @param {MigrationContext} context - Migration context
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  async validate(context) {
    const errors = [];

    // Check that ontology service is available
    const ontologyService = context.ontologyService;
    if (ontologyService) {
      // Check that Entity base type exists
      const entityValidation = ontologyService.validateEntityType('Entity');
      if (!entityValidation.valid) {
        errors.push('Base type "Entity" must exist before adding temporal properties');
      }

      // Check that Relationship base type exists
      const relationshipValidation = ontologyService.validateEntityType('Relationship');
      if (relationshipValidation.valid) {
        // Good - Relationship exists
      } else {
        // This might be OK if Relationship is defined differently
        context.addWarning('Relationship type may not be defined as an entity type');
      }

      // Check that SUPERSEDED_BY doesn't already exist
      if (ontologyService.isValidRelationshipType &&
          ontologyService.isValidRelationshipType('SUPERSEDED_BY')) {
        errors.push('Relationship type "SUPERSEDED_BY" already exists');
      }
    }

    // Check for conflicting property names
    if (context.graphService) {
      try {
        // Check if any entities already have these properties with different semantics
        const checkQuery = `
          g.V()
            .or(
              has('validFrom'),
              has('validTo'),
              has('supersededBy'),
              has('temporalStatus'),
              has('versionSequence')
            )
            .limit(1)
            .count()
        `;
        const result = await context.graphService._submit(checkQuery, {});
        if (result[0] > 0) {
          context.addWarning(
            'Some entities already have temporal properties. ' +
            'Migration will update their semantics to match the new schema.'
          );
        }
      } catch (error) {
        // Query check is optional
        context.addWarning(`Could not check existing properties: ${error.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};
