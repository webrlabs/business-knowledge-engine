const { OpenAIClient } = require('@azure/openai');
const { DefaultAzureCredential } = require('@azure/identity');

function createOpenAIClient() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  if (!endpoint) {
    throw new Error('AZURE_OPENAI_ENDPOINT is required');
  }
  return new OpenAIClient(endpoint, new DefaultAzureCredential());
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
