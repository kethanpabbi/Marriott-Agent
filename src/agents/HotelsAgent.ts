import { PrismaClient, Hotel } from '@prisma/client';

const prisma = new PrismaClient();

export class HotelsAgent {
  /**
   * Searches for hotels based on region or specific criteria.
   */
  async searchHotels(query: string, filters?: { region?: string; priceMax?: number }): Promise<Hotel[]> {
    const cleanedQuery = query.toLowerCase()
      .replace("find a hotel in ", "")
      .replace("marriott in ", "")
      .replace("show me ", "")
      .trim();

    return await prisma.hotel.findMany({
      where: {
        ...(cleanedQuery ? {
          OR: [
            { name: { contains: cleanedQuery } },
            { location: { contains: cleanedQuery } },
            { region: { contains: cleanedQuery } },
            { description: { contains: cleanedQuery } },
          ]
        } : {}),
        status: { not: "Closed" },
      },
      include: {
        nearbyAttractions: true,
      },
    }) as any;
  }

  /**
   * Checks for data inconsistencies in hotel properties.
   */
  async flagInconsistencies(): Promise<string[]> {
    const hotels = await prisma.hotel.findMany();
    const flags: string[] = [];

    for (const hotel of hotels) {
      // Example check: suspicious price (simulated here since price is string in schema for simplicity)
      if (hotel.priceRange.includes("$1") && !hotel.priceRange.includes("$100")) {
        flags.push(`Inconsistent pricing at ${hotel.name}: ${hotel.priceRange}`);
      }

      // Check for outdated info (e.g., not updated in 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (hotel.lastUpdated < thirtyDaysAgo) {
        flags.push(`${hotel.name} data is stale. Last updated: ${hotel.lastUpdated}`);
      }
    }

    return flags;
  }

  /**
   * Retrieves tourist attractions near a specific hotel.
   */
  async getNearbyAttractions(hotelId: string) {
    return await prisma.attraction.findMany({
      where: { hotelId },
    });
  }

  /**
   * Syncs a location's data from Marriott's site using Firecrawl.
   */
  async syncLocation(location: string, scraper: any) {
    console.log(`🚀 Syncing data for ${location} via Firecrawl...`);
    
    // In a real app, we'd search Marriott.com/hotel-search/ for the location
    // For this POC, we'll simulate the extraction of a few real properties for the requested location
    
    const mockRealData: Record<string, any[]> = {
      'london': [
        { name: "London Marriott Hotel County Hall", location: "Westminster Bridge Rd, London", priceRange: "$450 - $1,300", description: "Historic hotel with views of Big Ben.", amenities: "Pool, Steakhouse, Lounge", restaurants: "Gillray's", activities: "Thames Walks", region: "Europe" },
        { name: "St. Pancras Renaissance Hotel London", location: "Euston Rd, London", priceRange: "$500 - $1,800", description: "Iconic Victorian masterpiece.", amenities: "Spa, Fine Dining", restaurants: "The Gilbert Scott", activities: "Train Tours", region: "Europe" }
      ],
      'hawaii': [
        { name: "The Royal Hawaiian, a Luxury Collection Resort", location: "Waikiki, Honolulu", priceRange: "$700 - $2,500", description: "The iconic Pink Palace of the Pacific.", amenities: "Private Beach, Spa", restaurants: "Azure", activities: "Surfing, Luau", region: "Hawaii" },
        { name: "Westin Hapuna Beach Resort", location: "Kohala Coast, Big Island", priceRange: "$600 - $1,800", description: "Voted #1 beach in the USA.", amenities: "Golf, Infinity Pool", restaurants: "Meridia", activities: "Snorkeling", region: "Hawaii" }
      ]
    };

    const properties = mockRealData[location.toLowerCase()] || [];
    
    for (const prop of properties) {
      await prisma.hotel.upsert({
        where: { name: prop.name }, // Use name as unique identifier for this simplified POC
        update: prop,
        create: prop
      });
    }

    return properties.length > 0;
  }
}
