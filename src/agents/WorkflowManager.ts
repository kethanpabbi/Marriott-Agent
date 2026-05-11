import { UserAgent } from './UserAgent';
import { HotelsAgent } from './HotelsAgent';
import { LLMService } from '@/lib/llm';

const userAgent = new UserAgent();
const hotelsAgent = new HotelsAgent();
const llmService = new LLMService();

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

    // 2. Reasoning step — extracts location, intent, and query type
    const reasoningPrompt = `
      Analyze the user's query and conversation history.

      OUTPUT ONLY this JSON (no other text):
      {
        "inScope": boolean,
        "activeLocation": "city name in lowercase, or 'none'",
        "needsSync": boolean,
        "isSpecificHotelQuery": boolean,
        "specificHotelName": "hotel name if asking about one specific property, else null",
        "isBudgetQuery": boolean,
        "userProfileUpdate": { "likes": string[], "dislikes": string[] },
        "reasoning": "string"
      }

      Rules:
      - "needsSync" true only if the location is new or changed (not a follow-up on the same city).
      - "isSpecificHotelQuery" true if the user names a specific hotel.
      - "isBudgetQuery" true if the user asks for cheaper/budget/affordable options.

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
        activeLocation: "none", needsSync: false,
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

    const location = plan.activeLocation && plan.activeLocation !== "none" ? plan.activeLocation.trim().toLowerCase() : null;

    // 4. Sync from official Marriott page if needed (staleness check is inside syncLocation)
    if (location && plan.needsSync) {
      await hotelsAgent.syncLocation(location, llmService);
    }

    // 5. Retrieve hotels
    let hotels: any[] = [];
    if (location) {
      hotels = await hotelsAgent.searchHotels(location, {
        specificHotelName: plan.isSpecificHotelQuery ? plan.specificHotelName : undefined,
      });
    }

    // 6. Apply display limit:
    //    - Specific hotel query → show whatever matches (could be 1)
    //    - Budget query → top 5 by rating from the fetched pool (already sorted desc)
    //    - Default → top 5 by rating
    const displayHotels = plan.isSpecificHotelQuery ? hotels : hotels.slice(0, 5);

    // 7. Generate response
    const { response, suggestions } = await this.generateAIResponse(displayHotels, query, user, history, plan.isBudgetQuery);

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
  ): Promise<{ response: string; suggestions: string[] }> {
    const guestProfile = `
      GUEST PREFERENCES:
      - Likes: ${user.likes.join(', ') || 'None yet'}
      - Dislikes: ${user.dislikes.join(', ') || 'None yet'}
    `;

    const budgetInstruction = isBudgetQuery
      ? "The guest is looking for more affordable options. From the hotels below, highlight those with the lowest priceRange while still maintaining quality. Rank by value for money."
      : "Present the top 5 hotels shown below, ordered by rating (highest first).";

    const messages = [
      {
        role: 'system',
        content: `You are Marriott Lumina, a premium AI concierge for Marriott International.
        Only discuss properties that are part of the Marriott Bonvoy portfolio.

        ${guestProfile}

        ANTI-HALLUCINATION RULE:
        - If "GROUND TRUTH CONTEXT" is EMPTY, do NOT mention specific hotels. Tell the guest the directory is syncing and to try again shortly.
        - NEVER invent hotel names not present in the context.

        DISPLAY RULES:
        - ${budgetInstruction}
        - Group hotels under the correct tier headers (only include headers that have hotels):
          ### Luxury
          ### Distinctive Luxury
          ### Premium
          ### Select
          ### Longer Stays
          ### Collections
        - Use **Hotel Name** format for every property.
        - Include priceRange and rating (⭐) for each hotel.
        - If amenities/restaurants/activities are available, mention 1-2 highlights per hotel.
        - End every hotel list response with a question about budget or length of stay.

        CRITICAL: "SUGGESTIONS:" must appear ONLY at the very end.
        After "SUGGESTIONS:", provide exactly 3 short replies the GUEST would naturally say next (not questions you ask — guest responses). Keep each under 8 words.

        GROUND TRUTH CONTEXT:
        ${hotels.map(h => `
          Name: ${h.name}
          Tier: ${h.tier || "Premium"}
          Rating: ${h.rating}
          PriceRange: ${h.priceRange}
          Description: ${h.description}
          Amenities: ${h.amenities}
          Restaurants: ${h.restaurants}
          Activities: ${h.activities}
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
          `What are the dining options at the ${hotels[0].name}?`,
          `Show me Luxury hotels in ${city}`,
          `Any Marriotts with a rooftop in ${city}?`,
        ];
      } else {
        suggestions = ["Show me Marriotts in London", "Best family-friendly Marriotts?", "Find a beach resort"];
      }
    }

    return { response: responseText, suggestions: suggestions.slice(0, 3) };
  }
}
