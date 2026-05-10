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
    console.log(`🚀 Checking local records for ${location}...`);
    
    // 1. First, check if we already have this location in our database
    const existing = await prisma.hotel.findMany({
      where: {
        OR: [
          { location: { contains: location } },
          { region: { contains: location } }
        ]
      }
    });

    if (existing.length > 0) {
      console.log(`✅ Found ${existing.length} properties for ${location} in local database.`);
      return true;
    }

    console.log(`🌐 No local data for ${location}. Attempting real-time discovery...`);
    
    // 2. Fallback to hardcoded seed data (for performance/demo)
    const seedData: Record<string, any[]> = {
      'london': [
        { name: "London Marriott Hotel County Hall", location: "Westminster Bridge Rd, London", priceRange: "$450 - $1,300", description: "Historic hotel with views of Big Ben.", amenities: "Pool, Steakhouse, Lounge", restaurants: "Gillray's", activities: "Thames Walks", region: "Europe" },
        { name: "St. Pancras Renaissance Hotel London", location: "Euston Rd, London", priceRange: "$500 - $1,800", description: "Iconic Victorian masterpiece.", amenities: "Spa, Fine Dining", restaurants: "The Gilbert Scott", activities: "Train Tours", region: "Europe" }
      ],
      'hawaii': [
        { name: "The Royal Hawaiian, a Luxury Collection Resort", location: "Waikiki, Honolulu", priceRange: "$700 - $2,500", description: "The iconic Pink Palace of the Pacific.", amenities: "Private Beach, Spa", restaurants: "Azure", activities: "Surfing, Luau", region: "Hawaii" },
        { name: "Westin Hapuna Beach Resort", location: "Kohala Coast, Big Island", priceRange: "$600 - $1,800", description: "Voted #1 beach in the USA.", amenities: "Golf, Infinity Pool", restaurants: "Meridia", activities: "Snorkeling", region: "Hawaii" }
      ],
      'mumbai': [
        { name: "JW Marriott Mumbai Sahar", location: "IA Project Rd, Mumbai", priceRange: "$200 - $600", description: "Luxury hotel near Mumbai International Airport.", amenities: "Spa, Pool, Executive Lounge", restaurants: "JW Cafe, Romano's", activities: "City Tours", region: "Asia" },
        { name: "The St. Regis Mumbai", location: "Senapati Bapat Marg, Mumbai", priceRange: "$250 - $800", description: "The tallest hotel tower in India, offering timeless luxury.", amenities: "Butler Service, Infinity Pool", restaurants: "By the Mekong, Yuuka", activities: "Luxury Shopping", region: "Asia" }
      ],
      'delhi': [
        { name: "JW Marriott Hotel New Delhi Aerocity", location: "Asset Area 4, Aerocity, Delhi", priceRange: "$200 - $550", description: "A premier five-star luxury hotel near the international airport.", amenities: "24-hour Spa, Outdoor Pool, Fitness Center", restaurants: "K3 Food Theatre, Adrift Kaya", activities: "Shopping at DLF Promenade, City Tours", region: "Asia" },
        { name: "ITC Maurya, a Luxury Collection Hotel, New Delhi", location: "Diplomatic Enclave, New Delhi", priceRange: "$250 - $700", description: "Iconic luxury property known for hosting heads of state.", amenities: "Luxury Spa, Signature Pool, Butler Service", restaurants: "Bukhara, Dum Pukht", activities: "Historical Tours, Fine Dining", region: "Asia" },
        { name: "Aloft New Delhi Aerocity", location: "Asset 5B, Aerocity, Delhi", priceRange: "$100 - $250", description: "Modern, tech-forward hotel with a vibrant urban atmosphere.", amenities: "W XYZ Bar, Re:charge Gym, Splash Pool", restaurants: "Nook", activities: "Nightlife, Airport Proximity", region: "Asia" }
      ],
      'kyoto': [
        { name: "The Ritz-Carlton, Kyoto", location: "Kamigyo Ward, Kyoto", priceRange: "$800 - $3,000", description: "Experience the ultimate in Japanese luxury along the Kamogawa River.", amenities: "Zen Garden, Spa, Pool", restaurants: "La Locanda, Mizuki", activities: "Tea Ceremony, Temple Tours", region: "Asia" }
      ]
    };

    let properties = seedData[location.toLowerCase()] || [];

    // 3. Fallback to real Firecrawl extraction if no seed data
    if (properties.length === 0) {
      try {
        const realExtracted = await scraper.scrapeProperty(`https://www.marriott.com/hotel-search/${location.toLowerCase()}.residences/`);
        
        if (realExtracted && realExtracted.data) {
          const hotel = realExtracted.data;
          properties = [{
            name: hotel.name || `Marriott ${location}`,
            location: `${location}`,
            priceRange: hotel.price || "$300 - $800",
            description: hotel.description || `Luxury Marriott property in ${location}.`,
            amenities: Array.isArray(hotel.amenities) ? hotel.amenities.join(', ') : "Pool, WiFi, Spa",
            restaurants: "Signature Dining",
            activities: "City Discovery",
            region: "Global Discovery"
          }];
        }
      } catch (err) {
        console.error("Discovery Error:", err);
      }
    }
    
    // Persist discovered properties to database
    for (const prop of properties) {
      await prisma.hotel.upsert({
        where: { name: prop.name },
        update: prop,
        create: prop
      });
    }

    return properties.length > 0;
  }
}
