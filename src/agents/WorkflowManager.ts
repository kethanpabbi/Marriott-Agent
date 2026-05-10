import { UserAgent } from './UserAgent';
import { HotelsAgent } from './HotelsAgent';

const userAgent = new UserAgent();
const hotelsAgent = new HotelsAgent();

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

    // 5. Generate Response (Mocking LLM generation for the POC structure)
    const response = this.generateResponse(filteredHotels, query);

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

  private generateResponse(hotels: any[], query: string): string {
    if (hotels.length === 0) {
      return "I couldn't find any Marriott properties matching that specific request. Would you like to try searching for a different region or type of hotel?";
    }

    const hotelNames = hotels.slice(0, 3).map(h => h.name).join(", ");
    return `Certainly! Based on your interest in ${query}, I recommend checking out ${hotelNames}. These properties offer a variety of amenities and are conveniently located near popular attractions. Would you like more details on any of these?`;
  }

  private getSuggestedQuestions(query: string): string[] {
    // Logic to generate 2-3 relevant questions
    return [
      `What are the dining options at these hotels?`,
      `Are there any tourist attractions nearby?`,
      `What is the pricing for a standard room?`
    ];
  }
}
