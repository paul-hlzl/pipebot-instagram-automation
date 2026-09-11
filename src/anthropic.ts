import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

export function anthropicAvailable(): boolean {
  return Boolean(getConfig().anthropicApiKey);
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

/**
 * Turns a customer's rough keywords into a concrete briefing paragraph (target audience,
 * topics, concrete benefit) the same length as what a customer would type themselves -
 * this replaces the "about" field's content, it doesn't write a marketing pitch about it.
 */
export async function improveBriefing(input: {
  company: string;
  industry: string;
  about: string;
}): Promise<string> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("KI-Vorschläge sind gerade nicht verfügbar.");
  }

  const system =
    "Du hilfst Kleinunternehmern, die Beschreibung ihres Unternehmens für automatisch generierte " +
    "Social-Media-Beiträge zu konkretisieren. Aus Firmenname, Branche und ein paar Stichworten machst " +
    "du EINEN kurzen, konkreten Absatz auf Deutsch (3-5 Sätze, maximal ca. 500 Zeichen): wer die " +
    "Zielgruppe ist, welche Themen relevant sind, und welcher konkrete Nutzen im Vordergrund steht. " +
    "Kein Marketing-Geschwafel, keine Anrede, keine Überschrift, keine Aufzählungszeichen, keine " +
    "Anführungszeichen um den ganzen Text - nur der Absatz selbst, so wie ihn der Kunde direkt in ein " +
    "Textfeld übernehmen könnte.";
  const user = `Firmenname: ${input.company || "(unbekannt)"}\nBranche: ${input.industry || "(unbekannt)"}\nStichworte des Kunden: ${input.about || "(keine)"}`;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        {
          model: anthropicModel,
          max_tokens: 400,
          system,
          messages: [{ role: "user", content: user }],
        },
        {
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 30_000,
        },
      ),
    2,
    "Anthropic improve-briefing",
  );

  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) {
    throw new ToolError("Die KI hat keinen Vorschlag geliefert.");
  }
  return text;
}

export interface WebsiteSuggestion {
  industry: string;
  about: string;
  tone: "sachlich" | "locker" | "inspirierend" | "humorvoll";
  hashtags: string[];
}

const VALID_TONES = ["sachlich", "locker", "inspirierend", "humorvoll"];

/**
 * Turns text extracted from a customer's own website into a briefing suggestion (industry,
 * about paragraph, tone, hashtags). Deliberately never suggests a color - scraping a brand
 * color reliably out of arbitrary CSS/inline styles isn't feasible, so the existing color
 * picker stays untouched and is the only source of truth for that.
 */
export async function suggestFromWebsite(input: { title: string; description: string; bodyText: string }): Promise<WebsiteSuggestion> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("KI-Vorschläge sind gerade nicht verfügbar.");
  }

  const system =
    "Du hilfst Kleinunternehmern, ihr Profil für automatisch generierte Social-Media-Beiträge auszufüllen, " +
    "basierend auf dem Text ihrer eigenen Website. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt - kein " +
    "einleitender Satz, kein Markdown-Codeblock, kein Text davor oder danach - nach genau diesem Schema: " +
    '{"industry": "kurze Branche, 2-4 Wörter", "about": "2-3 Sätze auf Deutsch: Zielgruppe, Themen, Nutzen - ' +
    'direkt und konkret, kein Marketing-Geschwafel", "tone": "genau eines von sachlich, locker, inspirierend, ' +
    'humorvoll", "hashtags": ["3 bis 5 Schlagwörter ohne Raute, kleingeschrieben, je ein Wort ohne Leerzeichen"]}. ' +
    "Schlage NIEMALS eine Farbe vor, das ist nicht Teil deiner Aufgabe. Mach eine plausible Bestapproximation, " +
    "auch wenn der Text wenig hergibt - liefere nie leere Felder ohne Versuch.";
  const user = `Titel der Seite: ${input.title || "(keiner)"}\nMeta-Beschreibung: ${input.description || "(keine)"}\nText von der Startseite:\n${input.bodyText || "(kein Text gefunden)"}`;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        {
          model: anthropicModel,
          max_tokens: 500,
          system,
          messages: [{ role: "user", content: user }],
        },
        {
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 30_000,
        },
      ),
    2,
    "Anthropic analyze-website",
  );

  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) {
    throw new ToolError("Die KI hat keinen Vorschlag geliefert.");
  }

  let parsed: unknown;
  try {
    // The model should never wrap in a code fence per the system prompt, but strip one
    // defensively in case it does anyway.
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ToolError("Die Antwort der KI konnte nicht gelesen werden.");
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const tone = VALID_TONES.includes(String(obj.tone)) ? (obj.tone as WebsiteSuggestion["tone"]) : "sachlich";
  const hashtags = Array.isArray(obj.hashtags)
    ? obj.hashtags
        .map((h) => String(h).replace(/^#/, "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    industry: typeof obj.industry === "string" ? obj.industry.trim().slice(0, 120) : "",
    about: typeof obj.about === "string" ? obj.about.trim().slice(0, 600) : "",
    tone,
    hashtags,
  };
}

/**
 * Suggests 3 short topic ideas for the "Jetzt posten" theme field - a single Anthropic call,
 * no tool loop, same pattern as improveBriefing/suggestFromWebsite. Told about recent post
 * headlines specifically so it doesn't re-suggest something already covered recently.
 */
export async function suggestTopics(input: {
  industry: string;
  about: string;
  tone: string;
  contentPillars: { title: string; description: string | null }[];
  recentHeadlines: string[];
}): Promise<string[]> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("KI-Vorschläge sind gerade nicht verfügbar.");
  }

  const system =
    "Du hilfst Kleinunternehmern, ein konkretes Thema für ihren nächsten Social-Media-Beitrag zu finden. " +
    "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt - kein einleitender Satz, kein Markdown-Codeblock, kein " +
    'Text davor oder danach - nach genau diesem Schema: {"topics": ["Thema 1", "Thema 2", "Thema 3"]}. ' +
    "Genau 3 Themenvorschläge, je EIN kurzer, konkreter Satz auf Deutsch (kein Hashtag, keine Anführungszeichen, " +
    "keine Nummerierung) - konkret genug, dass er direkt als Briefing für einen Beitrag dienen kann, nicht nur " +
    "ein Schlagwort. Schlage nichts vor, das den kürzlich veröffentlichten Themen inhaltlich zu ähnlich ist.";
  const pillarLines = input.contentPillars.length
    ? input.contentPillars.map((p) => `- ${p.title}${p.description ? `: ${p.description}` : ""}`).join("\n")
    : "(keine festgelegt)";
  const recentLines = input.recentHeadlines.length ? input.recentHeadlines.map((h) => `- ${h}`).join("\n") : "(keine)";
  const user =
    `Branche: ${input.industry || "(unbekannt)"}\n` +
    `Über das Unternehmen: ${input.about || "(keine Angabe)"}\n` +
    `Tonalität: ${input.tone || "sachlich"}\n` +
    `Content-Säulen:\n${pillarLines}\n\n` +
    `Zuletzt veröffentlichte Themen (nicht wiederholen):\n${recentLines}`;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        {
          model: anthropicModel,
          max_tokens: 300,
          system,
          messages: [{ role: "user", content: user }],
        },
        {
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 30_000,
        },
      ),
    2,
    "Anthropic suggest-topics",
  );

  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) {
    throw new ToolError("Die KI hat keinen Vorschlag geliefert.");
  }

  let parsed: unknown;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ToolError("Die Antwort der KI konnte nicht gelesen werden.");
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const topics = Array.isArray(obj.topics)
    ? obj.topics
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  if (!topics.length) {
    throw new ToolError("Die KI hat keinen Vorschlag geliefert.");
  }
  return topics;
}
