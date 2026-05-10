import { PrismaClient } from '@prisma/client';
import { HotelsAgent } from '../agents/HotelsAgent';
import { ScraperService } from '../tools/ScraperService';
import { LLMService } from '../services/llm';

const prisma = new PrismaClient();
const hotelsAgent = new HotelsAgent();
const scraper = new ScraperService();
const llmService = new LLMService();

async function main() {
  console.log("🧹 Starting Global Portfolio Sanitization...");
  
  // 1. Get all current locations
  const hotels = await prisma.hotel.findMany({
    select: { location: true }
  });
  
  const locations = Array.from(new Set(hotels.map(h => h.location.toLowerCase())));
  console.log(`📍 Found ${locations.length} locations to re-sync.`);

  // 2. Clear current hotel data to remove rebrandings/fakes
  await prisma.attraction.deleteMany();
  await prisma.hotel.deleteMany();
  console.log("🗑️ Database cleared. Re-syncing with Real-Time Search...");

  // 3. Re-sync each location
  for (const loc of locations) {
    try {
      console.log(`🔄 Syncing ${loc}...`);
      await hotelsAgent.syncLocation(loc, scraper, llmService);
    } catch (err) {
      console.error(`❌ Failed to sync ${loc}:`, err);
    }
  }

  console.log("✅ Global Portfolio Sanitization Complete!");
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
