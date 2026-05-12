import { NextRequest, NextResponse } from 'next/server';
import { HotelsAgent } from '@/agents/HotelsAgent';
import { LLMService } from '@/lib/llm';

const hotelsAgent = new HotelsAgent();
const llmService = new LLMService();

const TIER_ORDER = ['Luxury', 'Distinctive Luxury', 'Premium', 'Select', 'Longer Stays', 'Collections'];

function pickOnePerTier(hotels: any[], isBudget: boolean): any[] {
  const byTier: Record<string, any[]> = {};
  for (const h of hotels) {
    const tier = h.tier || 'Premium';
    if (!byTier[tier]) byTier[tier] = [];
    byTier[tier].push(h);
  }

  const result: any[] = [];
  for (const tier of TIER_ORDER) {
    const candidates = byTier[tier];
    if (!candidates?.length) continue;

    const enriched = candidates.filter(h => h.description?.trim());
    const pool = enriched.length > 0 ? enriched : candidates;

    if (isBudget) {
      pool.sort((a, b) => {
        const pa = parseFloat(a.priceRange?.replace(/[^0-9.]/g, '') || '99999');
        const pb = parseFloat(b.priceRange?.replace(/[^0-9.]/g, '') || '99999');
        return pa - pb;
      });
    } else {
      pool.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    result.push(pool[0]);
  }
  return result;
}

/**
 * GET /api/search
 *
 * Query params:
 *   location    — city name (required)
 *   country     — country name, lowercase (optional, narrows results)
 *   budget      — "true" to sort by price ascending (optional)
 *   hotelName   — specific hotel name to look up (optional)
 *
 * Used as the `search_hotels` tool by the Claude Console managed agent.
 * Also fires background enrichment (Booking.com scrape via Jina + Ollama)
 * if the location hasn't been enriched yet, so data improves over time.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const location = searchParams.get('location')?.trim().toLowerCase();
  const country = searchParams.get('country')?.trim().toLowerCase() || undefined;
  const isBudget = searchParams.get('budget') === 'true';
  const hotelName = searchParams.get('hotelName')?.trim() || undefined;

  if (!location) {
    return NextResponse.json({ error: 'location is required' }, { status: 400 });
  }

  // Fire enrichment in the background — caller never waits for it
  hotelsAgent.isEnriched(location, country).then(already => {
    if (!already) {
      hotelsAgent.syncLocation(location, llmService, country).catch(err =>
        console.error(`Background enrichment failed for "${location}":`, err)
      );
    }
  });

  const hotels = await hotelsAgent.searchHotels(location, { specificHotelName: hotelName, country });

  const results = hotelName ? hotels : pickOnePerTier(hotels, isBudget);

  return NextResponse.json({ hotels: results, total: results.length });
}
