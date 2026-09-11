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
