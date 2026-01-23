/**
 * Persona Definitions Service (F6.3.1)
 *
 * Defines personas for personalized GraphRAG responses:
 * - Operations (Ops): Focus on processes, tasks, workflows
 * - IT: Focus on systems, applications, technical infrastructure
 * - Leadership: Focus on metrics, KPIs, strategic overview
 * - Compliance: Focus on policies, regulations, standards
 *
 * Each persona includes:
 * - Entity type weights for retrieval prioritization
 * - Summary style preferences (technical vs executive)
 * - Relationship type preferences
 * - Context assembly hints
 *
 * @see F6.3.2 for persona retrieval weights integration
 * @see F6.3.3 for persona summary style integration
 * @see F6.3.4 for persona selection API
 */

const { log } = require('../utils/logger');

// Persona identifiers
const PERSONA_IDS = {
  OPS: 'ops',
  IT: 'it',
  LEADERSHIP: 'leadership',
  COMPLIANCE: 'compliance',
  DEFAULT: 'default',
};

// Entity categories from ontology
const ENTITY_CATEGORIES = {
  BUSINESS_FLOW: ['Process', 'Task', 'Activity', 'Decision'],
  ORGANIZATIONAL: ['Role', 'Department', 'Stakeholder'],
  TECHNICAL: ['System', 'Application', 'Database'],
  ARTIFACT: ['Document', 'Form', 'Template'],
  GOVERNANCE: ['Policy', 'Regulation', 'Standard'],
  MEASUREMENT: ['Metric', 'KPI'],
};

// Summary style configurations
const SUMMARY_STYLES = {
  TECHNICAL: {
    id: 'technical',
    description: 'Detailed technical language with specific terminology',
    maxLength: 1500,
    includeImplementationDetails: true,
    includeMetrics: true,
    useTechnicalTerms: true,
    promptHint: 'Provide a detailed technical response with specific implementation details, system names, and technical metrics.',
  },
  EXECUTIVE: {
    id: 'executive',
    description: 'High-level business language focused on outcomes and impact',
    maxLength: 800,
    includeImplementationDetails: false,
    includeMetrics: true,
    useTechnicalTerms: false,
    promptHint: 'Provide a concise executive summary focused on business impact, key metrics, and strategic implications. Avoid technical jargon.',
  },
  OPERATIONAL: {
    id: 'operational',
    description: 'Process-focused language with actionable details',
    maxLength: 1200,
    includeImplementationDetails: true,
    includeMetrics: true,
    useTechnicalTerms: false,
    promptHint: 'Provide an operational response with clear process steps, roles involved, and actionable details.',
  },
  COMPLIANCE: {
    id: 'compliance',
    description: 'Formal language emphasizing requirements and controls',
    maxLength: 1000,
    includeImplementationDetails: false,
    includeMetrics: false,
    useTechnicalTerms: false,
    promptHint: 'Provide a compliance-focused response emphasizing regulatory requirements, control measures, and policy adherence.',
  },
  BALANCED: {
    id: 'balanced',
    description: 'Balanced language suitable for mixed audiences',
    maxLength: 1000,
    includeImplementationDetails: true,
    includeMetrics: true,
    useTechnicalTerms: false,
    promptHint: 'Provide a balanced response that is accessible to various audiences while maintaining accuracy.',
  },
};

/**
 * Persona Definitions
 *
 * Each persona defines:
 * - id: Unique identifier
 * - name: Display name
 * - description: Human-readable description
 * - entityWeights: Weight (0-1) for each entity type
 * - categoryWeights: Weight for entity categories
 * - relationshipWeights: Weight for relationship types
 * - summaryStyle: Preferred summary style
 * - contextPreferences: Hints for context assembly
 */
const PERSONAS = {
  [PERSONA_IDS.OPS]: {
    id: PERSONA_IDS.OPS,
    name: 'Operations',
    description: 'Operations team members focused on day-to-day business processes and workflows',
    icon: 'settings',

    // Entity type weights (0-1 scale, higher = more relevant)
    entityWeights: {
      // Business Flow - Primary focus
      Process: 1.0,
      Task: 1.0,
      Activity: 0.9,
      Decision: 0.8,
      // Organizational - High relevance
      Role: 0.9,
      Department: 0.7,
      Stakeholder: 0.8,
      // Technical - Medium relevance
      System: 0.6,
      Application: 0.6,
      Database: 0.3,
      // Artifacts - High relevance
      Document: 0.8,
      Form: 0.9,
      Template: 0.8,
      // Governance - Medium relevance
      Policy: 0.5,
      Regulation: 0.4,
      Standard: 0.5,
      // Measurement - Medium relevance
      Metric: 0.6,
      KPI: 0.5,
    },

    // Category-level weights for fallback
    categoryWeights: {
      BUSINESS_FLOW: 1.0,
      ORGANIZATIONAL: 0.85,
      TECHNICAL: 0.5,
      ARTIFACT: 0.85,
      GOVERNANCE: 0.45,
      MEASUREMENT: 0.55,
    },

    // Relationship type preferences (0-1 scale)
    relationshipWeights: {
      PERFORMS: 1.0,
      RESPONSIBLE_FOR: 1.0,
      PART_OF: 0.9,
      FOLLOWS: 0.9,
      PRECEDES: 0.9,
      DEPENDS_ON: 0.8,
      USES: 0.8,
      PRODUCES: 0.9,
      CONSUMES: 0.8,
      REQUIRES: 0.7,
      TRIGGERS: 0.8,
      GOVERNS: 0.5,
      OWNED_BY: 0.7,
      RELATED_TO: 0.6,
    },

    summaryStyle: SUMMARY_STYLES.OPERATIONAL,

    contextPreferences: {
      maxEntities: 12,
      maxRelationships: 40,
      maxHops: 2,
      includeProcessContext: true,
      includeRoleContext: true,
      includeTechnicalContext: false,
      prioritizeRecentDocuments: true,
    },

    // Example questions this persona might ask
    exampleQueries: [
      'How do I complete the monthly reconciliation process?',
      'Who is responsible for approving purchase orders?',
      'What forms do I need to submit for expense reimbursement?',
      'What are the steps in the onboarding process?',
    ],
  },

  [PERSONA_IDS.IT]: {
    id: PERSONA_IDS.IT,
    name: 'IT / Technology',
    description: 'IT professionals focused on systems, applications, and technical infrastructure',
    icon: 'code',

    entityWeights: {
      // Business Flow - Medium relevance
      Process: 0.6,
      Task: 0.5,
      Activity: 0.4,
      Decision: 0.5,
      // Organizational - Medium relevance
      Role: 0.5,
      Department: 0.4,
      Stakeholder: 0.4,
      // Technical - Primary focus
      System: 1.0,
      Application: 1.0,
      Database: 1.0,
      // Artifacts - Medium relevance
      Document: 0.6,
      Form: 0.4,
      Template: 0.5,
      // Governance - Medium relevance (security policies)
      Policy: 0.6,
      Regulation: 0.5,
      Standard: 0.7,
      // Measurement - High relevance (system metrics)
      Metric: 0.8,
      KPI: 0.6,
    },

    categoryWeights: {
      BUSINESS_FLOW: 0.5,
      ORGANIZATIONAL: 0.45,
      TECHNICAL: 1.0,
      ARTIFACT: 0.5,
      GOVERNANCE: 0.6,
      MEASUREMENT: 0.7,
    },

    relationshipWeights: {
      INTEGRATES_WITH: 1.0,
      DEPENDS_ON: 1.0,
      USES: 0.9,
      CONNECTS_TO: 1.0,
      STORES_IN: 1.0,
      READS_FROM: 0.9,
      WRITES_TO: 0.9,
      HOSTS: 0.9,
      OWNED_BY: 0.7,
      SUPPORTS: 0.8,
      REQUIRES: 0.9,
      PART_OF: 0.7,
      GOVERNS: 0.6,
      RELATED_TO: 0.5,
    },

    summaryStyle: SUMMARY_STYLES.TECHNICAL,

    contextPreferences: {
      maxEntities: 15,
      maxRelationships: 50,
      maxHops: 3,
      includeProcessContext: false,
      includeRoleContext: false,
      includeTechnicalContext: true,
      prioritizeRecentDocuments: false,
    },

    exampleQueries: [
      'What databases does the CRM system connect to?',
      'Which applications integrate with our ERP?',
      'What are the dependencies for the reporting system?',
      'How is data transferred between systems?',
    ],
  },

  [PERSONA_IDS.LEADERSHIP]: {
    id: PERSONA_IDS.LEADERSHIP,
    name: 'Leadership / Executive',
    description: 'Executives and senior leadership focused on strategic metrics and business outcomes',
    icon: 'trending_up',

    entityWeights: {
      // Business Flow - High-level only
      Process: 0.8,
      Task: 0.3,
      Activity: 0.2,
      Decision: 0.7,
      // Organizational - High relevance
      Role: 0.6,
      Department: 0.9,
      Stakeholder: 0.8,
      // Technical - Low relevance
      System: 0.3,
      Application: 0.3,
      Database: 0.1,
      // Artifacts - Medium relevance
      Document: 0.5,
      Form: 0.2,
      Template: 0.3,
      // Governance - Medium relevance
      Policy: 0.6,
      Regulation: 0.5,
      Standard: 0.4,
      // Measurement - Primary focus
      Metric: 1.0,
      KPI: 1.0,
    },

    categoryWeights: {
      BUSINESS_FLOW: 0.5,
      ORGANIZATIONAL: 0.8,
      TECHNICAL: 0.25,
      ARTIFACT: 0.35,
      GOVERNANCE: 0.5,
      MEASUREMENT: 1.0,
    },

    relationshipWeights: {
      MEASURES: 1.0,
      OWNED_BY: 0.9,
      REPORTS_TO: 0.9,
      RESPONSIBLE_FOR: 0.8,
      GOVERNS: 0.7,
      IMPACTS: 0.9,
      DEPENDS_ON: 0.6,
      PART_OF: 0.7,
      RELATED_TO: 0.5,
      FOLLOWS: 0.4,
      USES: 0.3,
    },

    summaryStyle: SUMMARY_STYLES.EXECUTIVE,

    contextPreferences: {
      maxEntities: 8,
      maxRelationships: 20,
      maxHops: 2,
      includeProcessContext: false,
      includeRoleContext: true,
      includeTechnicalContext: false,
      prioritizeRecentDocuments: true,
    },

    exampleQueries: [
      'What are our key performance indicators this quarter?',
      'Which departments are underperforming?',
      'What is the status of our strategic initiatives?',
      'How do our metrics compare to industry benchmarks?',
    ],
  },

  [PERSONA_IDS.COMPLIANCE]: {
    id: PERSONA_IDS.COMPLIANCE,
    name: 'Compliance / Risk',
    description: 'Compliance officers and risk managers focused on regulations, policies, and controls',
    icon: 'gavel',

    entityWeights: {
      // Business Flow - Medium relevance (for audit trails)
      Process: 0.7,
      Task: 0.5,
      Activity: 0.4,
      Decision: 0.6,
      // Organizational - Medium relevance
      Role: 0.7,
      Department: 0.6,
      Stakeholder: 0.5,
      // Technical - Medium relevance (data governance)
      System: 0.5,
      Application: 0.4,
      Database: 0.6,
      // Artifacts - High relevance
      Document: 0.9,
      Form: 0.7,
      Template: 0.6,
      // Governance - Primary focus
      Policy: 1.0,
      Regulation: 1.0,
      Standard: 1.0,
      // Measurement - Medium relevance
      Metric: 0.6,
      KPI: 0.5,
    },

    categoryWeights: {
      BUSINESS_FLOW: 0.55,
      ORGANIZATIONAL: 0.6,
      TECHNICAL: 0.5,
      ARTIFACT: 0.75,
      GOVERNANCE: 1.0,
      MEASUREMENT: 0.55,
    },

    relationshipWeights: {
      GOVERNS: 1.0,
      ENFORCES: 1.0,
      REQUIRES: 1.0,
      COMPLIES_WITH: 1.0,
      AUDITED_BY: 0.9,
      CONTROLS: 0.9,
      DOCUMENTS: 0.8,
      RESPONSIBLE_FOR: 0.8,
      OWNED_BY: 0.7,
      RELATED_TO: 0.6,
      DEPENDS_ON: 0.5,
      PART_OF: 0.6,
    },

    summaryStyle: SUMMARY_STYLES.COMPLIANCE,

    contextPreferences: {
      maxEntities: 10,
      maxRelationships: 30,
      maxHops: 2,
      includeProcessContext: true,
      includeRoleContext: true,
      includeTechnicalContext: false,
      prioritizeRecentDocuments: false,
    },

    exampleQueries: [
      'What regulations govern our data handling practices?',
      'Who is responsible for GDPR compliance?',
      'What controls are in place for financial reporting?',
      'Which policies apply to third-party vendors?',
    ],
  },

  [PERSONA_IDS.DEFAULT]: {
    id: PERSONA_IDS.DEFAULT,
    name: 'General User',
    description: 'Default persona with balanced weights across all entity types',
    icon: 'person',

    entityWeights: {
      Process: 0.7,
      Task: 0.7,
      Activity: 0.6,
      Decision: 0.6,
      Role: 0.7,
      Department: 0.6,
      Stakeholder: 0.6,
      System: 0.6,
      Application: 0.6,
      Database: 0.5,
      Document: 0.7,
      Form: 0.6,
      Template: 0.6,
      Policy: 0.6,
      Regulation: 0.5,
      Standard: 0.5,
      Metric: 0.7,
      KPI: 0.7,
    },

    categoryWeights: {
      BUSINESS_FLOW: 0.7,
      ORGANIZATIONAL: 0.65,
      TECHNICAL: 0.55,
      ARTIFACT: 0.65,
      GOVERNANCE: 0.55,
      MEASUREMENT: 0.7,
    },

    relationshipWeights: {
      PERFORMS: 0.7,
      RESPONSIBLE_FOR: 0.7,
      PART_OF: 0.7,
      DEPENDS_ON: 0.7,
      USES: 0.7,
      GOVERNS: 0.6,
      RELATED_TO: 0.6,
    },

    summaryStyle: SUMMARY_STYLES.BALANCED,

    contextPreferences: {
      maxEntities: 10,
      maxRelationships: 30,
      maxHops: 2,
      includeProcessContext: true,
      includeRoleContext: true,
      includeTechnicalContext: true,
      prioritizeRecentDocuments: false,
    },

    exampleQueries: [
      'How does our organization handle customer complaints?',
      'What systems are used for project management?',
      'Who should I contact about benefits questions?',
    ],
  },
};

/**
 * Persona Service Class
 * Provides access to persona definitions and utility functions
 */
class PersonaService {
  constructor() {
    this.personas = { ...PERSONAS };
    this.entityCategories = { ...ENTITY_CATEGORIES };
    this.summaryStyles = { ...SUMMARY_STYLES };
    this.initialized = false;
  }

  /**
   * Initialize the service
   */
  initialize() {
    if (this.initialized) return;
    log.info('PersonaService initialized', {
      personaCount: Object.keys(this.personas).length,
      entityCategories: Object.keys(this.entityCategories).length,
    });
    this.initialized = true;
  }

  /**
   * Get all available persona IDs
   * @returns {string[]} Array of persona IDs
   */
  getPersonaIds() {
    return Object.keys(this.personas);
  }

  /**
   * Get all personas
   * @returns {Object} Map of persona ID to persona definition
   */
  getAllPersonas() {
    return { ...this.personas };
  }

  /**
   * Get a persona by ID
   * @param {string} personaId - Persona identifier
   * @returns {Object|null} Persona definition or null if not found
   */
  getPersona(personaId) {
    const id = (personaId || '').toLowerCase();
    return this.personas[id] || null;
  }

  /**
   * Get persona or default if not found
   * @param {string} personaId - Persona identifier
   * @returns {Object} Persona definition (default if not found)
   */
  getPersonaOrDefault(personaId) {
    return this.getPersona(personaId) || this.personas[PERSONA_IDS.DEFAULT];
  }

  /**
   * Check if a persona exists
   * @param {string} personaId - Persona identifier
   * @returns {boolean} True if persona exists
   */
  hasPersona(personaId) {
    const id = (personaId || '').toLowerCase();
    return id in this.personas;
  }

  /**
   * Get entity weight for a persona
   * @param {string} personaId - Persona identifier
   * @param {string} entityType - Entity type name
   * @returns {number} Weight (0-1), defaults to 0.5 if not found
   */
  getEntityWeight(personaId, entityType) {
    const persona = this.getPersonaOrDefault(personaId);
    return persona.entityWeights[entityType] ?? 0.5;
  }

  /**
   * Get all entity weights for a persona
   * @param {string} personaId - Persona identifier
   * @returns {Object} Map of entity type to weight
   */
  getEntityWeights(personaId) {
    const persona = this.getPersonaOrDefault(personaId);
    return { ...persona.entityWeights };
  }

  /**
   * Get category weight for a persona
   * @param {string} personaId - Persona identifier
   * @param {string} category - Entity category name
   * @returns {number} Weight (0-1), defaults to 0.5 if not found
   */
  getCategoryWeight(personaId, category) {
    const persona = this.getPersonaOrDefault(personaId);
    return persona.categoryWeights[category] ?? 0.5;
  }

  /**
   * Get relationship weight for a persona
   * @param {string} personaId - Persona identifier
   * @param {string} relationshipType - Relationship type name
   * @returns {number} Weight (0-1), defaults to 0.5 if not found
   */
  getRelationshipWeight(personaId, relationshipType) {
    const persona = this.getPersonaOrDefault(personaId);
    return persona.relationshipWeights[relationshipType] ?? 0.5;
  }

  /**
   * Get summary style for a persona
   * @param {string} personaId - Persona identifier
   * @returns {Object} Summary style configuration
   */
  getSummaryStyle(personaId) {
    const persona = this.getPersonaOrDefault(personaId);
    return { ...persona.summaryStyle };
  }

  /**
   * Get context preferences for a persona
   * @param {string} personaId - Persona identifier
   * @returns {Object} Context preferences
   */
  getContextPreferences(personaId) {
    const persona = this.getPersonaOrDefault(personaId);
    return { ...persona.contextPreferences };
  }

  /**
   * Get category for an entity type
   * @param {string} entityType - Entity type name
   * @returns {string|null} Category name or null if not found
   */
  getEntityCategory(entityType) {
    for (const [category, types] of Object.entries(this.entityCategories)) {
      if (types.includes(entityType)) {
        return category;
      }
    }
    return null;
  }

  /**
   * Calculate weighted score for an entity based on persona
   * Combines entity type weight with importance score
   *
   * @param {string} personaId - Persona identifier
   * @param {string} entityType - Entity type
   * @param {number} importanceScore - Optional importance score (0-1)
   * @param {number} similarityScore - Optional similarity score (0-1)
   * @returns {number} Combined weighted score
   */
  calculateEntityScore(personaId, entityType, importanceScore = 0.5, similarityScore = 0.5) {
    const typeWeight = this.getEntityWeight(personaId, entityType);

    // Weighted combination: 40% persona weight, 30% importance, 30% similarity
    const combinedScore =
      0.4 * typeWeight + 0.3 * importanceScore + 0.3 * similarityScore;

    return Math.min(1, Math.max(0, combinedScore));
  }

  /**
   * Rank entities by persona relevance
   * @param {string} personaId - Persona identifier
   * @param {Array} entities - Array of entities with type and optional scores
   * @returns {Array} Entities sorted by persona-weighted score (descending)
   */
  rankEntitiesByPersona(personaId, entities) {
    const scored = entities.map((entity) => {
      const score = this.calculateEntityScore(
        personaId,
        entity.type || entity.ontologyType,
        entity.importance || 0.5,
        entity.similarity || entity.score || 0.5
      );
      return { ...entity, personaScore: score };
    });

    return scored.sort((a, b) => b.personaScore - a.personaScore);
  }

  /**
   * Filter entities by persona relevance threshold
   * @param {string} personaId - Persona identifier
   * @param {Array} entities - Array of entities
   * @param {number} threshold - Minimum score threshold (default 0.3)
   * @returns {Array} Filtered entities
   */
  filterEntitiesByPersona(personaId, entities, threshold = 0.3) {
    return this.rankEntitiesByPersona(personaId, entities).filter(
      (e) => e.personaScore >= threshold
    );
  }

  /**
   * Generate persona-specific prompt hint for LLM
   * @param {string} personaId - Persona identifier
   * @returns {string} Prompt hint for LLM context
   */
  getPromptHint(personaId) {
    const persona = this.getPersonaOrDefault(personaId);
    const style = persona.summaryStyle;

    return `Target audience: ${persona.name}. ${style.promptHint}`;
  }

  /**
   * Get brief persona summary for API response
   * @param {string} personaId - Persona identifier
   * @returns {Object} Persona summary
   */
  getPersonaSummary(personaId) {
    const persona = this.getPersonaOrDefault(personaId);
    return {
      id: persona.id,
      name: persona.name,
      description: persona.description,
      icon: persona.icon,
      summaryStyle: persona.summaryStyle.id,
    };
  }

  /**
   * Get all persona summaries for API response
   * @returns {Array} Array of persona summaries
   */
  getAllPersonaSummaries() {
    return Object.values(this.personas).map((persona) => ({
      id: persona.id,
      name: persona.name,
      description: persona.description,
      icon: persona.icon,
      summaryStyle: persona.summaryStyle.id,
      exampleQueries: persona.exampleQueries || [],
    }));
  }

  /**
   * Validate a persona ID
   * @param {string} personaId - Persona identifier to validate
   * @returns {Object} Validation result { valid: boolean, message?: string, normalized?: string }
   */
  validatePersonaId(personaId) {
    if (!personaId || typeof personaId !== 'string') {
      return {
        valid: false,
        message: 'Persona ID must be a non-empty string',
      };
    }

    const normalized = personaId.toLowerCase().trim();

    if (this.hasPersona(normalized)) {
      return {
        valid: true,
        normalized,
      };
    }

    const available = this.getPersonaIds().join(', ');
    return {
      valid: false,
      message: `Unknown persona ID '${personaId}'. Available personas: ${available}`,
    };
  }

  /**
   * Get statistics about personas
   * @returns {Object} Persona statistics
   */
  getStats() {
    const personas = Object.values(this.personas);
    return {
      totalPersonas: personas.length,
      entityCategories: Object.keys(this.entityCategories).length,
      summaryStyles: Object.keys(this.summaryStyles).length,
      personaList: personas.map((p) => ({ id: p.id, name: p.name })),
    };
  }

  /**
   * Reset to default state (for testing)
   */
  reset() {
    this.personas = { ...PERSONAS };
    this.initialized = false;
  }
}

// Singleton instance
let personaService = null;

/**
 * Get or create the singleton PersonaService instance
 * @returns {PersonaService}
 */
function getPersonaService() {
  if (!personaService) {
    personaService = new PersonaService();
    personaService.initialize();
  }
  return personaService;
}

/**
 * Reset the singleton (for testing)
 */
function resetPersonaService() {
  personaService = null;
}

module.exports = {
  PersonaService,
  getPersonaService,
  resetPersonaService,
  PERSONA_IDS,
  ENTITY_CATEGORIES,
  SUMMARY_STYLES,
  PERSONAS,
};
