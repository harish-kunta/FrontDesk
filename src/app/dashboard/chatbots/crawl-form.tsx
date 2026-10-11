"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

type Page = { url: string; title: string };
type PageResult = {
  url: string;
  requestedUrl?: string;
  title?: string;
  status: string;
  message?: string;
};
type CrawlProgress = {
  phase?: string;
  completed?: number;
  total?: number;
  currentUrl?: string;
  chunkCount?: number;
  indexed?: number;
  unchanged?: number;
  failed?: number;
  results?: PageResult[];
  message?: string;
};
type CrawlSnapshot = {
  rootUrl: string;
  status: string;
  discoveredPages: Page[];
  selectedUrls: string[];
  pageResults: PageResult[];
  totalPages: number;
  completedPages: number;
  errorMessage: string | null;
};

function parseFrame(frame: string) {
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
    return {
      event,
      data: JSON.parse(data) as CrawlProgress & { pages?: Page[]; crawlId?: string },
    };
  } catch {
    return null;
  }
}

export function CrawlForm({ chatbotId }: { chatbotId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [crawlId, setCrawlId] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<PageResult[]>([]);
  const [progress, setProgress] = useState<CrawlProgress>({});
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    const savedCrawlId = window.sessionStorage.getItem(`frontdesk:crawl:${chatbotId}`);
    if (!savedCrawlId) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const response = await fetch(`/api/chatbots/${chatbotId}/crawl/${savedCrawlId}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Saved crawl not found.");
        const snapshot = (await response.json()) as CrawlSnapshot;
        if (cancelled) return;
        setCrawlId(savedCrawlId);
        setUrl(snapshot.rootUrl);
        setPages(snapshot.discoveredPages);
        setSelected(snapshot.selectedUrls);
        setResults(snapshot.pageResults);
        setError(snapshot.errorMessage ?? "");
        setProgress(
          snapshot.status === "discovered"
            ? {}
            : {
                phase:
                  snapshot.status === "running"
                    ? snapshot.completedPages >= snapshot.totalPages
                      ? "embedding"
                      : "fetching"
                    : snapshot.status,
                completed: snapshot.completedPages,
                total: snapshot.totalPages,
                results: snapshot.pageResults,
              },
        );
        const isComplete = ["complete", "partial", "failed"].includes(snapshot.status);
        setComplete(isComplete);
        setBusy(snapshot.status === "running");
      } catch {
        window.sessionStorage.removeItem(`frontdesk:crawl:${chatbotId}`);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [chatbotId]);

  useEffect(() => {
    if (!crawlId || streaming) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/chatbots/${chatbotId}/crawl/${crawlId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const snapshot = (await response.json()) as CrawlSnapshot;
        if (cancelled) return;
        if (snapshot.status === "discovered") {
          setProgress({});
          return;
        }
        setResults(snapshot.pageResults);
        setError(snapshot.errorMessage ?? "");
        setProgress((current) => ({
          ...current,
          phase:
            snapshot.status === "running"
              ? snapshot.completedPages >= snapshot.totalPages
                ? "embedding"
                : current.phase || "fetching"
              : snapshot.status,
          completed: snapshot.completedPages,
          total: snapshot.totalPages,
          results: snapshot.pageResults,
        }));
        if (["complete", "partial", "failed"].includes(snapshot.status)) {
          setComplete(true);
          setBusy(false);
          router.refresh();
          return;
        }
        if (snapshot.status === "running") timer = setTimeout(poll, 900);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 1_500);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [chatbotId, crawlId, router, streaming]);

  async function discover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setError("");
    setComplete(false);
    setPages([]);
    setResults([]);
    setProgress({});
    setCrawlId(null);
    window.sessionStorage.removeItem(`frontdesk:crawl:${chatbotId}`);
    try {
      const response = await fetch(`/api/chatbots/${chatbotId}/crawl/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const payload = (await response.json()) as {
        error?: string;
        crawlId?: string;
        rootUrl?: string;
        pages?: Page[];
      };
      if (!response.ok || !payload.crawlId || !payload.pages) {
        throw new Error(payload.error || "Pages could not be discovered.");
      }
      setCrawlId(payload.crawlId);
      window.sessionStorage.setItem(`frontdesk:crawl:${chatbotId}`, payload.crawlId);
      setUrl(payload.rootUrl ?? url);
      setPages(payload.pages);
      setSelected(payload.pages.map((page) => page.url));
      setResults(payload.pages.map((page) => ({ ...page, status: "queued" })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pages could not be discovered.");
    } finally {
      setBusy(false);
    }
  }

  async function crawlSelected() {
    if (!crawlId || selected.length === 0 || busy) return;
    setBusy(true);
    setStreaming(true);
    setError("");
    setComplete(false);
    setProgress({ phase: "starting", completed: 0, total: selected.length });
    try {
      const response = await fetch(`/api/chatbots/${chatbotId}/crawl/${crawlId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ urls: selected }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "The crawl could not start.");
      }
      if (!response.body) throw new Error("The crawl did not return progress updates.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handleFrame = (frame: string) => {
        const parsed = parseFrame(frame);
        if (!parsed) return;
        setProgress((current) => ({ ...current, ...parsed.data }));
        if (Array.isArray(parsed.data.results)) setResults(parsed.data.results);
        if (parsed.event === "error") setError(parsed.data.message ?? "The crawl failed.");
        if (parsed.event === "done") {
          setProgress((current) => ({ ...current, ...parsed.data, phase: "complete" }));
          setComplete(true);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.match(/\r?\n\r?\n/);
        while (separator?.index !== undefined) {
          handleFrame(buffer.slice(0, separator.index));
          buffer = buffer.slice(separator.index + separator[0].length);
          separator = buffer.match(/\r?\n\r?\n/);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleFrame(buffer);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The crawl failed.");
    } finally {
      setStreaming(false);
      setBusy(false);
    }
  }

  const resultByUrl = new Map(
    results.flatMap((result) => [
      [result.url, result] as const,
      ...(result.requestedUrl ? [[result.requestedUrl, result] as const] : []),
    ]),
  );
  const percentage = complete
    ? 100
    : progress.phase === "embedding"
      ? 95
      : progress.phase === "indexing"
        ? 98
        : progress.total
          ? Math.min(90, Math.round(((progress.completed ?? 0) / progress.total) * 90))
          : 0;

  return (
    <div className="m3-crawler">
      <form className="m3-discover-form" onSubmit={discover}>
        <label className="m1-field m3-url-field">
          <span>Website URL</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://docs.example.com"
            maxLength={2_048}
            required
            disabled={busy}
          />
          <small>We follow the site’s robots.txt and inspect up to 20 same-host pages.</small>
        </label>
        <button className="button button-primary" type="submit" disabled={busy || !url.trim()}>
          {busy && !crawlId ? "Finding pages…" : "Discover pages"}
        </button>
      </form>

      {error && (
        <p className="m1-action-message error" role="alert">
          {error}
        </p>
      )}

      {pages.length > 0 && (
        <section className="m3-page-picker" aria-label="Discovered pages">
          <div className="m3-picker-heading">
            <div>
              <b>{pages.length} pages found</b>
              <span>Select the pages to add to your assistant.</span>
            </div>
            <button
              className="m3-select-all"
              type="button"
              onClick={() =>
                setSelected(selected.length === pages.length ? [] : pages.map((page) => page.url))
              }
              disabled={busy || complete}
            >
              {selected.length === pages.length ? "Clear selection" : "Select all"}
            </button>
          </div>
          <div className="m3-page-list">
            {pages.map((page) => {
              const result = resultByUrl.get(page.url);
              return (
                <label className="m3-page-option" key={page.url}>
                  <input
                    type="checkbox"
                    checked={selected.includes(page.url)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, page.url]
                          : current.filter((item) => item !== page.url),
                      )
                    }
                    disabled={busy || complete}
                  />
                  <span className="m3-page-copy">
                    <b>{page.title}</b>
                    <small>{page.url}</small>
                    {result?.message && <small className="m3-page-error">{result.message}</small>}
                  </span>
                  {result && result.status !== "queued" && (
                    <span className={`m3-page-status ${result.status}`}>{result.status}</span>
                  )}
                </label>
              );
            })}
          </div>
          {!complete && (
            <div className="m3-crawl-footer">
              <span>{selected.length} selected · unchanged pages are not re-embedded</span>
              <button
                className="button button-primary"
                type="button"
                disabled={busy || selected.length === 0}
                onClick={crawlSelected}
              >
                {busy ? "Crawling and indexing…" : "Crawl selected pages"}
              </button>
            </div>
          )}
        </section>
      )}

      {progress.total !== undefined && (
        <div className="m3-progress" role="status" aria-live="polite">
          <div className="m3-progress-heading">
            <b>
              {complete
                ? "Crawl complete"
                : progress.phase === "embedding"
                  ? "Embedding passages"
                  : progress.phase === "indexing"
                    ? "Saving indexed pages"
                    : "Reading pages"}
            </b>
            <span>
              {progress.completed ?? 0} / {progress.total} pages
              {progress.chunkCount ? ` · ${progress.chunkCount} chunks` : ""}
            </span>
          </div>
          <progress max={100} value={percentage} />
          {complete && (
            <p>
              {progress.indexed ?? 0} indexed · {progress.unchanged ?? 0} unchanged ·{" "}
              {progress.failed ?? 0} failed
            </p>
          )}
        </div>
      )}

      {complete && (
        <button
          className="button m1-button-quiet m3-reset-button"
          type="button"
          onClick={() => {
            window.sessionStorage.removeItem(`frontdesk:crawl:${chatbotId}`);
            setCrawlId(null);
            setPages([]);
            setSelected([]);
            setResults([]);
            setProgress({});
            setComplete(false);
            setError("");
          }}
        >
          Discover another website
        </button>
      )}
    </div>
  );
}
