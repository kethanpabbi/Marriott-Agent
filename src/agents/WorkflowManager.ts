import { UserAgent } from './UserAgent';
import { HotelsAgent } from './HotelsAgent';
import { LLMService } from '@/lib/llm';
import { ScraperService } from '@/tools/ScraperService';

const userAgent = new UserAgent();
const hotelsAgent = new HotelsAgent();
const llmService = new LLMService();
const scraperService = new ScraperService();

export class WorkflowManager {
  /**
   * Main entry point for processing a user message.
   */
  async processQuery(email: string, query: string) {
    // 1. Security Check
    const securityCheck = await userAgent.checkSecurity(email, query);
    if (!securityCheck.safe) {
      return {
        response: securityCheck.reason,
        suggestions: [],
      };
    }

    // 2. AGENTIC REASONING & LEARNING STEP (Now includes Scope Detection)
    const history = await userAgent.getChatHistory(email);

    // 3. User Context Retrieval
    const user = await userAgent.getOrCreateUser(email);

    // 4. DYNAMIC CONTEXT EXTRACTION
    let lastOfferedCity = "none";
    if (history.length > 0) {
      const lastAssistantMsg = [...history].reverse().find(m => m.role === 'assistant');
      if (lastAssistantMsg) {
        lastOfferedCity = "See History Turn -1"; 
      }
    }

    // 5. AGENTIC REASONING & LEARNING STEP
    const reasoningPrompt = `
        Analyze the user's latest query and the conversation history.
        
        LAST_OFFERED_CITY: "${lastOfferedCity}"
        
        TASK:
        1. "inScope": true/false.
        2. "activeLocation": Identify the city.
        3. "isFollowUp": true/false.
        4. "needsSync": true if location data is missing OR if current data is incomplete.
        5. "userProfileUpdate": Extract new preferences.
        6. "reasoning": Explain your logic.
        
        OUTPUT ONLY JSON:
        { 
          "inScope": boolean,
          "activeLocation": "string", 
          "isFollowUp": boolean, 
          "needsSync": boolean, 
          "userProfileUpdate": { "likes": string[], "dislikes": string[] },
          "reasoning": "string" 
        }
    `;

    const reasoningResponse = await llmService.generateResponse([{ role: 'user', content: reasoningPrompt + `\nHistory: ${JSON.stringify(history.slice(-5))}\nQuery: ${query}` }]);
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
    } catch (e) {
      plan = { activeLocation: "none", isFollowUp: false, needsSync: false, userProfileUpdate: { likes: [], dislikes: [] }, reasoning: "Fallback" };
    }

    console.log(`🧠 Reasoning: ${plan.reasoning}`);

    // 5. LEARNING & ADAPTATION
    if (plan.userProfileUpdate && (plan.userProfileUpdate.likes.length > 0 || plan.userProfileUpdate.dislikes.length > 0)) {
      const newLikes = Array.from(new Set([...user.likes, ...plan.userProfileUpdate.likes]));
      const newDislikes = Array.from(new Set([...user.dislikes, ...plan.userProfileUpdate.dislikes]));
      await userAgent.updatePreferences(email, newLikes, newDislikes);
      user.likes = newLikes;
      user.dislikes = newDislikes;
    }

    // 6. AUTONOMOUS DISCOVERY
    const locations = plan.activeLocation && plan.activeLocation !== "none" 
      ? plan.activeLocation.split(',').map((l: string) => l.trim().toLowerCase()) 
      : [];
    
    if (locations.length > 0) {
      for (const loc of locations) {
        await hotelsAgent.syncLocation(loc, scraperService, llmService);
      }
    }

    // 7. Data Retrieval
    let hotels: any[] = [];
    if (locations.length > 0) {
      for (const loc of locations) {
        const locHotels = await hotelsAgent.searchHotels(loc);
        hotels = [...hotels, ...locHotels];
      }
    }

    const filteredHotels = hotels; 

    // 5. Generate Response & Suggestions using LLM
    const { response, suggestions } = await this.generateAIResponse(filteredHotels, query, user, history);

    // 6. Log Interaction
    await userAgent.logInteraction(email, 'user', query);
    await userAgent.logInteraction(email, 'assistant', response);

    return {
      response,
      suggestions: suggestions || ["Show me Marriotts in London"],
    };
  }

  private async generateAIResponse(hotels: any[], query: string, user: any, history: any[]): Promise<{ response: string, suggestions: string[] }> {
    const guestProfile = `
      GUEST PREFERENCES:
      - Likes: ${user.likes.join(', ') || 'None yet'}
      - Dislikes: ${user.dislikes.join(', ') || 'None yet'}
    `;

    const messages = [
      { 
        role: 'system', 
        content: `You are Marriott Lumina, a premium AI concierge for Marriott International.
        Only discuss properties that are part of the Marriott Bonvoy portfolio.
        
        ${guestProfile}
        
        ANTI-HALLUCINATION RULE:
        - If the "GROUND TRUTH CONTEXT" below is EMPTY, do NOT mention any specific hotels.
        - Instead, inform the guest that you are currently synchronizing the local property directory for that location and ask them to try again in a few seconds.
        - NEVER make up hotel names if they aren't in the context.
        
        ADAPTATION RULES:
        1. SOURCE-LOCKED BRANDING: You MUST use the EXACT "Class" provided in the context for every hotel.
        2. GROUPING MANDATE: Group all hotels into these EXACT headers in order:
           ### Luxury
           ### Distinctive Luxury
           ### Premium
           ### Select
           ### Longer Stays
           ### Collections
        3. BRAND ACCURACY: You MUST place hotels in the correct tier based on their brand. For example, W Hotels must be under ### Distinctive Luxury, while Moxy must be under ### Select and Autograph Collection under ### Collections.
        4. MANDATORY FOLLOW-UP: Every hotel list response MUST end with a question about budget or length of stay.
        
        OUTPUT FORMAT:
        [Your helpful, luxury-toned response in Markdown]
        - Use the format: **Hotel Name** for every property listing.
        
        CRITICAL: The tag "SUGGESTIONS:" must ONLY appear at the very end.
        After "SUGGESTIONS:", provide exactly 3 short follow-up messages the GUEST would naturally say next — NOT questions you'd ask, but replies a guest would give. For example, if you asked about budget, suggest budget responses like "Under $300/night" or "Looking for a long weekend". If you asked about length of stay, suggest "2 nights", "A week", "Just one night". Keep each suggestion under 8 words.

        GROUND TRUTH CONTEXT (USE THESE CLASSES ONLY):
        ${hotels.map(h => `
          Name: ${h.name}
          Class: ${h.class || "Premium"}
          Rating: ${h.rating}
          Description: ${h.description}
        `).join('\n')}`
      },
      ...history.slice(-5).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: query }
    ];

    const rawResponse = await llmService.generateResponse(messages as any);
    
    const suggestionsTag = /SUGGESTIONS:?/i;
    const parts = rawResponse.split(suggestionsTag);
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
      // Detect the last question in the response and generate contextual reply suggestions
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
          `Any Marriotts with a rooftop in ${city}?`
        ];
      } else {
        suggestions = ["Show me Marriotts in London", "Best family-friendly Marriotts?", "Find a beach resort"];
      }
    }

    return { response: responseText, suggestions: suggestions.slice(0, 3) };
  }

}
