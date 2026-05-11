const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function wipe() {
  try {
    const deletedHotels = await prisma.hotel.deleteMany({});
    const deletedMessages = await prisma.message.deleteMany({});
    console.log(`✅ Wiped ${deletedHotels.count} hotels and ${deletedMessages.count} messages.`);
  } catch (e) {
    console.error("❌ Wipe failed:", e);
  } finally {
    await prisma.$disconnect();
  }
}

wipe();
