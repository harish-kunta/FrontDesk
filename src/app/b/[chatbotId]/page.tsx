import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { chatbots } from "@/db/schema";
import { WidgetLoader } from "./widget-loader";

type HostedChatPageProps = { params: Promise<{ chatbotId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function HostedChatPage({ params }: HostedChatPageProps) {
  const { chatbotId } = await params;
  if (!UUID_PATTERN.test(chatbotId)) notFound();
  const [chatbot] = await db
    .select({ id: chatbots.id, name: chatbots.name })
    .from(chatbots)
    .where(eq(chatbots.id, chatbotId))
    .limit(1);
  if (!chatbot) notFound();

  return (
    <main className="m4-hosted-page">
      <div className="m4-hosted-copy">
        <span className="brand-mark" aria-hidden="true">
          F
        </span>
        <p className="eyebrow">CHAT WITH</p>
        <h1>{chatbot.name}</h1>
        <p>Ask a question and get an answer grounded in this business’s information.</p>
        <span className="m4-hosted-hint">The chat assistant is ready below.</span>
      </div>
      <WidgetLoader chatbotId={chatbot.id} />
      <footer>Powered by FrontDesk</footer>
    </main>
  );
}
