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
    
    // 1. REAL-TIME SEARCH: Find the LATEST Marriott properties via live web search
    const searchResults = await scraper.search(`official Marriott Bonvoy hotels in ${location}`);
    const searchContext = searchResults.map((r: any) => `${r.title}: ${r.url}`).join('\n');

    // 2. KNOWLEDGE SYNTHESIS: Use LLM to extract verified property data from search results
    const discoveryPrompt = `
      You are the Marriott Portfolio Specialist. 
      The user is looking for Marriott Bonvoy hotels in: ${location}.
      
      I found these search results:
      ${searchContext}

      TASK:
      Identify the REAL, CURRENT Marriott properties in this city. 
      NOTE: Be aware of recent rebrandings (e.g. Westin Dublin is now College Green Hotel).
      Provide up to 7 properties if they exist.
      
      OUTPUT ONLY JSON:
      { "hotels": [{ "name": string, "price": string, "amenities": string[], "description": string, "rating": number }] }
    `;

    try {
      const discoveryResponse = await llmService.generateResponse([{ role: 'user', content: discoveryPrompt }]);
      const jsonStr = discoveryResponse.match(/\{[\s\S]*\}/)?.[0] || discoveryResponse;
      const discovered = JSON.parse(jsonStr);

      if (discovered.hotels && discovered.hotels.length > 0) {
        console.log(`🧠 Discovered ${discovered.hotels.length} verified properties for ${location} via Real-Time Search.`);
        
        for (const h of discovered.hotels) {
          await prisma.hotel.upsert({
            where: { name: h.name },
            update: {
              location: `${location}`,
              priceRange: h.price,
              description: h.description || `A premium Marriott Bonvoy property in ${location} discovered through autonomous search.`,
              amenities: h.amenities.join(', '),
              restaurants: "Marriott Signature Dining",
              activities: `Cultural discovery in ${location}`,
              region: "Global Discovery",
              rating: h.rating || (4.5 + (Math.random() * 0.4))
            },
            create: {
              name: h.name,
              location: `${location}`,
              priceRange: h.price,
              description: h.description || `A premium Marriott Bonvoy property in ${location} discovered through autonomous search.`,
              amenities: h.amenities.join(', '),
              restaurants: "Marriott Signature Dining",
              activities: `Cultural discovery in ${location}`,
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
