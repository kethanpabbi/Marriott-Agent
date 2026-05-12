# Marriott Lumina AI Concierge 🏨✨

Marriott Lumina is an **AI-powered hotel concierge** for the global Marriott Bonvoy portfolio. Ask about any city and get real hotel data — ratings, prices, amenities, and dining — sourced live from Booking.com and enriched locally for instant follow-up queries.

## 🚀 Key Features

- **9,872-Hotel Directory**: Pre-seeded from the official Marriott sitemap. Every response is grounded in this directory — no hallucinated hotels.
- **Per-Hotel Booking.com Enrichment**: Each hotel is individually looked up on Booking.com by name (with real check-in dates for accurate pricing), enriched once, and marked `enriched=true` permanently. Already-enriched hotels are never re-processed.
- **Background Enrichment**: First query for a city returns basic results immediately while Ollama enriches hotels in the background. Subsequent queries get full ratings, prices, amenities, and descriptions.
- **Ratings as shown on Booking.com**: Guest review scores are extracted and displayed on the native /10 scale (e.g. ⭐ 8.6), exactly as Booking.com shows them. No conversion or guessing — only values explicitly present in the page are used.
- **Tier Diversity**: Responses always show one hotel from each available Marriott tier — Luxury, Distinctive Luxury, Premium, Select, Longer Stays, and Collections — rather than a list from a single category.
- **Location Disambiguation**: Understands that "Paris" means France, not Texas. Country is inferred from context and used to filter results.
- **Persistent Conversation Memory**: The agent remembers the full conversation within a session — follow-up questions like "what museums are nearby?" correctly reference the city discussed earlier.
- **Adaptive Preferences**: Learns guest likes/dislikes during the conversation and tailors recommendations automatically.
- **Official 6-Tier Classification**:
  - **Luxury**: JW Marriott, Ritz-Carlton, St. Regis
  - **Distinctive Luxury**: EDITION, W Hotels, The Luxury Collection
  - **Premium**: Marriott Hotels, Westin, Sheraton, Le Méridien, Renaissance
  - **Select**: Courtyard, Moxy, AC Hotels, Aloft, Four Points, Fairfield
  - **Longer Stays**: Residence Inn, Element, TownePlace Suites
  - **Collections**: Autograph Collection, Design Hotels, Tribute Portfolio

## 🛠 Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Conversation AI | Claude (Anthropic Managed Agents — Console) |
| Enrichment AI | Ollama `llama3.1:8b` (local, free — no rate limits) |
| Data Discovery | DuckDuckGo Lite → Booking.com hotel pages → Jina Reader |
| Database | Prisma ORM + SQLite |
| Styling | Vanilla CSS (custom Marriott brand system) |

## 🏗 Setup & Installation

### 1. Clone the repository

```bash
git clone https://github.com/kethanpabbi/Marriott-Agent.git
cd Marriott-Agent
```

### 2. Install Ollama

Ollama runs enrichment locally — no API costs, no rate limits.

```bash
# Install from https://ollama.com, then pull a model:
ollama pull llama3.1:8b
```

### 3. Environment Configuration

Create a `.env.local` file:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
DATABASE_URL="file:./prisma/dev.db"

# Managed Agents (Claude Console)
# The agent ID is hard-coded in /api/agent/route.ts — create your own at platform.claude.com.
# The environment ID is auto-created on first run and logged to console; paste it here to reuse it.
ANTHROPIC_ENVIRONMENT_ID=

# Required for local development — expose your local server via ngrok and paste the URL here.
# The agent route uses this to call internal tool endpoints.
NEXT_PUBLIC_APP_URL=https://your-ngrok-url.ngrok-free.app
```

Create a `.env` file (for Prisma CLI tools):

```env
DATABASE_URL="file:./prisma/dev.db"
OLLAMA_ENRICHMENT_MODEL=llama3.1:8b
```

To use a different local model, change `OLLAMA_ENRICHMENT_MODEL` to any model you have pulled (e.g. `mistral`, `phi3:mini`).

### 4. Initialize the Database

```bash
npx prisma db push
npx prisma db seed
```

The seed script populates the 9,872-hotel directory from the Marriott sitemap.

### 5. Expose local server (development only)

The Claude Console agent runs on Anthropic's infrastructure. Tool endpoints must be publicly reachable:

```bash
ngrok http 3000
```

Copy the `https://xxxx.ngrok-free.app` URL into `NEXT_PUBLIC_APP_URL` in `.env.local`.

### 6. Launch

```bash
# Terminal 1 — Ollama (if not already running)
ollama serve

# Terminal 2 — Next.js app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start chatting.

On the first request the app auto-creates a Managed Agents environment and logs the ID to the console. Paste it into `ANTHROPIC_ENVIRONMENT_ID` to reuse it across restarts.

### 7. Database Viewer (optional)

```bash
npx prisma studio
```

Opens at [http://localhost:5555](http://localhost:5555) — browse hotels, users, chat history, and inspect enrichment status.

## 🧠 How It Works

When a guest sends a message:

1. **Session continuity** — the app reuses an existing Claude Console session for the duration of the conversation, giving the agent full memory of prior turns.
2. **Agentic tool loop** — the agent (Marriott Lumina, hosted on Claude Console) decides which tools to call. It has three client-handled tools:
   - `get_user_profile` — reads the guest's saved likes/dislikes from the local DB.
   - `search_hotels` — queries the 9,872-hotel directory, filtered by location/country/budget, with one result per Marriott tier.
   - `update_preferences` — persists any expressed preferences back to the guest profile.
3. **Tool execution** — tool calls are delivered as SSE events over the session stream. The Next.js route executes each call directly against the local agents (no extra HTTP roundtrip) and feeds results back.
4. **Background enrichment** — `search_hotels` fires a background Booking.com scrape for any city that hasn't been enriched yet. Ollama (`llama3.1:8b`, `temperature=0`) extracts rating, price, amenities, restaurants, and activities from the real page content. The `enriched` flag is set permanently after success.
5. **Response** — the agent formats a branded reply grouped by Marriott tier with ratings (⭐) and price ranges, then the app parses any follow-up suggestion chips from the response.

## Architecture

```
Browser → POST /api/agent
            ├── Reuse or create Claude Console session
            ├── Stream-first SSE event loop
            │     ├── agent.custom_tool_use  → runTool() → UserAgent / HotelsAgent (direct call)
            │     ├── user.custom_tool_result → fed back to session
            │     └── session.status_idle (end_turn) → done
            └── { response, suggestions, managedSessionId }
```

The `managedSessionId` is returned to the browser and sent back with every subsequent message, keeping the same Console session alive for the whole conversation.

## 🔒 Security

- **Scope enforcement**: Hotel searches, property info, and destination/travel questions are in scope. Unrelated topics are rejected.
- **Source-locked data**: Only hotels present in the 9,872-property directory can appear in responses.
- **Injection defense**: All LLM inputs are sanitized; no external content can alter agent behaviour.
- **In-flight deduplication**: A module-level lock prevents concurrent enrichment runs for the same location, avoiding duplicate API calls.

---

Built as a POC for Marriott International.
