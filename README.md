# Marriott Lumina AI Concierge 🏨✨

Marriott Lumina is an **AI-powered hotel concierge** for the global Marriott Bonvoy portfolio. Ask about any city and get real hotel data — ratings, prices, amenities, and dining — sourced live from Booking.com and cached locally for instant follow-up queries.

## 🚀 Key Features

- **On-Demand Live Sync**: When a guest asks about a city, Lumina automatically fetches real hotel data from Booking.com's Marriott co-branded pages, extracts it with an LLM, and caches it in the local database for 7 days.
- **9,872-Hotel Directory**: Pre-seeded from the official Marriott sitemap with every active property (name, brand, tier, location, country). Used as the source of truth — no hallucinated hotels.
- **Official 6-Tier Classification**: Rigorous brand alignment across Marriott's categories:
  - **Luxury**: JW Marriott, Ritz-Carlton, St. Regis
  - **Distinctive Luxury**: EDITION, W Hotels, The Luxury Collection
  - **Premium**: Marriott Hotels, Westin, Sheraton, Le Méridien, Renaissance
  - **Select**: Courtyard, Moxy, AC Hotels, Aloft, Four Points, Fairfield
  - **Longer Stays**: Residence Inn, Element, TownePlace Suites
  - **Collections**: Autograph Collection, Design Hotels, Tribute Portfolio
- **Adaptive Preferences**: Learns guest likes/dislikes during the conversation and tailors recommendations automatically.
- **Anti-Hallucination Guardrails**: Every property listed must exist in the DB. If sync hasn't run yet, the agent says so rather than inventing hotels.
- **Smart Caching**: Data fresher than 7 days is served instantly from SQLite — no redundant fetches.

## 🛠 Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| AI | Claude (Anthropic) via LLM Service |
| Data Discovery | DuckDuckGo Lite → Booking.com Marriott pages → Jina Reader |
| Database | Prisma ORM + SQLite |
| Styling | Vanilla CSS (custom Marriott brand system) |

## 🏗 Setup & Installation

### 1. Clone the repository

```bash
git clone https://github.com/kethanpabbi/Marriott-Agent.git
cd Marriott-Agent
```

### 2. Environment Configuration

Create a `.env.local` file:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key
DATABASE_URL="file:./prisma/dev.db"
```

### 3. Initialize the Database

```bash
npx prisma db push
npx prisma db seed
```

The seed script populates the 9,872-hotel directory from the Marriott sitemap.

### 4. Launch

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start chatting.

### 5. Database Viewer (optional)

To browse and inspect the SQLite database visually, run Prisma Studio in a separate terminal:

```bash
npx prisma studio
```

Opens at [http://localhost:5555](http://localhost:5555) — browse hotels, users, chat history, filter rows, and inspect synced data.

## 🧠 How It Works

When a guest asks about a city:

1. **Security check** — query is validated as in-scope for Marriott Bonvoy.
2. **Reasoning** — LLM extracts the city, intent, specific hotel name (if any), and budget preference.
3. **Preference learning** — any expressed likes/dislikes are persisted to the guest profile.
4. **Live sync** — if the city has no enriched data (or data is > 7 days old), Lumina:
   - Searches DuckDuckGo for the Booking.com Marriott city page
   - Fetches the page via Jina Reader (bot-accessible markdown)
   - LLM extracts all hotels with ratings, prices, amenities, restaurants, and activities
   - Upserts results into SQLite
5. **Retrieval** — returns the top-rated hotels from the DB (or the specific property if named).
6. **Response** — Lumina formats a branded reply grouped by tier, with real ratings (⭐) and price ranges.

## 🔒 Security

- **Scope enforcement**: Strictly limited to Marriott Bonvoy portfolio — off-topic queries are rejected.
- **Source-locked data**: Only hotels present in the 9,872-property directory can appear in responses.
- **Injection defense**: All LLM inputs are sanitized; no external instructions can alter agent behavior.

---

Built as a POC for Marriott International.
