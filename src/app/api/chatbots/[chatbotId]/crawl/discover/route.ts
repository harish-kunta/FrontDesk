import { db } from "@/db";
import { crawlJobs } from "@/db/schema";
import { findApiChatbot } from "@/lib/api-chatbot";
import { CrawlError, discoverWebsitePages } from "@/lib/crawler";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ chatbotId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { chatbotId } = await context.params;
  const access = await findApiChatbot(chatbotId);
  if ("response" in access) return access.response;
  const { chatbot } = access;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a valid JSON request." }, { status: 400 });
  }
  const rawUrl =
    typeof body === "object" && body !== null && "url" in body && typeof body.url === "string"
      ? body.url.trim()
      : "";
  if (!rawUrl || rawUrl.length > 2_048) {
    return Response.json({ error: "Enter a website URL up to 2,048 characters." }, { status: 400 });
  }

  try {
    const result = await discoverWebsitePages(rawUrl);
    const [job] = await db
      .insert(crawlJobs)
      .values({ chatbotId: chatbot.id, rootUrl: result.rootUrl, discoveredPages: result.pages })
      .returning({ id: crawlJobs.id });
    return Response.json(
      { crawlId: job.id, rootUrl: result.rootUrl, pages: result.pages },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof CrawlError
            ? error.message
            : "Pages could not be discovered. Please retry.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
