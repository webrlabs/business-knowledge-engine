require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { uploadBuffer, generateSasUrl, getBlobNameFromUrl } = require('../src/storage/blob');
const { createDocument, getDocumentById, updateDocument } = require('../src/storage/cosmos');
const { DocumentProcessor } = require('../src/pipelines/document-processor');

async function processDocument() {
  console.log('=== PROCESSING DOE O 200.1A - IT MANAGEMENT ORDER ===\n');

  const filePath = path.join(__dirname, '..', '..', 'tests', 'docs', 'O200.1A.pdf');
  const filename = 'O200.1A.pdf';
  const documentId = uuidv4();

  console.log('Document ID:', documentId);
  console.log('File:', filePath);

  // Check file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileStats = fs.statSync(filePath);
  console.log('File size:', (fileStats.size / 1024).toFixed(2), 'KB\n');

  // Step 1: Upload to blob storage
  console.log('Step 1: Uploading to Azure Blob Storage...');
  const fileBuffer = fs.readFileSync(filePath);
  const blobName = `uploads/${documentId}/${filename}`;

  const uploadResult = await uploadBuffer(fileBuffer, blobName, 'application/pdf');
  const blobUrl = uploadResult.url;
  console.log('Blob URL:', blobUrl);
  console.log('Upload complete!\n');

  // Step 2: Create document record in Cosmos DB
  console.log('Step 2: Creating document record in Cosmos DB...');

  // Create cosmos service wrapper for DocumentProcessor
  const cosmosService = {
    updateDocument,
    getDocument: getDocumentById,
    createDocument
  };

  const documentRecord = {
    id: documentId,
    documentType: 'document', // Partition key - must be 'document'
    filename: filename,
    originalName: filename,
    title: 'DOE O 200.1A - Information Technology Management',
    mimeType: 'application/pdf',
    blobUrl: blobUrl,
    blobName: blobName,
    fileSize: fileStats.size,
    uploadedAt: new Date().toISOString(),
    status: 'pending',
    metadata: {
      doeDocumentType: 'DOE Order',
      orderNumber: '200.1A',
      subject: 'Information Technology Management',
      approvalDate: '2008-12-23',
      lastChange: '2023-08-11'
    }
  };

  await createDocument(documentRecord);
  console.log('Document record created!\n');

  // Step 3: Process the document
  console.log('Step 3: Processing document through pipeline...');
  console.log('This may take several minutes for a 42-page document...\n');

  const processor = new DocumentProcessor(cosmosService);

  const startTime = Date.now();

  try {
    const result = await processor.processDocument(documentId, blobUrl, {
      mimeType: 'application/pdf',
      filename: filename,
      title: 'DOE O 200.1A - Information Technology Management',
      chunkingStrategy: 'fixed' // Use fixed chunking for memory efficiency
    });

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n=== PROCESSING COMPLETE ===\n');
    console.log('Processing time:', processingTime, 'seconds');
    console.log('\n--- STATISTICS ---');
    console.log('Pages processed:', result.stats.pageCount);
    console.log('Chunks created:', result.stats.chunksCreated);
    console.log('Chunks indexed:', result.stats.chunksIndexed);
    console.log('Entities extracted:', result.stats.entitiesExtracted);
    console.log('Entities resolved:', result.stats.entitiesResolved);
    console.log('Entities merged:', result.stats.entitiesMerged);
    console.log('Entities linked:', result.stats.entitiesLinked);
    console.log('Relationships extracted:', result.stats.relationshipsExtracted);
    console.log('Cross-document links:', result.stats.crossDocumentLinks);
    console.log('Entity mentions tracked:', result.stats.uniqueEntitiesMentioned);
    console.log('Total mentions:', result.stats.totalEntityMentions);

    if (result.stats.validationSummary) {
      console.log('\n--- VALIDATION SUMMARY ---');
      console.log('Entities with warnings:', result.stats.validationSummary.entitiesWithWarnings);
      console.log('Relationships with warnings:', result.stats.validationSummary.relationshipsWithWarnings);
    }

    // Get document details to show entities
    const updatedDoc = await getDocumentById(documentId);

    if (updatedDoc.entities && updatedDoc.entities.length > 0) {
      console.log('\n--- EXTRACTED ENTITIES (sample) ---');
      const entityTypes = {};
      for (const entity of updatedDoc.entities) {
        entityTypes[entity.type] = (entityTypes[entity.type] || 0) + 1;
      }
      console.log('Entity types distribution:');
      for (const [type, count] of Object.entries(entityTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type}: ${count}`);
      }

      console.log('\nTop entities by type:');
      const byType = {};
      for (const entity of updatedDoc.entities) {
        if (!byType[entity.type]) byType[entity.type] = [];
        if (byType[entity.type].length < 3) {
          byType[entity.type].push(entity.name);
        }
      }
      for (const [type, names] of Object.entries(byType)) {
        console.log(`  ${type}: ${names.join(', ')}`);
      }
    }

    if (updatedDoc.relationships && updatedDoc.relationships.length > 0) {
      console.log('\n--- EXTRACTED RELATIONSHIPS (sample) ---');
      const relTypes = {};
      for (const rel of updatedDoc.relationships) {
        relTypes[rel.type] = (relTypes[rel.type] || 0) + 1;
      }
      console.log('Relationship types:');
      for (const [type, count] of Object.entries(relTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type}: ${count}`);
      }

      console.log('\nSample relationships:');
      for (const rel of updatedDoc.relationships.slice(0, 10)) {
        console.log(`  ${rel.from || rel.source} --[${rel.type}]--> ${rel.to || rel.target}`);
      }
    }

    return result;

  } catch (error) {
    console.error('\nProcessing failed:', error.message);
    console.error(error.stack);
    throw error;
  }
}

processDocument()
  .then(() => {
    console.log('\n=== DOCUMENT PROCESSING COMPLETE ===');
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
