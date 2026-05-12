import { PrismaClient } from '@prisma/client';
import { LLMService } from '../lib/llm';

const prisma = new PrismaClient();

/**
 * Normalise a hotel name for fuzzy matching:
 * lowercase, strip filler words, remove punctuation, collapse whitespace.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(hotel|hotels|resort|resorts|the|a|an|by|and|&|marriott|bonvoy|autograph|collection|tribute|portfolio)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Find the best-matching DB hotel for an extracted hotel name.
 * Returns null if no match scores above the 40% word-overlap threshold.
 */
function matchHotel(
  extractedName: string,
  dbHotels: { id: string; name: string }[]
): { id: string; name: string } | null {
  const extractedNorm = normaliseName(extractedName);
  const extractedWords = extractedNorm.split(' ').filter(w => w.length > 2);
  if (extractedWords.length === 0) return null;

  let bestMatch: { id: string; name: string } | null = null;
  let bestScore = 0;

  for (const hotel of dbHotels) {
    const dbNorm = normaliseName(hotel.name);
    const dbWords = dbNorm.split(' ').filter(w => w.length > 2);
    if (dbWords.length === 0) continue;

    const extractedSet = new Set(extractedWords);
    const dbSet = new Set(dbWords);

    let overlap = 0;
    for (const word of extractedSet) {
      if (dbSet.has(word)) overlap++;
    }

    const score = overlap / Math.max(extractedSet.size, dbSet.size);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = hotel;
    }
  }

  return bestScore >= 0.4 ? bestMatch : null;
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
   * Enriches existing DB hotels for a location using Booking.com as the data source.
   *
   * Flow:
   * 1. Load all DB hotels for the location — these are the ground-truth records.
   * 2. Skip if enriched data is < 7 days old.
   * 3. Search DuckDuckGo (via Jina Reader) for the Booking.com Marriott city page.
   * 4. Fetch that page via Jina Reader.
   * 5. LLM extracts hotel data (rating, price, amenities, etc.) from the page.
   * 6. Fuzzy-match each extracted hotel to an existing DB record and UPDATE it.
   *    No new rows are ever inserted — Booking.com is an enricher, not the source of truth.
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

    console.log(`🔍 Enriching ${dbHotels.length} hotels for "${location}" via Booking.com...`);

    try {
      // 3. DDG search — find the Booking.com Marriott city page
      const query = encodeURIComponent(`Hotels in ${location} Marriott Bonvoy`);
      const ddgRes = await fetch(`https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=${query}`, {
        headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' },
        signal: AbortSignal.timeout(20000),
      });
      const ddgContent = await ddgRes.text();

      // 4. Extract Booking.com Marriott city URL
      let bookingUrl: string | null = null;

      const plainMatch = ddgContent.match(
        /https?:\/\/www\.booking\.com\/marriott\/city\/[a-z]{2}\/[a-z0-9\-]+\.html/i
      );
      if (plainMatch) bookingUrl = plainMatch[0];

      if (!bookingUrl) {
        const domainMatch = ddgContent.match(/www\.booking\.com\/marriott\/city\/[a-z]{2}\/[a-z0-9\-]+\.html/i);
        if (domainMatch) bookingUrl = `https://${domainMatch[0]}`;
      }

      if (!bookingUrl) {
        const encodedMatch = ddgContent.match(
          /uddg=(https?%3A%2F%2Fwww\.booking\.com%2Fmarriott%2Fcity%2F[a-z]{2}%2F[^&\s"')]+\.html)/i
        );
        if (encodedMatch) bookingUrl = decodeURIComponent(encodedMatch[1]);
      }

      if (!bookingUrl) {
        throw new Error(`Could not find a Booking.com Marriott page for "${location}" in search results`);
      }

      console.log(`🔗 Found Booking.com page: ${bookingUrl}`);

      // 5. Fetch the Booking.com page via Jina Reader
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

      console.log(`📄 Page fetched (${pageContent.length} chars). Extracting hotel data...`);

      // 6. LLM extraction
      const extractPrompt = `
        Extract every Marriott Bonvoy hotel listed on this page.

        PAGE CONTENT:
        ${pageContent.slice(0, 40000)}

        Return ONLY a valid JSON object:
        { "hotels": [{
          "name": "string",
          "rating": number,
          "description": "string (1 sentence max)",
          "priceRange": "string (e.g. $200 - $450/night)",
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
      if (!jsonMatch) throw new Error('No JSON in extraction response');

      const { hotels } = JSON.parse(
        jsonMatch[0].replace(/,\s*]/g, ']').replace(/,\s*}/g, '}')
      );

      if (!hotels?.length) throw new Error('No hotels extracted from Booking.com page');

      console.log(`🏨 Matching ${hotels.length} extracted hotels against ${dbHotels.length} DB records...`);

      // 7. Match each extracted hotel to an existing DB record and UPDATE it
      let updated = 0;
      let unmatched = 0;

      for (const h of hotels) {
        const match = matchHotel(h.name, dbHotels);

        if (!match) {
          console.log(`  ⚠️  No DB match for "${h.name}" — skipping`);
          unmatched++;
          continue;
        }

        const rating = typeof h.rating === 'number' ? h.rating : parseFloat(h.rating) || 0.0;

        await prisma.hotel.update({
          where: { id: match.id },
          data: {
            description: h.description || '',
            priceRange: h.priceRange || '',
            amenities: h.amenities || '',
            restaurants: h.restaurants || '',
            activities: h.activities || '',
            rating,
            url: bookingUrl,
            enriched: true,
          },
        });

        console.log(`  ✅ "${h.name}" → "${match.name}"`);
        updated++;
      }

      console.log(`✨ Enrichment complete for "${location}": ${updated} updated, ${unmatched} unmatched.`);
      return true;
    } catch (err) {
      console.error(`Sync failed for "${location}":`, err);
      return false;
    }
  }
}
