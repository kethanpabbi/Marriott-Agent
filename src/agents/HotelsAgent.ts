import { PrismaClient } from '@prisma/client';
import { LLMService } from '../lib/llm';

const prisma = new PrismaClient();

function classifyBrand(nameLower: string): string {
  if (["jw marriott", "ritz-carlton", "ritz carlton", "st. regis", "st regis", "saint-regis", "saint regis"].some(b => nameLower.includes(b))) return "Luxury";
  if (["edition", "luxury collection", "w hotels", "w hotel", "the w "].some(b => nameLower.includes(b))) return "Distinctive Luxury";
  if (["autograph collection", "design hotels", "mgm collection", "tribute portfolio", "outdoor collection"].some(b => nameLower.includes(b))) return "Collections";
  if (["apartments by marriott", "element hotel", "element by", "homes & villas", "executive apartments", "residence inn", "towneplace"].some(b => nameLower.includes(b))) return "Longer Stays";
  if (["ac hotels", "ac hotel", "aloft", "city express", "courtyard", "fairfield", "four points", "moxy", "protea", "springhill"].some(b => nameLower.includes(b))) return "Select";
  if (["delta hotels", "gaylord", "le meridien", "le méridien", "marriott hotel", "marriott resort", "vacation club", "renaissance", "sheraton", "westin"].some(b => nameLower.includes(b))) return "Premium";
  return "Premium";
}

export class HotelsAgent {
  /**
   * Returns hotels for a location sorted by rating (top 10).
   * Pass specificHotelName to search for a single property by name.
   */
  async searchHotels(location: string, options: { specificHotelName?: string } = {}) {
    const { specificHotelName } = options;

    if (specificHotelName) {
      return prisma.hotel.findMany({
        where: {
          location: { contains: location },
          name: { contains: specificHotelName },
          status: { not: "Closed" },
        },
        include: { nearbyAttractions: true },
      });
    }

    return prisma.hotel.findMany({
      where: { location: { contains: location }, status: { not: "Closed" } },
      orderBy: { rating: 'desc' },
      take: 10,
      include: { nearbyAttractions: true },
    });
  }

  /**
   * Syncs a city by:
   * 1. Searching DuckDuckGo (via Jina Reader, free) for "Hotels in {city} Marriott Bonvoy"
   * 2. Extracting the Booking.com Marriott city page URL from results
   * 3. Fetching that Booking.com page via Jina Reader (Booking.com is accessible; marriott.com is 403-blocked)
   * 4. LLM extracts all hotels from the page content
   * 5. Upserts to DB
   * Skips entirely if data is < 7 days old.
   */
  async syncLocation(location: string, llmService: LLMService) {
    // Staleness check
    const newest = await prisma.hotel.findFirst({
      where: { location: { contains: location } },
      orderBy: { lastUpdated: 'desc' },
    });
    if (newest) {
      const ageMs = Date.now() - new Date(newest.lastUpdated).getTime();
      if (ageMs < 7 * 24 * 60 * 60 * 1000) {
        console.log(`✅ Fresh data for "${location}" — skipping sync.`);
        return true;
      }
    }

    console.log(`🔍 Searching for Marriott hotels in "${location}"...`);

    try {
      // 1. DDG search — find the Booking.com Marriott city page
      const query = encodeURIComponent(`Hotels in ${location} Marriott Bonvoy`);
      const ddgRes = await fetch(`https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=${query}`, {
        headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' },
        signal: AbortSignal.timeout(20000),
      });
      const ddgContent = await ddgRes.text();

      // 2. Extract Booking.com Marriott city URL from DDG results
      //    Format: https://www.booking.com/marriott/city/{iso-code}/{city}.html
      const bookingMatch = ddgContent.match(
        /https?:\/\/www\.booking\.com\/marriott\/city\/[a-z]{2}\/[a-z0-9\-]+\.html/i
      );

      if (!bookingMatch) {
        throw new Error(`Could not find a Booking.com Marriott page for "${location}" in search results`);
      }

      const bookingUrl = bookingMatch[0];
      console.log(`🔗 Found Booking.com page: ${bookingUrl}`);

      // Derive country from URL: /marriott/city/{iso-code}/{city}.html
      const country = bookingUrl.match(/\/city\/([a-z]{2})\//)?.[1] || location;

      // 3. Fetch the Booking.com page via Jina Reader
      const pageRes = await fetch(`https://r.jina.ai/${bookingUrl}`, {
        headers: {
          'Accept': 'text/plain',
          'X-Return-Format': 'markdown',
          'X-Timeout': '20',
        },
        signal: AbortSignal.timeout(35000),
      });
      if (!pageRes.ok) throw new Error(`Booking.com fetch failed: ${pageRes.status}`);

      const pageContent = await pageRes.text();
      if (pageContent.length < 2000) {
        throw new Error(`Insufficient content from Booking.com (${pageContent.length} chars)`);
      }

      console.log(`📄 Page fetched (${pageContent.length} chars). Extracting hotels...`);

      // 4. LLM extraction
      const extractPrompt = `
        Extract every Marriott Bonvoy hotel listed on this page.

        PAGE CONTENT:
        ${pageContent.slice(0, 40000)}

        Return ONLY a valid JSON object:
        { "hotels": [{
          "name": "string",
          "rating": number,
          "description": "string (1 sentence max)",
          "priceRange": "string (e.g. $200 - $450)",
          "amenities": "string (comma-separated, max 5)",
          "restaurants": "string (comma-separated, max 3)",
          "activities": "string (comma-separated, max 3)"
        }] }

        Rules:
        - Include EVERY Marriott/Bonvoy branded hotel — do not skip any.
        - rating must be a number between 0 and 5 (use 0 if unknown).
        - Use empty string for unknown fields — never omit a key.
        - Output nothing outside the JSON.
      `;

      const extractResponse = await llmService.generateResponse([
        { role: 'system', content: 'You are a data extraction engine. Output ONLY valid JSON. No preamble.' },
        { role: 'user', content: extractPrompt },
      ], 8192);

      const jsonMatch = extractResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in extraction response");

      const { hotels } = JSON.parse(
        jsonMatch[0].replace(/,\s*]/g, ']').replace(/,\s*}/g, '}')
      );

      if (!hotels?.length) throw new Error("No hotels extracted");

      console.log(`🏨 Upserting ${hotels.length} properties for "${location}"...`);

      // 5. Upsert all — no cap
      for (const h of hotels) {
        const rating = typeof h.rating === 'number' ? h.rating : parseFloat(h.rating) || 0.0;
        const tier = classifyBrand(h.name.toLowerCase());

        await prisma.$executeRawUnsafe(`
          INSERT INTO Hotel (id, name, location, country, url, description, priceRange, amenities, restaurants, activities, rating, tier, lastUpdated, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(name) DO UPDATE SET
            location=excluded.location,
            country=excluded.country,
            url=excluded.url,
            description=excluded.description,
            priceRange=excluded.priceRange,
            amenities=excluded.amenities,
            restaurants=excluded.restaurants,
            activities=excluded.activities,
            rating=excluded.rating,
            tier=excluded.tier,
            lastUpdated=excluded.lastUpdated
        `,
          Math.random().toString(36).substring(7),
          h.name,
          location,
          country,
          bookingUrl,
          h.description || "",
          h.priceRange || "N/A",
          h.amenities || "",
          h.restaurants || "",
          h.activities || "",
          rating,
          tier,
          new Date().toISOString(),
          "Open",
        );
      }

      return true;
    } catch (err) {
      console.error(`Sync failed for "${location}":`, err);
      return false;
    }
  }
}
