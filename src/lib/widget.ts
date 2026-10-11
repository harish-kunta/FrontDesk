import "server-only";

export type WidgetConfig = {
  color: string;
  avatarUrl?: string;
  position: "left" | "right";
  welcomeMessage: string;
  starterQuestions: string[];
  allowedDomains: string[];
};

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  color: "#7065e8",
  position: "right",
  welcomeMessage: "Hi! How can I help you today?",
  starterQuestions: [],
  allowedDomains: [],
};

export function normalizeDomain(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  if (!candidate || candidate.includes("/") || candidate.includes("@") || candidate.includes(":")) {
    return null;
  }
  try {
    const parsed = new URL(`https://${candidate}`);
    if (parsed.hostname !== candidate || (!candidate.includes(".") && candidate !== "localhost")) {
      return null;
    }
    return parsed.hostname;
  } catch {
    return null;
  }
}

export function originIsAllowed(
  origin: string | null,
  config: WidgetConfig,
  serviceOrigin: string,
) {
  if (!origin) return false;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  let serviceHostname = "";
  try {
    serviceHostname = new URL(serviceOrigin).hostname.toLowerCase();
  } catch {
    // A malformed request URL should not make the origin trusted.
  }

  if (hostname === serviceHostname) return true;
  return config.allowedDomains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

export function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
