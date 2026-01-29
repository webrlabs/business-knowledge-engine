import type { ThinkingStep } from './chat-types';

export interface StreamCallbacks {
  onContent: (text: string) => void;
  onThinking: (step: ThinkingStep) => void;
  onMetadata: (data: { citations?: string[]; responseTime?: number }) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export async function streamChatResponse(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Stream request failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events from the buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete last line in buffer

      let eventType = '';
      let eventData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          eventData = line.slice(6);
        } else if (line === '' && eventType && eventData) {
          // End of event - process it
          try {
            const parsed = JSON.parse(eventData);
            switch (eventType) {
              case 'content':
                callbacks.onContent(parsed.text || '');
                break;
              case 'thinking': {
                // Parse structured thinking events
                const step: ThinkingStep = {
                  type: parsed.type || 'status',
                  message: parsed.message || parsed.content,
                  content: parsed.content,
                  items: parsed.items,
                  count: parsed.count,
                };
                callbacks.onThinking(step);
                break;
              }
              case 'metadata':
                callbacks.onMetadata(parsed);
                break;
              case 'done':
                callbacks.onDone();
                break;
              case 'error':
                callbacks.onError(new Error(parsed.message || 'Stream error'));
                break;
            }
          } catch {
            // Non-JSON data line, treat as content
            if (eventType === 'content') {
              callbacks.onContent(eventData);
            }
          }
          eventType = '';
          eventData = '';
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      // If there's leftover data that wasn't terminated, treat as final content
      callbacks.onDone();
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      // User cancelled — not an error
      callbacks.onDone();
      return;
    }
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}
