const { log } = require('../utils/logger');

const SAMPLE_QUESTIONS = [
  'What are the key business processes?',
  'How does the approval workflow work?',
  'What entities are most connected?',
  'Show me the document processing pipeline',
  'What are the main dependencies between teams?',
  'How are compliance requirements tracked?',
  'What processes involve customer data?',
  'Show relationships between departments',
];

class SearchSuggestService {
  constructor() {
    this.popularQueries = [];
    this.queryHistory = new Map(); // query -> count
  }

  recordQuery(query) {
    if (!query || query.length < 3) return;
    const normalized = query.toLowerCase().trim();
    const count = this.queryHistory.get(normalized) || 0;
    this.queryHistory.set(normalized, count + 1);
    this._updatePopular();
  }

  _updatePopular() {
    this.popularQueries = Array.from(this.queryHistory.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([query, count]) => ({ query, count }));
  }

  getPopularQueries(limit = 5) {
    return this.popularQueries.slice(0, limit);
  }

  getSampleQuestions(limit = 4) {
    const shuffled = [...SAMPLE_QUESTIONS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, limit);
  }

  async getSuggestions(prefix, searchService) {
    if (!prefix || prefix.length < 2) {
      return {
        entities: [],
        popularQueries: this.getPopularQueries(3),
        sampleQuestions: this.getSampleQuestions(3),
      };
    }

    let entities = [];
    if (searchService) {
      try {
        const results = await searchService.search(prefix, { top: 5 });
        entities = (results.results || []).map(r => ({
          name: r.document?.name || r.document?.title || prefix,
          type: r.document?.type || r.document?.entityType || 'entity',
          score: r.score || 0,
        }));
      } catch (error) {
        log.warn('Entity search for suggestions failed', error);
      }
    }

    // Filter popular queries matching prefix
    const matchingPopular = this.popularQueries
      .filter(p => p.query.includes(prefix.toLowerCase()))
      .slice(0, 3);

    return {
      entities,
      popularQueries: matchingPopular,
      sampleQuestions: this.getSampleQuestions(2),
    };
  }
}

let instance = null;

function getSearchSuggestService() {
  if (!instance) {
    instance = new SearchSuggestService();
  }
  return instance;
}

module.exports = {
  SearchSuggestService,
  getSearchSuggestService,
  SAMPLE_QUESTIONS,
};
