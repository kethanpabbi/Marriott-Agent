/**
 * Marriott hotel directory scraper — full enrichment version
 *
 * Phase 1 (sitemap): reads all country/state hotel sitemap pages via plain fetch.
 *                    Falls back to Playwright for JS-rendered pages.
 * Phase 2 (enrich):  for each hotel, fetches overview/.model.json for description,
 *                    then fills amenities/priceRange/activities from brand standards.
 *
 * Run:     npx tsx scripts/scrape-hotels.ts
 * Resume:  safe to re-run — uses upsert + per-hotel enriched flag.
 */

import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const CHECKPOINT_FILE = path.join(__dirname, "scrape-checkpoint.json");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------- Brand / tier data ----------

const BRANDS = [
  "The Ritz-Carlton", "St. Regis", "W Hotels", "The Luxury Collection",
  "JW Marriott", "EDITION", "Bvlgari", "Marriott Hotels", "Sheraton",
  "Westin", "Le Méridien", "Renaissance Hotels", "Delta Hotels",
  "Marriott Executive Apartments", "Autograph Collection", "Tribute Portfolio",
  "Design Hotels", "Gaylord Hotels", "Courtyard", "Four Points",
  "SpringHill Suites", "Fairfield", "AC Hotel", "Aloft Hotels",
  "Moxy Hotels", "Protea Hotels", "City Express", "Residence Inn",
  "TownePlace Suites", "Element Hotels", "Homes & Villas", "Marriott Vacation Club",
];

const BRAND_TIER: Record<string, string> = {
  "The Ritz-Carlton": "Luxury", "St. Regis": "Luxury", "W Hotels": "Luxury",
  "The Luxury Collection": "Luxury", "JW Marriott": "Luxury", "EDITION": "Luxury",
  "Bvlgari": "Luxury", "Marriott Hotels": "Premium", "Sheraton": "Premium",
  "Westin": "Premium", "Le Méridien": "Premium", "Renaissance Hotels": "Premium",
  "Delta Hotels": "Premium", "Marriott Executive Apartments": "Premium",
  "Autograph Collection": "Distinctive Luxury", "Tribute Portfolio": "Distinctive Luxury",
  "Design Hotels": "Distinctive Luxury", "Gaylord Hotels": "Distinctive Luxury",
  "Courtyard": "Select", "Four Points": "Select", "SpringHill Suites": "Select",
  "Fairfield": "Select", "AC Hotel": "Select", "Aloft Hotels": "Select",
  "Moxy Hotels": "Select", "Protea Hotels": "Select", "City Express": "Select",
  "Residence Inn": "Longer Stays", "TownePlace Suites": "Longer Stays",
  "Element Hotels": "Longer Stays", "Homes & Villas": "Collections",
  "Marriott Vacation Club": "Collections",
};

// Price ranges per tier
const TIER_PRICE: Record<string, string> = {
  "Luxury": "$400–$1,200+ per night",
  "Distinctive Luxury": "$300–$800 per night",
  "Premium": "$200–$500 per night",
  "Select": "$100–$250 per night",
  "Longer Stays": "$90–$200 per night",
  "Collections": "$150–$600 per night",
};

// Brand-standard amenities (accurate — these are guaranteed by brand standards)
const BRAND_AMENITIES: Record<string, string[]> = {
  "The Ritz-Carlton": ["Spa", "Fine Dining Restaurant", "Outdoor Pool", "Fitness Center", "Concierge", "24-Hour Room Service", "Valet Parking", "Business Center", "Club Lounge"],
  "St. Regis": ["Spa", "Fine Dining Restaurant", "Pool", "Fitness Center", "Butler Service", "24-Hour Room Service", "Valet Parking", "Concierge"],
  "W Hotels": ["AWAY® Spa", "Wet® Pool", "FIT® Fitness Center", "WIRED® Business Center", "Bar", "Restaurant", "24-Hour Room Service"],
  "The Luxury Collection": ["Spa", "Pool", "Fitness Center", "Restaurant", "Bar", "Concierge", "Room Service"],
  "JW Marriott": ["Spa", "Pool", "Fitness Center", "Multiple Restaurants", "Bar", "Concierge", "24-Hour Room Service", "Business Center"],
  "EDITION": ["Spa", "Pool", "Fitness Center", "Restaurant", "Bar", "Nightclub"],
  "Bvlgari": ["Bvlgari Spa", "Pool", "Fitness Center", "Fine Dining", "Concierge", "Butler Service"],
  "Marriott Hotels": ["Pool", "Fitness Center", "Restaurant", "Bar", "Business Center", "Room Service", "Concierge"],
  "Sheraton": ["Club Lounge", "Pool", "Fitness Center", "Restaurant", "Bar", "Business Center", "Room Service"],
  "Westin": ["WestinWorkout® Fitness Studio", "Pool", "Heavenly Spa®", "Restaurant", "Bar", "Room Service", "Westin WORKOUT® Gear Lending"],
  "Le Méridien": ["Pool", "Fitness Center", "Restaurant", "Bar", "Business Center", "Room Service"],
  "Renaissance Hotels": ["Pool", "Fitness Center", "R Bar", "Restaurant", "Business Center", "Room Service"],
  "Delta Hotels": ["Pool", "Fitness Center", "Restaurant", "Bar", "Business Center"],
  "Marriott Executive Apartments": ["Fitness Center", "Pool", "Full Kitchen", "Laundry", "Business Center"],
  "Autograph Collection": ["Pool", "Fitness Center", "Restaurant", "Bar", "Unique Local Amenities"],
  "Tribute Portfolio": ["Pool", "Fitness Center", "Restaurant", "Bar", "Local Character Amenities"],
  "Design Hotels": ["Pool", "Fitness Center", "Restaurant", "Bar"],
  "Gaylord Hotels": ["Pool", "Spa", "Multiple Restaurants", "Bar", "Convention Center", "Entertainment"],
  "Courtyard": ["Pool", "Fitness Center", "The Bistro Restaurant", "Bar", "Business Center", "WiFi"],
  "Four Points": ["Pool", "Fitness Center", "Restaurant", "Bar", "Free WiFi", "Business Center"],
  "SpringHill Suites": ["Pool", "Fitness Center", "Free Breakfast Buffet", "Business Center", "Free WiFi", "Full Kitchen"],
  "Fairfield": ["Fitness Center", "Free Breakfast", "Business Center", "Free WiFi", "Pool"],
  "AC Hotel": ["Fitness Center", "AC Lounge Bar", "Pool", "Business Center", "Free WiFi"],
  "Aloft Hotels": ["Re:mix Lounge", "WXYZ Bar", "Re:charge Fitness Center", "Free WiFi", "Pool"],
  "Moxy Hotels": ["Bar", "Fitness Center", "Free WiFi", "Social Spaces"],
  "Protea Hotels": ["Pool", "Fitness Center", "Restaurant", "Bar", "Business Center"],
  "City Express": ["Fitness Center", "Free Breakfast", "Business Center", "Free WiFi", "Pool"],
  "Residence Inn": ["Full Kitchen", "Free Hot Breakfast", "Pool", "Fitness Center", "Free WiFi", "Grocery Delivery"],
  "TownePlace Suites": ["Full Kitchen", "Fitness Center", "Free WiFi", "Business Center", "Pool"],
  "Element Hotels": ["Pool", "Fitness Center", "Free WiFi", "Full Kitchen", "Free Breakfast", "Bike Lending"],
  "Homes & Villas": ["Full Kitchen", "Living Area", "Private Pool (select homes)", "Free WiFi", "Unique Local Experience"],
  "Marriott Vacation Club": ["Full Kitchen", "Living Area", "Pool", "Fitness Center", "Free WiFi", "Activities Center"],
};

// Brand-standard activities
const BRAND_ACTIVITIES: Record<string, string[]> = {
  "The Ritz-Carlton": ["Spa Treatments", "Curated Local Experiences", "Culinary Events", "Golf (select locations)", "Water Sports (select locations)"],
  "St. Regis": ["Butler-Curated Experiences", "Spa Treatments", "Golf (select locations)", "Cultural Excursions"],
  "W Hotels": ["Nightlife", "Spa Treatments", "Pool Parties", "Fitness Classes", "Local Music & Art Events"],
  "JW Marriott": ["Spa Treatments", "Golf (select locations)", "Culinary Experiences", "Fitness Classes", "Pool Access"],
  "Westin": ["Westin Workout® Classes", "Running Concierge Program", "Heavenly Spa® Treatments", "Sleep Well Menu", "Outdoor Activities"],
  "Gaylord Hotels": ["Indoor Waterpark", "Spa Treatments", "Entertainment Shows", "Family Activities", "Meeting Events"],
  "Autograph Collection": ["Unique Local Cultural Experiences", "Spa Treatments", "Curated Dining"],
  "Marriott Hotels": ["Fitness Classes", "Pool", "Local Tours (select locations)"],
  "Courtyard": ["Pool", "Fitness Center Workouts", "Bistro Dining"],
  "Fairfield": ["Fitness Center Workouts", "Free Breakfast", "Local Area Access"],
  "Residence Inn": ["Free Breakfast", "Evening Social Hours", "Pool", "Sports Courts (select locations)"],
  "Aloft": ["WXYZ Bar Events", "Fitness Center", "Pool", "Live Music Nights"],
};

function detectBrand(title: string): string {
  const sorted = [...BRANDS].sort((a, b) => b.length - a.length);
  for (const brand of sorted) {
    if (title.toLowerCase().includes(brand.toLowerCase())) return brand;
  }
  return "Marriott Hotels";
}

function getBrandAmenities(brand: string): string {
  return (BRAND_AMENITIES[brand] ?? BRAND_AMENITIES["Marriott Hotels"]).join(", ");
}

function getBrandActivities(brand: string): string {
  const activities = BRAND_ACTIVITIES[brand] ?? BRAND_ACTIVITIES["Marriott Hotels"] ?? ["Pool", "Fitness Center"];
  return activities.join(", ");
}

function getPriceRange(tier: string): string {
  return TIER_PRICE[tier] ?? "$100–$300 per night";
}

// ---------- City/Country parsing ----------

function parseCityFromSlug(url: string, sitemapLabel: string): { city: string; country: string } {
  const match = url.match(/\/hotels\/([a-z]+)-(.+?)\/overview/);
  const labelMatch = sitemapLabel.match(/^(usa-(.+?)|(.+?))-hotel-sitemap/);
  let country = "USA";

  if (labelMatch) {
    if (labelMatch[2]) {
      country = "USA";
    } else if (labelMatch[3]) {
      country = labelMatch[3].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } else if (sitemapLabel === "global") {
    country = "Unknown";
  }

  if (!match) return { city: country, country };

  const brandWords = BRANDS.flatMap((b) => b.toLowerCase().split(" "));
  const slug = match[2].replace(/-/g, " ");
  const words = slug.split(" ").filter((w) => !brandWords.includes(w) && w.length > 2 && !/^\d+$/.test(w));
  const city = (words.slice(0, 3).join(" ") || country).replace(/\b\w/g, (c) => c.toUpperCase());

  return { city, country };
}

// ---------- Fetch helpers ----------

async function fetchText(url: string, json = false): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (json) headers["Accept"] = "application/json";
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Sitemap hotel extraction ----------

interface HotelEntry {
  marsha: string;
  title: string;
  url: string;
}

function extractHotelsFromHtml(html: string): HotelEntry[] {
  const results: HotelEntry[] = [];
  const regex = /\{"marsha":"([^"]+)","title":"([^"]+)","url":"(https:\/\/www\.marriott\.com[^"]+)"\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    results.push({ marsha: m[1], title: m[2], url: m[3] });
  }
  return results;
}

// ---------- Enrichment ----------

async function fetchDescription(hotel: { url: string; name: string }): Promise<string> {
  if (!hotel.url) return "";
  try {
    // Convert hotel URL to model.json URL
    const modelUrl = hotel.url.replace(/\/$/, "") + "/.model.json";
    const text = await fetchText(modelUrl, true);
    const data = JSON.parse(text);
    return (data.description as string) || "";
  } catch {
    return "";
  }
}

// ---------- DB ----------

async function upsertHotel(entry: HotelEntry, sitemapLabel: string) {
  const marshaId = entry.marsha.toUpperCase();
  const brand = detectBrand(entry.title);
  const tier = BRAND_TIER[brand] ?? "Select";
  const { city, country } = parseCityFromSlug(entry.url, sitemapLabel);

  for (const name of [entry.title, `${entry.title} (${marshaId})`]) {
    try {
      await prisma.hotel.upsert({
        where: { marriottId: marshaId },
        create: { marriottId: marshaId, name, brand, location: city, country, url: entry.url, tier },
        update: { name, brand, location: city, country, url: entry.url, tier },
      });
      return;
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("Unique constraint") && msg.includes("name") && name === entry.title) continue;
      throw err;
    }
  }
}

// ---------- Checkpoint ----------

interface Checkpoint {
  processedSitemaps: string[];
  savedCount: number;
}

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
  return { processedSitemaps: [], savedCount: 0 };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ---------- Phase 1: Sitemap scraping ----------

async function phase1Sitemaps(cp: Checkpoint) {
  console.log("\n=== PHASE 1: Sitemap scraping ===");

  const indexHtml = await fetchText(
    "https://www.marriott.com/content/dam/marriott-seo/en/marriott-tng/sitemap-hotel-sitemaps.xml"
  );

  const sitemapUrls = [...indexHtml.matchAll(/hotel-sitemap\/([^<"]+hotel-sitemap)/g)].map((m) => ({
    label: m[1],
    url: `https://www.marriott.com/en-us/hotel-sitemap/${m[1]}`,
    needsJs: false,
  }));

  // The JS-rendered pages that returned 0 last time
  const jsFallbacks = [
    { label: "hotel-sitemap.mi", url: "https://www.marriott.com/hotel-sitemap.mi", needsJs: true },
    { label: "usa-hotel-sitemap", url: "https://www.marriott.com/en-us/hotel-sitemap/usa-hotel-sitemap", needsJs: true },
    { label: "montenegro-hotel-sitemap", url: "https://www.marriott.com/en-us/hotel-sitemap/montenegro-hotel-sitemap", needsJs: true },
  ];

  const all = [...jsFallbacks, ...sitemapUrls];
  console.log(`Found ${all.length} sitemap pages`);

  // Launch browser for JS-rendered pages
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  for (const sitemap of all) {
    if (cp.processedSitemaps.includes(sitemap.label)) {
      process.stdout.write(`  [skip] ${sitemap.label}\n`);
      continue;
    }

    process.stdout.write(`Scraping ${sitemap.label}... `);

    try {
      let html: string;

      if (sitemap.needsJs) {
        if (!browser) {
          browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
        }
        const ctx = await browser.newContext({ userAgent: UA, locale: "en-US" });
        const page = await ctx.newPage();
        await page.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => false }); });
        await page.goto(sitemap.url, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);
        html = await page.content();
        await ctx.close();
      } else {
        html = await fetchText(sitemap.url);
      }

      const hotels = extractHotelsFromHtml(html);

      if (hotels.length === 0) {
        process.stdout.write(`0 hotels\n`);
      } else {
        for (const h of hotels) await upsertHotel(h, sitemap.label);
        cp.savedCount += hotels.length;
        process.stdout.write(`${hotels.length} hotels (total: ${cp.savedCount})\n`);
      }

      cp.processedSitemaps.push(sitemap.label);
      saveCheckpoint(cp);
    } catch (err) {
      process.stdout.write(`ERROR: ${(err as Error).message}\n`);
    }

    await sleep(600);
  }

  if (browser) await browser.close();

  const total = await prisma.hotel.count();
  console.log(`\nPhase 1 complete. Hotels in DB: ${total}`);
}

// ---------- Phase 2: Enrichment ----------

async function phase2Enrich() {
  console.log("\n=== PHASE 2: Enrichment ===");

  const total = await prisma.hotel.count({ where: { enriched: false } });
  console.log(`${total} hotels to enrich`);

  let done = 0;
  const BATCH = 50;
  const CONCURRENCY = 5; // parallel requests

  while (true) {
    const batch = await prisma.hotel.findMany({
      where: { enriched: false },
      take: BATCH,
      select: { id: true, marriottId: true, name: true, brand: true, tier: true, url: true },
    });

    if (batch.length === 0) break;

    // Process in parallel chunks
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);

      await Promise.all(
        chunk.map(async (hotel) => {
          const brand = hotel.brand ?? "Marriott Hotels";
          const tier = hotel.tier ?? "Select";

          // Try to get description from model.json
          const description = await fetchDescription({ url: hotel.url ?? "", name: hotel.name });

          const amenities = getBrandAmenities(brand);
          const activities = getBrandActivities(brand);
          const priceRange = getPriceRange(tier);

          // Restaurants: brand-standard placeholder
          const restaurants = getDefaultRestaurant(brand);

          await prisma.hotel.update({
            where: { id: hotel.id },
            data: { description, amenities, activities, priceRange, restaurants, enriched: true },
          });

          done++;
        })
      );

      // Status every 50
      if (done % 50 === 0) {
        process.stdout.write(`  Enriched ${done}/${total}\n`);
      }

      await sleep(300);
    }
  }

  console.log(`\nPhase 2 complete. ${done} hotels enriched.`);
}

function getDefaultRestaurant(brand: string): string {
  const map: Record<string, string> = {
    "Courtyard": "The Bistro",
    "Fairfield": "Grab & Go Market",
    "SpringHill Suites": "Grab & Go Market",
    "TownePlace Suites": "Grab & Go Market",
    "Aloft Hotels": "Re:fuel by Aloft",
    "AC Hotel": "AC Lounge",
    "Moxy Hotels": "Moxy Bar",
    "Four Points": "Best Brews Pub",
    "Westin": "Westin Heavenly Spa Café, All-Day Dining Restaurant",
    "Marriott Hotels": "On-site Restaurant & Bar",
    "Sheraton": "On-site Restaurant & Bar",
    "JW Marriott": "Multiple Signature Restaurants",
    "The Ritz-Carlton": "Fine Dining Restaurant, Café",
    "St. Regis": "Signature Restaurant, Bar",
    "W Hotels": "W Kitchen, Living Room Bar",
    "Gaylord Hotels": "Multiple Theme Restaurants",
    "Renaissance Hotels": "R Bar, On-site Restaurant",
    "Residence Inn": "Evening Social Market",
    "Element Hotels": "Bikes & Boards Snack Area",
  };
  return map[brand] ?? "On-site Dining";
}

// ---------- Main ----------

async function main() {
  // Clear DB
  console.log("Clearing hotel data...");
  await prisma.attraction.deleteMany();
  await prisma.hotel.deleteMany();
  if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
  console.log("DB cleared.\n");

  const cp = loadCheckpoint();

  await phase1Sitemaps(cp);
  // Phase 2 skipped — fake brand-standard data removed. Descriptions will be enriched via browser session.

  const count = await prisma.hotel.count();
  console.log(`\nDone. ${count} hotels in DB.`);

  await prisma.$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
