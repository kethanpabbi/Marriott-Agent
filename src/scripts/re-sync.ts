import { PrismaClient } from '@prisma/client';
import { HotelsAgent } from '../agents/HotelsAgent';
import { LLMService } from '../lib/llm';

const prisma = new PrismaClient();
const hotelsAgent = new HotelsAgent();
const llmService = new LLMService();

async function main() {
  console.log("🧹 Starting Global Portfolio Re-sync...");

  const hotels = await prisma.hotel.findMany({ select: { location: true } });
  const locations = Array.from(new Set(hotels.map(h => h.location.toLowerCase())));
  console.log(`📍 Found ${locations.length} locations to re-sync.`);

  await prisma.attraction.deleteMany();
  await prisma.hotel.deleteMany();
  console.log("🗑️ Database cleared. Re-syncing from official Marriott pages...");

  for (const loc of locations) {
    try {
      console.log(`🔄 Syncing ${loc}...`);
      await hotelsAgent.syncLocation(loc, llmService);
    } catch (err) {
      console.error(`❌ Failed to sync ${loc}:`, err);
    }
  }

  console.log("✅ Re-sync complete.");
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
