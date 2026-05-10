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

    // 2. Scope Enforcement
    const history = await userAgent.getChatHistory(email);
    if (!this.isMarriottRelated(query, history)) {
      return {
        response: "I am here specifically to assist you with Marriott International properties and nearby attractions. How can I help you find your next Marriott stay?",
        suggestions: ["Show me Marriotts in London", "What are the best Marriotts for families?", "Tell me about Marriott activities in Hawaii"],
      };
    }

    // 3. User Context Retrieval
    const user = await userAgent.getOrCreateUser(email);

    // 4. AGENTIC REASONING STEP
    // We ask the LLM to analyze the situation and decide what to do.
    const reasoningPrompt = `
    You are the reasoning engine for Marriott Lumina.
    User Query: "${query}"
    Recent History: ${history.slice(-3).map(m => `[${m.role}] ${m.content}`).join(' | ')}
    
    TASK:
    1. Determine the active location(s). If multiple (e.g. comparing cities), return them as a comma-separated list (e.g., "mumbai, bangalore").
    2. Determine if this is a follow-up to the previous turn.
    3. Decide if we need to sync new data via Firecrawl (only for new locations or if info is missing).
    
    RESPONSE FORMAT (JSON):
    {
      "activeLocation": "string",
      "isFollowUp": boolean,
      "reasoning": "string",
      "needsSync": boolean
    }`;

    const reasoningResult = await llmService.generateResponse([{ role: 'user', content: reasoningPrompt }]);
    let plan: any;
    try {
      // Find the JSON block in case the LLM added prose
      const jsonStr = reasoningResult.match(/\{[\s\S]*\}/)?.[0] || reasoningResult;
      plan = JSON.parse(jsonStr);
    } catch (e) {
      plan = { activeLocation: "none", isFollowUp: false, reasoning: "Fallback reasoning", needsSync: false };
    }

    console.log(`🧠 Reasoning: ${plan.reasoning}`);

    // 5. Execution based on Plan
    let hotels: any[] = [];
    const locations = plan.activeLocation ? plan.activeLocation.split(',').map((l: string) => l.trim().toLowerCase()) : [];

    if (plan.activeLocation && plan.activeLocation !== "none") {
      for (const loc of locations) {
        if (plan.needsSync) {
          await hotelsAgent.syncLocation(loc, scraperService);
        }
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
    if (hotels.length === 0) {
      return { 
        response: "I couldn't find any Marriott properties matching that specific request. Would you like to try searching for a different region or type of hotel?",
        suggestions: ["Show me Marriotts in London", "Find hotels in Paris", "What are the best beach resorts?"]
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
      Attractions: ${h.nearbyAttractions?.map((a: any) => `${a.name} (${a.distance})`).join(', ')}
    `).join('\n---\n');

    const messages = [
      { 
        role: 'system', 
        content: `You are Marriott Lumina, a premium AI concierge for Marriott International.
        Only discuss properties that are part of the Marriott Bonvoy portfolio.
        CONVERSATIONAL RULES:
        1. NO REPETITIVE GREETINGS: Do not say "Welcome to Marriott Lumina" or "I'm delighted to assist" in every message. Be conversational and direct.
        2. CONTEXT LOCK: Only answer based on the "Available Hotels" provided below. If a hotel is not in the list, admit you don't have its specific details yet.
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

  private isMarriottRelated(query: string, history: any[]): boolean {
    // If we have an active conversation, be very permissive
    if (history.length > 0) {
      const stopWords = ['joke', 'weather', 'news', 'stock', 'crypto', 'translate'];
      const isIrrelevant = stopWords.some(w => query.toLowerCase().includes(w));
      if (!isIrrelevant) return true;
    }

    const keywords = [
      'marriott', 'hotel', 'resort', 'stay', 'room', 'booking', 'price', 'pricing', 'cost', 
      'bonvoy', 'amenities', 'dining', 'restaurant', 'attraction', 'activity', 'activities', 
      'paris', 'london', 'hawaii', 'maui', 'venice', 'kyoto', 'maldives', 'recommend', 
      'show me', 'find', 'nearby', 'tourist', 'family'
    ];
    return keywords.some(k => query.toLowerCase().includes(k));
  }
}
