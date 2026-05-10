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

    console.log(`🌐 No local data for ${location}. Attempting autonomous discovery...`);
    
    let properties: any[] = [];

    // 2. Real-time discovery via Scraper
    try {
      const realExtracted = await scraper.scrapeProperty(`https://www.marriott.com/hotel-search/${location.toLowerCase()}.residences/`);
      const hotelData = realExtracted?.data || (realExtracted?.name ? realExtracted : null);
      
      if (hotelData) {
        properties = [{
          name: hotelData.name || `Marriott ${location}`,
          location: `${location}`,
          priceRange: hotelData.price || "$250 - $600",
          description: hotelData.description || `A premium Marriott property in ${location} discovered through autonomous search.`,
          amenities: Array.isArray(hotelData.amenities) ? hotelData.amenities.join(', ') : "Pool, WiFi, Spa, Fitness Center",
          restaurants: "Signature Marriott Dining",
          activities: `Explore the vibrant culture of ${location}`,
          region: "Global Discovery",
          rating: hotelData.rating ? parseFloat(hotelData.rating) : 4.5
        }];
      }
    } catch (err) {
      console.error("Scrape Error:", err);
    }

    // 3. NO HALLUCINATION FALLBACK
    // If the scrape fails, we return an empty list.
    if (properties.length === 0) {
      console.log(`⚠️ Discovery unsuccessful for ${location}. No hotels found.`);
      return false;
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
