/**
 * Extraction Prompt Variants
 *
 * Multiple prompt strategies for A/B testing entity and relationship extraction.
 * Each variant uses different techniques:
 * - BASELINE: Current production prompts
 * - FEW_SHOT: Includes examples to guide extraction
 * - CHAIN_OF_THOUGHT: Asks LLM to reason step-by-step
 * - STRUCTURED_GUIDELINES: More detailed type definitions
 * - CONCISE: Minimal instructions for faster extraction
 *
 * Feature: F4.3.6 - Extraction Prompt Tuning
 */

const { ENTITY_TYPES, RELATIONSHIP_TYPES } = require('./entity-extraction');

/**
 * Prompt variant identifiers
 */
const PromptVariantId = {
  BASELINE: 'baseline',
  FEW_SHOT: 'few_shot',
  CHAIN_OF_THOUGHT: 'chain_of_thought',
  STRUCTURED_GUIDELINES: 'structured_guidelines',
  CONCISE: 'concise'
};

/**
 * Prompt variant metadata
 */
const PROMPT_VARIANT_METADATA = {
  [PromptVariantId.BASELINE]: {
    id: PromptVariantId.BASELINE,
    name: 'Baseline',
    description: 'Current production prompts with standard instructions',
    hypothesis: 'Establishes baseline performance for comparison',
    createdAt: '2026-01-01T00:00:00Z'
  },
  [PromptVariantId.FEW_SHOT]: {
    id: PromptVariantId.FEW_SHOT,
    name: 'Few-Shot Learning',
    description: 'Includes 2-3 examples to guide extraction behavior',
    hypothesis: 'Examples help LLM understand expected output format and quality',
    createdAt: '2026-01-23T00:00:00Z'
  },
  [PromptVariantId.CHAIN_OF_THOUGHT]: {
    id: PromptVariantId.CHAIN_OF_THOUGHT,
    name: 'Chain of Thought',
    description: 'Asks LLM to reason through extraction step-by-step',
    hypothesis: 'Explicit reasoning improves accuracy for complex documents',
    createdAt: '2026-01-23T00:00:00Z'
  },
  [PromptVariantId.STRUCTURED_GUIDELINES]: {
    id: PromptVariantId.STRUCTURED_GUIDELINES,
    name: 'Structured Guidelines',
    description: 'Detailed type definitions with domain/range hints',
    hypothesis: 'More context about types reduces misclassification',
    createdAt: '2026-01-23T00:00:00Z'
  },
  [PromptVariantId.CONCISE]: {
    id: PromptVariantId.CONCISE,
    name: 'Concise',
    description: 'Minimal instructions for faster extraction',
    hypothesis: 'Simpler prompts may reduce latency while maintaining quality',
    createdAt: '2026-01-23T00:00:00Z'
  }
};

// ============================================================
// BASELINE VARIANT (Current production prompts)
// ============================================================

const BASELINE_ENTITY_SYSTEM_PROMPT = `You are an expert business process analyst. Your task is to extract structured entities from business documents.

ENTITY TYPES:
${ENTITY_TYPES.map((t) => `- ${t}`).join('\n')}

OUTPUT FORMAT:
You must respond with valid JSON only, no additional text. The JSON schema is:
{
  "entities": [
    {
      "name": "string - the entity name",
      "type": "string - one of the entity types above",
      "description": "string - brief description of this entity",
      "confidence": "number - confidence score between 0.0 and 1.0",
      "sourceSpan": "string - exact text where this entity was found"
    }
  ]
}

GUIDELINES:
- Extract all relevant business entities from the text
- Use the most specific entity type that applies
- Normalize entity names (e.g., "Purchase Order Process" not "the purchase order process")
- Include a brief description for context
- Set confidence based on how clearly the entity is defined in the text
- Include the source text span for traceability`;

const BASELINE_RELATIONSHIP_SYSTEM_PROMPT = `You are an expert business process analyst. Your task is to identify relationships between entities in business documents.

RELATIONSHIP TYPES:
${RELATIONSHIP_TYPES.map((t) => `- ${t}`).join('\n')}

OUTPUT FORMAT:
You must respond with valid JSON only, no additional text. The JSON schema is:
{
  "relationships": [
    {
      "from": "string - source entity name",
      "to": "string - target entity name",
      "type": "string - one of the relationship types above",
      "confidence": "number - confidence score between 0.0 and 1.0",
      "evidence": "string - supporting text that indicates this relationship"
    }
  ]
}

GUIDELINES:
- Only create relationships between entities that are clearly related in the text
- Use the most specific relationship type that applies
- Set confidence based on how explicitly the relationship is stated
- Include the evidence text that supports the relationship`;

// ============================================================
// FEW-SHOT VARIANT
// ============================================================

const FEW_SHOT_ENTITY_SYSTEM_PROMPT = `You are an expert business process analyst. Your task is to extract structured entities from business documents.

ENTITY TYPES:
${ENTITY_TYPES.map((t) => `- ${t}`).join('\n')}

OUTPUT FORMAT:
Respond with valid JSON only:
{
  "entities": [
    {
      "name": "string",
      "type": "string",
      "description": "string",
      "confidence": "number (0.0-1.0)",
      "sourceSpan": "string"
    }
  ]
}

EXAMPLES:

Example 1 - Input: "The Invoice Approval Process requires the Finance Manager to review all invoices over $1000 using the SAP ERP system."
Example 1 - Output:
{
  "entities": [
    {"name": "Invoice Approval Process", "type": "Process", "description": "Process for reviewing and approving invoices", "confidence": 0.95, "sourceSpan": "Invoice Approval Process"},
    {"name": "Finance Manager", "type": "Role", "description": "Role responsible for reviewing invoices", "confidence": 0.9, "sourceSpan": "Finance Manager"},
    {"name": "SAP ERP", "type": "System", "description": "Enterprise system used for invoice processing", "confidence": 0.85, "sourceSpan": "SAP ERP system"}
  ]
}

Example 2 - Input: "According to Policy P-2024-001, all data exports must be approved by the Compliance Team before execution."
Example 2 - Output:
{
  "entities": [
    {"name": "Data Export Approval", "type": "Activity", "description": "Activity requiring approval before data export", "confidence": 0.85, "sourceSpan": "data exports must be approved"},
    {"name": "Policy P-2024-001", "type": "Policy", "description": "Policy governing data export procedures", "confidence": 0.95, "sourceSpan": "Policy P-2024-001"},
    {"name": "Compliance Team", "type": "Department", "description": "Team responsible for approving data exports", "confidence": 0.9, "sourceSpan": "Compliance Team"}
  ]
}

GUIDELINES:
- Extract ALL relevant business entities (processes, tasks, roles, systems, policies, etc.)
- Use specific entity types from the list above
- Normalize names: capitalize properly, remove articles (the, a, an)
- High confidence (0.9+) for explicitly named entities
- Medium confidence (0.7-0.9) for implied or contextual entities
- Include the exact text span where the entity appears`;

const FEW_SHOT_RELATIONSHIP_SYSTEM_PROMPT = `You are an expert business process analyst. Identify relationships between entities.

RELATIONSHIP TYPES:
${RELATIONSHIP_TYPES.map((t) => `- ${t}`).join('\n')}

OUTPUT FORMAT:
{
  "relationships": [
    {"from": "string", "to": "string", "type": "string", "confidence": "number", "evidence": "string"}
  ]
}

EXAMPLES:

Example 1 - Entities: Invoice Approval Process (Process), Finance Manager (Role), SAP ERP (System)
Example 1 - Text: "The Finance Manager executes the Invoice Approval Process using SAP ERP."
Example 1 - Output:
{
  "relationships": [
    {"from": "Finance Manager", "to": "Invoice Approval Process", "type": "EXECUTES", "confidence": 0.95, "evidence": "Finance Manager executes the Invoice Approval Process"},
    {"from": "Invoice Approval Process", "to": "SAP ERP", "type": "USES", "confidence": 0.9, "evidence": "using SAP ERP"}
  ]
}

Example 2 - Entities: Policy P-2024-001 (Policy), Data Export Activity (Activity), Compliance Team (Department)
Example 2 - Text: "Policy P-2024-001 governs Data Export Activity. Compliance Team approves all exports."
Example 2 - Output:
{
  "relationships": [
    {"from": "Policy P-2024-001", "to": "Data Export Activity", "type": "GOVERNS", "confidence": 0.95, "evidence": "Policy P-2024-001 governs Data Export Activity"},
    {"from": "Compliance Team", "to": "Data Export Activity", "type": "APPROVES", "confidence": 0.9, "evidence": "Compliance Team approves all exports"}
  ]
}

GUIDELINES:
- Only create relationships explicitly supported by the text
- Use evidence text to justify each relationship
- Higher confidence for explicit statements, lower for implied relationships`;

// ============================================================
// CHAIN OF THOUGHT VARIANT
// ============================================================

const CHAIN_OF_THOUGHT_ENTITY_SYSTEM_PROMPT = `You are an expert business process analyst extracting entities from business documents.

TASK: Extract structured entities following a step-by-step process.

ENTITY TYPES:
${ENTITY_TYPES.map((t) => `- ${t}`).join('\n')}

EXTRACTION PROCESS:
1. First, read the entire text to understand the context
2. Identify all noun phrases that could be business entities
3. For each candidate, determine:
   a. Is this a specific, named entity or just generic text?
   b. What type from the list above best fits?
   c. How confident are you based on context?
4. Normalize entity names (remove articles, proper capitalization)
5. Extract the source text span for traceability

OUTPUT FORMAT (JSON only):
{
  "reasoning": "Brief explanation of your extraction approach for this text",
  "entities": [
    {
      "name": "string - normalized entity name",
      "type": "string - one of the entity types",
      "description": "string - what this entity does/represents",
      "confidence": "number - 0.0 to 1.0",
      "sourceSpan": "string - exact text where found"
    }
  ]
}

CONFIDENCE SCORING:
- 0.9-1.0: Entity is explicitly named and clearly defined
- 0.7-0.9: Entity is mentioned but context needed for classification
- 0.5-0.7: Entity is implied or partially described
- Below 0.5: Do not include - too uncertain`;

const CHAIN_OF_THOUGHT_RELATIONSHIP_SYSTEM_PROMPT = `You are an expert business process analyst identifying relationships between entities.

TASK: Identify relationships following a step-by-step reasoning process.

RELATIONSHIP TYPES:
${RELATIONSHIP_TYPES.map((t) => `- ${t}`).join('\n')}

RELATIONSHIP ANALYSIS PROCESS:
1. For each pair of entities, consider:
   a. Is there a direct connection mentioned in the text?
   b. What type of relationship best describes the connection?
   c. Is the relationship direction correct (from -> to)?
   d. What text evidence supports this relationship?
2. Only include relationships with clear textual support
3. Consider verb phrases that indicate relationships (uses, owns, triggers, etc.)

OUTPUT FORMAT (JSON only):
{
  "reasoning": "Brief explanation of your relationship analysis",
  "relationships": [
    {
      "from": "string - source entity name",
      "to": "string - target entity name",
      "type": "string - relationship type",
      "confidence": "number - 0.0 to 1.0",
      "evidence": "string - supporting text"
    }
  ]
}

CONFIDENCE SCORING:
- 0.9-1.0: Relationship explicitly stated in text
- 0.7-0.9: Relationship strongly implied by context
- 0.5-0.7: Relationship can be inferred but not directly stated
- Below 0.5: Do not include`;

// ============================================================
// STRUCTURED GUIDELINES VARIANT
// ============================================================

const ENTITY_TYPE_DEFINITIONS = {
  Process: 'A series of related activities that achieve a business objective. Examples: Purchase Order Process, Employee Onboarding, Invoice Approval.',
  Task: 'A single discrete unit of work within a process. Examples: Review Document, Submit Form, Verify Data.',
  Activity: 'A general action or operation. Examples: Data Entry, Report Generation, File Transfer.',
  Decision: 'A point where choices are made based on conditions. Examples: Approval Decision, Routing Decision.',
  Role: 'A job function or position. Examples: Finance Manager, System Administrator, Compliance Officer.',
  Department: 'An organizational unit. Examples: Human Resources, Finance, IT Operations.',
  Stakeholder: 'A person or group with interest in the process. Examples: Customer, Vendor, Board of Directors.',
  System: 'A software application or platform. Examples: SAP ERP, Salesforce CRM, SharePoint.',
  Application: 'A specific software tool. Examples: Excel, Power BI, Custom Portal.',
  Database: 'A data storage system. Examples: SQL Server, Oracle DB, Data Warehouse.',
  Document: 'A formal business document. Examples: Purchase Order, Invoice, Contract.',
  Form: 'A template for collecting information. Examples: Request Form, Application Form.',
  Template: 'A standardized format. Examples: Report Template, Email Template.',
  Policy: 'A formal business rule or guideline. Examples: Travel Policy, Data Retention Policy.',
  Regulation: 'An external regulatory requirement. Examples: GDPR, SOX, HIPAA.',
  Standard: 'A technical or operational standard. Examples: ISO 27001, ITIL, REST API Standard.',
  Metric: 'A quantitative measure. Examples: Response Time, Error Rate, Throughput.',
  KPI: 'A key performance indicator. Examples: Customer Satisfaction Score, Revenue Growth.'
};

const STRUCTURED_GUIDELINES_ENTITY_SYSTEM_PROMPT = `You are an expert business process analyst. Extract structured entities with precise type classification.

ENTITY TYPES WITH DEFINITIONS:
${Object.entries(ENTITY_TYPE_DEFINITIONS).map(([type, def]) => `- ${type}: ${def}`).join('\n')}

CRITICAL GUIDELINES:
1. TYPE SELECTION: Choose the most SPECIFIC type that fits. If it's a software system, use "System" not "Application" unless it's clearly a smaller tool.
2. NAMING:
   - Remove articles (the, a, an)
   - Use proper capitalization (Purchase Order Process, not purchase order process)
   - Keep acronyms intact (SAP, CRM, ERP)
3. CONFIDENCE:
   - 0.95-1.0: Named explicitly with context (e.g., "the SAP system")
   - 0.85-0.95: Named without much context
   - 0.70-0.85: Implied or contextual reference
4. BOUNDARIES:
   - DO extract: Specific named entities with clear business meaning
   - DO NOT extract: Generic terms, common words, or vague references

OUTPUT (JSON only):
{
  "entities": [
    {
      "name": "string - normalized entity name",
      "type": "string - exact type from list above",
      "description": "string - one sentence describing what this entity is/does",
      "confidence": "number - 0.0 to 1.0",
      "sourceSpan": "string - exact text where entity appears"
    }
  ]
}`;

const RELATIONSHIP_TYPE_DEFINITIONS = {
  PRECEDES: 'Activity A comes before Activity B in sequence',
  FOLLOWS: 'Activity A comes after Activity B in sequence',
  TRIGGERS: 'Event A causes Event B to start',
  OWNS: 'Role/Dept owns or is responsible for Process/System',
  EXECUTES: 'Role/Dept performs or runs a Task/Process',
  APPROVES: 'Role/Dept authorizes or approves an Activity/Document',
  REVIEWS: 'Role/Dept examines or evaluates an Activity/Document',
  USES: 'Process/Task uses a System/Application/Document',
  INTEGRATES_WITH: 'System A connects or exchanges data with System B',
  DEPENDS_ON: 'A requires B to function or complete',
  GOVERNS: 'Policy/Regulation controls or governs Activity/Process',
  REGULATES: 'External Regulation imposes requirements on Process/System',
  REQUIRES: 'Activity/Process needs a Document/Approval to proceed',
  MEASURES: 'Metric/KPI quantifies or measures Process/Activity',
  TRACKS: 'System/Dashboard tracks or monitors Metric/KPI',
  REPORTS_TO: 'Role A reports hierarchically to Role B'
};

const STRUCTURED_GUIDELINES_RELATIONSHIP_SYSTEM_PROMPT = `You are an expert business process analyst. Identify relationships with precise type classification.

RELATIONSHIP TYPES WITH DEFINITIONS:
${Object.entries(RELATIONSHIP_TYPE_DEFINITIONS).map(([type, def]) => `- ${type}: ${def}`).join('\n')}

CRITICAL GUIDELINES:
1. DIRECTION MATTERS: The "from" entity initiates or is the subject of the relationship
   - "Manager APPROVES Request" → from: Manager, to: Request
   - "Process USES System" → from: Process, to: System
2. EVIDENCE REQUIRED: Only create relationships with textual evidence
3. TYPE SELECTION: Choose the relationship that best matches the semantic meaning
   - "works with" → might be USES, INTEGRATES_WITH, or EXECUTES depending on context
   - "controls" → might be GOVERNS, OWNS, or REGULATES
4. CONFIDENCE:
   - 0.95-1.0: Explicit relationship statement (e.g., "A triggers B")
   - 0.85-0.95: Strong implication (e.g., "A causes B to start")
   - 0.70-0.85: Contextual inference

OUTPUT (JSON only):
{
  "relationships": [
    {
      "from": "string - source entity name (must match an entity exactly)",
      "to": "string - target entity name (must match an entity exactly)",
      "type": "string - exact type from list above",
      "confidence": "number - 0.0 to 1.0",
      "evidence": "string - text supporting this relationship"
    }
  ]
}`;

// ============================================================
// CONCISE VARIANT
// ============================================================

const CONCISE_ENTITY_SYSTEM_PROMPT = `Extract business entities as JSON.

Types: ${ENTITY_TYPES.join(', ')}

Output: {"entities": [{"name": "...", "type": "...", "description": "...", "confidence": 0.0-1.0, "sourceSpan": "..."}]}

Rules: Normalize names, use specific types, include source spans.`;

const CONCISE_RELATIONSHIP_SYSTEM_PROMPT = `Identify relationships between given entities as JSON.

Types: ${RELATIONSHIP_TYPES.join(', ')}

Output: {"relationships": [{"from": "...", "to": "...", "type": "...", "confidence": 0.0-1.0, "evidence": "..."}]}

Rules: Only include relationships with clear evidence.`;

// ============================================================
// VARIANT REGISTRY
// ============================================================

/**
 * All prompt variants with their system prompts
 */
const PROMPT_VARIANTS = {
  [PromptVariantId.BASELINE]: {
    ...PROMPT_VARIANT_METADATA[PromptVariantId.BASELINE],
    entitySystemPrompt: BASELINE_ENTITY_SYSTEM_PROMPT,
    relationshipSystemPrompt: BASELINE_RELATIONSHIP_SYSTEM_PROMPT,
    buildEntityPrompt: buildBaselineEntityPrompt,
    buildRelationshipPrompt: buildBaselineRelationshipPrompt
  },
  [PromptVariantId.FEW_SHOT]: {
    ...PROMPT_VARIANT_METADATA[PromptVariantId.FEW_SHOT],
    entitySystemPrompt: FEW_SHOT_ENTITY_SYSTEM_PROMPT,
    relationshipSystemPrompt: FEW_SHOT_RELATIONSHIP_SYSTEM_PROMPT,
    buildEntityPrompt: buildFewShotEntityPrompt,
    buildRelationshipPrompt: buildFewShotRelationshipPrompt
  },
  [PromptVariantId.CHAIN_OF_THOUGHT]: {
    ...PROMPT_VARIANT_METADATA[PromptVariantId.CHAIN_OF_THOUGHT],
    entitySystemPrompt: CHAIN_OF_THOUGHT_ENTITY_SYSTEM_PROMPT,
    relationshipSystemPrompt: CHAIN_OF_THOUGHT_RELATIONSHIP_SYSTEM_PROMPT,
    buildEntityPrompt: buildChainOfThoughtEntityPrompt,
    buildRelationshipPrompt: buildChainOfThoughtRelationshipPrompt,
    parseEntityResponse: parseChainOfThoughtEntityResponse,
    parseRelationshipResponse: parseChainOfThoughtRelationshipResponse
  },
  [PromptVariantId.STRUCTURED_GUIDELINES]: {
    ...PROMPT_VARIANT_METADATA[PromptVariantId.STRUCTURED_GUIDELINES],
    entitySystemPrompt: STRUCTURED_GUIDELINES_ENTITY_SYSTEM_PROMPT,
    relationshipSystemPrompt: STRUCTURED_GUIDELINES_RELATIONSHIP_SYSTEM_PROMPT,
    buildEntityPrompt: buildStructuredEntityPrompt,
    buildRelationshipPrompt: buildStructuredRelationshipPrompt
  },
  [PromptVariantId.CONCISE]: {
    ...PROMPT_VARIANT_METADATA[PromptVariantId.CONCISE],
    entitySystemPrompt: CONCISE_ENTITY_SYSTEM_PROMPT,
    relationshipSystemPrompt: CONCISE_RELATIONSHIP_SYSTEM_PROMPT,
    buildEntityPrompt: buildConciseEntityPrompt,
    buildRelationshipPrompt: buildConciseRelationshipPrompt
  }
};

// ============================================================
// USER PROMPT BUILDERS
// ============================================================

function buildBaselineEntityPrompt(text, documentContext = {}) {
  const contextInfo = [];
  if (documentContext.title) contextInfo.push(`Document Title: ${documentContext.title}`);
  if (documentContext.section) contextInfo.push(`Section: ${documentContext.section}`);
  if (documentContext.pageNumber) contextInfo.push(`Page: ${documentContext.pageNumber}`);

  const contextBlock = contextInfo.length > 0 ? `\n\nDOCUMENT CONTEXT:\n${contextInfo.join('\n')}` : '';
  return `Extract all business entities from the following text.${contextBlock}\n\nTEXT TO ANALYZE:\n${text}\n\nRespond with JSON only:`;
}

function buildBaselineRelationshipPrompt(text, entities) {
  const entityList = entities.map((e) => `- ${e.name} (${e.type})`).join('\n');
  return `Given these entities found in the text, identify the relationships between them.\n\nENTITIES:\n${entityList}\n\nTEXT:\n${text}\n\nRespond with JSON only:`;
}

function buildFewShotEntityPrompt(text, documentContext = {}) {
  const contextInfo = [];
  if (documentContext.title) contextInfo.push(`Document: ${documentContext.title}`);
  if (documentContext.section) contextInfo.push(`Section: ${documentContext.section}`);

  const contextBlock = contextInfo.length > 0 ? `Context: ${contextInfo.join(', ')}\n\n` : '';
  return `${contextBlock}Extract all business entities from this text:\n\n"${text}"\n\nRespond with JSON only:`;
}

function buildFewShotRelationshipPrompt(text, entities) {
  const entityList = entities.map((e) => `${e.name} (${e.type})`).join(', ');
  return `Entities found: ${entityList}\n\nText: "${text}"\n\nIdentify relationships. JSON only:`;
}

function buildChainOfThoughtEntityPrompt(text, documentContext = {}) {
  const contextInfo = [];
  if (documentContext.title) contextInfo.push(`Document: ${documentContext.title}`);
  if (documentContext.section) contextInfo.push(`Section: ${documentContext.section}`);

  const contextBlock = contextInfo.length > 0 ? `\nContext: ${contextInfo.join(', ')}` : '';
  return `Analyze this text step-by-step to extract business entities.${contextBlock}\n\nTEXT:\n${text}\n\nThink through the extraction process and respond with JSON:`;
}

function buildChainOfThoughtRelationshipPrompt(text, entities) {
  const entityList = entities.map((e) => `- ${e.name} (${e.type})`).join('\n');
  return `Analyze relationships between these entities step-by-step.\n\nENTITIES:\n${entityList}\n\nTEXT:\n${text}\n\nThink through each potential relationship and respond with JSON:`;
}

function buildStructuredEntityPrompt(text, documentContext = {}) {
  const contextInfo = [];
  if (documentContext.title) contextInfo.push(`Document: ${documentContext.title}`);
  if (documentContext.section) contextInfo.push(`Section: ${documentContext.section}`);

  const contextBlock = contextInfo.length > 0 ? `\n\n[Context: ${contextInfo.join(' | ')}]` : '';
  return `Extract entities from this business text:${contextBlock}\n\n---\n${text}\n---\n\nRespond with JSON only:`;
}

function buildStructuredRelationshipPrompt(text, entities) {
  const entityList = entities.map((e) => `• ${e.name} [${e.type}]`).join('\n');
  return `Given entities:\n${entityList}\n\nSource text:\n---\n${text}\n---\n\nIdentify relationships. JSON only:`;
}

function buildConciseEntityPrompt(text, documentContext = {}) {
  const ctx = documentContext.title ? ` [${documentContext.title}]` : '';
  return `Text${ctx}:\n${text}\n\nEntities (JSON):`;
}

function buildConciseRelationshipPrompt(text, entities) {
  const entityList = entities.map((e) => e.name).join(', ');
  return `Entities: ${entityList}\nText: ${text}\n\nRelationships (JSON):`;
}

// ============================================================
// RESPONSE PARSERS (for chain-of-thought variant)
// ============================================================

function parseChainOfThoughtEntityResponse(response) {
  // Chain of thought includes "reasoning" field, extract just entities
  if (response && response.entities) {
    return { entities: response.entities };
  }
  return response;
}

function parseChainOfThoughtRelationshipResponse(response) {
  // Chain of thought includes "reasoning" field, extract just relationships
  if (response && response.relationships) {
    return { relationships: response.relationships };
  }
  return response;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Get a prompt variant by ID
 * @param {string} variantId - The variant identifier
 * @returns {Object|null} The variant configuration or null if not found
 */
function getPromptVariant(variantId) {
  return PROMPT_VARIANTS[variantId] || null;
}

/**
 * Get all available prompt variants
 * @returns {Object} Map of variant ID to variant configuration
 */
function getAllPromptVariants() {
  return { ...PROMPT_VARIANTS };
}

/**
 * Get variant metadata (without prompts)
 * @returns {Object[]} Array of variant metadata
 */
function getPromptVariantList() {
  return Object.values(PROMPT_VARIANT_METADATA);
}

/**
 * Check if a variant ID is valid
 * @param {string} variantId - The variant identifier
 * @returns {boolean} True if valid
 */
function isValidVariant(variantId) {
  return variantId in PROMPT_VARIANTS;
}

module.exports = {
  // Variant identifiers
  PromptVariantId,

  // Variant registry
  PROMPT_VARIANTS,
  PROMPT_VARIANT_METADATA,

  // Utility functions
  getPromptVariant,
  getAllPromptVariants,
  getPromptVariantList,
  isValidVariant,

  // Entity type definitions (for structured variant)
  ENTITY_TYPE_DEFINITIONS,
  RELATIONSHIP_TYPE_DEFINITIONS
};
