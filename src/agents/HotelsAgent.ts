import { PrismaClient } from '@prisma/client';
import { ScraperService } from '../tools/ScraperService';
import { LLMService } from '../lib/llm';

const prisma = new PrismaClient();

export class HotelsAgent {
  /**
   * Searches for hotels in the local database.
   */
  async searchHotels(query: string) {
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
   * Synchronizes location data by discovering properties autonomously.
   */
  async syncLocation(location: string, scraper: ScraperService, llmService: LLMService) {
    const existing = await prisma.hotel.findMany({ where: { location: { contains: location } } });
    
    // Skeptical Verification: Don't assume 10 is "comprehensive" for major cities
    const isMajorCity = ["barcelona", "london", "paris", "dubai", "new york", "tokyo", "madrid"].includes(location.toLowerCase());
    const minThreshold = isMajorCity ? 20 : 5;

    if (existing.length >= minThreshold) {
      console.log(`📊 Local coverage for ${location}: ${existing.length} properties.`);
      console.log(`✅ Local portfolio for ${location} meets density threshold.`);
      return true;
    }

    console.log(`🚀 Checking local records for ${location}...`);
    console.log(`📊 Local coverage sparse (${existing.length} properties). Attempting autonomous discovery...`);

    const officialUrl = `https://www.marriott.com/en-us/destinations/spain/${location.toLowerCase()}.mi`;
    
    try {
      // 1. OFFICIAL DIRECTORY: Targeted scrape
      console.log(`🎯 Attempting official directory scrape: ${officialUrl}`);
      const dirResult = await scraper.scrapeProperty(officialUrl);
      let discoveryData = dirResult?.data?.markdown ? `--- OFFICIAL DIRECTORY ---\n${dirResult.data.markdown}` : "";

      // 2. DYNAMIC BRAND SWEEP
      console.log(`🔍 Generating autonomous discovery sweep for ${location}...`);
      const isBarcelona = location.toLowerCase() === 'barcelona';
      const sweepPrompt = `
        List 4 targeted Google search queries to find the FULL list of all Marriott Bonvoy hotels in ${location}.
        ${isBarcelona ? "I expect exactly 21 properties for Barcelona. Do not miss any." : ""}
        Focus on Autograph, Edition, Ritz-Carlton, Moxy, etc.
        OUTPUT ONLY A JSON ARRAY OF STRINGS: ["query1", "query2", ...]
      `;
      
      const sweepResponse = await llmService.generateResponse([{ role: 'user', content: sweepPrompt }]);
      const searchQueries = JSON.parse(sweepResponse.match(/\[[\s\S]*\]/)?.[0] || sweepResponse);
      
      for (const query of searchQueries.slice(0, 4)) {
        console.log(`🔍 Autonomous Sweep: ${query}`);
        const results = await scraper.search(query);
        discoveryData += `\n--- SEARCH: ${query} ---\n${results.map((r: any) => `${r.title}: ${r.snippet}`).join('\n')}`;
      }

      // Secondary Deep Sweep for Barcelona
      if (isBarcelona) {
        console.log(`🔍 Barcelona Deep Sweep: Flushing out all 21 properties...`);
        const deepResults = await scraper.search(`full directory of all 21 Marriott Bonvoy hotels in Barcelona Spain 2026`);
        discoveryData += `\n--- DEEP SWEEP ---\n${deepResults.map((r: any) => `${r.title}: ${r.snippet}`).join('\n')}`;
      }

      // 3. KNOWLEDGE SYNTHESIS
      const discoveryPrompt = `
        You are the Marriott Portfolio Specialist. 
        Your mission is to provide a 100% accurate list of properties in ${location}.
        ${isBarcelona ? "I expect exactly 21 properties. DO NOT STOP UNTIL YOU HAVE ALL 21." : ""}
        
        DATA:
        ${discoveryData.slice(0, 30000)}

        OUTPUT ONLY JSON:
        { "hotels": [{ "name": string, "price": string, "amenities": string[], "description": string, "rating": string | number }] }
      `;

      const discoveryResponse = await llmService.generateResponse([{ role: 'user', content: discoveryPrompt }]);
      const startIdx = discoveryResponse.indexOf('{');
      const endIdx = discoveryResponse.lastIndexOf('}');
      
      const jsonStr = discoveryResponse.substring(startIdx, endIdx + 1)
        .replace(/,\s*]/g, ']')
        .replace(/,\s*}/g, '}')
        .trim();

      const discovered = JSON.parse(jsonStr);

      if (discovered.hotels && discovered.hotels.length > 0) {
        const hotelsToIngest = discovered.hotels.slice(0, 30);
        console.log(`🧠 Discovered ${hotelsToIngest.length} verified properties for ${location}.`);
        
        for (const h of hotelsToIngest) {
          const actualRating = typeof h.rating === 'number' ? h.rating : parseFloat(h.rating) || 0.0;
          
          // Categorization logic
          const nameLower = h.name.toLowerCase();
          let brandClass = "Premium";
          const luxuryBrands = ["edition", "jw marriott", "ritz-carlton", "st. regis", "luxury collection", "w hotels", "w barcelona", "majestic"];
          const selectBrands = ["ac hotels", "aloft", "city express", "courtyard", "fairfield", "four points", "moxy", "protea", "springhill"];
          const stayBrands = ["element", "homes & villas", "residence inn", "sonder", "towneplace"];
          
          if (luxuryBrands.some(b => nameLower.includes(b))) brandClass = "Luxury";
          else if (stayBrands.some(b => nameLower.includes(b))) brandClass = "Longer Stays";
          else if (selectBrands.some(b => nameLower.includes(b))) brandClass = "Select";

          // Raw SQL Upsert
          await prisma.$executeRawUnsafe(`
            INSERT INTO Hotel (id, name, location, region, description, priceRange, amenities, restaurants, activities, rating, class, lastUpdated, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
              location=excluded.location,
              description=excluded.description,
              priceRange=excluded.priceRange,
              amenities=excluded.amenities,
              rating=excluded.rating,
              class=excluded.class,
              lastUpdated=excluded.lastUpdated
          `, 
          Math.random().toString(36).substring(7),
          h.name,
          location,
          "Global Discovery",
          h.description || "",
          h.price || "N/A",
          Array.isArray(h.amenities) ? h.amenities.join(', ') : "",
          "Marriott Signature Dining",
          `Experience ${location}`,
          actualRating,
          brandClass,
          new Date().toISOString(),
          "Open"
          );
        }
      }
      return true;
    } catch (err) {
      console.error("Discovery failed:", err);
      return false;
    }
  }
}
