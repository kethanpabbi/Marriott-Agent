import { PrismaClient } from '@prisma/client';
import * as parquet from 'parquetjs';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();

export class DataExporter {
  private exportDir: string;

  constructor() {
    this.exportDir = path.join(process.cwd(), 'exports');
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir);
    }
  }

  /**
   * Exports all user interactions to a Parquet file.
   */
  async exportInteractionsToParquet(): Promise<string> {
    const messages = await prisma.message.findMany({
      include: { user: true },
    });

    const schema = new parquet.ParquetSchema({
      id: { type: 'UTF8' },
      userId: { type: 'UTF8' },
      role: { type: 'UTF8' },
      content: { type: 'UTF8' },
      createdAt: { type: 'TIMESTAMP_MILLIS' },
      userLikes: { type: 'UTF8', optional: true },
    });

    const filePath = path.join(this.exportDir, `interactions_${Date.now()}.parquet`);
    const writer = await parquet.ParquetWriter.openFile(schema, filePath);

    for (const msg of messages) {
      await writer.appendRow({
        id: msg.id,
        userId: msg.userId,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
        userLikes: msg.user.likes || '',
      });
    }

    await writer.close();
    return filePath;
  }

  /**
   * Exports all hotel data to a Parquet file.
   */
  async exportHotelsToParquet(): Promise<string> {
    const hotels = await prisma.hotel.findMany();

    const schema = new parquet.ParquetSchema({
      id: { type: 'UTF8' },
      name: { type: 'UTF8' },
      location: { type: 'UTF8' },
      region: { type: 'UTF8' },
      priceRange: { type: 'UTF8' },
      status: { type: 'UTF8' },
      rating: { type: 'DOUBLE' },
    });

    const filePath = path.join(this.exportDir, `hotels_${Date.now()}.parquet`);
    const writer = await parquet.ParquetWriter.openFile(schema, filePath);

    for (const hotel of hotels) {
      await writer.appendRow({
        id: hotel.id,
        name: hotel.name,
        location: hotel.location,
        region: hotel.region,
        priceRange: hotel.priceRange,
        status: hotel.status,
        rating: hotel.rating,
      });
    }

    await writer.close();
    return filePath;
  }
}
