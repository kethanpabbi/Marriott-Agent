export class ScraperService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.FIRECRAWL_API_KEY || '';
  }

  /**
   * Scrapes a Marriott property page and returns structured data.
   */
  async scrapeProperty(url: string) {
    if (!this.apiKey || this.apiKey === 'your_firecrawl_api_key_here') {
      console.warn("Firecrawl API key not configured. Returning mock data.");
      return this.getMockPropertyData(url);
    }

    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          url: url,
          formats: ['markdown', 'json'],
          // Example schema for extraction
          extract: {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                price: { type: "string" },
                amenities: { type: "array", items: { type: "string" } },
                description: { type: "string" }
              }
            }
          }
        })
      });

      return await response.json();
    } catch (error) {
      console.error('Firecrawl Scrape Error:', error);
      return null;
    }
  }

  /**
   * Searches the web for a query and returns URLs.
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

  private getMockPropertyData(url: string) {
    return {
      name: "Mock Marriott Property",
      description: "A luxury property extracted from " + url,
      price: "$299 - $599",
      amenities: ["Free WiFi", "Pool", "Gym"]
    };
  }
}
