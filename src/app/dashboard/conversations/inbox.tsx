"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type InboxRow = {
  id: string;
  chatbotName: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string;
  lastVisitorQuestion: string;
  hadFallback: boolean;
};

export function ConversationInbox({ rows }: { rows: InboxRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.chatbotName.toLowerCase().includes(needle) ||
        row.lastVisitorQuestion.toLowerCase().includes(needle),
    );
  }, [query, rows]);

  async function deleteConversation(id: string) {
    if (!window.confirm("Delete this conversation and its messages? This cannot be undone."))
      return;
    setDeleting(id);
    setError("");
    try {
      const response = await fetch(`/api/dashboard/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("The conversation could not be deleted.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The conversation could not be deleted.");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <label className="m1-field m5-search">
        <span>Search conversations</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search latest visitor question"
        />
      </label>
      {error && <p className="m1-action-message error">{error}</p>}
      {filteredRows.length === 0 ? (
        <div className="m5-empty-state">
          <b>{rows.length ? "No matching conversations" : "No conversations yet"}</b>
          <span>
            {rows.length
              ? "Try a different search term."
              : "Visitor chats will appear here when people start talking to your assistant."}
          </span>
        </div>
      ) : (
        <div className="m5-conversation-list">
          {filteredRows.map((row) => (
            <article className="m5-conversation-row" key={row.id}>
              <Link href={`/dashboard/conversations/${row.id}`} className="m5-conversation-link">
                <span className="m5-conversation-icon" aria-hidden="true">
                  ▤
                </span>
                <span className="m5-conversation-copy">
                  <b>{row.lastMessage || "New conversation"}</b>
                  <small>
                    {row.chatbotName} · {row.messageCount} messages ·{" "}
                    {new Date(row.updatedAt).toLocaleString()}
                  </small>
                </span>
                <span className={`m5-status-tag${row.hadFallback ? " unanswered" : ""}`}>
                  {row.hadFallback ? "Needs review" : "Answered"}
                </span>
              </Link>
              <button
                className="button m1-button-quiet m5-delete-button"
                type="button"
                disabled={deleting === row.id}
                onClick={() => deleteConversation(row.id)}
              >
                {deleting === row.id ? "Deleting…" : "Delete"}
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
