"use client";

import { useActionState, useEffect, useState } from "react";
import { saveWidgetSettings, type WidgetActionState } from "./actions";

const initialState: WidgetActionState = { status: "idle", message: "" };

export function WidgetSettingsForm({
  chatbotId,
  config,
}: {
  chatbotId: string;
  config: {
    color: string;
    avatarUrl?: string;
    position: "left" | "right";
    welcomeMessage: string;
    starterQuestions: string[];
    allowedDomains: string[];
  };
}) {
  const action = saveWidgetSettings.bind(null, chatbotId);
  const [state, formAction, pending] = useActionState(action, initialState);
  const [baseUrl, setBaseUrl] = useState("https://your-frontdesk-domain.com");
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${baseUrl}/widget.js" data-chatbot-id="${chatbotId}" defer></script>`;

  useEffect(() => setBaseUrl(window.location.origin), []);

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      <form action={formAction} className="m1-form m4-settings-form">
        <div className="m4-settings-grid">
          <label className="m1-field">
            <span>Brand color</span>
            <input name="color" type="color" defaultValue={config.color} />
          </label>
          <label className="m1-field">
            <span>Widget position</span>
            <select name="position" defaultValue={config.position}>
              <option value="right">Bottom right</option>
              <option value="left">Bottom left</option>
            </select>
          </label>
        </div>
        <label className="m1-field">
          <span>Avatar image URL</span>
          <input
            name="avatarUrl"
            type="url"
            defaultValue={config.avatarUrl ?? ""}
            placeholder="https://example.com/support-avatar.png"
          />
          <small>
            Optional HTTPS image. Leave blank to show the first letter of your bot name.
          </small>
        </label>
        <label className="m1-field">
          <span>Welcome message</span>
          <input
            name="welcomeMessage"
            defaultValue={config.welcomeMessage}
            maxLength={240}
            required
          />
          <small>Visitors see this as the first message from the assistant.</small>
        </label>
        <label className="m1-field">
          <span>Starter questions</span>
          <textarea
            name="starterQuestions"
            rows={3}
            defaultValue={config.starterQuestions.join("\n")}
            placeholder={"What services do you offer?\nHow can I contact you?"}
          />
          <small>One per line, up to three. These appear before the visitor starts chatting.</small>
        </label>
        <label className="m1-field">
          <span>Allowed website domains</span>
          <textarea
            name="allowedDomains"
            rows={3}
            defaultValue={config.allowedDomains.join("\n")}
            placeholder={"example.com\nwww.example.com"}
          />
          <small>
            One domain per line. Embedded chat requests from other websites will be rejected.
          </small>
        </label>
        <div className="m1-form-footer">
          <p className={`m1-action-message ${state.status}`} aria-live="polite">
            {state.message || "Your hosted chat page works without adding a domain."}
          </p>
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save appearance"}
          </button>
        </div>
      </form>

      <div className="m4-embed-card">
        <div>
          <b>Embed on your website</b>
          <p>Save an allowed domain above, then paste this snippet before the closing body tag.</p>
        </div>
        <code>{snippet}</code>
        <button className="button button-secondary" type="button" onClick={copySnippet}>
          {copied ? "Copied" : "Copy snippet"}
        </button>
      </div>
    </>
  );
}
