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
   * Enrichment extraction — Ollama only, never falls back to Claude.
   * First attempt uses num_ctx 8192. On any failure, retries once with
   * num_ctx 4096 (smaller window, faster inference). If that also fails
   * the error propagates so the caller skips that hotel and moves on.
   */
  async generateEnrichmentResponse(messages: ChatMessage[]): Promise<string> {
    try {
      return await this.callOllama(messages, this.ollamaEnrichmentModel, 4096);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`  🔄 Ollama failed (${reason}), waiting 3s then retrying with smaller context...`);
      await new Promise(r => setTimeout(r, 3000));
      return await this.callOllama(messages, this.ollamaEnrichmentModel, 2048);
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
      if (data.error?.type === 'rate_limit_error') {
        console.error('🛑 Claude rate limit hit:', data.error.message);
        throw new RateLimitError(data.error.message);
      }
      console.error('Claude API Error:', JSON.stringify(data, null, 2));
      throw new Error(`Claude API error ${response.status}: ${data.error?.message}`);
    }

    return data.content?.[0]?.text ?? 'Unexpected response format from Claude.';
  }

  private async callOllama(messages: ChatMessage[], model: string, numCtx = 8192): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            num_ctx: numCtx,
            temperature: 0,      // greedy decoding — faster, deterministic
            num_predict: 400,    // JSON output is ~150-250 tokens; stops post-JSON reasoning
          },
        }),
        signal: AbortSignal.timeout(120000),
      });
    } catch (err: any) {
      // Surface the real underlying error (ECONNREFUSED, ECONNRESET, timeout, etc.)
      const cause = err?.cause?.message ?? err?.cause ?? err?.message ?? String(err);
      throw new Error(`Ollama unreachable: ${cause}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 404 || body.includes('not found')) {
        throw new Error(`model "${model}" not found — run: ollama pull ${model}`);
      }
      throw new Error(`Ollama HTTP ${response.status}: ${body}`);
    }

    const data = await response.json();
    const content = data.message?.content ?? '';
    if (!content) throw new Error('Ollama returned empty content');
    return content;
  }
}
