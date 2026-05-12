import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { UserAgent } from '@/agents/UserAgent';
import { HotelsAgent } from '@/agents/HotelsAgent';

const AGENT_ID = 'agent_017nznpf21FtKWKLVvR5iUDc';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const userAgent = new UserAgent();
const hotelsAgent = new HotelsAgent();

/**
 * Lazily created environment ID.
 * Prefers the env var; falls back to creating one on first request
 * and logs the ID so you can persist it to .env.local.
 */
let cachedEnvId: string | null = process.env.ANTHROPIC_ENVIRONMENT_ID || null;

async function getEnvId(): Promise<string> {
  if (cachedEnvId) return cachedEnvId;

  const env = await client.beta.environments.create({
    name: 'marriott-lumina',
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  });

  cachedEnvId = env.id;
  console.log(`✅ Created Managed Agents environment: ${env.id}`);
  console.log(`   Save to .env.local: ANTHROPIC_ENVIRONMENT_ID=${env.id}`);
  return cachedEnvId;
}

const TIER_ORDER = ['Luxury', 'Distinctive Luxury', 'Premium', 'Select', 'Longer Stays', 'Collections'];

function pickOnePerTier(hotels: any[], isBudget: boolean): any[] {
  const byTier: Record<string, any[]> = {};
  for (const h of hotels) {
    const tier = h.tier || 'Premium';
    if (!byTier[tier]) byTier[tier] = [];
    byTier[tier].push(h);
  }
  const result: any[] = [];
  for (const tier of TIER_ORDER) {
    const candidates = byTier[tier];
    if (!candidates?.length) continue;
    const enriched = candidates.filter((h: any) => h.description?.trim());
    const pool = enriched.length > 0 ? enriched : candidates;
    if (isBudget) {
      pool.sort((a: any, b: any) => {
        const pa = parseFloat(a.priceRange?.replace(/[^0-9.]/g, '') || '99999');
        const pb = parseFloat(b.priceRange?.replace(/[^0-9.]/g, '') || '99999');
        return pa - pb;
      });
    } else {
      pool.sort((a: any, b: any) => (b.rating || 0) - (a.rating || 0));
    }
    result.push(pool[0]);
  }
  return result;
}

/**
 * Executes a tool call by calling the underlying agents directly.
 * No HTTP roundtrip — avoids fetch failures and ngrok latency.
 */
async function runTool(
  name: string,
  input: Record<string, unknown>,
  email: string,
): Promise<string> {
  try {
    if (name === 'get_user_profile') {
      const target = (input.email as string) || email;
      const user = await userAgent.getOrCreateUser(target);
      return JSON.stringify({ email: user.email, likes: user.likes, dislikes: user.dislikes });
    }

    if (name === 'search_hotels') {
      const location = (input.location as string).toLowerCase();
      const country = (input.country as string | undefined)?.toLowerCase();
      const isBudget = input.budget === true || input.budget === 'true';
      const hotelName = input.hotelName as string | undefined;

      const hotels = await hotelsAgent.searchHotels(location, { specificHotelName: hotelName, country });
      const results = hotelName ? hotels : pickOnePerTier(hotels, isBudget);
      return JSON.stringify({ hotels: results, total: results.length });
    }

    if (name === 'update_preferences') {
      const target = (input.email as string) || email;
      await userAgent.updatePreferences(
        target,
        (input.likes as string[]) || [],
        (input.dislikes as string[]) || [],
      );
      return JSON.stringify({ updated: true });
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

/**
 * POST /api/agent
 *
 * Replacement for /api/chat that drives the Console Managed Agent instead of
 * running WorkflowManager locally. The agent (Marriott Lumina) calls three
 * client-handled tools: get_user_profile, search_hotels, update_preferences.
 * This route executes those tool calls and feeds results back until the agent
 * finishes, then returns { response, suggestions }.
 *
 * Tool execution loop (stream-first pattern):
 *   1. Open SSE stream before sending the user message
 *   2. Drain events — collect agent.custom_tool_use, accumulate agent.message text
 *   3. Break when session goes idle
 *   4. If tool calls were collected → execute them, open a new stream, send results, repeat
 *   5. If no tool calls → agent is done, return response
 */
export async function POST(req: NextRequest) {
  try {
    const { email, query, managedSessionId: incomingSessionId } = await req.json();
    if (!email || !query) {
      return NextResponse.json({ error: 'email and query are required' }, { status: 400 });
    }

    // Reuse an existing session when the client passes one back — this preserves
    // conversation history across messages. Create a new session only on first turn.
    let managedSessionId: string;
    if (incomingSessionId) {
      managedSessionId = incomingSessionId;
    } else {
      const environmentId = await getEnvId();
      const session = await client.beta.sessions.create({
        agent: AGENT_ID,
        environment_id: environmentId,
      });
      managedSessionId = session.id;
    }

    // Stream-first: open SSE stream before sending the message so we cannot
    // miss early events (managed-agents-client-patterns Pattern 7).
    let stream = await client.beta.sessions.events.stream(managedSessionId);

    // On the first turn include the guest email so the agent knows who it's
    // talking to. On subsequent turns the session already has that context.
    const messageText = incomingSessionId ? query : `Guest email: ${email}\n\n${query}`;

    await client.beta.sessions.events.send(managedSessionId, {
      events: [{
        type: 'user.message',
        content: [{ type: 'text', text: messageText }],
      }],
    });

    let responseText = '';
    let done = false;

    // Agentic tool loop.
    // The server processes tool results one-at-a-time even when we send them
    // in a batch, emitting an intermediate session.status_idle(requires_action)
    // after each one. We must NOT break on those intermediate idles — only break
    // on end_turn / retries_exhausted, or when we have new tool calls to execute.
    while (!done) {
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for await (const event of stream) {
        if (event.type === 'agent.message') {
          for (const block of event.content) {
            if (block.type === 'text') responseText += block.text;
          }
        } else if (event.type === 'agent.custom_tool_use') {
          toolCalls.push({
            id: event.id,
            name: event.name,
            input: (event.input ?? {}) as Record<string, unknown>,
          });
        } else if (event.type === 'session.status_idle') {
          const stopType = event.stop_reason.type;
          if (stopType === 'requires_action') {
            if (toolCalls.length > 0) break; // have new tool calls to execute
            // Intermediate idle while server processes already-sent results — keep listening.
          } else {
            // end_turn or retries_exhausted — agent is finished.
            done = true;
            break;
          }
        } else if (event.type === 'session.status_terminated') {
          done = true;
          break;
        }
      }

      if (done) break;

      if (toolCalls.length === 0) {
        // Stream exhausted without a terminal event — open a fresh stream and retry.
        stream = await client.beta.sessions.events.stream(managedSessionId);
        continue;
      }

      // Execute all tool calls in parallel.
      const results = await Promise.all(
        toolCalls.map(async (call) => ({
          type: 'user.custom_tool_result' as const,
          custom_tool_use_id: call.id,
          content: [{ type: 'text' as const, text: await runTool(call.name, call.input, email) }],
        })),
      );

      // Open new stream before sending results — ensures no events are missed.
      stream = await client.beta.sessions.events.stream(managedSessionId);
      await client.beta.sessions.events.send(managedSessionId, { events: results });
    }

    // Parse the SUGGESTIONS block appended by the agent (same convention as WorkflowManager).
    const [responseBody, ...rest] = responseText.split(/SUGGESTIONS:?/i);
    const cleanResponse = responseBody.trim();

    let suggestions: string[] = [];
    if (rest.length > 0) {
      suggestions = rest[0]
        .split('\n')
        .map((s) => s.replace(/^\d+\.\s*/, '').replace(/^[•*-]\s*/, '').trim())
        .filter((s) => s.length > 3)
        .slice(0, 3);
    }
    if (suggestions.length < 2) {
      suggestions = ['Show me Marriotts in London', 'Best family-friendly Marriotts?', 'Find a beach resort'];
    }

    // Ensure the user row exists before writing messages (FK requirement).
    await userAgent.getOrCreateUser(email);

    // Persist to conversation history (keeps the existing chat UI working).
    await Promise.all([
      userAgent.logInteraction(email, 'user', query),
      userAgent.logInteraction(email, 'assistant', cleanResponse),
    ]);

    return NextResponse.json({ response: cleanResponse, suggestions: suggestions.slice(0, 3), managedSessionId });
  } catch (err: any) {
    console.error('Agent route error:', err);
    return NextResponse.json(
      { error: 'An internal error occurred while processing your request.' },
      { status: 500 },
    );
  }
}
