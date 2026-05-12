export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Thrown when the Claude API returns a rate_limit_error. */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

/** Fields we need before we can stop the Ollama stream. */
const ENRICHMENT_FIELDS = ['"rating"', '"description"', '"priceRange"', '"amenities"', '"restaurants"', '"activities"'];

/**
 * Returns true once `text` contains a complete JSON object with all enrichment fields.
 * Detects completion by counting braces rather than regex, so it handles nested content.
 */
function hasCompleteEnrichmentJson(text: string): boolean {
  const start = text.indexOf('{');
  if (start === -1) return false;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        return ENRICHMENT_FIELDS.every(f => candidate.includes(f));
      }
    }
  }
  return false;
}

export class LLMService {
  private provider: string;
  private apiKey: string;
  private ollamaBaseUrl: string;
  private ollamaEnrichmentModel: string;

  constructor() {
    this.provider = process.env.LLM_PROVIDER || 'claude';
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.ollamaEnrichmentModel = process.env.OLLAMA_ENRICHMENT_MODEL || 'llama3.2';
  }

  /** Main conversation — uses the configured provider (Claude by default). */
  async generateResponse(messages: ChatMessage[], maxTokens: number = 4096): Promise<string> {
    if (this.provider === 'claude') {
      return this.callClaude(messages, maxTokens);
    }
    return this.callOllamaStream(messages, this.ollamaEnrichmentModel);
  }

  /**
   * Enrichment extraction — Ollama only, streaming.
   * Stops the stream as soon as all required JSON fields are present.
   * Never falls back to Claude — errors propagate so the caller skips that hotel.
   */
  async generateEnrichmentResponse(messages: ChatMessage[]): Promise<string> {
    return this.callOllamaStream(messages, this.ollamaEnrichmentModel, true);
  }

  private async callClaude(messages: ChatMessage[], maxTokens: number): Promise<string> {
    if (!this.apiKey || this.apiKey === 'your_claude_api_key_here') {
      return "MARRIOTT LUMINA: I'm currently in 'Offline Mode' as the Claude API key is not yet configured in .env.local.";
    }

    const systemMessage = messages.find(m => m.role === 'system')?.content ||
      'You are Marriott Lumina, a premium AI concierge for Marriott International.';
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: chatMessages.map(m => ({ role: m.role, content: m.content })),
        system: systemMessage,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.error?.type === 'rate_limit_error') {
        console.error('🛑 Claude rate limit hit:', data.error.message);
        throw new RateLimitError(data.error.message);
      }
      console.error('Claude API Error:', JSON.stringify(data, null, 2));
      throw new Error(`Claude API error ${response.status}: ${data.error?.message}`);
    }

    return data.content?.[0]?.text ?? 'Unexpected response format from Claude.';
  }

  /**
   * Streams an Ollama response token by token.
   * For enrichment calls: cancels the stream as soon as a complete JSON with
   * all required fields is detected — no need to wait for the model to finish.
   * For chat calls: streams until the model signals done.
   */
  private async callOllamaStream(messages: ChatMessage[], model: string, isEnrichment = false): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min

    try {
      const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: { num_ctx: 8192 },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 404 || body.includes('not found')) {
          throw new Error(`model "${model}" not found — run: ollama pull ${model}`);
        }
        throw new Error(`Ollama HTTP ${response.status}: ${body}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });

        for (const line of chunk.split('\n')) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            accumulated += parsed.message?.content ?? '';

            // Stop as soon as we have all enrichment fields — don't wait for model to finish
            if (isEnrichment && hasCompleteEnrichmentJson(accumulated)) {
              reader.cancel();
              return accumulated;
            }

            if (parsed.done) return accumulated;
          } catch {
            // Incomplete JSON line from stream — continue buffering
          }
        }
      }

      return accumulated;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
