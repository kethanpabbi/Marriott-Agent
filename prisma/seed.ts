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
      name: "The St. Regis Maldives Vommuli Resort",
      location: "Dhaalu Atoll, Maldives",
      region: "Maldives",
      priceRange: "$1,500 - $5,000",
      description: "Luxury overwater villas with private pools and world-class spa.",
      amenities: "Pool, Spa, Private Beach, Butler Service",
    },
    {
      name: "JW Marriott Venice Resort & Spa",
      location: "Isola delle Rose, Venice",
      region: "Europe",
      priceRange: "$400 - $1,200",
      description: "Private island resort with spectacular views of the Venice lagoon.",
      amenities: "Rooftop Pool, Michelin-star Dining, Garden",
    },
    {
      name: "The Ritz-Carlton, Kyoto",
      location: "Kamigyo-ku, Kyoto",
      region: "Asia",
      priceRange: "$800 - $2,500",
      description: "Elegant riverside hotel blending traditional Japanese aesthetics with modern luxury.",
      amenities: "Indoor Pool, Tea House, Cultural Activities",
    },
    {
      name: "Paris Marriott Champs-Elysees Hotel",
      location: "70 Avenue des Champs-Elysees, Paris",
      region: "Europe",
      priceRange: "$500 - $1,500",
      description: "Five-star luxury on the world's most famous avenue.",
      amenities: "Fitness Center, Sauna, Terrace, Restaurant",
    },
    {
      name: "London Marriott Hotel County Hall",
      location: "Westminster Bridge Rd, London",
      region: "Europe",
      priceRange: "$450 - $1,300",
      description: "Historic hotel with views of Big Ben and the London Eye.",
      amenities: "Executive Lounge, Indoor Pool, Steakhouse",
    },
    {
      name: "Wailea Beach Resort - Marriott, Maui",
      location: "Wailea, Maui, Hawaii",
      region: "Hawaii",
      priceRange: "$600 - $2,000",
      description: "Stunning oceanfront resort in the heart of Wailea.",
      amenities: "Adventure Pool, Golf, Oceanview Dining",
    }
  ];

  for (const hotelData of hotels) {
    const hotel = await prisma.hotel.create({
      data: hotelData,
    });

    // Add a sample attraction for Kyoto
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
    // Add a sample attraction for Paris
    if (hotel.name.includes("Paris")) {
      await prisma.attraction.create({
        data: {
          name: "Arc de Triomphe",
          description: "One of the most famous monuments in Paris.",
          distance: "0.2 km",
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
