const { getOpenAIService } = require('../services/openai-service');
const { getSearchService } = require('../services/search-service');
const { getGraphService } = require('../services/graph-service');
const { getPIIRedactionService } = require('../services/pii-redaction-service');
const { getSecurityTrimmingService } = require('../services/security-trimming-service');
const { log } = require('../utils/logger');
const { trackGraphRAGQuery, trackException } = require('../utils/telemetry');
const {
  QUERY_SYNTHESIS_SYSTEM_PROMPT,
  NO_CONTEXT_RESPONSE,
  buildQuerySynthesisPrompt,
  buildCitationsList,
} = require('../prompts/query-synthesis');

class GraphRAGQueryPipeline {
  constructor() {
    this.openai = getOpenAIService();
    this.search = getSearchService();
    this.graph = getGraphService();
    this.piiRedaction = getPIIRedactionService();
    this.securityTrimming = getSecurityTrimmingService();
  }

  async processQuery(query, options = {}) {
    const startTime = Date.now();
    const user = options.user || null;

    // Step 1: Generate query embedding
    const queryEmbedding = await this._generateQueryEmbedding(query);

    // Step 2: Build security filter for pre-query trimming
    const securityFilter = this.securityTrimming.buildSearchFilter(user);
    const searchOptions = {
      ...options,
      filter: options.filter
        ? securityFilter
          ? `(${options.filter}) and (${securityFilter})`
          : options.filter
        : securityFilter,
    };

    // Step 3: Perform hybrid search (vector + keyword)
    const rawSearchResults = await this._performHybridSearch(query, queryEmbedding, searchOptions);

    // Step 4: Apply post-query security trimming
    const { filteredResults: searchResults, accessSummary } = this.securityTrimming.filterSearchResults(
      rawSearchResults,
      user
    );

    // Step 5: Extract entity mentions from search results
    const entityNames = this._extractEntityNames(searchResults);

    // Step 6: Get graph context (if entities found)
    let graphContext = null;
    let graphSecuritySummary = null;
    if (entityNames.length > 0 && options.includeGraphContext !== false) {
      const rawGraphContext = await this._getGraphContext(entityNames, options.graphDepth || 2);

      if (rawGraphContext) {
        // Apply security trimming to graph entities
        const { filteredEntities, denied: deniedEntities } = this.securityTrimming.filterGraphEntities(
          rawGraphContext.entities,
          user
        );

        // Filter relationships to only include accessible entities
        const allowedEntityIds = filteredEntities.map((e) => e.id);
        const filteredRelationships = this.securityTrimming.filterGraphRelationships(
          rawGraphContext.relationships,
          allowedEntityIds
        );

        graphContext = {
          entities: filteredEntities,
          relationships: filteredRelationships,
        };

        graphSecuritySummary = {
          entitiesDenied: deniedEntities.length,
          relationshipsFiltered: rawGraphContext.relationships.length - filteredRelationships.length,
        };
      }
    }

    // Step 7: Synthesize answer with LLM
    const { answer: rawAnswer, citations } = await this._synthesizeAnswer(
      query,
      searchResults,
      graphContext
    );

    // Step 8: Apply PII redaction to the answer
    const { redactedText: answer, detections: piiDetections, summary: piiSummary } = this.piiRedaction.redact(rawAnswer);

    // Also redact PII from citations content
    const redactedCitations = citations.map((citation) => {
      if (citation.content) {
        const { redactedText } = this.piiRedaction.redact(citation.content);
        return { ...citation, content: redactedText };
      }
      return citation;
    });

    const responseTime = Date.now() - startTime;

    // Track query telemetry
    trackGraphRAGQuery(
      query.length,
      responseTime,
      searchResults.length,
      true,
      {
        graphTraversalExecuted: graphContext !== null,
        entitiesFound: graphContext?.entities?.length || 0,
        piiRedacted: piiDetections.length > 0,
        userId: user?.id || user?.email,
      }
    );

    return {
      answer,
      citations: redactedCitations,
      responseTime,
      metadata: {
        vectorSearchExecuted: true,
        graphTraversalExecuted: graphContext !== null,
        documentsSearched: rawSearchResults.length,
        documentsAccessible: searchResults.length,
        entitiesFound: graphContext?.entities?.length || 0,
        relationshipsFound: graphContext?.relationships?.length || 0,
        securityTrimming: {
          enabled: this.securityTrimming.isEnabled(),
          searchResultsDenied: accessSummary.denied,
          ...(graphSecuritySummary || {}),
        },
        piiRedaction: {
          enabled: this.piiRedaction.isEnabled(),
          detectionsInAnswer: piiDetections.length,
          ...(piiSummary || {}),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  async _generateQueryEmbedding(query) {
    const result = await this.openai.getEmbedding(query);
    return result.embedding;
  }

  async _performHybridSearch(query, queryVector, options = {}) {
    const searchOptions = {
      top: options.topK || 10,
      semantic: options.semantic !== false,
      filter: options.filter,
    };

    const { results } = await this.search.hybridSearch(query, queryVector, searchOptions);

    return results.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      content: r.content,
      title: r.title,
      sourceFile: r.sourceFile,
      pageNumber: r.pageNumber,
      sectionTitle: r.sectionTitle,
      entities: r.entities || [],
      score: r.score,
      rerankerScore: r.rerankerScore,
    }));
  }

  _extractEntityNames(searchResults) {
    const entitySet = new Set();

    for (const result of searchResults) {
      if (result.entities && Array.isArray(result.entities)) {
        for (const entity of result.entities) {
          entitySet.add(entity);
        }
      }
    }

    return Array.from(entitySet);
  }

  async _getGraphContext(entityNames, depth = 2) {
    try {
      const { entities, relationships } = await this.graph.findRelatedEntities(entityNames, depth);
      return { entities, relationships };
    } catch (error) {
      log.warn('Graph traversal error', { error: error.message });
      return null;
    }
  }

  async _synthesizeAnswer(query, vectorResults, graphContext) {
    // Check if we have any context
    if (vectorResults.length === 0 && (!graphContext || graphContext.entities?.length === 0)) {
      return {
        answer: NO_CONTEXT_RESPONSE,
        citations: [],
      };
    }

    // Build the synthesis prompt
    const userPrompt = buildQuerySynthesisPrompt(query, vectorResults, graphContext);

    // Call LLM for synthesis
    const response = await this.openai.getChatCompletion([
      { role: 'system', content: QUERY_SYNTHESIS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ], {
      temperature: 0.1, // Low temperature for factual responses
      maxTokens: 2048,
    });

    // Generate citations from vector results
    const citations = buildCitationsList(vectorResults);

    return {
      answer: response.content,
      citations,
    };
  }

  async processQueryWithFallback(query, options = {}) {
    try {
      return await this.processQuery(query, options);
    } catch (error) {
      log.errorWithStack('GraphRAG query error', error);

      // Track failed query
      trackException(error, {
        component: 'GraphRAGQueryPipeline',
        queryLength: query?.length,
        userId: options.user?.id || options.user?.email,
      });

      trackGraphRAGQuery(query?.length || 0, 0, 0, false, {
        error: error.message,
        userId: options.user?.id || options.user?.email,
      });

      // Return a fallback response
      return {
        answer: `I encountered an error while processing your query. Please try again or rephrase your question.\n\nError: ${error.message}`,
        citations: [],
        responseTime: 0,
        metadata: {
          vectorSearchExecuted: false,
          graphTraversalExecuted: false,
          documentsSearched: 0,
          entitiesFound: 0,
          error: error.message,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  async getRelatedQuestions(query, answer, vectorResults) {
    // Generate follow-up questions based on the context
    const systemPrompt = `Based on the original question and answer, suggest 3 relevant follow-up questions the user might want to ask. Format as a JSON array of strings.`;

    const userPrompt = `Original question: ${query}\n\nAnswer provided: ${answer}\n\nSuggest 3 follow-up questions:`;

    try {
      const response = await this.openai.getJsonCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      return response.content?.questions || response.content || [];
    } catch {
      return [];
    }
  }
}

// Singleton instance
let instance = null;

function getGraphRAGQueryPipeline() {
  if (!instance) {
    instance = new GraphRAGQueryPipeline();
  }
  return instance;
}

module.exports = {
  GraphRAGQueryPipeline,
  getGraphRAGQueryPipeline,
};
