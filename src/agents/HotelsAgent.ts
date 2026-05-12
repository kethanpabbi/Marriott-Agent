import { PrismaClient } from '@prisma/client';
import { LLMService, RateLimitError } from '../lib/llm';

/**
 * Module-level lock — prevents concurrent background syncs for the same
 * location from spawning duplicate enrichment requests.
 */
const syncingLocations = new Set<string>();

const prisma = new PrismaClient();

/** Returns YYYY-MM-DD for a date offset by `daysAhead` from today. */
function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

export class HotelsAgent {
  /**
   * Returns hotels for a location, optionally filtered by country.
   * Results are sorted by rating descending.
   */
  async searchHotels(
    location: string,
    options: { specificHotelName?: string; country?: string } = {}
  ) {
    const { specificHotelName, country } = options;
    const countryFilter = country ? { country: { contains: country } } : {};

    if (specificHotelName) {
      return prisma.hotel.findMany({
        where: {
          location: { contains: location },
          name: { contains: specificHotelName },
          status: { not: 'Closed' },
          ...countryFilter,
        },
        include: { nearbyAttractions: true },
      });
    }

    return prisma.hotel.findMany({
      where: {
        location: { contains: location },
        status: { not: 'Closed' },
        ...countryFilter,
      },
      orderBy: [{ rating: 'desc' }],
      include: { nearbyAttractions: true },
    });
  }

  /**
   * Returns true if the location has at least one enriched hotel.
   * Used by WorkflowManager to decide whether to show "loading" state.
   */
  async isEnriched(location: string, country?: string): Promise<boolean> {
    const countryFilter = country ? { country: { contains: country } } : {};
    const record = await prisma.hotel.findFirst({
      where: {
        location: { contains: location },
        enriched: true,
        ...countryFilter,
      },
    });
    return record !== null;
  }

  /**
   * Enriches hotels where enriched=false for the given location.
   * Skips hotels already marked enriched=true.
   * Stops entirely when no unenriched hotels remain.
   */
  async syncLocation(location: string, llmService: LLMService, country?: string) {
    const countryFilter = country ? { country: { contains: country } } : {};

    // Load all hotels, selecting enriched flag to drive decisions
    const dbHotels = await prisma.hotel.findMany({
      where: { location: { contains: location }, status: { not: 'Closed' }, ...countryFilter },
      select: { id: true, name: true, tier: true, enriched: true, lastUpdated: true },
    });

    if (dbHotels.length === 0) {
      console.log(`⚠️  No hotels in DB for "${location}" — skipping sync.`);
      return false;
    }

    const unenriched = dbHotels.filter(h => !h.enriched);

    // Nothing left to enrich
    if (unenriched.length === 0) {
      console.log(`✅ All ${dbHotels.length} hotels already enriched for "${location}" — skipping sync.`);
      return true;
    }

    console.log(`🔄 ${unenriched.length} unenriched hotels for "${location}" — continuing enrichment.`);

    // In-flight lock — skip if another sync is already running for this location
    const lockKey = `${location}:${country ?? ''}`;
    if (syncingLocations.has(lockKey)) {
      console.log(`⏸️  Sync already in progress for "${location}" — skipping duplicate.`);
      return false;
    }
    syncingLocations.add(lockKey);

    try {
      // Pick up to 2 unenriched hotels per tier (12 total max) for this batch
      const TIERS = ['Luxury', 'Distinctive Luxury', 'Premium', 'Select', 'Longer Stays', 'Collections'];
      const toEnrichSet = new Set<string>();

      for (const tier of TIERS) {
        const candidates = unenriched.filter(h => (h.tier || 'Premium') === tier);
        candidates.slice(0, 2).forEach(h => toEnrichSet.add(h.id));
      }
      for (const h of unenriched) {
        if (toEnrichSet.size >= 12) break;
        toEnrichSet.add(h.id);
      }

      const toEnrich = dbHotels.filter(h => toEnrichSet.has(h.id));
      const tiersCount = TIERS.filter(t => toEnrich.some(h => (h.tier || 'Premium') === t)).length;
      console.log(`🔍 Enriching ${toEnrich.length} hotels for "${location}" via Booking.com (${tiersCount} tiers)...`);

      let updated = 0;
      for (const hotel of toEnrich) {
        try {
          const success = await this.enrichHotel(hotel, llmService);
          if (success) updated++;
        } catch (err) {
          if (err instanceof RateLimitError) {
            console.error(`🛑 Rate limit hit — stopping enrichment for "${location}" after ${updated} hotels.`);
            break;
          }
          console.error(`  ❌ Failed to enrich "${hotel.name}":`, err);
        }
        await new Promise(r => setTimeout(r, 600));
      }

      console.log(`✨ Enrichment complete for "${location}": ${updated}/${toEnrich.length} hotels updated.`);
      return updated > 0;
    } finally {
      syncingLocations.delete(lockKey);
    }
  }

  /**
   * Looks up a single hotel on Booking.com by name, fetches its dedicated page
   * with check-in dates so prices are shown, extracts enrichment data via Ollama,
   * and sets enriched=true on the DB record.
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

      // Extract booking.com/hotel/{country}/{slug}.html URL
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

      // Add checkin/checkout dates so nightly prices are shown
      const urlWithDates = `${bookingUrl}?checkin=${futureDate(7)}&checkout=${futureDate(8)}&group_adults=2`;

      const pageRes = await fetch(`https://r.jina.ai/${urlWithDates}`, {
        headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown', 'X-Timeout': '15' },
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

      const extractPrompt = `
        Extract hotel details from this Booking.com page for "${hotel.name}".

        PAGE CONTENT:
        ${pageContent.slice(0, 20000)}

        Return ONLY a valid JSON object with these exact keys:
        {
          "rating": number,
          "description": "string",
          "priceRange": "string",
          "amenities": "string",
          "restaurants": "string",
          "activities": "string"
        }

        Strict rules — follow exactly:
        - rating: Find the numeric guest review score in the text. Booking.com scores are out of 10 — divide by 2 to convert to a 0–5 scale. Example: "8.6" → 4.3, "9.2" → 4.6. If no score is found, use 0. NEVER invent a score.
        - priceRange: Copy the exact nightly price shown in the text (e.g. "$294/night", "€180 - €250/night"). If no price is visible in the text, use "". NEVER invent or estimate a price.
        - description: 1–2 sentences from the page describing the hotel. If nothing useful, use "".
        - amenities: Up to 5 amenities explicitly listed on the page, comma-separated. Use "" if none found.
        - restaurants: Up to 3 dining options explicitly listed, comma-separated. Use "" if none found.
        - activities: Up to 3 activities or nearby attractions explicitly listed, comma-separated. Use "" if none found.
        - NEVER guess, invent, or infer any value. Only use what is explicitly written in the page content.
        - Output nothing outside the JSON object.
      `;

      const extractResponse = await llmService.generateEnrichmentResponse([
        { role: 'system', content: 'You are a data extraction engine. Output ONLY valid JSON. No preamble.' },
        { role: 'user', content: extractPrompt },
      ]);

      const jsonMatch = extractResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log(`  ⚠️  No JSON returned for "${hotel.name}"`);
        return false;
      }

      const data = JSON.parse(jsonMatch[0].replace(/,\s*]/g, ']').replace(/,\s*}/g, '}'));
      let rating = typeof data.rating === 'number' ? data.rating : parseFloat(data.rating) || 0.0;
      // Booking.com scores are /10 — if model didn't convert, do it here
      if (rating > 5) rating = parseFloat((rating / 2).toFixed(2));

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
          enriched: true,  // mark done so it's never re-processed
        },
      });

      console.log(`  ✅ "${hotel.name}" enriched (★${rating}, ${data.priceRange || 'no price'})`);
      return true;
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`  ⚠️  Skipping "${hotel.name}": ${reason}`);
      return false;
    }
  }
}
