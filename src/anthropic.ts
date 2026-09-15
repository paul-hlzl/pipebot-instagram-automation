import axios from "axios";
import { getConfig } from "./config.js";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";

// Umlenkbar ueber die Umgebung, damit sich ein Ausfall des Dienstes gegen einen lokalen
// Stoersender proben laesst (scripts/fault-injector.mjs). Ohne die Variable unveraendert echt.
// Am Knopf wartet ein Mensch: zwei Versuche a 30 Sekunden bedeuten im Haengefall 62 Sekunden
// Stillstand vor der Fehlermeldung (gemessen). Interaktive Aufrufe bekommen deshalb EINEN Versuch
// mit 20 Sekunden Frist - die Hintergrund-Routine behaelt ihre zwei Versuche, dort wartet niemand.
const INTERAKTIV_TIMEOUT_MS = Number(process.env.ANTHROPIC_INTERACTIVE_TIMEOUT_MS ?? 20_000);
const INTERAKTIV_VERSUCHE = Number(process.env.ANTHROPIC_INTERACTIVE_ATTEMPTS ?? 1);

const ANTHROPIC_ENDPOINT = process.env.ANTHROPIC_ENDPOINT_OVERRIDE || "https://api.anthropic.com/v1/messages";

export function anthropicAvailable(): boolean {
  return Boolean(getConfig().anthropicApiKey);
}

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Rough cost estimate for usage_costs (Panel v9 Aufgabe 3) - not exact billing, just a visible
 *  order-of-magnitude figure for the admin overview. Rates as of the session that added this
 *  (2026-09) for the models this project actually uses; unrecognized model names fall back to
 *  Haiku 4.5's rate (the configured default, ANTHROPIC_MODEL) rather than guessing high. */
const MODEL_RATES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
};
export function estimateCostUsd(model: string, usage: { input_tokens?: number; output_tokens?: number } | undefined): number | null {
  if (!usage) return null;
  const key = Object.keys(MODEL_RATES_PER_MTOK).find((k) => model.startsWith(k)) ?? "claude-haiku-4-5";
  const rate = MODEL_RATES_PER_MTOK[key];
  return Math.round((((usage.input_tokens ?? 0) * rate.input + (usage.output_tokens ?? 0) * rate.output) / 1_000_000) * 1e6) / 1e6;
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
          timeout: INTERAKTIV_TIMEOUT_MS,
        },
      ),
    INTERAKTIV_VERSUCHE,
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
          timeout: INTERAKTIV_TIMEOUT_MS,
        },
      ),
    INTERAKTIV_VERSUCHE,
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
          timeout: INTERAKTIV_TIMEOUT_MS,
        },
      ),
    INTERAKTIV_VERSUCHE,
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

const HASHTAG_GUIDANCE: Record<string, string> = {
  keine: "KEINE Hashtags - die Caption endet ohne Hashtag-Zeile.",
  wenige: "2 bis 4 Hashtags am Ende der Caption.",
  viele: "10 bis 15 Hashtags am Ende der Caption.",
};

export interface PlannedPostContent {
  headline: string;
  caption: string;
  /** Panel v18: cost of THIS call only - a caller that retries once on a banned-word/required-
   *  element violation (see planning.ts's planOnePost) must sum both calls' costUsd itself. */
  costUsd: number | null;
}

/**
 * Direct, single-call content generation for planning.ts's server-side daily pre-planning
 * (Panel v5, task 4) - the same headline+caption writing job the K1-K9 cloud routine does
 * itself via its own model, but invoked here as a plain Anthropic call so the panel server can
 * produce a preview immediately, without waiting for the next routine run. Banned words/
 * required elements are given as hard instructions in the prompt; the caller (planning.ts)
 * still re-verifies them with assertNoBannedWords/assertRequiredElements afterwards - a prompt
 * instruction alone is not a guarantee, same reasoning as everywhere else in this codebase.
 */
export async function generatePlannedPostContent(input: {
  channel: "ig_feed" | "ig_story" | "linkedin";
  company: string;
  industry: string;
  about: string;
  tone: string;
  language: string;
  hashtagPreference: string;
  emojisEnabled: boolean;
  pillarTitle?: string | null;
  pillarDescription?: string | null;
  bannedWords: string[];
  requiredElements: string[];
  /** Recent caption texts (own posts) to match tone/emoji/hashtag style instead of guessing. */
  styleSamples: string[];
  /** Set only on the one retry after a hard-constraint violation - names what went wrong so the model avoids repeating it. */
  avoidNote?: string;
}): Promise<PlannedPostContent> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("KI-Vorschläge sind gerade nicht verfügbar.");
  }

  const isStory = input.channel === "ig_story";
  const languageName = input.language === "en" ? "English" : "Deutsch";
  const hashtagLine = isStory ? "Instagram Stories haben kein sichtbares Caption-Feld - caption bleibt ein leerer String." : HASHTAG_GUIDANCE[input.hashtagPreference] ?? HASHTAG_GUIDANCE.wenige;

  const system =
    `Du schreibst einen einzelnen Social-Media-Beitrag (${input.channel === "linkedin" ? "LinkedIn" : "Instagram"}) für ein ` +
    "Kleinunternehmen, im Rahmen einer automatischen Vorausplanung. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt - " +
    'kein einleitender Satz, kein Markdown-Codeblock, kein Text davor oder danach - nach genau diesem Schema: ' +
    '{"headline": "kurze Schlagzeile fuer das Bild, max. 6 Woerter", "caption": "der Beitragstext"}. ' +
    // 15.09.2026: Die Wortgrenze allein hat nicht gereicht. Entscheidend fuer das Bild ist nicht
    // die Wortzahl, sondern das LAENGSTE Wort - ein "KI-Content-Partner" (18 Zeichen) fuellt eine
    // Zeile schon allein. Die Bildkomposition trennt solche Woerter inzwischen selbst, aber eine
    // Schlagzeile ohne Bandwurmwort liest sich auf dem Bild deutlich besser als eine getrennte.
    "Die headline steht gross im Bild: hoechstens 45 Zeichen, und moeglichst kein Wort laenger " +
    "als 16 Zeichen - lange Komposita lieber auftrennen oder umschreiben. " +
    `Schreibe vollständig auf ${languageName}. Tonalität: ${input.tone || "sachlich"}. ` +
    `Emojis: ${input.emojisEnabled ? "sparsam und passend einsetzen" : "keine Emojis verwenden"}. ` +
    `Hashtags: ${hashtagLine} ` +
    "Wenn Beispiele eigener früherer Beiträge angegeben sind, orientiere dich an deren Tonfall, Emoji-Nutzung und " +
    "Hashtag-Stil, statt zu raten. " +
    (input.bannedWords.length ? `Verwende NIEMALS eines dieser Wörter: ${input.bannedWords.join(", ")}. ` : "") +
    (input.requiredElements.length
      ? isStory
        // Bugfix: bei Stories ist die Caption laut Vorgabe oben immer leer - "Headline oder
        // Caption" liess dem Modell hier faelschlich die Wahl und fuehrte dazu, dass Pflicht-
        // Elemente regelmaessig in der (dann verworfenen) Caption landeten statt in der
        // tatsaechlich geprueften Headline (siehe checkTextsFor in planning.ts). Jetzt eindeutig
        // auf die Headline festgelegt, wie bei publish_generated_story tatsaechlich validiert.
        ? `Baue JEDES der folgenden Elemente in die Headline ein - Instagram Stories haben keine Caption, es gibt keinen anderen Platz dafür: ${input.requiredElements.join(", ")}. `
        : `Baue JEDES der folgenden Elemente irgendwo ein (Headline oder Caption): ${input.requiredElements.join(", ")}. `
      : "") +
    (input.avoidNote ? `WICHTIG, vorheriger Versuch war ungültig: ${input.avoidNote} - korrigiere das jetzt.` : "");

  const pillarLine = input.pillarTitle ? `Content-Säule für diesen Beitrag: ${input.pillarTitle}${input.pillarDescription ? ` - ${input.pillarDescription}` : ""}` : "Keine Content-Säule festgelegt - nutze die allgemeine Unternehmensbeschreibung.";
  const samplesLine = input.styleSamples.length ? input.styleSamples.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(keine früheren Beiträge verfügbar)";
  const user =
    `Firma: ${input.company || "(unbekannt)"}\n` +
    `Branche: ${input.industry || "(unbekannt)"}\n` +
    `Über das Unternehmen: ${input.about || "(keine Angabe)"}\n` +
    `${pillarLine}\n\n` +
    `Eigene frühere Beiträge (Tonfall-Referenz):\n${samplesLine}`;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        {
          model: anthropicModel,
          max_tokens: 600,
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
    "Anthropic planned-post content",
  );

  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) {
    throw new ToolError("Die KI hat keinen Beitrag geliefert.");
  }
  let parsed: unknown;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ToolError("Die Antwort der KI konnte nicht gelesen werden.");
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const headline = typeof obj.headline === "string" ? obj.headline.trim().slice(0, 100) : "";
  const caption = isStory ? "" : typeof obj.caption === "string" ? obj.caption.trim().slice(0, 2200) : "";
  if (!headline) {
    throw new ToolError("Die KI hat keine Schlagzeile geliefert.");
  }
  return { headline, caption, costUsd: estimateCostUsd(anthropicModel, data.usage) };
}

export interface SuggestedPillar {
  title: string;
  description: string;
}

/**
 * Suggests 3-6 content pillars using the Anthropic web_search server tool - a short research
 * step ("what social media topics tend to work for this kind of business") before answering,
 * unlike every other function in this file, which is a single plain text call. Costlier than
 * the other AI features (web search is billed per search, on top of token cost - see
 * PANEL_V5_REPORT-style cost note in the router endpoint's rate limit), so callers should apply
 * a stricter rate limit than the other single-call endpoints.
 */
export async function suggestPillarsWithSearch(input: {
  company: string;
  industry: string;
  about: string;
  website: string;
  keywords: string;
}): Promise<SuggestedPillar[]> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("KI-Vorschläge sind gerade nicht verfügbar.");
  }

  const system =
    "Du hilfst Kleinunternehmern, sinnvolle wiederkehrende Themenbereiche (\"Content-Säulen\") für ihre " +
    "automatisch generierten Social-Media-Beiträge zu finden. Du hast Zugriff auf eine Web-Suche - nutze sie " +
    "kurz (wenige Suchen genügen), um herauszufinden, was für Social-Media-Themen bei dieser Branche/diesem " +
    "Geschäft typischerweise gut funktionieren (verbreitete Content-Formate, häufige Kundenfragen, saisonale " +
    "Themen, Besonderheiten der Region falls angegeben). Nachdem du recherchiert hast, antworte GANZ ZULETZT, " +
    "als alleräußerster Teil deiner gesamten Antwort, AUSSCHLIESSLICH mit einem JSON-Array - kein Text danach, " +
    'kein Markdown-Codeblock drumherum - nach genau diesem Schema: [{"title": "kurzer Titel, max. 4 Wörter", ' +
    '"description": "1-2 Sätze auf Deutsch, was inhaltlich in diese Säule fällt"}]. Schlage 3 bis 6 Säulen vor, ' +
    "jede thematisch klar von den anderen unterscheidbar - keine Duplikate oder Überlappungen.";

  const user =
    `Firma: ${input.company || "(unbekannt)"}\n` +
    `Branche: ${input.industry || "(unbekannt)"}\n` +
    `Über das Unternehmen: ${input.about || "(keine Angabe)"}\n` +
    `Website: ${input.website || "(keine)"}\n` +
    `Stichworte für Themen-Ideen: ${input.keywords || "(keine)"}`;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        {
          model: anthropicModel,
          max_tokens: 2000,
          system,
          messages: [{ role: "user", content: user }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        },
        {
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 45_000,
        },
      ),
    1, // fewer retries than the other AI features - a web-search call is markedly more expensive
    "Anthropic suggest-pillars (web search)",
  );

  // Multiple text blocks interleave with server_tool_use/web_search_tool_result blocks (the
  // search steps) - the JSON answer is in the LAST text block, per the system prompt above.
  const textBlocks = (data.content ?? []).filter((c) => c.type === "text" && c.text);
  const text = textBlocks[textBlocks.length - 1]?.text?.trim();
  if (!text) {
    throw new ToolError("Die KI hat keinen Vorschlag geliefert.");
  }

  // Unlike the other functions in this file, the model reliably adds a preamble sentence
  // before the JSON here ("Basierend auf meiner Recherche...") despite being told to answer
  // "GANZ ZULETZT... AUSSCHLIESSLICH" with JSON - likely because the preceding search steps put
  // it in a more conversational mode. A simple leading/trailing fence strip (as the other
  // functions use) doesn't help when there's prose before the fence too, so extract the
  // outermost [...] substring instead, wherever it appears in the text.
  const match = text.match(/\[[\s\S]*\]/);
  let parsed: unknown;
  try {
    if (!match) throw new Error("no array found");
    parsed = JSON.parse(match[0]);
  } catch {
    throw new ToolError("Die Antwort der KI konnte nicht gelesen werden.");
  }
  if (!Array.isArray(parsed)) {
    throw new ToolError("Die Antwort der KI konnte nicht gelesen werden.");
  }
  const pillars = parsed
    .map((p) => {
      const obj = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 60) : "";
      const description = typeof obj.description === "string" ? obj.description.trim().slice(0, 300) : "";
      return { title, description };
    })
    .filter((p) => p.title)
    .slice(0, 6);
  if (!pillars.length) {
    throw new ToolError("Die KI hat keine verwertbaren Vorschläge geliefert.");
  }
  return pillars;
}

export interface HelpChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Panel v6 Aufgabe 6: Hilfe-Chat im Kunden-Panel. Der System-Prompt haelt die KI strikt auf
 * Fragen zum Panel selbst beschraenkt (kein allgemeiner Chatbot) - router.ts baut optional einen
 * `accountContext`-Block aus bereits oeffentlich im Panel sichtbaren Feldern (Status, Kanaele,
 * Freigaben-Anzahl - NIE Tokens/Secrets), damit account-spezifische Fragen moeglich sind.
 */
const HELP_CHAT_SYSTEM = `Du bist der Hilfe-Chat im Kunden-Panel "Pipeflow" von Pipeline AI Solutions - einem Dienst, der automatisch Instagram-/LinkedIn-Beiträge für kleine Unternehmen erstellt und veröffentlicht.

So funktioniert das Panel tatsächlich (nutze GENAU diese Begriffe/Abläufe, erfinde keine Menüpunkte oder Funktionen, die hier nicht stehen):
- Anmeldung: kein Benutzername/Passwort - ein persönlicher Zugangslink (per E-Mail oder "Zugang verloren?" auf der Startseite) meldet direkt an.
- Nach der ersten Einrichtung (Unternehmensdaten + mind. 1 verbundener Kanal) landet man künftig auf einem Dashboard: Status, nächster geplanter Beitrag, Kanäle, Anzahl wartender Freigaben, "Jetzt posten", letzte Beiträge, die nächsten 7 Tage sowie Links zu "Analytics", "Vorschau", "Verlauf", "Kanäle verwalten", "Stil bearbeiten".
- "Kanäle verwalten": dort verbindet man Instagram (professionelles/Business-Konto nötig) und/oder LinkedIn per OAuth (man meldet sich direkt bei der Plattform an, Pipeflow bekommt nur das Recht zu veröffentlichen, sieht nie das Passwort).
- "Stil bearbeiten": Firmendaten, Tonalität, Rhythmus/Uhrzeit, Akzentfarbe/Beschriftung fürs Bild, Content-Säulen (wiederkehrende Themen), Hashtag-/Emoji-Vorlieben, verbotene Wörter/Pflicht-Elemente, Pause-Zeitraum, "Freigabe-Modus".
- "Freigabe-Modus" (an/aus, in "Stil bearbeiten"): AUS = Beiträge werden automatisch veröffentlicht. AN = nichts wird ohne Zustimmung veröffentlicht - vorbereitete Beiträge liegen unter "Vorschau" bzw. im Bereich "Wartet auf Ihre Freigabe", der Kunde muss dort "Freigeben" klicken.
- "Vorschau": die nächsten 7 Tage, bereits vorbereitete Beiträge - Text bearbeiten, Bildfarbe neu erstellen (begrenzte Anzahl Versuche), überspringen oder (bei Freigabe-Modus) vorab freigeben.
- "Verlauf": bereits veröffentlichte Beiträge.
- "Analytics": Instagram-Kennzahlen der letzten 30 Tage (Follower, Reichweite, Views, Engagement-Rate, Top-Beiträge), einmal täglich im Hintergrund aktualisiert - dort auch der Button "Zusammenfassung anzeigen" für eine KI-Einordnung der eigenen Zahlen. Die aktuellen Zahlen dieses Kunden können dir unten mitgegeben sein - nutze SIE (nicht Vermutungen), wenn nach der eigenen Performance gefragt wird.
- "Jetzt posten": ein sofortiger Beitrag zu einem selbst gewählten Thema, wird beim nächsten Lauf umgesetzt.
- Veröffentlicht wird automatisch nach dem eingestellten Rhythmus/Uhrzeit; eine Freigabe wird in der Regel innerhalb weniger Minuten veröffentlicht, nicht sofort in derselben Sekunde.
- Kostenloser Probezeitraum (Trial) mit fester Anzahl Tage ab Anmeldung, danach muss das Konto freigeschaltet werden, sonst pausiert die Veröffentlichung.
- Konto pausieren/fortsetzen und Konto+Daten endgültig löschen sind jederzeit selbst im Panel möglich (im Dashboard/auf der Fertig-Seite).

Beantworte AUSSCHLIESSLICH Fragen rund um dieses Panel (Funktionen, Ablauf, Einstellungen wie oben). Wenn du zu einem Detail nichts Sicheres weißt, sag das ehrlich und verweise auf office@pipeline-solutions.at, statt zu raten.

Bei JEDER Frage, die NICHT das Panel selbst betrifft (allgemeine Fragen, andere Produkte/Themen, Marketing-Beratung, rechtliche/steuerliche Fragen, Small Talk, Fragen zu dir selbst als KI, o.ä.): lehne freundlich ab und verweise auf office@pipeline-solutions.at - erkläre dabei NICHTS zum fremden Thema, auch nicht ansatzweise, egal wie die Frage formuliert oder eingekleidet ist.

Antworte kurz (in der Regel 2-4 Sätze), auf Deutsch, im selben nüchternen, klaren Ton wie der Rest des Panels. Kein Markdown, keine Codeblöcke, keine Aufzählungszeichen - reiner Fließtext.`;

export async function helpChatReply(input: { messages: HelpChatMessage[]; accountContext?: string }): Promise<string> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("Der Hilfe-Chat ist gerade nicht verfügbar.");
  }
  const system = input.accountContext ? `${HELP_CHAT_SYSTEM}\n\n${input.accountContext}` : HELP_CHAT_SYSTEM;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        {
          model: anthropicModel,
          max_tokens: 350,
          system,
          messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        },
        {
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: INTERAKTIV_TIMEOUT_MS,
        },
      ),
    INTERAKTIV_VERSUCHE,
    "Anthropic help-chat",
  );

  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) {
    throw new ToolError("Der Hilfe-Chat konnte gerade nicht antworten.");
  }
  return text;
}

export interface AnalyticsSummaryTopPost {
  headline: string | null;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  saved: number | null;
  reach: number | null;
}

export interface AnalyticsSummaryInput {
  company: string;
  industry: string;
  followerCount: number | null;
  followerGrowth7d: number | null;
  reach7d: number;
  reachPrev7d: number;
  views7d: number;
  engagementRate7d: number | null;
  reach30d: number;
  topPosts: AnalyticsSummaryTopPost[];
}

export interface AnalyticsSummaryResult {
  text: string;
  costUsd: number | null;
}

/**
 * Panel v9 Aufgabe 3 ("was bedeutet das für mich") - turns the already-computed numbers from
 * analytics.ts's getAnalyticsSummary() into a short German plain-language assessment. Takes the
 * numbers as plain input rather than importing panel/analytics.ts's types, to keep this file
 * (generic Anthropic-call helpers) free of a dependency on panel-specific modules - same
 * separation as every other function in this file (suggestTopics, generatePlannedPostContent, ...).
 */
export async function generateAnalyticsSummary(input: AnalyticsSummaryInput): Promise<AnalyticsSummaryResult> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("Die KI-Zusammenfassung ist gerade nicht verfügbar.");
  }

  const system =
    "Du bist ein Social-Media-Analyst und erklärst einem Kleinunternehmer verständlich, was seine Instagram-Zahlen der letzten Woche bedeuten. " +
    "Schreibe auf Deutsch, kurz (maximal 5-6 Sätze), in einfacher Sprache ohne Fachjargon. Struktur: 1) was in der letzten Woche gut lief " +
    "(konkret, mit Zahl wenn sinnvoll), 2) falls aus den Daten erkennbar, wieso ein bestimmter Beitrag gut performt hat, 3) genau EINE konkrete, " +
    "umsetzbare Empfehlung für die kommende Woche. Kein Markdown, keine Aufzählungszeichen, reiner Fließtext. Erfinde keine Zahlen oder Gründe, " +
    "die nicht aus den gelieferten Daten hervorgehen - ist die Datenlage dünn (wenige Tage, keine Top-Beiträge), sag das ehrlich statt zu spekulieren.";

  const growthLine =
    input.followerGrowth7d != null ? `${input.followerGrowth7d >= 0 ? "+" : ""}${input.followerGrowth7d}` : "unbekannt";
  const topPostLines = input.topPosts.length
    ? input.topPosts
        .map(
          (p, i) =>
            `${i + 1}. "${(p.headline || p.caption || "(ohne Titel)").slice(0, 80)}" - ${p.likes ?? 0} Likes, ${p.comments ?? 0} Kommentare, ` +
            `${p.saved ?? 0} gespeichert, Reichweite ${p.reach ?? "unbekannt"}`,
        )
        .join("\n")
    : "(keine Beiträge mit Daten in den letzten 30 Tagen)";
  const user =
    `Unternehmen: ${input.company} (Branche: ${input.industry || "unbekannt"})\n\n` +
    `Follower aktuell: ${input.followerCount ?? "unbekannt"} (Veränderung letzte 7 Tage: ${growthLine})\n` +
    `Reichweite letzte 7 Tage: ${input.reach7d} (Vorwoche: ${input.reachPrev7d})\n` +
    `Views letzte 7 Tage: ${input.views7d}\n` +
    `Engagement-Rate letzte 7 Tage: ${input.engagementRate7d != null ? `${input.engagementRate7d}%` : "unbekannt"}\n` +
    `Reichweite letzte 30 Tage gesamt: ${input.reach30d}\n\n` +
    `Beste Beiträge der letzten 30 Tage:\n${topPostLines}`;

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
          timeout: INTERAKTIV_TIMEOUT_MS,
        },
      ),
    INTERAKTIV_VERSUCHE,
    "Anthropic analytics-summary",
  );

  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) {
    throw new ToolError("Die KI-Zusammenfassung konnte nicht erstellt werden.");
  }
  return { text, costUsd: estimateCostUsd(anthropicModel, data.usage) };
}

export type CommentType = "question" | "hostile" | "other";

export interface CommentClassificationInput {
  commentText: string;
  company: string;
  industry: string;
  about: string;
  tone: string;
  language: string;
  /** The commented-on post's own text, for context only - never itself a source of required elements/banned words (those are already enforced when the post was created). */
  postHeadline: string | null;
  postCaption: string | null;
}

export interface CommentClassificationResult {
  type: CommentType;
  /** Only set when type === "question" - null for everything else (see safety rule in the prompt: skip rather than engage). */
  reply: string | null;
  costUsd: number | null;
}

/**
 * One Anthropic call per new comment (Panel v10, KI-Kommentar-Automatisierung) - classifies a
 * top-level Instagram comment and, only for a genuine factual question, drafts a reply. The
 * safety rule (never argue, never justify, never engage with anything that isn't a real question)
 * is a hard instruction here, not a soft preference - "other"/"hostile" always get reply: null,
 * enforced again below in code (never trust the reply field for a non-"question" type) in case the
 * model ever disobeys the instruction.
 */
export async function classifyAndAnswerComment(input: CommentClassificationInput): Promise<CommentClassificationResult> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("Die Kommentar-Automatisierung ist gerade nicht verfügbar.");
  }

  const languageName = input.language === "en" ? "English" : "Deutsch";
  const system =
    "Du bewertest einen einzelnen obersten Kommentar unter einem Instagram-Beitrag eines Kleinunternehmens und entscheidest, " +
    "ob und wie darauf geantwortet wird. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt - kein einleitender Satz, kein " +
    'Markdown-Codeblock, kein Text davor oder danach - nach genau diesem Schema: {"type": "question" | "hostile" | "other", "reply": "Antworttext" oder null}. ' +
    'Setze "type" auf "question" NUR wenn der Kommentar wirklich eine sachliche Frage stellt, die eine konkrete Antwort verdient - ' +
    'in diesem Fall UND NUR in diesem Fall "reply" mit einer klaren, sachlichen, direkt auf die gestellte Frage eingehenden Antwort füllen, ' +
    `auf ${languageName}, im Tonfall "${input.tone || "sachlich"}". Keine Grundsatzaussagen, keine Werbe-Floskeln, keine Begrüssungsfloskel - ` +
    "beantworte wirklich nur die gestellte Frage, kurz und konkret. " +
    'Setze "type" auf "hostile" bei einem feindseligen, beleidigenden oder provozierenden Kommentar - "reply" dann IMMER null. ' +
    'Setze "type" auf "other" bei allem anderen (Lob, neutrale Aussage, Spam, unklare Aussage ohne echte Frage) - "reply" dann IMMER null. ' +
    "SICHERHEITSREGEL, hat Vorrang vor allem oben: nie streiten, nie rechtfertigen, nie inhaltlich auf einen Kommentar eingehen, der keine " +
    "sachliche Frage ist - insbesondere nie auf Hass oder Provokation kontern oder eingehen. Im Zweifel, ob es wirklich eine sachliche Frage " +
    'ist, IMMER "other" statt "question" wählen - lieber einen Kommentar überspringen als eine unpassende Antwort zu geben.';

  const postContextLine =
    input.postHeadline || input.postCaption
      ? `Kommentierter Beitrag: "${(input.postHeadline || "").slice(0, 100)}"${input.postCaption ? ` - ${input.postCaption.slice(0, 300)}` : ""}`
      : "Kommentierter Beitrag: (kein Text verfügbar)";
  const user =
    `Unternehmen: ${input.company} (Branche: ${input.industry || "unbekannt"})\n` +
    `Über das Unternehmen: ${input.about || "(keine Angabe)"}\n` +
    `${postContextLine}\n\n` +
    `Kommentar: "${input.commentText}"`;

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
    "Anthropic comment-classification",
  );

  const raw = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  const costUsd = estimateCostUsd(anthropicModel, data.usage);
  let parsed: { type?: unknown; reply?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    throw new ToolError(`Kommentar-Klassifizierung: ungültige Modell-Antwort - ${raw.slice(0, 200)}`);
  }
  const type: CommentType = parsed.type === "question" || parsed.type === "hostile" ? parsed.type : "other";
  // Enforced in code, not just trusted from the prompt (see doc comment above): reply is only
  // ever non-null for a genuine question, regardless of what the model put in the field.
  const reply = type === "question" && typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : null;
  return { type, reply, costUsd };
}

export interface ReviewReplyInput {
  /** Bewertungstext - kann leer sein (reine Sterne-Bewertung ohne Text ist auf Google normal). */
  reviewText: string;
  /** 1-5, 0 = unbekannt. Steuert den Tonfall stärker als jeder andere Wert hier. */
  starRating: number;
  reviewerName: string | null;
  company: string;
  industry: string;
  about: string;
  tone: string;
  language: string;
}

export interface ReviewReplyResult {
  reply: string;
  costUsd: number | null;
}

/**
 * Eine Anthropic-Anfrage pro neuer Google-Bewertung. BEWUSST ANDERS als
 * classifyAndAnswerComment (Instagram-Kommentare), nicht davon abgeleitet:
 *
 * - Dort wird KLASSIFIZIERT und in den meisten Fällen bewusst NICHT geantwortet (nur echte Fragen
 *   bekommen eine Antwort, Lob/Spam/Hass werden übersprungen). Hier bekommt JEDE Bewertung eine
 *   Antwort - das ist bei Google der Normalfall und wird von Kundinnen und Kunden erwartet.
 * - Eine schlechte Bewertung wird deshalb nicht ignoriert wie ein Hass-Kommentar, sondern
 *   empathisch und lösungsorientiert beantwortet (bedauern, Verantwortung nicht abstreiten, ins
 *   Direktgespräch einladen) - ohne zu streiten, ohne Rechtfertigung, ohne Gegenangriff.
 *
 * Harte Grenzen im System-Prompt (Google moderiert Inhaber-Antworten und lehnt Verstöße ab, siehe
 * google-business.ts): keine personenbezogenen Daten, keine Werbung/Rabatte/Links, keine
 * Gegenvorwürfe, keine Behauptungen über die bewertende Person, kein Zweifel an der Echtheit der
 * Bewertung. Antwort immer kurz (max. ~60 Wörter) - lange Antworten wirken defensiv und ecken bei
 * der Moderation eher an.
 */
export async function generateReviewReply(input: ReviewReplyInput): Promise<ReviewReplyResult> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("Die Bewertungs-Automatisierung ist gerade nicht verfügbar.");
  }

  const languageName = input.language === "en" ? "English" : "Deutsch";
  const stars = input.starRating >= 1 && input.starRating <= 5 ? input.starRating : null;
  const stance =
    stars !== null && stars <= 2
      ? "Das ist eine SCHLECHTE Bewertung. Antworte empathisch und lösungsorientiert: Bedauern ausdrücken, das Anliegen ernst nehmen, ein direktes Gespräch anbieten (z.B. per E-Mail oder Telefon über die im Profil hinterlegten Kontaktdaten). Niemals streiten, niemals rechtfertigen, niemals widersprechen, niemals die Schilderung in Zweifel ziehen."
      : stars === 3
        ? "Das ist eine mittlere Bewertung. Bedanke dich für das ehrliche Feedback, greife den genannten Kritikpunkt sachlich auf und lade zu einem direkten Austausch ein - ohne Ausreden und ohne Beschönigung."
        : "Das ist eine gute Bewertung. Bedanke dich kurz, persönlich und ohne Werbefloskeln, und gehe auf das ein, was konkret gelobt wurde.";

  const system =
    "Du schreibst die öffentliche Inhaber-Antwort auf eine Google-Bewertung eines Kleinunternehmens. " +
    "Antworte AUSSCHLIESSLICH mit dem reinen Antworttext - kein JSON, kein Markdown, keine Anführungszeichen, keine Anrede-Platzhalter. " +
    `Sprache: ${languageName}. Tonfall: "${input.tone || "sachlich"}". Maximal 60 Wörter, lieber kürzer. ` +
    `${stance} ` +
    "HARTE REGELN, haben Vorrang vor allem anderen (Google moderiert Inhaber-Antworten und lehnt Verstöße ab): " +
    "keine personenbezogenen Daten (keine Nachnamen, keine Termindetails, keine Angaben zu Behandlung/Auftrag/Bestellung, nichts, was die Person identifizierbar macht, was sie nicht selbst geschrieben hat); " +
    "keine Werbung, keine Rabatte, keine Preise, keine Links, keine Telefonnummern, keine E-Mail-Adressen; " +
    "keine Gegenvorwürfe, keine Unterstellungen, kein Zweifel an der Echtheit der Bewertung, keine Bitte, die Bewertung zu ändern oder zu löschen; " +
    "keine Versprechen (Erstattung, Entschädigung, Ergebnis), die das Unternehmen vielleicht nicht halten kann. " +
    "Im Zweifel kürzer und allgemeiner antworten statt konkreter zu werden.";

  const user =
    `Unternehmen: ${input.company} (Branche: ${input.industry || "unbekannt"})\n` +
    `Über das Unternehmen: ${input.about || "(keine Angabe)"}\n` +
    `Sterne: ${stars !== null ? `${stars} von 5` : "unbekannt"}\n` +
    `Name der bewertenden Person: ${input.reviewerName || "(unbekannt)"}\n\n` +
    `Bewertungstext: ${input.reviewText ? `"${input.reviewText}"` : "(kein Text - nur eine Sterne-Bewertung)"}`;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        { model: anthropicModel, max_tokens: 400, system, messages: [{ role: "user", content: user }] },
        {
          headers: { "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          timeout: 30_000,
        },
      ),
    2,
    "Anthropic review-reply",
  );

  const reply = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  if (!reply) throw new ToolError("Bewertungs-Antwort: leere Modell-Antwort.");
  // Sicherheitsnetz gegen ein Modell, das trotz Anweisung in Anführungszeichen antwortet.
  const cleaned = reply.replace(/^["„»]/, "").replace(/["“«]$/, "").trim();
  return { reply: cleaned, costUsd: estimateCostUsd(anthropicModel, data.usage) };
}

export interface ReviewPostInput {
  reviewText: string;
  starRating: number;
  reviewerName: string | null;
  company: string;
  industry: string;
  about: string;
  tone: string;
  language: string;
  hashtagPreference: string;
  emojisEnabled: boolean;
  channel: string;
  /** Harte Wortverbote des Kunden - hier zusätzlich in den Prompt gegeben, weil der Ausgangstext
   *  (die Bewertung) ein fremder Text ist: ein verbotenes Wort darin würde sonst mit hoher
   *  Wahrscheinlichkeit ins Zitat wandern und den Beitrag unveröffentlichbar machen. */
  bannedWords: string[];
  /** Pflicht-Elemente des Kunden - müssen im Beitrag vorkommen, sonst lehnt die Veröffentlichung ab. */
  requiredElements: string[];
}

export interface ReviewPostResult {
  headline: string;
  caption: string;
  costUsd: number | null;
}

/**
 * Content-Recycling: aus einer guten Bewertung einen "Das sagen unsere Kunden"-Beitragsvorschlag
 * machen. Getrennt von generatePlannedPostContent, weil die Quelle hier ein fremder Text ist -
 * die Regeln drehen sich vor allem darum, was damit NICHT passieren darf: nichts dazuerfinden,
 * die Aussage nicht verschärfen, keinen vollen Namen der bewertenden Person nennen (nur Vorname
 * oder Initial, und auch das nur, wenn er in der Bewertung selbst steht).
 *
 * Die Headline landet als Text im generierten Bild (siehe fal.ts/watermark.ts) und muss deshalb
 * kurz sein; die Caption ist der Beitragstext.
 */
export async function generateReviewSocialPost(input: ReviewPostInput): Promise<ReviewPostResult> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("Die Beitrags-Erstellung ist gerade nicht verfügbar.");
  }

  const languageName = input.language === "en" ? "English" : "Deutsch";
  const hashtagRule =
    input.hashtagPreference === "keine"
      ? "Keine Hashtags."
      : input.hashtagPreference === "viele"
        ? "8-12 passende Hashtags am Ende der Caption."
        : "Höchstens 3 passende Hashtags am Ende der Caption.";

  const system =
    "Du machst aus einer echten Kundenbewertung einen Social-Media-Beitrag für ein Kleinunternehmen. " +
    'Antworte AUSSCHLIESSLICH mit einem JSON-Objekt nach genau diesem Schema: {"headline": "...", "caption": "..."} - kein Text davor oder danach, kein Markdown-Codeblock. ' +
    `Sprache: ${languageName}. Tonfall: "${input.tone || "sachlich"}". ` +
    "headline: maximal 60 Zeichen, wird als Text ins Bild gesetzt - am besten ein kurzes, wörtliches Zitat aus der Bewertung oder dessen Kern. " +
    "caption: 2-4 Sätze, greift die Bewertung auf und bedankt sich; " +
    `${hashtagRule} ${input.emojisEnabled ? "Emojis sparsam erlaubt." : "Keine Emojis."} ` +
    "HARTE REGELN: nichts dazuerfinden, was nicht in der Bewertung steht; die Aussage nicht verstärken oder ins Werbliche drehen; " +
    "keinen vollen Namen der bewertenden Person nennen (Vorname oder Initial nur, wenn er in der Bewertung selbst vorkommt); " +
    "keine personenbezogenen Details (Behandlung, Auftrag, Bestellung, Termin); keine Preise, keine Rabatte, keine Heils- oder Erfolgsversprechen; " +
    "ein wörtliches Zitat muss WÖRTLICH aus der Bewertung stammen (gekürzt ist erlaubt, umformuliert nicht)." +
    (input.bannedWords.length
      ? ` Diese Wörter dürfen weder in headline noch in caption vorkommen - auch nicht in einem Zitat (dann das Zitat entsprechend kürzen): ${input.bannedWords.join(", ")}.`
      : "") +
    (input.requiredElements.length
      ? ` Diese Elemente MÜSSEN irgendwo in headline oder caption vorkommen: ${input.requiredElements.join(", ")}.`
      : "");

  const user =
    `Unternehmen: ${input.company} (Branche: ${input.industry || "unbekannt"})\n` +
    `Über das Unternehmen: ${input.about || "(keine Angabe)"}\n` +
    `Kanal: ${input.channel}\n` +
    `Sterne: ${input.starRating} von 5\n` +
    `Name der bewertenden Person: ${input.reviewerName || "(unbekannt)"}\n\n` +
    `Bewertungstext: "${input.reviewText}"`;

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        { model: anthropicModel, max_tokens: 800, system, messages: [{ role: "user", content: user }] },
        {
          headers: { "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          timeout: 45_000,
        },
      ),
    2,
    "Anthropic review-post",
  );

  const raw = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  let parsed: { headline?: unknown; caption?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    throw new ToolError(`Beitrag aus Bewertung: ungültige Modell-Antwort - ${raw.slice(0, 200)}`);
  }
  const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
  const caption = typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  if (!headline || !caption) throw new ToolError("Beitrag aus Bewertung: Modell-Antwort ohne headline/caption.");
  return { headline, caption, costUsd: estimateCostUsd(anthropicModel, data.usage) };
}

export interface VideoScriptInput {
  company: string;
  industry: string;
  about: string;
  tone: string;
  language: string;
  hashtagPreference: string;
  emojisEnabled: boolean;
  pillarTitle: string | null;
  pillarDescription: string | null;
  /** Freies Wunschthema aus "Jetzt posten" - leer bei der automatischen Routine. */
  topic?: string | null;
  /** Gewählte Videolänge in Sekunden (5/10/15). */
  lengthSeconds: number;
  /** Wie viele Kernaussagen zwischen Hook und CTA passen (aus der Videolänge abgeleitet). */
  minPoints: number;
  maxPoints: number;
  /** Zeichen-Budget für ALLE gesprochenen Sätze zusammen - aus der gemessenen Sprechgeschwindigkeit
   *  der gewählten Stimme abgeleitet (siehe video.ts/tts.ts), nicht geschätzt. */
  spokenCharBudget: number;
  bannedWords: string[];
  requiredElements: string[];
  styleSamples: string[];
  avoidNote?: string;
}

export interface VideoScriptSegmentOut {
  text: string;
  spoken: string;
}

export interface VideoScriptResult {
  hook: VideoScriptSegmentOut;
  points: VideoScriptSegmentOut[];
  cta: VideoScriptSegmentOut;
  caption: string;
  costUsd: number | null;
}

/**
 * Drehbuch für eine Video-Diashow (video.ts). Eigene Funktion statt einer Variante von
 * generatePlannedPostContent, weil hier ZWEI Textsorten gleichzeitig entstehen müssen, die
 * unterschiedlichen Regeln folgen:
 *
 *   - `text` steht im Bild: sehr kurz, damit es in großer Schrift lesbar bleibt, während es nur
 *     2-3 Sekunden zu sehen ist.
 *   - `spoken` wird vorgelesen: ganze Sätze, natürlicher Sprachfluss, keine Stichpunkte. Ein
 *     Stichpunkt-Fragment ("Mehr Zeit. Weniger Aufwand.") liest sich im Bild gut und klingt
 *     vorgelesen abgehackt - genau deshalb sind es zwei Felder und nicht eins.
 *
 * Das Zeichen-Budget ist hart: Es kommt aus der tatsächlich gemessenen Sprechgeschwindigkeit der
 * gewählten Stimme und der gewählten Videolänge. Wird es überschritten, dauert das fertige Video
 * länger als eingestellt (die Sprachausgabe gibt das Timing vor, nicht umgekehrt).
 */
export async function generateVideoScript(input: VideoScriptInput): Promise<VideoScriptResult> {
  const { anthropicApiKey, anthropicModel } = getConfig();
  if (!anthropicApiKey) {
    throw new ToolError("Die Video-Erstellung ist gerade nicht verfügbar.");
  }

  const languageName = input.language === "en" ? "English" : "Deutsch";
  const hashtagRule =
    input.hashtagPreference === "keine"
      ? "Keine Hashtags."
      : input.hashtagPreference === "viele"
        ? "8-12 passende Hashtags am Ende der Caption."
        : "Höchstens 3 passende Hashtags am Ende der Caption.";

  const system =
    "Du schreibst das Drehbuch für ein kurzes, vertontes Hochformat-Video (Instagram Reel) eines Kleinunternehmens. " +
    'Antworte AUSSCHLIESSLICH mit einem JSON-Objekt nach genau diesem Schema - kein Text davor oder danach, kein Markdown-Codeblock: ' +
    '{"hook": {"text": "...", "spoken": "..."}, "points": [{"text": "...", "spoken": "..."}], "cta": {"text": "...", "spoken": "..."}, "caption": "..."}. ' +
    `Sprache: ${languageName}. Tonfall: "${input.tone || "sachlich"}". ` +
    `"points" enthält ${input.minPoints === input.maxPoints ? `genau ${input.minPoints}` : `${input.minPoints} bis ${input.maxPoints}`} Einträge. ` +
    "ZWEI TEXTSORTEN, die sich unterscheiden MÜSSEN: " +
    '"text" wird groß ins Video eingeblendet - höchstens 42 Zeichen, keine Satzzeichen am Ende außer Frage- oder Ausrufezeichen, kein Emoji, keine Hashtags. ' +
    '"spoken" wird von einer Computerstimme vorgelesen - ein vollständiger, natürlich klingender Satz, der für sich allein funktioniert. ' +
    "Vorgelesener Text darf NICHT wie eine Aufzählung klingen: keine Stichpunkte, keine Satzfragmente, keine Doppelpunkt-Konstruktionen, keine Aufzählungszeichen, " +
    "keine Abkürzungen (z.B., u.a., ca.), keine Zahlen als Ziffernfolge, wenn ein Wort natürlicher klingt, keine Emojis, keine Hashtags, keine Klammern. " +
    `HARTES LÄNGENBUDGET: Alle "spoken"-Sätze zusammen dürfen höchstens ${input.spokenCharBudget} Zeichen haben (inklusive Leerzeichen). ` +
    `Das ist keine Richtgröße, sondern die Sprechzeit, die in ${input.lengthSeconds} Sekunden Video passt. Lieber kürzer. ` +
    "Aufbau: hook macht neugierig oder benennt ein konkretes Problem; points liefern je eine eigenständige Kernaussage; cta fordert zu genau einer Handlung auf. " +
    `"caption" ist der Beitragstext unter dem Video: 2-4 Sätze, eigenständig lesbar. ${hashtagRule} ${input.emojisEnabled ? "Emojis sparsam erlaubt." : "Keine Emojis."} ` +
    (input.bannedWords.length
      ? ` Diese Wörter dürfen nirgends vorkommen (weder im Bild-Text noch gesprochen noch in der Caption): ${input.bannedWords.join(", ")}.`
      : "") +
    (input.requiredElements.length
      ? ` Diese Elemente MÜSSEN vorkommen (irgendwo in den Bild-Texten oder der Caption): ${input.requiredElements.join(", ")}.`
      : "") +
    (input.avoidNote ? ` Der vorige Versuch wurde abgelehnt: ${input.avoidNote} Vermeide das diesmal.` : "");

  const user =
    `Unternehmen: ${input.company} (Branche: ${input.industry || "unbekannt"})\n` +
    `Über das Unternehmen: ${input.about || "(keine Angabe)"}\n` +
    (input.pillarTitle ? `Themenbereich: ${input.pillarTitle}${input.pillarDescription ? ` - ${input.pillarDescription}` : ""}\n` : "") +
    (input.topic ? `Gewünschtes Thema: ${input.topic}\n` : "") +
    `Videolänge: ${input.lengthSeconds} Sekunden\n` +
    (input.styleSamples.length ? `\nFrühere Beiträge dieses Unternehmens (Tonfall übernehmen, Inhalt nicht wiederholen):\n${input.styleSamples.map((s) => `- ${s.slice(0, 200)}`).join("\n")}` : "");

  const { data } = await withRetry(
    () =>
      axios.post<AnthropicResponse>(
        ANTHROPIC_ENDPOINT,
        { model: anthropicModel, max_tokens: 1200, system, messages: [{ role: "user", content: user }] },
        {
          headers: { "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          timeout: 60_000,
        },
      ),
    2,
    "Anthropic video-script",
  );

  const raw = data.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
  let parsed: { hook?: unknown; points?: unknown; cta?: unknown; caption?: unknown };
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  } catch {
    throw new ToolError(`Video-Drehbuch: ungültige Modell-Antwort - ${raw.slice(0, 200)}`);
  }

  const seg = (value: unknown, label: string): VideoScriptSegmentOut => {
    const o = (value ?? {}) as { text?: unknown; spoken?: unknown };
    const text = typeof o.text === "string" ? o.text.trim() : "";
    const spoken = typeof o.spoken === "string" ? o.spoken.trim() : "";
    if (!text) throw new ToolError(`Video-Drehbuch: ${label} ohne Bild-Text.`);
    // Fehlt der gesprochene Satz, wird eben der Bild-Text vorgelesen - schlechter, aber kein Grund,
    // das ganze Video wegzuwerfen.
    return { text, spoken: spoken || text };
  };

  const points = Array.isArray(parsed.points) ? parsed.points.slice(0, input.maxPoints).map((p, i) => seg(p, `Kernaussage ${i + 1}`)) : [];
  if (points.length < input.minPoints) throw new ToolError(`Video-Drehbuch: zu wenige Kernaussagen (${points.length}, erwartet ${input.minPoints}).`);
  const caption = typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  if (!caption) throw new ToolError("Video-Drehbuch: keine Caption.");

  return {
    hook: seg(parsed.hook, "Hook"),
    points,
    cta: seg(parsed.cta, "Call-to-Action"),
    caption,
    costUsd: estimateCostUsd(anthropicModel, data.usage),
  };
}
