"use client";

import { useActionState } from "react";
import { RETRIEVAL_THRESHOLD } from "@/lib/rag-config";
import { previewRetrieval, type RetrievalActionState } from "./actions";

const initialState: RetrievalActionState = {
  status: "idle",
  message:
    "Try a question that a visitor might ask. We’ll show which chunks are closest in meaning.",
  question: "",
  chunks: [],
  promptPreview: "",
};

export function SearchPlayground({ chatbotId }: { chatbotId: string }) {
  const action = previewRetrieval.bind(null, chatbotId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <section className="m1-panel m1-playground">
      <div className="m1-panel-heading">
        <div>
          <div className="eyebrow">RETRIEVAL PLAYGROUND</div>
          <h2>Try a visitor question</h2>
        </div>
        <span className="m1-model-pill">Cosine · top 5</span>
      </div>
      <form action={formAction} className="m1-search-form">
        <label className="m1-sr-only" htmlFor="retrieval-question">
          Question to search for
        </label>
        <input
          id="retrieval-question"
          name="question"
          defaultValue={state.question}
          maxLength={1_000}
          placeholder="e.g. When are you open?"
          required
        />
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Searching…" : "Search knowledge"}
        </button>
      </form>
      <p className={`m1-action-message ${state.status}`} aria-live="polite">
        {state.message}
      </p>

      {state.chunks.length > 0 && (
        <div className="m1-results">
          <div className="m1-results-heading">
            <h3>Nearest chunks</h3>
            <span>Only scores ≥ {RETRIEVAL_THRESHOLD.toFixed(2)} enter the context preview</span>
          </div>
          {state.chunks.map((chunk, rank) => (
            <article className="m1-result-card" key={`${chunk.sourceName}-${chunk.index}`}>
              <div className="m1-result-meta">
                <span>
                  #{rank + 1} · {chunk.sourceName} · chunk {chunk.index + 1}
                </span>
                <span
                  className={
                    chunk.similarity >= RETRIEVAL_THRESHOLD ? "m1-score match" : "m1-score"
                  }
                >
                  {chunk.similarity.toFixed(3)} similarity
                </span>
              </div>
              <p>{chunk.content}</p>
              <small>~{chunk.tokenCount} estimated tokens</small>
            </article>
          ))}
          <details className="m1-prompt-preview">
            <summary>Inspect the context prompt preview</summary>
            <p>This is prepared for the model, but M1 does not send a chat completion.</p>
            <pre>{state.promptPreview}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
