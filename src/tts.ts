/**
 * Sprachausgabe (Text-to-Speech) über Google Cloud Text-to-Speech - die Tonspur der
 * Video-Diashows (siehe video.ts).
 *
 * WARUM SYNTHETISCHE STIMME STATT MUSIK: lizenzierte Musik ist über die Instagram-API nicht
 * zugänglich (nur manuell in der App), eine synthetisch erzeugte Stimme, die den eigenen
 * Video-Text vorliest, hat dagegen kein Urheberrechtsproblem - und Reels ohne Ton performen
 * schlechter als welche mit.
 *
 * Zugang: reiner API-Schlüssel (GOOGLE_TTS_API_KEY) als Query-Parameter, kein OAuth - anders als
 * bei den Google-Business-Profile-APIs (google-business.ts), die pro Kunde ein OAuth-Token
 * brauchen. Hier spricht immer unser eigenes Google-Cloud-Projekt, nie ein Kundenkonto. Der
 * Schlüssel gehört in die .env und ist dort auf die Text-to-Speech-API eingeschränkt.
 *
 * PREISE (geprüft 2026-09-15, siehe Session-Bericht): WaveNet und Standard 4 USD je 1 Mio.
 * Zeichen mit 4 Mio. Freikontingent pro Monat, Neural2 16 USD je 1 Mio. mit 1 Mio. frei,
 * Chirp3-HD 30 USD, Studio 160 USD. Abgerechnet wird nach EINGEGEBENEN Zeichen, nicht nach
 * Audiolänge. Ein 10-Sekunden-Video liegt bei ~150 Zeichen, also rund 0,0006 USD mit WaveNet -
 * die Bildkosten sind ein Vielfaches davon. Trotzdem geloggt (usage_costs, Kategorie
 * "video-tts"), damit niemand später raten muss.
 */
import axios from "axios";
import { ToolError } from "./errors.js";
import { withRetry } from "./retry.js";

const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** USD je 1 Mio. Zeichen, nach Stimmen-Stufe (siehe Dateikopf). */
const PRICE_PER_MILLION_CHARS: Record<VoiceTier, number> = {
  wavenet: 4,
  neural2: 16,
};

export type VoiceTier = "wavenet" | "neural2";

export interface VoiceOption {
  /** Googles technischer Name, z.B. "de-DE-Wavenet-G" - so geht er auch an die API. */
  id: string;
  /** Was im Panel steht - nie die technische ID. */
  label: string;
  /** Kurzbeschreibung fürs Panel. Bewusst nur das, was nachweisbar ist (Geschlecht laut Google,
   *  Tempo aus einer echten Messung in dieser Sitzung) - keine erfundenen Stimmungs-Etiketten. */
  description: string;
  tier: VoiceTier;
  /** Gemessene Zeichen pro Sekunde bei speakingRate 1.0 (Mittel aus drei Testsätzen, siehe
   *  Session-Bericht) - Grundlage für die Textlängen-Budgets in video.ts. */
  charsPerSecond: number;
}

/**
 * Kuratierte Auswahl deutscher Stimmen.
 *
 * WICHTIGER BEFUND (2026-09-15, direkt gegen die API geprüft): Google liefert für de-DE nur noch
 * ZWEI WaveNet-Stimmen aus (G weiblich, H männlich) - die früheren A-F gibt es nicht mehr. Zwei
 * Stimmen sind für eine Auswahl dünn, deshalb sind die beiden Neural2-Stimmen zusätzlich dabei
 * und im Panel als teurere Variante gekennzeichnet. Chirp3-HD (30 USD) und Studio (160 USD)
 * bleiben bewusst draußen: für vorgelesene Ein-Satz-Segmente rechtfertigt das den Preis nicht.
 */
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "de-DE-Wavenet-H", label: "Männlich, zügig", description: "Männliche Stimme, sachlich, etwas schnelleres Sprechtempo", tier: "wavenet", charsPerSecond: 16.4 },
  { id: "de-DE-Wavenet-G", label: "Weiblich, ruhig", description: "Weibliche Stimme, ruhiges, gleichmäßiges Sprechtempo", tier: "wavenet", charsPerSecond: 14.6 },
  { id: "de-DE-Neural2-H", label: "Männlich, natürlicher (teurer)", description: "Männliche Stimme der neueren Neural2-Generation - klingt natürlicher, kostet das Vierfache", tier: "neural2", charsPerSecond: 16.0 },
  { id: "de-DE-Neural2-G", label: "Weiblich, natürlicher (teurer)", description: "Weibliche Stimme der neueren Neural2-Generation - klingt natürlicher, kostet das Vierfache", tier: "neural2", charsPerSecond: 15.0 },
];

export const DEFAULT_VOICE_ID = "de-DE-Wavenet-H";

export function getVoiceOption(id: string | null | undefined): VoiceOption {
  return VOICE_OPTIONS.find((v) => v.id === id) ?? VOICE_OPTIONS.find((v) => v.id === DEFAULT_VOICE_ID)!;
}

const apiKey = (): string => process.env.GOOGLE_TTS_API_KEY ?? "";

/** Ohne Schlüssel läuft alles weiter, nur eben stumm (siehe video.ts) - kein Fehler. */
export function ttsAvailable(): boolean {
  return Boolean(apiKey());
}

export function estimateTtsCostUsd(chars: number, tier: VoiceTier): number {
  return (chars / 1_000_000) * PRICE_PER_MILLION_CHARS[tier];
}

export interface SynthesisResult {
  audioBase64: string;
  /** MP3 - reicht für eine Sprachspur und ist deutlich kleiner als LINEAR16. */
  mimeType: string;
  chars: number;
  costUsd: number;
}

/**
 * Wandelt einen Textabschnitt in Sprache. `speakingRate` bleibt normalerweise auf 1.0 - schneller
 * sprechen lassen, um mehr Text in dieselbe Zeit zu quetschen, klingt gehetzt; stattdessen
 * bekommt die Text-Generierung ein Zeichen-Budget (siehe video.ts).
 *
 * Wirft bei Fehler (auch bei fehlendem Schlüssel) - der Aufrufer entscheidet, ob das heißt
 * "Video ohne Ton" (der Normalfall, siehe video.ts) oder "ganz abbrechen".
 */
export async function synthesizeSpeech(text: string, voiceId: string, speakingRate = 1.0): Promise<SynthesisResult> {
  const key = apiKey();
  if (!key) throw new ToolError("Sprachausgabe ist nicht konfiguriert (GOOGLE_TTS_API_KEY fehlt).");
  const trimmed = text.trim();
  if (!trimmed) throw new ToolError("Sprachausgabe: leerer Text.");

  const voice = getVoiceOption(voiceId);
  const { data } = await withRetry(
    () =>
      axios.post<{ audioContent?: string }>(
        `${TTS_ENDPOINT}?key=${encodeURIComponent(key)}`,
        {
          input: { text: trimmed },
          voice: { languageCode: "de-DE", name: voice.id },
          audioConfig: { audioEncoding: "MP3", speakingRate },
        },
        { headers: { "content-type": "application/json" }, timeout: 30_000 },
      ),
    2,
    "Google TTS",
  );
  if (!data.audioContent) throw new ToolError("Sprachausgabe: Google hat keine Audiodaten geliefert.");

  return {
    audioBase64: data.audioContent,
    mimeType: "audio/mpeg",
    chars: trimmed.length,
    costUsd: estimateTtsCostUsd(trimmed.length, voice.tier),
  };
}

/** Ein kurzer Beispielsatz zum Vorhören im Panel - bewusst derselbe für jede Stimme, damit der
 *  Vergleich etwas aussagt. */
export const VOICE_PREVIEW_TEXT = "So klingt Ihre Stimme im fertigen Video: kurz, klar und auf den Punkt.";
