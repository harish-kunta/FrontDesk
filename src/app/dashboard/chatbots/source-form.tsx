"use client";

import { useActionState } from "react";
import { ingestTextSource, type SourceActionState } from "./actions";

const initialState: SourceActionState = { status: "idle", message: "" };

export function SourceForm({ chatbotId }: { chatbotId: string }) {
  const action = ingestTextSource.bind(null, chatbotId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="m1-form">
      <label className="m1-field">
        <span>Source name</span>
        <input name="name" defaultValue="Business FAQ" maxLength={100} required />
      </label>
      <label className="m1-field">
        <span>Paste your FAQ, policies, or product notes</span>
        <textarea
          name="content"
          rows={11}
          maxLength={100_000}
          placeholder={
            "Example:\n\nWhat are your business hours?\nWe are open Monday through Friday, 9 AM to 5 PM Central Time."
          }
          required
        />
        <small>Up to 100,000 characters. The original text stays in your workspace.</small>
      </label>
      <div className="m1-form-footer">
        <p className={`m1-action-message ${state.status}`} aria-live="polite">
          {state.message || "Your text is split into chunks and embedded for semantic search."}
        </p>
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? "Chunking and embedding…" : "Index this text"}
        </button>
      </div>
    </form>
  );
}
