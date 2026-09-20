/**
 * Ein Kundenkonto samt allem entfernen, was daran haengt (20.09.2026).
 *
 * Bisher gab es das nur als Einmal-Werkzeug (scripts/kunden-loeschen.mjs) mit einer von Hand
 * gepflegten Tabellenliste. Diese Liste war schon unvollstaendig - `posts` fehlte darin, und
 * weil better-sqlite3 Fremdschluessel standardmaessig NICHT erzwingt, waeren Beitraege als
 * Waisen liegengeblieben.
 *
 * Darum wird hier nicht gepflegt, sondern GEFRAGT: jede Tabelle, die eine Spalte `customer_id`
 * hat, wird geleert. Eine neue Tabelle mit Kundenbezug ist damit automatisch abgedeckt - genau
 * die Sorte Fehler, die sonst erst Monate spaeter auffaellt.
 *
 * NICHT umkehrbar. Der Aufrufer legt die Sicherung an, nicht diese Funktion.
 */
import type { Database as Datenbank } from "better-sqlite3";

/** Tabellen, die keinen `customer_id` haben, aber ueber einen Beitrag am Kunden haengen. */
const UEBER_BEITRAG: { tabelle: string; spalte: string; quelle: string }[] = [
  { tabelle: "post_media", spalte: "post_id", quelle: "posts" },
  { tabelle: "planned_post_undo", spalte: "post_id", quelle: "planned_posts" },
];

function hatSpalte(db: Datenbank, tabelle: string, spalte: string): boolean {
  try {
    return (db.prepare(`PRAGMA table_info(${tabelle})`).all() as { name: string }[]).some((s) => s.name === spalte);
  } catch {
    return false;
  }
}

/** Alle Tabellen dieser Datenbank, die einen Kundenbezug haben - ohne `customers` selbst. */
export function kundenTabellen(db: Datenbank): string[] {
  const alle = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return alle
    .map((t) => t.name)
    .filter((t) => t !== "customers" && hatSpalte(db, t, "customer_id"))
    .sort();
}

export interface Entfernt {
  kundeGefunden: boolean;
  /** Geloeschte Zeilen je Tabelle, nur Tabellen mit mindestens einer Zeile. */
  zeilen: Record<string, number>;
}

/**
 * Entfernt genau einen Kunden. Laeuft in EINER Transaktion: entweder ist alles weg oder nichts -
 * ein halb geloeschtes Konto waere schlimmer als ein ganzes, weil Anmeldung und Planung dann auf
 * unterschiedliche Reste treffen.
 */
export function entferneKunde(db: Datenbank, customerId: string): Entfernt {
  const da = db.prepare("SELECT 1 FROM customers WHERE id = ?").get(customerId);
  if (!da) return { kundeGefunden: false, zeilen: {} };

  const zeilen: Record<string, number> = {};
  const tabellen = kundenTabellen(db);

  db.transaction(() => {
    // Erst die Anhaengsel am Beitrag, solange die Beitraege noch da sind.
    for (const { tabelle, spalte, quelle } of UEBER_BEITRAG) {
      if (!hatSpalte(db, tabelle, spalte) || !hatSpalte(db, quelle, "customer_id")) continue;
      const r = db
        .prepare(`DELETE FROM ${tabelle} WHERE ${spalte} IN (SELECT id FROM ${quelle} WHERE customer_id = ?)`)
        .run(customerId);
      if (r.changes) zeilen[tabelle] = (zeilen[tabelle] ?? 0) + r.changes;
    }
    for (const t of tabellen) {
      const r = db.prepare(`DELETE FROM ${t} WHERE customer_id = ?`).run(customerId);
      if (r.changes) zeilen[t] = (zeilen[t] ?? 0) + r.changes;
    }
    const r = db.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
    if (r.changes) zeilen.customers = r.changes;
  })();

  return { kundeGefunden: true, zeilen };
}

/**
 * Alle Dateien eines Kunden, die NICHT in der Datenbank liegen (20.09.2026).
 *
 * Die Zeilen zu loeschen genuegt nicht: die Bilder liegen im Objektspeicher (R2), die Logos als
 * Dateien auf der Platte. Vor dem 20.09. blieb beides nach einer Kontoloeschung unbegrenzt
 * liegen - und die R2-Bilder sind ueber ihre Adresse oeffentlich abrufbar.
 *
 * Bewusst getrennt vom Loeschen selbst: diese Funktion liest nur und braucht kein Netz, damit
 * `entferneKunde` eine reine Datenbank-Transaktion bleibt. Der Aufrufer raeumt die Dateien auf,
 * BEVOR er die Zeilen entfernt - danach weiss niemand mehr, welche es waren.
 */
export interface KundenDateien {
  /** Schluessel im Objektspeicher, z. B. "posts/2026-09-20T...png". */
  r2Schluessel: string[];
  /** Absolute Pfade auf der Platte (Logos). */
  lokaleDateien: string[];
}

/** Macht aus einer gespeicherten Adresse den Objektschluessel - oder null, wenn sie nicht uns gehoert. */
export function r2SchluesselAus(adresse: string | null | undefined, bucketUrl: string): string | null {
  if (!adresse || !bucketUrl) return null;
  const basis = bucketUrl.replace(/\/$/, "");
  if (!adresse.startsWith(basis + "/")) return null;
  const schluessel = adresse.slice(basis.length + 1);
  // Nur unsere eigenen Ablagen anfassen - nie etwas anderes im selben Eimer.
  return /^(posts|videos|voice-tmp)\//.test(schluessel) ? schluessel : null;
}

export function sammleKundenDateien(db: Datenbank, customerId: string, bucketUrl: string): KundenDateien {
  const r2 = new Set<string>();
  const lokal = new Set<string>();

  // Jede Tabelle, die eine Bild- oder Videoadresse zu diesem Kunden haelt.
  const bildQuellen: { tabelle: string; spalten: string[] }[] = [
    { tabelle: "posts", spalten: ["image_url", "video_url"] },
    { tabelle: "planned_posts", spalten: ["image_url", "video_url"] },
    { tabelle: "pending_approvals", spalten: ["image_url", "video_url"] },
  ];
  for (const { tabelle, spalten } of bildQuellen) {
    for (const spalte of spalten) {
      if (!hatSpalte(db, tabelle, spalte)) continue;
      for (const zeile of db
        .prepare(`SELECT ${spalte} AS a FROM ${tabelle} WHERE customer_id = ? AND ${spalte} IS NOT NULL`)
        .all(customerId) as { a: string }[]) {
        const k = r2SchluesselAus(zeile.a, bucketUrl);
        if (k) r2.add(k);
      }
    }
  }

  // Karussell-Folien haengen am Beitrag, nicht am Kunden.
  if (hatSpalte(db, "post_media", "image_url") && hatSpalte(db, "post_media", "post_id")) {
    for (const zeile of db
      .prepare("SELECT image_url AS a FROM post_media WHERE post_id IN (SELECT id FROM posts WHERE customer_id = ?)")
      .all(customerId) as { a: string }[]) {
      const k = r2SchluesselAus(zeile.a, bucketUrl);
      if (k) r2.add(k);
    }
  }

  // Logos liegen als Datei auf der Platte, nicht im Objektspeicher. `detected_logo_url` wurde
  // bisher nirgends aufgeraeumt - nur `logo_url`.
  const kunde = db
    .prepare("SELECT logo_url, detected_logo_url FROM customers WHERE id = ?")
    .get(customerId) as { logo_url: string | null; detected_logo_url: string | null } | undefined;
  for (const pfad of [kunde?.logo_url, kunde?.detected_logo_url]) {
    if (pfad && pfad.startsWith("/")) lokal.add(pfad);
  }

  return { r2Schluessel: [...r2], lokaleDateien: [...lokal] };
}
