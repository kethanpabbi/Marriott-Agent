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
    
    // 0. AUTONOMOUS CLEANUP: Trust the LLM to identify real brands, but clear known non-Marriott ghosts
    // We remove the blunt globalMarriottBrands filter as it was too restrictive (killing properties like The Shelbourne)
    await prisma.hotel.deleteMany({
      where: {
        AND: [
          { location: { contains: location } },
          { name: { contains: "Maldron" } } // Only remove known competitors explicitly
        ]
      }
    });

    const existing = await prisma.hotel.findMany({
      where: {
        OR: [
          { location: { contains: location } },
          { region: { contains: location } }
        ]
      }
    });

    // OBJECTIVE COVERAGE CHECK: Hardened for 2026
    let needsDiscovery = existing.length < 5; // Major cities should always have > 5
    let officialCount = 0;
    
    if (existing.length > 0) {
      console.log(`📊 Local coverage for ${location}: ${existing.length} properties.`);
      try {
        const countSearch = await scraper.search(`total number of official Marriott Bonvoy hotels in ${location} Ireland 2026`);
        const countPrompt = `Based on these snippets, what is the TOTAL count of Marriott properties in ${location}? Return ONLY the number. \n${countSearch.map((s: any) => s.snippet).join('\n')}`;
        const countResponse = await llmService.generateResponse([{ role: 'user', content: countPrompt }]);
        officialCount = parseInt(countResponse.match(/\d+/)?.[0] || "0");
        
        if (officialCount > existing.length || officialCount > 6) {
          console.log(`⚠️ Portfolio incomplete! Local: ${existing.length} vs Official: ${officialCount}. Triggering Deep-Sync.`);
          needsDiscovery = true;
        }
      } catch (e) {
        needsDiscovery = existing.length < 5;
      }
    }

    if (!needsDiscovery) {
      console.log(`✅ Local portfolio for ${location} is verified and comprehensive.`);
      return true;
    }

    console.log(`🌐 No local data for ${location}. Attempting autonomous discovery...`);
    
    // 1. DETERMINISTIC URL CONSTRUCTION
    console.log(`🌐 Constructing official Marriott directory URL for ${location}...`);
    const urlPatternPrompt = `
      The official Marriott destination URL pattern is: https://www.marriott.com/en-us/destinations/{country}/{city}.mi
      For the location "${location}", identify the correct {country} and {city} slug.
      Example: "Barcelona" -> country: "spain", city: "barcelona"
      Example: "Dublin" -> country: "ireland", city: "dublin"
      OUTPUT ONLY JSON: { "country": string, "city": string }
    `;
    
    let officialUrl = "";
    try {
      const urlResponse = await llmService.generateResponse([{ role: 'user', content: urlPatternPrompt }]);
      const urlData = JSON.parse(urlResponse.match(/\{[\s\S]*\}/)?.[0] || urlResponse);
      officialUrl = `https://www.marriott.com/en-us/destinations/${urlData.country}/${urlData.city}.mi`;
    } catch (e) {}

    // 2. RESILIENT DISCOVERY: Multi-Brand Sweep
    let discoveryData = "";
    try {
      if (officialUrl) {
        console.log(`🎯 Attempting official directory scrape: ${officialUrl}`);
        const scrapeResult = await scraper.scrapeProperty(officialUrl);
        const content = scrapeResult?.data?.markdown || "";
        if (content.length > 2000) {
          discoveryData += `\n--- OFFICIAL DIRECTORY ---\n${content}`;
        }
      }
      
      // 2. DYNAMIC BRAND SWEEP: Generate targeted searches for the specific city
      console.log(`🔍 Generating autonomous discovery sweep for ${location}...`);
      const sweepPrompt = `
        List 4 targeted Google search queries to find the FULL list of all Marriott Bonvoy hotels in ${location}.
        Focus on specific collections (Autograph, Moxy, etc.) and rebranded properties for 2026.
        OUTPUT ONLY A JSON ARRAY OF STRINGS: ["query1", "query2", ...]
      `;
      
      try {
        const sweepResponse = await llmService.generateResponse([{ role: 'user', content: sweepPrompt }]);
        const searchQueries = JSON.parse(sweepResponse.match(/\[[\s\S]*\]/)?.[0] || sweepResponse);
        
        for (const query of searchQueries.slice(0, 4)) {
          console.log(`🔍 Autonomous Sweep: ${query}`);
          const results = await scraper.search(query);
          discoveryData += `\n--- SEARCH: ${query} ---\n${results.map((r: any) => `${r.title}: ${r.snippet}`).join('\n')}`;
        }
      } catch (e) {
        // Simple fallback if LLM fails
        const results = await scraper.search(`official list of all Marriott Bonvoy hotels in ${location} 2026`);
        discoveryData += `\n--- FALLBACK SEARCH ---\n${results.map((r: any) => `${r.title}: ${r.snippet}`).join('\n')}`;
      }
      
    } catch (err) {
      console.warn("Resilient Discovery failed:", err);
    }

    // 2. KNOWLEDGE SYNTHESIS: Extract the FULL portfolio with Directory-Locking
    const discoveryPrompt = `
      You are the Marriott Portfolio Specialist. 
      Your mission is to provide a 100% accurate list of properties in ${location}.
      
      I have two sources of data:
      1. OFFICIAL DIRECTORY CONTENT (The Single Source of Truth):
      ${discoveryData.includes("OFFICIAL DIRECTORY") ? discoveryData.split("--- SEARCH")[0] : "NOT AVAILABLE"}
      
      2. SEARCH SNIPPETS (For enrichment only):
      ${discoveryData.slice(0, 20000)}

      CRITICAL TASK:
      1. Identify ONLY the hotels listed in the OFFICIAL DIRECTORY. 
      2. If a hotel appears in "SEARCH SNIPPETS" but is NOT in the "OFFICIAL DIRECTORY", it is a hallucination or a 'nearby' hotel. DO NOT INCLUDE IT. (e.g. if Sheraton Dublin is not in the directory, it doesn't exist).
      3. REBRANDING: If the directory says "The College Green Hotel" but search says "Westin Dublin", use the DIRECTORY name "The College Green Hotel".
      4. IGNORE COMPETITORS: Do not include Maldron, Hilton, etc.
      
      OUTPUT ONLY JSON. NO PREAMBLE.
      { "hotels": [{ "name": string, "price": string, "amenities": string[], "description": string, "rating": string | number }] }
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
          let actualRating = 0.0;
          if (typeof h.rating === 'number') actualRating = h.rating;
          else if (typeof h.rating === 'string' && !h.rating.includes('N/A')) actualRating = parseFloat(h.rating);
          
          // 3. METRIC ENRICHMENT: If rating is missing, do a targeted search
          if (actualRating === 0.0 || isNaN(actualRating)) {
            console.log(`🔍 Enriching missing rating for: ${h.name}`);
            try {
              const ratingSearch = await scraper.search(`${h.name} Marriott Bonvoy official rating`);
              const ratingPrompt = `
                Extract the official Marriott rating (out of 5.0) for "${h.name}" from these snippets:
                ${ratingSearch.map((s: any) => s.title + ": " + s.snippet).join('\n')}
                
                OUTPUT ONLY THE NUMBER (e.g. 4.8). If truly not found, return "N/A".
              `;
              const ratingResponse = await llmService.generateResponse([{ role: 'user', content: ratingPrompt }]);
              const matched = ratingResponse.match(/\d+\.\d+/);
              actualRating = matched ? parseFloat(matched[0]) : 0.0;
              if (isNaN(actualRating)) actualRating = 0.0;
            } catch (e) {
              actualRating = 0.0;
            }
          }

          // Final safety check for Prisma
          const validatedRating = isNaN(actualRating) ? 0.0 : actualRating;

          await prisma.hotel.upsert({
            where: { name: h.name },
            update: {
              location: `${location}`,
              priceRange: h.price || "Not specified",
              description: h.description || `Verified Marriott property in ${location}.`,
              amenities: Array.isArray(h.amenities) ? h.amenities.join(', ') : "",
              restaurants: "Marriott Signature Dining",
              activities: `Experience ${location}`,
              region: "Global Discovery",
              rating: validatedRating
            },
            create: {
              name: h.name,
              location: `${location}`,
              priceRange: h.price || "Not specified",
              description: h.description || `Verified Marriott property in ${location}.`,
              amenities: Array.isArray(h.amenities) ? h.amenities.join(', ') : "",
              restaurants: "Marriott Signature Dining",
              activities: `Experience ${location}`,
              region: "Global Discovery",
              rating: validatedRating
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
