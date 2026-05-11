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
              ADAPTATION RULES:
        1. TRIPLE-LOCK BRAND INTEGRITY: You MUST use the EXACT "Class" provided in the context for every hotel. DO NOT OVERRIDE IT. 
        2. STRUCTURED CATEGORIZATION: Group all hotels into these 4 EXACT headers in order:
           ### Luxury
           ### Premium
           ### Select
           ### Longer Stays
        3. FAILED CATEGORIZATION: If a hotel is labeled as "Select" in the context, it MUST go under the ### Select header. NO EXCEPTIONS.
        4. MANDATORY FOLLOW-UP: Every hotel list response MUST end with a question asking about the guest's **budget preferences** or **length of stay**.
        5. CONTEXT SYNTHESIS: Review history to avoid repetition.
        
        OUTPUT FORMAT:
        [Your helpful, luxury-toned response in Markdown]
        - Use the format: **Hotel Name (Class)** for every property listing.
        
        CRITICAL: The tag "SUGGESTIONS:" must ONLY appear at the very end.
        
        Available Hotels in Context (Ground Truth - USE THESE CLASSES ONLY):
        ${hotels.map(h => `
          Name: ${h.name}
          Class: ${h.class || "Premium"}
          Rating: ${h.rating}
          Description: ${h.description}
        `).join('\n')}
        
        User Preferences:
        Likes: ${user.likes.join(', ')}
        Dislikes: ${user.dislikes.join(', ')}`
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
        .filter(s => s.length > 5 && s.includes('?'))
        .slice(0, 3);
    }

    if (suggestions.length < 2 && hotels.length > 0) {
      const city = hotels[0].location;
      const tier = hotels[0].class || "Marriott";
      suggestions = [
        `What are the dining options at the ${hotels[0].name}?`,
        `How do I earn Marriott Bonvoy points in ${city}?`,
        `Tell me more about ${tier} hotels in ${city}`
      ];
    }

    return { response: responseText, suggestions: suggestions.slice(0, 3) };
  }

}
