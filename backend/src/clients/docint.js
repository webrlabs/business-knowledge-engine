const { DocumentAnalysisClient } = require('@azure/ai-form-recognizer');
const { AzureKeyCredential } = require('@azure/core-auth');
const { DefaultAzureCredential } = require('@azure/identity');

function createDocumentIntelligenceClient() {
  const endpoint = process.env.AZURE_FORM_RECOGNIZER_ENDPOINT;
  if (!endpoint) {
    throw new Error('AZURE_FORM_RECOGNIZER_ENDPOINT is required');
  }

  const apiKey = process.env.AZURE_FORM_RECOGNIZER_KEY;

  // Use API key if provided (local dev), otherwise use Azure AD (deployed)
  if (apiKey) {
    return new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
  }

  return new DocumentAnalysisClient(endpoint, new DefaultAzureCredential());
}

module.exports = {
  createDocumentIntelligenceClient,
};
