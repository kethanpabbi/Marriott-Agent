import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Clear existing data
  await prisma.attraction.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.hotel.deleteMany({});

  const hotels = [
    {
      name: "St. Regis Maldives Vommuli Resort",
      location: "Vommuli Island, Dhaalu Atoll, Maldives",
      region: "Maldives",
      description: "A private island paradise with overwater villas and legendary service.",
      priceRange: "$1,500 - $5,000 per night",
      amenities: "Private Pools, Spa, Butler Service, Diving Center",
      restaurants: "Alba, Orientale, Cargo",
      activities: "Snorkeling, Sunset Cruises, Tennis",
      status: "Open",
      rating: 4.9,
    },
    {
      name: "JW Marriott Venice Resort & Spa",
      location: "Isola delle Rose, Venice, Italy",
      region: "Venice",
      description: "A luxury escape on a private island with views of the Venice skyline.",
      priceRange: "$400 - $1,200 per night",
      amenities: "Rooftop Pool, Michelin-starred Dining, Spa",
      restaurants: "Fiola at Dopolavoro, Sagra Rooftop",
      activities: "Cooking Classes, Venice Lagoon Tours",
      status: "Open",
      rating: 4.7,
    },
    {
      name: "The Ritz-Carlton, Kyoto",
      location: "Kamigyo-ku, Kyoto, Japan",
      region: "Kyoto",
      description: "A riverside oasis blending modern luxury with Japanese tradition.",
      priceRange: "$800 - $2,500 per night",
      amenities: "Traditional Tea House, Indoor Pool, Pierre Hermé Paris Pastries",
      restaurants: "Mizuki, La Locanda",
      activities: "Zen Meditation, Kimono Experience",
      status: "Open",
      rating: 4.8,
    }
  ];

  for (const hotelData of hotels) {
    const hotel = await prisma.hotel.create({
      data: hotelData,
    });

    // Add a few attractions for each
    if (hotel.name.includes("Kyoto")) {
      await prisma.attraction.create({
        data: {
          name: "Kamo River",
          description: "A beautiful river running through the heart of Kyoto.",
          distance: "0.1 km",
          hotelId: hotel.id,
        }
      });
    }
  }

  console.log('Seed data created successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
