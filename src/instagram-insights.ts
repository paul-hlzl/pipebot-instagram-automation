/**
 * Instagram Insights (Panel v9, Analytics) - read-only account/media metrics via the same
 * "Instagram API with Instagram Login" (graph.instagram.com) product this codebase already uses
 * for publishing (see instagram.ts/panel/providers/instagram.ts), NOT the older Facebook-Login
 * Graph API. Requires the `instagram_business_manage_insights` permission (see the session
 * report) - distinct from `instagram_manage_insights`, which is for the Facebook-Login flow and
 * does not apply here.
 *
 * Metric names deliberately avoid `impressions`/`profile_views` (both deprecated by Meta as of
 * API v21/v22, for media created after July 2024) - using the current replacements instead
 * (`views`, `reach`, `accounts_engaged`, `total_interactions`). Current follower count is NOT
 * part of insights at all - it's a plain field on the IG User object (`followers_count`).
 *
 * Response parsing is deliberately defensive (tries both the older `values[0].value` time-series
 * shape and the newer `total_value.value` shape) - this could not be verified against a real
 * access token in this session (no Instagram app credentials configured in the sandbox, and
 * production accounts may not yet have insights permission approved, see session report on
 * Standard vs Advanced Access). Treat the exact parsing as unverified until confirmed against a
 * real connected account.
 */
import axios, { type AxiosInstance } from "axios";
import type { InstagramCredentials } from "./instagram.js";

const GRAPH_BASE = "https://graph.instagram.com/v21.0";

function client(): AxiosInstance {
  return axios.create({
    timeout: 20_000,
    validateStatus: (status) => status >= 200 && status < 300,
  });
}

interface InsightsMetricValue {
  name?: string;
  values?: { value?: number; end_time?: string }[];
  total_value?: { value?: number };
}
interface InsightsResponse {
  data?: InsightsMetricValue[];
}

/** Extracts one metric's numeric value from either response shape Meta has used for this family of endpoints. */
function extractMetric(res: InsightsResponse | undefined, name: string): number | null {
  const entry = res?.data?.find((m) => m.name === name);
  if (!entry) return null;
  if (typeof entry.total_value?.value === "number") return entry.total_value.value;
  const last = entry.values?.[entry.values.length - 1]?.value;
  return typeof last === "number" ? last : null;
}

export interface AccountInsightsSnapshot {
  followerCount: number | null;
  reach: number | null;
  views: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
}

/**
 * One day's account-level snapshot: follower_count via the plain IG User field (not insights -
 * that field was removed from the insights metric list), the rest via /{ig-user-id}/insights.
 * Never throws for a single missing/errored metric - returns null for whatever couldn't be
 * read, so a partial API response still yields a usable (if incomplete) snapshot rather than
 * losing the whole day for this customer.
 */
export async function fetchAccountInsights(creds: InstagramCredentials): Promise<AccountInsightsSnapshot> {
  const c = client();
  let followerCount: number | null = null;
  try {
    const { data } = await c.get<{ followers_count?: number }>(`${GRAPH_BASE}/${creds.igUserId}`, {
      params: { access_token: creds.accessToken, fields: "followers_count" },
    });
    followerCount = typeof data.followers_count === "number" ? data.followers_count : null;
  } catch (err) {
    console.error(`[analytics] followers_count fehlgeschlagen für ${creds.igUserId}:`, err instanceof Error ? err.message : err);
  }

  let insights: InsightsResponse | undefined;
  try {
    const { data } = await c.get<InsightsResponse>(`${GRAPH_BASE}/${creds.igUserId}/insights`, {
      params: {
        access_token: creds.accessToken,
        metric: "reach,views,accounts_engaged,total_interactions",
        period: "day",
        metric_type: "total_value",
      },
    });
    insights = data;
  } catch (err) {
    console.error(`[analytics] account insights fehlgeschlagen für ${creds.igUserId}:`, err instanceof Error ? err.message : err);
  }

  return {
    followerCount,
    reach: extractMetric(insights, "reach"),
    views: extractMetric(insights, "views"),
    accountsEngaged: extractMetric(insights, "accounts_engaged"),
    totalInteractions: extractMetric(insights, "total_interactions"),
  };
}

export interface MediaInsightsSnapshot {
  likes: number | null;
  comments: number | null;
  saved: number | null;
  shares: number | null;
  reach: number | null;
}

/** One post's current engagement snapshot. mediaId is the Instagram-side id returned at publish time (externalPostId in our posts table). */
export async function fetchMediaInsights(mediaId: string, creds: InstagramCredentials): Promise<MediaInsightsSnapshot> {
  try {
    const { data } = await client().get<InsightsResponse>(`${GRAPH_BASE}/${mediaId}/insights`, {
      params: { access_token: creds.accessToken, metric: "likes,comments,saved,shares,reach" },
    });
    return {
      likes: extractMetric(data, "likes"),
      comments: extractMetric(data, "comments"),
      saved: extractMetric(data, "saved"),
      shares: extractMetric(data, "shares"),
      reach: extractMetric(data, "reach"),
    };
  } catch (err) {
    console.error(`[analytics] media insights fehlgeschlagen für ${mediaId}:`, err instanceof Error ? err.message : err);
    return { likes: null, comments: null, saved: null, shares: null, reach: null };
  }
}
