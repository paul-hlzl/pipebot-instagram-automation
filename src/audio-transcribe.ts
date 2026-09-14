/**
 * Server-seitige Sprach-Transkription (Panel v13) - Fallback fuer Browser ohne Web Speech API
 * (v.a. iOS Safari, siehe Session-Bericht). Nutzt dieselbe fal.ai-Anbindung wie die Bildgenerierung
 * (fal.ts, gleicher FAL_API_KEY) statt einen neuen Anbieter/Secret einzurichten - Claude selbst hat
 * keinen Audio-Transkriptions-Endpunkt (geprüft: die Messages API akzeptiert Text/Bild/PDF, kein
 * Audio). fal.ai's Whisper-Endpunkt braucht eine oeffentlich erreichbare `audio_url`, keine rohen
 * Bytes im Request - der Aufrufer laedt die Aufnahme dafuer kurz nach R2 hoch (r2.ts,
 * uploadAudioBase64) und raeumt sie danach wieder auf.
 */
import axios from "axios";
import { getConfig } from "./config.js";

const WHISPER_ENDPOINT = "https://fal.run/fal-ai/whisper";

/** fal.ai Whisper v3 Preisstand 2026-09 (~$0.00544 / 10-Minuten-Clip, siehe Session-Bericht) -
 *  konservativ aufgerundet. Kein exaktes Preis-API bekannt, daher fester Schaetzwert statt einer
 *  fragilen Herleitung aus der Server-Antwort. */
const COST_PER_SECOND_USD = 0.0001;

export function estimateTranscriptionCostUsd(durationSeconds: number): number {
  return Math.round(Math.max(0, durationSeconds) * COST_PER_SECOND_USD * 1e6) / 1e6;
}

interface WhisperResponse {
  text?: string;
}

/**
 * Transkribiert eine bereits oeffentlich erreichbare Audio-URL. Wirft NUR bei einem echten
 * Netzwerk-/API-Fehler (die axios-Anfrage selbst schlaegt fehl - dann ist auch nichts abgerechnet
 * worden). Ein leeres Ergebnis (z. B. eine stille/unverstaendliche Aufnahme) ist dagegen ein
 * gueltiger Rueckgabewert (text: "") statt eines Wurfs - der fal.ai-Aufruf selbst ist in diesem
 * Fall trotzdem gelaufen und wurde bezahlt, das muss der Aufrufer weiterhin in usage_costs loggen
 * koennen, bevor er dem Kunden "kein Text erkannt" meldet. Fehlerbehandlung "kein Text" gehoert
 * deshalb bewusst in den Aufrufer (router.ts), nicht hierher.
 */
export async function transcribeAudioUrl(audioUrl: string, language: string): Promise<{ text: string }> {
  const { falApiKey } = getConfig();
  const { data } = await axios.post<WhisperResponse>(
    WHISPER_ENDPOINT,
    {
      audio_url: audioUrl,
      task: "transcribe",
      language: language === "en" ? "en" : "de",
      chunk_level: "none",
    },
    {
      headers: { Authorization: `Key ${falApiKey}` },
      timeout: 60_000,
    },
  );
  return { text: (data.text ?? "").trim() };
}
