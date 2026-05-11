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
    } catch (e) {
      console.warn("Autonomous count detection failed.");
    }

    console.log(`🚀 Syncing records for ${location}...`);
    // 2. REGION DETECTION
    let region = "NA";
    try {
      console.log(`🌍 Detecting region for ${location}...`);
      const regionPrompt = `Identify the Marriott business region for ${location}. Output ONLY one of: EU, APAC, NA, LATAM. No other text.`;
      const regionResponse = await llmService.generateResponse([{ role: 'user', content: regionPrompt }]);
      region = regionResponse.match(/EU|APAC|NA|LATAM/)?.[0] || "NA";
      console.log(`📍 Region identified: ${region}`);
    } catch (e) {
      console.warn("Region detection failed, defaulting to NA.");
    }

    try {
      let discoveryData = "";

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
      const sweepMatch = sweepResponse.match(/\[[\s\S]*\]/);
      if (!sweepMatch) {
        console.error("❌ No JSON array found in sweep response. Raw response:", sweepResponse);
        throw new Error("No JSON found in sweep response");
      }
      const searchQueries = JSON.parse(sweepMatch[0]);
      
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

        INSTRUCTION:
        Return ONLY a JSON object with the following structure:
        { "hotels": [{ 
          "name": "string", 
          "rating": number, 
          "description": "string",
          "priceRange": "string (actual price range in local currency, e.g. 250€ - 600€)",
          "amenities": ["string"],
          "restaurants": ["string"],
          "activities": ["string"]
        }] }
        Keep descriptions EXTREMELY brief (1 sentence).
        Ensure rating is a number (e.g. 4.5).
        Find REAL restaurants and activities for each hotel.
      `;

      const discoveryResponse = await llmService.generateResponse([
        { role: 'system', content: 'You are a data extraction engine. You ONLY output valid JSON. No preamble, no explanation.' },
        { role: 'user', content: discoveryPrompt }
      ]);
      if (!discoveryResponse || discoveryResponse.length < 50) throw new Error("Empty discovery response");

      // 3. Robust JSON Extraction
      const jsonMatch = discoveryResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("❌ No JSON found in discovery response. Raw response preview:", discoveryResponse.slice(0, 500));
        throw new Error("No JSON found in LLM response");
      }

      const jsonStr = jsonMatch[0]
        .replace(/,\s*]/g, ']')
        .replace(/,\s*}/g, '}')
        .trim();

      let discovered: any = { hotels: [] };
      try {
        discovered = JSON.parse(jsonStr);
      } catch (err) {
        console.warn("⚠️ Discovery JSON malformed. Attempting emergency repair...");
        console.log("Full malformed string preview:", jsonStr.slice(0, 1000));
        
        // Advanced Repair: Extract individual hotel objects using regex
        const hotelPattern = /\{\s*"name"\s*:\s*"([^"]+)"[\s\S]*?\}/g;
        const matches = [...jsonStr.matchAll(hotelPattern)];
        
        for (const m of matches) {
          try {
            // Try to fix common issues in the snippet before parsing
            let fixedSnippet = m[0]
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']');
            
            // If it still doesn't parse, try a very loose extraction
            try {
              discovered.hotels.push(JSON.parse(fixedSnippet));
            } catch {
              const name = m[1];
              const ratingMatch = m[0].match(/"rating"\s*:\s*([\d.]+)/);
              const descMatch = m[0].match(/"description"\s*:\s*"([^"]+)"/);
              if (name) {
                discovered.hotels.push({
                  name,
                  rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
                  description: descMatch ? descMatch[1] : "Luxury Marriott property."
                });
              }
            }
          } catch (e) {
            continue;
          }
        }
      }

      if (discovered.hotels && discovered.hotels.length > 0) {
        const hotelsToIngest = discovered.hotels.slice(0, 30);
        console.log(`🧠 Discovered ${hotelsToIngest.length} verified properties for ${location}.`);
        
        for (const h of hotelsToIngest) {
          const actualRating = typeof h.rating === 'number' ? h.rating : parseFloat(h.rating) || 0.0;
          
          // 6-Category Marriott Brand Classification
          const nameLower = h.name.toLowerCase();
          let brandClass = "Premium";

          // Each entry is a keyword fragment — matches anywhere in the hotel name
          const luxuryKeywords = ["jw marriott", "ritz-carlton", "ritz carlton", "st. regis", "st regis", "saint-regis", "saint regis"];
          const distinctiveLuxuryKeywords = ["edition", "luxury collection", "w hotels", "w paris", "w new york", "w dubai", "w london", "w barcelona", "w hotel", "the w "];
          const premiumKeywords = ["delta hotels", "gaylord", "le meridien", "le méridien", "marriott hotel", "marriott resort", "vacation club", "renaissance", "sheraton", "westin"];
          const selectKeywords = ["ac hotels", "ac hotel", "aloft", "city express", "courtyard", "fairfield", "four points", "moxy", "protea", "springhill"];
          const stayKeywords = ["apartments by marriott", "element hotel", "element by", "homes & villas", "executive apartments", "residence inn", "towneplace"];
          const collectionKeywords = ["autograph collection", "design hotels", "mgm collection", "tribute portfolio", "outdoor collection"];

          if (luxuryKeywords.some(b => nameLower.includes(b))) brandClass = "Luxury";
          else if (distinctiveLuxuryKeywords.some(b => nameLower.includes(b))) brandClass = "Distinctive Luxury";
          else if (collectionKeywords.some(b => nameLower.includes(b))) brandClass = "Collections";
          else if (stayKeywords.some(b => nameLower.includes(b))) brandClass = "Longer Stays";
          else if (selectKeywords.some(b => nameLower.includes(b))) brandClass = "Select";
          else if (premiumKeywords.some(b => nameLower.includes(b))) brandClass = "Premium";

          // Raw SQL Upsert
          await prisma.$executeRawUnsafe(`
            INSERT INTO Hotel (id, name, location, region, description, priceRange, amenities, restaurants, activities, rating, class, lastUpdated, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET
              location=excluded.location,
              region=excluded.region,
              description=excluded.description,
              priceRange=excluded.priceRange,
              amenities=excluded.amenities,
              restaurants=excluded.restaurants,
              activities=excluded.activities,
              rating=excluded.rating,
              class=excluded.class,
              lastUpdated=excluded.lastUpdated
          `, 
          Math.random().toString(36).substring(7),
          h.name,
          location,
          region,
          h.description || "",
          h.priceRange || "N/A",
          Array.isArray(h.amenities) ? h.amenities.join(', ') : (h.amenities || ""),
          Array.isArray(h.restaurants) ? h.restaurants.join(', ') : (h.restaurants || "Signature Dining"),
          Array.isArray(h.activities) ? h.activities.join(', ') : (h.activities || "Local Exploration"),
          actualRating,
          brandClass,
          new Date().toISOString(),
          "Open"
          );
        }
      } else {
        console.warn(`⚠️ No verified properties discovered for ${location} after synthesis and repair.`);
      }
      return true;
    } catch (err) {
      console.error("Discovery failed:", err);
      return false;
    }
  }
}
