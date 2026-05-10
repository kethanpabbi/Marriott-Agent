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

    // 4. Smart Hotel Retrieval (History-Aware)
    let hotels = await hotelsAgent.searchHotels(query);
    
    // If query yields nothing, search for the most recently active location
    if (hotels.length === 0) {
       const locations = ['london', 'hawaii', 'maui', 'venice', 'kyoto', 'maldives', 'paris', 'oahu', 'honolulu', 'mumbai'];
       
       // 1. Detect location in current query or history
       let activeLocation = locations.find(l => query.toLowerCase().includes(l));
       
       if (!activeLocation) {
         // Check history in reverse
         for (const msg of [...history].reverse()) {
           activeLocation = locations.find(l => msg.content.toLowerCase().includes(l));
           if (activeLocation) break;
         }
       }
       
       if (activeLocation) {
         await hotelsAgent.syncLocation(activeLocation, scraperService);
         hotels = await hotelsAgent.searchHotels(activeLocation);
       } else {
         // Fallback to all hotels
         hotels = await hotelsAgent.searchHotels("");
       }
    }
    
    // Ensure the AI has a balanced set of hotels (Prefer current context)
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
