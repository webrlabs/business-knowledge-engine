const { AzureOpenAI } = require('openai');
const { DefaultAzureCredential, getBearerTokenProvider } = require('@azure/identity');

function createOpenAIClient() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) {
    throw new Error('AZURE_OPENAI_ENDPOINT is required');
  }

  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';

  // Use API key if provided (local dev), otherwise use Azure AD (deployed)
  if (apiKey) {
    return new AzureOpenAI({
      endpoint,
      apiKey,
      apiVersion,
    });
  }

  // Use managed identity for Azure deployment
  const credential = new DefaultAzureCredential();
  const scope = 'https://cognitiveservices.azure.com/.default';
  const azureADTokenProvider = getBearerTokenProvider(credential, scope);

  return new AzureOpenAI({
    endpoint,
    azureADTokenProvider,
    apiVersion,
  });
}

function getOpenAIConfig() {
  return {
    deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '',
    embeddingDeployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || '',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '',
  };
}

module.exports = {
  createOpenAIClient,
  getOpenAIConfig,
};
