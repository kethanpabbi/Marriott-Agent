import { NextRequest, NextResponse } from 'next/server';

const rateLimitMap = new Map<string, { count: number, lastReset: number }>();
const LIMIT = 50; // Max requests per hour
const WINDOW = 3600000; // 1 hour in milliseconds

export function rateLimit(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'anonymous';
  const now = Date.now();
  
  const record = rateLimitMap.get(ip) || { count: 0, lastReset: now };

  if (now - record.lastReset > WINDOW) {
    record.count = 1;
    record.lastReset = now;
  } else {
    record.count++;
  }

  rateLimitMap.set(ip, record);

  if (record.count > LIMIT) {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    };
  }

  return { success: true };
}
