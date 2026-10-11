import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { chatbots, chunks, crawlJobs, sources } from "@/db/schema";
import { EmbeddingError, embedTexts } from "@/lib/ai/embed";
import { findApiChatbot } from "@/lib/api-chatbot";
import { CrawlError, extractWebsitePage, MAX_CRAWL_PAGES } from "@/lib/crawler";
import { chunkText } from "@/lib/text-chunking";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ chatbotId: string; crawlJobId: string }> };
type PageResult = {
  url: string;
  requestedUrl?: string;
  title?: string;
  status: string;
  message?: string;
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CRAWL_HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_CRAWL_AFTER_MS = 45_000;

function send(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) {
  controller.enqueue(
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const { chatbotId, crawlJobId } = await context.params;
  const access = await findApiChatbot(chatbotId);
  if ("response" in access) return access.response;
  const { chatbot } = access;
  if (!UUID_PATTERN.test(crawlJobId)) {
    return Response.json({ error: "Crawl job not found." }, { status: 404 });
  }
  let [job] = await db
    .select()
    .from(crawlJobs)
    .where(and(eq(crawlJobs.id, crawlJobId), eq(crawlJobs.chatbotId, chatbot.id)))
    .limit(1);
  if (!job) return Response.json({ error: "Crawl job not found." }, { status: 404 });

  if (job.status === "running" && Date.now() - job.updatedAt.getTime() > STALE_CRAWL_AFTER_MS) {
    const recoveryMessage =
      "The crawl stopped before it finished. Discover the website again to retry these pages.";
    const recoveredResults = job.pageResults.map((result) =>
      ["queued", "fetching", "fetched"].includes(result.status)
        ? { ...result, status: "error", message: recoveryMessage }
        : result,
    );
    const staleBefore = new Date(Date.now() - STALE_CRAWL_AFTER_MS);
    const [recoveredJob] = await db
      .update(crawlJobs)
      .set({
        status: "failed",
        completedPages: job.totalPages,
        pageResults: recoveredResults,
        errorMessage: recoveryMessage,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(crawlJobs.id, job.id),
          eq(crawlJobs.chatbotId, chatbot.id),
          eq(crawlJobs.status, "running"),
          lt(crawlJobs.updatedAt, staleBefore),
        ),
      )
      .returning();
    if (recoveredJob) {
      job = recoveredJob;
    } else {
      const [currentJob] = await db
        .select()
        .from(crawlJobs)
        .where(and(eq(crawlJobs.id, crawlJobId), eq(crawlJobs.chatbotId, chatbot.id)))
        .limit(1);
      if (currentJob) job = currentJob;
    }
  }
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  const { chatbotId, crawlJobId } = await context.params;
  const access = await findApiChatbot(chatbotId);
  if ("response" in access) return access.response;
  const { chatbot } = access;
  if (!UUID_PATTERN.test(crawlJobId)) {
    return Response.json({ error: "Crawl job not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a valid JSON request." }, { status: 400 });
  }
  const rawUrls =
    typeof body === "object" && body !== null && "urls" in body ? body.urls : undefined;
  if (
    !Array.isArray(rawUrls) ||
    rawUrls.length === 0 ||
    rawUrls.length > MAX_CRAWL_PAGES ||
    rawUrls.some((url) => typeof url !== "string")
  ) {
    return Response.json(
      { error: `Select between 1 and ${MAX_CRAWL_PAGES} pages to crawl.` },
      { status: 400 },
    );
  }

  const [job] = await db
    .select()
    .from(crawlJobs)
    .where(and(eq(crawlJobs.id, crawlJobId), eq(crawlJobs.chatbotId, chatbot.id)))
    .limit(1);
  if (!job) return Response.json({ error: "Crawl job not found." }, { status: 404 });
  if (job.status !== "discovered") {
    return Response.json(
      { error: "This discovery has already been crawled. Discover pages again to retry." },
      { status: 409 },
    );
  }

  const selectedUrls = [...new Set(rawUrls as string[])];
  const discoveredByUrl = new Map(job.discoveredPages.map((page) => [page.url, page]));
  if (
    selectedUrls.length !== rawUrls.length ||
    selectedUrls.some((url) => !discoveredByUrl.has(url))
  ) {
    return Response.json({ error: "Choose pages from the discovery list." }, { status: 400 });
  }
  const selectedPages = selectedUrls.flatMap((url) => {
    const page = discoveredByUrl.get(url);
    return page ? [page] : [];
  });
  const initialResults: PageResult[] = selectedPages.map(({ url, title }) => ({
    url,
    title,
    status: "queued",
  }));
  const [claimedJob] = await db
    .update(crawlJobs)
    .set({
      status: "running",
      selectedUrls,
      totalPages: selectedPages.length,
      completedPages: 0,
      pageResults: initialResults,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(crawlJobs.id, job.id),
        eq(crawlJobs.chatbotId, chatbot.id),
        eq(crawlJobs.status, "discovered"),
      ),
    )
    .returning({ id: crawlJobs.id });
  if (!claimedJob) {
    return Response.json({ error: "This discovery is already running." }, { status: 409 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let disconnected = false;
      const emit = (event: string, data: unknown) => {
        if (disconnected) return;
        try {
          send(controller, event, data);
        } catch {
          disconnected = true;
        }
      };
      const results = [...initialResults];
      const extracted = [] as Awaited<ReturnType<typeof extractWebsitePage>>[];
      const hostname = new URL(job.rootUrl).hostname;
      const heartbeat = setInterval(() => {
        void db
          .update(crawlJobs)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(crawlJobs.id, job.id),
              eq(crawlJobs.chatbotId, chatbot.id),
              eq(crawlJobs.status, "running"),
            ),
          )
          .catch(() => undefined);
      }, CRAWL_HEARTBEAT_INTERVAL_MS);
      emit("progress", { phase: "fetching", completed: 0, total: selectedPages.length, results });

      try {
        for (let index = 0; index < selectedPages.length; index += 1) {
          const page = selectedPages[index];
          results[index] = { ...results[index], status: "fetching" };
          await db
            .update(crawlJobs)
            .set({ pageResults: results, updatedAt: new Date() })
            .where(and(eq(crawlJobs.id, job.id), eq(crawlJobs.chatbotId, chatbot.id)));
          emit("progress", {
            phase: "fetching",
            completed: index,
            total: selectedPages.length,
            currentUrl: page.url,
            results,
          });
          try {
            const pageContent = await extractWebsitePage(page.url, hostname);
            if (!extracted.some((existing) => existing.url === pageContent.url)) {
              extracted.push(pageContent);
            }
            results[index] = {
              url: pageContent.url,
              requestedUrl: page.url,
              title: pageContent.title,
              status: "fetched",
            };
          } catch (error) {
            results[index] = {
              url: page.url,
              title: page.title,
              status: "error",
              message: error instanceof CrawlError ? error.message : "This page could not be read.",
            };
          }
          await db
            .update(crawlJobs)
            .set({ completedPages: index + 1, pageResults: results, updatedAt: new Date() })
            .where(and(eq(crawlJobs.id, job.id), eq(crawlJobs.chatbotId, chatbot.id)));
          emit("progress", {
            phase: "fetching",
            completed: index + 1,
            total: selectedPages.length,
            results,
          });
        }

        const candidates = extracted.map((page) => ({
          page,
          chunks: chunkText(`${page.title}\nSource: ${page.url}\n\n${page.content}`),
        }));
        const existingSources = await db
          .select({ url: sources.url, rawContentHash: sources.rawContentHash })
          .from(sources)
          .where(eq(sources.chatbotId, chatbot.id));
        const existingHashes = new Map(
          existingSources.flatMap((source) =>
            source.url ? [[source.url, source.rawContentHash] as const] : [],
          ),
        );
        const unchangedUrls = new Set(
          candidates
            .filter(({ page }) => existingHashes.get(page.url) === page.rawContentHash)
            .map(({ page }) => page.url),
        );
        const pendingChunks = candidates.filter(({ page }) => !unchangedUrls.has(page.url));
        const flatChunks = pendingChunks.flatMap(({ page, chunks: textChunks }) =>
          textChunks.map((chunk) => ({ page, chunk })),
        );
        if (extracted.length === 0)
          throw new CrawlError("No readable page content was found to index.");

        emit("progress", {
          phase: flatChunks.length > 0 ? "embedding" : "indexing",
          completed: selectedPages.length,
          total: selectedPages.length,
          results,
          chunkCount: flatChunks.length,
        });
        const { embeddings } = await embedTexts(flatChunks.map(({ chunk }) => chunk.content));
        if (embeddings.length !== flatChunks.length) {
          throw new Error("The embedding provider returned an incomplete result.");
        }

        const indexedUrls = new Set<string>();
        await db.transaction(async (tx) => {
          for (const { page } of pendingChunks) {
            const [existing] = await tx
              .select({ id: sources.id, rawContentHash: sources.rawContentHash })
              .from(sources)
              .where(and(eq(sources.chatbotId, chatbot.id), eq(sources.url, page.url)))
              .limit(1)
              .for("update");
            if (existing?.rawContentHash === page.rawContentHash) {
              unchangedUrls.add(page.url);
              continue;
            }
            let sourceId = existing?.id;
            if (existing) {
              await tx.delete(chunks).where(eq(chunks.sourceId, existing.id));
              await tx
                .update(sources)
                .set({
                  name: page.title,
                  content: page.content,
                  charCount: page.content.length,
                  rawContentHash: page.rawContentHash,
                  status: "ready",
                  updatedAt: new Date(),
                })
                .where(eq(sources.id, existing.id));
            } else {
              const [created] = await tx
                .insert(sources)
                .values({
                  chatbotId: chatbot.id,
                  type: "webpage",
                  name: page.title,
                  url: page.url,
                  rawContentHash: page.rawContentHash,
                  content: page.content,
                  charCount: page.content.length,
                  status: "ready",
                })
                .returning({ id: sources.id });
              sourceId = created.id;
            }

            const savedSourceId = sourceId;
            if (!savedSourceId) throw new Error("The source could not be saved.");
            const sourceEmbeddings = flatChunks
              .map((entry, index) => ({ ...entry, embedding: embeddings[index] }))
              .filter((entry) => entry.page.url === page.url);
            await tx.insert(chunks).values(
              sourceEmbeddings.map(({ chunk, embedding }, index) => ({
                chatbotId: chatbot.id,
                sourceId: savedSourceId,
                content: chunk.content,
                chunkIndex: index,
                tokenCount: chunk.estimatedTokens,
                contentHash: createHash("sha256").update(chunk.content).digest("hex"),
                metadata: { sourceName: page.title, url: page.url },
                embedding,
              })),
            );
            indexedUrls.add(page.url);
          }
          await tx.update(chatbots).set({ status: "ready" }).where(eq(chatbots.id, chatbot.id));
        });

        const completedResults = results.map((result) => {
          if (result.status === "error") return result;
          const canonicalUrl = extracted.find((page) => page.url === result.url)?.url ?? result.url;
          const status = unchangedUrls.has(canonicalUrl)
            ? "unchanged"
            : indexedUrls.has(canonicalUrl)
              ? "ready"
              : "error";
          return {
            ...result,
            url: canonicalUrl,
            requestedUrl: result.requestedUrl ?? result.url,
            status,
            message: status === "error" ? "This page could not be indexed." : undefined,
          };
        });
        const errors = completedResults.filter((result) => result.status === "error").length;
        const status =
          errors === 0 ? "complete" : errors === completedResults.length ? "failed" : "partial";
        await db
          .update(crawlJobs)
          .set({
            status,
            completedPages: selectedPages.length,
            pageResults: completedResults,
            updatedAt: new Date(),
          })
          .where(and(eq(crawlJobs.id, job.id), eq(crawlJobs.chatbotId, chatbot.id)));
        emit("done", {
          status,
          completed: selectedPages.length,
          total: selectedPages.length,
          indexed: completedResults.filter((result) => result.status === "ready").length,
          unchanged: completedResults.filter((result) => result.status === "unchanged").length,
          failed: errors,
          results: completedResults,
        });
        if (!disconnected) controller.close();
      } catch (error) {
        const message =
          error instanceof EmbeddingError
            ? error.message
            : error instanceof CrawlError
              ? error.message
              : "The crawl could not be indexed. Please retry.";
        const failedResults = results.map((result) =>
          result.status === "fetched" ? { ...result, status: "error", message } : result,
        );
        await db
          .update(crawlJobs)
          .set({
            status: "failed",
            pageResults: failedResults,
            errorMessage: message,
            updatedAt: new Date(),
          })
          .where(and(eq(crawlJobs.id, job.id), eq(crawlJobs.chatbotId, chatbot.id)));
        emit("error", { message, results: failedResults });
        if (!disconnected) controller.close();
      } finally {
        clearInterval(heartbeat);
      }
    },
    cancel() {
      // Keep the checkpointed crawl running if a browser refreshes mid-stream.
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
