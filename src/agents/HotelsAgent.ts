import { PrismaClient } from '@prisma/client';
import { LLMService } from '../lib/llm';

const prisma = new PrismaClient();

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
          status: { not: 'Closed' },
        },
        include: { nearbyAttractions: true },
      });
    }

    return prisma.hotel.findMany({
      where: { location: { contains: location }, status: { not: 'Closed' } },
      orderBy: { rating: 'desc' },
      take: 10,
      include: { nearbyAttractions: true },
    });
  }

  /**
   * Enriches existing DB hotels for a location by looking each one up
   * individually on Booking.com — no fuzzy matching, no city list scraping.
   *
   * Flow:
   * 1. Load DB hotels for the location (ground truth).
   * 2. Skip if enriched data is < 7 days old.
   * 3. For each hotel (up to 10), search Booking.com by exact name,
   *    fetch its dedicated hotel page, and LLM-extract the enrichment fields.
   * 4. UPDATE the existing DB record — no inserts ever.
   */
  async syncLocation(location: string, llmService: LLMService) {
    // 1. Load existing DB hotels for this location
    const dbHotels = await prisma.hotel.findMany({
      where: { location: { contains: location }, status: { not: 'Closed' } },
      select: { id: true, name: true, description: true, lastUpdated: true },
    });

    if (dbHotels.length === 0) {
      console.log(`⚠️  No hotels in DB for "${location}" — skipping sync.`);
      return false;
    }

    // 2. Staleness check — skip if enriched data is < 7 days old
    const enriched = dbHotels.filter(h => h.description && h.description.trim() !== '');
    if (enriched.length > 0) {
      const newest = enriched.reduce((a, b) =>
        new Date(a.lastUpdated) > new Date(b.lastUpdated) ? a : b
      );
      const ageMs = Date.now() - new Date(newest.lastUpdated).getTime();
      if (ageMs < 7 * 24 * 60 * 60 * 1000) {
        console.log(`✅ Fresh data for "${location}" (${enriched.length}/${dbHotels.length} enriched) — skipping sync.`);
        return true;
      }
    }

    // 3. Enrich up to 10 hotels (matches what the UI displays)
    const toEnrich = dbHotels.slice(0, 10);
    console.log(`🔍 Enriching ${toEnrich.length} hotels for "${location}" via Booking.com...`);

    let updated = 0;
    for (const hotel of toEnrich) {
      const success = await this.enrichHotel(hotel, llmService);
      if (success) updated++;
      // small pause between requests to be respectful to Jina Reader
      await new Promise(r => setTimeout(r, 600));
    }

    console.log(`✨ Enrichment complete for "${location}": ${updated}/${toEnrich.length} hotels updated.`);
    return updated > 0;
  }

  /**
   * Looks up a single hotel on Booking.com by name, extracts enrichment data,
   * and updates its DB record.
   */
  private async enrichHotel(
    hotel: { id: string; name: string },
    llmService: LLMService
  ): Promise<boolean> {
    try {
      // Search DuckDuckGo for this hotel's Booking.com page
      const query = encodeURIComponent(`${hotel.name} site:booking.com`);
      const ddgRes = await fetch(
        `https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=${query}`,
        {
          headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' },
          signal: AbortSignal.timeout(15000),
        }
      );
      const ddgContent = await ddgRes.text();

      // Extract the hotel's Booking.com URL
      // Format: https://www.booking.com/hotel/{country}/{slug}.html
      let bookingUrl: string | null = null;

      const plainMatch = ddgContent.match(
        /https?:\/\/www\.booking\.com\/hotel\/[a-z]{2}\/[^)\s"'<>]+\.html/i
      );
      if (plainMatch) bookingUrl = plainMatch[0];

      if (!bookingUrl) {
        const encodedMatch = ddgContent.match(
          /uddg=(https?%3A%2F%2Fwww\.booking\.com%2Fhotel%2F[a-z]{2}%2F[^&\s"')]+\.html)/i
        );
        if (encodedMatch) bookingUrl = decodeURIComponent(encodedMatch[1]);
      }

      if (!bookingUrl) {
        console.log(`  ⚠️  No Booking.com page found for "${hotel.name}"`);
        return false;
      }

      // Fetch the hotel's dedicated Booking.com page
      const pageRes = await fetch(`https://r.jina.ai/${bookingUrl}`, {
        headers: {
          'Accept': 'text/plain',
          'X-Return-Format': 'markdown',
          'X-Timeout': '15',
        },
        signal: AbortSignal.timeout(25000),
      });
      if (!pageRes.ok) {
        console.log(`  ⚠️  Booking.com fetch failed for "${hotel.name}" (${pageRes.status})`);
        return false;
      }

      const pageContent = await pageRes.text();
      if (pageContent.length < 500) {
        console.log(`  ⚠️  Too little content for "${hotel.name}" (${pageContent.length} chars)`);
        return false;
      }

      // LLM extracts enrichment fields from the hotel page
      const extractPrompt = `
        Extract hotel details from this Booking.com page for "${hotel.name}".

        PAGE CONTENT:
        ${pageContent.slice(0, 20000)}

        Return ONLY a valid JSON object:
        {
          "rating": number,
          "description": "string (2 sentences max describing the hotel)",
          "priceRange": "string (e.g. $200 - $450/night — use the currency shown on the page)",
          "amenities": "string (comma-separated, max 5 highlights)",
          "restaurants": "string (comma-separated, max 3 on-site dining options)",
          "activities": "string (comma-separated, max 3 activities or nearby attractions)"
        }

        Rules:
        - rating: number between 0 and 10 if shown as /10, convert to /5 by halving. Use 0 if unknown.
        - Use empty string for any field you cannot find — never omit a key.
        - Output nothing outside the JSON.
      `;

      const extractResponse = await llmService.generateResponse([
        { role: 'system', content: 'You are a data extraction engine. Output ONLY valid JSON. No preamble.' },
        { role: 'user', content: extractPrompt },
      ], 1024);

      const jsonMatch = extractResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`  ⚠️  No JSON returned for "${hotel.name}"`);
        return false;
      }

      const data = JSON.parse(jsonMatch[0].replace(/,\s*]/g, ']').replace(/,\s*}/g, '}'));
      const rating = typeof data.rating === 'number' ? data.rating : parseFloat(data.rating) || 0.0;

      await prisma.hotel.update({
        where: { id: hotel.id },
        data: {
          description: data.description || '',
          priceRange: data.priceRange || '',
          amenities: data.amenities || '',
          restaurants: data.restaurants || '',
          activities: data.activities || '',
          rating,
          url: bookingUrl,
          enriched: true,
        },
      });

      console.log(`  ✅ "${hotel.name}" enriched (★${rating}, ${data.priceRange || 'no price'})`);
      return true;
    } catch (err) {
      console.log(`  ❌ Failed to enrich "${hotel.name}":`, err);
      return false;
    }
  }
}
