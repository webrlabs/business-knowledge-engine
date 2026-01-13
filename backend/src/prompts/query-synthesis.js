const QUERY_SYNTHESIS_SYSTEM_PROMPT = `You are a knowledgeable business process expert assistant. Your role is to answer questions about business processes, policies, and organizational knowledge based on the provided context.

RESPONSE GUIDELINES:
- Answer questions accurately based ONLY on the provided context
- If the context doesn't contain enough information, say so clearly
- Use clear, professional language
- Structure complex answers with markdown formatting (headers, lists, etc.)
- When mentioning specific processes, systems, or policies, cite the source
- Be concise but thorough

CITATION FORMAT:
When referencing information from the context, include inline citations like [Source: Document Name, Section X] or [Source: Document Name, Page Y].

OUTPUT FORMAT:
Provide your answer in markdown format. At the end, include a "Sources" section listing all documents referenced.`;

function buildQuerySynthesisPrompt(query, vectorContext, graphContext = null) {
  let contextSection = '';

  // Add vector search results
  if (vectorContext && vectorContext.length > 0) {
    contextSection += 'RELEVANT DOCUMENT EXCERPTS:\n\n';
    vectorContext.forEach((result, index) => {
      contextSection += `--- Document ${index + 1}: ${result.sourceFile || 'Unknown'} ---\n`;
      if (result.sectionTitle) {
        contextSection += `Section: ${result.sectionTitle}\n`;
      }
      if (result.pageNumber) {
        contextSection += `Page: ${result.pageNumber}\n`;
      }
      contextSection += `\n${result.content}\n\n`;
    });
  }

  // Add graph context if available
  if (graphContext && graphContext.entities && graphContext.entities.length > 0) {
    contextSection += '\nRELATED ENTITIES AND RELATIONSHIPS:\n\n';

    // Add entities
    contextSection += 'Entities:\n';
    graphContext.entities.forEach((entity) => {
      contextSection += `- ${entity.name} (${entity.type})`;
      if (entity.description) {
        contextSection += `: ${entity.description}`;
      }
      contextSection += '\n';
    });

    // Add relationships
    if (graphContext.relationships && graphContext.relationships.length > 0) {
      contextSection += '\nRelationships:\n';
      graphContext.relationships.forEach((rel) => {
        contextSection += `- ${rel.from} --[${rel.type}]--> ${rel.to}\n`;
      });
    }
  }

  if (!contextSection) {
    contextSection = 'No relevant context found in the knowledge base.\n';
  }

  return `Answer the following question based on the provided context.

${contextSection}
USER QUESTION:
${query}

Provide a comprehensive answer based on the context above:`;
}

const NO_CONTEXT_RESPONSE = `I don't have enough information in the knowledge base to answer this question accurately.

To help me provide better answers, you can:
1. Upload relevant documents that contain information about this topic
2. Rephrase your question to be more specific
3. Ask about a different aspect of your business processes

Would you like me to help with something else?`;

function buildCitationsList(vectorResults) {
  if (!vectorResults || vectorResults.length === 0) {
    return [];
  }

  const citations = new Map();

  vectorResults.forEach((result) => {
    const sourceFile = result.sourceFile || 'Unknown Document';
    const key = sourceFile;

    if (!citations.has(key)) {
      const citation = {
        document: sourceFile,
        sections: new Set(),
        pages: new Set(),
      };
      citations.set(key, citation);
    }

    const citation = citations.get(key);
    if (result.sectionTitle) {
      citation.sections.add(result.sectionTitle);
    }
    if (result.pageNumber) {
      citation.pages.add(result.pageNumber);
    }
  });

  return Array.from(citations.values()).map((citation) => {
    let citationText = citation.document;
    const details = [];

    if (citation.sections.size > 0) {
      details.push(`Sections: ${Array.from(citation.sections).join(', ')}`);
    }
    if (citation.pages.size > 0) {
      const pages = Array.from(citation.pages).sort((a, b) => a - b);
      details.push(`Pages: ${pages.join(', ')}`);
    }

    if (details.length > 0) {
      citationText += ` (${details.join('; ')})`;
    }

    return citationText;
  });
}

module.exports = {
  QUERY_SYNTHESIS_SYSTEM_PROMPT,
  NO_CONTEXT_RESPONSE,
  buildQuerySynthesisPrompt,
  buildCitationsList,
};
