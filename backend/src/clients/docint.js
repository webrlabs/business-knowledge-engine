const { DocumentAnalysisClient } = require('@azure/ai-form-recognizer');
const { DefaultAzureCredential } = require('@azure/identity');

function createDocumentIntelligenceClient() {
  const endpoint = process.env.AZURE_FORM_RECOGNIZER_ENDPOINT;
  if (!endpoint) {
    throw new Error('AZURE_FORM_RECOGNIZER_ENDPOINT is required');
  }
  return new DocumentAnalysisClient(endpoint, new DefaultAzureCredential());
}

module.exports = {
  createDocumentIntelligenceClient,
};
