const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const containerName =
  process.env.AZURE_STORAGE_CONTAINER_DOCUMENTS || 'documents';

let containerClient;

function getBlobServiceClient() {
  if (connectionString) {
    return BlobServiceClient.fromConnectionString(connectionString);
  }
  if (!accountName) {
    throw new Error('AZURE_STORAGE_ACCOUNT_NAME is required when no connection string is provided');
  }
  const url = `https://${accountName}.blob.core.windows.net`;
  return new BlobServiceClient(url, new DefaultAzureCredential());
}

async function getContainerClient() {
  if (containerClient) {
    return containerClient;
  }
  const serviceClient = getBlobServiceClient();
  containerClient = serviceClient.getContainerClient(containerName);
  await containerClient.createIfNotExists();
  return containerClient;
}

async function uploadBuffer(buffer, blobName, contentType) {
  const container = await getContainerClient();
  const client = container.getBlockBlobClient(blobName);
  await client.uploadData(buffer, {
    blobHTTPHeaders: {
      blobContentType: contentType,
    },
  });
  return {
    blobName,
    url: client.url,
  };
}

module.exports = {
  uploadBuffer,
};
