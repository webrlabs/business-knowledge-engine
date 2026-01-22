/**
 * Update Azure Search index with semantic configuration
 * Run: node scripts/update-search-index.js
 */

require('dotenv').config();
const { getSearchService } = require('../src/services/search-service');

async function updateIndex() {
  console.log('Updating Azure Search index with semantic configuration...\n');

  const searchService = getSearchService();

  try {
    await searchService.updateIndexSchema();
    console.log('\nIndex update complete!');
  } catch (error) {
    console.error('Error updating index:', error.message);
    process.exit(1);
  }
}

updateIndex();
