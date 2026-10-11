# FrontDesk

FrontDesk is a website-trained support and sales chatbot platform. A business will be able to add its website or documents, then give visitors a chat assistant that answers from that content, cites sources, and hands off when it does not know.

This repository is being built in milestones from [the product plan](./ai-chatbot-build-plan.md). The current milestone is **M2: grounded chat, citations, and evaluation**.

## Stack

- Next.js App Router and TypeScript
- Auth.js with Google sign-in
- PostgreSQL with Drizzle ORM; pgvector is enabled by the initial migration
- One workspace per account for the MVP, with explicit workspace membership and roles

## Local setup

1. Install dependencies with `pnpm install`.
2. Start local PostgreSQL with pgvector using `pnpm db:up` (Docker required).
3. Create `.env` in the project root (copy `.env.example` if available), generate `AUTH_SECRET` with `openssl rand -base64 32`, and set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` from Google Cloud Console.
4. Add `http://localhost:3000/api/auth/callback/google` as an authorized Google OAuth redirect URI.
5. Add `OPENAI_API_KEY` to `.env` for embeddings and chat generation. The app uses it only on the server. Optionally set `OPENAI_CHAT_MODEL` to choose another Responses API model; the default is `gpt-4.1-mini`.
6. Run `pnpm db:migrate`, then `pnpm dev`.

The sign-in page explains the OAuth configuration when Google credentials are missing. The dashboard and database migrations require a reachable PostgreSQL instance. Run the M0 route smoke test with `pnpm test:smoke` and the M1 chunking checks with `pnpm test:chunking`.

For chat generation and text indexing, add `OPENAI_API_KEY` to your local `.env` file. The key is used only by server-side modules and is never sent to the browser. The app uses `text-embedding-3-small` for vector search and the OpenAI Responses API for streamed answers. Response storage is disabled for these model requests; conversations are saved in this app's PostgreSQL database.

## M2 playground and evaluation

Open a chatbot playground to stream a grounded answer, inspect its citations and retrieval scores, and view the exact model prompt. Conversations are saved to the database and associated with the chatbot; the playground remembers the current conversation in this browser.

The 30-question golden set lives in `eval/golden-set.v1.json`. To measure retrieval for one chatbot, find its ID in the playground URL and run:

```bash
CHATBOT_ID="your-chatbot-uuid" pnpm eval:rag
```

The retrieval-only run embeds all 30 questions, so it uses a small amount of embedding API credit. To also generate answers for the 30 questions (which makes chat-model requests and uses more API credit), add `--answers`. Add `--save` to write the JSON report under `eval/runs/`.

## Project structure

- `src/app`: public landing page, sign-in, authenticated dashboard, chat playground, and chat API route.
- `src/db`: Drizzle schema and database connection.
- `src/lib/workspace.ts`: server-side authentication and workspace resolution.
- `src/lib/ai`: server-only embedding, retrieval, and grounded chat model calls.
- `drizzle`: generated, version-controlled database migrations.

## Current scope

M0 established authentication and the initial workspace boundary. M1 adds one chatbot per workspace, pasted-text sources, chunking, OpenAI embeddings, and pgvector storage. M2 adds authenticated streaming answers, chunk citations, threshold fallbacks, saved conversations, a prompt/retrieval debug panel, and a 30-question RAG evaluation harness. The public website widget, crawler, and file uploads remain later milestones.
