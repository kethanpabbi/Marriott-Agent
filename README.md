# Marriott Lumina AI Agent

Marriott Lumina is a high-end AI concierge POC built for Marriott International. It leverages the **WAT (Workflow, Agent, Tools)** framework to provide guests with a seamless, secure, and personalized experience.

## ✨ Features

- **Multi-Agent Architecture**:
  - **User Agent**: Manages user memory, personalization, and security monitoring.
  - **Hotels Agent**: Handles property data retrieval, consistency checks, and availability.
- **WAT Framework**: Structured workflows that ensure polite, scoped, and interactive responses.
- **Security & Privacy**: Built-in prompt hardening, rate limiting, and scope enforcement (Marriott properties only).
- **Interactive Experience**: Premium UI with suggested questions and dynamic hotel information cards.
- **Data Lake Ready**: Session and hotel data exported to Parquet files for easy ingestion and analysis.

## 🛠 Tech Stack

- **Frontend**: Next.js 15+, React, Framer Motion, Vanilla CSS (Premium Glassmorphism).
- **Backend**: Next.js API Routes (Serverless).
- **Database**: Prisma with SQLite (for POC portability).
- **Intelligence**: Integrated with Claude API / Ollama.
- **Tools**: Firecrawl (Scraping), ParquetJS (Data Export).

## 🚀 Getting Started

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Setup the database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```
4. Configure your environment:
5. Run the development server:
   ```bash
   npm run dev
   ```

## 🔒 Security Policy

This agent is designed with security as a priority:

- No sensitive guest information leakage.
- Polite refusal for out-of-scope queries.
- Input sanitization to prevent prompt injection and payload execution.

---
Built as a POC for Marriott International.
