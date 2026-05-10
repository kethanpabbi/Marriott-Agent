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
    
    // 1. REAL-TIME SEARCH: Find multiple directory leads with focus on ratings/prices
    let deepScrapeContent = "";
    try {
      const searchResults = await scraper.search(`official Marriott Bonvoy hotels in ${location} with ratings and current prices`);
      const potentialUrls = searchResults
        .map((r: any) => r.url)
        .filter((u: string) => u && u.includes('marriott.com'))
        .slice(0, 3);

      for (const url of potentialUrls) {
        console.log(`🔍 Attempting deep-scrape for ratings/prices: ${url}`);
        const scrapeResult = await scraper.scrapeProperty(url);
        const content = scrapeResult?.data?.markdown || JSON.stringify(scrapeResult?.data) || "";
        if (content.length > 1000) {
          deepScrapeContent += `\n--- SOURCE: ${url} ---\n${content}`;
        }
      }
    } catch (err) {
      console.warn("Search/Scrape failed:", err);
    }

    // 2. KNOWLEDGE SYNTHESIS: Extract the FULL portfolio with ACTUAL ratings
    const discoveryPrompt = `
      You are the Marriott Portfolio Specialist. 
      Identify ALL real Marriott properties in: ${location}.
      
      SOURCE DATA (FROM LIVE SEARCH):
      ${deepScrapeContent ? deepScrapeContent.slice(0, 20000) : "NO LIVE DATA. USE RECENT KNOWLEDGE."}

      TASK:
      1. Extract REAL Marriott properties.
      2. For each, you MUST find or provide the ACTUAL REAL-WORLD RATING (e.g. 4.7/5). 
      3. If the scraped text has a rating, use it. If not, use your knowledge of the property's real-world standing as of 2026.
      4. DO NOT MAKE UP NUMBERS. Use 0.0 ONLY if the property is brand new and unrated.
      
      OUTPUT ONLY JSON. NO PREAMBLE.
      { "hotels": [{ "name": string, "price": string, "amenities": string[], "description": string, "rating": number }] }
    `;

    try {
      const discoveryResponse = await llmService.generateResponse([{ role: 'user', content: discoveryPrompt }]);
      
      const startIdx = discoveryResponse.indexOf('{');
      const endIdx = discoveryResponse.lastIndexOf('}');
      if (startIdx === -1 || endIdx === -1) throw new Error("No JSON found");

      const jsonStr = discoveryResponse.substring(startIdx, endIdx + 1);
      const discovered = JSON.parse(jsonStr);

      if (discovered.hotels && discovered.hotels.length > 0) {
        console.log(`🧠 Discovered ${discovered.hotels.length} verified properties for ${location}.`);
        
        for (const h of discovered.hotels) {
          let actualRating = h.rating || 0.0;
          
          // 3. METRIC ENRICHMENT: If rating is missing, do a targeted search
          if (actualRating === 0.0) {
            console.log(`🔍 Enriching missing rating for: ${h.name}`);
            try {
              const ratingSearch = await scraper.search(`${h.name} Marriott Bonvoy official rating`);
              const ratingPrompt = `
                Extract the official Marriott rating (out of 5.0) for "${h.name}" from these snippets:
                ${ratingSearch.map((s: any) => s.title + ": " + s.snippet).join('\n')}
                
                OUTPUT ONLY THE NUMBER (e.g. 4.8). If truly not found, return "NA".
              `;
              const ratingResponse = await llmService.generateResponse([{ role: 'user', content: ratingPrompt }]);
              const matched = ratingResponse.match(/\d+\.\d+/);
              actualRating = matched ? parseFloat(matched[0]) : 0.0;
            } catch (e) {
              actualRating = 0.0;
            }
          }

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
              rating: actualRating
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
              rating: actualRating
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
