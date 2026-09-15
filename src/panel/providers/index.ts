import { google } from "./google.js";
import { instagram } from "./instagram.js";
import { linkedin } from "./linkedin.js";
import type { Provider } from "./types.js";

// Reihenfolge = Reihenfolge der Schritte im Panel. Neue Plattform hier eintragen.
export const providers: Provider[] = [instagram, linkedin, google];

export function getProvider(id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}

/**
 * Was das Panel dem Kunden tatsächlich anbietet. Unterschied zu `providers`: ein Provider mit
 * `hiddenUntilConfigured` (heute: Google-Unternehmensprofil) erscheint erst, wenn seine
 * Zugangsdaten hinterlegt sind - bis dahin sieht der Kunde das Panel unverändert wie bisher.
 * `getProvider`/`providers` bleiben absichtlich vollständig: eine bereits bestehende Verbindung
 * muss auch dann noch aufgelöst/verlängert werden können, wenn der Schlüssel kurzzeitig fehlt.
 */
export function visibleProviders(): Provider[] {
  return providers.filter((p) => !p.hiddenUntilConfigured || p.isConfigured());
}
