# Implementation Plan: Marriott Lumina (AI Agent POC)

Marriott Lumina is a premium AI concierge designed to provide guests with a seamless experience in finding Marriott properties, local attractions, and personalized recommendations. Built using the WAT (Workflow, Agent, Tools) framework, it focuses on security, scope adherence, and interactive engagement.

## Proposed Names
- **Marriott Lumina** (Primary recommendation)
- **Bonvoy AI Concierge**
- **Marriott Horizon**

## User Review Required

> [!IMPORTANT]
> **LLM Provider**: You mentioned Claude API or Ollama. For the POC, I recommend starting with Claude (via LangChain or direct API) for its superior reasoning in multi-agent workflows, but I can structure it to be LLM-agnostic if you'd like to switch to Ollama later.
> **Database**: I will use SQLite (via Prisma) for the POC for easy portability, or PostgreSQL if you prefer a more scalable solution.

## Proposed Changes

---

### 1. Project Infrastructure
Setup the base project using Next.js with a focus on a high-end UI and a robust API layer.

#### [NEW] `package.json`
- Next.js, React, Lucide Icons (for UI).
- `framer-motion` for animations.
- `parquetjs` for data exporting.
- `prisma` for database management.
- `zod` for input validation and security.

#### [NEW] `prisma/schema.prisma`
- `User` model: `id` (email), `likes`, `dislikes`, `history`, `securityFlags`.
- `Hotel` model: `id`, `name`, `location`, `price`, `status` (open/renovating), `amenities`, `lastUpdated`.

---

### 2. Agents & Workflow (WAT Framework)

#### [NEW] `src/agents/UserAgent.ts`
- **Memory**: Tracks user interactions and preferences.
- **Security**: Analyzes inputs for exploit patterns (prompt injection) and flags users.
- **Personalization**: Filters hotel recommendations based on stored likes/dislikes (e.g., "no beaches").

#### [NEW] `src/agents/HotelsAgent.ts`
- **Data Retrieval**: Interfaces with the hotel database (populated via Firecrawl).
- **Consistency Checker**: Flags anomalies like $1 prices or subpar review scores.
- **Update Logic**: Simulates daily/weekly updates of hotel statuses.

#### [NEW] `src/agents/WorkflowManager.ts`
- Orchestrates the flow: `UserAgent` (Pre-process) -> `HotelsAgent` (Information Retrieval) -> `UserAgent` (Post-process/Tone Check).
- Ensures answers are polite, relevant to Marriott, and include suggested questions.

---

### 3. Tools & Data

#### [NEW] `src/tools/DataExporter.ts`
- Tool to dump session and hotel data into Parquet files for data lake ingestion.

#### [NEW] `src/tools/ScraperService.ts`
- Integration with Firecrawl/Apify (mocked for initial POC or using API keys if provided).

---

### 4. Security & Rate Limiting

#### [NEW] `src/middleware/security.ts`
- Rate limiting based on IP/User ID.
- Scope enforcement: Polite refusal for non-Marriott queries.
- Input sanitization: Avoiding binary/encoded payloads.

---

### 5. UI/UX (The "Wow" Factor)

#### [NEW] `src/components/ChatInterface.tsx`
- Glassmorphic design with subtle gradients.
- Interactive hotel cards with images (using `generate_image` for mockups).
- Suggested question chips.

## Verification Plan

### Automated Tests
- Test cases for "Out of Scope" queries (e.g., asking about Hilton).
- Security tests for prompt injection.
- Parquet file generation validation.

### Manual Verification
- Verify that user preferences (e.g., "no beaches") correctly influence recommendations.
- Check the "Flagging" system for inconsistent hotel data.
- UI responsiveness and animation smoothness.
