/**
 * LinkedIn Member Post Analytics client (Panel v20) - built and unit-testable now, NOT wired into
 * the daily cron yet (see analytics.ts's header and docs/LINKEDIN_COMMUNITY_API.md). The endpoint
 * (`GET /rest/memberCreatorPostAnalytics`, permission `r_member_postAnalytics`) requires Community
 * Management API access, which this account doesn't have yet - calling any function here today
 * will just get a 403 from LinkedIn. Once access clears, wiring this in is one call from
 * analytics.ts's runDailyAnalyticsSnapshot, not a rewrite of this file.
 *
 * Important, easy to get wrong (see Session-Bericht Faktencheck): `queryType` takes exactly ONE
 * metric per request - there is no "give me all metrics in one call" mode. Fetching all 7 metrics
 * for one target costs 7 requests, not 1.
 */
import { ToolError } from "./errors.js";
import { LINKEDIN_ANALYTICS_VERSION } from "./linkedin-version.js";

const API = "https://api.linkedin.com";
// This client uses its OWN version, independent of linkedin.ts's posting-API version: the
// metricType response shape changed at 202605 (object -> plain string, see parseMetricType below),
// so it must always know exactly which shape to expect. Bump deliberately, not as a side effect of
// bumping the posting-API version. Value and full rationale: linkedin-version.ts.

export type MemberPostMetricType =
  | "IMPRESSION"
  | "MEMBERS_REACHED"
  | "RESHARE"
  | "REACTION"
  | "COMMENT"
  | "POST_SAVE"
  | "POST_SEND"
  | "LINK_CLICKS"
  | "PREMIUM_CTA_CLICKS"
  | "FOLLOWER_GAINED_FROM_CONTENT"
  | "PROFILE_VIEW_FROM_CONTENT";

/** The 7 metrics analytics.ts's account-level snapshot cares about (matches the Session-Auftrag's
 *  list) - LINK_CLICKS/PREMIUM_CTA_CLICKS/FOLLOWER_GAINED_FROM_CONTENT/PROFILE_VIEW_FROM_CONTENT
 *  exist too (added 202604+) but aren't part of this round's scope. */
export const MEMBER_POST_METRICS: MemberPostMetricType[] = [
  "IMPRESSION",
  "MEMBERS_REACHED",
  "REACTION",
  "COMMENT",
  "RESHARE",
  "POST_SAVE",
  "POST_SEND",
];

export interface MemberPostMetricElement {
  metricType: MemberPostMetricType;
  count: number;
  dateRange?: { start?: { year: number; month: number; day: number }; end?: { year: number; month: number; day: number } };
}

interface RawElement {
  count: number;
  // Pre-202605: nested under a namespaced key. From 202605: plain string. Both handled below.
  metricType: string | Record<string, string>;
  dateRange?: MemberPostMetricElement["dateRange"];
}

/** Handles both response shapes so this client keeps working across the version bump without a
 *  code change on LinkedIn's side breaking it silently - see this file's header. Exported only
 *  for scripts/test-linkedin-analytics.mjs. */
export function parseMetricType(raw: string | Record<string, string>): MemberPostMetricType {
  if (typeof raw === "string") return raw as MemberPostMetricType;
  const values = Object.values(raw);
  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new ToolError(`LinkedIn Member-Analytics: unerwartetes metricType-Format: ${JSON.stringify(raw)}`);
  }
  return values[0] as MemberPostMetricType;
}

function headers(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": LINKEDIN_ANALYTICS_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

async function fetchOneMetric(
  accessToken: string,
  queryType: MemberPostMetricType,
  /** Pre-encoded `q=...&...` query fragment (e.g. `q=me` or `q=entity&entity=(share:urn%3Ali%3A...)`)
   *  - built manually rather than via URLSearchParams because LinkedIn's `entity` finder uses
   *  Rest.li's structured-parameter syntax (literal, unencoded parentheses around an encoded URN)
   *  which URLSearchParams would double-encode. See this file's header/fetchMemberSinglePostAnalytics. */
  queryFragment: string,
): Promise<MemberPostMetricElement[]> {
  const url = `${API}/rest/memberCreatorPostAnalytics?${queryFragment}&queryType=${queryType}&aggregation=TOTAL`;
  const res = await fetch(url, { headers: headers(accessToken) });
  if (!res.ok) {
    throw new ToolError(`LinkedIn Member-Analytics fehlgeschlagen (${res.status}, queryType=${queryType}): ${await res.text()}`);
  }
  const data = (await res.json()) as { elements?: RawElement[] };
  return (data.elements ?? []).map((e) => ({ metricType: parseMetricType(e.metricType), count: e.count, dateRange: e.dateRange }));
}

/**
 * Aggregated statistics across ALL of the member's posts (q=me) - one request per metric (see
 * this file's header), so `metrics` defaults to the 7 this project actually shows, not the full
 * 11 the API supports. Returns 0 for any metric LinkedIn didn't return a value for (empty history,
 * or a metric with no activity), never undefined - callers can sum/display directly.
 */
export async function fetchMemberAggregatePostAnalytics(
  accessToken: string,
  metrics: MemberPostMetricType[] = MEMBER_POST_METRICS,
): Promise<Record<MemberPostMetricType, number>> {
  const result = Object.fromEntries(metrics.map((m) => [m, 0])) as Record<MemberPostMetricType, number>;
  for (const metric of metrics) {
    const elements = await fetchOneMetric(accessToken, metric, "q=me");
    result[metric] = elements.reduce((sum, e) => sum + (e.count ?? 0), 0);
  }
  return result;
}

/**
 * Statistics for one specific post (q=entity). `postUrn` is a ugcPost or share URN, e.g.
 * "urn:li:share:7325786486870552578" - encoded per LinkedIn's `entity=(share:...)` / `(ugc:...)`
 * finder syntax automatically based on which URN type is passed in.
 */
export async function fetchMemberSinglePostAnalytics(
  accessToken: string,
  postUrn: string,
  metrics: MemberPostMetricType[] = MEMBER_POST_METRICS,
): Promise<Record<MemberPostMetricType, number>> {
  const match = /^urn:li:(share|ugcPost):(.+)$/.exec(postUrn);
  if (!match) {
    throw new ToolError(`LinkedIn Member-Analytics: unerwartetes Post-URN-Format: ${postUrn}`);
  }
  const entityKey = match[1] === "ugcPost" ? "ugc" : "share";
  const queryFragment = `q=entity&entity=(${entityKey}:${encodeURIComponent(postUrn)})`;

  const result = Object.fromEntries(metrics.map((m) => [m, 0])) as Record<MemberPostMetricType, number>;
  for (const metric of metrics) {
    const elements = await fetchOneMetric(accessToken, metric, queryFragment);
    result[metric] = elements.reduce((sum, e) => sum + (e.count ?? 0), 0);
  }
  return result;
}
