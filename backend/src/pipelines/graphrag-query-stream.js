const { getOpenAIService } = require('../services/openai-service');
const { getSearchService } = require('../services/search-service');
const { getGraphService } = require('../services/graph-service');
const { getPIIRedactionService } = require('../services/pii-redaction-service');
const { getSecurityTrimmingService } = require('../services/security-trimming-service');
const { log } = require('../utils/logger');
const {
  QUERY_SYNTHESIS_SYSTEM_PROMPT,
  NO_CONTEXT_RESPONSE,
  buildQuerySynthesisPrompt,
  buildCitationsList,
} = require('../prompts/query-synthesis');

/**
 * Streaming version of GraphRAGQueryPipeline.
 * Reuses the same retrieval steps but streams the LLM synthesis step.
 */
class GraphRAGQueryStreamPipeline {
  constructor() {
    this.openai = getOpenAIService();
    this.search = getSearchService();
    this.graph = getGraphService();
    this.piiRedaction = getPIIRedactionService();
    this.securityTrimming = getSecurityTrimmingService();
  }

  /**
   * Stream a query response via SSE.
   * @param {object} res - Express response object (must support res.write)
   * @param {string} query - User query
   * @param {object} options - Pipeline options
   */
  async streamQuery(res, query, options = {}) {
    const startTime = Date.now();
    const user = options.user || null;

    // Helper to write SSE events
    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // Send thinking event
      sendEvent('thinking', { content: 'Searching knowledge base...' });

      // Step 1: Generate query embedding
      const result = await this.openai.getEmbedding(query);
      const queryEmbedding = result.embedding;

      // Step 2: Build security filter
      const securityFilter = this.securityTrimming.buildSearchFilter(user);
      const searchOptions = {
        ...options,
        filter: options.filter
          ? securityFilter
            ? `(${options.filter}) and (${securityFilter})`
            : options.filter
          : securityFilter,
      };

      sendEvent('thinking', { content: 'Analyzing graph relationships...' });

      // Step 3: Hybrid search
      const rawSearchResults = await this._performHybridSearch(query, queryEmbedding, searchOptions);

      // Step 4: Security trimming
      const { filteredResults: searchResults } = this.securityTrimming.filterSearchResults(
        rawSearchResults,
        user
      );

      // Step 5: Extract entities
      const entityNames = this._extractEntityNames(searchResults);

      // Step 6: Graph context
      let graphContext = null;
      if (entityNames.length > 0 && options.includeGraphContext !== false) {
        const rawGraphContext = await this._getGraphContext(entityNames, options.graphDepth || 2);

        if (rawGraphContext) {
          const { filteredEntities } = this.securityTrimming.filterGraphEntities(
            rawGraphContext.entities,
            user
          );
          const allowedEntityIds = filteredEntities.map((e) => e.id);
          const filteredRelationships = this.securityTrimming.filterGraphRelationships(
            rawGraphContext.relationships,
            allowedEntityIds
          );

          graphContext = {
            entities: filteredEntities,
            relationships: filteredRelationships,
          };
        }
      }

      // Build citations
      const citations = buildCitationsList(searchResults);
      const redactedCitations = citations.map((citation) => {
        if (citation.content) {
          const { redactedText } = this.piiRedaction.redact(citation.content);
          return { ...citation, content: redactedText };
        }
        return citation;
      });

      // Send metadata (citations) before streaming content
      sendEvent('metadata', {
        citations: redactedCitations,
        documentsSearched: rawSearchResults.length,
        documentsAccessible: searchResults.length,
        entitiesFound: graphContext?.entities?.length || 0,
      });

      // Check for empty context
      if (searchResults.length === 0 && (!graphContext || graphContext.entities?.length === 0)) {
        sendEvent('content', { text: NO_CONTEXT_RESPONSE });
        const responseTime = Date.now() - startTime;
        sendEvent('metadata', { responseTime });
        sendEvent('done', {});
        return;
      }

      sendEvent('thinking', { content: 'Synthesizing answer...' });

      // Step 7: Stream LLM synthesis
      const userPrompt = buildQuerySynthesisPrompt(query, searchResults, graphContext);
      const stream = await this.openai.getStreamingChatCompletion([
        { role: 'system', content: QUERY_SYNTHESIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ], {
        maxTokens: 2048,
      });

      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          sendEvent('content', { text: delta });
        }
      }

      // Step 8: PII redaction check on full response
      const { redactedText, detections } = this.piiRedaction.redact(fullContent);
      if (detections.length > 0) {
        // If PII was found, send the redacted version as a replacement
        sendEvent('content_replace', { text: redactedText });
      }

      const responseTime = Date.now() - startTime;
      sendEvent('metadata', { responseTime });
      sendEvent('done', {});
    } catch (error) {
      log.errorWithStack('Streaming query error', error);
      sendEvent('error', { message: error.message || 'Streaming query failed' });
    }
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
}

let instance = null;

function getGraphRAGQueryStreamPipeline() {
  if (!instance) {
    instance = new GraphRAGQueryStreamPipeline();
  }
  return instance;
}

module.exports = {
  GraphRAGQueryStreamPipeline,
  getGraphRAGQueryStreamPipeline,
};
