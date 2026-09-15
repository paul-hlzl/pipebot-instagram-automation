/**
 * Video-Diashow (Instagram Reels) - deterministisches Rendering per ffmpeg, KEIN KI-Videomodell.
 *
 * Warum so: ein generatives Videomodell (Sora/Runway/Kling) kostet pro Video Geld und kann
 * Artefakte produzieren, die niemand vor der Veröffentlichung noch geradebiegt. Hier entsteht
 * stattdessen bewegte Typografie auf dem Marken-Hintergrund des Kunden - jedes Bild davon ist
 * vorhersagbar, das Rendering läuft auf dem eigenen Server und kostet nichts.
 *
 * AUFBAU EINES VIDEOS (Länge 5/10/15s, vom Kunden einstellbar):
 *   Hook -> 1-4 Kernaussagen -> Call-to-Action, alle auf EINEM durchgehenden Hintergrund mit
 *   langsamem Ken-Burns-Zoom. Keine harten Schnitte: die Textkarten werden ein- und ausgeblendet,
 *   der Hintergrund läuft durch.
 *
 * WARUM EIN HINTERGRUND STATT EINES BILDES PRO ABSCHNITT: ein Schnitt zwischen mehreren
 * Hintergründen wäre genau der harte Schnitt, den der Auftrag nicht will, und jedes zusätzliche
 * Bild kostet fal.ai-Geld. Ein Video kostet dadurch nur ein einziges Hintergrundbild - weniger
 * als ein Karussell mit 3-7 Bildern (siehe Kostenvergleich im Session-Bericht).
 *
 * TEXTSATZ NICHT ÜBER ffmpegs drawtext: drawtext kann nicht umbrechen und kennt keine
 * Breitenbegrenzung - im Prototyp lief genau deshalb jede längere Zeile über den Bildrand hinaus.
 * Stattdessen wird jede Textkarte hier als transparentes PNG über dieselbe SVG-/sharp-Pipeline
 * gerendert, die auch die Beitragsbilder setzt (watermark.ts): gleicher Zeilenumbruch, gleiche
 * Schriftwahl und vor allem dieselbe harte textLength-Sicherung, die eine Zeile notfalls staucht,
 * statt sie über den Rand laufen zu lassen. ffmpeg blendet die fertigen Karten nur noch ein.
 *
 * TON: die Sprachausgabe (tts.ts) bestimmt das Timing, nicht umgekehrt - erst wird gesprochen,
 * dann wird gemessen (ffprobe), dann wird die Anzeigedauer jedes Abschnitts danach ausgerichtet.
 * Fällt die Sprachausgabe aus, entsteht dasselbe Video stumm, statt dass der ganze Beitrag
 * ausfällt (der Text steht ohnehin im Bild - Reels werden oft ohne Ton geschaut).
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { getFontOption, DEFAULT_FONT_ID } from "./fonts.js";
import { escapeXml, estimateTextWidth, wrapHeadline } from "./watermark.js";
import { ToolError } from "./errors.js";

const execFileAsync = promisify(execFile);

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
const FPS = 30;

/** Erlaubte Gesamtlängen (Sekunden) - im Panel wählbar. */
export const VIDEO_LENGTHS = [5, 10, 15] as const;
export type VideoLength = (typeof VIDEO_LENGTHS)[number];
export const DEFAULT_VIDEO_LENGTH: VideoLength = 10;

export type ZoomDirection = "in" | "out" | "alternate";
export const ZOOM_DIRECTIONS: ZoomDirection[] = ["in", "out", "alternate"];

/**
 * Wie viele Kernaussagen zwischen Hook und CTA passen, je Videolänge. Aus der gemessenen
 * Sprechgeschwindigkeit abgeleitet (~15 Zeichen/Sekunde, siehe tts.ts), nicht geraten:
 * mehr Abschnitte bei 5 Sekunden hieße entweder hetzen oder Text abschneiden.
 */
export const POINTS_PER_LENGTH: Record<VideoLength, { min: number; max: number }> = {
  5: { min: 1, max: 1 },
  10: { min: 2, max: 3 },
  15: { min: 3, max: 4 },
};

/** Zeichen-Budget für den GESAMTEN gesprochenen Text je Videolänge (Sprechtempo minus Luft für
 *  Pausen zwischen den Abschnitten). Basis: gemessene 14,6-16,4 Zeichen/s (tts.ts). */
export function spokenCharBudget(length: VideoLength, charsPerSecond: number): number {
  const pauseSeconds = 0.35 * (POINTS_PER_LENGTH[length].max + 2); // Hook + Punkte + CTA
  return Math.max(40, Math.round((length - pauseSeconds) * charsPerSecond));
}

export interface VideoSegment {
  kind: "hook" | "point" | "cta";
  /** Was im Bild steht - kurz, wird umbrochen. */
  text: string;
  /** Was gesprochen wird. Fehlt sie, wird `text` gesprochen. */
  spoken?: string;
}

export interface RenderedSegment extends VideoSegment {
  start: number;
  end: number;
  audioPath: string | null;
}

export interface VideoBranding {
  accentColor?: string;
  watermarkText?: string;
  logoPath?: string | null;
  fontId?: string;
}

const SEGMENT_GAP = 0.35;
const MIN_SEGMENT_SECONDS = 1.3;
const FADE = 0.35;

/** Anteil der Gesamtzeit je Abschnittstyp, wenn es KEINE Sprachausgabe gibt (stummes Video). */
const SILENT_WEIGHT: Record<VideoSegment["kind"], number> = { hook: 1.15, point: 1, cta: 1.2 };

/**
 * Legt fest, wann welcher Abschnitt zu sehen ist. Mit Sprachausgabe richtet sich alles nach der
 * GEMESSENEN Audiolänge (plus Pause) - das ist der ausdrückliche Wunsch aus dem Auftrag: nicht
 * stur 2 Sekunden pro Abschnitt, wenn das Sprechen länger dauert. Ohne Sprachausgabe wird die
 * gewählte Gesamtlänge gewichtet aufgeteilt.
 */
export function buildTimeline(
  segments: VideoSegment[],
  audio: { path: string; duration: number }[] | null,
  targetSeconds: number,
): { timeline: RenderedSegment[]; total: number } {
  if (!segments.length) throw new ToolError("Video: keine Abschnitte.");

  if (audio && audio.length === segments.length) {
    let cursor = 0.3; // kurzer Vorlauf, damit das Video nicht mit Text auf Frame 0 anfängt
    const timeline = segments.map((s, i) => {
      const duration = Math.max(MIN_SEGMENT_SECONDS, audio[i].duration + SEGMENT_GAP);
      const entry: RenderedSegment = { ...s, start: cursor, end: cursor + duration, audioPath: audio[i].path };
      cursor += duration;
      return entry;
    });
    return { timeline, total: Math.round((cursor + 0.4) * 100) / 100 };
  }

  const weights = segments.map((s) => SILENT_WEIGHT[s.kind]);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const usable = targetSeconds - 0.6;
  let cursor = 0.3;
  const timeline = segments.map((s, i) => {
    const duration = Math.max(MIN_SEGMENT_SECONDS, (usable * weights[i]) / weightSum);
    const entry: RenderedSegment = { ...s, start: cursor, end: cursor + duration, audioPath: null };
    cursor += duration;
    return entry;
  });
  return { timeline, total: Math.round(Math.max(targetSeconds, cursor + 0.3) * 100) / 100 };
}

/**
 * Wie hell ist der Hintergrund dort, wo gleich der Text steht? Gemessen wird nur das mittlere
 * Drittel - genau der Bereich, in dem die Textkarten liegen; die Ecken sind egal.
 *
 * Braucht man, weil es keinen Kasten hinter dem Text mehr gibt: weiße Schrift mit Schatten ist auf
 * einem dunklen Marken-Hintergrund perfekt lesbar, auf einer hellen Akzentfarbe (Beige, Creme,
 * helles Grau) dagegen nur noch knapp. Statt den Kasten zurückzuholen, dreht sich die Schrift
 * dann einfach um: dunkler Text mit hellem Schein.
 *
 * Rückgabewert 0 (schwarz) bis 1 (weiß), nach der üblichen Luminanz-Gewichtung.
 */
export async function backgroundLuminance(background: Buffer): Promise<number> {
  try {
    const meta = await sharp(background).metadata();
    const width = meta.width ?? 768;
    const height = meta.height ?? 1344;
    const stats = await sharp(background)
      .extract({ left: 0, top: Math.round(height * 0.33), width, height: Math.round(height * 0.34) })
      .stats();
    const [r, g, b] = stats.channels.map((c) => c.mean);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  } catch {
    // Im Zweifel "dunkel" annehmen - das ist der Normalfall für die Marken-Hintergründe hier.
    return 0;
  }
}

/**
 * Eine Textkarte als transparentes PNG. Gleiche Umbruch-/Schrumpf-Logik wie addHeadlineText
 * (watermark.ts).
 *
 * KEIN Kasten hinter dem Text (bis v22 war einer da): eine eigene dunkle Kachel auf dem
 * Hintergrund sah nach zwei gestapelten Ebenen aus statt nach einem durchgehenden Bild. Für die
 * Lesbarkeit sorgt stattdessen ein weicher Schlagschatten - derselbe Trick, mit dem Instagram
 * seine Story-Untertitel lesbar hält, ohne das Bild zu zerschneiden.
 *
 * Der Schatten entsteht in zwei sharp-Durchgängen (schwarzer Text -> weichzeichnen -> weißer Text
 * darüber) statt über einen SVG-Filter: `feDropShadow` hängt davon ab, was die im System
 * installierte librsvg-Version unterstützt, und ein stillschweigend ignorierter Filter wäre hier
 * besonders unangenehm - dann stünde weißer Text ohne jeden Kontrast auf einem hellen Hintergrund.
 * Der Weg über sharp funktioniert garantiert und kostet pro Karte wenige Millisekunden.
 *
 * Die Karte ist NUR so groß wie der Textblock, nicht bildfüllend, und bringt ihre Position selbst
 * mit. Das ist kein Detail, sondern der teuerste Hebel beim Rendern: ffmpeg legt jede Textebene
 * für jedes einzelne Bild neu über das Video, und eine 1080x1920-Ebene kostet dabei ein Vielfaches
 * einer 900x400-Ebene. Gemessen hat allein das die Renderzeit ungefähr halbiert.
 */
async function renderTextCard(
  text: string,
  kind: VideoSegment["kind"],
  branding: VideoBranding,
  /** 0-1, siehe backgroundLuminance - entscheidet über helle oder dunkle Schrift. */
  luminance: number,
): Promise<{ buffer: Buffer; x: number; y: number }> {
  const font = getFontOption(branding.fontId ?? DEFAULT_FONT_ID);
  // Reels-Sicherheitszone: oben Profilzeile, unten Beschreibung/Buttons - Text bleibt in der Mitte.
  const maxTextWidth = VIDEO_WIDTH * 0.84;
  const maxTextHeight = VIDEO_HEIGHT * 0.44;
  const maxFontSize = Math.round(VIDEO_HEIGHT * (kind === "point" ? 0.062 : 0.072));
  const minFontSize = Math.round(VIDEO_HEIGHT * 0.030);

  let fontSize = maxFontSize;
  let lines = wrapHeadline(text, fontSize, maxTextWidth, font.glyphWidthFactor);
  for (;;) {
    const lineHeight = fontSize * 1.2;
    const widest = Math.max(...lines.map((l) => estimateTextWidth(l, fontSize, font.glyphWidthFactor)));
    const fits = widest <= maxTextWidth && lineHeight * lines.length <= maxTextHeight && lines.length <= 4;
    if (fits || fontSize <= minFontSize) break;
    fontSize = Math.max(minFontSize, fontSize - Math.max(1, Math.round(fontSize * 0.07)));
    lines = wrapHeadline(text, fontSize, maxTextWidth, font.glyphWidthFactor);
  }

  const lineHeight = fontSize * 1.2;
  const blockHeight = lineHeight * lines.length;
  const widestLine = Math.min(
    Math.max(...lines.map((l) => estimateTextWidth(l, fontSize, font.glyphWidthFactor))),
    maxTextWidth,
  );
  // Rand groß genug, dass der weichgezeichnete Schatten nicht an der Kartenkante abgeschnitten
  // wird (sonst entstünde genau die harte Kante, die hier gerade verschwinden soll).
  const blurSigma = Math.max(3, fontSize * 0.09);
  const margin = Math.round(blurSigma * 4 + 20);
  const canvasWidth = Math.min(VIDEO_WIDTH, Math.round(widestLine) + margin * 2);
  const canvasHeight = Math.round(blockHeight) + margin * 2;
  const firstBaseline = margin + fontSize * 0.8;

  const tspans = (): string =>
    lines
      .map((line, i) => {
        const clamped = Math.min(estimateTextWidth(line, fontSize, font.glyphWidthFactor), maxTextWidth);
        return `<tspan x="${canvasWidth / 2}" y="${Math.round(firstBaseline + i * lineHeight)}" textLength="${Math.round(clamped)}" lengthAdjust="spacingAndGlyphs">${escapeXml(line)}</tspan>`;
      })
      .join("");

  const textSvg = (fill: string, opacity: number): Buffer =>
    Buffer.from(
      `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
        <text font-family="${escapeXml(font.cssFamily)}" font-size="${fontSize}" font-weight="${font.weight}" fill="${fill}" fill-opacity="${opacity}" text-anchor="middle">${tspans()}</text>
      </svg>`,
    );

  // Heller Hintergrund -> dunkle Schrift mit hellem Schein, sonst helle Schrift mit dunklem
  // Schatten. Die Schwelle liegt bewusst eher niedrig: ein mittelheller Hintergrund trägt weiße
  // Schrift noch, ein wirklich heller nicht mehr.
  const lightBackground = luminance > 0.55;
  const textColor = lightBackground ? "#14161c" : "#ffffff";
  const shadowColor = lightBackground ? "#ffffff" : "#000000";
  // 1. Schatten: eingefärbter Text, weichgezeichnet. 2. Der eigentliche Text darüber.
  const shadow = await sharp(textSvg(shadowColor, lightBackground ? 0.95 : 0.85)).blur(blurSigma).png().toBuffer();
  const buffer = await sharp(shadow)
    .composite([{ input: textSvg(textColor, 1), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return {
    buffer,
    x: Math.round((VIDEO_WIDTH - canvasWidth) / 2),
    y: Math.round(VIDEO_HEIGHT * 0.47 - canvasHeight / 2),
  };
}

/** Dauerhaft eingeblendete Markenecke: eigenes Logo, sonst der Wasserzeichen-Text. Bleibt bewusst
 *  bildfüllend (eine einzige, dauerhaft sichtbare Ebene ohne Ein-/Ausblendung - der Zuschnitt
 *  würde hier nichts sparen, was den zusätzlichen Positions-Code rechtfertigt). */
async function renderBrandCard(branding: VideoBranding, luminance: number): Promise<Buffer | null> {
  const font = getFontOption(branding.fontId ?? DEFAULT_FONT_ID);
  const margin = Math.round(VIDEO_WIDTH * 0.06);

  if (branding.logoPath) {
    try {
      const logoWidth = Math.round(VIDEO_WIDTH * 0.22);
      const logo = await sharp(branding.logoPath).resize({ width: logoWidth, withoutEnlargement: true }).png().toBuffer();
      const meta = await sharp(logo).metadata();
      return sharp({ create: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: logo, left: VIDEO_WIDTH - (meta.width ?? logoWidth) - margin, top: VIDEO_HEIGHT - (meta.height ?? logoWidth) - margin }])
        .png()
        .toBuffer();
    } catch {
      // Kaputtes/fehlendes Logo darf kein Video kosten - dann eben der Text unten.
    }
  }

  const label = (branding.watermarkText || "").trim();
  if (!label) return null;
  const fontSize = Math.round(VIDEO_HEIGHT * 0.022);
  // Gleiche Umkehrung wie beim Haupttext (siehe backgroundLuminance).
  const svg = `<svg width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <text x="${VIDEO_WIDTH - margin}" y="${VIDEO_HEIGHT - margin}" text-anchor="end" font-family="${escapeXml(font.cssFamily)}" font-size="${fontSize}" font-weight="${font.weight}" fill="${luminance > 0.55 ? "#14161c" : "#ffffff"}" fill-opacity="0.82">${escapeXml(label)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function probeDurationSeconds(file: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  const value = Number(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new ToolError(`ffprobe: unbrauchbare Dauer für ${path.basename(file)}`);
  return value;
}

/** Ist ffmpeg/ffprobe überhaupt da? Ohne beides gibt es keine Video-Diashows (aber alles andere läuft weiter). */
export async function videoRenderingAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export interface RenderResult {
  videoBuffer: Buffer;
  posterBuffer: Buffer;
  durationSeconds: number;
  renderMs: number;
  hasAudio: boolean;
  timeline: RenderedSegment[];
}

/**
 * Baut das fertige MP4. `audio` ist optional - fehlt es (kein TTS-Schlüssel, Google gerade nicht
 * erreichbar), entsteht dasselbe Video stumm.
 *
 * Instagram-Reels-Vorgaben, gegen die hier gerendert wird: 1080x1920 (9:16), H.264 High Profile,
 * yuv420p, 30 fps, AAC-Ton, +faststart (Metadaten vorne, sonst lädt Instagram das Video
 * langsamer/verwirft es).
 */
export async function renderSlideshowVideo(input: {
  background: Buffer;
  segments: VideoSegment[];
  audio: { path: string; duration: number }[] | null;
  targetSeconds: number;
  zoom: "in" | "out";
  branding: VideoBranding;
}): Promise<RenderResult> {
  const startedAt = Date.now();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeflow-video-"));
  try {
    const { timeline, total } = buildTimeline(input.segments, input.audio, input.targetSeconds);
    const totalFrames = Math.round(total * FPS);

    const bgPath = path.join(workDir, "bg.jpg");
    await fs.writeFile(bgPath, input.background);
    const luminance = await backgroundLuminance(input.background);

    const cardPaths: string[] = [];
    const cardPositions: { x: number; y: number }[] = [];
    for (const [i, seg] of timeline.entries()) {
      const card = await renderTextCard(seg.text, seg.kind, input.branding, luminance);
      const p = path.join(workDir, `card${i}.png`);
      await fs.writeFile(p, card.buffer);
      cardPaths.push(p);
      cardPositions.push({ x: card.x, y: card.y });
    }
    const brandCard = await renderBrandCard(input.branding, luminance);
    let brandPath: string | null = null;
    if (brandCard) {
      brandPath = path.join(workDir, "brand.png");
      await fs.writeFile(brandPath, brandCard);
    }

    const args: string[] = ["-y", "-v", "error"];
    args.push("-loop", "1", "-t", String(total), "-i", bgPath);
    for (const p of cardPaths) args.push("-loop", "1", "-t", String(total), "-i", p);
    if (brandPath) args.push("-loop", "1", "-t", String(total), "-i", brandPath);
    const audioInputStart = 1 + cardPaths.length + (brandPath ? 1 : 0);
    const audioSegments = timeline.filter((s) => s.audioPath);
    for (const seg of audioSegments) args.push("-i", seg.audioPath as string);

    // Ken Burns: der Hintergrund wird zuerst großzügig hochskaliert, sonst ruckelt zoompan
    // sichtbar (es arbeitet pixelweise auf dem Eingangsbild).
    const zoomExpr =
      input.zoom === "in"
        ? `1+0.13*on/${totalFrames}`
        : `1.13-0.13*on/${totalFrames}`;
    // 1,35-fache Ausgabegröße reicht: mehr kostet nur Rechenzeit (gemessen), das Quellbild ist
    // ohnehin nur 768px breit und der Zoom geht nie über 13%.
    const chains: string[] = [
      `[0:v]scale=${Math.round(VIDEO_WIDTH * 1.35)}:${Math.round(VIDEO_HEIGHT * 1.35)}:flags=lanczos,setsar=1,` +
        `zoompan=z='${zoomExpr}':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:fps=${FPS}[bg]`,
    ];

    let last = "bg";
    timeline.forEach((seg, i) => {
      const fadeOutStart = Math.max(seg.start, seg.end - FADE);
      chains.push(
        `[${i + 1}:v]format=rgba,fade=t=in:st=${seg.start.toFixed(2)}:d=${FADE}:alpha=1,` +
          `fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${FADE}:alpha=1[c${i}]`,
      );
      // Leichte Aufwärtsbewegung des Textes innerhalb seines Abschnitts - gerade genug, dass das
      // Bild nie still steht, ohne dass es unruhig wirkt.
      const pos = cardPositions[i];
      const drift = `${pos.y}-18*(t-${seg.start.toFixed(2)})/${Math.max(0.5, seg.end - seg.start).toFixed(2)}`;
      chains.push(
        `[${last}][c${i}]overlay=x=${pos.x}:y='${drift}':enable='between(t,${seg.start.toFixed(2)},${seg.end.toFixed(2)})'[v${i}]`,
      );
      last = `v${i}`;
    });

    if (brandPath) {
      chains.push(`[${last}][${cardPaths.length + 1}:v]overlay=0:0[vb]`);
      last = "vb";
    }
    chains.push(`[${last}]fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.4).toFixed(2)}:d=0.4,format=yuv420p[vout]`);

    if (audioSegments.length) {
      const delayed = audioSegments.map((seg, i) => {
        const ms = Math.round(seg.start * 1000);
        return `[${audioInputStart + i}:a]adelay=${ms}|${ms},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`;
      });
      chains.push(...delayed);
      const mixInputs = audioSegments.map((_, i) => `[a${i}]`).join("");
      chains.push(`${mixInputs}amix=inputs=${audioSegments.length}:normalize=0,apad[aout]`);
    }

    args.push("-filter_complex", chains.join(";"));
    args.push("-map", "[vout]");
    if (audioSegments.length) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k", "-ar", "44100");
    args.push(
      "-t", String(total),
      "-r", String(FPS),
      "-c:v", "libx264",
      "-profile:v", "high",
      "-preset", process.env.VIDEO_FFMPEG_PRESET || "medium",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    );
    const outPath = path.join(workDir, "out.mp4");
    args.push(outPath);

    await execFileAsync("ffmpeg", args, { maxBuffer: 10 * 1024 * 1024 });

    // Vorschaubild (erstes Bild mit sichtbarem Hook) - das Panel zeigt es in der Freigabe-Karte,
    // und posts/pending_approvals haben ohnehin eine image_url-Spalte, die sonst leer bliebe.
    const posterPath = path.join(workDir, "poster.jpg");
    const posterAt = Math.min(total - 0.2, timeline[0].start + Math.max(0.5, (timeline[0].end - timeline[0].start) / 2));
    await execFileAsync("ffmpeg", ["-y", "-v", "error", "-ss", posterAt.toFixed(2), "-i", outPath, "-frames:v", "1", "-q:v", "3", posterPath]);

    const [videoBuffer, posterBuffer, realDuration] = await Promise.all([
      fs.readFile(outPath),
      fs.readFile(posterPath),
      probeDurationSeconds(outPath),
    ]);

    return {
      videoBuffer,
      posterBuffer,
      durationSeconds: Math.round(realDuration * 100) / 100,
      renderMs: Date.now() - startedAt,
      hasAudio: audioSegments.length > 0,
      timeline,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Warteschlange fürs Rendern. ffmpeg ist der einzige wirklich rechenintensive Schritt in diesem
 * Server (gemessen: ein 10-Sekunden-Video ~26s CPU-Zeit, siehe Session-Bericht) - liefen mehrere
 * Kunden-Renderings gleichzeitig, würden sie sich gegenseitig UND die stündliche Routine
 * ausbremsen. Deshalb standardmäßig genau EIN Rendering zur Zeit; alles Weitere wartet hier statt
 * auf den CPU-Kernen. Über VIDEO_RENDER_CONCURRENCY erhöhbar, falls der Server später mehr Luft hat.
 */
const MAX_PARALLEL_RENDERS = Math.max(1, Number(process.env.VIDEO_RENDER_CONCURRENCY) || 1);
let activeRenders = 0;
const waiting: (() => void)[] = [];

export function renderQueueDepth(): { active: number; waiting: number } {
  return { active: activeRenders, waiting: waiting.length };
}

export async function runQueued<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_PARALLEL_RENDERS) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeRenders++;
  try {
    return await fn();
  } finally {
    activeRenders--;
    const next = waiting.shift();
    if (next) next();
  }
}
