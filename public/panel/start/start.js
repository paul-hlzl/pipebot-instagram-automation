/* ===========================================================================
   Pipeflow „Start" — Easy Onboarding (19.09.2026)
   Eine Eingabe (Domain), zwei Klicks bis zur fertigen Woche. Nutzt ausschließlich bestehende
   Endpunkte plus die vier kleinen /api/start/*-Routen (siehe src/panel/start-routes.ts).
   Kein Framework, kein Build. Designplan: docs/EASY_ONBOARDING_DESIGN.md
   =========================================================================== */
(() => {
  "use strict";

  const MOUNT = window.__PF_MOUNT ?? "";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const CHANNEL = {
    ig_feed: { label: "Instagram", format: "feed", provider: "instagram" },
    ig_story: { label: "Instagram Story", format: "story", provider: "instagram" },
    linkedin: { label: "LinkedIn", format: "feed", provider: "linkedin" },
  };
  const CHANNEL_ORDER = ["ig_feed", "ig_story", "linkedin"];
  const FREQ = { "3x-woche": { label: "3× pro Woche", sub: "Montag, Mittwoch, Freitag", days: [1, 3, 5] }, werktags: { label: "Werktags", sub: "Montag bis Freitag", days: [1, 2, 3, 4, 5] }, taeglich: { label: "Täglich", sub: "auch am Wochenende", days: [1, 2, 3, 4, 5, 6, 7] } };
  const TONES = { sachlich: "sachlich", locker: "locker", inspirierend: "inspirierend", humorvoll: "humorvoll" };
  const PALETTE = ["#0a0e1a", "#1a2e1a", "#2e1a1a", "#1a1a2e", "#2e2410", "#111111"];
  const STANDARD_AKZENT = "#0a0e1a";
  // Bildschriften der Bild-Pipeline (fonts.ts) - fuer die Platzhalter-Kacheln, die wie das echte Bild aussehen.
  const FONTS = { inter: ["Inter", "Inter.ttf", 700], poppins: ["Poppins", "Poppins.ttf", 700], playfair: ["Playfair Display", "PlayfairDisplay.ttf", 700], merriweather: ["Merriweather", "Merriweather.ttf", 700], bebas: ["Bebas Neue", "BebasNeue.ttf", 400], anton: ["Anton", "Anton.ttf", 400], caveat: ["Caveat", "Caveat.ttf", 700], pacifico: ["Pacifico", "Pacifico.ttf", 400] };
  const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const ERRORS = {
    failed: (p) => `Die Verbindung mit ${p || "dem Kanal"} hat nicht geklappt. Bitte versuche es noch einmal.`,
    cancelled: (p) => `Du hast die Verbindung mit ${p || "dem Kanal"} abgebrochen. Du kannst sie jederzeit nachholen.`,
    state: () => "Die Sitzung ist abgelaufen. Bitte versuche es noch einmal.",
    personal_account: (p) => `${p} verlangt ein Business- oder Creator-Konto. Bitte stelle dein Konto um und versuche es erneut.`,
    missing_permission: (p) => `Bei ${p} fehlt eine Berechtigung. Bitte verbinde erneut und erlaube alle Punkte.`,
    not_configured: (p) => `${p} ist auf diesem Server nicht eingerichtet.`,
    session: () => "Bitte melde dich zuerst an.",
    verify: () => "Dieser Bestätigungslink ist ungültig oder wurde schon verwendet.",
    login: () => "Dieser Anmeldelink ist ungültig. Gib deine E-Mail-Adresse ein, wir schicken dir einen neuen.",
    "login-limit": () => "Zu viele Anmeldeversuche. Bitte in einer Stunde noch einmal.",
  };

  const S = {
    screen: "start", providers: [], aiAvailable: false, turnstileSiteKey: null, sandbox: false,
    customer: null, connections: [], skipped: new Set(),
    email: "", website: "", description: "", noSite: false,
    status: null, approvals: [], posts: [], history: null,
    notice: null, editing: null, poll: null, workingSince: 0, turnstileWidget: null,
  };
  const established = () => Boolean(S.customer);
  const onboardingDone = () => Boolean(S.customer && S.customer.tourDone);
  const conn = (id) => S.connections.find((c) => c.provider === id);
  const prov = (id) => S.providers.find((p) => p.id === id);
  const applyState = (d) => { if (!d || !d.customer) return; S.customer = d.customer; S.connections = d.connections || []; S.skipped = new Set(d.customer.skippedProviders || []); };

  /* ================= API ================= */
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(MOUNT + url, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch (netz) {
      throw Object.assign(new Error("Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung und versuche es noch einmal."), { status: 0, cause: netz });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const text = data.error || (res.status >= 500 ? "Auf dem Server ist etwas schiefgegangen. Bitte versuche es in einer Minute noch einmal." : "Das hat gerade nicht geklappt. Bitte lade die Seite neu und versuche es erneut.");
      throw Object.assign(new Error(text), { status: res.status, fields: data.fields, data });
    }
    return data;
  }

  function toast(text, kind = "ok") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  /* ================= Formatierung ================= */
  const dateOf = (iso) => new Date(`${iso}T12:00:00`);
  const fmtDay = (iso) => { const d = dateOf(iso); return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };
  const fmtLong = (iso) => dateOf(iso).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
  const fmtWhen = (iso) => new Date(iso).toLocaleString("de-AT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
  const todayStr = () => { const d = new Date(); const v = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Vienna" })); return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`; };
  const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const isoWeekday = (iso) => { const g = dateOf(iso).getDay(); return g === 0 ? 7 : g; };

  function enabledChannels(c = S.customer) {
    if (!c) return CHANNEL_ORDER;
    return CHANNEL_ORDER.filter((ch) => (ch === "ig_feed" && c.igFeedEnabled) || (ch === "ig_story" && c.igStoryEnabled) || (ch === "linkedin" && c.linkedinEnabled));
  }
  function postingDays(c = S.customer) {
    const explicit = c && c.activeWeekdays ? c.activeWeekdays.split(",").map(Number).filter((n) => n >= 1 && n <= 7) : null;
    return explicit && explicit.length ? explicit : (FREQ[c?.frequency] || FREQ.werktags).days;
  }
  function frequencyLabel(c = S.customer) {
    const days = postingDays(c);
    const key = [...days].sort().join(",");
    const found = Object.entries(FREQ).find(([, f]) => f.days.join(",") === key);
    if (found) return FREQ[found[0]].label;
    return `${days.length}× pro Woche (${days.map((d) => WEEKDAY_SHORT[d % 7]).join(", ")})`;
  }
  const tileBg = (c = S.customer) => {
    const hex = (c && c.accentColor) || STANDARD_AKZENT;
    if (c && c.gradientEnabled && c.gradientColor2) {
      const angle = { horizontal: "90deg", vertical: "180deg", diagonal: "135deg" }[c.gradientDirection] || "135deg";
      return `linear-gradient(${angle}, ${hex}, ${c.gradientColor2})`;
    }
    return hex;
  };
  const tileFont = (c = S.customer) => { const f = FONTS[c?.fontChoice] || FONTS.inter; return `font-family:"${f[0]}";font-weight:${f[2]}`; };

  function injectImageFonts() {
    if ($("#pf-image-fonts")) return;
    const style = document.createElement("style");
    style.id = "pf-image-fonts";
    style.textContent = Object.values(FONTS).map(([family, file]) => `@font-face{font-family:"${family}";src:url("${MOUNT}/fonts/${file}") format("truetype");font-weight:100 900;font-display:swap;}`).join("\n");
    document.head.appendChild(style);
  }

  /* ================= Rendering: Rahmen ================= */
  function render() {
    const stage = $("#stage");
    const wide = ["result", "dashboard", "settings"].includes(S.screen);
    stage.classList.toggle("wide", wide);
    const html = {
      start: startHtml, known: knownHtml, website: websiteHtml, describe: describeHtml, working: workingHtml,
      result: resultHtml, adjust: adjustHtml, plan: planHtml, connect: connectHtml, welcome: welcomeHtml,
      dashboard: dashboardHtml, settings: settingsHtml, error: errorHtml,
    }[S.screen];
    // Der Einblend-Moment gehoert dem Bildschirmwechsel - ein Neuzeichnen durch das Polling
    // (Fortschritt, fertige Beitraege) darf nicht jedes Mal neu einblenden (Flackern).
    const wechsel = S.renderedScreen !== S.screen;
    S.renderedScreen = S.screen;
    stage.innerHTML = `<div class="screen${wechsel ? " enter" : ""}">${html ? html() : ""}</div>`;
    renderTop();
    if (S.screen === "website" && S.turnstileSiteKey) renderTurnstile();
    if (["working", "result", "dashboard"].includes(S.screen)) ensurePolling(); else stopPolling();
    if (S.screen === "dashboard") loadDashboardExtras();
    if (S.screen === "settings" && S.history === null) loadHistory();
    const focusTarget = $("[autofocus]", stage);
    if (focusTarget && !/Mobi|Android/i.test(navigator.userAgent)) focusTarget.focus();
    else stage.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  function renderTop() {
    const nav = $("#top-actions");
    if (!established() || !onboardingDone()) { nav.innerHTML = ""; return; }
    nav.innerHTML = S.screen === "settings"
      ? `<button type="button" class="btn secondary sm" data-go="dashboard">Zur Übersicht</button>`
      : `<button type="button" class="btn secondary sm" data-go="settings">Einstellungen</button>`;
  }

  function go(screen, opts = {}) {
    S.screen = screen;
    S.editing = null;
    if (["dashboard", "settings"].includes(screen)) history.replaceState(null, "", `#${screen}`);
    else if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    if (!opts.keepNotice) S.notice = null;
    render();
  }

  /* ================= Bildschirme ================= */
  function startHtml() {
    return `
      <section class="hero">
        <h1>Deine Beiträge. Jede Woche. Automatisch.</h1>
        <p class="lede">Pipeflow liest deine Website, schreibt und gestaltet deine Beiträge für Instagram und LinkedIn - du gibst nur noch frei.</p>
        <form id="f-start" novalidate>
          <div class="field">
            <label for="email">E-Mail-Adresse</label>
            <input class="input" id="email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="du@deine-firma.at" value="${esc(S.email)}" required autofocus>
            <p class="error" id="err-email" aria-live="assertive"></p>
          </div>
          <div class="actions"><button class="btn lg" type="submit">Los geht's</button></div>
          <p class="hint">Mit „Los geht's" stimmst du zu, dass Pipeline AI Solutions deine Angaben speichert, um Beiträge für dich vorzubereiten. <a href="${esc(MOUNT || "/panel")}/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a></p>
        </form>
      </section>`;
  }

  function knownHtml() {
    return `
      <section class="hero">
        <h1>Willkommen zurück</h1>
        <p class="lede">${S.knownMailed
          ? `Wir haben dir einen Anmeldelink an <strong>${esc(S.email)}</strong> geschickt. Ein Klick darauf, und du bist drin.`
          : `Für <strong>${esc(S.email)}</strong> gibt es schon ein Konto. Wir haben in der letzten Stunde bereits Anmeldelinks geschickt - bitte schau ins Postfach.`}</p>
        ${S.sandbox ? `<p class="hint">Testversion: Hier werden keine E-Mails verschickt. Der Link steht nur im Server-Log.</p>` : ""}
        <div class="actions"><button type="button" class="link" data-go="start">Andere E-Mail-Adresse verwenden</button></div>
      </section>`;
  }

  function welcomeHtml() {
    const c = S.customer;
    return `
      <section class="hero">
        <h1>Willkommen zurück</h1>
        <button type="button" class="acct-card" data-go="dashboard">
          <span class="acct-avatar" aria-hidden="true">${esc((c.company || "?").trim().charAt(0).toUpperCase())}</span>
          <span><strong>${esc(c.company)}</strong><span class="muted small">Weiter als ${esc(c.email)}</span></span>
          <span class="arrow" aria-hidden="true">→</span>
        </button>
        <div class="actions"><button type="button" class="link" id="logout-other">Mit einem anderen Konto anmelden</button></div>
      </section>`;
  }

  function websiteHtml() {
    return `
      <section class="hero">
        <h1>So könnte deine erste Woche aussehen</h1>
        <p class="lede">Gib deine Website ein. Wir lesen sie, erkennen deine Themen und planen die nächsten sieben Tage.</p>
        <form id="f-website" novalidate>
          <div class="field">
            <label for="website">Website-Adresse</label>
            <input class="input" id="website" name="website" type="text" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="deine-firma.at" value="${esc(S.website)}" required autofocus>
            <p class="error" id="err-website" aria-live="assertive"></p>
          </div>
          <div id="turnstile-slot"></div>
          <div class="actions"><button class="btn lg" type="submit" id="btn-preview">Vorschau erstellen</button></div>
          <p class="hint">Nichts wird veröffentlicht, bevor du es freigibst.</p>
          <button type="button" class="link" data-go="describe">Ich habe keine Website</button>
        </form>
      </section>`;
  }

  function describeHtml() {
    return `
      <section class="hero">
        <h1>Was macht dein Unternehmen?</h1>
        <p class="lede">Ein, zwei Sätze reichen - wer ihr seid, was ihr anbietet, für wen.</p>
        <form id="f-describe" novalidate>
          <div class="field">
            <label for="description">Beschreibung</label>
            <textarea class="textarea" id="description" name="description" rows="3" placeholder="Physiotherapie-Praxis in Linz, Schwerpunkt Rückenschmerzen. Wir helfen Büroangestellten, wieder schmerzfrei zu arbeiten." required autofocus>${esc(S.description)}</textarea>
            <p class="error" id="err-description" aria-live="assertive"></p>
          </div>
          <div id="turnstile-slot"></div>
          <div class="actions"><button class="btn lg" type="submit" id="btn-preview">Vorschau erstellen</button></div>
          <p class="hint">Nichts wird veröffentlicht, bevor du es freigibst.</p>
          <button type="button" class="link" data-go="website">Ich habe doch eine Website</button>
        </form>
      </section>`;
  }

  function expectedImages() {
    const st = S.status;
    if (!st) return 0;
    const total = Math.max(st.job?.total || 0, st.posts.length);
    if (S.customer?.emailVerified) return total;
    return Math.min(st.summary?.limits?.imagesUnverified ?? 3, total);
  }

  function workingHtml() {
    const st = S.status;
    const job = st?.job || { phase: "writing", done: 0, total: 0 };
    const posts = st?.posts || [];
    const running = job.phase !== "done" && job.phase !== "error" && job.phase !== "idle";
    const writingDone = !running || (job.total > 0 && job.done >= job.total);
    const imgExpected = expectedImages();
    const imgDone = st?.imagesDone || 0;
    const imagesDone = !running && (imgDone >= imgExpected || imgExpected === 0);
    const slow = Date.now() - S.workingSince > 6000;
    const step = (state, label, sub) => `<li class="step is-${state}"><span class="step-mark" aria-hidden="true">${state === "done" ? "✓" : ""}</span><span class="step-text"><span>${label}</span>${sub ? `<span class="step-sub">${sub}</span>` : ""}</span></li>`;
    return `
      <section>
        <h1>Wir lesen ${st?.summary?.domain ? esc(st.summary.domain) : "deine Angaben"}</h1>
        <p class="lede">Das dauert meistens unter einer Minute.</p>
        <ol class="steps" aria-label="Fortschritt">
          ${step("done", S.noSite ? "Beschreibung gelesen" : "Website gelesen")}
          ${step("done", "Themen erkannt", st?.summary?.pillars?.length ? esc(st.summary.pillars.map((p) => p.title).join(", ")) : "")}
          ${step(writingDone ? "done" : "active", "Beiträge entworfen", job.total ? `${job.done} von ${job.total}${!writingDone && slow ? " · dauert gerade etwas länger …" : ""}` : (slow ? "dauert gerade etwas länger …" : ""))}
          ${step(imagesDone ? "done" : (writingDone || posts.length ? "active" : "open"), "Bilder erstellt", imgExpected ? `${Math.min(imgDone, imgExpected)} von ${imgExpected}` : "")}
        </ol>
      </section>`;
  }

  function weekHtml(opts = {}) {
    const st = S.status;
    const from = st?.window?.from || todayStr();
    const posts = (st?.posts || []).filter((p) => enabledChannels().includes(p.channel));
    const running = st?.job && !["done", "error", "idle"].includes(st.job.phase);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const due = postingDays();
    return `<div class="week" id="week">${days.map((day) => {
      const list = posts.filter((p) => p.scheduledFor === day && p.status !== "rejected").sort((a, b) => CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel));
      const posting = due.includes(isoWeekday(day));
      let body;
      if (list.length) body = `<div class="day-posts">${list.map((p) => postHtml(p, opts)).join("")}</div>`;
      else if (posting && running) body = `<div class="day-posts">${enabledChannels().map((ch) => skeletonHtml(ch)).join("")}</div>`;
      else if (posting) body = `<p class="day-quiet">Noch kein Beitrag für diesen Tag.${opts.dashboard ? ` <button type="button" class="link" data-replan>Jetzt planen</button>` : ""}</p>`;
      else body = `<p class="day-quiet">Kein Beitrag - ${isoWeekday(day) >= 6 ? "Wochenende" : "Pausentag"}.</p>`;
      return `<section class="day" aria-label="${esc(fmtLong(day))}"><div class="day-head"><strong>${esc(fmtDay(day))}</strong><span class="muted">${esc(dateOf(day).toLocaleDateString("de-AT", { weekday: "long" }))}</span></div>${body}</section>`;
    }).join("")}</div>`;
  }

  function skeletonHtml(ch) {
    const meta = CHANNEL[ch];
    return `<article class="post" aria-busy="true"><div class="post-meta"><span class="chan ${ch}">${esc(meta.label)}</span><span class="status">wird geschrieben …</span></div><div class="media ${meta.format}"><div class="skeleton">Beitrag entsteht gerade</div></div></article>`;
  }

  function postHtml(p, opts = {}) {
    const meta = CHANNEL[p.channel] || CHANNEL.ig_feed;
    const c = S.customer;
    const wm = (c && (c.watermarkText || c.company)) || "";
    const media = p.imageUrl
      ? `<img src="${esc(p.imageUrl)}" alt="Beitragsbild: ${esc(p.headline || "")}" loading="lazy">`
      : `<div class="tile" style="--acc:${esc((p.accentColorUsed || c?.accentColor || STANDARD_AKZENT))};background:${esc(p.accentColorUsed ? p.accentColorUsed : tileBg())}"><span class="tile-h" style="${tileFont()}">${esc(p.headline || "")}</span><span class="tile-wm" style="${tileFont()}">${esc(wm)}</span></div><span class="tile-note">${c?.emailVerified ? "Bild wird gerade erstellt" : "Bild folgt nach der Bestätigung"}</span>`;
    const statusLabel = { edited: "von dir bearbeitet", approved: "freigegeben", submitted: "in der Freigabe", published: "veröffentlicht", channel_disconnected: "Kanal getrennt" }[p.status] || "";
    const canReorder = opts.dashboard && ["planned", "edited", "approved"].includes(p.status);
    const actions = opts.dashboard ? `
      <div class="post-actions">
        ${c?.approvalMode && ["planned", "edited"].includes(p.status) ? `<button type="button" class="btn sm" data-approve-plan="${esc(p.id)}">Freigeben</button>` : ""}
        ${["planned", "edited", "approved"].includes(p.status) ? `<button type="button" class="link" data-skip-plan="${esc(p.id)}">Überspringen</button>` : ""}
        ${canReorder ? `<span class="order-btns" role="group" aria-label="Reihenfolge"><button type="button" data-move="up" data-id="${esc(p.id)}" aria-label="Früher">↑</button><button type="button" data-move="down" data-id="${esc(p.id)}" aria-label="Später">↓</button></span><span class="grip" draggable="true" data-drag="${esc(p.id)}" title="Ziehen zum Umsortieren">⠿ ziehen</span>` : ""}
      </div>` : "";
    return `<article class="post" data-id="${esc(p.id)}" data-channel="${esc(p.channel)}" data-date="${esc(p.scheduledFor)}">
      <div class="post-meta"><span class="chan ${esc(p.channel)}">${esc(meta.label)}</span><span class="status ${p.status === "approved" || p.status === "published" ? "ok" : ""}">${esc(statusLabel)}</span></div>
      <div class="media ${meta.format}">${media}</div>
      <div class="post-body">
        <h3 class="post-h">${esc(p.headline || "")}</h3>
        ${p.caption ? `<p class="post-c">${esc(p.caption)}</p><button type="button" class="link post-more" data-more>mehr</button>` : ""}
      </div>${actions}</article>`;
  }

  function resultHtml() {
    const st = S.status;
    const sum = st?.summary || {};
    const pillars = (sum.pillars || []).map((p) => p.title);
    const source = sum.domain ? sum.domain : "deiner Beschreibung";
    const running = st?.job && !["done", "error", "idle"].includes(st.job.phase);
    const remaining = running && st.job.total ? Math.max(0, st.job.total - st.job.done) : 0;
    const themes = pillars.length >= 2 ? `rund um <strong>${esc(pillars[0])}</strong> und <strong>${esc(pillars[1])}</strong> geplant - zwei Themen, die ${sum.domain ? `auf ${esc(sum.domain)}` : "in deiner Beschreibung"} besonders hervorstachen`
      : pillars.length === 1 ? `rund um <strong>${esc(pillars[0])}</strong> geplant - das Thema, das ${sum.domain ? `auf ${esc(sum.domain)}` : "in deiner Beschreibung"} am stärksten hervorstach`
      : `aus ${esc(source)} abgeleitet`;
    return `
      <section>
        <h1>Deine nächste Woche ist fertig</h1>
        <p class="lede">Wir haben sie ${themes}. Du hast dafür eine Zeile getippt - alles darunter kannst du noch ändern.</p>
        ${remaining ? `<p class="progress-line">Noch ${remaining} ${remaining === 1 ? "Beitrag" : "Beiträge"} in Arbeit - sie erscheinen gleich hier.</p>` : ""}
        ${S.notice ? noticeHtml() : ""}
        ${weekHtml()}
        <div class="sticky-actions">
          <button type="button" class="btn lg" data-go="plan">Passt, weiter</button>
          <button type="button" class="link" data-go="adjust">Anders machen</button>
        </div>
      </section>`;
  }

  function adjustHtml() {
    const limits = S.status?.summary?.limits;
    const verified = S.customer?.emailVerified;
    return `
      <section class="hero">
        <h1>Was soll anders sein?</h1>
        <p class="lede">Sag es in deinen Worten. Wir übersetzen das in Beschreibung, Tonalität und Themen und schreiben die Woche neu.</p>
        <form id="f-adjust" novalidate>
          <div class="field">
            <label for="wish">Dein Wunsch</label>
            <textarea class="textarea" id="wish" name="wish" rows="3" placeholder="z. B. lockerer im Ton, keine Preise nennen, mehr über das Team" required autofocus></textarea>
            <p class="error" id="err-wish" aria-live="assertive"></p>
          </div>
          <div class="actions"><button class="btn lg" type="submit">Neu erstellen</button></div>
          ${!verified && limits ? `<p class="hint">Vor der Bestätigung deiner E-Mail-Adresse ist ${limits.adjustUnverified === 1 ? "eine Anpassung" : `${limits.adjustUnverified} Anpassungen`} möglich - danach beliebig viele.</p>` : ""}
          <button type="button" class="link" data-go="result">Zurück zur Vorschau</button>
        </form>
      </section>`;
  }

  /* ---- Plan: Zeilen mit Stift + Inline-Feld (Bildschirm 5 und Einstellungen) ---- */
  const PENCIL = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg>`;
  function planRow(id, label, valueHtml, formHtml, note) {
    const editing = S.editing === id;
    return `<div class="row" id="row-${id}">
      <span class="row-k">${esc(label)}</span>
      ${editing ? "" : `<div class="row-v">${valueHtml}</div><button type="button" class="row-edit" data-edit="${id}" aria-label="${esc(label)} bearbeiten" aria-expanded="false">${PENCIL}</button>`}
      ${editing ? `<form class="row-form" data-row-form="${id}">${formHtml}<div class="row-form-actions"><button class="btn sm" type="submit">Speichern</button><button type="button" class="link" data-cancel-edit style="padding:0 6px">Abbrechen</button><span class="error" data-row-error aria-live="assertive"></span></div></form>` : ""}
      ${note ? `<span class="row-note">${note}</span>` : ""}
    </div>`;
  }

  function planRowsHtml() {
    const c = S.customer;
    const pillars = (c.contentPillars || []).map((p) => p.title);
    const chans = enabledChannels(c).map((ch) => CHANNEL[ch].label);
    const feat = c.features || {};
    return `<div class="plan">
      ${planRow("company", "Unternehmen und Branche", `<strong>${esc(c.company)}</strong><br><span class="muted">${esc(c.industry || "Branche noch offen")}</span>`,
        `<label class="small muted" for="e-company">Unternehmen</label><input class="input" id="e-company" name="company" value="${esc(c.company)}" required maxlength="120">
         <label class="small muted" for="e-industry">Branche</label><input class="input" id="e-industry" name="industry" value="${esc(c.industry || "")}" maxlength="120" placeholder="z. B. Physiotherapie">`)}
      ${planRow("pillars", "Themen", pillars.length ? pillars.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ") : `<span class="muted">Noch keine Themen - wir schreiben dann allgemein über dein Unternehmen.</span>`,
        `<div class="chips" id="chip-edit">${pillars.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-chip-remove="${i}" aria-label="${esc(t)} entfernen">×</button></span>`).join("")}<span class="chip add"><input id="chip-input" placeholder="Thema hinzufügen, Enter" aria-label="Thema hinzufügen" maxlength="60"></span></div>
         <input type="hidden" name="pillars" value="${esc(JSON.stringify(pillars))}">`)}
      ${planRow("channels", "Kanäle", chans.length ? esc(chans.join(", ")) : `<span class="muted">Kein Kanal aktiv</span>`,
        `<div class="choice">${CHANNEL_ORDER.map((ch) => `<label><input type="checkbox" name="ch" value="${ch}" ${enabledChannels(c).includes(ch) ? "checked" : ""}><span>${esc(CHANNEL[ch].label)}${ch === "ig_story" ? `<small>24 Stunden sichtbar, ohne Text darunter</small>` : ch === "linkedin" ? `<small>auf deinem persönlichen Profil</small>` : ""}</span></label>`).join("")}</div>`)}
      ${planRow("rhythm", "Rhythmus", `${esc(frequencyLabel(c))}<br><span class="muted">jeweils um ${esc(c.postTime || "15:00")} Uhr</span>`,
        `<div class="choice">${Object.entries(FREQ).map(([k, f]) => `<label><input type="radio" name="frequency" value="${k}" ${(!c.activeWeekdays || c.activeWeekdays === f.days.join(",")) && (c.activeWeekdays ? c.activeWeekdays === f.days.join(",") : c.frequency === k) ? "checked" : ""}><span>${esc(f.label)}<small>${esc(f.sub)}</small></span></label>`).join("")}</div>
         <label class="small muted" for="e-time">Uhrzeit</label><input class="input" id="e-time" name="postTime" type="time" value="${esc(c.postTime || "15:00")}" required>
         ${feat.weekdayMatrix ? "" : `<span class="small muted">Einzelne Wochentage je Kanal gibt es in der nächsten Stufe.</span>`}`)}
      ${planRow("color", "Farbe", `<span class="swatch-dot" style="background:${esc(tileBg(c))}"></span>${esc((c.accentColor || STANDARD_AKZENT).toUpperCase())}${c.gradientEnabled && c.gradientColor2 ? ` → ${esc(c.gradientColor2.toUpperCase())}` : ""}`,
        `<div class="swatches" role="group" aria-label="Farbe wählen">${PALETTE.map((hex) => `<button type="button" class="swatch" data-swatch="${hex}" aria-pressed="${(c.accentColor || STANDARD_AKZENT).toLowerCase() === hex}" style="background:${hex}" aria-label="${hex}"></button>`).join("")}<span class="swatch custom" title="Eigene Farbe"><input type="color" name="accentColorPick" value="${esc(c.accentColor || STANDARD_AKZENT)}" aria-label="Eigene Farbe"></span></div>
         <input type="hidden" name="accentColor" value="${esc(c.accentColor || STANDARD_AKZENT)}">
         <span class="small muted">Neue Bilder verwenden die Farbe sofort. ${feat.multiThemes ? "" : "Mehrere gespeicherte Farbthemen gibt es in der nächsten Stufe."}</span>`)}
      ${planRow("approval", "Freigabe", `${c.approvalMode ? "An" : "Aus"}<br><span class="muted">${c.approvalMode ? "Jeder Beitrag wartet auf dein OK, bevor er rausgeht." : "Beiträge gehen zur geplanten Zeit automatisch raus."}</span>`,
        `<label class="toggle"><input type="checkbox" name="approvalMode" ${c.approvalMode ? "checked" : ""}><span>Freigabe an - jeder Beitrag wartet auf dein OK</span></label>
         <span class="small muted">Aus heißt: Beiträge gehen zur geplanten Zeit automatisch raus. Du siehst sie trotzdem vorher in der Übersicht.</span>`)}
    </div>`;
  }

  function planHtml() {
    return `
      <section>
        <h1>Dein Plan</h1>
        <p class="lede">Alles aus deiner Website abgeleitet. Jede Zeile lässt sich mit dem Stift ändern.</p>
        ${planRowsHtml()}
        <div class="actions" style="margin-top:32px"><button type="button" class="btn lg" id="btn-adopt">Plan übernehmen</button></div>
      </section>`;
  }

  /* ---- Verbinden ---- */
  const LOGO = {
    instagram: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`,
    linkedin: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M4 3.5A1.5 1.5 0 1 1 4 6.5a1.5 1.5 0 0 1 0-3zM2.8 8h2.4v13H2.8zM9 8h2.3v1.8c.5-.9 1.7-2 3.6-2 3.7 0 4.3 2.4 4.3 5.6V21h-2.4v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H9z"/></svg>`,
    google: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5h5"/></svg>`,
  };
  /** Die Kanal-Texte kommen vom Server in der Sie-Form des klassischen Panels - der neue Flow duzt. */
  const duzen = (t) => String(t ?? "").replace(/\bIhre\b/g, "Deine").replace(/\bIhrem\b/g, "deinem").replace(/\bIhren\b/g, "deinen").replace(/\bIhr\b/g, "Dein").replace(/\bSie\b/g, "du");
  function connectCardHtml(p, inOnboarding) {
    const k = conn(p.id);
    const skipped = S.skipped.has(p.id);
    const ok = k && k.status === "ok";
    const notice = S.notice && S.notice.provider === p.id ? `<p class="small" style="color:${S.notice.kind === "bad" ? "var(--stop)" : "var(--go)"}">${esc(S.notice.text)}</p>` : "";
    let button;
    if (ok) button = `<p class="connect-state">✓ Verbunden als ${esc(k.accountName || "—")}</p>${!inOnboarding ? `<button type="button" class="link" data-disconnect="${esc(p.id)}">Trennen</button>` : ""}`;
    else if (!p.available) button = `<button type="button" class="btn secondary" disabled>${LOGO[p.id] || ""}${esc(p.name)} verbinden</button><p class="connect-state off">${S.sandbox ? "In der Testversion nicht möglich - hier gibt es keine echten Konten." : "Auf diesem Server nicht eingerichtet."}</p>`;
    else button = `<a class="btn" href="${esc(MOUNT)}/connect/${esc(p.id)}?return=start">${LOGO[p.id] || ""}${esc(p.name)} verbinden</a>${k ? `<p class="connect-state off">Verbindung ${k.status === "expired" ? "abgelaufen" : k.status === "blocked" ? "blockiert" : "läuft bald ab"} - bitte neu verbinden.</p>` : ""}`;
    return `<div class="connect" id="connect-${esc(p.id)}">
      ${button}
      <p class="small muted">${esc(duzen(p.tagline))}${p.notice ? ` ${esc(duzen(p.notice))}` : ""}</p>
      ${notice}
      ${!ok && inOnboarding ? (skipped ? `<p class="connect-state off">Später - du findest das jederzeit in den Einstellungen.</p>` : `<button type="button" class="link" data-skip="${esc(p.id)}">Später verbinden</button>`) : ""}
    </div>`;
  }
  function connectHtml() {
    const list = S.providers.filter((p) => p.id !== "google");
    return `
      <section>
        <h1>Kanäle verbinden</h1>
        <p class="lede">Damit Pipeflow für dich veröffentlichen kann. Jeder Kanal einzeln, jeder überspringbar.</p>
        <div class="connect-list">${list.map((p) => connectCardHtml(p, true)).join("")}</div>
        <div class="actions" style="margin-top:32px"><button type="button" class="btn lg" id="btn-to-dashboard">Zum Dashboard</button></div>
      </section>`;
  }

  /* ---- Dashboard ---- */
  function noticeHtml() {
    const n = S.notice;
    return n ? `<div class="notice ${n.kind || ""}" role="status">${esc(n.text)}</div>` : "";
  }
  function dashboardHtml() {
    const c = S.customer;
    const missing = S.providers.filter((p) => p.id !== "google" && !(conn(p.id) && conn(p.id).status === "ok"));
    const st = S.status;
    const running = st?.job && !["done", "error", "idle"].includes(st.job.phase);
    return `
      <section>
        <div class="dash-head">
          <div><h1>${esc(c.company)}</h1><p class="lede" style="margin-top:6px">Was als Nächstes rausgeht.</p></div>
          <button type="button" class="btn" id="btn-post-now">Jetzt posten</button>
        </div>
        ${S.notice ? noticeHtml() : ""}
        ${!c.emailVerified ? `<div class="notice" role="status"><strong>Bitte bestätige deine E-Mail-Adresse.</strong> Wir haben einen Link an ${esc(c.email)} geschickt. Erst danach werden Beiträge veröffentlicht${st?.posts?.some((p) => !p.imageUrl) ? " und die restlichen Bilder erstellt" : ""}.<span><button type="button" class="link" id="resend-verify">Bestätigungsmail erneut senden</button></span></div>` : ""}
        ${missing.length ? `<div class="notice" role="status">${esc(missing.map((p) => p.name).join(" und "))} ${missing.length > 1 ? "sind" : "ist"} noch nicht verbunden - Beiträge können dort erst dann veröffentlicht werden.<span><button type="button" class="link" data-go="settings" data-settings-target="verbinden">Jetzt verbinden</button></span></div>` : ""}
        ${c.customerPaused ? `<div class="notice bad">Deine Veröffentlichung ist pausiert.<span><button type="button" class="link" data-pause="0">Fortsetzen</button></span></div>` : ""}
        ${running ? `<p class="progress-line">${st.job.kind === "backfill" ? "Bilder werden erstellt" : "Beiträge werden erstellt"}${st.job.total ? ` - ${st.job.done} von ${st.job.total}` : ""} …</p>` : ""}
        <div class="section" id="approvals-section">${approvalsHtml()}</div>
        <div class="section">
          <div class="section-head"><h2>Die nächsten sieben Tage</h2><span class="small muted">Reihenfolge per ↑↓ oder Ziehen</span></div>
          ${weekHtml({ dashboard: true })}
        </div>
      </section>`;
  }
  function approvalsHtml() {
    const list = S.approvals || [];
    if (!list.length) return "";
    return `<div class="section-head"><h2>Wartet auf deine Freigabe</h2><span class="small muted">${list.length}</span></div>
      <div class="day-posts">${list.map((a) => {
        const meta = CHANNEL[a.channel] || CHANNEL.ig_feed;
        return `<article class="post" data-approval="${esc(a.id)}">
          <div class="post-meta"><span class="chan ${esc(a.channel)}">${esc(meta.label)}</span><time>${esc(fmtWhen(a.createdAt))}</time></div>
          <div class="media ${meta.format}">${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="" loading="lazy">` : `<div class="skeleton">Kein Bild</div>`}</div>
          <div class="post-body"><h3 class="post-h">${esc(a.headline || "")}</h3>${a.caption ? `<p class="post-c">${esc(a.caption)}</p><button type="button" class="link post-more" data-more>mehr</button>` : ""}</div>
          <div class="post-actions"><button type="button" class="btn sm" data-approve="${esc(a.id)}">Freigeben</button><button type="button" class="link" data-reject="${esc(a.id)}">Ablehnen</button></div>
        </article>`;
      }).join("")}</div>`;
  }

  function settingsHtml() {
    const c = S.customer;
    const list = S.providers.filter((p) => p.id !== "google" || p.available);
    return `
      <section>
        <h1>Einstellungen</h1>
        <p class="lede">Dein Plan, deine Kanäle, dein Verlauf. Alles andere bleibt im klassischen Panel.</p>
        ${S.notice ? noticeHtml() : ""}
        ${planRowsHtml()}
        <div class="row" id="row-adjust"><span class="row-k">Ausrichtung ändern</span><div class="row-v"><span class="muted">In eigenen Worten sagen, was anders sein soll - wir schreiben die offenen Beiträge neu.</span></div><button type="button" class="row-edit" data-go="adjust" aria-label="Ausrichtung ändern">${PENCIL}</button></div>
        <div class="section" id="verbinden"><div class="section-head"><h2>Kanäle</h2></div><div class="connect-list">${list.map((p) => connectCardHtml(p, false)).join("")}</div></div>
        <div class="section"><div class="section-head"><h2>Veröffentlicht</h2></div>${S.history === null ? `<p class="empty">Wird geladen …</p>` : historyHtml()}</div>
        <div class="section">
          <div class="section-head"><h2>Konto</h2></div>
          <div class="plan">
            <div class="row"><span class="row-k">E-Mail</span><div class="row-v">${esc(c.email)}${c.emailVerified ? ` <span class="small" style="color:var(--go)">bestätigt</span>` : ` <span class="small" style="color:var(--stop)">noch nicht bestätigt</span> <button type="button" class="link" id="resend-verify">erneut senden</button>`}</div></div>
            <div class="row"><span class="row-k">Veröffentlichung</span><div class="row-v">${c.customerPaused ? "Pausiert" : "Aktiv"}</div><button type="button" class="btn secondary sm" data-pause="${c.customerPaused ? 0 : 1}" style="align-self:center">${c.customerPaused ? "Fortsetzen" : "Pausieren"}</button></div>
            <div class="row"><span class="row-k">Mehr</span><div class="row-v"><a href="${esc(MOUNT)}/?classic=1">Klassisches Panel öffnen</a><br><span class="small muted">Wochentagsplanung, Farbthemen, Formate, Analytics, Kommentare - alles bleibt dort erreichbar.</span></div></div>
            <div class="row"><span class="row-k">Abmelden</span><div class="row-v"><button type="button" class="link" id="logout">Auf diesem Gerät abmelden</button></div></div>
          </div>
        </div>
      </section>`;
  }
  function historyHtml() {
    const list = S.history || [];
    if (!list.length) return `<p class="empty">Noch nichts veröffentlicht. Sobald der erste Beitrag draußen ist, steht er hier.</p>`;
    return `<ul class="history">${list.slice(0, 20).map((p) => `<li>${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}<span><strong style="font-weight:500">${esc(p.headline || "(ohne Titel)")}</strong><br><span class="small muted">${esc(CHANNEL[p.channel]?.label || p.provider || "")} · ${esc(fmtWhen(p.postedAt))}</span></span></li>`).join("")}</ul>`;
  }
  function errorHtml() {
    return `<section class="center"><h1>Das hat nicht geklappt</h1><p class="lede" style="margin:12px auto 0">${esc(S.errorText || "Bitte versuche es noch einmal.")}</p><div class="actions"><button type="button" class="btn" data-go="${S.customer ? "working" : "website"}" data-retry>Noch einmal versuchen</button></div></section>`;
  }

  /* ================= Turnstile (nur mit Site-Key, also in Produktion) ================= */
  function renderTurnstile() {
    const slot = $("#turnstile-slot");
    if (!slot || !S.turnstileSiteKey) return;
    const mount = () => {
      if (!window.turnstile || !slot.isConnected) return;
      slot.innerHTML = "";
      S.turnstileToken = "";
      S.turnstileWidget = window.turnstile.render(slot, {
        sitekey: S.turnstileSiteKey, appearance: "interaction-only", theme: "light",
        callback: (token) => { S.turnstileToken = token; },
        "expired-callback": () => { S.turnstileToken = ""; },
        "error-callback": () => { S.turnstileToken = ""; },
      });
    };
    if (window.turnstile) { mount(); return; }
    if (!$("#turnstile-script")) {
      const s = document.createElement("script");
      s.id = "turnstile-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = mount;
      document.head.appendChild(s);
    }
  }
  const turnstileToken = () => { try { return S.turnstileToken || (S.turnstileWidget != null && window.turnstile ? window.turnstile.getResponse(S.turnstileWidget) : "") || ""; } catch { return S.turnstileToken || ""; } };
  /** Die unsichtbare Pruefung braucht nach dem Rendern einen Moment - wer schneller tippt als
   *  Cloudflare prueft, soll nicht an einem leeren Token scheitern: bis zu 8 s warten. */
  async function waitForTurnstile() {
    if (!S.turnstileSiteKey) return "";
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const t = turnstileToken();
      if (t) return t;
      await new Promise((r) => setTimeout(r, 200));
    }
    return "";
  }

  /* ================= Fortschritt / Polling ================= */
  async function refreshStatus() {
    try {
      const data = await api("GET", "/api/start/status");
      S.status = data;
      applyState(data);
      return data;
    } catch (err) {
      if (err.status === 401) { S.customer = null; go("start"); }
      return null;
    }
  }
  function ensurePolling() {
    if (S.poll) return;
    S.poll = -1; // "wird gleich gesetzt" - verhindert doppelte Schleifen beim ersten Aufruf
    const tick = async () => {
      const data = await refreshStatus();
      if (!data) { stopPolling(); return; }
      const job = data.job || {};
      const running = !["done", "error", "idle"].includes(job.phase);
      if (S.screen === "working") {
        if (job.phase === "error" && !data.posts.length) { S.errorText = job.message || "Die Beiträge konnten nicht erstellt werden."; S.poll = null; go("error"); return; }
        // go() ruft render() und damit ensurePolling() auf - waehrend dieses Ticks ist S.poll aber
        // noch der alte Timer, also erst zuruecksetzen, sonst endet das Polling hier stumm.
        if (data.posts.length && (job.done >= 1 || !running)) { S.poll = null; go("result"); return; }
        if (!running && !data.posts.length && job.phase === "idle") { S.errorText = "Die Vorbereitung wurde unterbrochen."; S.poll = null; go("error"); return; }
        render();
      } else if (S.screen === "result" || S.screen === "dashboard") {
        patchWeek();
        // Ohne laufenden Job nur noch kurz nachsehen (fehlende Bilder eines bestaetigten Kunden
        // traegt der Nachtlauf nach) - nicht endlos alle vier Sekunden.
        S.idlePolls = running ? 0 : (S.idlePolls || 0) + 1;
        const wartetAufBilder = data.posts.some((p) => !p.imageUrl) && S.customer?.emailVerified;
        if (!running && (!wartetAufBilder || S.idlePolls > 15)) { stopPolling(); return; }
      }
      if (S.poll) S.poll = setTimeout(tick, running ? 1500 : 4000);
    };
    S.poll = setTimeout(tick, 400);
  }
  function stopPolling() { if (S.poll) { if (S.poll !== -1) clearTimeout(S.poll); S.poll = null; } }
  /** Nur die Woche neu zeichnen (nicht die ganze Seite), damit ein offenes Inline-Feld oder ein
   *  aufgeklappter Text nicht verschwindet, wenn im Hintergrund ein Beitrag fertig wird. */
  function patchWeek() {
    const week = $("#week");
    if (!week) { render(); return; }
    const open = new Set($$(".post.is-open", week).map((el) => el.dataset.id));
    const tmp = document.createElement("div");
    tmp.innerHTML = weekHtml({ dashboard: S.screen === "dashboard" });
    week.replaceWith(tmp.firstElementChild);
    open.forEach((id) => $(`.post[data-id="${CSS.escape(id)}"]`)?.classList.add("is-open"));
    const line = $(".progress-line");
    const job = S.status?.job;
    const running = job && !["done", "error", "idle"].includes(job.phase);
    if (line && !running) line.remove();
    if (line && running && job.total) line.textContent = S.screen === "dashboard" ? `${job.kind === "backfill" ? "Bilder werden erstellt" : "Beiträge werden erstellt"} - ${job.done} von ${job.total} …` : `Noch ${Math.max(0, job.total - job.done)} ${job.total - job.done === 1 ? "Beitrag" : "Beiträge"} in Arbeit - sie erscheinen gleich hier.`;
  }

  async function loadDashboardExtras() {
    if (!S.customer?.approvalMode) { S.approvals = []; return; }
    try {
      const { approvals } = await api("GET", "/api/approvals");
      S.approvals = approvals || [];
      const sec = $("#approvals-section");
      if (sec) sec.innerHTML = approvalsHtml();
    } catch { /* Abschnitt bleibt leer */ }
  }
  async function loadHistory() {
    try { const { posts } = await api("GET", "/api/posts"); S.history = posts || []; } catch { S.history = []; }
    if (S.screen === "settings") render();
  }

  /* ================= Aktionen ================= */
  function setFieldError(id, text) {
    const el = $(`#err-${id}`);
    const input = $(`#${id}`);
    if (el) el.textContent = text || "";
    if (input) input.setAttribute("aria-invalid", text ? "true" : "false");
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "Einen Moment …"; btn.classList.add("is-busy"); }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.classList.remove("is-busy"); }
  }

  async function submitStart(form) {
    const email = form.email.value.trim();
    setFieldError("email", "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setFieldError("email", "Das sieht nicht nach einer E-Mail-Adresse aus. Bitte prüfe die Eingabe."); return; }
    S.email = email;
    const btn = $("button[type=submit]", form);
    busy(btn, true, "Wird geprüft …");
    try {
      const r = await api("POST", "/api/start/begin", { email });
      if (r.status === "known") { S.knownMailed = r.mailed; go("known"); } else go("website");
    } catch (err) {
      busy(btn, false);
      setFieldError("email", err.message);
    }
  }

  async function submitPreview(form, kind) {
    const btn = $("#btn-preview", form);
    const body = { email: S.email };
    if (kind === "website") {
      const website = form.website.value.trim();
      setFieldError("website", "");
      if (!website || !/[a-z0-9-]+\.[a-z]{2,}/i.test(website)) { setFieldError("website", "Bitte gib eine Adresse wie deine-firma.at ein."); return; }
      S.website = website; S.noSite = false; body.website = website;
    } else {
      const description = form.description.value.trim();
      setFieldError("description", "");
      if (description.length < 12) { setFieldError("description", "Ein, zwei Sätze reichen - aber ein bisschen mehr als das brauchen wir."); return; }
      S.description = description; S.noSite = true; body.description = description;
    }
    busy(btn, true, kind === "website" ? "Website wird gelesen …" : "Wird gelesen …");
    const token = await waitForTurnstile();
    if (token) body["cf-turnstile-response"] = token;
    else if (S.turnstileSiteKey) {
      busy(btn, false);
      setFieldError(kind === "website" ? "website" : "description", "Die Sicherheitsprüfung ist noch nicht durch. Bitte einen Moment warten und noch einmal auf „Vorschau erstellen“ tippen.");
      return;
    }
    S.workingSince = Date.now();
    try {
      const r = await api("POST", "/api/start/preview", body);
      applyState(r);
      S.status = { job: { phase: "writing", done: 0, total: 0 }, posts: [], summary: r.summary, imagesDone: 0, window: { from: todayStr() } };
      go("working");
    } catch (err) {
      busy(btn, false);
      if (err.data?.known) { S.knownMailed = false; go("known"); try { const r = await api("POST", "/api/start/begin", { email: S.email }); S.knownMailed = r.mailed; render(); } catch { /* egal */ } return; }
      if (err.data?.fallback === "description" && kind === "website") { setFieldError("website", err.message); return; }
      setFieldError(kind === "website" ? "website" : "description", err.message);
      if (window.turnstile && S.turnstileWidget != null) { try { window.turnstile.reset(S.turnstileWidget); } catch { /* egal */ } }
    }
  }

  async function submitAdjust(form) {
    const wish = form.wish.value.trim();
    setFieldError("wish", "");
    if (!wish) { setFieldError("wish", "Sag uns in ein paar Worten, was anders sein soll."); return; }
    const btn = $("button[type=submit]", form);
    busy(btn, true, "Wird übersetzt …");
    try {
      await api("POST", "/api/start/adjust", { wish });
      S.workingSince = Date.now();
      S.status = { ...(S.status || {}), job: { phase: "writing", done: 0, total: 0, kind: "adjust" } };
      toast("Verstanden - die Woche wird neu geschrieben.");
      go(onboardingDone() ? "dashboard" : "working");
    } catch (err) {
      busy(btn, false);
      setFieldError("wish", err.message);
    }
  }

  async function saveRow(form) {
    const id = form.dataset.rowForm;
    const errEl = $("[data-row-error]", form);
    const patch = {};
    if (id === "company") { patch.company = form.company.value.trim(); patch.industry = form.industry.value.trim(); if (!patch.company) { errEl.textContent = "Der Firmenname darf nicht leer sein."; return; } }
    if (id === "pillars") { const titles = JSON.parse(form.pillars.value || "[]"); const existing = S.customer.contentPillars || []; patch.contentPillars = titles.map((t) => ({ title: t, description: existing.find((p) => p.title === t)?.description || "", weight: 1 })); }
    if (id === "channels") { const on = $$("input[name=ch]:checked", form).map((i) => i.value); if (!on.length) { errEl.textContent = "Bitte mindestens einen Kanal auswählen."; return; } patch.igFeedEnabled = on.includes("ig_feed"); patch.igStoryEnabled = on.includes("ig_story"); patch.linkedinEnabled = on.includes("linkedin"); }
    if (id === "rhythm") { const f = $("input[name=frequency]:checked", form)?.value; if (!f) { errEl.textContent = "Bitte einen Rhythmus wählen."; return; } patch.frequency = f; patch.activeWeekdays = ""; patch.instagramWeekdays = ""; patch.linkedinWeekdays = ""; patch.postTime = form.postTime.value || "15:00"; }
    if (id === "color") { patch.accentColor = form.accentColor.value; }
    if (id === "approval") { patch.approvalMode = form.approvalMode.checked; }
    const btn = $("button[type=submit]", form);
    busy(btn, true, "Speichern …");
    try {
      const r = await api("PATCH", "/api/me", patch);
      applyState(r);
      S.editing = null;
      const structural = id === "channels" || id === "rhythm";
      render();
      if (structural && onboardingDone()) { try { await api("POST", "/api/start/replan"); ensurePolling(); } catch { /* still */ } }
      toast("Gespeichert.");
    } catch (err) {
      busy(btn, false);
      errEl.textContent = err.message;
    }
  }

  async function adoptPlan() {
    const btn = $("#btn-adopt");
    busy(btn, true, "Wird übernommen …");
    try {
      const r = await api("POST", "/api/tour-done");
      applyState(r);
      try { await api("POST", "/api/start/replan"); } catch { /* nichts Neues zu planen */ }
      go("connect");
    } catch (err) { busy(btn, false); toast(err.message, "bad"); }
  }

  function openPostNow() {
    const c = S.customer;
    const chans = enabledChannels(c);
    const open = new Set((c.postRequests || []).filter((r) => r.status === "pending").map((r) => r.channel));
    $("#sheet-title").textContent = "Jetzt posten";
    $("#sheet-body").innerHTML = `
      <p class="small muted">Ein zusätzlicher Beitrag, außerhalb des Plans. Er wird in den nächsten Minuten erstellt${c.approvalMode ? " und wartet dann auf deine Freigabe" : " und veröffentlicht"}.</p>
      <form id="f-postnow">
        <div class="choice">${chans.map((ch) => `<label><input type="checkbox" name="ch" value="${ch}" ${open.has(ch) ? "disabled" : chans.length === 1 ? "checked" : ""}><span>${esc(CHANNEL[ch].label)}${open.has(ch) ? `<small>schon angefragt</small>` : ""}</span></label>`).join("")}</div>
        <div class="field" style="margin-top:14px"><label for="topic">Thema <span class="muted">(optional)</span></label><input class="input" id="topic" name="topic" maxlength="300" placeholder="z. B. unser neues Angebot ab Oktober"></div>
        <p class="error" id="err-topic" aria-live="assertive"></p>
        <div class="actions" style="margin-top:16px"><button class="btn lg" type="submit">Jetzt posten</button></div>
      </form>`;
    $("#sheet-overlay").hidden = false;
  }
  function closeSheet() { $("#sheet-overlay").hidden = true; }

  async function submitPostNow(form) {
    const channels = $$("input[name=ch]:checked", form).map((i) => i.value);
    setFieldError("topic", "");
    if (!channels.length) { setFieldError("topic", "Bitte mindestens einen Kanal auswählen."); return; }
    const btn = $("button[type=submit]", form);
    busy(btn, true, "Wird angefragt …");
    try {
      const r = await api("POST", "/api/post-now", { channels, topic: form.topic.value.trim(), format: "single" });
      applyState(r);
      closeSheet();
      S.notice = { kind: "ok", text: `Angefragt für ${channels.map((ch) => CHANNEL[ch].label).join(" und ")}. Der Beitrag entsteht in den nächsten Minuten${S.customer.approvalMode ? " und erscheint dann oben zur Freigabe" : ""}.` };
      render();
    } catch (err) { busy(btn, false); setFieldError("topic", err.message); }
  }

  /* ---- Reihenfolge (Drag-and-drop + Pfeile) ---- */
  function channelOrder(channel) {
    return $$(`#week .post[data-channel="${channel}"]`).filter((el) => ["planned", "edited", "approved"].includes(S.status.posts.find((p) => p.id === el.dataset.id)?.status)).map((el) => el.dataset.id);
  }
  async function reorder(channel, ids) {
    try {
      const { posts } = await api("POST", "/api/planned-posts/reorder", { channel, ids });
      posts.forEach((u) => { const i = S.status.posts.findIndex((p) => p.id === u.id); if (i >= 0) S.status.posts[i] = u; });
      patchWeek();
      toast("Reihenfolge gespeichert.");
    } catch (err) { toast(err.message, "bad"); patchWeek(); }
  }
  function move(id, dir) {
    const el = $(`#week .post[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const ids = channelOrder(el.dataset.channel);
    const i = ids.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(el.dataset.channel, ids);
  }
  let dragId = null;
  document.addEventListener("dragstart", (e) => {
    const grip = e.target.closest?.("[data-drag]");
    if (!grip) return;
    dragId = grip.dataset.drag;
    grip.closest(".post").classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", dragId); } catch { /* egal */ }
  });
  document.addEventListener("dragover", (e) => {
    if (!dragId) return;
    const target = e.target.closest?.(".post[data-id]");
    const source = $(`#week .post[data-id="${CSS.escape(dragId)}"]`);
    if (!target || !source || target === source || target.dataset.channel !== source.dataset.channel) return;
    e.preventDefault();
    $$("#week .post.is-over").forEach((el) => el.classList.remove("is-over"));
    target.classList.add("is-over");
  });
  document.addEventListener("drop", (e) => {
    if (!dragId) return;
    const target = e.target.closest?.(".post[data-id]");
    const source = $(`#week .post[data-id="${CSS.escape(dragId)}"]`);
    $$("#week .post.is-over, #week .post.is-dragging").forEach((el) => el.classList.remove("is-over", "is-dragging"));
    if (!target || !source || target === source || target.dataset.channel !== source.dataset.channel) { dragId = null; return; }
    e.preventDefault();
    const ids = channelOrder(source.dataset.channel);
    const from = ids.indexOf(source.dataset.id);
    const to = ids.indexOf(target.dataset.id);
    if (from < 0 || to < 0) { dragId = null; return; }
    ids.splice(from, 1);
    ids.splice(to, 0, source.dataset.id);
    dragId = null;
    reorder(source.dataset.channel, ids);
  });
  document.addEventListener("dragend", () => { $$("#week .post.is-over, #week .post.is-dragging").forEach((el) => el.classList.remove("is-over", "is-dragging")); dragId = null; });

  /* ================= Ereignisse ================= */
  document.addEventListener("submit", (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.id === "f-start") submitStart(form);
    else if (form.id === "f-website") submitPreview(form, "website");
    else if (form.id === "f-describe") submitPreview(form, "describe");
    else if (form.id === "f-adjust") submitAdjust(form);
    else if (form.dataset.rowForm) saveRow(form);
    else if (form.id === "f-postnow") submitPostNow(form);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet-overlay").hidden) closeSheet();
    if (e.key === "Enter" && e.target.id === "chip-input") {
      e.preventDefault();
      addChip(e.target);
    }
  });
  function addChip(input) {
    const form = input.closest("form");
    const list = JSON.parse(form.pillars.value || "[]");
    const t = input.value.trim().slice(0, 60);
    if (!t || list.includes(t) || list.length >= 6) { input.value = ""; return; }
    list.push(t);
    form.pillars.value = JSON.stringify(list);
    input.value = "";
    repaintChips(form);
  }
  function repaintChips(form) {
    const list = JSON.parse(form.pillars.value || "[]");
    const box = $("#chip-edit", form);
    box.innerHTML = `${list.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-chip-remove="${i}" aria-label="${esc(t)} entfernen">×</button></span>`).join("")}<span class="chip add"><input id="chip-input" placeholder="Thema hinzufügen, Enter" aria-label="Thema hinzufügen" maxlength="60"></span>`;
    $("#chip-input", form).focus();
  }

  document.addEventListener("input", (e) => {
    if (e.target.name === "accentColorPick") { const form = e.target.closest("form"); form.accentColor.value = e.target.value; $$(".swatch[data-swatch]", form).forEach((b) => b.setAttribute("aria-pressed", "false")); }
  });

  document.addEventListener("click", async (e) => {
    const t = e.target;
    const goBtn = t.closest("[data-go]");
    if (goBtn) {
      e.preventDefault();
      const target = goBtn.dataset.go;
      if (target === "home") { go(established() ? (onboardingDone() ? "dashboard" : "result") : "start"); return; }
      if (target === "dashboard" && !onboardingDone()) { go("plan"); return; }
      go(target);
      if (goBtn.dataset.settingsTarget) setTimeout(() => $(`#${goBtn.dataset.settingsTarget}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }
    if (t.closest("[data-more]")) { const post = t.closest(".post"); post.classList.toggle("is-open"); t.closest("[data-more]").textContent = post.classList.contains("is-open") ? "weniger" : "mehr"; return; }
    const edit = t.closest("[data-edit]");
    if (edit) { S.editing = edit.dataset.edit; render(); $(`#row-${S.editing} input, #row-${S.editing} textarea`)?.focus(); return; }
    if (t.closest("[data-cancel-edit]")) { S.editing = null; render(); return; }
    const chipRm = t.closest("[data-chip-remove]");
    if (chipRm) { const form = chipRm.closest("form"); const list = JSON.parse(form.pillars.value || "[]"); list.splice(Number(chipRm.dataset.chipRemove), 1); form.pillars.value = JSON.stringify(list); repaintChips(form); return; }
    const sw = t.closest("[data-swatch]");
    if (sw) { const form = sw.closest("form"); form.accentColor.value = sw.dataset.swatch; $$(".swatch[data-swatch]", form).forEach((b) => b.setAttribute("aria-pressed", String(b === sw))); return; }
    if (t.closest("#btn-adopt")) { adoptPlan(); return; }
    if (t.closest("#btn-to-dashboard")) { go("dashboard"); return; }
    if (t.closest("#btn-post-now")) { openPostNow(); return; }
    if (t.closest("#sheet-close") || (t.id === "sheet-overlay")) { closeSheet(); return; }
    const skip = t.closest("[data-skip]");
    if (skip) { try { applyState(await api("POST", `/api/skip-provider/${skip.dataset.skip}`)); render(); } catch (err) { toast(err.message, "bad"); } return; }
    const disc = t.closest("[data-disconnect]");
    if (disc) { if (!confirm(`${prov(disc.dataset.disconnect)?.name || "Kanal"} wirklich trennen? Der Kanal wird im Plan abgeschaltet.`)) return; try { applyState(await api("POST", `/api/disconnect/${disc.dataset.disconnect}`)); render(); toast("Getrennt."); } catch (err) { toast(err.message, "bad"); } return; }
    const appr = t.closest("[data-approve]");
    if (appr) { busy(appr, true, "…"); try { await api("POST", `/api/approvals/${appr.dataset.approve}/approve`); toast("Freigegeben - wird in Kürze veröffentlicht."); await loadDashboardExtras(); } catch (err) { busy(appr, false); toast(err.message, "bad"); } return; }
    const rej = t.closest("[data-reject]");
    if (rej) { try { await api("POST", `/api/approvals/${rej.dataset.reject}/reject`); toast("Abgelehnt."); await loadDashboardExtras(); } catch (err) { toast(err.message, "bad"); } return; }
    const apPlan = t.closest("[data-approve-plan]");
    if (apPlan) { busy(apPlan, true, "…"); try { const { post } = await api("POST", `/api/planned-posts/${apPlan.dataset.approvePlan}/approve`); const i = S.status.posts.findIndex((p) => p.id === post.id); if (i >= 0) S.status.posts[i] = post; patchWeek(); toast("Freigegeben."); } catch (err) { busy(apPlan, false); toast(err.message, "bad"); } return; }
    const skPlan = t.closest("[data-skip-plan]");
    if (skPlan) { try { const { post } = await api("POST", `/api/planned-posts/${skPlan.dataset.skipPlan}/skip`); const i = S.status.posts.findIndex((p) => p.id === post.id); if (i >= 0) S.status.posts[i] = post; patchWeek(); toast("Übersprungen - an dem Tag geht nichts raus."); } catch (err) { toast(err.message, "bad"); } return; }
    const mv = t.closest("[data-move]");
    if (mv) { move(mv.dataset.id, mv.dataset.move); return; }
    if (t.closest("[data-replan]")) { try { await api("POST", "/api/start/replan"); ensurePolling(); toast("Wird geplant …"); } catch (err) { toast(err.message, "bad"); } return; }
    const pause = t.closest("[data-pause]");
    if (pause) { try { applyState(await api("POST", "/api/pause", { paused: pause.dataset.pause === "1" })); render(); } catch (err) { toast(err.message, "bad"); } return; }
    if (t.closest("#resend-verify")) { const b = t.closest("#resend-verify"); busy(b, true, "Wird gesendet …"); try { await api("POST", "/api/resend-verification"); toast(S.sandbox ? "Testversion: keine echte Mail, nur ein Log-Eintrag." : "Bestätigungsmail ist unterwegs."); } catch (err) { toast(err.message, "bad"); } busy(b, false); return; }
    if (t.closest("#logout") || t.closest("#logout-other")) { try { await api("POST", "/api/logout"); } catch { /* egal */ } S.customer = null; S.connections = []; S.status = null; go("start"); return; }
    if (t.closest("[data-retry]")) { if (S.customer) { try { await api("POST", "/api/start/replan"); } catch { /* egal */ } S.workingSince = Date.now(); } }
  });

  window.addEventListener("hashchange", () => {
    if (!onboardingDone()) return;
    const h = location.hash.replace("#", "");
    if ((h === "dashboard" || h === "settings") && S.screen !== h) go(h);
  });

  /* ================= Start ================= */
  async function boot() {
    injectImageFonts();
    try {
      const p = await api("GET", "/api/providers");
      S.providers = p.providers || [];
      S.aiAvailable = Boolean(p.aiAvailable);
      S.turnstileSiteKey = p.turnstileSiteKey || null;
      S.sandbox = Boolean(p.sandbox);
      if (S.sandbox) $("#sandbox-banner").hidden = false;
    } catch {
      $("#stage").innerHTML = `<div class="notice bad" role="alert">Pipeflow ist gerade nicht erreichbar. Bitte lade die Seite in ein paar Minuten neu.</div>`;
      return;
    }
    try { applyState(await api("GET", "/api/me")); } catch { /* nicht angemeldet */ }

    const q = new URLSearchParams(location.search);
    const clean = () => history.replaceState(null, "", location.pathname + location.hash);
    if (S.customer) {
      S.email = S.customer.email;
      await refreshStatus();
      const pName = prov(q.get("provider"))?.name || "";
      if (q.get("connected") || q.get("error")) {
        const id = q.get("connected") || q.get("provider");
        S.notice = q.get("connected") && prov(id)
          ? { provider: id, kind: "ok", text: `${prov(id).name} verbunden als ${conn(id)?.accountName || "—"}.` }
          : { provider: q.get("provider"), kind: "bad", text: (ERRORS[q.get("error")] || ERRORS.failed)(pName) };
        clean();
        if (onboardingDone()) go("settings", { keepNotice: true }); else go("connect", { keepNotice: true });
        return;
      }
      if (q.get("verified")) {
        clean();
        S.notice = { kind: "ok", text: "E-Mail-Adresse bestätigt - danke. Die restlichen Bilder werden jetzt erstellt." };
        go(onboardingDone() ? "dashboard" : "result", { keepNotice: true });
        return;
      }
      const h = location.hash.replace("#", "");
      if (onboardingDone()) { go(h === "settings" ? "settings" : h === "dashboard" ? "dashboard" : "welcome"); return; }
      // Mitten im Onboarding wiedergekommen: dort weiter, wo etwas zu sehen ist.
      const job = S.status?.job;
      const running = job && !["done", "error", "idle"].includes(job.phase);
      if (S.status?.posts?.length) go("result");
      else if (running) { S.workingSince = Date.now(); go("working"); }
      else { try { await api("POST", "/api/start/replan"); } catch { /* egal */ } S.workingSince = Date.now(); go("working"); }
      return;
    }
    if (q.get("error")) { S.notice = { kind: "bad", text: (ERRORS[q.get("error")] || ERRORS.failed)("") }; clean(); }
    go("start", { keepNotice: true });
    if (S.notice) toast(S.notice.text, "bad");
  }

  boot();
})();
