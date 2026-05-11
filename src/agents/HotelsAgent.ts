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

/**
 * Searches DuckDuckGo Lite via Jina Reader (free, no API key) to find the
 * official Marriott city page URL. DDG results include the Marriott URL in
 * plaintext like: www.marriott.com/en-us/destinations/singapore.mi
 */
async function findMarriottCityUrl(location: string): Promise<string | null> {
  try {
    const query = encodeURIComponent(`Hotels in ${location} Marriott Bonvoy`);
    const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${query}`;
    const res = await fetch(`https://r.jina.ai/${ddgUrl}`, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();

    // DDG results show the plain domain at the end of each result block, e.g.:
    //   www.marriott.com/en-us/destinations/singapore.mi
    // Match with or without the https:// prefix, and handle both:
    //   /destinations/{city}.mi   (city-states like Singapore)
    //   /destinations/{country}/{city}.mi  (most cities)
    const match = text.match(/(?:https?:\/\/)?www\.marriott\.com\/en-us\/destinations\/[a-z0-9][a-z0-9\-\/]*\.mi/i);
    if (match) {
      const url = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
      // Strip anything appended after .mi (e.g. query strings, trailing punctuation)
      return url.replace(/\.mi.*$/, '.mi');
    }

    // Fallback: decode the encoded URL from a DDG redirect link
    const encodedMatch = text.match(/uddg=(https?%3A%2F%2Fwww\.marriott\.com[^&"'\s)]+)/i);
    if (encodedMatch) {
      const decoded = decodeURIComponent(encodedMatch[1]);
      const trimmed = decoded.replace(/\.mi.*$/, '.mi');
      if (trimmed.includes('/destinations/')) return trimmed;
    }

    console.warn(`⚠️ Could not extract Marriott URL from DDG results for "${location}"`);
    return null;
  } catch (err) {
    console.error("DDG search via Jina Reader failed:", err);
    return null;
  }
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
   * 1. Searching Google (via Jina Search) for the real Marriott city page URL
   * 2. Fetching that page via Jina Reader
   * 3. Extracting all hotels with the LLM
   * 4. Upserting everything to the DB
   * Skips entirely if data is < 7 days old.
   */
  async syncLocation(location: string, llmService: LLMService) {
    // Staleness check — skip if fresh data exists
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

    console.log(`🔍 Finding official Marriott page for "${location}"...`);

    try {
      // 1. Find the real URL via Jina Search (Google)
      const marriottUrl = await findMarriottCityUrl(location);
      if (!marriottUrl) throw new Error(`Could not find a Marriott city page for "${location}"`);
      console.log(`🔗 Found: ${marriottUrl}`);

      // Extract country from the URL path: /destinations/{country}/{city}.mi
      const urlParts = marriottUrl.match(/destinations\/([^/]+)\/([^/.]+)/);
      const country = urlParts ? urlParts[1] : location;

      // 2. Fetch the page via Jina Reader
      const pageRes = await fetch(`https://r.jina.ai/${marriottUrl}`, {
        headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' },
        signal: AbortSignal.timeout(30000),
      });
      if (!pageRes.ok) throw new Error(`Jina Reader fetch failed: ${pageRes.status}`);

      const pageContent = await pageRes.text();
      if (pageContent.length < 500) throw new Error("Page content too short — possible block");

      console.log(`📄 Page fetched (${pageContent.length} chars). Extracting hotels...`);

      // 3. LLM extraction
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
        - Include EVERY hotel on the page — do not skip any.
        - rating must be a number between 0 and 5.
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

      // 4. Upsert all — no cap
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
          marriottUrl,
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
