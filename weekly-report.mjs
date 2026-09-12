#!/usr/bin/env node
// Weekly Instagram performance report for Pipeline AI Solutions.
// Run via cron every Monday 08:00 UTC. Emails office@pipebot.at via msmtp.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import axios from "axios";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(HERE, "weekly-report.log");
const MAIL_TO = "office@pipebot.at";
const GRAPH_BASE = "https://graph.instagram.com/v21.0";
const DAYS_BACK = 7;
const INSIGHT_METRICS = [
  "reach",
  "likes",
  "comments",
  "saved",
  "shares",
  "total_interactions",
  "profile_visits",
  "follows",
];

function log(line) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `${ts}\t${line}\n`);
}

function readEnv(name) {
  const envPath = path.join(HERE, ".env");
  const contents = fs.readFileSync(envPath, "utf8");
  const match = contents.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) {
    throw new Error(`Missing ${name} in .env`);
  }
  return match[1].trim();
}

function truncateCaption(caption, maxLen = 90) {
  if (!caption) return "(keine Caption)";
  const singleLine = caption.replace(/\s+/g, " ").trim();
  return singleLine.length > maxLen ? `${singleLine.slice(0, maxLen)}…` : singleLine;
}

async function fetchRecentMedia(token, sinceMs) {
  const client = axios.create({ timeout: 30_000 });
  const posts = [];
  let url = `${GRAPH_BASE}/me/media`;
  let params = {
    access_token: token,
    fields: "id,caption,timestamp,media_type,permalink",
    limit: 25,
  };

  // Page backwards through time until we hit posts older than the window,
  // or run out of pages - accounts starts small, so a handful of pages is plenty.
  for (let page = 0; page < 10; page++) {
    const { data } = await client.get(url, { params });
    const items = data.data ?? [];
    let hitOlder = false;

    for (const item of items) {
      const ts = Date.parse(item.timestamp);
      if (ts >= sinceMs) {
        posts.push(item);
      } else {
        hitOlder = true;
      }
    }

    if (hitOlder || !data.paging?.next) {
      break;
    }
    url = data.paging.next;
    params = undefined; // paging.next already contains all query params
  }

  return posts;
}

async function fetchInsights(token, mediaId) {
  const client = axios.create({ timeout: 30_000, validateStatus: () => true });
  const { data, status } = await client.get(`${GRAPH_BASE}/${mediaId}/insights`, {
    params: { metric: INSIGHT_METRICS.join(","), access_token: token },
  });

  if (status !== 200 || !data.data) {
    log(`INSIGHTS_FAILED\tmediaId=${mediaId} status=${status} body=${JSON.stringify(data)}`);
    return {};
  }

  const result = {};
  for (const metric of data.data) {
    result[metric.name] = metric.values?.[0]?.value ?? 0;
  }
  return result;
}

function formatPostLine(post, rank) {
  const date = new Date(post.timestamp).toISOString().slice(0, 10);
  const m = post.insights;
  return (
    `${rank}. [${date}] "${truncateCaption(post.caption)}"\n` +
    `   Reach: ${m.reach ?? "n/a"} | Likes: ${m.likes ?? "n/a"} | Kommentare: ${m.comments ?? "n/a"} | ` +
    `Gespeichert: ${m.saved ?? "n/a"} | Geteilt: ${m.shares ?? "n/a"} | Interaktionen gesamt: ${m.total_interactions ?? "n/a"}\n` +
    `   ${post.permalink}`
  );
}

async function sendMail(subject, body) {
  const message =
    `From: Pipeline Instagram Report <office@pipebot.at>\n` +
    `To: ${MAIL_TO}\n` +
    `Subject: ${subject}\n` +
    `Content-Type: text/plain; charset=UTF-8\n\n${body}`;

  execFileSync("msmtp", ["-a", "pipebot", "-t"], { input: message });
}

async function main() {
  const token = readEnv("IG_ACCESS_TOKEN");
  const sinceMs = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);

  log("RUN_START\tweekly report starting");

  let posts;
  try {
    posts = await fetchRecentMedia(token, sinceMs);
  } catch (error) {
    log(`FETCH_MEDIA_FAILED\t${error.message}`);
    await sendMail(
      `📊 Instagram Wochenreport ${today} — FEHLER`,
      `Der Wochenreport konnte nicht erstellt werden: Abruf der Post-Liste ist fehlgeschlagen.\n\nFehler: ${error.message}`,
    );
    log("RUN_END\tfailed to fetch media, error email sent");
    return;
  }

  for (const post of posts) {
    post.insights = await fetchInsights(token, post.id);
  }

  // Rank by reach first, total_interactions as tiebreaker.
  const ranked = [...posts].sort((a, b) => {
    const reachDiff = (b.insights.reach ?? 0) - (a.insights.reach ?? 0);
    if (reachDiff !== 0) return reachDiff;
    return (b.insights.total_interactions ?? 0) - (a.insights.total_interactions ?? 0);
  });

  let body;
  if (ranked.length === 0) {
    body =
      `Im Zeitraum der letzten ${DAYS_BACK} Tage wurden keine Instagram-Posts veröffentlicht.\n\n` +
      "Kein Ranking möglich - nächster Report kommt in einer Woche.";
  } else {
    const lines = ranked.map((post, i) => formatPostLine(post, i + 1));
    const topPerformer = ranked[0];
    const lowPerformer = ranked[ranked.length - 1];

    body =
      `Instagram-Wochenreport für Pipeline AI Solutions — letzte ${DAYS_BACK} Tage (${posts.length} Post(s))\n\n`;

    if (ranked.length > 1) {
      body +=
        `🏆 Top-Performer: "${truncateCaption(topPerformer.caption, 60)}" (Reach ${topPerformer.insights.reach ?? "n/a"})\n` +
        `📉 Low-Performer: "${truncateCaption(lowPerformer.caption, 60)}" (Reach ${lowPerformer.insights.reach ?? "n/a"})\n\n`;
    }

    body += "Alle Posts, sortiert nach Reichweite:\n\n" + lines.join("\n\n");
    body +=
      "\n\nHinweis: 'impressions' liefert die Instagram Graph API für diesen Media-Typ nicht mehr (von Meta " +
      "deprecatet zugunsten von 'reach'). Alle anderen Kennzahlen (Reach, Likes, Kommentare, Gespeichert, " +
      "Geteilt, Profilbesuche, neue Follower) werden bereits jetzt zuverlässig geliefert, auch bei einem " +
      "kleinen/neuen Account - keine Wartezeit auf 'genug Daten' nötig.";
  }

  await sendMail(`📊 Instagram Wochenreport ${today}`, body);
  log(`RUN_END\tposts=${posts.length} mail sent`);
}

main().catch((error) => {
  log(`FATAL\t${error.stack ?? error.message}`);
  process.exitCode = 1;
});
