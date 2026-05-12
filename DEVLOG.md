# Marriott Agent — Dev Log

This file documents every significant change made to the project: what changed, why, and how it fits the bigger picture. Read top-to-bottom for the full story.

---

## Background — What the app does

Marriott Lumina is an AI concierge chat app. A user types a query ("show me hotels in Paris"), and the app:

1. Checks the input for security threats
2. Runs a reasoning LLM call to extract location, intent, budget flag, user preference updates
3. Searches a local Prisma (SQLite) database of Marriott hotels
4. Fires a background enrichment job that scrapes Booking.com via Jina AI + a local Ollama model to fill in prices, ratings, and descriptions
5. Generates a final response via Claude (Haiku) with the hotels as grounding context
6. Saves the conversation to the DB

The orchestration logic lives in `src/agents/WorkflowManager.ts`. It manually sequences every step — explicit JSON parsing, explicit LLM calls, explicit DB queries.

---

## Architecture before this branch (`feat/claude-console-agent`)

```
Browser → POST /api/chat
            └── WorkflowManager.processQuery()
                  ├── UserAgent.checkSecurity()
                  ├── LLMService.generateResponse()   ← reasoning step (extracts location/intent)
                  ├── UserAgent.getOrCreateUser()
                  ├── UserAgent.getChatHistory()
                  ├── UserAgent.updatePreferences()
                  ├── HotelsAgent.syncLocation()      ← background enrichment (Ollama)
                  ├── HotelsAgent.searchHotels()
                  └── LLMService.generateResponse()   ← final response (Claude Haiku)
```

**Problems with this approach:**
- Two separate LLM calls per turn (reasoning + response) — slow and fragile
- The reasoning step requires exact JSON output — breaks if the model adds extra text
- Orchestration is hand-coded; adding a new capability means rewriting `WorkflowManager`
- Ollama runs locally — can't be called by any external system

---

## Plan — Two-phase upgrade

### Phase 1: Claude Console (Managed Agents)
Run the agent loop on Anthropic's infrastructure. Claude itself decides which tools to call and in what order — no more hand-coded orchestration. The app's DB stays local; we expose it via HTTP endpoints the Console agent calls as tools.

**New endpoints needed:**
- `GET /api/search?location=&country=&budget=` — hotel search (replaces `HotelsAgent.searchHotels`)
- `GET /api/user?email=` — fetch user profile/preferences
- `PATCH /api/user` — update user preferences

**Console agent tools (3 total):**
1. `search_hotels` → calls `GET /api/search`
2. `get_user_profile` → calls `GET /api/user`
3. `update_preferences` → calls `PATCH /api/user`

The system prompt carries the Marriott Lumina persona + display rules. The reasoning step and response generation collapse into a single native agent loop.

For local development: use `ngrok http 3000` to give the Console agent a public URL to call.

### Phase 2: Self-hosted tool_use (later)
Same tool definitions, but the agentic loop runs inside the Next.js app using the Anthropic SDK's `tool_use` API. No Console dependency — fully self-contained. `WorkflowManager` gets rewritten to drive the loop instead of manually orchestrating steps.

---

## Changes

### 2026-05-12 — Phase 1 begins

**Branch:** `feat/claude-console-agent`

#### Added `src/app/api/search/route.ts`
- New `GET` endpoint the Console agent calls as the `search_hotels` tool
- Accepts `location`, `country`, `budget` (boolean), `hotelName` query params
- Delegates to `HotelsAgent.searchHotels()` (existing logic, unchanged)
- Also fires `HotelsAgent.syncLocation()` in the background if the location isn't enriched yet — keeps the enrichment side-effect alive even though the Console agent doesn't know about it
- Returns hotels as JSON, one per tier (or all matches for specific-hotel queries)
- **Why a new route instead of reusing `/api/hotels`?** The existing `/api/hotels` POST is an ingestion endpoint (bulk-upsert from a data pipeline), not a search. Kept separate to avoid mixing concerns.

#### Added `src/app/api/agent/route.ts`
- New `POST` endpoint that replaces `/api/chat` when using the Console agent approach
- Receives `{ email, query }` — same shape as `/api/chat` so the frontend can swap them
- **What it does step by step:**
  1. Lazily creates (or reuses) a Managed Agents environment via `client.beta.environments.create()`. On first run it logs the ID — save it as `ANTHROPIC_ENVIRONMENT_ID` in `.env.local` so it isn't recreated on every cold start
  2. Creates a fresh session against the Console agent (`agent_017nznpf21FtKWKLVvR5iUDc`) — each request gets its own session, keeping things stateless
  3. Opens the SSE event stream **before** sending the user message (stream-first pattern — ensures no early events are missed)
  4. Sends the user message with the guest email prepended so Claude knows which email to pass to the tools
  5. Runs the **agentic tool loop**: drains the stream until `session.status_idle`; collects any `agent.custom_tool_use` events; if there are tool calls, executes them all in parallel via the internal `/api/search` and `/api/user` endpoints, opens a new stream, sends the tool results back, and repeats
  6. When no tool calls remain the agent has finished — extracts the final `agent.message` text
  7. Archives the session (fire-and-forget cleanup)
  8. Parses the `SUGGESTIONS:` block (same convention as `WorkflowManager`) and falls back to defaults
  9. Logs the turn to Prisma via `UserAgent` so the existing chat UI history still works
- **Why a new route instead of modifying `/api/chat`?** Keeps both approaches runnable side-by-side during Phase 1 testing. The frontend can point at `/api/agent` or `/api/chat` independently

#### Added `src/app/api/user/route.ts`
- `GET /api/user?email=` — returns `{ likes, dislikes }` for the given user (creates the user record if first visit)
- `PATCH /api/user` — accepts `{ email, likes, dislikes }` and persists preference updates
- **Why expose preferences as a tool?** The Console agent needs to read and write user context between turns. Without this, every session starts cold with no memory of past preferences.

#### Installed `@anthropic-ai/sdk`
- Required for `client.beta.environments`, `client.beta.sessions`, and the SSE event stream
- The existing `llm.ts` was using raw `fetch` to call the Anthropic API; the SDK is now used in parallel for the Managed Agents surface (richer types, automatic beta headers, built-in stream iteration)

#### Added `ANTHROPIC_ENVIRONMENT_ID` to `.env.local`
- Blank placeholder — populated automatically on first run and logged to console
- Persist the logged value so the environment isn't recreated on every cold start

---

### 2026-05-12 — Debugging session: getting the first real response

**Branch renamed:** `feat/claude-console-agent` → `feat/agentic-workflow`

This section documents everything that broke during the first end-to-end test and how each issue was fixed.

---

#### Bug 1: Frontend still calling `/api/chat`

**Symptom:** Requests never reached the new agent route.

**Fix:** Changed the `fetch` call in `ChatInterface.tsx` from `/api/chat` to `/api/agent`. One-line change.

---

#### Bug 2: Foreign key constraint on `prisma.message.create()`

**Symptom:**
```
PrismaClientKnownRequestError: Foreign key constraint violated: foreign key
  at UserAgent.logInteraction (src/agents/UserAgent.ts:91)
```

**Cause:** The `Message` table has a `userId` foreign key that requires a `User` row to exist first. The old `/api/chat` path called `getOrCreateUser` before `logInteraction`. The new `/api/agent` route went straight to `logInteraction` using the session email, which had never been inserted into the `User` table.

**Fix:** Added `await userAgent.getOrCreateUser(email)` immediately before the `logInteraction` calls in `/api/agent/route.ts`.

---

#### Bug 3: Empty response — tool results silently failing

**Symptom:** `POST /api/agent 200` but no text in the response. The request took ~9s so the agent loop was running, just not capturing the final reply.

**Diagnosis:** Added `console.log('[agent] event:', event.type, ...)` to the stream loop. Logs revealed:

```
[agent] event: agent.custom_tool_use  name=get_user_profile
[agent] event: agent.custom_tool_use  name=search_hotels
[agent] event: session.status_idle    requires_action [both tool IDs]
[agent] idle/terminated, toolCalls: 2 responseText len: 0
[agent] event: user.custom_tool_result  → {"error":"TypeError: fetch failed"}  (get_user_profile)
[agent] event: session.status_idle    requires_action [search_hotels only still pending]
[agent] idle/terminated, toolCalls: 0 responseText len: 0
```

**Root cause:** `runTool()` was making HTTP `fetch` calls back to its own internal routes (`/api/search`, `/api/user`) via `NEXT_PUBLIC_APP_URL` (the ngrok URL). Both calls failed with `TypeError: fetch failed`. Because `Promise.all` waits for both before calling `events.send()`, only the fast-failing `get_user_profile` result was sent; `search_hotels` either timed out or was lost, leaving the session permanently blocked on that tool call.

**Fix:** Replaced the HTTP roundtrip pattern in `runTool()` with direct in-process calls to `UserAgent` and `HotelsAgent`:

```typescript
// Before — fragile HTTP roundtrip through ngrok
const res = await fetch(`${base}/api/search?location=...`);
return JSON.stringify(await res.json());

// After — direct agent call, no network hop
const hotels = await hotelsAgent.searchHotels(location, { country });
return JSON.stringify({ hotels: pickOnePerTier(hotels, isBudget), total: ... });
```

Also moved the `pickOnePerTier` helper directly into `route.ts` (was previously only in `/api/search/route.ts`).

---

#### Bug 4: Empty response — intermediate `requires_action` idle breaking the loop

**Symptom:** After the `runTool` fix, both tool calls were now executing successfully (confirmed via logs), but the response was still empty.

**Diagnosis:** Logs showed:

```
[agent] idle/terminated, toolCalls: 2 responseText len: 0   ← executes both tools, sends results
[agent] event: user.custom_tool_result  (get_user_profile echo)
[agent] event: session.status_idle  requires_action [search_hotels still pending]
[agent] idle/terminated, toolCalls: 0 responseText len: 0   ← breaks here, returns empty
```

**Root cause:** The server processes batched tool results one at a time. After accepting the `get_user_profile` result it immediately re-emits `session.status_idle(requires_action)` with only `search_hotels` still pending — *before* it processes the search_hotels result. Our loop treated any `session.status_idle` as "agent is done", so it broke on this intermediate idle, saw `toolCalls = 0`, and returned an empty response. The agent's actual reply (which would have come after `search_hotels` was processed) was never seen.

**Fix:** Changed the break condition to only exit on `end_turn` or `retries_exhausted`. For `requires_action` with no new tool calls in the current iteration, the loop now continues listening on the same stream:

```typescript
} else if (event.type === 'session.status_idle') {
  const stopType = event.stop_reason.type;
  if (stopType === 'requires_action') {
    if (toolCalls.length > 0) break; // new tool calls to handle
    // Intermediate idle — keep listening, server is still processing our results
  } else {
    done = true; // end_turn or retries_exhausted
    break;
  }
}
```

After this fix, the loop correctly passed through the intermediate idle, waited for `search_hotels` to be processed, received the `agent.message` event, and broke cleanly on `end_turn`.

---

#### Bug 5: Context loss — every message started a new conversation

**Symptom:** Each message was treated as a new conversation. "What museums are nearby?" prompted the agent to ask "Which city?" even though Paris had been established two messages earlier.

**Cause:** The route was creating a fresh `client.beta.sessions.create()` on every request and archiving the session at the end. Managed Agent sessions maintain full conversation history, but only if you reuse them.

**Fix (3 parts):**

1. **Backend** — Accept an optional `managedSessionId` in the request body. If provided, skip session creation and use the existing one. Remove the `archive()` call so the session stays alive. Return the session ID in every response.

2. **Frontend** — Store `managedSessionId` in React state. Pass it with every request. Update it from the first response.

3. **Message text** — Only prepend `Guest email: <email>` on the first message (when no `managedSessionId` exists). Subsequent messages send the raw query — the session already has the guest context.

```
First message:  { query: "Guest email: guest-xxx\n\nHotels in Paris", managedSessionId: null }
                → creates session, returns managedSessionId

Second message: { query: "What museums are nearby?", managedSessionId: "sesn_01..." }
                → reuses session, agent remembers Paris
```

---

#### Final architecture

```
Browser → POST /api/agent { email, query, managedSessionId? }
            ├── Reuse session (if managedSessionId) or create new one
            ├── Stream-first SSE event loop
            │     ├── agent.custom_tool_use
            │     │     ├── get_user_profile  → userAgent.getOrCreateUser() directly
            │     │     ├── search_hotels     → hotelsAgent.searchHotels() directly
            │     │     └── update_preferences → userAgent.updatePreferences() directly
            │     ├── user.custom_tool_result fed back to session
            │     ├── session.status_idle(requires_action, no new calls) → keep listening
            │     └── session.status_idle(end_turn) → done
            └── { response, suggestions, managedSessionId }
```

The `managedSessionId` round-trips through the browser for the lifetime of the tab. Page reload = new session = clean conversation.
