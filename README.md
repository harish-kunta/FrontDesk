# FrontDesk

FrontDesk is a website-trained support and sales chatbot platform. A business will be able to add its website or documents, then give visitors a chat assistant that answers from that content, cites sources, and hands off when it does not know.

This repository is being built in milestones from [the product plan](./ai-chatbot-build-plan.md). The current milestone is **M0: application skeleton**.

## Stack

- Next.js App Router and TypeScript
- Auth.js with Google sign-in
- PostgreSQL with Drizzle ORM; pgvector is enabled by the initial migration
- One workspace per account for the MVP, with explicit workspace membership and roles

## Local setup

1. Install dependencies with `pnpm install`.
2. Start local PostgreSQL with pgvector using `pnpm db:up` (Docker required).
3. Copy `.env.example` to `.env`, generate `AUTH_SECRET` with `openssl rand -base64 32`, and set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` from Google Cloud Console.
4. Add `http://localhost:3000/api/auth/callback/google` as an authorized Google OAuth redirect URI.
5. Run `pnpm db:migrate`, then `pnpm dev`.

The sign-in page explains the OAuth configuration when Google credentials are missing. The dashboard and database migrations require a reachable PostgreSQL instance. Run the M0 route smoke test with `pnpm test:smoke`.

## Project structure

- `src/app`: public landing page, sign-in, authenticated dashboard, and Auth.js route.
- `src/db`: Drizzle schema and database connection.
- `src/lib/workspace.ts`: server-side authentication and workspace resolution.
- `drizzle`: generated, version-controlled database migrations.

## Current scope

M0 establishes authentication, the initial workspace boundary, and an empty dashboard. M1 will add the first content ingestion and retrieval flow; this repository does not yet make LLM calls.
