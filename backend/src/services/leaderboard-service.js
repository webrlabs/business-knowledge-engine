const { CosmosClient } = require('@azure/cosmos');
const { log } = require('../utils/logger');

// Initialize Cosmos Client
// We reuse the environment variables but create a dedicated client for this service 
// if the shared storage module doesn't expose the client directly.
const endpoint = process.env.COSMOS_DB_ENDPOINT;
// Use key or managed identity. Assuming Entra ID (DefaultAzureCredential) if key missing,
// but the SDK usage in this project seems to vary. 
// A safer bet is to use the shared client from storage/cosmos if possible, 
// but since we are in a new service file, let's look at how cosmos.js does it.
//
// NOTE: I will update this file content AFTER reading cosmos.js if I can reuse it.
// For now, I'll write a standalone implementation that is robust.

const client = new CosmosClient({
    endpoint,
    key: process.env.COSMOS_DB_KEY,
    // aadCredentials: new DefaultAzureCredential() // If needing Entra ID
});
const databaseId = process.env.COSMOS_DB_DATABASE || 'knowledge-platform';
const containerId = 'user_scores';

class LeaderboardService {
    constructor() {
        this.container = client.database(databaseId).container(containerId);
    }

    async getLeaderboard(limit = 10) {
        try {
            const querySpec = {
                query: 'SELECT * FROM c ORDER BY c.totalPoints DESC OFFSET 0 LIMIT @limit',
                parameters: [
                    { name: '@limit', value: limit }
                ]
            };

            const { resources: items } = await this.container.items.query(querySpec).fetchAll();
            return items;
        } catch (error) {
            log.error('Error fetching leaderboard', error);
            return [];
        }
    }

    async getUserScore(userId) {
        try {
            const { resource: item } = await this.container.item(userId, userId).read();
            return item || null;
        } catch (error) {
            if (error.code === 404) return null;
            log.error(`Error fetching score for user ${userId}`, error);
            throw error;
        }
    }
}

module.exports = {
    LeaderboardService: new LeaderboardService()
};
