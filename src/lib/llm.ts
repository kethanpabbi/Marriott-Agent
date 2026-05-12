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
    return this.callOllama(messages, this.ollamaEnrichmentModel);
  }

  /**
   * Enrichment extraction — always tries Ollama first (free, no rate limits).
   * Falls back to Claude only if Ollama is unreachable.
   * Throws RateLimitError if Claude is used and rate-limited, so callers can stop.
   */
  async generateEnrichmentResponse(messages: ChatMessage[]): Promise<string> {
    try {
      return await this.callOllama(messages, this.ollamaEnrichmentModel);
    } catch {
      console.log('⚠️  Ollama unavailable — falling back to Claude for enrichment');
      return this.callClaude(messages, 1024);
    }
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
      // Throw a typed error so callers can react appropriately
      if (data.error?.type === 'rate_limit_error') {
        console.error('🛑 Claude rate limit hit:', data.error.message);
        throw new RateLimitError(data.error.message);
      }
      console.error('Claude API Error:', JSON.stringify(data, null, 2));
      throw new Error(`Claude API error ${response.status}: ${data.error?.message}`);
    }

    return data.content?.[0]?.text ?? 'Unexpected response format from Claude.';
  }

  private async callOllama(messages: ChatMessage[], model: string): Promise<string> {
    const response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Ollama error ${response.status}`);
    }

    const data = await response.json();
    return data.message?.content ?? '';
  }
}
