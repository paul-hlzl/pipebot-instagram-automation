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
