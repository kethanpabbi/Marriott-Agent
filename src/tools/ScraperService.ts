export class ScraperService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.FIRECRAWL_API_KEY || '';
    console.log(`📡 ScraperService initialized. API Key present: ${this.apiKey ? 'YES' : 'NO'} (${this.apiKey.substring(0, 5)}...)`);
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
      // Step 1: Attempt standard scrape (Fast & Cheap)
      let response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          url: url,
          formats: ['markdown'],
        })
      });

      let result = await response.json();
      
      // Step 2: Smart Upgrade if blocked or sparse (e.g. 403/429 or Cloudflare)
      const content = result?.data?.markdown || "";
      if (!response.ok || content.length < 500 || content.includes("Cloudflare") || content.includes("403 Forbidden")) {
        console.log(`⚠️ Standard scrape restricted for ${url}. Upgrading to Premium JS-Rendering...`);
        
        // This is the "Nuclear Option" - uses headless chromium via Firecrawl
        // Cost: ~5x more credits, but 100% accuracy on JS-heavy sites
        response = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            url: url,
            formats: ['markdown', 'json'],
            waitFor: 8000, // Deep wait for Marriott's React components
            actions: [
              { type: "scroll", direction: "down" },
              { type: "wait", duration: 2000 }
            ]
          })
        });
        result = await response.json();
      }

      return result;
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
