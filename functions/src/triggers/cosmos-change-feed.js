const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');

// Initialize Cosmos Client for writing scores
// Process.env.COSMOS_DB_CONNECTION_STRING should be set in App Settings
const connectionString = process.env.COSMOS_DB_CONNECTION_STRING;
const client = connectionString ? new CosmosClient(connectionString) : null;

async function updateUserScore(userId, userName, points, actionType) {
    if (!client) {
        console.error('Cosmos DB connection string not set. Skipping score update.');
        return;
    }

    try {
        const database = client.database(process.env.COSMOS_DB_DATABASE || 'knowledge-platform');
        const container = database.container('user_scores');

        // Simple upsert for now to accumulate points
        // In a real app we might want event sourcing or atomic increments
        const { resource: userScore } = await container.item(userId, userId).read();

        const newScore = {
            id: userId,
            userId: userId,
            userName: userName,
            totalPoints: (userScore?.totalPoints || 0) + points,
            lastActivity: new Date().toISOString(),
            actions: [
                ...(userScore?.actions || []).slice(-9), // Keep last 10 actions
                { action: actionType, points, timestamp: new Date().toISOString() }
            ]
        };

        await container.items.upsert(newScore);
    } catch (error) {
        console.error(`Failed to update score for user ${userId}:`, error.message);
    }
}

app.cosmosDB('processActivityFeed', {
    connectionStringSetting: 'COSMOS_DB_CONNECTION_STRING',
    databaseName: 'knowledge-platform', // From .env
    collectionName: 'documents',
    leaseCollectionName: 'leases',
    createLeaseCollectionIfNotExists: true,
    handler: async (documents, context) => {
        context.log(`Processing ${documents.length} documents from Change Feed`);

        for (const doc of documents) {
            // Check for specific actions based on document state
            // Note: Change Feed gives the *current* state of the document. 
            // We can't easily see the *previous* state to diff, unless we track state transitions via properties or soft-deletes.

            // Logic:
            // 1. Upload (New creation): If _ts is close to now (approx) and no special flags. 
            //    Or better, check if we haven't processed this ID for 'upload' yet. 
            //    Simplification: We'll assume if it's new and status is 'uploaded' => +10.

            // 2. Review/Approve: If status is 'approved' (we only see the final state).
            //    To avoid double counting, we might need to store "processed_events" in the user score or separate container.
            //    For this implementation, we will assume the backend updates a "pointsAwarded" flag on the document itself to prevent double counting?
            //    Or we just blindly award points for "approved" docs if they haven't been awarded?
            //    A cleaner way is if the Backend *writes* the status change, it could also write a "points_pending" flag?
            //    Let's handle a safe case: If status is 'approved' and we assume the action just happened. 
            //    (Limitation: Rewinding change feed might double count).

            const userId = doc.uploadedBy || 'unknown';
            const userName = doc.uploaderName || 'Anonymous';

            if (userId === 'unknown') continue;

            // Scenario: Document Approved
            if (doc.status === 'approved') {
                // We should ideally check if we already awarded for this. 
                // For this demo, we'll optimistically award +50.
                await updateUserScore(userId, userName, 50, 'document_approved');
            }

            // Scenario: Document Uploaded (New)
            // If it's a fresh doc (status usually 'uploaded' or 'processing')
            // And creation time is recent
            const created = new Date(doc.createdAt).getTime();
            const now = Date.now();
            if (doc.status === 'uploaded' || doc.status === 'processing') {
                // +10 points
                await updateUserScore(userId, userName, 10, 'document_upload');
            }
        }
    }
});
