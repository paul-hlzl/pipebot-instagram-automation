#!/usr/bin/env node
/**
 * Tests für die Video-Diashow (video.ts/tts.ts/schedule.ts). Zwei Teile:
 *
 *  1. Deterministische Logik ohne jeden externen Aufruf: Zeitplan-Berechnung, Zeichen-Budget,
 *     Abschnitts-Timing (inkl. der Kernregel "die Sprachausgabe gibt das Timing vor, nicht die
 *     eingestellte Länge").
 *  2. Ein ECHTES Rendering mit ffmpeg - ohne KI, ohne fal.ai, ohne Google: Hintergrund ist ein
 *     lokal gerechneter Farbverlauf, Text ist fest verdrahtet. Prüft, dass am Ende wirklich ein
 *     abspielbares 1080x1920-MP4 herauskommt, und misst die Renderzeit. Wird übersprungen, wenn
 *     ffmpeg auf der Maschine fehlt (dort läuft dann auch das Feature selbst nicht).
 *
 * Läuft gegen eine eigene Wegwerf-Datenbank, nie gegen Produktion oder Staging.
 *
 * Aufruf: npm run test:video
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeflow-video-test-"));
process.env.PANEL_DB_PATH = path.join(tmpDir, "video-test.db");
process.env.PANEL_ENCRYPTION_KEY = process.env.PANEL_ENCRYPTION_KEY ?? "0".repeat(64);
process.env.PANEL_MAIL_DRY_RUN = "1";

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` (${detail})` : ""}`);
    console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

const {
  buildTimeline,
  spokenCharBudget,
  POINTS_PER_LENGTH,
  renderSlideshowVideo,
  videoRenderingAvailable,
  probeDurationSeconds,
  runQueued,
  renderQueueDepth,
  VIDEO_WIDTH,
  VIDEO_HEIGHT,
} = await import("../dist/video.js");
const { VOICE_OPTIONS, getVoiceOption, estimateTtsCostUsd, DEFAULT_VOICE_ID } = await import("../dist/tts.js");
const { isVideoDue, nextVideoPostAt } = await import("../dist/panel/schedule.js");
const { renderGradientBackground } = await import("../dist/gradient.js");

console.log("Aufbau je Videolänge:");
{
  ok("5 Sekunden = Hook, eine Aussage, Abschluss", POINTS_PER_LENGTH[5].min === 1 && POINTS_PER_LENGTH[5].max === 1, JSON.stringify(POINTS_PER_LENGTH[5]));
  ok("10 Sekunden = zwei bis drei Aussagen", POINTS_PER_LENGTH[10].min === 2 && POINTS_PER_LENGTH[10].max === 3, JSON.stringify(POINTS_PER_LENGTH[10]));
  ok("15 Sekunden = drei bis vier Aussagen", POINTS_PER_LENGTH[15].min === 3 && POINTS_PER_LENGTH[15].max === 4, JSON.stringify(POINTS_PER_LENGTH[15]));

  const voice = getVoiceOption(DEFAULT_VOICE_ID);
  const b5 = spokenCharBudget(5, voice.charsPerSecond);
  const b10 = spokenCharBudget(10, voice.charsPerSecond);
  const b15 = spokenCharBudget(15, voice.charsPerSecond);
  ok("längeres Video = mehr Text", b5 < b10 && b10 < b15, `${b5}/${b10}/${b15}`);
  // Gemessen wurden 14,6-16,4 Zeichen/s (siehe tts.ts) - ein 10s-Budget muss in dieser Groessenordnung liegen.
  ok("10-Sekunden-Budget liegt im gemessenen Bereich", b10 > 90 && b10 < 170, String(b10));
}

console.log("\nStimmen:");
{
  ok("Standardstimme existiert in der Liste", VOICE_OPTIONS.some((v) => v.id === DEFAULT_VOICE_ID));
  ok("unbekannte Stimme fällt auf die Standardstimme zurück", getVoiceOption("gibt-es-nicht").id === DEFAULT_VOICE_ID);
  ok("jede Stimme hat einen laienverständlichen Namen", VOICE_OPTIONS.every((v) => v.label && !v.label.includes("de-DE")));
  // 4 USD je 1 Mio. Zeichen (WaveNet) - 150 Zeichen kosten damit 0,0006 USD.
  ok("WaveNet-Kosten stimmen mit dem Preisblatt überein", Math.abs(estimateTtsCostUsd(1_000_000, "wavenet") - 4) < 0.001, String(estimateTtsCostUsd(1_000_000, "wavenet")));
  ok("Neural2 kostet das Vierfache", Math.abs(estimateTtsCostUsd(1_000_000, "neural2") - 16) < 0.001, String(estimateTtsCostUsd(1_000_000, "neural2")));
}

console.log("\nTiming (die Sprachausgabe gibt den Takt vor):");
{
  const segments = [
    { kind: "hook", text: "Hook" },
    { kind: "point", text: "Punkt 1" },
    { kind: "cta", text: "Jetzt testen" },
  ];

  const silent = buildTimeline(segments, null, 10);
  ok("ohne Ton trifft das Video die eingestellte Länge", Math.abs(silent.total - 10) < 0.6, String(silent.total));
  ok("ohne Ton überschneidet sich kein Abschnitt", silent.timeline.every((s, i) => i === 0 || s.start >= silent.timeline[i - 1].end - 0.001));
  ok("ohne Ton hat jeder Abschnitt Anzeigezeit", silent.timeline.every((s) => s.end - s.start >= 1.29));

  // Sprachausgabe laenger als eingestellt: das Video wird laenger, statt den Satz abzuschneiden.
  const longAudio = [
    { path: "/tmp/a0.mp3", duration: 3.5 },
    { path: "/tmp/a1.mp3", duration: 4.0 },
    { path: "/tmp/a2.mp3", duration: 2.5 },
  ];
  const spoken = buildTimeline(segments, longAudio, 10);
  ok("mit Ton richtet sich die Länge nach dem Gesprochenen", spoken.total > 10, String(spoken.total));
  ok("jeder Abschnitt ist mindestens so lang wie sein Satz", spoken.timeline.every((s, i) => s.end - s.start >= longAudio[i].duration));
  ok("jeder Abschnitt kennt seine Audiodatei", spoken.timeline.every((s, i) => s.audioPath === longAudio[i].path));

  // Sehr kurze Saetze duerfen nicht zu hektischen Blitz-Einblendungen fuehren.
  const shortAudio = [
    { path: "/tmp/b0.mp3", duration: 0.4 },
    { path: "/tmp/b1.mp3", duration: 0.5 },
    { path: "/tmp/b2.mp3", duration: 0.3 },
  ];
  const quick = buildTimeline(segments, shortAudio, 10);
  // 1.29 statt 1.3: die Grenze ist 1,3s, Fliesskomma-Addition landet knapp darunter.
  ok("sehr kurze Sätze bekommen trotzdem Lesezeit", quick.timeline.every((s) => s.end - s.start >= 1.29), JSON.stringify(quick.timeline.map((s) => +(s.end - s.start).toFixed(3))));
}

console.log("\nEigener Wochenplan:");
{
  const { db, nowIso } = await import("../dist/panel/db.js");
  const now = nowIso();
  db.prepare(
    `INSERT INTO customers (id, company, contact_name, email, tone, frequency, post_time, login_key_hash, status, consent_at, created_at, updated_at, email_verified)
     VALUES ('cus_v', 'Video GmbH', 'T', 'v@example.invalid', 'sachlich', 'werktags', '15:00', 'h', 'active', ?, ?, ?, 1)`,
  ).run(now, now, now);

  const base = { customerId: "cus_v", frequency: "werktags", postTime: "15:00" };
  // Montag, 14.09.2026, 18:00 Wiener Zeit.
  const monday = new Date("2026-09-14T16:00:00Z");
  const tuesday = new Date("2026-09-15T16:00:00Z");

  ok("ohne gewählte Video-Tage ist nie ein Video fällig", isVideoDue({ ...base, videoWeekdays: null }, monday) === false);
  ok("ohne gewählte Video-Tage gibt es keinen Termin", nextVideoPostAt({ ...base, videoWeekdays: null }, monday) === null);
  ok("am gewählten Tag nach der Uhrzeit ist ein Video fällig", isVideoDue({ ...base, videoWeekdays: "1" }, monday) === true);
  ok("an einem nicht gewählten Tag nicht", isVideoDue({ ...base, videoWeekdays: "1" }, tuesday) === false);
  ok("vor der eigenen Uhrzeit noch nicht", isVideoDue({ ...base, videoWeekdays: "1", videoPostTime: "23:00" }, monday) === false);
  ok("die eigene Video-Uhrzeit schlägt die normale", isVideoDue({ ...base, videoWeekdays: "1", postTime: "23:00", videoPostTime: "10:00" }, monday) === true);

  // Der wichtigste Fall: ein normaler Feed-Beitrag am selben Tag darf das Video NICHT als
  // erledigt markieren - und ein bereits veroeffentlichtes Video schon.
  db.prepare(
    `INSERT INTO posts (id, customer_id, provider, external_post_id, headline, caption, image_url, posted_at, format)
     VALUES ('post_single', 'cus_v', 'instagram', 'x', 'h', 'c', NULL, ?, 'single')`,
  ).run(monday.toISOString());
  ok("ein normaler Instagram-Beitrag blockiert das Video nicht", isVideoDue({ ...base, videoWeekdays: "1" }, monday) === true);

  db.prepare(
    `INSERT INTO posts (id, customer_id, provider, external_post_id, headline, caption, image_url, posted_at, format)
     VALUES ('post_video', 'cus_v', 'instagram', 'y', 'h', 'c', NULL, ?, 'video_slideshow')`,
  ).run(monday.toISOString());
  ok("ein schon veröffentlichtes Video blockiert einen zweiten Lauf", isVideoDue({ ...base, videoWeekdays: "1" }, monday) === false);
  db.close();
}

console.log("\nWarteschlange (ein Rendering zur Zeit):");
{
  const order = [];
  const slow = (label, ms) =>
    runQueued(async () => {
      order.push(`${label}-start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${label}-ende`);
    });
  const all = Promise.all([slow("a", 120), slow("b", 20), slow("c", 20)]);
  await new Promise((r) => setTimeout(r, 30));
  const depth = renderQueueDepth();
  ok("zweites Rendering wartet, statt parallel zu laufen", depth.active === 1 && depth.waiting === 2, JSON.stringify(depth));
  await all;
  ok("Aufträge laufen sauber nacheinander", order.join(",") === "a-start,a-ende,b-start,b-ende,c-start,c-ende", order.join(","));
}

console.log("\nEchtes Rendering (ffmpeg):");
if (!(await videoRenderingAvailable())) {
  console.log("  skip - ffmpeg/ffprobe nicht installiert (dann läuft auch das Feature selbst nicht)");
} else {
  const background = await renderGradientBackground("#0a0e1a", "#1f4f8b", "diagonal", 768, 1344);
  const started = Date.now();
  const rendered = await renderSlideshowVideo({
    background,
    segments: [
      { kind: "hook", text: "Ein Test ohne echte Kundendaten" },
      { kind: "point", text: "Diese Zeile ist absichtlich deutlich zu lang für eine einzige Zeile im Bild" },
      { kind: "cta", text: "Fertig" },
    ],
    audio: null,
    targetSeconds: 5,
    zoom: "in",
    branding: { watermarkText: "Testfirma", fontId: "inter" },
  });
  const outFile = path.join(tmpDir, "render.mp4");
  fs.writeFileSync(outFile, rendered.videoBuffer);

  ok("ein abspielbares MP4 entsteht", rendered.videoBuffer.length > 20_000, `${rendered.videoBuffer.length} Bytes`);
  ok("Standbild für die Vorschau entsteht mit", rendered.posterBuffer.length > 5_000, `${rendered.posterBuffer.length} Bytes`);
  ok("Dauer entspricht der Einstellung", Math.abs(rendered.durationSeconds - 5) < 1.2, String(rendered.durationSeconds));
  ok("stumm gerendert, weil kein Ton übergeben wurde", rendered.hasAudio === false);
  const probed = await probeDurationSeconds(outFile);
  ok("ffprobe liest dieselbe Dauer aus der Datei", Math.abs(probed - rendered.durationSeconds) < 0.3, String(probed));

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,pix_fmt", "-of", "csv=p=0", outFile,
  ]);
  // ffprobe gibt die Felder in Stream-Reihenfolge aus, nicht in der Reihenfolge von -show_entries.
  const [codec, width, height, pixFmt] = stdout.trim().split(",");
  ok("Hochformat 1080x1920 (Instagram Reels)", Number(width) === VIDEO_WIDTH && Number(height) === VIDEO_HEIGHT, stdout.trim());
  ok("H.264 in yuv420p (von Instagram akzeptiert)", codec === "h264" && pixFmt === "yuv420p", stdout.trim());
  console.log(`  (Renderzeit für 5 Sekunden Video: ${((Date.now() - started) / 1000).toFixed(1)}s auf dieser Maschine)`);
}

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\nFehlgeschlagen:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
