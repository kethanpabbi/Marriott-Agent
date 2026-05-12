import { NextRequest, NextResponse } from 'next/server';
import { UserAgent } from '@/agents/UserAgent';

const userAgent = new UserAgent();

/**
 * GET /api/user?email=
 *
 * Returns the user's preference profile (likes, dislikes).
 * Creates the user record on first visit.
 * Used as the `get_user_profile` tool by the Claude Console managed agent.
 */
export async function GET(req: NextRequest) {
  const email = new URL(req.url).searchParams.get('email')?.trim();

  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  const user = await userAgent.getOrCreateUser(email);

  return NextResponse.json({
    email: user.email,
    likes: user.likes,
    dislikes: user.dislikes,
  });
}

/**
 * PATCH /api/user
 *
 * Body: { email: string, likes: string[], dislikes: string[] }
 *
 * Persists updated preference arrays for the user.
 * Used as the `update_preferences` tool by the Claude Console managed agent.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body?.email || !Array.isArray(body.likes) || !Array.isArray(body.dislikes)) {
    return NextResponse.json(
      { error: 'email, likes (array), and dislikes (array) are required' },
      { status: 400 }
    );
  }

  await userAgent.updatePreferences(body.email, body.likes, body.dislikes);

  return NextResponse.json({ updated: true });
}
