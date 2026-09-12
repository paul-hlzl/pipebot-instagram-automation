/**
 * Loest bei zeitkritischen Kunden-Aktionen (Jetzt posten / Beitrag freigeben) sofort einen
 * zusaetzlichen Lauf der "Pipeline Kunden-Loop"-Routine aus, statt auf den naechsten
 * stuendlichen Zeitplan-Trigger zu warten (siehe docs/ROUTINE_TEIL1.md). Nutzt den offiziellen
 * API-Trigger-Mechanismus fuer Claude-Routinen: POST an eine pro-Routine-URL mit eigenem
 * Bearer-Token, additiv neben dem bestehenden Stunden-Zeitplan (ersetzt ihn nicht) - siehe
 * https://code.claude.com/docs/en/routines#add-an-api-trigger und
 * https://platform.claude.com/docs/en/api/claude-code/routines-fire.
 *
 * ROUTINE_TRIGGER_URL/ROUTINE_TRIGGER_TOKEN muessen einmalig manuell in der Claude-Code-Web-UI
 * erzeugt werden (kein API-Weg dafuer, siehe docs/ROUTINE_TEIL_A.md) - ohne sie konfiguriert zu
 * haben, ist dieses Modul ein no-op und die Kunden-Aktion funktioniert unveraendert wie zuvor
 * (Bearbeitung beim naechsten stuendlichen Lauf).
 *
 * Bewusst fire-and-forget: ein Fehler oder Timeout hier darf die eigentliche Kunden-Aktion
 * (Speichern/Freigeben) NIE blockieren oder ihr einen Fehler vortaeuschen - daher nie awaited
 * von den Router-Handlern, nie geworfen.
 */

const TIMEOUT_MS = 4_000;
// Jeder Routine-Lauf verarbeitet ohnehin ALLE faelligen Kunden/Kanaele in einem Durchgang - ein
// zusaetzlicher Lauf innerhalb dieses Fensters haette meist nichts mehr zu tun, kostet aber
// unnoetig ein Kontingent aus dem taeglichen Routine-Limit (siehe Bericht: pro Account
// begrenzt). Ein kurzer Schwall an Klicks (mehrere Freigaben hintereinander) loest so nur
// einen Lauf aus, nicht einen pro Klick.
const COOLDOWN_MS = 15_000;

let lastFiredAt = 0;

export function triggerRoutineNow(reason: string): void {
  const url = process.env.ROUTINE_TRIGGER_URL?.trim();
  const token = process.env.ROUTINE_TRIGGER_TOKEN?.trim();
  if (!url || !token) return; // Nicht konfiguriert - Kunde wartet weiter auf den stuendlichen Takt.

  const now = Date.now();
  if (now - lastFiredAt < COOLDOWN_MS) return;
  lastFiredAt = now;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
    },
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[panel] Routine-Sofort-Trigger (${reason}) antwortete mit HTTP ${res.status}`);
      }
    })
    .catch((err) => {
      console.warn(
        `[panel] Routine-Sofort-Trigger (${reason}) fehlgeschlagen (Kunden-Aktion war trotzdem erfolgreich - naechster stuendlicher Lauf holt es nach):`,
        err instanceof Error ? err.message : err,
      );
    })
    .finally(() => clearTimeout(timer));
}
