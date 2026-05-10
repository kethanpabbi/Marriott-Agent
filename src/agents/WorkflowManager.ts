import { UserAgent } from './UserAgent';
import { HotelsAgent } from './HotelsAgent';
import { LLMService } from '@/lib/llm';

const userAgent = new UserAgent();
const hotelsAgent = new HotelsAgent();
const llmService = new LLMService();

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
    if (!this.isMarriottRelated(query)) {
      return {
        response: "I am here specifically to assist you with Marriott International properties and nearby attractions. How can I help you find your next Marriott stay?",
        suggestions: ["Show me Marriotts in London", "What are the best Marriotts for families?", "Tell me about Marriott activities in Hawaii"],
      };
    }

    // 3. User Context & History Retrieval
    const user = await userAgent.getOrCreateUser(email);
    const history = await userAgent.getChatHistory(email);

    // 4. Determine Context (is this a follow-up?)
    let hotels: any[] = [];
    const isFollowUp = ['attraction', 'dining', 'restaurant', 'price', 'pricing', 'room', 'cost', 'nearby'].some(k => query.toLowerCase().includes(k));
    
    if (isFollowUp && history.length > 0) {
      // Find the last assistant message that mentioned a hotel
      const lastAssistantMessage = [...history].reverse().find(m => m.role === 'assistant' && m.content.includes("Marriott"));
      if (lastAssistantMessage) {
         // Try to find hotels based on the last context
         // For POC, we'll just search for hotels again but with a broader context if needed
         hotels = await hotelsAgent.searchHotels(query);
         if (hotels.length === 0) {
           // Fallback: use the previously found hotels by searching for the last query
           const lastUserQuery = [...history].reverse().find(m => m.role === 'user')?.content || "";
           hotels = await hotelsAgent.searchHotels(lastUserQuery);
         }
      } else {
        hotels = await hotelsAgent.searchHotels(query);
      }
    } else {
      hotels = await hotelsAgent.searchHotels(query);
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

  private isMarriottRelated(query: string): boolean {
    const keywords = ['marriott', 'hotel', 'room', 'stay', 'booking', 'amenities', 'attraction', 'tourist', 'resort', 'bonvoy'];
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
