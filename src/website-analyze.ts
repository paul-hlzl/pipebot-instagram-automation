import { fetchTextSafely } from "./ssrf-safe-fetch.js";
import { suggestFromWebsite, type WebsiteSuggestion } from "./anthropic.js";
import { ToolError } from "./errors.js";

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

interface PageText {
  title: string;
  description: string;
  bodyText: string;
}

/**
 * Deliberately simple regex-based extraction, not a real HTML parser - good enough for feeding
 * an LLM approximate context, not for anything that needs to be exact. Never touches images or
 * CSS (colors especially - see website-analyze design notes: scraping a color from CSS/inline
 * styles is unreliable, the existing color picker stays the source of truth for that).
 */
export function extractPageText(html: string): PageText {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, " ").trim().slice(0, 200) : "";

  const descMatch =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html);
  const description = descMatch ? decodeHtmlEntities(descMatch[1]).replace(/\s+/g, " ").trim().slice(0, 400) : "";

  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  const bodyText = decodeHtmlEntities(stripped).replace(/\s+/g, " ").trim().slice(0, 2000);

  return { title, description, bodyText };
}

/** Fetches a customer's website (SSRF-safe), extracts visible text, and asks Anthropic for a briefing suggestion. */
export async function analyzeWebsite(rawUrl: string): Promise<WebsiteSuggestion> {
  const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;

  let html: string;
  try {
    html = await fetchTextSafely(url, 8000);
  } catch (err) {
    throw new ToolError(err instanceof Error ? err.message : "Die Website konnte nicht abgerufen werden.");
  }

  const page = extractPageText(html);
  if (!page.title && !page.description && !page.bodyText) {
    throw new ToolError("Auf dieser Seite konnte kein Text gefunden werden.");
  }

  return suggestFromWebsite(page);
}
