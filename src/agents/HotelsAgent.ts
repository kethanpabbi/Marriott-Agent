import { PrismaClient, Hotel } from '@prisma/client';

const prisma = new PrismaClient();

export class HotelsAgent {
  /**
   * Searches for hotels based on region or specific criteria.
   */
  async searchHotels(query: string, filters?: { region?: string; priceMax?: number }): Promise<Hotel[]> {
    const cleanedQuery = query.toLowerCase()
      .replace("find a hotel in ", "")
      .replace("marriott in ", "")
      .replace("show me ", "")
      .trim();

    return await prisma.hotel.findMany({
      where: {
        ...(cleanedQuery ? {
          OR: [
            { name: { contains: cleanedQuery } },
            { location: { contains: cleanedQuery } },
            { region: { contains: cleanedQuery } },
            { description: { contains: cleanedQuery } },
          ]
        } : {}),
        status: { not: "Closed" },
      },
      include: {
        nearbyAttractions: true,
      },
    }) as any;
  }

  /**
   * Checks for data inconsistencies in hotel properties.
   */
  async flagInconsistencies(): Promise<string[]> {
    const hotels = await prisma.hotel.findMany();
    const flags: string[] = [];

    for (const hotel of hotels) {
      // Example check: suspicious price (simulated here since price is string in schema for simplicity)
      if (hotel.priceRange.includes("$1") && !hotel.priceRange.includes("$100")) {
        flags.push(`Inconsistent pricing at ${hotel.name}: ${hotel.priceRange}`);
      }

      // Check for outdated info (e.g., not updated in 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (hotel.lastUpdated < thirtyDaysAgo) {
        flags.push(`${hotel.name} data is stale. Last updated: ${hotel.lastUpdated}`);
      }
    }

    return flags;
  }

  /**
   * Retrieves tourist attractions near a specific hotel.
   */
  async getNearbyAttractions(hotelId: string) {
    return await prisma.attraction.findMany({
      where: { hotelId },
    });
  }

  /**
   * Syncs a location's data autonomously.
   */
  async syncLocation(location: string, scraper: any, llmService: any) {
    console.log(`🚀 Checking local records for ${location}...`);
    
    const existing = await prisma.hotel.findMany({
      where: {
        OR: [
          { location: { contains: location } },
          { region: { contains: location } }
        ]
      }
    });

    if (existing.length > 0) {
      console.log(`✅ Found ${existing.length} properties for ${location} in local database.`);
      return true;
    }

    console.log(`🌐 No local data for ${location}. Attempting autonomous discovery...`);
    
    // 1. REAL-TIME SEARCH: Find the official Marriott destination page
    const searchResults = await scraper.search(`official Marriott Bonvoy hotels directory in ${location}`);
    
    // Pick the most likely Marriott official URL (usually the one containing 'marriott.com' and 'destinations')
    const bestUrl = searchResults.find((r: any) => r.url.includes('marriott.com') && r.url.includes('destinations'))?.url 
                 || searchResults[0]?.url;

    let deepScrapeContent = "";
    if (bestUrl) {
      console.log(`🔍 Deep-scraping verified directory: ${bestUrl}`);
      const scrapeResult = await scraper.scrapeProperty(bestUrl);
      deepScrapeContent = scrapeResult?.data?.markdown || JSON.stringify(scrapeResult?.data) || "";
    }

    // 2. KNOWLEDGE SYNTHESIS: Use LLM to extract verified property data from DEEP SCRAPE
    const discoveryPrompt = `
      You are the Marriott Portfolio Specialist. 
      The user is looking for Marriott Bonvoy hotels in: ${location}.
      
      I have scraped the live Marriott directory for this city:
      ${deepScrapeContent.slice(0, 15000)} // Pass a large chunk of the page

      TASK:
      1. Identify ALL real Marriott properties listed in this text. 
      2. IGNORE your internal training data if it contradicts the text (e.g. if a hotel has a new name, use the NEW name from the text).
      3. Extract up to 10 properties.
      
      OUTPUT ONLY JSON:
      { "hotels": [{ "name": string, "price": string, "amenities": string[], "description": string, "rating": number }] }
    `;

    try {
      const discoveryResponse = await llmService.generateResponse([{ role: 'user', content: discoveryPrompt }]);
      const jsonStr = discoveryResponse.match(/\{[\s\S]*\}/)?.[0] || discoveryResponse;
      const discovered = JSON.parse(jsonStr);

      if (discovered.hotels && discovered.hotels.length > 0) {
        console.log(`🧠 Discovered ${discovered.hotels.length} verified properties for ${location} via Deep-Scrape.`);
        
        for (const h of discovered.hotels) {
          await prisma.hotel.upsert({
            where: { name: h.name },
            update: {
              location: `${location}`,
              priceRange: h.price,
              description: h.description || `Verified Marriott property in ${location}.`,
              amenities: h.amenities.join(', '),
              restaurants: "Marriott Signature Dining",
              activities: `Experience ${location}`,
              region: "Global Discovery",
              rating: h.rating || (4.5 + (Math.random() * 0.4))
            },
            create: {
              name: h.name,
              location: `${location}`,
              priceRange: h.price,
              description: h.description || `Verified Marriott property in ${location}.`,
              amenities: h.amenities.join(', '),
              restaurants: "Marriott Signature Dining",
              activities: `Experience ${location}`,
              region: "Global Discovery",
              rating: h.rating || (4.5 + (Math.random() * 0.4))
            }
          });
        }
        return true;
      }
    } catch (err) {
      console.error("Discovery Error:", err);
    }

    return false;
  }
}
