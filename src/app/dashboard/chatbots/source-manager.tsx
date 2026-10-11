"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SourceItem = {
  id: string;
  name: string;
  type: string;
  url: string | null;
  status: string;
  charCount: number;
  chunkCount: number;
  createdAt: string;
};
type SourceChunk = { id: string; content: string; chunkIndex: number; tokenCount: number };

export function SourceManager({
  chatbotId,
  sources,
}: {
  chatbotId: string;
  sources: SourceItem[];
}) {
  const router = useRouter();
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [chunksBySource, setChunksBySource] = useState<Record<string, SourceChunk[]>>({});
  const [loadingSourceId, setLoadingSourceId] = useState<string | null>(null);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function toggleChunks(sourceId: string) {
    setError("");
    if (openSourceId === sourceId) {
      setOpenSourceId(null);
      return;
    }
    setOpenSourceId(sourceId);
    if (chunksBySource[sourceId]) return;

    setLoadingSourceId(sourceId);
    try {
      const response = await fetch(`/api/chatbots/${chatbotId}/sources/${sourceId}/chunks`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { error?: string; chunks?: SourceChunk[] };
      const loadedChunks = payload.chunks;
      if (!response.ok || !loadedChunks)
        throw new Error(payload.error || "Chunks could not be loaded.");
      setChunksBySource((current) => ({ ...current, [sourceId]: loadedChunks }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chunks could not be loaded.");
      setOpenSourceId(null);
    } finally {
      setLoadingSourceId(null);
    }
  }

  async function deleteSource(source: SourceItem) {
    if (
      busySourceId ||
      !window.confirm(`Remove “${source.name}” and all ${source.chunkCount} indexed passages?`)
    ) {
      return;
    }
    setBusySourceId(source.id);
    setError("");
    try {
      const response = await fetch(`/api/chatbots/${chatbotId}/sources/${source.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "This source could not be removed.");
      setOpenSourceId(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This source could not be removed.");
    } finally {
      setBusySourceId(null);
    }
  }

  return (
    <>
      {error && (
        <p className="m1-action-message error" role="alert">
          {error}
        </p>
      )}
      <div className="m1-source-list">
        {sources.map((source) => (
          <article className="m3-source-card" key={source.id}>
            <div className="m1-source-row">
              <div className="m1-source-icon">{source.type === "webpage" ? "WEB" : "TXT"}</div>
              <div className="m1-source-copy">
                <b>{source.name}</b>
                <span>
                  {source.charCount.toLocaleString()} characters · {source.chunkCount} chunks ·{" "}
                  {new Date(source.createdAt).toLocaleDateString()}
                </span>
                {source.url && (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.url} ↗
                  </a>
                )}
              </div>
              <span className={`m1-source-status ${source.status}`}>{source.status}</span>
            </div>
            <div className="m3-source-actions">
              <button
                className="m3-select-all"
                type="button"
                aria-expanded={openSourceId === source.id}
                onClick={() => void toggleChunks(source.id)}
              >
                {loadingSourceId === source.id
                  ? "Loading passages…"
                  : openSourceId === source.id
                    ? "Hide passages"
                    : "View passages"}
              </button>
              <button
                className="m3-delete-source"
                type="button"
                disabled={busySourceId !== null}
                onClick={() => void deleteSource(source)}
              >
                {busySourceId === source.id ? "Removing…" : "Remove source"}
              </button>
            </div>
            {openSourceId === source.id && (
              <div className="m3-chunk-list">
                {(chunksBySource[source.id] ?? []).map((chunk) => (
                  <details className="m3-chunk-card" key={chunk.id}>
                    <summary>
                      Passage {chunk.chunkIndex + 1} · about {chunk.tokenCount.toLocaleString()}{" "}
                      tokens
                    </summary>
                    <pre>{chunk.content}</pre>
                  </details>
                ))}
                {chunksBySource[source.id]?.length === 0 && (
                  <p className="m3-no-chunks">This source has no indexed passages.</p>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
