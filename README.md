# Marriott Lumina AI Concierge 🏨✨

Marriott Lumina is a state-of-the-art, **fully autonomous AI concierge** designed to provide a premium, personalized hotel discovery experience across the global Marriott Bonvoy portfolio.

## 🚀 Key Features

- **Total Autonomy**: No hardcoded destinations. Lumina autonomously discovers, learns, and persists Marriott property data from any city or country on earth in real-time.
- **Official 6-Tier Classification**: Rigorous brand alignment across Marriott's official categories:
  - **Luxury**: JW Marriott, Ritz-Carlton, St. Regis.
  - **Distinctive Luxury**: EDITION, The Luxury Collection, W Hotels, etc.
  - **Premium**: Marriott, Westin, Sheraton, Le Méridien, etc.
  - **Select**: Courtyard, Moxy, AC Hotels, Aloft, etc.
  - **Longer Stays**: Residence Inn, Element, TownePlace Suites.
  - **Collections**: Autograph Collection, Design Hotels, Tribute Portfolio.
- **Adaptive Memory**: The agent "learns" guest preferences (likes/dislikes) during conversation and automatically tailors recommendations.
- **Local Context Enrichment**: Captures **actual price ranges in local currency**, real property amenities, signature restaurants, and local activities.
- **Regional Intelligence**: Automatically detects Marriott business regions (**EU, APAC, NA, LATAM**) for location-based compliance.
- **Anti-Hallucination Guardrails**: Strictly source-locked data retrieval ensures that every property listed is a verified Marriott asset.

## 🛠 Technology Stack

- **Framework**: Next.js 15 (App Router)
- **Intelligence**: Claude 3.5 / Gemini 3 Flash (via LLM Service)
- **Discovery**: Firecrawl (Autonomous Sweep & Search)
- **Database**: Prisma + SQLite (Persistent Learning Store)
- **Styling**: Vanilla CSS (Custom Marriott Brand System)

## 🏗 Setup & Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/kethanpabbi/Marriott-Agent.git
   cd Marriott-Agent
   ```

2. **Environment Configuration**:
   Create a `.env.local` file with the following:

   ```env
   ANTHROPIC_API_KEY=your_key
   FIRECRAWL_API_KEY=your_key
   DATABASE_URL="file:./dev.db"
   ```

3. **Initialize Database**:

   ```bash
   npx prisma db push
   ```

4. **Launch the Experience**:

   ```bash
   npm run dev
   ```

## 🧠 Autonomous Intelligence

Lumina does not rely on static databases. When a guest asks about a new location, the agent:

1. **Detects** the new destination via its Reasoning Engine.
2. **Identifies** the region and anticipated property density.
3. **Executes** a multi-tier autonomous search sweep.
4. **Ingests** enriched data (pricing, dining, ratings) into its long-term memory.
5. **Responds** with personalized, branded recommendations.

## 🔒 Security Policy

Built with enterprise-grade security:

- **Scope Enforcement**: Strictly limited to Marriott Bonvoy portfolio.
- **Source-Locked Branding**: Prevents hallucination of non-Marriott properties.
- **Injection Defense**: Robust sanitization of all LLM and scraper inputs.

---

Built as a POC for Marriott International.
