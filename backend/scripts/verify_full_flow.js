require('dotenv').config({ path: '../.env' });
const { v4: uuidv4 } = require('uuid');
const { getBlobServiceClient, uploadBuffer } = require('../src/storage/blob');
const { DocumentProcessor } = require('../src/pipelines/document-processor');
const cosmos = require('../src/storage/cosmos');
const { getGraphService } = require('../src/services/graph-service');
const { log } = require('../src/utils/logger');

async function verifyFullFlow() {
    console.log('Starting full functional test...');

    const documentId = uuidv4();
    const testFileName = `test-doc-${Date.now()}.txt`;
    const textContent = `
    Business Process: Employee Onboarding
    Role: HR Manager
    Task: Review Application
    Decision: Approve?
    Role: IT Support
    Task: Provision Laptop
  `;

    try {
        // 1. Upload Document
        console.log(`1. Uploading test document: ${testFileName}`);
        const { url: blobUrl } = await uploadBuffer(
            Buffer.from(textContent),
            testFileName,
            'text/plain'
        );
        console.log(`   Uploaded to: ${blobUrl}`);

        // 2. Create Cosmos DB Entry
        console.log('2. Creating document record in Cosmos DB...');

        await cosmos.createDocument({
            id: documentId,
            name: testFileName,
            type: 'text/plain',
            documentType: 'document', // Required for partition key
            blobUrl: blobUrl,
            status: 'uploaded',
            uploadDate: new Date().toISOString()
        });
        console.log(`   Created document record: ${documentId}`);

        // 3. Process Document
        console.log('3. Triggering Document Processor...');
        const processor = new DocumentProcessor(cosmos);

        // Process the document
        await processor.processDocument(documentId, blobUrl, { mimeType: 'text/plain' });
        console.log('   Processing complete.');

        // 4. Verify Graph
        console.log('4. Verifying Graph Ingestion...');
        const graph = getGraphService();
        const stats = await graph.getStats();
        console.log(`   Graph Stats: Vertices=${stats.vertexCount}, Edges=${stats.edgeCount}`);

        // Check for specific entities
        const hrManager = await graph.findVertexByName('HR Manager');
        const itSupport = await graph.findVertexByName('IT Support');

        if (hrManager) {
            console.log('   ✅ Found "HR Manager" vertex in the graph.');
        } else {
            console.error('   ❌ Failed to find "HR Manager" vertex.');
        }

        if (itSupport) {
            console.log('   ✅ Found "IT Support" vertex in the graph.');
        } else {
            console.error('   ❌ Failed to find "IT Support" vertex.');
        }

        /*
        // Cleanup (optional)
        await graph.deleteVertexByDocumentId(documentId);
        console.log('   Cleanup: Removed graph vertices for this document.');
        */

    } catch (error) {
        console.error('Test Failed:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        // specialized cleanup if needed or close clients
        const graph = getGraphService();
        await graph.close();
    }
}

verifyFullFlow();
