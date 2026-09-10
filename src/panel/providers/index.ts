import { instagram } from "./instagram.js";
import { linkedin } from "./linkedin.js";
import type { Provider } from "./types.js";

// Reihenfolge = Reihenfolge der Schritte im Panel. Neue Plattform hier eintragen.
export const providers: Provider[] = [instagram, linkedin];

export function getProvider(id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}
