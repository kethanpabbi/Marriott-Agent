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
    // We identify the city mentioned in the VERY LAST turn to prevent "Paris Drift".
    let lastOfferedCity = "none";
    if (history.length > 0) {
      const lastAssistantMsg = [...history].reverse().find(m => m.role === 'assistant');
      if (lastAssistantMsg) {
        // We pass the content of the last response to the reasoning prompt 
        // and let the LLM extract the location autonomously.
        lastOfferedCity = "See History Turn -1"; 
      }
    }

    // 5. AGENTIC REASONING & LEARNING STEP
    const reasoningPrompt = `
        Analyze the user's latest query and the conversation history.
        
        LAST_OFFERED_CITY: "${lastOfferedCity}"
        
        TASK:
        1. "inScope": true/false.
        2. "activeLocation": Identify the city. If it's a follow-up (e.g. "which is cheaper?"), STRICTLY USE "${lastOfferedCity}" unless a new city is mentioned in the query.
        3. "isFollowUp": true if this builds on the previous turn.
        4. "needsSync": true if location data is missing.
        5. "userProfileUpdate": Extract new preferences. If the user contradicts a past preference (e.g. they now like beaches), UPDATE it. Preferences are DYNAMIC.
        6. "reasoning": Explain your logic, specifically why you are staying in ${lastOfferedCity} or moving to a new city.
        
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
          response: "I am here specifically to assist you with Marriott International properties and nearby attractions. How can I help you find your next Marriott stay?",
          suggestions: ["Show me Marriotts in London", "What are the best Marriotts for families?", "Find a hotel in Dubai"],
        };
      }
    } catch (e) {
      plan = { activeLocation: "none", isFollowUp: false, needsSync: false, userProfileUpdate: { likes: [], dislikes: [] }, reasoning: "Fallback" };
    }

    console.log(`🧠 Reasoning: ${plan.reasoning}`);

    // 5. LEARNING & ADAPTATION: Update User Profile
    if (plan.userProfileUpdate && (plan.userProfileUpdate.likes.length > 0 || plan.userProfileUpdate.dislikes.length > 0)) {
      console.log(`💾 Learning user preferences: ${JSON.stringify(plan.userProfileUpdate)}`);
      const newLikes = Array.from(new Set([...user.likes, ...plan.userProfileUpdate.likes]));
      const newDislikes = Array.from(new Set([...user.dislikes, ...plan.userProfileUpdate.dislikes]));
      await userAgent.updatePreferences(email, newLikes, newDislikes);
      // Refresh user context for current turn
      user.likes = newLikes;
      user.dislikes = newDislikes;
    }

    // 6. AUTONOMOUS DISCOVERY: Sync Locations
    const locations = plan.activeLocation && plan.activeLocation !== "none" 
      ? plan.activeLocation.split(',').map((l: string) => l.trim().toLowerCase()) 
      : [];
    
    if (plan.needsSync && locations.length > 0) {
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

    // If still no hotels, search by query
    if (hotels.length === 0) {
      hotels = await hotelsAgent.searchHotels(query);
    }

    // Final fallback: all hotels
    if (hotels.length === 0) {
      hotels = await hotelsAgent.searchHotels("");
    }

    const filteredHotels = hotels.slice(0, 10);

    // 5. Generate Response & Suggestions using LLM
    const { response, suggestions } = await this.generateAIResponse(filteredHotels, query, user, history);

    // 6. Log Interaction
    await userAgent.logInteraction(email, 'user', query);
    await userAgent.logInteraction(email, 'assistant', response);

    return {
      response,
      suggestions: suggestions || ["Show me Marriotts in London", "What are the best Marriotts for families?", "Tell me about Marriott activities in Hawaii"],
    };
  }

  private async generateAIResponse(hotels: any[], query: string, user: any, history: any[]): Promise<{ response: string, suggestions: string[] }> {
    const guestProfile = `
      GUEST PREFERENCES:
      - Likes: ${user.likes.join(', ') || 'None yet'}
      - Dislikes: ${user.dislikes.join(', ') || 'None yet'}
    `;

    if (hotels.length === 0) {
      return { 
        response: "I couldn't find any Marriott properties matching that specific request in our global directory yet. However, based on your preferences, I can help you find alternatives in cities I've already explored. Where would you like to look?",
        suggestions: ["Show me Marriotts in London", "Find hotels in Paris"]
      };
    }

    const hotelContext = hotels.slice(0, 10).map(h => `
      ID: ${h.id}
      Name: ${h.name}
      Rating: ${h.rating} / 5.0
      Location: ${h.location}
      Price: ${h.priceRange}
      Amenities: ${h.amenities}
      Restaurants: ${h.restaurants}
      Activities: ${h.activities}
      Description: ${h.description}
    `).join('\n---\n');

    const messages = [
      { 
        role: 'system', 
        content: `You are Marriott Lumina, a premium AI concierge for Marriott International.
        Only discuss properties that are part of the Marriott Bonvoy portfolio.
        
        ${guestProfile}
        
        ADAPTATION RULES:
        1. PERSOANLIZATION: Use the GUEST PREFERENCES above to tailor your answer. If they dislike beaches, don't recommend a resort even if it's in the results. If they like spas, highlight the spa facilities first.
        2. NO REPETITIVE GREETINGS: Be conversational and direct.
        3. CONTEXT LOCK: Only answer based on the "Available Hotels" provided below.
        3. HONEST SUGGESTIONS: Only suggest follow-up questions that you CAN answer using the provided "Available Hotels" context. Do not suggest "Special Offers" if you don't see any in the data.
        4. USER-PERSPECTIVE SUGGESTIONS: Phrased suggestions as if the USER is asking them. (e.g., "Tell me about the pool" instead of "Would you like to know about the pool?").
        
        OUTPUT FORMAT:
        [Your helpful, luxury-toned response in Markdown]
        
        CRITICAL: DO NOT use trailing ** or * at the end of paragraphs.
        CRITICAL: The tag "SUGGESTIONS:" must ONLY appear at the very end of your response, after all your text.
        
        SUGGESTIONS:
        [First user-style question]
        [Second user-style question]
        [Third user-style question]
        
        Available Hotels in Context:
        ${hotelContext}
        
        User Preferences:
        Likes: ${user.likes.join(', ')}
        Dislikes: ${user.dislikes.join(', ')}`
      },
      ...history.slice(-5).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: query }
    ];

    const rawResponse = await llmService.generateResponse(messages as any);
    
    // Parse response and suggestions
    const parts = rawResponse.split(/SUGGESTIONS:/i);
    const responseText = parts[0].trim();
    const suggestions = parts[1] 
      ? parts[1].split('\n').map(s => s.replace(/^\d+\.\s*/, '').replace(/^[•*-]\s*/, '').trim()).filter(s => s.length > 5).slice(0, 3)
      : [];

    return { response: responseText, suggestions };
  }

}
