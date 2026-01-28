const { createOpenAIClient, getOpenAIConfig } = require('../clients');
const { getCircuitBreakerService } = require('./circuit-breaker-service');

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

class OpenAIService {
  constructor() {
    this.client = null;
    this.config = getOpenAIConfig();
    this._circuitBreaker = null;
  }

  async _getClient() {
    if (!this.client) {
      this.client = createOpenAIClient();
    }
    return this.client;
  }

  _getCircuitBreaker() {
    if (!this._circuitBreaker) {
      this._circuitBreaker = getCircuitBreakerService();
    }
    return this._circuitBreaker;
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

    // Create the operation that accepts messages as a parameter
    // IMPORTANT: The circuit breaker caches the function by key, so we must
    // pass arguments through fire() rather than capturing them in a closure.
    const operation = async (msgs, opts) => {
      return this._retryWithBackoff(async () => {
        const response = await client.chat.completions.create({
          model: opts.model,
          messages: msgs,
          max_completion_tokens: opts.maxTokens ?? 4096,
          response_format: opts.responseFormat,
        });

        return {
          content: response.choices[0]?.message?.content || '',
          usage: response.usage,
          finishReason: response.choices[0]?.finish_reason,
        };
      });
    };

    // Use circuit breaker - pass messages as arguments to fire() so each
    // call gets its own messages rather than reusing a cached closure
    const cb = this._getCircuitBreaker();
    const breaker = cb.getBreaker('openai-chat', operation, { name: 'getChatCompletion' });
    return breaker.fire(messages, { model, maxTokens: options.maxTokens, responseFormat: options.responseFormat });
  }

  async getStreamingChatCompletion(messages, options = {}) {
    const client = await this._getClient();
    const model = options.deploymentName || this.config.deploymentName;

    if (!model) {
      throw new Error('AZURE_OPENAI_DEPLOYMENT_NAME is required');
    }

    const stream = await client.chat.completions.create({
      model,
      messages,
      max_completion_tokens: options.maxTokens ?? 4096,
      stream: true,
    });

    return stream;
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

  async getVisionCompletion(prompt, imageUrl, options = {}) {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          },
        ],
      },
    ];

    return this.getChatCompletion(messages, options);
  }

  async getEmbedding(text) {
    const client = await this._getClient();
    const model = this.config.embeddingDeployment;

    if (!model) {
      throw new Error('AZURE_OPENAI_EMBEDDING_DEPLOYMENT is required');
    }

    // Pass text as argument to fire() to avoid closure caching issue
    const cb = this._getCircuitBreaker();
    const operation = async (inputText) => {
      return this._retryWithBackoff(async () => {
        const response = await client.embeddings.create({
          model,
          input: inputText,
        });
        return {
          embedding: response.data[0].embedding,
          usage: response.usage,
        };
      });
    };

    const breaker = cb.getBreaker('openai-embedding', operation, { name: 'getEmbedding' });
    return breaker.fire(text);
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
    const cb = this._getCircuitBreaker();

    // Define operation that takes batch as argument (avoid closure caching issue)
    const embeddingOperation = async (batchInput) => {
      return this._retryWithBackoff(async () => {
        return await client.embeddings.create({
          model,
          input: batchInput,
        });
      });
    };

    // Get or create the circuit breaker once (it's now stateless w.r.t. input)
    const breaker = cb.getBreaker('openai-embedding-batch', embeddingOperation, { name: 'getEmbeddingsBatch' });

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      // Pass batch as argument to fire() instead of closing over it
      const response = await breaker.fire(batch);
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
