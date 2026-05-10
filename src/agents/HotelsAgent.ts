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
        { name: "London Marriott Hotel County Hall", location: "Westminster Bridge Rd, London", priceRange: "$450 - $1,300", description: "Historic hotel with views of Big Ben.", amenities: "Pool, Steakhouse, Lounge", restaurants: "Gillray's", activities: "Thames Walks", region: "Europe", rating: 4.8 },
        { name: "St. Pancras Renaissance Hotel London", location: "Euston Rd, London", priceRange: "$500 - $1,800", description: "Iconic Victorian masterpiece.", amenities: "Spa, Fine Dining", restaurants: "The Gilbert Scott", activities: "Train Tours", region: "Europe", rating: 4.7 }
      ],
      'hawaii': [
        { name: "The Royal Hawaiian, a Luxury Collection Resort", location: "Waikiki, Honolulu", priceRange: "$700 - $2,500", description: "The iconic Pink Palace of the Pacific.", amenities: "Private Beach, Spa", restaurants: "Azure", activities: "Surfing, Luau", region: "Hawaii", rating: 4.9 },
        { name: "Westin Hapuna Beach Resort", location: "Kohala Coast, Big Island", priceRange: "$600 - $1,800", description: "Voted #1 beach in the USA.", amenities: "Golf, Infinity Pool", restaurants: "Meridia", activities: "Snorkeling", region: "Hawaii", rating: 4.6 }
      ],
      'mumbai': [
        { name: "JW Marriott Mumbai Sahar", location: "IA Project Rd, Mumbai", priceRange: "$200 - $600", description: "Luxury hotel near Mumbai International Airport.", amenities: "Spa, Pool, Executive Lounge", restaurants: "JW Cafe, Romano's", activities: "City Tours", region: "Asia", rating: 4.7 },
        { name: "The St. Regis Mumbai", location: "Senapati Bapat Marg, Mumbai", priceRange: "$250 - $800", description: "The tallest hotel tower in India, offering timeless luxury.", amenities: "Butler Service, Infinity Pool", restaurants: "By the Mekong, Yuuka", activities: "Luxury Shopping", region: "Asia", rating: 4.8 }
      ],
      'delhi': [
        { name: "JW Marriott Hotel New Delhi Aerocity", location: "Asset Area 4, Aerocity, Delhi", priceRange: "$200 - $550", description: "A premier five-star luxury hotel near the international airport.", amenities: "24-hour Spa, Outdoor Pool, Fitness Center", restaurants: "K3 Food Theatre, Adrift Kaya", activities: "Shopping at DLF Promenade, City Tours", region: "Asia", rating: 4.8 },
        { name: "Aloft New Delhi Aerocity", location: "Asset 5B, Aerocity, Delhi", priceRange: "$100 - $250", description: "Modern, tech-forward hotel with a vibrant urban atmosphere.", amenities: "W XYZ Bar, Re:charge Gym, Splash Pool", restaurants: "Nook", activities: "Nightlife, Airport Proximity", region: "Asia", rating: 4.4 }
      ],
      'bangalore': [
        { name: "JW Marriott Hotel Bengaluru", location: "Lavelle Road, Bengaluru", priceRange: "$250 - $600", description: "A five-star luxury hotel overlooking Cubbon Park.", amenities: "Spa by JW, Infinity Pool, Fitness Center", restaurants: "JW Kitchen, Alba, Spice Terrace", activities: "Cubbon Park Walks, Shopping at UB City", region: "Asia", rating: 4.8 },
        { name: "The Ritz-Carlton, Bangalore", location: "Residency Road, Bengaluru", priceRange: "$300 - $700", description: "An oasis of luxury in the heart of the city.", amenities: "Ritz-Carlton Spa, Rooftop Bar, Outdoor Pool", restaurants: "The Lantern, Bang, Market", activities: "City Discovery, Luxury Shopping", region: "Asia", rating: 4.9 },
        { name: "Sheraton Grand Bangalore Hotel at Brigade Gateway", location: "Malleswaram-Rajajinagar, Bengaluru", priceRange: "$200 - $500", description: "Modern luxury near the World Trade Center.", amenities: "Shine Spa, Infinity Pool", restaurants: "Feast, Bene", activities: "ISCKON Temple visit", region: "Asia", rating: 4.7 }
      ],
      'kyoto': [
        { name: "The Ritz-Carlton, Kyoto", location: "Kamigyo Ward, Kyoto", priceRange: "$800 - $3,000", description: "Experience the ultimate in Japanese luxury along the Kamogawa River.", amenities: "Zen Garden, Spa, Pool", restaurants: "La Locanda, Mizuki", activities: "Tea Ceremony, Temple Tours", region: "Asia", rating: 4.9 }
      ]
    };

    let properties = seedData[location.toLowerCase()] || [];

    // 3. Fallback to real Firecrawl extraction if no seed data
    if (properties.length === 0) {
      try {
        const realExtracted = await scraper.scrapeProperty(`https://www.marriott.com/hotel-search/${location.toLowerCase()}.residences/`);
        
        // Handle both Firecrawl's { data: ... } format and our mock { name: ... } format
        const hotelData = realExtracted?.data || (realExtracted?.name ? realExtracted : null);
        
        if (hotelData) {
          properties = [{
            name: hotelData.name || `Marriott ${location}`,
            location: `${location}`,
            priceRange: hotelData.price || "$300 - $800",
            description: hotelData.description || `Luxury Marriott property in ${location}.`,
            amenities: Array.isArray(hotelData.amenities) ? hotelData.amenities.join(', ') : "Pool, WiFi, Spa",
            restaurants: "Signature Dining",
            activities: "City Discovery",
            region: "Global Discovery",
            rating: hotelData.rating ? parseFloat(hotelData.rating) : 4.5
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
