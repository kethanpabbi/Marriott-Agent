const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const hotels = [
  {
    name: "Moxy Dublin City",
    location: "Dublin",
    priceRange: "€266+",
    description: "Located in Dublin's city centre with small but smart rooms, check-in at the bar, 24/7 food & more.",
    amenities: "Bar, 24/7 Food, Smart Rooms, WiFi",
    restaurants: "Moxy Bar & 24/7 Food",
    activities: "Temple Bar nightlife, Shopping",
    rating: 3.9,
    region: "City Centre"
  },
  {
    name: "The College Green Hotel Dublin, Autograph Collection",
    location: "Dublin",
    priceRange: "€736+",
    description: "The College Green Hotel Dublin, formerly The Westin Dublin, centrally located, 5-star service.",
    amenities: "5-star, Luxury, Spa, Fine Dining",
    restaurants: "Morelands Grill, The Atrium Lounge",
    activities: "Trinity College, Grafton Street",
    rating: 4.5,
    region: "City Centre"
  },
  {
    name: "The Shelbourne, Autograph Collection",
    location: "Dublin",
    priceRange: "€669+",
    description: "A historic hotel in Dublin city centre, with 5-star service and award-winning dining.",
    amenities: "Historic, 5-star, Award-winning Dining, Afternoon Tea",
    restaurants: "The Saddle Room, 1824 Bar",
    activities: "St. Stephens Green, Museums",
    rating: 4.5,
    region: "City Centre"
  },
  {
    name: "citizenM Dublin St. Patricks",
    location: "Dublin",
    priceRange: "€180+",
    description: "Bold design, XL beds and 24/7 food beside Dublin’s most iconic cathedral & 10 mins from Temple Bar",
    amenities: "Bold Design, XL Beds, 24/7 Food, Rooftop",
    restaurants: "canteenM",
    activities: "St. Patricks Cathedral, Christchurch",
    rating: 4.5,
    region: "City Centre"
  },
  {
    name: "Aloft by Marriott Dublin City",
    location: "Dublin",
    priceRange: "€220+",
    description: "Contemporary hotel with urban-inspired hotel rooms, 4-star amenities and an historic Dublin location",
    amenities: "Contemporary, Urban Design, Bar, Fitness Center",
    restaurants: "Tenters Gastropub, W XYZ Bar",
    activities: "Guinness Storehouse, Teeling Distillery",
    rating: 4.4,
    region: "Liberties"
  },
  {
    name: "Moxy Dublin Docklands",
    location: "Dublin",
    priceRange: "€200+",
    description: "Go chic, go Moxy! Stylish hotel in the vibrant Docklands area.",
    amenities: "Chic, Bar, Tech-forward, Docklands",
    restaurants: "Moxy Bar",
    activities: "EPIC Museum, Bord Gais Energy Theatre",
    rating: 4.4,
    region: "Docklands"
  },
  {
    name: "Powerscourt Hotel, Autograph Collection",
    location: "Dublin (Wicklow)",
    priceRange: "€450+",
    description: "5-star resort with luxury rooms, two golf courses, a spa and an idilic location near Dublin.",
    amenities: "Resort, Golf, Spa, Luxury, Wicklow Mountains",
    restaurants: "Sika Restaurant, Sugar Loaf Lounge",
    activities: "Golfing, Hiking, Powerscourt Estate",
    rating: 4.4,
    region: "Co. Wicklow"
  }
];

async function seed() {
  try {
    for (const h of hotels) {
      await prisma.hotel.upsert({
        where: { name: h.name },
        update: h,
        create: h
      });
    }
    console.log(`✅ Successfully seeded ${hotels.length} verified properties into the database.`);
  } catch (e) {
    console.error("❌ Seeding failed:", e);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
