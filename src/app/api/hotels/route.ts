import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BRAND_CODE_MAP: Record<string, string> = {
  LC: 'The Luxury Collection', MC: 'Marriott Hotels', SI: 'Sheraton',
  WI: 'W Hotels', RZ: 'The Ritz-Carlton', JW: 'JW Marriott',
  EB: 'EDITION', BU: 'Bvlgari', MD: 'Westin', LE: 'Le Méridien',
  BR: 'Renaissance Hotels', DE: 'Delta Hotels', EA: 'Marriott Executive Apartments',
  AR: 'Autograph Collection', TX: 'Tribute Portfolio', VS: 'Design Hotels',
  GE: 'Gaylord Hotels', CY: 'Courtyard', FP: 'Four Points',
  SHS: 'SpringHill Suites', FI: 'Fairfield', AC: 'AC Hotels',
  AL: 'Aloft Hotels', OX: 'Moxy Hotels', PR: 'Protea Hotels',
  CX: 'City Express', RI: 'Residence Inn', TS: 'TownePlace Suites',
  EL: 'Element Hotels', HV: 'Homes & Villas', MVC: 'Marriott Vacation Club',
};

const BRAND_TIER: Record<string, string> = {
  'The Luxury Collection': 'Luxury', 'The Ritz-Carlton': 'Luxury', 'W Hotels': 'Luxury',
  'JW Marriott': 'Luxury', 'EDITION': 'Luxury', 'Bvlgari': 'Luxury',
  'Marriott Hotels': 'Premium', 'Sheraton': 'Premium', 'Westin': 'Premium',
  'Le Méridien': 'Premium', 'Renaissance Hotels': 'Premium', 'Delta Hotels': 'Premium',
  'Marriott Executive Apartments': 'Premium', 'Autograph Collection': 'Distinctive Luxury',
  'Tribute Portfolio': 'Distinctive Luxury', 'Design Hotels': 'Distinctive Luxury',
  'Gaylord Hotels': 'Distinctive Luxury', 'Courtyard': 'Select', 'Four Points': 'Select',
  'SpringHill Suites': 'Select', 'Fairfield': 'Select', 'AC Hotels': 'Select',
  'Aloft Hotels': 'Select', 'Moxy Hotels': 'Select', 'Protea Hotels': 'Select',
  'City Express': 'Select', 'Residence Inn': 'Longer Stays', 'TownePlace Suites': 'Longer Stays',
  'Element Hotels': 'Longer Stays', 'Homes & Villas': 'Collections',
  'Marriott Vacation Club': 'Collections',
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const hotels: Array<{
      marsha: string;
      brandCode: string;
      name: string;
      rating: number | null;
      description: string;
      country: string;
      reviewsUrl: string | null;
      lat: number | null;
      lng: number | null;
    }> = body.hotels;

    if (!Array.isArray(hotels) || hotels.length === 0) {
      return NextResponse.json({ error: 'No hotels provided' }, { status: 400 });
    }

    let saved = 0;
    for (const h of hotels) {
      const brand = BRAND_CODE_MAP[h.brandCode] ?? 'Marriott Hotels';
      const tier = BRAND_TIER[brand] ?? 'Select';
      const url = h.reviewsUrl ? h.reviewsUrl.replace('/reviews/', '/overview/').replace('/en-US/', '/en-us/') : null;

      // Parse city from hotel name (last comma-separated part before country)
      const nameParts = h.name.split(',');
      const city = nameParts.length > 1 ? nameParts[nameParts.length - 1].trim() : h.country;

      try {
        await prisma.hotel.upsert({
          where: { marriottId: h.marsha.toUpperCase() },
          create: {
            marriottId: h.marsha.toUpperCase(),
            name: h.name,
            brand,
            tier,
            location: city,
            country: h.country,
            url,
            description: h.description ?? '',
            rating: h.rating ?? 0,
            enriched: true,
          },
          update: {
            name: h.name,
            brand,
            tier,
            location: city,
            country: h.country,
            url,
            description: h.description ?? '',
            rating: h.rating ?? 0,
            enriched: true,
          },
        });
        saved++;
      } catch {
        // name collision — append marsha
        try {
          await prisma.hotel.upsert({
            where: { marriottId: h.marsha.toUpperCase() },
            create: {
              marriottId: h.marsha.toUpperCase(),
              name: `${h.name} (${h.marsha.toUpperCase()})`,
              brand, tier, location: city, country: h.country, url,
              description: h.description ?? '', rating: h.rating ?? 0, enriched: true,
            },
            update: {
              name: `${h.name} (${h.marsha.toUpperCase()})`,
              brand, tier, location: city, country: h.country, url,
              description: h.description ?? '', rating: h.rating ?? 0, enriched: true,
            },
          });
          saved++;
        } catch { /* skip */ }
      }
    }

    return NextResponse.json({ saved, total: hotels.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  await prisma.attraction.deleteMany();
  await prisma.hotel.deleteMany();
  return NextResponse.json({ cleared: true });
}

export async function GET() {
  const count = await prisma.hotel.count();
  return NextResponse.json({ count });
}
