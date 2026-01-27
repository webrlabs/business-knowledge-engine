const ENTITY_TYPES = [
  'Process',
  'Task',
  'Activity',
  'Decision',
  'Role',
  'Department',
  'Stakeholder',
  'System',
  'Application',
  'Database',
  'Document',
  'Form',
  'Template',
  'Policy',
  'Regulation',
  'Standard',
  'Metric',
  'KPI',
];

const RELATIONSHIP_TYPES = [
  'PRECEDES',
  'FOLLOWS',
  'TRIGGERS',
  'OWNS',
  'EXECUTES',
  'APPROVES',
  'REVIEWS',
  'USES',
  'INTEGRATES_WITH',
  'DEPENDS_ON',
  'GOVERNS',
  'REGULATES',
  'REQUIRES',
  'MEASURES',
  'TRACKS',
  'REPORTS_TO',
];

const ENTITY_EXTRACTION_SYSTEM_PROMPT = `You are an expert business process analyst. Your task is to extract structured entities from business documents.

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

IMPORTANT GUIDELINES:
- ONLY extract entities that are explicitly mentioned in the TEXT TO ANALYZE section
- DO NOT extract the document title itself as an entity
- Document context (title, section, page) is provided for reference only - do not extract entities from it
- Focus on extracting people/roles, organizations, processes, systems, policies, and regulations mentioned in the text
- Extract all relevant business entities from the text
- Use the most specific entity type that applies
- Normalize entity names (e.g., "Purchase Order Process" not "the purchase order process")
- Include a brief description for context
- Set confidence based on how clearly the entity is defined in the text
- Include the source text span for traceability
- If no entities are found in the text, return an empty entities array`;

function buildEntityExtractionPrompt(text, documentContext = {}) {
  const contextInfo = [];
  if (documentContext.title) {
    contextInfo.push(`Document Title: ${documentContext.title}`);
  }
  if (documentContext.section) {
    contextInfo.push(`Section: ${documentContext.section}`);
  }
  if (documentContext.pageNumber) {
    contextInfo.push(`Page: ${documentContext.pageNumber}`);
  }

  const contextBlock = contextInfo.length > 0 ? `\n\nDOCUMENT CONTEXT:\n${contextInfo.join('\n')}` : '';

  return `Extract all business entities from the following text.${contextBlock}

TEXT TO ANALYZE:
${text}

Respond with JSON only:`;
}

const RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT = `You are an expert business process analyst. Your task is to identify relationships between entities in business documents.

RELATIONSHIP TYPES:
${RELATIONSHIP_TYPES.map((t) => `- ${t}`).join('\n')}

OUTPUT FORMAT:
You must respond with valid JSON only, no additional text. The JSON schema is:
{
  "relationships": [
    {
      "from": "string - source entity name (MUST exactly match a name from the ENTITIES list)",
      "to": "string - target entity name (MUST exactly match a name from the ENTITIES list)",
      "type": "string - one of the relationship types above",
      "confidence": "number - confidence score between 0.0 and 1.0",
      "evidence": "string - supporting text that indicates this relationship"
    }
  ]
}

IMPORTANT GUIDELINES:
- CRITICAL: The "from" and "to" fields MUST use the EXACT entity names from the provided ENTITIES list - do not add type labels, abbreviations, or modify the names in any way
- Only create relationships between entities that are mentioned or clearly referenced in the text
- Use the most specific relationship type that applies
- Set confidence based on how explicitly the relationship is stated
- Include the evidence text that supports the relationship
- If no relationships are found, return an empty relationships array`;

function buildRelationshipExtractionPrompt(text, entities) {
  const entityList = entities.map((e) => `- ${e.name} (${e.type})`).join('\n');

  return `Given these entities found in the text, identify the relationships between them.

ENTITIES:
${entityList}

TEXT:
${text}

Respond with JSON only:`;
}

module.exports = {
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  RELATIONSHIP_EXTRACTION_SYSTEM_PROMPT,
  buildEntityExtractionPrompt,
  buildRelationshipExtractionPrompt,
};
