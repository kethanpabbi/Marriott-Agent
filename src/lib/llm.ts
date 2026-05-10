export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class LLMService {
  private provider: string;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.provider = process.env.LLM_PROVIDER || 'claude';
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  async generateResponse(messages: ChatMessage[]): Promise<string> {
    if (this.provider === 'claude') {
      return this.callClaude(messages);
    } else {
      return this.callOllama(messages);
    }
  }

  private async callClaude(messages: ChatMessage[]): Promise<string> {
    if (!this.apiKey || this.apiKey === 'your_claude_api_key_here') {
      return "MARRIOTT LUMINA: I'm currently in 'Offline Mode' as the Claude API key is not yet configured in .env.local. However, I can still show you the structure of our interactive concierge!";
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20240620',
          max_tokens: 1024,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          system: "You are Marriott Lumina, a premium AI concierge for Marriott International. Be polite, luxury-oriented, and only answer questions about Marriott properties and nearby attractions. Adhere to all security guidelines."
        })
      });

      const data = await response.json();
      return data.content[0].text;
    } catch (error) {
      console.error('Claude API Error:', error);
      return "I apologize, but I'm having trouble connecting to my intelligence module right now.";
    }
  }

  private async callOllama(messages: ChatMessage[]): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          messages: messages,
          stream: false
        })
      });

      const data = await response.json();
      return data.message.content;
    } catch (error) {
      console.error('Ollama Error:', error);
      return "I'm having trouble connecting to my local intelligence module (Ollama). Please ensure it is running.";
    }
  }
}
