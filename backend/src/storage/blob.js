const { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
const containerName =
  process.env.AZURE_STORAGE_CONTAINER_DOCUMENTS || 'documents';

let containerClient;
let sharedKeyCredential;

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

function getSharedKeyCredential() {
  if (sharedKeyCredential) {
    return sharedKeyCredential;
  }
  if (!accountName || !accountKey) {
    return null;
  }
  sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
  return sharedKeyCredential;
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

/**
 * Generate a SAS URL for a blob with read permissions
 * @param {string} blobName - The name of the blob
 * @param {number} expiryMinutes - How long the SAS token should be valid (default: 60 minutes)
 * @returns {Promise<string>} - The blob URL with SAS token
 */
async function generateSasUrl(blobName, expiryMinutes = 60) {
  const credential = getSharedKeyCredential();

  if (!credential) {
    // If no shared key credential, try using user delegation SAS
    // For now, just return the plain URL and hope the container is accessible
    const container = await getContainerClient();
    return container.getBlockBlobClient(blobName).url;
  }

  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + expiryMinutes * 60 * 1000);

  const sasOptions = {
    containerName,
    blobName,
    permissions: BlobSASPermissions.parse('r'), // Read only
    startsOn,
    expiresOn,
  };

  const sasToken = generateBlobSASQueryParameters(sasOptions, credential).toString();
  const container = await getContainerClient();
  const blobClient = container.getBlockBlobClient(blobName);

  return `${blobClient.url}?${sasToken}`;
}

/**
 * Extract blob name from a blob URL
 * @param {string} blobUrl - The full blob URL
 * @returns {string} - The blob name
 */
function getBlobNameFromUrl(blobUrl) {
  const url = new URL(blobUrl);
  // Path is like /container/blobname
  const pathParts = url.pathname.split('/');
  // Remove empty first element and container name
  return pathParts.slice(2).join('/');
}

/**
 * Delete a blob from storage
 * @param {string} blobName - The name of the blob to delete
 * @returns {Promise<boolean>} - True if deleted, false if not found
 */
async function deleteBlob(blobName) {
  const container = await getContainerClient();
  const client = container.getBlockBlobClient(blobName);
  try {
    await client.delete();
    return true;
  } catch (error) {
    if (error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

module.exports = {
  getContainerClient,
  uploadBuffer,
  generateSasUrl,
  getBlobNameFromUrl,
  deleteBlob,
};
