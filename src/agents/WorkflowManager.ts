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

    // 4. Hotel Retrieval & Filtering
    let hotels = await hotelsAgent.searchHotels(query);
    
    // Fallback: If no results, and it's a follow-up, get ALL hotels or recently discussed ones
    const isFollowUp = ['attraction', 'dining', 'restaurant', 'price', 'pricing', 'room', 'cost', 'nearby', 'tell me', 'show me'].some(k => query.toLowerCase().includes(k));
    
    if (hotels.length === 0 && (isFollowUp || history.length > 0)) {
       const locations = ['london', 'hawaii', 'maui', 'venice', 'kyoto', 'maldives', 'paris'];
       
       // 1. Check current query first (Priority)
       let mentionedLocation = locations.find(l => query.toLowerCase().includes(l));
       
       // 2. If not in query, check recent history (Newest first)
       if (!mentionedLocation) {
         mentionedLocation = locations.find(l => 
           [...history].reverse().some(m => m.content.toLowerCase().includes(l))
         );
       }
       
       if (mentionedLocation) {
         const synced = await hotelsAgent.syncLocation(mentionedLocation, scraperService);
         if (synced) {
           hotels = await hotelsAgent.searchHotels(mentionedLocation);
         }
       } else {
         hotels = await hotelsAgent.searchHotels(""); 
       }
    }
    
    // Filter by user dislikes
    const filteredHotels = hotels.filter(h => {
      return !user.dislikes.some(dislike => 
        h.description.toLowerCase().includes(dislike.toLowerCase()) || 
        h.amenities.toLowerCase().includes(dislike.toLowerCase())
      );
    });

    // 5. Generate Response using LLM with History
    const response = await this.generateAIResponse(filteredHotels, query, user, history);

    // 6. Log Interaction
    await userAgent.logInteraction(email, 'user', query);
    await userAgent.logInteraction(email, 'assistant', response);

    return {
      response,
      suggestions: this.getSuggestedQuestions(query),
    };
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

  private async generateAIResponse(hotels: any[], query: string, user: any, history: any[]): Promise<string> {
    if (hotels.length === 0) {
      return "I couldn't find any Marriott properties matching that specific request. Would you like to try searching for a different region or type of hotel?";
    }

    const hotelContext = hotels.slice(0, 3).map(h => `
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
        content: `You are Marriott Lumina, a premium AI concierge. 
        Your goal is to provide luxurious, helpful, and accurate information about Marriott properties.
        Always format your output beautifully using Markdown (bolding, lists, etc.) but avoid heavy headers like # or ##. 
        Use symbols like ✓ or • for lists.
        
        Available Hotels in Context:
        ${hotelContext}
        
        User Preferences:
        Likes: ${user.likes.join(', ')}
        Dislikes: ${user.dislikes.join(', ')}`
      },
      ...history.slice(-5).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: query }
    ];

    return await llmService.generateResponse(messages as any);
  }

  private getSuggestedQuestions(query: string): string[] {
    const q = query.toLowerCase();
    if (q.includes('hotel') || q.includes('stay') || q.includes('paris') || q.includes('london') || q.includes('maui')) {
      return ["What are the dining options?", "Are there any tourist attractions nearby?", "What is the pricing for a standard room?"];
    }
    if (q.includes('price') || q.includes('cost')) {
      return ["Do you have cheaper options?", "What amenities are included?", "Show me luxury suites"];
    }
    return ["Show me Marriotts in London", "What are the best Marriotts for families?", "Tell me about Marriott activities in Hawaii"];
  }
}
