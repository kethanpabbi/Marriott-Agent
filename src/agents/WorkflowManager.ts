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

    // 3. User Context Retrieval
    const user = await userAgent.getOrCreateUser(email);

    // 4. Hotel Retrieval & Filtering
    const hotels = await hotelsAgent.searchHotels(query);
    
    // Filter by user dislikes (e.g., if user dislikes "beaches")
    const filteredHotels = hotels.filter(h => {
      return !user.dislikes.some(dislike => 
        h.description.toLowerCase().includes(dislike.toLowerCase()) || 
        h.amenities.toLowerCase().includes(dislike.toLowerCase())
      );
    });

    // 5. Generate Response using LLM
    const response = await this.generateAIResponse(filteredHotels, query, user);

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

  private async generateAIResponse(hotels: any[], query: string, user: any): Promise<string> {
    if (hotels.length === 0) {
      return "I couldn't find any Marriott properties matching that specific request. Would you like to try searching for a different region or type of hotel?";
    }

    const context = `
      User Likes: ${user.likes.join(', ')}
      Recommended Hotels: ${hotels.slice(0, 3).map(h => `${h.name} in ${h.location}`).join('; ')}
      User Query: ${query}
    `;

    return await llmService.generateResponse([
      { role: 'system', content: "You are Marriott Lumina. Use the provided context to recommend hotels. Be concise and luxury-oriented." },
      { role: 'user', content: context }
    ]);
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
