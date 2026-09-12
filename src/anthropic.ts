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

const HASHTAG_GUIDANCE: Record<string, string> = {
  keine: "KEINE Hashtags - die Caption endet ohne Hashtag-Zeile.",
  wenige: "2 bis 4 Hashtags am Ende der Caption.",
  viele: "10 bis 15 Hashtags am Ende der Caption.",
};

export interface PlannedPostContent {
  headline: string;
  caption: string;
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
    `Schreibe vollständig auf ${languageName}. Tonalität: ${input.tone || "sachlich"}. ` +
    `Emojis: ${input.emojisEnabled ? "sparsam und passend einsetzen" : "keine Emojis verwenden"}. ` +
    `Hashtags: ${hashtagLine} ` +
    "Wenn Beispiele eigener früherer Beiträge angegeben sind, orientiere dich an deren Tonfall, Emoji-Nutzung und " +
    "Hashtag-Stil, statt zu raten. " +
    (input.bannedWords.length ? `Verwende NIEMALS eines dieser Wörter: ${input.bannedWords.join(", ")}. ` : "") +
    (input.requiredElements.length
      ? `Baue JEDES der folgenden Elemente irgendwo ein (Headline oder Caption): ${input.requiredElements.join(", ")}. `
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
  return { headline, caption };
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
- Nach der ersten Einrichtung (Unternehmensdaten + mind. 1 verbundener Kanal) landet man künftig auf einem Dashboard: Status, nächster geplanter Beitrag, Kanäle, Anzahl wartender Freigaben, Kacheln zu "Vorschau", "Verlauf", "Kanäle verwalten", "Stil bearbeiten".
- "Kanäle verwalten": dort verbindet man Instagram (professionelles/Business-Konto nötig) und/oder LinkedIn per OAuth (man meldet sich direkt bei der Plattform an, Pipeflow bekommt nur das Recht zu veröffentlichen, sieht nie das Passwort).
- "Stil bearbeiten": Firmendaten, Tonalität, Rhythmus/Uhrzeit, Akzentfarbe/Beschriftung fürs Bild, Content-Säulen (wiederkehrende Themen), Hashtag-/Emoji-Vorlieben, verbotene Wörter/Pflicht-Elemente, Pause-Zeitraum, "Freigabe-Modus".
- "Freigabe-Modus" (an/aus, in "Stil bearbeiten"): AUS = Beiträge werden automatisch veröffentlicht. AN = nichts wird ohne Zustimmung veröffentlicht - vorbereitete Beiträge liegen unter "Vorschau" bzw. im Bereich "Wartet auf Ihre Freigabe", der Kunde muss dort "Freigeben" klicken.
- "Vorschau": die nächsten 7 Tage, bereits vorbereitete Beiträge - Text bearbeiten, Bildfarbe neu erstellen (begrenzte Anzahl Versuche), überspringen oder (bei Freigabe-Modus) vorab freigeben.
- "Verlauf": bereits veröffentlichte Beiträge.
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
          timeout: 30_000,
        },
      ),
    2,
    "Anthropic help-chat",
  );

  const text = data.content?.find((c) => c.type === "text")?.text?.trim();
  if (!text) {
    throw new ToolError("Der Hilfe-Chat konnte gerade nicht antworten.");
  }
  return text;
}
