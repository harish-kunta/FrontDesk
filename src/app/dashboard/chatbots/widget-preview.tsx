"use client";

import { useRef } from "react";

export function WidgetPreview({
  chatbotId,
  chatbotName,
}: {
  chatbotId: string;
  chatbotName: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="m4-preview">
      <div className="m4-preview-heading">
        <div>
          <b>Hosted page preview</b>
          <span>Save changes, then refresh this preview.</span>
        </div>
        <button
          className="m4-preview-refresh"
          type="button"
          onClick={() => frameRef.current?.contentWindow?.location.reload()}
        >
          Refresh
        </button>
      </div>
      <iframe
        ref={frameRef}
        className="m4-preview-frame"
        src={`/b/${chatbotId}`}
        title={`${chatbotName} hosted chat preview`}
        loading="lazy"
      />
    </div>
  );
}
