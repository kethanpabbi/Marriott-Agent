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
    
    // 1. AUTONOMOUS DENSITY DETECTION: Ask the web for the official count
    let officialCount = 0;
    try {
      console.log(`🔍 Determining official Marriott property count for ${location}...`);
      const countSearch = await scraper.search(`total number of official Marriott Bonvoy hotels in ${location} 2026`);
      const countPrompt = `Based on these snippets, what is the TOTAL count of Marriott properties in ${location}? Return ONLY the number. \n${countSearch.map((s: any) => s.snippet).join('\n')}`;
      const countResponse = await llmService.generateResponse([{ role: 'user', content: countPrompt }]);
      officialCount = parseInt(countResponse.match(/\d+/)?.[0] || "0");
      
      if (officialCount > 0 && existing.length >= officialCount) {
        console.log(`📊 Local coverage for ${location}: ${existing.length} properties (Official: ${officialCount}).`);
        console.log(`✅ Local portfolio for ${location} is verified and complete.`);
        return true;
      }
    } catch (e) {
      console.warn("Autonomous count detection failed, falling back to threshold logic.");
    }

    // 2. DYNAMIC THRESHOLD FALLBACK
    if (existing.length >= 10 && officialCount === 0) {
      console.log(`📊 Local coverage for ${location}: ${existing.length} properties. Assuming comprehensive.`);
      return true;
    }

    console.log(`🚀 Checking local records for ${location}...`);
    // 1. AUTONOMOUS URL ENGINEERING: Find country and construct official directory URL
    let officialUrl = "";
    try {
      console.log(`🌍 Performing Geo-Lookup for ${location}...`);
      const geoSearch = await scraper.search(`What country is ${location} in for Marriott destinations directory?`);
      const geoPrompt = `
        TASK: Identify the country for ${location}.
        DATA: ${geoSearch.map((s: any) => s.snippet).join('\n')}
        
        OUTPUT ONLY THE COUNTRY NAME (one word, lowercase, hyphenated if needed). 
        NO EXPLANATION. NO PREAMBLE. NO BOLDING.
        Correct example: "spain", "united-kingdom", "ireland".
      `;
      let country = (await llmService.generateResponse([{ role: 'user', content: geoPrompt }])).toLowerCase().trim();
      
      // Sanitization: Extract ONLY the last word or hyphenated slug if the LLM hallucinated a preamble
      const matches = country.match(/[a-z-]+(?=\s*$|\.*$)/);
      if (matches) country = matches[0];
      
      officialUrl = `https://www.marriott.com/en-us/destinations/${country}/${location.toLowerCase()}.mi`;
      console.log(`🎯 Constructed Official Directory: ${officialUrl}`);
    } catch (e) {
      console.warn("Geo-Lookup failed, falling back to search sweeps.");
    }
    
    try {
      // 1. OFFICIAL DIRECTORY: Targeted scrape
      let discoveryData = "";
      if (officialUrl) {
        console.log(`🎯 Attempting official directory scrape: ${officialUrl}`);
        const dirResult = await scraper.scrapeProperty(officialUrl);
        discoveryData = dirResult?.data?.markdown ? `--- OFFICIAL DIRECTORY ---\n${dirResult.data.markdown}` : "";
      }

      // 2. DYNAMIC BRAND SWEEP: Comprehensive Tier-by-Tier Hunting
      console.log(`🔍 Generating autonomous discovery sweep for ${location}...`);
      const sweepPrompt = `
        List 8 targeted Google search queries to find the FULL Marriott Bonvoy portfolio in ${location}.
        You MUST include a separate query for EACH of these 4 tiers:
        1. Luxury (Edition, Ritz-Carlton, St. Regis, W Hotels)
        2. Premium (Autograph, Westin, Sheraton, Marriott, Renaissance)
        3. Select (AC, Moxy, Aloft, Courtyard, Fairfield, Four Points)
        4. Longer Stays (Element, Residence Inn, Sonder, TownePlace)
        
        OUTPUT ONLY A JSON ARRAY OF STRINGS: ["query1", "query2", ..., "query8"]
      `;
      
      const sweepResponse = await llmService.generateResponse([{ role: 'user', content: sweepPrompt }]);
      const searchQueries = JSON.parse(sweepResponse.match(/\[[\s\S]*\]/)?.[0] || sweepResponse);
      
      for (const query of searchQueries.slice(0, 8)) {
        console.log(`🔍 Autonomous Sweep: ${query}`);
        const results = await scraper.search(query);
        discoveryData += `\n--- SEARCH: ${query} ---\n${results.map((r: any) => `${r.title}: ${r.snippet}`).join('\n')}`;
      }

      // Secondary Deep Sweep if count is expected high
      if (officialCount > 10) {
        console.log(`🔍 Deep Sweep: Flushing out all ${officialCount} properties...`);
        const deepResults = await scraper.search(`full list of all ${officialCount} Marriott Bonvoy hotels in ${location} 2026`);
        discoveryData += `\n--- DEEP SWEEP ---\n${deepResults.map((r: any) => `${r.title}: ${r.snippet}`).join('\n')}`;
      }

      // 3. KNOWLEDGE SYNTHESIS
      const discoveryPrompt = `
        You are the Marriott Portfolio Specialist. 
        List EVERY Marriott property in ${location}. 
        ${officialCount > 0 ? `I expect at least ${officialCount} properties.` : ""}
        
        DATA:
        ${discoveryData.slice(0, 30000)}

        OUTPUT ONLY JSON:
        { "hotels": [{ "name": string, "rating": string | number, "description": string }] }
        Keep descriptions EXTREMELY brief (1 sentence).
      `;

      const discoveryResponse = await llmService.generateResponse([{ role: 'user', content: discoveryPrompt }]);
      if (!discoveryResponse || discoveryResponse.length < 50) throw new Error("Empty discovery response");

      const startIdx = discoveryResponse.indexOf('{');
      const endIdx = discoveryResponse.lastIndexOf('}');
      if (startIdx === -1 || endIdx === -1) throw new Error("No JSON found");
      
      const jsonStr = discoveryResponse.substring(startIdx, endIdx + 1)
        .replace(/,\s*]/g, ']')
        .replace(/,\s*}/g, '}')
        .trim();

      let discovered;
      try {
        discovered = JSON.parse(jsonStr);
      } catch (err) {
        console.warn("⚠️ Discovery JSON malformed. Attempting emergency repair...");
        // Fallback: Use regex to extract hotel objects if the JSON is truncated
        const matches = [...jsonStr.matchAll(/\{"name":\s*"([^"]+)"[^}]*\}/g)];
        discovered = { hotels: matches.map(m => JSON.parse(m[0])) };
      }

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
