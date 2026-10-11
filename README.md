# FrontDesk

FrontDesk is a website-trained support and sales chatbot platform. A business will be able to add its website or documents, then give visitors a chat assistant that answers from that content, cites sources, and hands off when it does not know.

This repository is being built in milestones from [the product plan](./ai-chatbot-build-plan.md). The current milestone is **M5: inbox, leads, and analytics**.

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

## M3 website sources

In the chatbot playground, enter a public website URL and choose **Discover pages**. FrontDesk reads `robots.txt`, checks sitemap URLs first, and falls back to same-host links when it cannot find sitemap pages. Select up to 20 pages, then start the crawl to watch page extraction and embedding progress. Extracted text is chunked and indexed into the same chatbot-scoped vector store as pasted text. Re-crawling an unchanged page reuses its saved chunks.

The crawler accepts standard HTTP and HTTPS ports, blocks private or reserved IP addresses, pins the resolved address during each request, checks redirects, and skips pages disallowed by `robots.txt`. Website citations link back to the source URL. In **Your sources**, open a source to inspect its chunks or remove the source and all of its indexed chunks.

### What happens when a site is crawled

1. The discovery route validates the submitted URL and checks the site’s robots rules and sitemap.
2. You choose the pages. The crawl route checks that every selected URL was actually discovered for this chatbot.
3. The server fetches each page, extracts its readable article text, and saves progress in a `crawl_jobs` row.
4. FrontDesk splits the text into chunks, creates embeddings, and stores the vectors with the source URL and chatbot ID.
5. Chat retrieval continues to filter by that chatbot ID, so the new website passages remain inside the same tenant boundary as pasted text.

The current crawl runs from a streamed route request and checkpoints progress in Postgres. A durable background worker is a later production-hardening step for very large crawls.

## M4 visitor chat

Open **Set up visitor chat** from the chatbot playground. Configure a brand color, screen position, welcome message, starter questions, and the domains allowed to embed your assistant. The hosted page is `/b/<chatbot-id>`. Copy the script snippet into a website after adding that website's domain to the allowlist.

The widget is a small browser script with a Shadow DOM, so host-page styles do not leak into the chat. It fetches public appearance settings and sends visitor messages to the existing grounded chat pipeline. Embedded chat messages are accepted only from an allowed browser origin; retrieval and citations remain filtered by chatbot ID. The first rate limiter is process-local and useful for the demo, but it must move to shared storage such as Redis before running multiple app instances.

## M5 inbox, leads, and analytics

The workspace sidebar includes a tenant-scoped conversation inbox, lead table, and analytics view. The inbox lists recent visitor chats, searches their latest visitor questions, shows fallback and feedback status, and lets the workspace owner delete a conversation. Transcript pages include citations and any contact details the visitor chose to share.

Visitors can rate assistant replies in the widget. If the owner enables lead capture in widget settings, the widget offers a contact form after repeated fallback answers or when a visitor asks to speak to a person. The public feedback and lead routes check the allowed origin, rate-limit requests, and verify the message or conversation belongs to that chatbot. Leads store both workspace and chatbot IDs; dashboard queries are scoped to the signed-in workspace.

Analytics summarize the last 14 days of conversations, assistant replies, grounded resolution rate, visitor ratings, repeated questions, and questions that received a fallback. Lead records can be exported as CSV. The M5 migration adds a constrained rating field, the leads table, and the lead-capture widget setting; run `pnpm db:migrate` after updating.

### Learning: where the tenant boundary lives

The chatbot UUID in the embed code tells FrontDesk which assistant the visitor is talking to. It does not grant access by itself. The server checks the page origin, loads the chatbot, and includes that chatbot ID in vector retrieval and citation queries. That keeps one customer's public assistant from searching another customer's chunks. The model sees only the retrieved passages after this filter.

To try the hosted version locally, run the database migration with `pnpm db:migrate`, open the widget setup page from the playground, save your settings, and open the hosted preview. To try the embed, paste the copied script into a page served from a domain on the allowlist. A page opened as a `file://` URL has no normal web origin and will be rejected.

## Project structure

- `src/app`: public landing page, sign-in, authenticated dashboard and inbox, chat playground, and authenticated/public chat, crawl, feedback, lead, and source API routes.
- `src/db`: Drizzle schema and database connection.
- `src/lib/workspace.ts`: server-side authentication and workspace resolution.
- `src/lib/ai`: server-only embedding, retrieval, and grounded chat model calls.
- `src/lib/crawler.ts`: safe URL fetching, robots and sitemap discovery, link fallback, and readable-text extraction.
- `drizzle`: generated, version-controlled database migrations.

## Current scope

M0 established authentication and the initial workspace boundary. M1 adds one chatbot per workspace, pasted-text sources, chunking, OpenAI embeddings, and pgvector storage. M2 adds authenticated streaming answers, chunk citations, threshold fallbacks, saved conversations, a prompt/retrieval debug panel, and a 30-question RAG evaluation harness. M3 adds website discovery and crawling, progress tracking, source URL citations, and source/chunk management. M4 adds a hosted public chat page, embed snippet, isolated visitor widget, appearance settings, origin allowlist, and a basic per-process rate limit. M5 adds the workspace inbox, visitor feedback, consent-based lead capture, lead export, and basic analytics. File uploads and billing remain M6.
