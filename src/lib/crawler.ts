import "server-only";

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readability } from "@mozilla/readability";
import ipaddr from "ipaddr.js";
import { JSDOM } from "jsdom";
import robotsParser from "robots-parser";

export const CRAWLER_USER_AGENT = "FrontDeskBot/0.1";
export const MAX_CRAWL_PAGES = 20;
const MAX_SITEMAPS = 5;
const MAX_HTML_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 12_000;
const REQUEST_GAP_MS = 550;
const MIN_READABLE_TEXT_CHARS = 80;

export type DiscoveredPage = { url: string; title: string };
export type ExtractedPage = DiscoveredPage & { content: string; rawContentHash: string };

export class CrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlError";
  }
}

const lastRequestByHost = new Map<string, number>();
const minimumGapByHost = new Map<string, number>();

function normalizeUrl(rawUrl: string, base?: URL) {
  let url: URL;
  try {
    url = new URL(rawUrl, base);
  } catch {
    throw new CrawlError("Enter a valid website URL, including https://.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new CrawlError("Only public HTTP and HTTPS websites can be crawled.");
  }
  if (url.toString().length > 2_048) throw new CrawlError("This website URL is too long.");
  if (url.username || url.password)
    throw new CrawlError("Website URLs cannot contain credentials.");
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    throw new CrawlError("Only websites on the standard HTTP or HTTPS ports can be crawled.");
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url;
}

function isPublicAddress(address: string) {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}

async function resolvePublicAddress(hostname: string) {
  const cleanHostname = hostname.replace(/^\[|\]$/g, "");
  if (
    cleanHostname === "localhost" ||
    cleanHostname.endsWith(".localhost") ||
    cleanHostname.endsWith(".local") ||
    cleanHostname.endsWith(".internal")
  ) {
    throw new CrawlError("Private and local network addresses cannot be crawled.");
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    if (ipaddr.isValid(cleanHostname)) {
      const parsed = ipaddr.parse(cleanHostname);
      addresses = [{ address: cleanHostname, family: parsed.kind() === "ipv4" ? 4 : 6 }];
    } else {
      addresses = await lookup(cleanHostname, { all: true, verbatim: true });
    }
  } catch {
    throw new CrawlError("The website hostname could not be resolved.");
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new CrawlError("This website resolves to a private or reserved network address.");
  }
  return addresses[0];
}

async function waitForHost(hostname: string) {
  const previousRequestAt = lastRequestByHost.get(hostname) ?? 0;
  const minimumGap = Math.max(REQUEST_GAP_MS, minimumGapByHost.get(hostname) ?? 0);
  const delay = minimumGap - (Date.now() - previousRequestAt);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  lastRequestByHost.set(hostname, Date.now());
}

type FetchedResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

async function requestOnce(url: URL, maxBytes: number): Promise<FetchedResponse> {
  const resolved = await resolvePublicAddress(url.hostname);
  const lookupPinned: LookupFunction = (_hostname, options, callback) => {
    callback(
      null,
      options.all ? [{ address: resolved.address, family: resolved.family }] : resolved.address,
      resolved.family,
    );
  };

  await waitForHost(url.hostname);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const request = transport(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": CRAWLER_USER_AGENT,
          Accept:
            "text/html, application/xhtml+xml, application/xml, text/xml, text/plain;q=0.9, */*;q=0.1",
          "Accept-Encoding": "identity",
        },
        timeout: REQUEST_TIMEOUT_MS,
        lookup: lookupPinned,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = response.headers;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          settled = true;
          resolve({ status, headers, body: "" });
          return;
        }

        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteLength += buffer.byteLength;
          if (byteLength > maxBytes) {
            request.destroy(new CrawlError("This page is larger than the crawler’s size limit."));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8") });
        });
        response.on("error", (error) => finishError(error));
      },
    );

    request.on("timeout", () =>
      request.destroy(new CrawlError("The website took too long to respond.")),
    );
    request.on("error", (error) => finishError(error));
    request.end();
  });
}

async function requestWithTimeoutRetry(url: URL, maxBytes: number) {
  try {
    return await requestOnce(url, maxBytes);
  } catch (error) {
    if (
      !(error instanceof CrawlError) ||
      error.message !== "The website took too long to respond."
    ) {
      throw error;
    }
    return requestOnce(url, maxBytes);
  }
}

async function safeGet(startUrl: URL, expectedHostname: string, maxBytes = MAX_HTML_BYTES) {
  let current = new URL(startUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    current = normalizeUrl(current.toString());
    if (current.hostname !== expectedHostname) {
      throw new CrawlError("The website redirected to a different host, so it was not crawled.");
    }

    const response = await requestWithTimeoutRetry(current, maxBytes);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding !== "identity") {
        throw new CrawlError("The website returned a compressed response the crawler cannot read.");
      }
      return { ...response, url: current };
    }

    const location = response.headers.location;
    if (typeof location !== "string")
      throw new CrawlError("The website returned an invalid redirect.");
    const redirected = normalizeUrl(location, current);
    if (current.protocol === "https:" && redirected.protocol !== "https:") {
      throw new CrawlError("The website redirected from HTTPS to an insecure connection.");
    }
    current = redirected;
  }
  throw new CrawlError("The website redirected too many times.");
}

async function loadRobots(rootUrl: URL) {
  const robotsUrl = new URL("/robots.txt", rootUrl.origin);
  const response = await safeGet(robotsUrl, rootUrl.hostname, 256_000);
  if (response.status === 404 || response.status === 410) {
    return { canFetch: () => true, sitemaps: [] as string[] };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new CrawlError("The site’s robots.txt could not be read, so the crawler stopped safely.");
  }
  const robots = robotsParser(robotsUrl.toString(), response.body);
  const crawlDelay = robots.getCrawlDelay(CRAWLER_USER_AGENT) ?? 0;
  if (crawlDelay > 10) {
    throw new CrawlError("The site asks crawlers to wait more than 10 seconds between pages.");
  }
  minimumGapByHost.set(rootUrl.hostname, Math.max(REQUEST_GAP_MS, crawlDelay * 1_000));
  return {
    canFetch: (url: URL) => robots.isAllowed(url.toString(), CRAWLER_USER_AGENT) !== false,
    sitemaps: robots.getSitemaps(),
  };
}

function decodeXmlText(text: string) {
  return text
    .replace(/&#x([\da-f]+);/gi, (_match, value: string) => {
      const codePoint = Number.parseInt(value, 16);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "\uFFFD";
    })
    .replace(/&#(\d+);/g, (_match, value: string) => {
      const codePoint = Number(value);
      return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "\uFFFD";
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function readSitemapLocations(xml: string) {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].map((match) =>
    decodeXmlText(match[1]),
  );
}

function pageTitleFromUrl(url: URL) {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep the escaped path if it contains an invalid percent sequence.
  }
  const path = pathname.split("/").filter(Boolean).at(-1);
  return path?.replace(/[-_]+/g, " ") || url.hostname;
}

function extractFallbackContent(document: Document) {
  const fallbackDocument = document.cloneNode(true) as Document;
  const body = fallbackDocument.body;
  if (!body) return "";

  body
    .querySelectorAll(
      "script,style,noscript,template,svg,iframe,canvas,nav,[role='navigation'],form,[aria-hidden='true']",
    )
    .forEach((element) => {
      element.remove();
    });

  for (const element of body.querySelectorAll<HTMLElement>("[id], [class]")) {
    const identity = `${element.id} ${element.className}`;
    if (/cookie|consent|recaptcha|accessibility/i.test(identity)) element.remove();
  }

  const separatedHtml = body.innerHTML
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/[^>]+>/g, "\n")
    .replace(/<[^>]+>/g, " ");
  const textContainer = fallbackDocument.createElement("div");
  textContainer.innerHTML = separatedHtml;
  return (
    textContainer.textContent
      ?.split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n") ?? ""
  );
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asRecords(value: unknown) {
  return Array.isArray(value)
    ? value.map(asObject).filter((entry): entry is JsonObject => entry !== undefined)
    : [];
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatRange(value: unknown, kind: "currency" | "area") {
  const range = asObject(value);
  const min = asNumber(range?.min);
  const max = asNumber(range?.max);
  if (min === undefined && max === undefined) return "";
  const format = (amount: number) =>
    kind === "currency"
      ? `$${amount.toLocaleString("en-US")}`
      : `${amount.toLocaleString("en-US")} square feet`;
  if (min === undefined) return format(max as number);
  if (max === undefined || min === max) return format(min);
  return `${format(min)} to ${format(max)}`;
}

function formatModelRecord(model: JsonObject) {
  const label = asText(model.label) || asText(model.id);
  if (!label) return "";
  const details = [
    asNumber(model.beds) === undefined
      ? ""
      : `${model.beds} ${model.beds === 1 ? "bedroom" : "bedrooms"}`,
    asNumber(model.baths) === undefined
      ? ""
      : `${model.baths} ${model.baths === 1 ? "bathroom" : "bathrooms"}`,
    formatRange(model.sqft, "area"),
  ].filter(Boolean);
  const rent = formatRange(model.rent, "currency");
  if (rent) details.push(`${rent} per month`);
  const intro = asText(model.intro);
  const special = asText(model.special);
  const description = [intro, special].filter(Boolean).join(" ");
  return `Floor plan ${label}: ${details.join(", ")}.${description ? ` ${description}` : ""}`;
}

function formatUnitRecord(unit: JsonObject) {
  const id = asText(unit.id);
  if (!id) return "";
  const details = [
    asText(unit.model_id) ? `floor plan ${asText(unit.model_id)}` : "",
    asNumber(unit.beds) === undefined
      ? ""
      : `${unit.beds} ${unit.beds === 1 ? "bedroom" : "bedrooms"}`,
    asNumber(unit.baths) === undefined
      ? ""
      : `${unit.baths} ${unit.baths === 1 ? "bathroom" : "bathrooms"}`,
    formatRange(unit.sqft, "area"),
  ].filter(Boolean);
  const rent = formatRange(unit.rent, "currency");
  if (rent) details.push(`${rent} per month`);
  const building = asText(unit.building_id);
  const floor = asText(unit.floor_id);
  if (building) details.push(`building ${building}`);
  if (floor) details.push(`floor ${floor.split("_").at(-1)}`);
  if (unit.available === false) details.push("not currently listed as available");
  else if (unit.available === true) details.push("available now");
  else if (typeof unit.available === "string" && unit.available.startsWith("!Date:")) {
    details.push(`available ${unit.available.slice(6, 16)}`);
  }
  const intro = asText(unit.intro);
  const special = asText(unit.special);
  const description = [intro, special].filter(Boolean).join(" ");
  return `Unit ${id}: ${details.join(", ")}.${description ? ` ${description}` : ""}`;
}

function extractVikeInventoryContent(document: Document, url: URL) {
  const contextElement = document.querySelector<HTMLScriptElement>(
    'script#vike_pageContext[type="application/json"]',
  );
  if (!contextElement?.textContent) return "";

  try {
    const context = asObject(JSON.parse(contextElement.textContent));
    const state = asObject(context?.initialStoreState);
    const app = asObject(state?.$app);
    const inventory = asObject(state?.$inventory);
    if (!app || !inventory) return "";

    const parts: string[] = [];
    const appName = asText(app.name);
    if (appName) parts.push(`Property: ${appName}`);
    const address = asObject(app.address);
    const addressText = [
      asText(address?.address1),
      asText(address?.city),
      asText(address?.state),
      asText(address?.zip),
    ]
      .filter(Boolean)
      .join(", ");
    if (addressText) parts.push(`Address: ${addressText}`);
    const phone = asText(app.contactPhoneLibrary) || asText(app.contactPhone);
    if (phone) parts.push(`Contact phone: ${phone}`);
    const email = asText(app.contactEmail);
    if (email) parts.push(`Contact email: ${email}`);

    const models = asRecords(inventory.models);
    const units = asRecords(inventory.units);
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the escaped path when it contains an invalid percent sequence.
    }
    const modelDetail = path.match(/^\/models\/([^/]+)\/?$/i)?.[1];
    const unitDetail = path.match(/^\/units\/([^/]+)\/?$/i)?.[1];

    if (unitDetail) {
      const unit = units.find((entry) => asText(entry.id) === unitDetail);
      if (unit) {
        const model = models.find((entry) => asText(entry.id) === asText(unit.model_id));
        const unitText = formatUnitRecord(unit);
        if (unitText) parts.push(unitText);
        if (model) {
          const modelText = formatModelRecord(model);
          if (modelText) parts.push(modelText);
        }
      }
    } else {
      const selectedModels = modelDetail
        ? models.filter(
            (entry) => asText(entry.id) === modelDetail || asText(entry.label) === modelDetail,
          )
        : models;
      for (const model of selectedModels) {
        const modelText = formatModelRecord(model);
        if (modelText) parts.push(modelText);
        if (modelDetail) {
          const modelId = asText(model.id);
          const availableUnits = units
            .filter(
              (unit) =>
                asText(unit.model_id) === modelId &&
                (unit.available === true ||
                  (typeof unit.available === "string" && unit.available.startsWith("!Date:"))),
            )
            .slice(0, 12);
          for (const unit of availableUnits) {
            const unitText = formatUnitRecord(unit);
            if (unitText) parts.push(unitText);
          }
        }
      }
    }

    return parts.join("\n\n");
  } catch {
    return "";
  }
}

function parsePage(html: string, url: URL) {
  const dom = new JSDOM(html, { url: url.toString() });
  const document = dom.window.document;
  const title = document.title.trim() || pageTitleFromUrl(url);
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map(
    (anchor) => anchor.href,
  );
  const fallbackContent = extractFallbackContent(document);
  const structuredContent = extractVikeInventoryContent(document, url);
  const article = new Readability(document).parse();
  dom.window.close();
  const articleDom = new JSDOM(article?.content ?? "");
  const blockSelector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dt,dd,tr";
  const blocks = [...articleDom.window.document.body.querySelectorAll(blockSelector)];
  const content = blocks
    .filter((block) => !block.parentElement?.closest(blockSelector))
    .map((block) => block.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
  const articleContent =
    content || articleDom.window.document.body.textContent?.replace(/\s+/g, " ").trim() || "";
  articleDom.window.close();
  const fallback =
    fallbackContent.length >= MIN_READABLE_TEXT_CHARS ? fallbackContent : structuredContent;
  return {
    title: title.slice(0, 300),
    content: articleContent.length >= MIN_READABLE_TEXT_CHARS ? articleContent : fallback,
    links,
  };
}

function sameHostUrls(rawUrls: string[], rootUrl: URL) {
  const urls = new Map<string, DiscoveredPage>();
  for (const rawUrl of rawUrls) {
    try {
      const url = normalizeUrl(rawUrl, rootUrl);
      if (url.hostname !== rootUrl.hostname || !["", "80", "443"].includes(url.port)) continue;
      if (rootUrl.protocol === "https:" && url.protocol !== "https:") continue;
      url.searchParams.sort();
      const key = url.toString().replace(/\/$/, "") || url.origin;
      urls.set(key, { url: key, title: pageTitleFromUrl(url) });
    } catch {
      // Individual links may be malformed or use an unsupported protocol.
    }
  }
  return [...urls.values()];
}

async function discoverFromSitemaps(
  rootUrl: URL,
  sitemapUrls: string[],
  canFetch: (url: URL) => boolean,
) {
  const pending =
    sitemapUrls.length > 0
      ? [...sitemapUrls]
      : [new URL("/sitemap.xml", rootUrl.origin).toString()];
  const seenSitemaps = new Set<string>();
  const pageUrls: string[] = [];

  while (pending.length > 0 && seenSitemaps.size < MAX_SITEMAPS && pageUrls.length < 200) {
    const sitemapUrl = pending.shift();
    if (!sitemapUrl) break;
    let url: URL;
    try {
      url = normalizeUrl(sitemapUrl, rootUrl);
    } catch {
      continue;
    }
    if (
      url.hostname !== rootUrl.hostname ||
      (rootUrl.protocol === "https:" && url.protocol !== "https:") ||
      seenSitemaps.has(url.toString()) ||
      !canFetch(url)
    )
      continue;
    seenSitemaps.add(url.toString());

    let response: FetchedResponse;
    try {
      response = await safeGet(url, rootUrl.hostname, 2_000_000);
    } catch {
      continue;
    }
    if (response.status < 200 || response.status >= 300) continue;
    for (const location of readSitemapLocations(response.body)) {
      try {
        const page = normalizeUrl(location, rootUrl);
        if (page.hostname !== rootUrl.hostname) continue;
        if (/\.xml(?:\.gz)?(?:$|\?)/i.test(page.pathname)) pending.push(page.toString());
        else pageUrls.push(page.toString());
      } catch {
        // Ignore invalid sitemap entries and continue with the rest of the map.
      }
    }
  }

  return sameHostUrls(pageUrls, rootUrl).filter((page) => {
    try {
      return canFetch(new URL(page.url));
    } catch {
      return false;
    }
  });
}

async function discoverByLinks(rootUrl: URL, canFetch: (url: URL) => boolean) {
  const queue: Array<{ url: URL; depth: number }> = [{ url: rootUrl, depth: 0 }];
  const visited = new Set<string>();
  const pages: DiscoveredPage[] = [];

  while (queue.length > 0 && pages.length < MAX_CRAWL_PAGES) {
    const item = queue.shift();
    if (!item) break;
    const canonical = item.url.toString();
    if (visited.has(canonical) || !canFetch(item.url)) continue;
    visited.add(canonical);

    try {
      const response = await safeGet(item.url, rootUrl.hostname);
      const contentType = String(response.headers["content-type"] ?? "");
      if (response.status < 200 || response.status >= 300 || !contentType.includes("html"))
        continue;
      const parsed = parsePage(response.body, response.url);
      pages.push({ url: response.url.toString(), title: parsed.title });
      if (item.depth >= 2) continue;

      for (const candidate of sameHostUrls(parsed.links, rootUrl)) {
        const candidateUrl = new URL(candidate.url);
        if (!visited.has(candidateUrl.toString()))
          queue.push({ url: candidateUrl, depth: item.depth + 1 });
      }
    } catch {
      // A single unavailable page should not stop discovery for the whole site.
    }
  }

  return pages;
}

export async function discoverWebsitePages(rawRootUrl: string) {
  const rootUrl = normalizeUrl(rawRootUrl.trim());
  await resolvePublicAddress(rootUrl.hostname);
  const robots = await loadRobots(rootUrl);
  const fromSitemaps = await discoverFromSitemaps(rootUrl, robots.sitemaps, robots.canFetch);
  const discovered =
    fromSitemaps.length > 0 ? fromSitemaps : await discoverByLinks(rootUrl, robots.canFetch);
  const pages = discovered.slice(0, MAX_CRAWL_PAGES);
  if (pages.length === 0) {
    throw new CrawlError("No crawlable pages were found. Check the URL and the site’s robots.txt.");
  }
  return { rootUrl: rootUrl.toString(), pages };
}

export async function extractWebsitePage(
  rawUrl: string,
  expectedHostname: string,
): Promise<ExtractedPage> {
  const url = normalizeUrl(rawUrl);
  if (url.hostname !== expectedHostname)
    throw new CrawlError("A selected page is outside the discovered host.");
  const response = await safeGet(url, expectedHostname);
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (response.status < 200 || response.status >= 300) {
    throw new CrawlError(`The page returned HTTP ${response.status}.`);
  }
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new CrawlError("The selected URL is not an HTML page.");
  }

  const parsed = parsePage(response.body, response.url);
  if (parsed.content.length < MIN_READABLE_TEXT_CHARS) {
    throw new CrawlError(
      `The page contained only ${parsed.content.length} readable characters; at least ${MIN_READABLE_TEXT_CHARS} are needed to index.`,
    );
  }
  const rawContentHash = createHash("sha256").update(response.body).digest("hex");
  return {
    url: response.url.toString(),
    title: parsed.title,
    content: parsed.content.slice(0, 100_000),
    rawContentHash,
  };
}
