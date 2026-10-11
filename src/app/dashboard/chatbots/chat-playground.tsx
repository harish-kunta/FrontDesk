"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

type Citation = {
  id: string;
  sourceName: string;
  sourceUrl?: string | null;
  chunkIndex: number;
  reference: number;
};
type PlaygroundMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  isFallback: boolean;
  usage?: { inputTokens: number | null; outputTokens: number | null } | null;
  latencyMs?: number | null;
};
type DebugChunk = {
  id: string;
  sourceName: string;
  chunkIndex: number;
  content: string;
  tokenCount?: number;
  similarity: number;
};
type DebugInfo = {
  threshold: number;
  model: string;
  retrieved: DebugChunk[];
  usedChunks: DebugChunk[];
  prompt: string;
  queryRewrite?: {
    original: string;
    rewritten: string | null;
    similarityBefore: number;
    similarityAfter: number;
  } | null;
};

const starterQuestions = [
  "How much is expedited shipping?",
  "Can I return a used daypack?",
  "Does Harbor & Pine ship to Canada?",
];

function parseEventFrame(frame: string) {
  const lines = frame.split(/\r?\n/);
  const event =
    lines
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim() ?? "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function ChatPlayground({ chatbotId, model }: { chatbotId: string; model: string }) {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [notice, setNotice] = useState("");
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const storageKey = `frontdesk:playground:${chatbotId}`;
    const savedConversationId = window.localStorage.getItem(storageKey);
    setConversationId(savedConversationId);
    setMessages([]);
    setDebug(null);
    setNotice("");

    if (!savedConversationId) {
      setLoadingHistory(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingHistory(true);
    fetch(
      `/api/chatbots/${chatbotId}/chat?conversationId=${encodeURIComponent(savedConversationId)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved conversation could not be loaded.");
        return (await response.json()) as {
          messages: PlaygroundMessage[];
        };
      })
      .then((result) => {
        if (!cancelled) setMessages(result.messages);
      })
      .catch(() => {
        if (cancelled) return;
        window.localStorage.removeItem(storageKey);
        setConversationId(null);
        setNotice("The saved conversation could not be loaded. Start a new one below.");
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatbotId]);

  useEffect(() => {
    if (messages.length === 0 && !pending) return;
    streamEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  function startNewConversation() {
    window.localStorage.removeItem(`frontdesk:playground:${chatbotId}`);
    setConversationId(null);
    setMessages([]);
    setDebug(null);
    setNotice("");
  }

  async function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanQuestion = question.trim();
    if (!cleanQuestion || pending) return;

    const userId = `local-user-${crypto.randomUUID()}`;
    const assistantId = `local-assistant-${crypto.randomUUID()}`;
    setQuestion("");
    setNotice("");
    setDebug(null);
    setPending(true);
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", content: cleanQuestion, citations: [], isFallback: false },
      { id: assistantId, role: "assistant", content: "", citations: [], isFallback: false },
    ]);

    const updateAssistant = (update: Partial<PlaygroundMessage>) => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, ...update } : message,
        ),
      );
    };

    try {
      const response = await fetch(`/api/chatbots/${chatbotId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ question: cleanQuestion, conversationId }),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "The assistant could not answer. Please retry.");
      }
      if (!response.body) throw new Error("The answer stream was empty. Please retry.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let partialAnswer = "";

      const handleFrame = (frame: string) => {
        const parsed = parseEventFrame(frame);
        if (!parsed) return;
        const { event: eventName, data } = parsed;

        if (eventName === "conversation" && typeof data.conversationId === "string") {
          setConversationId(data.conversationId);
          window.localStorage.setItem(`frontdesk:playground:${chatbotId}`, data.conversationId);
        } else if (eventName === "context") {
          setDebug(data as unknown as DebugInfo);
        } else if (eventName === "delta" && typeof data.delta === "string") {
          partialAnswer += data.delta;
          updateAssistant({ content: partialAnswer });
        } else if (eventName === "replace" && typeof data.answer === "string") {
          partialAnswer = data.answer;
          updateAssistant({ content: partialAnswer });
        } else if (eventName === "done") {
          const finalAnswer = typeof data.answer === "string" ? data.answer : partialAnswer;
          partialAnswer = finalAnswer;
          updateAssistant({
            content: finalAnswer,
            citations: Array.isArray(data.citations) ? (data.citations as Citation[]) : [],
            isFallback: data.fallback === true,
            usage:
              typeof data.usage === "object" && data.usage !== null
                ? (data.usage as PlaygroundMessage["usage"])
                : null,
            latencyMs: typeof data.latencyMs === "number" ? data.latencyMs : null,
          });
          if (typeof data.error === "string") setNotice(data.error);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.match(/\r?\n\r?\n/);
        while (separator?.index !== undefined) {
          const frame = buffer.slice(0, separator.index);
          buffer = buffer.slice(separator.index + separator[0].length);
          handleFrame(frame);
          separator = buffer.match(/\r?\n\r?\n/);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleFrame(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant could not answer.";
      updateAssistant({ content: message, isFallback: true });
      setNotice(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="m1-panel m2-chat-panel">
      <div className="m1-panel-heading">
        <div>
          <div className="eyebrow">GROUNDED CHAT</div>
          <h2>Talk to your assistant</h2>
        </div>
        <span className="m1-model-pill">{model} · streaming</span>
      </div>
      <p className="m1-intro-copy">
        Answers use retrieved passages from this chatbot’s sources. Source numbers like [1] link the
        answer to passages below.
      </p>

      <div
        className="m2-chat-window"
        role="log"
        aria-live="polite"
        aria-label="Assistant conversation"
      >
        {loadingHistory ? (
          <div className="m2-chat-empty">Loading this browser’s saved conversation…</div>
        ) : messages.length === 0 ? (
          <div className="m2-chat-empty">
            <span className="m1-empty-icon">◈</span>
            <b>Ask a question grounded in your sources</b>
            <span>The assistant will cite the passages it used, or say when it cannot answer.</span>
            <div className="m2-starter-list">
              {starterQuestions.map((starter) => (
                <button
                  className="m2-starter"
                  key={starter}
                  onClick={() => setQuestion(starter)}
                  type="button"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="m2-message-list">
            {messages.map((message) => (
              <article className={`m2-message ${message.role}`} key={message.id}>
                <div className="m2-message-label">
                  {message.role === "assistant" ? "Assistant" : "You"}
                  {message.isFallback && message.role === "assistant" && (
                    <span className="m2-fallback-tag">Fallback</span>
                  )}
                </div>
                <p>{message.content || (pending ? "Thinking…" : "")}</p>
                {message.citations.length > 0 && (
                  <div className="m2-citations">
                    <span>Sources</span>
                    {message.citations.map((citation) =>
                      citation.sourceUrl ? (
                        <a
                          className="m2-citation"
                          href={citation.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          key={citation.id}
                        >
                          [{citation.reference}] {citation.sourceName} · passage{" "}
                          {citation.chunkIndex + 1} ↗
                        </a>
                      ) : (
                        <span className="m2-citation" key={citation.id}>
                          [{citation.reference}] {citation.sourceName} · passage{" "}
                          {citation.chunkIndex + 1}
                        </span>
                      ),
                    )}
                  </div>
                )}
                {message.role === "assistant" && message.latencyMs !== undefined && (
                  <small className="m2-message-stats">
                    {message.latencyMs} ms
                    {message.usage?.inputTokens != null &&
                      ` · ${message.usage.inputTokens} input tokens`}
                    {message.usage?.outputTokens != null &&
                      ` · ${message.usage.outputTokens} output tokens`}
                  </small>
                )}
              </article>
            ))}
            <div ref={streamEndRef} />
          </div>
        )}
      </div>

      {notice && (
        <p className="m1-action-message error" role="status">
          {notice}
        </p>
      )}

      <form className="m2-chat-form" onSubmit={sendQuestion}>
        <label className="m1-sr-only" htmlFor="visitor-question">
          Ask the assistant a question
        </label>
        <textarea
          id="visitor-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={2_000}
          placeholder="Ask a question about your sources…"
          rows={2}
          disabled={pending || loadingHistory}
        />
        <div className="m2-chat-form-footer">
          <span>Conversation stays in this browser and workspace.</span>
          <div>
            {messages.length > 0 && (
              <button
                className="button m1-button-quiet"
                type="button"
                disabled={pending}
                onClick={startNewConversation}
              >
                New conversation
              </button>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={pending || loadingHistory || !question.trim()}
            >
              {pending ? "Answering…" : "Send question"}
            </button>
          </div>
        </div>
      </form>

      {debug && (
        <details className="m1-prompt-preview m2-debug-panel">
          <summary>Debug this answer · retrieval, prompt, and model</summary>
          <div className="m2-debug-summary">
            <span>{debug.retrieved.length} passages searched</span>
            <span>{debug.usedChunks.length} passages sent to the model</span>
            <span>Cosine threshold {debug.threshold.toFixed(2)}</span>
          </div>
          {debug.queryRewrite && (
            <p>
              Search spelling recovery: “{debug.queryRewrite.original}” → “
              {debug.queryRewrite.rewritten}” ({debug.queryRewrite.similarityBefore.toFixed(3)} →{" "}
              {debug.queryRewrite.similarityAfter.toFixed(3)} similarity)
              {debug.queryRewrite.similarityAfter > debug.queryRewrite.similarityBefore &&
              debug.queryRewrite.similarityAfter >= debug.threshold
                ? " · improved search used"
                : " · no stronger grounded match; original question kept the fallback"}
            </p>
          )}
          <div className="m2-debug-chunks">
            {debug.retrieved.map((chunk, index) => (
              <article className="m2-debug-chunk" key={chunk.id}>
                <b>
                  #{index + 1} · {chunk.sourceName} · passage {chunk.chunkIndex + 1}
                </b>
                <span className={chunk.similarity >= debug.threshold ? "match" : ""}>
                  {chunk.similarity.toFixed(3)} similarity
                  {chunk.similarity >= debug.threshold ? " · used" : " · below threshold"}
                </span>
                <p>{chunk.content}</p>
              </article>
            ))}
            {debug.retrieved.length === 0 && <p>No passages were indexed for this chatbot yet.</p>}
          </div>
          <label className="m2-prompt-label" htmlFor="exact-chat-prompt">
            {debug.usedChunks.length > 0
              ? `Exact instructions and conversation input sent to ${debug.model}`
              : "Model call blocked by the retrieval threshold"}
          </label>
          <pre id="exact-chat-prompt">{debug.prompt}</pre>
        </details>
      )}
    </section>
  );
}
