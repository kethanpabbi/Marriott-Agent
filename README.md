# Marriott Lumina AI Concierge 🏨✨

Marriott Lumina is a state-of-the-art, **fully autonomous AI concierge** designed to provide a premium, personalized hotel discovery experience across the global Marriott Bonvoy portfolio.

## 🚀 Key Features

- **Total Autonomy**: No hardcoded destinations. Lumina autonomously discovers, learns, and persists Marriott property data from any city or country on earth in real-time.
- **Adaptive Memory**: The agent "learns" guest preferences (likes/dislikes) during conversation and automatically tailors all future recommendations to match the user's unique profile.
- **Agentic Reasoning Engine**: Powered by a Chain-of-Thought brain that analyzes user intent, handles multi-city comparisons, and manages complex context switches seamlessly.
- **Real-Time Global Sync**: Integrated with **Firecrawl** to perform live extractions from Marriott's official directories, ensuring up-to-the-minute accuracy on ratings, amenities, and pricing.
- **Premium Branded UI**: A luxury-focused chat interface with gold-accented typography and glassmorphism, optimized for high-end hospitality interactions.

## 🛠 Technology Stack

- **Framework**: Next.js 15 (App Router)
- **Intelligence**: Anthropic Claude 3.5 Sonnet (Reasoning & Response)
- **Discovery**: Firecrawl (Real-time Scraping & Ingestion)
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
2. **Executes** a live discovery sync.
3. **Ingests** the results into its long-term memory (DB).
4. **Responds** with high-context, personalized data.

## 🔒 Security Policy
Built with enterprise-grade security:
- **Scope Enforcement**: Strictly limited to Marriott Bonvoy portfolio.
- **Privacy Protection**: No sensitive guest data leakage.
- **Injection Defense**: Robust sanitization of all LLM inputs.

---
Built as a POC for Marriott International.
