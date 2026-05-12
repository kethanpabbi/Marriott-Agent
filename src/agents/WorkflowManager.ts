import { UserAgent } from './UserAgent';
import { HotelsAgent } from './HotelsAgent';
import { LLMService } from '@/lib/llm';

const userAgent = new UserAgent();
const hotelsAgent = new HotelsAgent();
const llmService = new LLMService();

const TIER_ORDER = ['Luxury', 'Distinctive Luxury', 'Premium', 'Select', 'Longer Stays', 'Collections'];

/**
 * Pick the highest-rated hotel from each available tier.
 * When isBudgetQuery is true, sort each tier's candidates by price ascending instead.
 */
function pickOnePerTier(hotels: any[], isBudgetQuery: boolean): any[] {
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

    if (isBudgetQuery) {
      // Sort by lowest price — extract first number from priceRange string
      candidates.sort((a, b) => {
        const priceA = parseFloat(a.priceRange?.replace(/[^0-9.]/g, '') || '99999');
        const priceB = parseFloat(b.priceRange?.replace(/[^0-9.]/g, '') || '99999');
        return priceA - priceB;
      });
    } else {
      candidates.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    result.push(candidates[0]);
  }
  return result;
}

export class WorkflowManager {
  async processQuery(email: string, query: string) {
    // 1. Security check
    const securityCheck = await userAgent.checkSecurity(email, query);
    if (!securityCheck.safe) {
      return { response: securityCheck.reason, suggestions: [] };
    }

    const [history, user] = await Promise.all([
      userAgent.getChatHistory(email),
      userAgent.getOrCreateUser(email),
    ]);

    // 2. Reasoning step — extracts location, country, intent, and query type
    const reasoningPrompt = `
      Analyze the user's query and conversation history.

      OUTPUT ONLY this JSON (no other text):
      {
        "inScope": boolean,
        "activeLocation": "city name in lowercase, or 'none'",
        "activeCountry": "most likely country in lowercase (e.g. 'france' for Paris, 'united kingdom' for London). If ambiguous and the user did not specify, infer the most internationally prominent city of that name. Return 'none' if no location.",
        "isSpecificHotelQuery": boolean,
        "specificHotelName": "hotel name if asking about one specific property, else null",
        "isBudgetQuery": boolean,
        "userProfileUpdate": { "likes": string[], "dislikes": string[] },
        "reasoning": "string"
      }

      Rules:
      - "isSpecificHotelQuery" true if the user names a specific hotel.
      - "isBudgetQuery" true if the user asks for cheaper/budget/affordable options.
      - For ambiguous city names (Paris, Springfield, Richmond etc.) default to the most internationally known version unless the user specifies a country or state.

      History: ${JSON.stringify(history.slice(-5))}
      Query: ${query}
    `;

    const reasoningResponse = await llmService.generateResponse([
      { role: 'user', content: reasoningPrompt },
    ]);

    let plan: any;
    try {
      const jsonStr = reasoningResponse.match(/\{[\s\S]*\}/)?.[0] || reasoningResponse;
      plan = JSON.parse(jsonStr);

      if (plan.inScope === false) {
        return {
          response: "I am here specifically to assist you with Marriott International properties and nearby attractions.",
          suggestions: ["Show me Marriotts in London", "What are the best Marriotts for families?"],
        };
      }
    } catch {
      plan = {
        activeLocation: "none",
        activeCountry: "none",
        isSpecificHotelQuery: false, specificHotelName: null, isBudgetQuery: false,
        userProfileUpdate: { likes: [], dislikes: [] }, reasoning: "Fallback",
      };
    }

    console.log(`🧠 Reasoning: ${plan.reasoning}`);

    // 3. Learn from preferences
    if (plan.userProfileUpdate?.likes?.length > 0 || plan.userProfileUpdate?.dislikes?.length > 0) {
      const newLikes = Array.from(new Set([...user.likes, ...plan.userProfileUpdate.likes]));
      const newDislikes = Array.from(new Set([...user.dislikes, ...plan.userProfileUpdate.dislikes]));
      await userAgent.updatePreferences(email, newLikes, newDislikes);
      user.likes = newLikes;
      user.dislikes = newDislikes;
    }

    const location = plan.activeLocation && plan.activeLocation !== 'none'
      ? plan.activeLocation.trim().toLowerCase() : null;
    const country = plan.activeCountry && plan.activeCountry !== 'none'
      ? plan.activeCountry.trim().toLowerCase() : undefined;

    // 4. Sync strategy — if already enriched, await; if not, fire-and-forget so the
    //    user gets basic results immediately while enrichment runs in the background.
    let enrichingInBackground = false;
    if (location) {
      const alreadyEnriched = await hotelsAgent.isEnriched(location, country);
      if (alreadyEnriched) {
        // Staleness check only — returns instantly if data is fresh
        await hotelsAgent.syncLocation(location, llmService, country);
      } else {
        // No enriched data yet — kick off enrichment without blocking the response
        enrichingInBackground = true;
        hotelsAgent.syncLocation(location, llmService, country).catch(err =>
          console.error(`Background enrichment failed for "${location}":`, err)
        );
      }
    }

    // 5. Retrieve hotels from DB (country-filtered to avoid cross-country matches)
    let hotels: any[] = [];
    if (location) {
      hotels = await hotelsAgent.searchHotels(location, {
        specificHotelName: plan.isSpecificHotelQuery ? plan.specificHotelName : undefined,
        country,
      });
    }

    // 6. Pick one hotel per tier (best rated, or cheapest if budget query).
    //    For specific hotel queries, show all matches.
    const displayHotels = plan.isSpecificHotelQuery
      ? hotels
      : pickOnePerTier(hotels, plan.isBudgetQuery);

    // 7. Generate response
    const { response, suggestions } = await this.generateAIResponse(
      displayHotels, query, user, history, plan.isBudgetQuery, enrichingInBackground
    );

    await Promise.all([
      userAgent.logInteraction(email, 'user', query),
      userAgent.logInteraction(email, 'assistant', response),
    ]);

    return { response, suggestions: suggestions || ["Show me Marriotts in London"] };
  }

  private async generateAIResponse(
    hotels: any[],
    query: string,
    user: any,
    history: any[],
    isBudgetQuery: boolean,
    enrichingInBackground: boolean,
  ): Promise<{ response: string; suggestions: string[] }> {
    const guestProfile = `
      GUEST PREFERENCES:
      - Likes: ${user.likes.join(', ') || 'None yet'}
      - Dislikes: ${user.dislikes.join(', ') || 'None yet'}
    `;

    const displayInstruction = isBudgetQuery
      ? "The guest wants affordable options. Show one hotel per tier (cheapest in each tier). Lead with the most budget-friendly."
      : "Show one hotel per tier from the context below. Each tier gets its own header.";

    const backgroundNote = enrichingInBackground
      ? `NOTE: Real-time pricing and ratings are being fetched in the background. Present the hotels below with whatever data is available. If priceRange or rating is missing, say "Pricing loading — check back shortly" for that hotel. End with a note that full details will be ready on the next message.`
      : "";

    const messages = [
      {
        role: 'system',
        content: `You are Marriott Lumina, a premium AI concierge for Marriott International.
        Only discuss properties that are part of the Marriott Bonvoy portfolio.

        ${guestProfile}

        ANTI-HALLUCINATION RULE:
        - If "GROUND TRUTH CONTEXT" is EMPTY, do NOT mention specific hotels. Tell the guest the directory is syncing and to try again shortly.
        - NEVER invent hotel names not present in the context.

        ${backgroundNote}

        DISPLAY RULES:
        - ${displayInstruction}
        - Group hotels under the correct tier headers (only include tiers that have a hotel):
          ### Luxury
          ### Distinctive Luxury
          ### Premium
          ### Select
          ### Longer Stays
          ### Collections
        - Use **Hotel Name** format for every property.
        - Include priceRange and rating (⭐) for each hotel where available.
        - If amenities/restaurants/activities are available, mention 1-2 highlights per hotel.
        - End every hotel list response with a question about budget or length of stay.

        CRITICAL: "SUGGESTIONS:" must appear ONLY at the very end.
        After "SUGGESTIONS:", provide exactly 3 short replies the GUEST would naturally say next (not questions you ask — guest responses). Keep each under 8 words.

        GROUND TRUTH CONTEXT:
        ${hotels.map(h => `
          Name: ${h.name}
          Tier: ${h.tier || 'Premium'}
          Rating: ${h.rating || 'unknown'}
          PriceRange: ${h.priceRange || 'unknown'}
          Description: ${h.description || ''}
          Amenities: ${h.amenities || ''}
          Restaurants: ${h.restaurants || ''}
          Activities: ${h.activities || ''}
        `).join('\n')}`,
      },
      ...history.slice(-5).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: query },
    ];

    const rawResponse = await llmService.generateResponse(messages as any);

    const parts = rawResponse.split(/SUGGESTIONS:?/i);
    const responseText = parts[0].trim();

    let suggestions: string[] = [];
    if (parts[1]) {
      suggestions = parts[1]
        .split('\n')
        .map(s => s.replace(/^\d+\.\s*/, '').replace(/^[•*-]\s*/, '').trim())
        .filter(s => s.length > 3)
        .slice(0, 3);
    }

    if (suggestions.length < 2) {
      const lastQuestion = responseText.match(/[^.!?\n]+\?[^?]*$/)?.[0]?.trim() || "";
      const lq = lastQuestion.toLowerCase();

      if (lq.includes("budget") || lq.includes("per night") || lq.includes("price")) {
        suggestions = ["Under $200/night", "Around $400/night", "Budget is flexible"];
      } else if (lq.includes("length") || lq.includes("how long") || lq.includes("nights") || lq.includes("stay")) {
        suggestions = ["Just 2 nights", "A full week", "A long weekend"];
      } else if (lq.includes("prefer") || lq.includes("looking for") || lq.includes("amenities")) {
        suggestions = ["Spa and wellness", "Great dining options", "Close to city center"];
      } else if (hotels.length > 0) {
        const city = hotels[0].location;
        suggestions = [
          `Tell me more about ${hotels[0].name}`,
          `Show me Luxury hotels in ${city}`,
          `Any Marriotts with a spa in ${city}?`,
        ];
      } else {
        suggestions = ["Show me Marriotts in London", "Best family-friendly Marriotts?", "Find a beach resort"];
      }
    }

    return { response: responseText, suggestions: suggestions.slice(0, 3) };
  }
}
