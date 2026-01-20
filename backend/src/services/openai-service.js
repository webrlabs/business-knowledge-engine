const { createOpenAIClient, getOpenAIConfig } = require('../clients');

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

class OpenAIService {
  constructor() {
    this.client = null;
    this.config = getOpenAIConfig();
  }

  async _getClient() {
    if (!this.client) {
      this.client = createOpenAIClient();
    }
    return this.client;
  }

  async _retryWithBackoff(operation, maxRetries = DEFAULT_MAX_RETRIES) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        const isRetryable =
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.statusCode === 429 ||
          error.statusCode === 503 ||
          error.statusCode === 500;

        if (!isRetryable || attempt === maxRetries - 1) {
          throw error;
        }

        // Exponential backoff with jitter
        const delay = DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
        await this._sleep(delay);
      }
    }

    throw lastError;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getChatCompletion(messages, options = {}) {
    const client = await this._getClient();
    const model = options.deploymentName || this.config.deploymentName;

    if (!model) {
      throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME is required');
    }

    return this._retryWithBackoff(async () => {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: options.temperature ?? 0.0,
        max_tokens: options.maxTokens ?? 4096,
        response_format: options.responseFormat,
      });

      return {
        content: response.choices[0]?.message?.content || '',
        usage: response.usage,
        finishReason: response.choices[0]?.finish_reason,
      };
    });
  }

  async getJsonCompletion(messages, options = {}) {
    const response = await this.getChatCompletion(messages, {
      ...options,
      responseFormat: { type: 'json_object' },
    });

    try {
      return {
        ...response,
        content: JSON.parse(response.content),
      };
    } catch (parseError) {
      throw new Error(`Failed to parse JSON response: ${parseError.message}. Response: ${response.content}`);
    }
  }

  async getEmbedding(text) {
    const client = await this._getClient();
    const model = this.config.embeddingDeployment;

    if (!model) {
      throw new Error('AZURE_OPENAI_EMBEDDING_DEPLOYMENT is required');
    }

    return this._retryWithBackoff(async () => {
      const response = await client.embeddings.create({
        model,
        input: text,
      });
      return {
        embedding: response.data[0].embedding,
        usage: response.usage,
      };
    });
  }

  async getEmbeddings(texts) {
    const client = await this._getClient();
    const model = this.config.embeddingDeployment;

    if (!model) {
      throw new Error('AZURE_OPENAI_EMBEDDING_DEPLOYMENT is required');
    }

    // Process in batches of 16 (Azure OpenAI limit)
    const BATCH_SIZE = 16;
    const results = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      const response = await this._retryWithBackoff(async () => {
        return await client.embeddings.create({
          model,
          input: batch,
        });
      });

      results.push(...response.data.map((d) => d.embedding));
    }

    return results;
  }
}

// Singleton instance
let instance = null;

function getOpenAIService() {
  if (!instance) {
    instance = new OpenAIService();
  }
  return instance;
}

module.exports = {
  OpenAIService,
  getOpenAIService,
};
