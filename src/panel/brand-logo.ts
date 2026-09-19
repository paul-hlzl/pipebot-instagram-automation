/**
 * Logo der Kundenwebsite finden und fuer die Kopfzeile aufbereiten (Auftrag 19.09.2026).
 *
 * Vorab geprueft an sieben echten Seiten (channoine-mayr.at, hittaro.com, pipeflow.at, orf.at,
 * oebb.at, apple.com, sonnentor.com): alle sieben liefern etwas Brauchbares, und in keinem Fall
 * war das Beste ein verpixeltes 32er-Favicon. Gefunden wurden echte Wortmarken (661x252 bei
 * Channoine, 400x228 bei Pipeflow, skalierbares SVG bei ORF und OEBB) und saubere quadratische
 * Marken ab 150 px. Deshalb wird gebaut statt abgesagt.
 *
 * Die Reihenfolge ist nach Verlaesslichkeit sortiert, nicht nach Groesse:
 *   1. JSON-LD Organization.logo - wenn eine Seite das setzt, ist es das echte Markenlogo.
 *   2. Ein <img> im Kopfbereich, das sich selbst "logo" nennt.
 *   3. Das groesste verlinkte Icon (apple-touch-icon, link rel=icon).
 * `og:image` ist bewusst NICHT dabei: das ist fast immer ein Foto oder eine Textgrafik fuer
 * soziale Netzwerke, kein Logo. Bei Channoine waere es ein 1161x700-Werbebild gewesen.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fetchBinarySafely } from "../ssrf-safe-fetch.js";

/** Kleiner als das taugt in der Kopfzeile nicht - darunter wird es beim Skalieren unsauber. */
const MIN_KANTE = 96;
/** Ab hier ist ein Logo so hell, dass es auf dem hellen Papiergrund verschwaende. */
const ZU_HELL = 215;
/** Kopfzeilenhoehe mal 3 fuer scharfe Darstellung auf dichten Bildschirmen. */
const ZIEL_HOEHE = 84;
const ZIEL_BREITE = 420;

export interface LogoFund {
  url: string;
  quelle: "json-ld" | "img" | "icon";
  breite: number;
  hoehe: number;
  /** Bringt das Bild seinen eigenen Hintergrund mit? Dann wird es wie eine App-Kachel gezeigt. */
  eigenerGrund: boolean;
}

function absolut(href: string, basis: string): string | null {
  try {
    const u = new URL(href, basis);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Alle plausiblen Logo-Adressen aus dem Quelltext, beste Quelle zuerst. */
export function logoKandidaten(html: string, basisUrl: string): { url: string; quelle: LogoFund["quelle"] }[] {
  const raus: { url: string; quelle: LogoFund["quelle"] }[] = [];
  const dazu = (href: string, quelle: LogoFund["quelle"]) => {
    const a = absolut(href, basisUrl);
    if (a && !raus.some((x) => x.url === a)) raus.push({ url: a, quelle });
  };

  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const roh: unknown = JSON.parse(m[1].trim());
      const liste = Array.isArray(roh) ? roh : [roh, ...(((roh as Record<string, unknown>)?.["@graph"] as unknown[]) ?? [])];
      for (const o of liste) {
        const logo = (o as Record<string, unknown>)?.logo;
        if (typeof logo === "string") dazu(logo, "json-ld");
        else if (logo && typeof logo === "object" && typeof (logo as Record<string, unknown>).url === "string") {
          dazu((logo as Record<string, string>).url, "json-ld");
        }
      }
    } catch {
      // Kaputtes JSON-LD ist im Netz die Regel, nicht die Ausnahme - still weitergehen.
    }
  }
  // Nur der Kopfbereich: weiter unten stehen Partner-, Zahlungs- und Siegel-Logos.
  for (const m of html.slice(0, 40_000).matchAll(/<img\b[^>]*>/gi)) {
    if (!/logo/i.test(m[0])) continue;
    const src = /(?:\ssrc|\sdata-src)=["']([^"']+)["']/i.exec(m[0]);
    if (src) dazu(src[1], "img");
  }
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    if (!/rel=["']?[^"'>]*(apple-touch-icon|icon)/i.test(m[0])) continue;
    const href = /href=["']([^"']+)["']/i.exec(m[0]);
    if (href && !/\.ico(\?|$)/i.test(href[1])) dazu(href[1], "icon");
  }
  return raus;
}

interface Geprueft extends LogoFund {
  bytes: Buffer;
  flaeche: number;
  rang: number;
}

/**
 * Holt die Kandidaten und waehlt den besten aus. Gibt null zurueck, wenn nichts taugt - dann
 * bleibt die Oberflaeche still beim Standardaussehen, genau wie bei fehlenden Farben.
 */
export async function logoFinden(html: string, basisUrl: string, timeoutMs = 8000): Promise<{ fund: LogoFund; bytes: Buffer } | null> {
  const kandidaten = logoKandidaten(html, basisUrl).slice(0, 8);
  const rangVon = { "json-ld": 1, img: 2, icon: 3 } as const;
  const geprueft: Geprueft[] = [];

  for (const k of kandidaten) {
    try {
      const { bytes } = await fetchBinarySafely(k.url, timeoutMs, 3_000_000);
      const meta = await sharp(bytes).metadata();
      const breite = meta.width ?? 0;
      const hoehe = meta.height ?? 0;
      if (Math.max(breite, hoehe) < MIN_KANTE) continue;
      // Helligkeit NUR ueber die sichtbaren Pixel: ein weisses Logo auf durchsichtigem Grund
      // waere auf dem Papierhintergrund unsichtbar.
      const { data, info } = await sharp(bytes).resize(48, 48, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let summe = 0;
      let sichtbar = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 3] < 40) continue;
        summe += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        sichtbar++;
      }
      if (!sichtbar) continue;
      const helligkeit = summe / sichtbar;
      const deckung = sichtbar / (info.width * info.height);
      // Ein flaechendeckendes Bild bringt seinen eigenen Hintergrund mit (App-Kachel).
      const eigenerGrund = !meta.hasAlpha || deckung > 0.92;
      if (helligkeit > ZU_HELL && !eigenerGrund) continue;
      geprueft.push({ url: k.url, quelle: k.quelle, breite, hoehe, eigenerGrund, bytes, flaeche: breite * hoehe, rang: rangVon[k.quelle] });
    } catch {
      // Ein Kandidat, der nicht laedt, ist kein Fehler - der naechste ist dran.
    }
  }
  if (!geprueft.length) return null;
  // Beste Quelle zuerst, innerhalb derselben Quelle das groesste Bild.
  geprueft.sort((a, b) => a.rang - b.rang || b.flaeche - a.flaeche);
  const best = geprueft[0];
  return { fund: { url: best.url, quelle: best.quelle, breite: best.breite, hoehe: best.hoehe, eigenerGrund: best.eigenerGrund }, bytes: best.bytes };
}

/** Auf Kopfzeilenmass bringen und als PNG ablegen. Gibt den Dateipfad zurueck. */
export async function logoAblegen(bytes: Buffer, verzeichnis: string, dateiname: string): Promise<string> {
  await fs.mkdir(verzeichnis, { recursive: true });
  const ziel = path.join(verzeichnis, dateiname);
  await sharp(bytes)
    .resize({ height: ZIEL_HOEHE, width: ZIEL_BREITE, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(ziel);
  return ziel;
}
