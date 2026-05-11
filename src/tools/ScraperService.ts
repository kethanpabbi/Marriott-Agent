export class ScraperService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.FIRECRAWL_API_KEY || '';
    console.log(`📡 ScraperService initialized. API Key present: ${this.apiKey ? 'YES' : 'NO'} (${this.apiKey.substring(0, 5)}...)`);
  }

  /**
   * Searches the web for a query and returns snippets.
   */
  async search(query: string) {
    if (!this.apiKey || this.apiKey === 'your_firecrawl_api_key_here') {
      console.warn("Firecrawl API key not configured. Returning empty search results.");
      return [];
    }

    try {
      const response = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          query: query,
          searchOptions: {
            limit: 5
          }
        })
      });

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Firecrawl Search Error:', error);
      return [];
    }
  }

}
