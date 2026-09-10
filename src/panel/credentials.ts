/**
 * Schnittstelle zwischen Kunden-Panel und MCP-Tools.
 * MCP-Tools holen sich Tokens NUR über diese Datei – nie direkt aus der DB.
 */
import { db, nowIso, cleanupExpired, type ConnectionRow, type CustomerRow } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";
import { getProvider } from "./providers/index.js";
import type { Provider, TokenSet } from "./providers/types.js";

const DAY = 86_400_000;

export type ConnectionStatus = "ok" | "renew-soon" | "expired";

function canAutoRefresh(provider: Provider, row: ConnectionRow): boolean {
  if (!provider.refresh) return false;
  if (provider.autoRefresh === "always") return true;
  if (provider.autoRefresh === "with-refresh-token") return Boolean(row.refresh_token_enc);
  return false;
}

export function connectionStatus(row: ConnectionRow): ConnectionStatus {
  if (!row.expires_at) return "ok";
  const left = new Date(row.expires_at).getTime() - Date.now();
  if (left <= 0) return "expired";
  const provider = getProvider(row.provider);
  if (provider && !canAutoRefresh(provider, row) && left < 7 * DAY) return "renew-soon";
  return "ok";
}

export interface ChannelOverview {
  provider: string;
  accountId: string;
  accountName: string | null;
  expiresAt: string | null;
  status: ConnectionStatus;
}

export interface CustomerOverview {
  customerId: string;
  company: string;
  website: string | null;
  industry: string | null;
  about: string | null;
  tone: string | null;
  frequency: string | null;
  postTime: string | null;
  channels: ChannelOverview[];
}

function channelsFor(customerId: string): ChannelOverview[] {
  const rows = db.prepare("SELECT * FROM connections WHERE customer_id = ?").all(customerId) as ConnectionRow[];
  return rows.map((r) => ({
    provider: r.provider,
    accountId: r.account_id,
    accountName: r.account_name,
    expiresAt: r.expires_at,
    status: connectionStatus(r),
  }));
}

function overview(c: CustomerRow): CustomerOverview {
  return {
    customerId: c.id,
    company: c.company,
    website: c.website,
    industry: c.industry,
    about: c.about,
    tone: c.tone,
    frequency: c.frequency,
    postTime: c.post_time,
    channels: channelsFor(c.id),
  };
}

/** Alle aktiven Kunden inkl. Briefing – für die Content-Routine. Enthält KEINE Tokens. */
export function listCustomers(): CustomerOverview[] {
  const rows = db.prepare("SELECT * FROM customers WHERE status = 'active' ORDER BY created_at").all() as CustomerRow[];
  return rows.map(overview);
}

export function getCustomerOverview(customerId: string): CustomerOverview | null {
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as CustomerRow | undefined;
  return row ? overview(row) : null;
}

async function refreshRow(provider: Provider, row: ConnectionRow): Promise<TokenSet> {
  const current: TokenSet = {
    accessToken: decrypt(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : undefined,
  };
  const next = await provider.refresh!(current);
  db.prepare(
    `UPDATE connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, updated_at = ?
     WHERE customer_id = ? AND provider = ?`,
  ).run(
    encrypt(next.accessToken),
    next.refreshToken ? encrypt(next.refreshToken) : row.refresh_token_enc,
    next.expiresAt ? next.expiresAt.toISOString() : row.expires_at,
    nowIso(),
    row.customer_id,
    row.provider,
  );
  return next;
}

function shouldRefresh(provider: Provider, row: ConnectionRow): boolean {
  if (!row.expires_at || !canAutoRefresh(provider, row)) return false;
  const left = new Date(row.expires_at).getTime() - Date.now();
  const ageMs = Date.now() - new Date(row.updated_at).getTime();
  // Instagram erlaubt Refresh erst, wenn der Token mind. 24h alt ist
  return left > 0 && left < provider.refreshWithinDays * DAY && ageMs > DAY;
}

/** Entschlüsselte Zugangsdaten für einen Kunden + Plattform. Verlängert automatisch, wenn nötig. */
export async function getCredentials(
  customerId: string,
  providerId: string,
): Promise<{ accountId: string; accountName: string | null; accessToken: string }> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unbekannte Plattform: ${providerId}`);

  const row = db
    .prepare("SELECT * FROM connections WHERE customer_id = ? AND provider = ?")
    .get(customerId, providerId) as ConnectionRow | undefined;
  if (!row) throw new Error(`Kunde ${customerId} hat ${provider.name} nicht verbunden.`);

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error(`${provider.name}-Zugang von Kunde ${customerId} ist abgelaufen – Kunde muss im Panel neu verbinden.`);
  }
  let accessToken = decrypt(row.access_token_enc);
  if (shouldRefresh(provider, row)) {
    try {
      accessToken = (await refreshRow(provider, row)).accessToken;
    } catch (err) {
      console.error(`[panel] Refresh ${providerId}/${customerId} fehlgeschlagen (alter Token noch gültig):`, err);
    }
  }
  return { accountId: row.account_id, accountName: row.account_name, accessToken };
}

/** Verlängert alle bald ablaufenden Tokens. Wird per Intervall aufgerufen. */
export async function refreshExpiringTokens(): Promise<{ refreshed: string[]; failed: string[] }> {
  cleanupExpired();
  const refreshed: string[] = [];
  const failed: string[] = [];
  const rows = db.prepare("SELECT * FROM connections").all() as ConnectionRow[];
  for (const row of rows) {
    const provider = getProvider(row.provider);
    if (!provider || !shouldRefresh(provider, row)) continue;
    const label = `${row.customer_id}/${row.provider}`;
    try {
      await refreshRow(provider, row);
      refreshed.push(label);
    } catch (err) {
      console.error(`[panel] Refresh ${label} fehlgeschlagen:`, err);
      failed.push(label);
    }
  }
  return { refreshed, failed };
}

export function startTokenRefreshSchedule(intervalHours = 12): NodeJS.Timeout {
  const run = () => refreshExpiringTokens().then((r) => {
    if (r.refreshed.length || r.failed.length) console.log("[panel] Token-Refresh:", r);
  });
  setTimeout(run, 60_000);
  return setInterval(run, intervalHours * 3_600_000);
}
