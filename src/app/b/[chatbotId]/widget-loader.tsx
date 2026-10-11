"use client";

import { useEffect } from "react";

export function WidgetLoader({ chatbotId }: { chatbotId: string }) {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.async = true;
    script.dataset.chatbotId = chatbotId;
    script.dataset.hosted = "true";
    document.body.append(script);
    return () => script.remove();
  }, [chatbotId]);

  return null;
}
