/**
 * Instagram Comments (Panel v10, KI-Kommentar-Automatisierung) - reads top-level comments on a
 * customer's own media and posts replies, via the same "Instagram API with Instagram Login"
 * (graph.instagram.com) product this codebase already uses for publishing/insights (see
 * instagram.ts/instagram-insights.ts). Requires the `instagram_business_manage_comments`
 * permission (see the session report) - only added to providers/instagram.ts's SCOPES in this
 * same session, so an existing connection needs to be reconnected once before this works for it.
 *
 * `GET /{ig-media-id}/comments` only ever returns FIRST-LEVEL comments - replies live under
 * `/{ig-comment-id}/replies` instead and are never included here, so "only top-level" (a hard
 * requirement from the task) falls out of using this endpoint at all, no extra filtering needed.
 *
 * The reply endpoint/field name (`POST /{ig-comment-id}/replies` with a `message` field) is
 * Meta's documented Instagram Platform shape - like fetchAccountInsights/fetchMediaInsights in
 * instagram-insights.ts, this could not be verified against a real access token in this session
 * (no comments exist yet on any sandbox-connected account). Treat as unverified until confirmed
 * against a real test comment - see session report.
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

export interface IncomingComment {
  id: string;
  text: string;
  username: string | null;
  timestamp: string | null;
}

interface CommentsListResponse {
  data?: { id: string; text?: string; username?: string; timestamp?: string }[];
}

/** First-level comments on one piece of media, newest last (API's own order not guaranteed - callers should not assume). */
export async function fetchTopLevelComments(mediaId: string, creds: InstagramCredentials): Promise<IncomingComment[]> {
  const { data } = await client().get<CommentsListResponse>(`${GRAPH_BASE}/${mediaId}/comments`, {
    params: { access_token: creds.accessToken, fields: "id,text,username,timestamp" },
  });
  return (data.data ?? [])
    .filter((c) => typeof c.text === "string" && c.text.length > 0)
    .map((c) => ({ id: c.id, text: c.text as string, username: c.username ?? null, timestamp: c.timestamp ?? null }));
}

/** Posts a reply to one comment. Throws on failure - callers decide what that means for this comment's status. */
export async function postCommentReply(commentId: string, message: string, creds: InstagramCredentials): Promise<{ replyId: string | null }> {
  const { data } = await client().post<{ id?: string }>(
    `${GRAPH_BASE}/${commentId}/replies`,
    null,
    { params: { access_token: creds.accessToken, message } },
  );
  return { replyId: data.id ?? null };
}
