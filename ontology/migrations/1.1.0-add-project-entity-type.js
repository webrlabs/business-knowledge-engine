/**
 * Migration: Add Project Entity Type
 * Version: 1.1.0
 * Target Ontology Version: 1.1.0
 *
 * Adds a new "Project" entity type to the ontology, representing
 * organizational projects that span multiple processes and involve
 * various stakeholders and systems.
 *
 * This migration also adds PROJECT_MANAGES and ASSIGNED_TO relationships.
 */

module.exports = {
  version: '1.1.0',
  name: 'add-project-entity-type',
  description: 'Add Project entity type and related relationships for project management tracking',
  targetOntologyVersion: '1.1.0',

  /**
   * Apply the migration
   * @param {MigrationContext} context - Migration context with helpers
   */
  async up(context) {
    // Add the Project entity type as a subtype of BusinessFlowEntity
    context.addEntityType('Project', {
      label: 'Project',
      comment: 'Organizational projects that coordinate processes, resources, and deliverables',
      parent: 'BusinessFlowEntity',
      schemaMapping: 'schema:Project',
      properties: {
        startDate: { type: 'xsd:date', description: 'Project start date' },
        endDate: { type: 'xsd:date', description: 'Project end date' },
        status: { type: 'xsd:string', description: 'Project status (planning, active, completed, on-hold)' },
        budget: { type: 'xsd:decimal', description: 'Project budget' },
      },
    });

    // Add MANAGES_PROJECT relationship - Role/Stakeholder manages a Project
    context.addRelationshipType('MANAGES_PROJECT', {
      label: 'manages project',
      comment: 'Role or stakeholder who manages or leads a project',
      domain: 'OrganizationalEntity',
      range: 'Project',
      category: 'OrganizationalRelationship',
    });

    // Add ASSIGNED_TO relationship - Entity is assigned to a Project
    context.addRelationshipType('ASSIGNED_TO', {
      label: 'assigned to',
      comment: 'Resource or task assigned to a project',
      domain: 'Entity',
      range: 'Project',
      category: 'OrganizationalRelationship',
    });

    // Add DELIVERS relationship - Project delivers an artifact or outcome
    context.addRelationshipType('DELIVERS', {
      label: 'delivers',
      comment: 'Project produces or delivers an artifact or outcome',
      domain: 'Project',
      range: 'ArtifactEntity',
      category: 'DependencyRelationship',
    });

    // If we have graph service and not in dry-run, we could transform existing data
    // For example, if there were entities previously tagged as "Initiative" that
    // should become Projects:
    if (!context.dryRun && context.graphService) {
      try {
        // Example: Re-type "Initiative" entities to "Project"
        // const count = await context.graphService.updateEntitiesByType('Initiative', {
        //   type: 'Project',
        // });
        // context.recordEntitiesAffected(count);
        context.addWarning('No existing data transformation performed (example migration)');
      } catch (error) {
        context.addWarning(`Data transformation skipped: ${error.message}`);
      }
    }
  },

  /**
   * Rollback the migration (reverse of up)
   * @param {MigrationContext} context - Migration context with helpers
   */
  async down(context) {
    // Remove the relationships first (due to dependencies)
    context.removeRelationshipType('DELIVERS');
    context.removeRelationshipType('ASSIGNED_TO');
    context.removeRelationshipType('MANAGES_PROJECT');

    // Remove the entity type
    context.removeEntityType('Project');

    // If not dry-run, we might need to handle existing Project entities
    if (!context.dryRun && context.graphService) {
      context.addWarning(
        'Existing Project entities should be manually reviewed and migrated before rollback'
      );

      // Example: Count affected entities
      // const count = await context.graphService.countEntitiesByType('Project');
      // if (count > 0) {
      //   throw new Error(`Cannot rollback: ${count} Project entities exist. Migrate them first.`);
      // }
    }
  },

  /**
   * Validate migration can be applied
   * @param {MigrationContext} context - Migration context
   * @returns {{ valid: boolean, errors?: string[] }}
   */
  async validate(context) {
    const errors = [];

    // Check that the parent type exists
    const ontologyService = context.ontologyService;
    if (ontologyService) {
      const parentValidation = ontologyService.validateEntityType('BusinessFlowEntity');
      if (!parentValidation.valid) {
        errors.push('Parent type "BusinessFlowEntity" must exist before adding Project');
      }

      // Check that Project doesn't already exist
      const projectValidation = ontologyService.validateEntityType('Project');
      if (projectValidation.valid) {
        errors.push('Entity type "Project" already exists');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};
