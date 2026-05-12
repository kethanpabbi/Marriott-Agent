# Marriott Lumina AI Concierge 🏨✨

Marriott Lumina is an **AI-powered hotel concierge** for the global Marriott Bonvoy portfolio. Ask about any city and get real hotel data — ratings, prices, amenities, and dining — sourced live from Booking.com and enriched locally for instant follow-up queries.

## 🚀 Key Features

- **9,872-Hotel Directory**: Pre-seeded from the official Marriott sitemap. Every response is grounded in this directory — no hallucinated hotels.
- **Per-Hotel Booking.com Enrichment**: Each hotel is individually looked up on Booking.com by name (with real check-in dates for accurate pricing), enriched once, and marked `enriched=true` permanently. Already-enriched hotels are never re-processed.
- **Background Enrichment**: First query for a city returns basic results immediately while Ollama enriches hotels in the background. Subsequent queries get full ratings, prices, amenities, and descriptions.
- **Ratings as shown on Booking.com**: Guest review scores are extracted and displayed on the native /10 scale (e.g. ⭐ 8.6), exactly as Booking.com shows them. No conversion or guessing — only values explicitly present in the page are used.
- **Tier Diversity**: Responses always show one hotel from each available Marriott tier — Luxury, Distinctive Luxury, Premium, Select, Longer Stays, and Collections — rather than a list from a single category.
- **Location Disambiguation**: Understands that "Paris" means France, not Texas. Country is inferred from context and used to filter results.
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
| Conversation AI | Claude Haiku (Anthropic) |
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

### 5. Launch

```bash
# Terminal 1 — Ollama (if not already running)
ollama serve

# Terminal 2 — Next.js app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start chatting.

### 6. Database Viewer (optional)

```bash
npx prisma studio
```

Opens at [http://localhost:5555](http://localhost:5555) — browse hotels, users, chat history, and inspect enrichment status.

## 🧠 How It Works

When a guest asks about a city:

1. **Security check** — query is validated as in-scope for Marriott Bonvoy.
2. **Reasoning** — Claude extracts the city, country, intent, specific hotel name (if any), and budget preference. Ambiguous city names (e.g. Paris) default to the most internationally prominent location.
3. **Preference learning** — any expressed likes/dislikes are persisted to the guest profile.
4. **Background enrichment** — hotels with `enriched=false` are looked up individually on Booking.com via Jina Reader. Ollama (`llama3.1:8b`, `temperature=0`, `num_predict=400`) extracts rating, price, amenities, restaurants, and activities from the real page content — no guessing. The `enriched` flag is set to `true` permanently after success. If enrichment is still in progress, basic results are returned immediately without making the user wait.
5. **Retrieval** — returns all hotels for the location filtered by country, sorted by rating.
6. **Tier selection** — picks the best hotel from each available tier for a diverse recommendation.
7. **Response** — Claude formats a branded reply grouped by tier, with ratings (⭐) and price ranges.

## 🔒 Security

- **Scope enforcement**: Hotel searches, property info, and destination/travel questions are in scope. Unrelated topics are rejected.
- **Source-locked data**: Only hotels present in the 9,872-property directory can appear in responses.
- **Injection defense**: All LLM inputs are sanitized; no external content can alter agent behaviour.
- **In-flight deduplication**: A module-level lock prevents concurrent enrichment runs for the same location, avoiding duplicate API calls.

---

Built as a POC for Marriott International.
