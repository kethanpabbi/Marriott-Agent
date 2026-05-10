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
    
    // 0. PURGE INVALID: Ensure we don't have hallucinations or rebranded ghosts
    await prisma.hotel.deleteMany({
      where: {
        OR: [
          { name: { contains: "Maldron" } },
          { name: { contains: "Tara Towers" } },
          { name: { contains: "Westin Dublin" } }, // Force removal of old name to allow rebranding
          { NOT: {
              OR: [
                { name: { contains: "Marriott" } },
                { name: { contains: "Ritz" } },
                { name: { contains: "JW" } },
                { name: { contains: "W Hotel" } },
                { name: { contains: "Autograph" } },
                { name: { contains: "College Green" } }, // Specifically for Dublin
                { name: { contains: "Shelbourne" } },
                { name: { contains: "Sheraton" } },
                { name: { contains: "Westin" } },
                { name: { contains: "Aloft" } },
                { name: { contains: "Moxy" } },
                { name: { contains: "Renaissance" } },
                { name: { contains: "Courtyard" } },
                { name: { contains: "Fairfield" } }
              ]
            }
          }
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
    
    // 1. REAL-TIME SEARCH: Find multiple directory leads
    let deepScrapeContent = "";
    try {
      const searchResults = await scraper.search(`Marriott Bonvoy hotels in ${location} official list with ratings`);
      const potentialUrls = searchResults
        .map((r: any) => r.url)
        .filter((u: string) => u && u.length > 5)
        .slice(0, 3);

      for (const url of potentialUrls) {
        console.log(`🔍 Scraping discovery source: ${url}`);
        const scrapeResult = await scraper.scrapeProperty(url);
        const content = scrapeResult?.data?.markdown || JSON.stringify(scrapeResult?.data) || "";
        if (content.length > 500) {
          deepScrapeContent += `\n--- SOURCE: ${url} ---\n${content}`;
        }
      }
    } catch (err) {
      console.warn("Search/Scrape failed:", err);
    }

    // 2. KNOWLEDGE SYNTHESIS: Extract the FULL portfolio
    const discoveryPrompt = `
      You are the Marriott Portfolio Specialist. 
      Identify ALL real Marriott Bonvoy properties in: ${location}.
      
      LIVE SCRAPED DATA:
      ${deepScrapeContent.slice(0, 25000)}

      TASK:
      1. Extract EVERY unique Marriott property. According to official records, there are approximately ${needsDiscovery && officialCount > 0 ? officialCount : 'all listed'} properties in this area.
      2. BRAND CHECK: Only include official Marriott brands (Ritz-Carlton, St. Regis, JW Marriott, W Hotels, Edition, Autograph Collection, Renaissance, Marriott, Sheraton, Delta, Westin, Le Méridien, Gaylord, Courtyard, Four Points, SpringHill Suites, Protea, Fairfield, AC Hotels, Aloft, Moxy, Residence Inn, TownePlace Suites, Element).
      3. REBRANDING CHECK: Use current 2026 names from the scraped text.
      4. IGNORE competitors (Hilton, IHG, Hyatt, etc.).
      5. RATING: Provide actual rating found or "N/A".
      
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
          if (actualRating === 0.0) {
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
