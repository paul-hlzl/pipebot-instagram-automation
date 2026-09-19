/* ===========================================================================
   Pipeflow „Start" — Easy Onboarding (Fassung 19.09.2026)
   Eine Eingabe (Domain), zwei Klicks bis zur fertigen Woche in den Markenfarben
   des Kunden. Nutzt ausschliesslich bestehende Endpunkte plus /api/start/* und
   /auth/* (siehe src/panel/start-routes.ts). Kein Framework, kein Build.
   Designplan: docs/EASY_ONBOARDING_DESIGN.md
   =========================================================================== */
(() => {
  "use strict";

  const MOUNT = window.__PF_MOUNT ?? "";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const KANAL = {
    ig_feed: { label: "Instagram", format: "feed" },
    ig_story: { label: "Instagram Story", format: "story" },
    linkedin: { label: "LinkedIn", format: "feed" },
  };
  const KANAL_REIHE = ["ig_feed", "ig_story", "linkedin"];
  const RHYTHMUS = {
    "3x-woche": { label: "3× pro Woche", sub: "Montag, Mittwoch, Freitag", tage: [1, 3, 5] },
    werktags: { label: "Werktags", sub: "Montag bis Freitag, 5× pro Woche", tage: [1, 2, 3, 4, 5] },
    taeglich: { label: "Täglich", sub: "auch am Wochenende", tage: [1, 2, 3, 4, 5, 6, 7] },
  };
  const PALETTE = ["#0a0e1a", "#1a2e1a", "#2e1a1a", "#1a1a2e", "#2e2410", "#111111"];
  const STANDARD_AKZENT = "#0a0e1a";
  // Bildschriften der Pipeline (fonts.ts) - die Platzhalterkachel setzt die Schlagzeile in
  // derselben Schrift wie das echte Bild.
  const SCHRIFTEN = { inter: ["Inter", "Inter.ttf", 700], poppins: ["Poppins", "Poppins.ttf", 700], playfair: ["Playfair Display", "PlayfairDisplay.ttf", 700], merriweather: ["Merriweather", "Merriweather.ttf", 700], bebas: ["Bebas Neue", "BebasNeue.ttf", 400], anton: ["Anton", "Anton.ttf", 400], caveat: ["Caveat", "Caveat.ttf", 700], pacifico: ["Pacifico", "Pacifico.ttf", 400] };
  const WOCHENTAG_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const FEHLER = {
    failed: (p) => `Die Verbindung mit ${p || "dem Kanal"} hat nicht geklappt. Bitte versuche es noch einmal.`,
    cancelled: (p) => `Du hast die Verbindung mit ${p || "dem Kanal"} abgebrochen. Du kannst sie jederzeit nachholen.`,
    state: () => "Die Sitzung ist abgelaufen. Bitte versuche es noch einmal.",
    personal_account: (p) => `${p} verlangt ein Business- oder Creator-Konto. Bitte stelle dein Konto um und versuche es erneut.`,
    missing_permission: (p) => `Bei ${p} fehlt eine Berechtigung. Bitte verbinde erneut und erlaube alle Punkte.`,
    not_configured: (p) => `Die Anmeldung mit ${p || "diesem Anbieter"} ist noch nicht fertig eingerichtet. Nimm so lange den E-Mail-Weg.`,
    session: () => "Bitte melde dich zuerst an.",
    verify: () => "Dieser Bestätigungslink ist ungültig oder wurde schon verwendet.",
    login: () => "Dieser Anmeldelink ist ungültig oder abgelaufen. Gib deine E-Mail-Adresse ein, wir schicken dir einen neuen.",
    "login-limit": () => "Zu viele Anmeldeversuche. Bitte in einer Stunde noch einmal.",
    rate: () => "Zu viele Anmeldeversuche. Bitte in einer Stunde noch einmal.",
    unknown: () => "Dieser Anmeldeweg ist nicht bekannt.",
  };

  const S = {
    screen: "konto", gerendert: null, providers: [], authProviders: [], aiAvailable: false, turnstileSiteKey: null, sandbox: false,
    customer: null, connections: [], skipped: new Set(),
    status: null, approvals: [], verlauf: null,
    notice: null, grenze: null, tagWahl: null, jobFertigSeit: 0, vorladen: false, wochenSig: "", editing: null, poll: null, arbeitSeit: 0, turnstileWidget: null, turnstileToken: "",
    beschreibung: "", website: "", leerlauf: 0,
  };
  const angemeldet = () => Boolean(S.customer);
  const eingerichtet = () => Boolean(S.customer && S.customer.tourDone);
  const kanal = (id) => S.connections.find((c) => c.provider === id);
  const anbieter = (id) => S.providers.find((p) => p.id === id);
  const uebernehmen = (d) => { if (!d || !d.customer) return; S.customer = d.customer; S.connections = d.connections || []; S.skipped = new Set(d.customer.skippedProviders || []); lichtSetzen(); };

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

  function toast(text, art = "ok") {
    const el = document.createElement("div");
    el.className = `toast ${art}`;
    el.textContent = text;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  /* ================= Formatierung ================= */
  const datumVon = (iso) => new Date(`${iso}T12:00:00`);
  const kurzDatum = (iso) => { const d = datumVon(iso); return `${WOCHENTAG_KURZ[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };
  const langDatum = (iso) => datumVon(iso).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
  const zeitpunkt = (iso) => new Date(iso).toLocaleString("de-AT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });

  function aktiveKanaele(c = S.customer) {
    if (!c) return KANAL_REIHE;
    return KANAL_REIHE.filter((ch) => (ch === "ig_feed" && c.igFeedEnabled) || (ch === "ig_story" && c.igStoryEnabled) || (ch === "linkedin" && c.linkedinEnabled));
  }
  function postTage(c = S.customer) {
    const explizit = c && c.activeWeekdays ? c.activeWeekdays.split(",").map(Number).filter((n) => n >= 1 && n <= 7) : null;
    return explizit && explizit.length ? explizit : (RHYTHMUS[c?.frequency] || RHYTHMUS.werktags).tage;
  }
  function rhythmusText(c = S.customer) {
    const tage = postTage(c);
    const schluessel = [...tage].sort().join(",");
    const treffer = Object.entries(RHYTHMUS).find(([, f]) => f.tage.join(",") === schluessel);
    // "3× pro Woche" traegt die Zahl schon im Namen - nur "Werktags"/"Täglich" bekommen sie dazu.
    if (treffer) { const l = RHYTHMUS[treffer[0]].label; return l.includes("×") ? l : `${l}, ${tage.length}× pro Woche`; }
    return `${tage.length}× pro Woche (${tage.map((d) => WOCHENTAG_KURZ[d % 7]).join(", ")})`;
  }
  const GRAD_WINKEL = { horizontal: "90deg", vertical: "180deg", diagonal: "135deg" };
  /** Der Bildhintergrund, wie ihn die Pipeline gerade erzeugen wuerde - eine Stelle fuer alle
   *  Vorschauen (Platzhalterkachel und Farbvorschau im Plan). */
  const kachelHintergrund = (c = S.customer, ueberschreiben) => {
    const q = ueberschreiben || {};
    const hex = q.accentColor || (c && c.accentColor) || STANDARD_AKZENT;
    const an = q.gradientEnabled !== undefined ? q.gradientEnabled : c && c.gradientEnabled;
    const zwei = q.gradientColor2 !== undefined ? q.gradientColor2 : c && c.gradientColor2;
    const richtung = q.gradientDirection || (c && c.gradientDirection) || "diagonal";
    return an && zwei ? `linear-gradient(${GRAD_WINKEL[richtung] || GRAD_WINKEL.diagonal}, ${hex}, ${zwei})` : hex;
  };
  const kachelSchrift = (c = S.customer) => { const f = SCHRIFTEN[c?.fontChoice] || SCHRIFTEN.inter; return `font-family:"${f[0]}";font-weight:${f[2]}`; };

  /**
   * Speist die beiden Lichtkegel des Seitenhintergrunds aus den erkannten Markenfarben. Sehr
   * niedrige Deckkraft: es soll wie einfallendes Licht wirken, nicht wie eine farbige Flaeche.
   * Ohne erkannte Farben bleibt der neutrale Grauton aus der CSS-Datei stehen.
   */
  /**
   * Wie stark darf dieses Licht sein? Nicht als feste Zahl, sondern aus dem Abstand der
   * Markenfarbe zum Papierweiss gerechnet (Auftrag 19.09.2026).
   *
   * Der Grund: ein fester Alphawert trifft jede Marke anders. Bei 0,2 bleibt ein warmes Gold
   * ein Lichtschein, ein sattes Rot waere schon eine Farbflaeche. Gemessen wurde, dass die
   * sichtbare Abweichung vom Grund ungefaehr Alpha mal Abstand mal 0,75 betraegt; ZIEL ist die
   * staerkste Stelle oben links. 26 Stufen sind deutlich mehr als die 19 von vorher und
   * bleiben unterhalb dessen, was man als Farbe benennen wuerde.
   */
  function lichtStaerke(rgb) {
    const ZIEL = 26;
    const grund = [250, 249, 247];
    const abstand = Math.max(...rgb.map((v, i) => Math.abs(v - grund[i])));
    if (abstand < 8) return 0;
    return Math.round(Math.min(0.3, ZIEL / (abstand * 0.75)) * 1000) / 1000;
  }

  function lichtSetzen() {
    const c = S.customer;
    const wurzel = document.documentElement;
    const zuRgb = (hex) => { const n = parseInt(String(hex || "").slice(1), 16); return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : null; };
    const eins = c && c.gradientEnabled ? zuRgb(c.accentColor) : null;
    if (!eins) {
      for (const n of ["--licht-1", "--licht-2", "--licht-3"]) wurzel.style.removeProperty(n);
      return;
    }
    const zwei = zuRgb(c.gradientColor2) || eins;
    for (const [name, farbe, anteil] of [["--licht-1", eins, 1], ["--licht-2", zwei, 0.72], ["--licht-3", eins, 0.36]]) {
      wurzel.style.setProperty(name, `rgba(${farbe.join(", ")}, ${lichtStaerke(farbe) * anteil})`);
    }
  }

  function schriftenLaden() {
    if ($("#pf-bildschriften")) return;
    const style = document.createElement("style");
    style.id = "pf-bildschriften";
    style.textContent = Object.values(SCHRIFTEN).map(([familie, datei]) => `@font-face{font-family:"${familie}";src:url("${MOUNT}/fonts/${datei}") format("truetype");font-weight:100 900;font-display:swap;}`).join("\n");
    document.head.appendChild(style);
  }

  /* ================= Rahmen ================= */
  function render() {
    const stage = $("#stage");
    stage.classList.toggle("breit", ["ergebnis", "dashboard", "einstellungen", "plan"].includes(S.screen));
    const html = {
      konto: kontoHtml, anmelden: anmeldenHtml, email: emailHtml, gesendet: gesendetHtml, willkommen: willkommenHtml,
      website: websiteHtml, beschreibung: beschreibungHtml, arbeitet: arbeitetHtml,
      ergebnis: ergebnisHtml, anders: andersHtml, plan: planHtml, verbinden: verbindenHtml,
      dashboard: dashboardHtml, einstellungen: einstellungenHtml, fehler: fehlerHtml,
    }[S.screen];
    const wechsel = S.gerendert !== S.screen;
    S.gerendert = S.screen;
    stage.innerHTML = `<div class="screen${wechsel ? " enter" : ""}">${html ? html() : ""}</div>`;
    kopfzeile();
    markeKunde();
    testleiste();
    farbBlattSetzen();
    if (["website", "beschreibung"].includes(S.screen) && S.turnstileSiteKey && S.customer && !S.customer.authProvider) renderTurnstile();
    if (["arbeitet", "ergebnis", "dashboard"].includes(S.screen)) pollStarten(); else pollStoppen();
    if (S.screen === "dashboard") dashboardNachladen();
    if (S.screen === "einstellungen" && S.verlauf === null) verlaufLaden();
    const ziel = $("[autofocus]", stage);
    if (ziel && !/Mobi|Android/i.test(navigator.userAgent)) ziel.focus();
    else stage.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  function kopfzeile() {
    const nav = $("#top-actions");
    if (!eingerichtet()) { nav.innerHTML = ""; return; }
    nav.innerHTML = S.screen === "einstellungen"
      ? `<button type="button" class="btn secondary sm" data-go="dashboard">Zur Übersicht</button>`
      : `<button type="button" class="btn secondary sm" data-go="einstellungen">Einstellungen</button>`;
  }

  /**
   * Die Leiste erscheint in der Sandbox fuer JEDE angemeldete Sitzung (Ansage vom 19.09.2026),
   * nicht nur fuer Testlaeufe. "Neu starten" wirft in beiden Faellen alles weg und beginnt bei
   * der Website-Frage; nur was genau weggeworfen wird, ist verschieden - beim Testlauf der
   * Wegwerfkunde selbst, beim angemeldeten Konto nur dessen Woche und Analyse.
   * "Beenden" gibt es nur beim Testlauf; ein angemeldetes Konto meldet sich normal ab.
   */
  function testleiste() {
    const bar = $("#testleiste");
    if (!bar) return;
    const zeigen = Boolean(S.sandbox && S.customer);
    bar.hidden = !zeigen;
    if (!zeigen) return;
    const test = Boolean(S.customer.isTest);
    $("#testleiste-text").innerHTML = test
      ? `Testlauf<span class="testleiste-zusatz"> &middot; z\u00e4hlt nicht als Kunde, keine Limits</span>`
      : `Sandbox<span class="testleiste-zusatz"> &middot; \u201eNeu starten\u201c verwirft die Daten dieses Kontos</span>`;
    $("#test-ende").hidden = !test;
  }

  async function testNeu() {
    const btn = $("#test-neu");
    beschaeftigt(btn, true, "Setzt zurück …");
    try {
      const r = await api("POST", "/api/start/test/reset");
      S.status = null; S.approvals = []; S.verlauf = null; S.notice = null; S.grenze = null;
      S.website = ""; S.beschreibung = ""; S.poll = null;
      uebernehmen(r);
      go("website");
      toast(r.art === "konto" ? "Konto geleert. Alles von vorne." : "Frischer Testlauf. Alles von vorne.");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      beschaeftigt(btn, false);
    }
  }

  async function testEnde() {
    try {
      await api("POST", "/api/start/test/end");
    } catch { /* egal - danach wird ohnehin neu geladen */ }
    location.href = MOUNT + "/start/";
  }

  /**
   * Der Farbpicker am Handy: als halbhohes Blatt von unten statt im Seitenfluss (Ansage vom
   * 19.09.2026). Grund ist gemessen - inline schob er die Beitragsvorschauen aus dem Bild,
   * also genau das, was er live veraendert. Am Schreibtisch bleibt alles wie bisher inline,
   * dort ist Platz genug.
   */
  const SCHMAL = () => window.matchMedia("(max-width: 719px)").matches;

  function farbBlattSetzen() {
    const overlay = $("#sheet-overlay");
    if (!overlay) return;
    const soll = S.editing === "farbe" && SCHMAL();
    if (!soll) {
      if (overlay.classList.contains("halb")) {
        overlay.classList.remove("halb");
        overlay.hidden = true;
        $("#sheet-body").innerHTML = "";
        document.body.classList.remove("blatt-offen");
      }
      return;
    }
    const form = $('[data-zeile-form="farbe"]');
    if (!form) return;
    $("#sheet-title").textContent = "Farbe";
    const body = $("#sheet-body");
    body.innerHTML = "";
    body.appendChild(form);
    overlay.classList.add("halb");
    overlay.hidden = false;
    document.body.classList.add("blatt-offen");
    // Die Vorschaukacheln in den freien Streifen ueber dem Blatt holen - sonst sieht man beim
    // Schieben am Regler nicht, was passiert, und genau dafuer ist das Blatt da.
    // scrollIntoView taugt hier nicht: es setzt die Kacheln an den Fensterrand, wo Testleiste
    // und Markenkopf kleben. Deshalb der Versatz von Hand, und erst im naechsten Frame, wenn
    // das Blatt seine Hoehe hat.
    requestAnimationFrame(() => {
      const kacheln = $("#plan-vorschau");
      if (!kacheln) return;
      const kopf = ($("#testleiste")?.offsetHeight || 0) + ($("#top")?.offsetHeight || 0) + 8;
      const ziel = window.scrollY + kacheln.getBoundingClientRect().top - kopf;
      window.scrollTo({ top: Math.max(0, ziel), behavior: "auto" });
    });
  }

  /**
   * Das Logo des Kunden in der Kopfzeile. Erscheint erst, wenn die Website gelesen ist, und
   * bleibt still weg, wenn keines erkannt wurde. Bewusst klein und ohne Rahmen: es soll
   * auffallen, dass die Oberflaeche zum Kunden gehoert, nicht das Logo selbst.
   * Bringt das Bild seinen eigenen Hintergrund mit (App-Kachel), bekommt es runde Ecken -
   * sonst saehe ein dunkles Quadrat auf hellem Papier wie ein Aufkleber aus.
   */
  function markeKunde() {
    const huelle = $("#marke-kunde");
    if (!huelle) return;
    const zeigen = Boolean(S.customer?.brandLogo);
    huelle.hidden = !zeigen;
    huelle.classList.toggle("kachel-logo", Boolean(S.customer?.brandLogoTile));
    if (!zeigen) return;
    const bild = $("#marke-kunde-bild");
    const quelle = `${MOUNT}/api/brand-logo`;
    if (bild.getAttribute("src") !== quelle) {
      bild.removeAttribute("width");
      bild.removeAttribute("height");
      bild.alt = S.customer.company ? `Logo von ${S.customer.company}` : "Logo";
      // Laesst sich das Bild nicht laden, verschwindet die Huelle wieder - lieber nichts als
      // ein kaputtes Bildsymbol neben dem Produktnamen.
      bild.onerror = () => { huelle.hidden = true; };
      bild.src = quelle;
    }
  }

  function go(screen, opts = {}) {
    S.screen = screen;
    S.editing = null;
    if (["dashboard", "einstellungen"].includes(screen)) history.replaceState(null, "", `#${screen}`);
    else if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    if (!opts.keepNotice) S.notice = null;
    if (!opts.keepGrenze) S.grenze = null;
    render();
  }

  /* ================= Bildschirm 1: Konto ================= */
  const AUTH_LOGO = {
    google: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6v-3h-4a12 12 0 0 0 0 10.7l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z"/></svg>`,
    microsoft: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>`,
    apple: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.8-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.1-.8-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.5.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.1.8 1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.5-1-2.5-3.7zM14 4.6c.7-.8 1.1-1.9 1-3-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.5z"/></svg>`,
  };
  function kontoHtml() {
    const liste = S.authProviders.length ? S.authProviders : [{ id: "google", name: "Google", available: false, note: "Wird gerade eingerichtet." }];
    return `
      <section class="hero">
        <h1>Aus deiner Website wird deine nächste Woche.</h1>
        <p class="lede">Wir lesen deine Website, erkennen Themen und Farben und legen dir sieben Tage Instagram und LinkedIn vor. Veröffentlicht wird nur, was du freigibst.</p>
        <div class="auth-liste">
          ${liste.map((p) => p.available
            ? `<a class="auth-btn" href="${esc(MOUNT)}/auth/${esc(p.id)}">${AUTH_LOGO[p.id] || ""}Mit ${esc(p.name)} fortfahren</a>`
            // Nicht eingerichtet: der Grund steht direkt unter DIESEM Knopf. Frueher kam er als
            // rote Meldung am unteren Bildschirmrand hoch - weit weg vom Knopf, und bei jedem
            // Tippen eine weitere obendrauf.
            : `<div class="auth-eintrag">
                 <button type="button" class="auth-btn kommt-noch" disabled>${AUTH_LOGO[p.id] || ""}Mit ${esc(p.name)} fortfahren<span class="bald">kommt noch</span></button>
                 ${p.note ? `<p class="auth-notiz">${esc(p.note)}</p>` : ""}
               </div>`).join("")}
        </div>
        <div class="auth-trenner">oder</div>
        <div class="auth-liste">
          <!-- Bewusst dieselbe Geometrie wie die Anbieter-Knoepfe: drei gleich breite Knoepfe
               ergeben eine Spalte. Dass der E-Mail-Weg der zweite Weg ist, sagt die Position
               unter dem Trenner und die ruhigere Gestaltung - nicht eine andere Breite. -->
          <button type="button" class="auth-btn mail-weg" data-go="email">Mit E-Mail fortfahren</button>
        </div>
        <!-- Eigener Einstieg fuer Wiederkehrende, auf Ansage vom 19.09.2026. Der Auftrag wollte
             ausdruecklich KEINEN sichtbaren Unterschied zwischen Registrieren und Anmelden -
             Paul hat sich nach Ruecksprache bewusst dagegen entschieden. Technisch macht es
             keinen Unterschied: dieselben Anbieter-Knoepfe, nur der E-Mail-Weg legt drueben
             kein Konto an (modus=anmelden, siehe start-routes.ts). -->
        <p class="auth-schon">Schon ein Konto? <button type="button" class="link auth-link" data-go="anmelden">Hier anmelden</button></p>
        <p class="hint">Mit dem Fortfahren erlaubst du Pipeline AI Solutions, deine Angaben zu speichern und daraus Beiträge vorzubereiten. <a href="${esc(MOUNT || "/panel")}/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a></p>
      </section>`;
  }

  function anmeldenHtml() {
    const liste = S.authProviders.filter((p) => p.available);
    return `
      <section class="hero">
        <!-- "Willkommen zurück" gehoert dem Bildschirm, auf dem wir den Kunden bereits erkannt
             haben (gueltige Sitzung). Hier wissen wir noch nicht, wer kommt - also die Handlung. -->
        <h1>Anmelden</h1>
        <p class="lede">Nimm den Weg, mit dem du dein Konto angelegt hast.</p>
        ${liste.length ? `<div class="auth-liste">
          ${liste.map((p) => `<a class="auth-btn" href="${esc(MOUNT)}/auth/${esc(p.id)}">${AUTH_LOGO[p.id] || ""}Mit ${esc(p.name)} anmelden</a>`).join("")}
        </div>
        <div class="auth-trenner">oder</div>` : ""}
        <form id="f-anmelden" novalidate>
          <div class="field" style="margin-top:0">
            <label for="email">E-Mail-Adresse</label>
            <input class="input" id="email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="du@deine-firma.at" value="${esc(S.email || "")}" required autofocus>
            <p class="error" id="err-email" aria-live="assertive"></p>
          </div>
          <div class="actions"><button class="btn lg" type="submit">Anmeldelink schicken</button></div>
          <p class="auth-schon">Noch kein Konto? <button type="button" class="link auth-link" data-go="konto">Hier anlegen</button></p>
        </form>
      </section>`;
  }

  function emailHtml() {
    return `
      <section class="hero">
        <h1>Deine E-Mail-Adresse</h1>
        <p class="lede">Kennen wir die Adresse schon, schicken wir dir einen Anmeldelink. Sonst geht es direkt weiter.</p>
        <form id="f-email" novalidate>
          <div class="field">
            <label for="email">E-Mail-Adresse</label>
            <input class="input" id="email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="du@deine-firma.at" required autofocus>
            <p class="error" id="err-email" aria-live="assertive"></p>
          </div>
          <div class="actions"><button class="btn lg" type="submit">Weiter</button></div>
          <button type="button" class="link" data-go="konto">Zurück zu den Anmeldewegen</button>
        </form>
      </section>`;
  }

  function gesendetHtml() {
    return `
      <section class="hero">
        <h1>Schau in dein Postfach</h1>
        <p class="lede">${S.mailGeschickt
          ? `Wir haben dir einen Anmeldelink an <strong>${esc(S.email)}</strong> geschickt. Er gilt eine Stunde und lässt sich einmal verwenden.`
          : `An <strong>${esc(S.email)}</strong> haben wir in der letzten Stunde schon einen Anmeldelink geschickt. Bitte nimm den, ein neuer kommt erst danach.`}</p>
        ${S.sandbox ? `<p class="hint">Testversion: Hier wird keine E-Mail verschickt, der Link steht nur im Server-Log.</p>` : ""}
        <div class="actions"><button type="button" class="link" data-go="email">Andere E-Mail-Adresse verwenden</button></div>
      </section>`;
  }

  function willkommenHtml() {
    const c = S.customer;
    return `
      <section class="hero">
        <h1>Willkommen zurück</h1>
        <button type="button" class="konto-karte" data-go="dashboard">
          <span class="konto-avatar" aria-hidden="true">${esc((c.company || "?").trim().charAt(0).toUpperCase())}</span>
          <span><strong>${esc(c.company)}</strong><span class="muted small">Weiter als ${esc(c.email)}</span></span>
          <span class="pfeil" aria-hidden="true">→</span>
        </button>
        <div class="actions"><button type="button" class="link" id="abmelden-anderes">Mit einem anderen Konto anmelden</button></div>
      </section>`;
  }

  /**
   * Eine erreichte Tagesgrenze ist KEIN Fehler: nichts ist kaputt, es ist nur gerade nichts
   * frei. Deshalb ruhige graue Karte statt roter Feldmeldung, kein aria-invalid am Feld, und
   * ein Knopf, der wirklich irgendwohin fuehrt. Der Text samt Uhrzeit kommt vom Server.
   */
  function grenzeHtml() {
    const g = S.grenze;
    if (!g) return "";
    const wege = {
      domain: { label: "Anmelden", ziel: "anmelden" },
      account: { label: "Zu deiner Woche", ziel: "ergebnis" },
    };
    const weg = g.reason === "account" && !(S.status?.posts || []).length ? null : wege[g.reason];
    return `<div class="notice ruhig" role="status">${esc(g.text)}${weg ? `<span><button type="button" class="btn secondary sm" data-go="${weg.ziel}" style="justify-self:start">${esc(weg.label)}</button></span>` : ""}</div>`;
  }

  /* ================= Bildschirm 2: die eine Frage ================= */
  function websiteHtml() {
    return `
      <section class="hero">
        <h1>Deine Website genügt.</h1>
        <p class="lede">Wir lesen sie einmal, erkennen Themen und Farben und planen daraus die nächsten sieben Tage.</p>
        <form id="f-website" novalidate>
          <div class="field">
            <label for="website">Website-Adresse</label>
            <input class="input" id="website" name="website" type="text" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="deine-firma.at" value="${esc(S.website)}" required autofocus>
            <p class="error" id="err-website" aria-live="assertive"></p>
          </div>
          ${grenzeHtml()}
          <div id="turnstile-slot"></div>
          <div class="actions"><button class="btn lg" type="submit" id="btn-vorschau">Vorschau erstellen</button></div>
          <p class="hint">Nichts wird veröffentlicht, bevor du es freigibst.</p>
          <button type="button" class="link" data-go="beschreibung">Ich habe keine Website</button>
        </form>
      </section>`;
  }

  function beschreibungHtml() {
    return `
      <section class="hero">
        <h1>Was macht dein Unternehmen?</h1>
        <p class="lede">Ein, zwei Sätze reichen. Stichworte auch - der Knopf darunter macht einen sauberen Absatz daraus.</p>
        <form id="f-beschreibung" novalidate>
          <div class="field feld-mit-ki">
            <label for="description">Beschreibung</label>
            <textarea class="textarea" id="description" name="description" rows="4" placeholder="physio in linz, viele büroleute mit rücken, auch massage" required autofocus>${esc(S.beschreibung)}</textarea>
            <button type="button" class="btn secondary sm ki-knopf" id="ki-verbessern">Mit KI verbessern</button>
            <p class="error" id="err-description" aria-live="assertive"></p>
          </div>
          ${grenzeHtml()}
          <div id="turnstile-slot"></div>
          <div class="actions"><button class="btn lg" type="submit" id="btn-vorschau">Vorschau erstellen</button></div>
          <p class="hint">Nichts wird veröffentlicht, bevor du es freigibst.</p>
          <button type="button" class="link" data-go="website">Ich habe doch eine Website</button>
        </form>
      </section>`;
  }

  /* ================= Bildschirm 3: es arbeitet ================= */
  /** Bilder aus erkannten Markenfarben werden lokal gerendert und kosten nichts - dann gibt es
   *  keinen Deckel und die ganze Woche bekommt sofort Bilder (Ansage vom 19.09.2026). Der
   *  Deckel greift nur, wenn kein Farbverlauf gefunden wurde und jedes Bild echtes Geld kostet. */
  function bilderKostenlos() {
    const c = S.customer;
    return Boolean(c && c.gradientEnabled && c.accentColor);
  }
  function erwarteteBilder() {
    const st = S.status;
    if (!st) return 0;
    const gesamt = Math.max(st.job?.total || 0, st.posts.length);
    if (S.customer?.emailVerified || bilderKostenlos()) return gesamt;
    return Math.min(st.summary?.limits?.imagesUnverified ?? 3, gesamt);
  }

  function arbeitetHtml() {
    const st = S.status;
    const job = st?.job || { phase: "reading", done: 0, total: 0 };
    const laeuft = !["done", "error", "idle"].includes(job.phase);
    const gefunden = job.found;
    const nachLesen = Boolean(gefunden) || ["colors", "writing", "images", "done"].includes(job.phase);
    const textFertig = !laeuft || (job.total > 0 && job.done >= job.total);
    const bildZiel = erwarteteBilder();
    const bildFertig = st?.imagesDone || 0;
    const bilderFertig = !laeuft && (bildFertig >= bildZiel || bildZiel === 0);
    const langsam = Date.now() - S.arbeitSeit > 7000;
    const schritt = (zustand, titel, unter) => `<li class="step is-${zustand}"><span class="step-mark" aria-hidden="true">${zustand === "done" ? "✓" : ""}</span><span class="step-text"><span>${titel}</span>${unter ? `<span class="step-sub">${unter}</span>` : ""}</span></li>`;
    const farbPunkte = gefunden?.colors
      ? `<span class="step-farben"><span class="step-farbe" style="background:${esc(gefunden.colors.accentColor)}"></span><span class="step-farbe" style="background:${esc(gefunden.colors.gradientColor2)}"></span>${esc(gefunden.colors.accentColor)}</span>`
      : nachLesen ? "Keine eigenen Farben gefunden - wir nehmen unsere Standardfarben." : "";
    return `
      <section>
        <h1>${S.website ? `Wir lesen ${esc(S.website.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))}` : "Wir lesen deine Angaben"}</h1>
        <p class="lede">Das dauert meistens unter einer Minute.</p>
        <ol class="steps" aria-label="Fortschritt">
          ${schritt(nachLesen ? "done" : "active", S.website ? "Website gelesen" : "Beschreibung gelesen", !nachLesen && langsam ? "dauert gerade etwas länger …" : gefunden?.cached ? "aus dem Zwischenspeicher" : "")}
          ${schritt(nachLesen ? "done" : "open", "Themen erkannt", gefunden?.pillars?.length ? esc(gefunden.pillars.join(", ")) : "")}
          ${schritt(nachLesen ? "done" : "open", "Farben übernommen", farbPunkte)}
          ${schritt(textFertig && nachLesen ? "done" : nachLesen ? "active" : "open", "Beiträge entworfen", job.total ? `${job.done} von ${job.total}${!textFertig && langsam ? " · dauert gerade etwas länger …" : ""}` : "")}
          ${schritt(bilderFertig && !S.vorladen ? "done" : (st?.posts?.length ? "active" : "open"), "Bilder erstellt", S.vorladen ? "werden geladen …" : bildZiel ? `${Math.min(bildFertig, bildZiel)} von ${bildZiel}` : "")}
        </ol>
      </section>`;
  }

  /* ================= Die Woche (ohne leere Tage) ================= */
  function wocheHtml(opts = {}) {
    const st = S.status;
    const posts = (st?.posts || []).filter((p) => p.status !== "rejected" && aktiveKanaele().includes(p.channel));
    const laeuft = st?.job && !["done", "error", "idle"].includes(st.job.phase);
    // Nur Tage, an denen wirklich etwas rausgeht. Ein Tag ohne Beitrag erscheint nicht -
    // kein grauer Kasten, kein Platzhalter (Auftrag Abschnitt 5, Abnahme 3).
    const tage = [...new Set(posts.map((p) => p.scheduledFor))].sort();
    if (!tage.length) {
      return laeuft
        ? `<div class="woche" id="woche"><div class="tag"><div class="tag-posts">${aktiveKanaele().map((ch) => skelettHtml(ch)).join("")}</div></div></div>`
        : `<div class="woche" id="woche"><p class="leer">Für die nächsten sieben Tage ist noch nichts geplant.${opts.dashboard ? ` <button type="button" class="link" data-replan>Jetzt planen</button>` : ""}</p></div>`;
    }
    return `<div class="woche" id="woche">${tage.map((tag) => {
      const liste = posts.filter((p) => p.scheduledFor === tag).sort((a, b) => KANAL_REIHE.indexOf(a.channel) - KANAL_REIHE.indexOf(b.channel));
      return `<section class="tag" aria-label="${esc(langDatum(tag))}"><div class="tag-kopf"><strong>${esc(kurzDatum(tag))}</strong><span class="muted">${esc(datumVon(tag).toLocaleDateString("de-AT", { weekday: "long" }))}</span></div><div class="tag-posts">${liste.map((p) => postHtml(p, opts)).join("")}</div></section>`;
    }).join("")}</div>`;
  }

  /* ---------------------------- Layout A: der Wochenstreifen -------------------------------
   * Freigegeben am 19.09.2026. Vorher war der Ergebnisbildschirm eine Liste aus zehn grossen
   * Karten: am Handy 9,2 Bildschirmlaengen, am Schreibtisch 5,5. Man sah nie die Woche,
   * immer nur zwei Beitraege - obwohl die Ueberschrift genau die Woche verspricht.
   *
   * Jetzt: oben eine Reihe mit einer schmalen Karte je Tag, darunter der gewaehlte Tag in
   * voller Groesse mit Bild, Ueberschrift und Text. Der Streifen selbst ist eine kleine Wand
   * aus Markenbildern, der Teil darunter der Beweis, dass die Texte taugen. Beides zusammen
   * passt am Schreibtisch auf einen Bildschirm.
   *
   * Nur der Ergebnisbildschirm. Die Uebersicht im Dashboard bleibt die Liste - dort wird
   * gearbeitet, nicht beeindruckt.
   */
  function tageMitBeitraegen() {
    const posts = (S.status?.posts || []).filter((p) => p.status !== "rejected" && aktiveKanaele().includes(p.channel));
    return { posts, tage: [...new Set(posts.map((p) => p.scheduledFor))].sort() };
  }

  /** Der gerade gezeigte Tag. Faellt auf den ersten zurueck, wenn die Auswahl verschwindet -
   *  etwa weil ein Beitrag uebersprungen wurde oder die Woche neu geschrieben wird. */
  function gewaehlterTag(tage) {
    return tage.includes(S.tagWahl) ? S.tagWahl : tage[0];
  }

  function streifenHtml(posts, tage, aktiv) {
    return `<div class="streifen" role="tablist" aria-label="Tage der Woche">${tage.map((tag) => {
      const liste = posts.filter((p) => p.scheduledFor === tag);
      const erster = liste[0];
      const bild = erster?.imageUrl
        ? `<img src="${esc(erster.imageUrl)}" alt="" loading="lazy">`
        : `<span class="kachel mini" data-kachel style="background:${esc(kachelHintergrund())}"><span class="kachel-h" style="${kachelSchrift()}">${esc(erster?.headline || "")}</span></span>`;
      return `<button type="button" class="tagkarte${tag === aktiv ? " ist-aktiv" : ""}" role="tab" aria-selected="${tag === aktiv}" data-tagwahl="${esc(tag)}">
        <span class="tagname">${esc(kurzDatum(tag))}</span>
        <span class="tagbild">${bild}</span>
        <span class="tagzahl">${liste.length} ${liste.length === 1 ? "Beitrag" : "Beiträge"}</span>
      </button>`;
    }).join("")}</div>`;
  }

  function tagDetailHtml(posts, tage, aktiv) {
    const liste = posts.filter((p) => p.scheduledFor === aktiv).sort((a, b) => KANAL_REIHE.indexOf(a.channel) - KANAL_REIHE.indexOf(b.channel));
    const nr = tage.indexOf(aktiv) + 1;
    return `<section class="tagdetail" aria-live="polite">
      <div class="tagdetail-kopf"><span class="etikett">${esc(langDatum(aktiv))}</span><span class="etikett">Tag ${nr} von ${tage.length}</span></div>
      <div class="tag-posts">${liste.map((p) => postHtml(p)).join("")}</div>
    </section>`;
  }

  function skelettHtml(ch) {
    const meta = KANAL[ch];
    return `<article class="post" aria-busy="true"><div class="post-meta"><span class="chan ${ch}">${esc(meta.label)}</span><span class="status">wird geschrieben …</span></div><div class="media ${meta.format}"><div class="skeleton">Beitrag entsteht gerade</div></div></article>`;
  }

  function postHtml(p, opts = {}) {
    const meta = KANAL[p.channel] || KANAL.ig_feed;
    const c = S.customer;
    const wm = (c && (c.watermarkText || c.company)) || "";
    const medien = p.imageUrl
      ? `<img src="${esc(p.imageUrl)}" alt="Beitragsbild: ${esc(p.headline || "")}" loading="lazy">`
      : `<div class="kachel" data-kachel style="background:${esc(kachelHintergrund())}"><span class="kachel-h" style="${kachelSchrift()}">${esc(p.headline || "")}</span><span class="kachel-wm" style="${kachelSchrift()}">${esc(wm)}</span></div><span class="kachel-notiz">${c?.emailVerified || bilderKostenlos() ? "Bild wird gerade erstellt" : "Bild folgt nach der Bestätigung"}</span>`;
    const statusText = { edited: "von dir bearbeitet", approved: "freigegeben", submitted: "in der Freigabe", published: "veröffentlicht", channel_disconnected: "Kanal getrennt" }[p.status] || "";
    const sortierbar = opts.dashboard && ["planned", "edited", "approved"].includes(p.status);
    const aktionen = opts.dashboard ? `
      <div class="post-actions">
        ${c?.approvalMode && ["planned", "edited"].includes(p.status) ? `<button type="button" class="btn sm" data-freigeben-plan="${esc(p.id)}">Freigeben</button>` : ""}
        ${["planned", "edited", "approved"].includes(p.status) ? `<button type="button" class="link" data-skip-plan="${esc(p.id)}">Überspringen</button>` : ""}
        ${sortierbar ? `<span class="order-btns" role="group" aria-label="Reihenfolge"><button type="button" data-move="up" data-id="${esc(p.id)}" aria-label="Früher">↑</button><button type="button" data-move="down" data-id="${esc(p.id)}" aria-label="Später">↓</button></span><span class="griff" draggable="true" data-drag="${esc(p.id)}" title="Ziehen zum Umsortieren">⠿</span>` : ""}
      </div>` : "";
    return `<article class="post" data-id="${esc(p.id)}" data-channel="${esc(p.channel)}" data-date="${esc(p.scheduledFor)}">
      <div class="post-meta"><span class="chan ${esc(p.channel)}">${esc(meta.label)}</span><span class="status ${p.status === "approved" || p.status === "published" ? "ok" : ""}">${esc(statusText)}</span></div>
      <div class="media ${meta.format}">${medien}</div>
      <div class="post-body">
        <h3 class="post-h">${esc(p.headline || "")}</h3>
        ${p.caption ? `<p class="post-c">${esc(p.caption)}</p><button type="button" class="link post-more" data-more>mehr</button>` : ""}
      </div>${aktionen}</article>`;
  }

  /* ================= Bildschirm 4: das Ergebnis ================= */
  function ergebnisHtml() {
    const st = S.status;
    const sum = st?.summary || {};
    const themen = (sum.pillars || []).map((p) => p.title);
    const quelle = sum.domain ? `auf ${esc(sum.domain)}` : "in deiner Beschreibung";
    const laeuft = st?.job && !["done", "error", "idle"].includes(st.job.phase);
    const offen = laeuft && st.job.total ? Math.max(0, st.job.total - st.job.done) : 0;
    const satz = themen.length >= 2
      ? `Diese Beiträge drehen sich um <strong>${esc(themen[0])}</strong> und <strong>${esc(themen[1])}</strong>, die zwei Themen, die ${quelle} am deutlichsten sind.`
      : themen.length === 1
        ? `Diese Beiträge drehen sich um <strong>${esc(themen[0])}</strong>, das Thema, das ${quelle} am deutlichsten ist.`
        : `Wir haben diese Beiträge aus dem abgeleitet, was ${quelle} steht.`;
    const farbSatz = sum.colors?.gradientEnabled && sum.colors.accentColor
      ? ` Die Farben kommen ebenfalls von dort.`
      : "";
    return `
      <section>
        <h1>So könnte deine nächste Woche aussehen.</h1>
        <p class="lede">${satz}${farbSatz}</p>
        ${offen ? `<p class="lauf-zeile">Noch ${offen} ${offen === 1 ? "Beitrag" : "Beiträge"} in Arbeit - sie erscheinen gleich hier.</p>` : ""}
        ${S.notice ? noticeHtml() : ""}
        ${(() => {
          const { posts, tage } = tageMitBeitraegen();
          if (!tage.length) return wocheHtml();
          const aktiv = gewaehlterTag(tage);
          return streifenHtml(posts, tage, aktiv) + tagDetailHtml(posts, tage, aktiv);
        })()}
        <div class="sticky-actions">
          <button type="button" class="btn lg" data-go="plan">Passt, weiter</button>
          <button type="button" class="link" data-go="anders">Anders machen</button>
        </div>
      </section>`;
  }

  function andersHtml() {
    const limits = S.status?.summary?.limits;
    const bestaetigt = S.customer?.emailVerified;
    return `
      <section class="hero">
        <h1>Was soll anders sein?</h1>
        <p class="lede">Sag es in deinen Worten. Wir schreiben die offenen Beiträge damit neu.</p>
        <form id="f-anders" novalidate>
          <div class="field">
            <label for="wish">Dein Wunsch</label>
            <textarea class="textarea" id="wish" name="wish" rows="3" placeholder="z. B. lockerer im Ton, keine Preise nennen, mehr über das Team" required autofocus></textarea>
            <p class="error" id="err-wish" aria-live="assertive"></p>
          </div>
          <div class="actions"><button class="btn lg" type="submit">Neu erstellen</button></div>
          ${!bestaetigt && limits ? `<p class="hint">Vor der Bestätigung deiner E-Mail-Adresse ist ${limits.adjustUnverified === 1 ? "eine Anpassung" : `${limits.adjustUnverified} Anpassungen`} möglich - danach beliebig viele.</p>` : ""}
          <button type="button" class="link" data-go="ergebnis">Zurück zur Vorschau</button>
        </form>
      </section>`;
  }

  /* ================= Bildschirm 5: der Plan ================= */
  const STIFT = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 2.5l2 2L5 13H3v-2z"/></svg>`;
  function planZeile(id, label, wertHtml, formHtml, notiz) {
    const offen = S.editing === id;
    return `<div class="zeile" id="zeile-${id}">
      <span class="zeile-k">${esc(label)}</span>
      ${offen ? "" : `<div class="zeile-v">${wertHtml}</div><button type="button" class="stift" data-edit="${id}" aria-label="${esc(label)} bearbeiten" aria-expanded="false">${STIFT}</button>`}
      ${offen ? `<form class="zeile-form" data-zeile-form="${id}">${formHtml}<div class="zeile-form-actions"><button class="btn sm" type="submit">Speichern</button><button type="button" class="link" data-cancel-edit style="padding:0 6px">Abbrechen</button><span class="error" data-zeile-fehler aria-live="assertive"></span></div></form>` : ""}
      ${notiz ? `<span class="zeile-notiz">${notiz}</span>` : ""}
    </div>`;
  }

  /** Der bestehende Farbverlaufs-Picker: Akzentfarbe, zweite Farbe, Richtung - inline. */
  function pickerHtml(c) {
    const akzent = c.accentColor || STANDARD_AKZENT;
    const zwei = c.gradientColor2 || "";
    const richtung = c.gradientDirection || "diagonal";
    const an = Boolean(c.gradientEnabled && zwei);
    return `
      <div class="picker">
        <div class="picker-vorschau" id="picker-vorschau" style="background:${esc(kachelHintergrund(c))}">Beispiel</div>
        <div class="picker-gruppe">
          <span>Hauptfarbe</span>
          <div class="swatches" role="group" aria-label="Hauptfarbe wählen">
            ${PALETTE.map((hex) => `<button type="button" class="swatch" data-swatch="accentColor" data-hex="${hex}" aria-pressed="${akzent.toLowerCase() === hex}" style="background:${hex}" aria-label="${hex}"></button>`).join("")}
            <span class="swatch eigene" title="Eigene Farbe"><input type="color" data-pick="accentColor" value="${esc(akzent)}" aria-label="Eigene Hauptfarbe"></span>
          </div>
        </div>
        <label class="schalter"><input type="checkbox" name="gradientEnabled" ${an ? "checked" : ""}><span>Farbverlauf statt einer Farbe</span></label>
        <div class="picker-gruppe" data-nur-verlauf ${an ? "" : "hidden"}>
          <span>Zweite Farbe</span>
          <div class="swatches" role="group" aria-label="Zweite Farbe wählen">
            <span id="partner-vorschlaege"></span>
            <span class="swatch eigene" title="Eigene zweite Farbe"><input type="color" data-pick="gradientColor2" value="${esc(zwei || "#137A3F")}" aria-label="Eigene zweite Farbe"></span>
          </div>
          <span>Richtung</span>
          <div class="richtung" role="group" aria-label="Richtung des Verlaufs">
            ${[["diagonal", "Diagonal"], ["horizontal", "Waagrecht"], ["vertical", "Senkrecht"]].map(([w, l]) => `<button type="button" data-richtung="${w}" aria-pressed="${richtung === w}">${l}</button>`).join("")}
          </div>
        </div>
        <input type="hidden" name="accentColor" value="${esc(akzent)}">
        <input type="hidden" name="gradientColor2" value="${esc(zwei)}">
        <input type="hidden" name="gradientDirection" value="${esc(richtung)}">
        <span class="small muted">Die Karten oben ändern sich sofort mit. Die fertigen Bilder werden nach dem Speichern neu gerendert.</span>
      </div>`;
  }

  /** Verlaufspartner zur aktuellen Hauptfarbe - dieselbe Rechnung wie gradient.ts auf dem Server. */
  function partnerVorschlaege(hex) {
    const [h, s, l] = hexToHsl(hex);
    const sat = Math.max(s, 0.35);
    const hell = l + (0.5 - l) * 0.45;
    return [hslToHex(h + 35, sat, hell), hslToHex(h + 180, sat, hell), hslToHex(h, sat, Math.min(0.92, l + 0.28)), hslToHex(h, sat, Math.max(0.08, l - 0.28))];
  }
  function hexToHsl(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  function hslToHex(h, s, l) {
    const hh = ((h % 360) + 360) % 360, c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
  }

  function planZeilenHtml() {
    const c = S.customer;
    const themen = (c.contentPillars || []).map((p) => p.title);
    const kanaele = aktiveKanaele(c).map((ch) => KANAL[ch].label);
    const stufe = c.features || {};
    return `<div class="plan">
      ${planZeile("firma", "Unternehmen und Branche", `<strong>${esc(c.company)}</strong><br><span class="muted">${esc(c.industry || "Branche noch offen")}</span>`,
        `<label class="small muted" for="e-company">Unternehmen</label><input class="input" id="e-company" name="company" value="${esc(c.company)}" required maxlength="120">
         <label class="small muted" for="e-industry">Branche</label><input class="input" id="e-industry" name="industry" value="${esc(c.industry || "")}" maxlength="120" placeholder="z. B. Physiotherapie">`)}
      ${planZeile("themen", "Themen", themen.length ? themen.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ") : `<span class="muted">Noch keine Themen - wir schreiben allgemein über dein Unternehmen.</span>`,
        `<div class="chips" id="chip-edit">${themen.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-chip-remove="${i}" aria-label="${esc(t)} entfernen">×</button></span>`).join("")}<span class="chip add"><input id="chip-input" placeholder="Thema hinzufügen, Enter" aria-label="Thema hinzufügen" maxlength="60"></span></div>
         <input type="hidden" name="pillars" value="${esc(JSON.stringify(themen))}">`)}
      ${planZeile("kanaele", "Kanäle", kanaele.length ? esc(kanaele.join(", ")) : `<span class="muted">Kein Kanal aktiv</span>`,
        `<div class="wahl">${KANAL_REIHE.map((ch) => `<label><input type="checkbox" name="ch" value="${ch}" ${aktiveKanaele(c).includes(ch) ? "checked" : ""}><span>${esc(KANAL[ch].label)}${ch === "ig_story" ? `<small>24 Stunden sichtbar, ohne Text darunter</small>` : ch === "linkedin" ? `<small>auf deinem persönlichen Profil</small>` : ""}</span></label>`).join("")}</div>`)}
      ${planZeile("rhythmus", "Rhythmus", `${esc(rhythmusText(c))}<br><span class="muted">jeweils um ${esc(c.postTime || "15:00")} Uhr</span>`,
        `<div class="wahl">${Object.entries(RHYTHMUS).map(([k, f]) => `<label><input type="radio" name="frequency" value="${k}" ${(c.activeWeekdays ? c.activeWeekdays === f.tage.join(",") : c.frequency === k) ? "checked" : ""}><span>${esc(f.label)}<small>${esc(f.sub)}</small></span></label>`).join("")}</div>
         <label class="small muted" for="e-time">Uhrzeit</label><input class="input" id="e-time" name="postTime" type="time" value="${esc(c.postTime || "15:00")}" required>
         ${stufe.weekdayMatrix ? "" : `<span class="small muted">Einzelne Wochentage je Kanal gibt es in der nächsten Stufe.</span>`}`)}
      ${planZeile("farbe", "Farbe", `<span class="punkt" style="background:${esc(kachelHintergrund(c))}"></span>${esc((c.accentColor || STANDARD_AKZENT).toUpperCase())}${c.gradientEnabled && c.gradientColor2 ? ` → ${esc(c.gradientColor2.toUpperCase())}` : ""}${S.status?.summary?.colors?.gradientEnabled ? `<br><span class="muted">von deiner Website übernommen</span>` : ""}`,
        pickerHtml(c))}
      ${planZeile("freigabe", "Freigabe", `${c.approvalMode ? "An" : "Aus"}<br><span class="muted">${c.approvalMode ? "Jeder Beitrag wartet auf dein OK, bevor er rausgeht." : "Beiträge gehen zur geplanten Zeit automatisch raus."}</span>`,
        `<label class="schalter"><input type="checkbox" name="approvalMode" ${c.approvalMode ? "checked" : ""}><span>Freigabe an - jeder Beitrag wartet auf dein OK</span></label>
         <span class="small muted">Aus heißt: Beiträge gehen zur geplanten Zeit automatisch raus. Du siehst sie trotzdem vorher in der Übersicht.</span>`)}
    </div>`;
  }

  function planHtml() {
    const st = S.status;
    const posts = (st?.posts || []).filter((p) => p.status !== "rejected").slice(0, 3);
    return `
      <section>
        <h1>Dein Plan</h1>
        <p class="lede">Alles aus deiner Website abgeleitet. Jede Zeile kannst du ändern.</p>
        ${posts.length ? `<div class="tag-posts" id="plan-vorschau" style="margin-top:22px">${posts.map((p) => vorschauKachelHtml(p)).join("")}</div>` : ""}
        ${planZeilenHtml()}
        <div class="actions" style="margin-top:30px"><button type="button" class="btn lg" id="btn-plan-uebernehmen">Plan übernehmen</button></div>
      </section>`;
  }

  /** Kachel im Plan-Bildschirm: IMMER als gerenderte Kachel (nie das fertige Bild), damit die
   *  Farbänderung sofort sichtbar ist - das fertige Bild folgt nach dem Speichern. */
  function vorschauKachelHtml(p) {
    const meta = KANAL[p.channel] || KANAL.ig_feed;
    const c = S.customer;
    const wm = (c && (c.watermarkText || c.company)) || "";
    return `<article class="post"><div class="post-meta"><span class="chan ${esc(p.channel)}">${esc(meta.label)}</span><time>${esc(kurzDatum(p.scheduledFor))}</time></div>
      <div class="media ${meta.format}"><div class="kachel" data-kachel style="background:${esc(kachelHintergrund())}"><span class="kachel-h" style="${kachelSchrift()}">${esc(p.headline || "")}</span><span class="kachel-wm" style="${kachelSchrift()}">${esc(wm)}</span></div></div></article>`;
  }

  /* ================= Bildschirm 6: verbinden ================= */
  const LOGO = {
    instagram: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`,
    linkedin: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M4 3.5A1.5 1.5 0 1 1 4 6.5a1.5 1.5 0 0 1 0-3zM2.8 8h2.4v13H2.8zM9 8h2.3v1.8c.5-.9 1.7-2 3.6-2 3.7 0 4.3 2.4 4.3 5.6V21h-2.4v-6.6c0-1.6 0-3.6-2.2-3.6s-2.5 1.7-2.5 3.5V21H9z"/></svg>`,
    google: `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5h5"/></svg>`,
  };
  /** Die Kanal-Texte kommen vom Server in der Sie-Form des klassischen Panels - hier wird geduzt. */
  const duzen = (t) => String(t ?? "").replace(/\bIhre\b/g, "Deine").replace(/\bIhrem\b/g, "deinem").replace(/\bIhren\b/g, "deinen").replace(/\bIhr\b/g, "Dein").replace(/\bSie\b/g, "du");
  function verbindenKarteHtml(p, imOnboarding) {
    const k = kanal(p.id);
    const uebersprungen = S.skipped.has(p.id);
    const ok = k && k.status === "ok";
    const hinweis = S.notice && S.notice.provider === p.id ? `<p class="small" style="color:${S.notice.kind === "bad" ? "var(--schlecht)" : "var(--gut)"}">${esc(S.notice.text)}</p>` : "";
    let knopf;
    if (ok) knopf = `<p class="connect-state">✓ Verbunden als ${esc(k.accountName || "—")}</p>${!imOnboarding ? `<button type="button" class="link" data-disconnect="${esc(p.id)}">Trennen</button>` : ""}`;
    else if (!p.available) knopf = `<button type="button" class="btn secondary" disabled>${LOGO[p.id] || ""}${esc(p.name)} verbinden</button><p class="connect-state off">${S.sandbox ? "In der Testversion nicht möglich - hier gibt es keine echten Konten." : "Auf diesem Server nicht eingerichtet."}</p>`;
    else knopf = `<a class="btn" href="${esc(MOUNT)}/connect/${esc(p.id)}?return=start">${LOGO[p.id] || ""}${esc(p.name)} verbinden</a>${k ? `<p class="connect-state off">Verbindung ${k.status === "expired" ? "abgelaufen" : k.status === "blocked" ? "blockiert" : "läuft bald ab"} - bitte neu verbinden.</p>` : ""}`;
    return `<div class="connect" id="connect-${esc(p.id)}">
      ${knopf}
      <p class="small muted">${esc(duzen(p.tagline))}${p.notice ? ` ${esc(duzen(p.notice))}` : ""}</p>
      ${hinweis}
      ${!ok && imOnboarding ? (uebersprungen ? `<p class="connect-state off">Später - du findest das jederzeit in den Einstellungen.</p>` : `<button type="button" class="link" data-skip="${esc(p.id)}">Später verbinden</button>`) : ""}
    </div>`;
  }
  function verbindenHtml() {
    const liste = S.providers.filter((p) => p.id !== "google");
    return `
      <section>
        <h1>Kanäle verbinden</h1>
        <p class="lede">Damit Pipeflow veröffentlichen kann. Jeden Kanal kannst du auch später verbinden.</p>
        <div class="connect-liste">${liste.map((p) => verbindenKarteHtml(p, true)).join("")}</div>
        <div class="actions" style="margin-top:30px"><button type="button" class="btn lg" id="btn-zum-dashboard">Zur Übersicht</button></div>
      </section>`;
  }

  /* ================= Dashboard ================= */
  function noticeHtml() {
    const n = S.notice;
    return n ? `<div class="notice ${n.kind || ""}" role="status">${esc(n.text)}</div>` : "";
  }
  function dashboardHtml() {
    const c = S.customer;
    const fehlend = S.providers.filter((p) => p.id !== "google" && !(kanal(p.id) && kanal(p.id).status === "ok"));
    const st = S.status;
    const laeuft = st?.job && !["done", "error", "idle"].includes(st.job.phase);
    return `
      <section>
        <div class="dash-kopf">
          <div><h1>So sehen deine nächsten Tage aus</h1><p class="lede" style="margin-top:8px">${esc(c.company)}</p></div>
          <button type="button" class="btn" id="btn-jetzt-posten">Jetzt posten</button>
        </div>
        ${S.notice ? noticeHtml() : ""}
        ${!c.emailVerified && !c.authProvider ? `<div class="notice" role="status"><strong>Bitte bestätige deine E-Mail-Adresse.</strong> Wir haben einen Link an ${esc(c.email)} geschickt. Erst danach veröffentlichen wir${st?.posts?.some((p) => !p.imageUrl) ? " und erstellen die restlichen Bilder" : ""}.<span><button type="button" class="link" id="verify-neu">Bestätigungsmail erneut senden</button></span></div>` : ""}
        ${fehlend.map((p) => `<div class="notice" role="status">${esc(p.name)} ist noch nicht verbunden - dort kann noch nichts veröffentlicht werden.<span><a class="btn secondary sm" href="${esc(MOUNT)}/connect/${esc(p.id)}?return=start" style="justify-self:start">${esc(p.name)} verbinden</a></span></div>`).join("")}
        ${c.customerPaused ? `<div class="notice bad">Deine Veröffentlichung ist pausiert.<span><button type="button" class="link" data-pause="0">Fortsetzen</button></span></div>` : ""}
        ${laeuft ? `<p class="lauf-zeile">${st.job.kind === "backfill" || st.job.kind === "recolor" ? "Bilder werden erstellt" : "Beiträge werden erstellt"}${st.job.total ? ` - ${st.job.done} von ${st.job.total}` : ""} …</p>` : ""}
        <div class="abschnitt" id="freigaben-abschnitt">${freigabenHtml()}</div>
        <div class="abschnitt">
          <div class="abschnitt-kopf"><h2>Geplant</h2><span class="small muted">Reihenfolge per ↑↓ oder Ziehen</span></div>
          ${wocheHtml({ dashboard: true })}
        </div>
      </section>`;
  }
  function freigabenHtml() {
    const liste = S.approvals || [];
    if (!liste.length) return "";
    return `<div class="abschnitt-kopf"><h2>Wartet auf deine Freigabe</h2><span class="small muted">${liste.length}</span></div>
      <div class="tag-posts">${liste.map((a) => {
        const meta = KANAL[a.channel] || KANAL.ig_feed;
        return `<article class="post" data-approval="${esc(a.id)}">
          <div class="post-meta"><span class="chan ${esc(a.channel)}">${esc(meta.label)}</span><time>${esc(zeitpunkt(a.createdAt))}</time></div>
          <div class="media ${meta.format}">${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="" loading="lazy">` : `<div class="skeleton">Kein Bild</div>`}</div>
          <div class="post-body"><h3 class="post-h">${esc(a.headline || "")}</h3>${a.caption ? `<p class="post-c">${esc(a.caption)}</p><button type="button" class="link post-more" data-more>mehr</button>` : ""}</div>
          <div class="post-actions"><button type="button" class="btn sm" data-freigeben="${esc(a.id)}">Freigeben</button><button type="button" class="link" data-ablehnen="${esc(a.id)}">Ablehnen</button></div>
        </article>`;
      }).join("")}</div>`;
  }

  function einstellungenHtml() {
    const c = S.customer;
    const liste = S.providers.filter((p) => p.id !== "google" || p.available);
    return `
      <section>
        <h1>Einstellungen</h1>
        <p class="lede">Dein Plan, deine Kanäle, deine veröffentlichten Beiträge. Alles Weitere findest du im klassischen Panel.</p>
        ${S.notice ? noticeHtml() : ""}
        ${planZeilenHtml()}
        <div class="zeile" id="zeile-anders"><span class="zeile-k">Ausrichtung ändern</span><div class="zeile-v"><span class="muted">In eigenen Worten sagen, was anders sein soll - wir schreiben die offenen Beiträge neu.</span></div><button type="button" class="stift" data-go="anders" aria-label="Ausrichtung ändern">${STIFT}</button></div>
        <div class="abschnitt" id="verbinden"><div class="abschnitt-kopf"><h2>Kanäle</h2></div><div class="connect-liste">${liste.map((p) => verbindenKarteHtml(p, false)).join("")}</div></div>
        <div class="abschnitt"><div class="abschnitt-kopf"><h2>Veröffentlicht</h2></div>${S.verlauf === null ? `<p class="leer">Wird geladen …</p>` : verlaufHtml()}</div>
        <div class="abschnitt">
          <div class="abschnitt-kopf"><h2>Konto</h2></div>
          <div class="plan">
            <div class="zeile"><span class="zeile-k">Anmeldung</span><div class="zeile-v">${c.authProvider ? `über ${esc(c.authProvider.charAt(0).toUpperCase() + c.authProvider.slice(1))}` : "über E-Mail"}<br><span class="muted">${esc(c.email)}</span>${c.authProvider || c.emailVerified ? ` <span class="small" style="color:var(--gut)">bestätigt</span>` : ` <span class="small" style="color:var(--schlecht)">noch nicht bestätigt</span> <button type="button" class="link" id="verify-neu">erneut senden</button>`}</div></div>
            <div class="zeile"><span class="zeile-k">Veröffentlichung</span><div class="zeile-v">${c.customerPaused ? "Pausiert" : "Aktiv"}</div><button type="button" class="btn secondary sm" data-pause="${c.customerPaused ? 0 : 1}" style="align-self:center">${c.customerPaused ? "Fortsetzen" : "Pausieren"}</button></div>
            <div class="zeile"><span class="zeile-k">Mehr</span><div class="zeile-v"><a href="${esc(MOUNT)}/?classic=1">Klassisches Panel öffnen</a><br><span class="small muted">Wochentagsplanung, Farbthemen, Formate, Analytics, Kommentare - alles bleibt dort erreichbar.</span></div></div>
            <div class="zeile"><span class="zeile-k">Abmelden</span><div class="zeile-v"><button type="button" class="link" id="abmelden">Auf diesem Gerät abmelden</button></div></div>
          </div>
        </div>
      </section>`;
  }
  function verlaufHtml() {
    const liste = S.verlauf || [];
    if (!liste.length) return `<p class="leer">Noch nichts veröffentlicht. Sobald der erste Beitrag draußen ist, steht er hier.</p>`;
    return `<ul class="verlauf">${liste.slice(0, 20).map((p) => `<li>${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}<span><strong style="font-weight:500">${esc(p.headline || "(ohne Titel)")}</strong><br><span class="small muted">${esc(KANAL[p.channel]?.label || p.provider || "")} · ${esc(zeitpunkt(p.postedAt))}</span></span></li>`).join("")}</ul>`;
  }
  function fehlerHtml() {
    return `<section class="mitte"><h1>Das hat nicht geklappt</h1><p class="lede" style="margin:14px auto 0">${esc(S.fehlerText || "Bitte versuche es noch einmal.")}</p><div class="actions"><button type="button" class="btn" data-go="${S.customer ? "website" : "konto"}">Noch einmal versuchen</button></div></section>`;
  }

  /* ================= Turnstile ================= */
  function renderTurnstile() {
    const slot = $("#turnstile-slot");
    if (!slot || !S.turnstileSiteKey) return;
    const einbauen = () => {
      if (!window.turnstile || !slot.isConnected) return;
      slot.innerHTML = "";
      S.turnstileToken = "";
      S.turnstileWidget = window.turnstile.render(slot, {
        sitekey: S.turnstileSiteKey, appearance: "interaction-only", theme: "light",
        callback: (t) => { S.turnstileToken = t; },
        "expired-callback": () => { S.turnstileToken = ""; },
        "error-callback": () => { S.turnstileToken = ""; },
      });
    };
    if (window.turnstile) { einbauen(); return; }
    if (!$("#turnstile-script")) {
      const s = document.createElement("script");
      s.id = "turnstile-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = einbauen;
      document.head.appendChild(s);
    }
  }
  const turnstileToken = () => { try { return S.turnstileToken || (S.turnstileWidget != null && window.turnstile ? window.turnstile.getResponse(S.turnstileWidget) : "") || ""; } catch { return S.turnstileToken || ""; } };
  async function aufTurnstileWarten() {
    if (!S.turnstileSiteKey || (S.customer && S.customer.authProvider)) return "";
    const frist = Date.now() + 8000;
    while (Date.now() < frist) {
      const t = turnstileToken();
      if (t) return t;
      await new Promise((r) => setTimeout(r, 200));
    }
    return "";
  }

  /* ================= Fortschritt ================= */
  async function statusHolen() {
    try {
      const daten = await api("GET", "/api/start/status");
      S.status = daten;
      uebernehmen(daten);
      return daten;
    } catch (err) {
      if (err.status === 401) { S.customer = null; go("konto"); }
      return null;
    }
  }
  /* ----------------------- Der Ergebnisbildschirm erscheint fertig -------------------------
   * Vorher wurde umgeschaltet, sobald EIN Beitrag existierte - der Rest tropfte danach in die
   * Seite, Karte fuer Karte, und die Woche sprang bei jedem Nachzuegler. Das sah kaputt aus,
   * auf beiden Bildschirmgroessen (Ansage vom 19.09.2026).
   *
   * Jetzt wird gewartet, bis der Lauf fertig ist UND jedes Bild da ist, und danach werden die
   * Bilder noch im Hintergrund geladen, bevor der Bildschirm kommt. Sonst waere das Popp-Problem
   * nur verschoben: der Server meldet fertig, der Browser laedt aber erst beim Anzeigen.
   *
   * Zwei Notbremsen, damit ein einzelnes haengendes Bild nie den ganzen Bildschirm blockiert.
   */
  /** Gesamtdeckel ab dem Klick auf "Vorschau erstellen". */
  const MAX_WARTEN_MS = 75_000;
  /** Nachfrist ab dem Moment, in dem der Lauf fertig gemeldet ist, aber Bilder fehlen. */
  const NACHFRIST_MS = 15_000;
  /** Wie lange der Browser hoechstens auf die Bilddateien selbst wartet. */
  const VORLADEN_MS = 9_000;

  function alleBilderDa(daten) {
    // Solange noch geschrieben wird, ist NICHTS vollstaendig - auch wenn der eine Beitrag, der
    // schon da ist, zufaellig sein Bild hat. Genau daran ist der erste Anlauf gescheitert: der
    // Bildschirm kam mit einem einzigen Tag und fuellte sich danach sichtbar auf.
    const job = daten.job || {};
    if (!["done", "error", "idle"].includes(job.phase)) return false;
    const posts = (daten.posts || []).filter((p) => p.status !== "rejected");
    if (!posts.length) return false;
    // Ohne erkannte Markenfarben bekommen unbestaetigte Konten absichtlich nur die ersten
    // Bilder - dann ist "alle da" erreicht, sobald es nicht mehr wird.
    const ziel = erwarteteBilder();
    return posts.filter((p) => p.imageUrl).length >= Math.min(ziel, posts.length);
  }

  /** Laedt die Bilder in den Browser-Zwischenspeicher. Wartet hoechstens VORLADEN_MS - ein
   *  langsames Bild darf den Bildschirm verzoegern, aber nicht verhindern. */
  function bilderVorladen(urls) {
    if (!urls.length) return Promise.resolve();
    return new Promise((fertig) => {
      let offen = urls.length;
      const ab = setTimeout(fertig, VORLADEN_MS);
      const eins = () => { if (--offen <= 0) { clearTimeout(ab); fertig(); } };
      for (const u of urls) {
        const bild = new Image();
        bild.onload = eins;
        bild.onerror = eins;
        bild.src = u;
      }
    });
  }

  async function zumErgebnis(daten) {
    S.poll = null;
    const urls = (daten.posts || []).map((p) => p.imageUrl).filter(Boolean);
    if (urls.length) {
      // Der letzte Schritt bekommt seine eigene Zeile, damit der Ladezustand auch in diesen
      // Sekunden sichtbar arbeitet und nicht einfach steht.
      S.vorladen = true;
      render();
      await bilderVorladen(urls);
      S.vorladen = false;
    }
    S.wochenSig = wochenSignatur();
    go("ergebnis");
  }

  function pollStarten() {
    if (S.poll) return;
    S.poll = -1;
    const tick = async () => {
      const daten = await statusHolen();
      if (!daten) { pollStoppen(); return; }
      const job = daten.job || {};
      const laeuft = !["done", "error", "idle"].includes(job.phase);
      if (S.screen === "arbeitet") {
        if (job.phase === "error" && !daten.posts.length) { S.fehlerText = job.message || "Die Beiträge konnten nicht erstellt werden."; S.poll = null; go("fehler"); return; }
        if (!laeuft && !daten.posts.length && job.phase === "idle") { S.fehlerText = "Die Vorbereitung wurde unterbrochen."; S.poll = null; go("fehler"); return; }
        if (!laeuft && !S.jobFertigSeit) S.jobFertigSeit = Date.now();
        const zuLange = Date.now() - S.arbeitSeit > MAX_WARTEN_MS
          || (S.jobFertigSeit && Date.now() - S.jobFertigSeit > NACHFRIST_MS);
        if (daten.posts.length && (alleBilderDa(daten) || zuLange)) { await zumErgebnis(daten); return; }
        render();
      } else if (S.screen === "ergebnis" || S.screen === "dashboard") {
        const sig = wochenSignatur();
        if (sig !== S.wochenSig) { S.wochenSig = sig; wocheAktualisieren(); }
        S.leerlauf = laeuft ? 0 : S.leerlauf + 1;
        const wartetAufBilder = daten.posts.some((p) => !p.imageUrl) && S.customer?.emailVerified;
        if (!laeuft && (!wartetAufBilder || S.leerlauf > 15)) { pollStoppen(); return; }
      }
      if (S.poll) S.poll = setTimeout(tick, laeuft ? 1500 : 4000);
    };
    S.poll = setTimeout(tick, 400);
  }
  function pollStoppen() { if (S.poll) { if (S.poll !== -1) clearTimeout(S.poll); S.poll = null; } }
  /** Nur die Woche neu zeichnen, damit ein offenes Inline-Feld oder ein aufgeklappter Text nicht
   *  verschwindet, wenn im Hintergrund ein Beitrag fertig wird. */
  /** Was sich an der Woche ueberhaupt aendern kann. Ist die Zeichenkette gleich geblieben,
   *  wird nichts angefasst - sonst zeichnete jeder Abruf neu, und die Seite zuckte. */
  function wochenSignatur() {
    const st = S.status;
    return JSON.stringify({
      phase: st?.job?.phase ?? "", done: st?.job?.done ?? 0, total: st?.job?.total ?? 0,
      posts: (st?.posts || []).map((p) => `${p.id}|${p.status}|${p.imageUrl ? 1 : 0}|${p.headline || ""}`),
    });
  }

  function wocheAktualisieren() {
    // Ergebnisbildschirm: Streifen und Tagesdetail an Ort und Stelle tauschen. Ein voller
    // render() waere hier falsch - er warf die Seite neu auf und liess sie sichtbar springen.
    const streifen = $(".streifen");
    if (streifen && S.screen === "ergebnis") {
      const { posts, tage } = tageMitBeitraegen();
      if (!tage.length) { render(); return; }
      const aktiv = gewaehlterTag(tage);
      const offen = new Set($$(".post.is-open").map((el) => el.dataset.id));
      const tmp = document.createElement("div");
      tmp.innerHTML = streifenHtml(posts, tage, aktiv) + tagDetailHtml(posts, tage, aktiv);
      const neuerStreifen = tmp.querySelector(".streifen");
      const neuesDetail = tmp.querySelector(".tagdetail");
      const altesDetail = $(".tagdetail");
      if (neuerStreifen) streifen.replaceWith(neuerStreifen);
      if (neuesDetail && altesDetail) altesDetail.replaceWith(neuesDetail);
      offen.forEach((id) => $(`.post[data-id="${CSS.escape(id)}"]`)?.classList.add("is-open"));
      return;
    }
    const woche = $("#woche");
    if (!woche) { render(); return; }
    const offen = new Set($$(".post.is-open", woche).map((el) => el.dataset.id));
    const tmp = document.createElement("div");
    tmp.innerHTML = wocheHtml({ dashboard: S.screen === "dashboard" });
    woche.replaceWith(tmp.firstElementChild);
    offen.forEach((id) => $(`.post[data-id="${CSS.escape(id)}"]`)?.classList.add("is-open"));
    const zeile = $(".lauf-zeile");
    const job = S.status?.job;
    const laeuft = job && !["done", "error", "idle"].includes(job.phase);
    if (zeile && !laeuft) zeile.remove();
    else if (zeile && job.total) zeile.textContent = S.screen === "dashboard" ? `${job.kind === "backfill" || job.kind === "recolor" ? "Bilder werden erstellt" : "Beiträge werden erstellt"} - ${job.done} von ${job.total} …` : `Noch ${Math.max(0, job.total - job.done)} ${job.total - job.done === 1 ? "Beitrag" : "Beiträge"} in Arbeit - sie erscheinen gleich hier.`;
  }

  async function dashboardNachladen() {
    if (!S.customer?.approvalMode) { S.approvals = []; return; }
    try {
      const { approvals } = await api("GET", "/api/approvals");
      S.approvals = approvals || [];
      const sec = $("#freigaben-abschnitt");
      if (sec) sec.innerHTML = freigabenHtml();
    } catch { /* Abschnitt bleibt leer */ }
  }
  async function verlaufLaden() {
    try { const { posts } = await api("GET", "/api/posts"); S.verlauf = posts || []; } catch { S.verlauf = []; }
    if (S.screen === "einstellungen") render();
  }

  /* ================= Aktionen ================= */
  function feldFehler(id, text) {
    const el = $(`#err-${id}`);
    const feld = $(`#${id}`);
    if (el) el.textContent = text || "";
    if (feld) feld.setAttribute("aria-invalid", text ? "true" : "false");
  }
  function beschaeftigt(btn, an, label) {
    if (!btn) return;
    if (an) { btn.dataset.label = btn.textContent; btn.textContent = label || "Einen Moment …"; btn.classList.add("is-busy"); }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.classList.remove("is-busy"); }
  }

  async function emailAbsenden(form, modus) {
    const email = form.email.value.trim();
    feldFehler("email", "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { feldFehler("email", "Das sieht nicht nach einer E-Mail-Adresse aus. Bitte prüfe die Eingabe."); return; }
    S.email = email;
    const btn = $("button[type=submit]", form);
    beschaeftigt(btn, true, "Wird geprüft …");
    try {
      const r = await api("POST", "/api/start/email", modus ? { email, modus } : { email });
      if (r.status === "known") { S.mailGeschickt = r.mailed; go("gesendet"); return; }
      uebernehmen(r);
      go("website");
    } catch (err) {
      beschaeftigt(btn, false);
      feldFehler("email", err.message);
      // Unbekannte Adresse im Anmelde-Bildschirm: der Weg nach vorn ist ein neues Konto.
      if (err.data?.unbekannt) {
        const box = $("#err-email");
        if (box) box.innerHTML += ` <button type="button" class="link auth-link" data-go="email">Konto anlegen</button>`;
      }
    }
  }

  async function vorschauAbsenden(form, art) {
    const btn = $("#btn-vorschau", form);
    S.grenze = null;
    const body = {};
    if (art === "website") {
      const website = form.website.value.trim();
      feldFehler("website", "");
      if (!website || !/[a-z0-9-]+\.[a-z]{2,}/i.test(website)) { feldFehler("website", "Bitte gib eine Adresse wie deine-firma.at ein."); return; }
      S.website = website; body.website = website;
    } else {
      const beschreibung = form.description.value.trim();
      feldFehler("description", "");
      if (beschreibung.length < 12) { feldFehler("description", "Ein, zwei Sätze reichen - aber ein bisschen mehr als das brauchen wir."); return; }
      S.beschreibung = beschreibung; S.website = ""; body.description = beschreibung;
    }
    beschaeftigt(btn, true, art === "website" ? "Website wird gelesen …" : "Wird gelesen …");
    const token = await aufTurnstileWarten();
    if (token) body["cf-turnstile-response"] = token;
    else if (S.turnstileSiteKey && S.customer && !S.customer.authProvider) {
      beschaeftigt(btn, false);
      feldFehler(art === "website" ? "website" : "description", "Die Sicherheitsprüfung ist noch nicht durch. Bitte kurz warten und noch einmal tippen.");
      return;
    }
    S.arbeitSeit = Date.now();
    S.jobFertigSeit = 0;
    try {
      const r = await api("POST", "/api/start/preview", body);
      uebernehmen(r);
      S.status = { job: { phase: "reading", done: 0, total: 0 }, posts: [], summary: S.status?.summary, imagesDone: 0, window: {} };
      go("arbeitet");
    } catch (err) {
      beschaeftigt(btn, false);
      if (err.data?.ready) { go("ergebnis"); return; }
      if (err.data?.limit) { S.grenze = { text: err.message, reason: err.data.reason }; render(); }
      else feldFehler(art === "website" ? "website" : "description", err.message);
      if (window.turnstile && S.turnstileWidget != null) { try { window.turnstile.reset(S.turnstileWidget); } catch { /* egal */ } }
    }
  }

  async function kiVerbessern() {
    const btn = $("#ki-verbessern");
    const feld = $("#description");
    const text = feld.value.trim();
    feldFehler("description", "");
    if (text.length < 8) { feldFehler("description", "Schreib zuerst ein paar Stichworte, dann macht die KI einen Absatz daraus."); return; }
    beschaeftigt(btn, true, "Wird verbessert …");
    try {
      const { suggestion } = await api("POST", "/api/improve-briefing", { company: S.customer?.company || "", industry: "", about: text });
      feld.value = suggestion;
      S.beschreibung = suggestion;
      feld.focus();
      toast("Vorschlag übernommen - du kannst ihn weiter bearbeiten.");
    } catch (err) {
      feldFehler("description", err.message);
    } finally {
      beschaeftigt(btn, false);
    }
  }

  async function andersAbsenden(form) {
    const wish = form.wish.value.trim();
    feldFehler("wish", "");
    if (!wish) { feldFehler("wish", "Sag uns in ein paar Worten, was anders sein soll."); return; }
    const btn = $("button[type=submit]", form);
    beschaeftigt(btn, true, "Wird übersetzt …");
    try {
      await api("POST", "/api/start/adjust", { wish });
      S.arbeitSeit = Date.now();
      S.status = { ...(S.status || {}), job: { phase: "writing", done: 0, total: 0, kind: "adjust" } };
      toast("Verstanden - die Woche wird neu geschrieben.");
      go(eingerichtet() ? "dashboard" : "arbeitet");
    } catch (err) {
      beschaeftigt(btn, false);
      feldFehler("wish", err.message);
    }
  }

  async function zeileSpeichern(form) {
    const id = form.dataset.zeileForm;
    const fehlerEl = $("[data-zeile-fehler]", form);
    const patch = {};
    if (id === "firma") { patch.company = form.company.value.trim(); patch.industry = form.industry.value.trim(); if (!patch.company) { fehlerEl.textContent = "Der Firmenname darf nicht leer sein."; return; } }
    if (id === "themen") { const titel = JSON.parse(form.pillars.value || "[]"); const alt = S.customer.contentPillars || []; patch.contentPillars = titel.map((t) => ({ title: t, description: alt.find((p) => p.title === t)?.description || "", weight: 1 })); }
    if (id === "kanaele") { const an = $$("input[name=ch]:checked", form).map((i) => i.value); if (!an.length) { fehlerEl.textContent = "Bitte mindestens einen Kanal auswählen."; return; } patch.igFeedEnabled = an.includes("ig_feed"); patch.igStoryEnabled = an.includes("ig_story"); patch.linkedinEnabled = an.includes("linkedin"); }
    if (id === "rhythmus") { const f = $("input[name=frequency]:checked", form)?.value; if (!f) { fehlerEl.textContent = "Bitte einen Rhythmus wählen."; return; } patch.frequency = f; patch.activeWeekdays = ""; patch.instagramWeekdays = ""; patch.linkedinWeekdays = ""; patch.postTime = form.postTime.value || "15:00"; }
    if (id === "farbe") {
      patch.accentColor = form.accentColor.value;
      patch.gradientEnabled = form.gradientEnabled.checked;
      patch.gradientColor2 = form.gradientColor2.value;
      patch.gradientDirection = form.gradientDirection.value;
      if (patch.gradientEnabled && !patch.gradientColor2) { fehlerEl.textContent = "Bitte eine zweite Farbe wählen oder den Verlauf ausschalten."; return; }
    }
    if (id === "freigabe") { patch.approvalMode = form.approvalMode.checked; }
    const btn = $("button[type=submit]", form);
    beschaeftigt(btn, true, "Speichern …");
    try {
      const r = await api("PATCH", "/api/me", patch);
      uebernehmen(r);
      S.editing = null;
      const strukturell = id === "kanaele" || id === "rhythmus";
      render();
      if (id === "farbe") { try { await api("POST", "/api/start/recolor"); pollStarten(); toast("Farbe gespeichert - die Bilder werden neu gerendert."); } catch { toast("Farbe gespeichert."); } }
      else toast("Gespeichert.");
      if (strukturell) { try { await api("POST", "/api/start/replan"); pollStarten(); } catch { /* nichts Neues zu planen */ } }
    } catch (err) {
      beschaeftigt(btn, false);
      fehlerEl.textContent = err.message;
    }
  }

  /** Live-Vorschau im Plan-Bildschirm: Kacheln oben und die Picker-Vorschau ziehen sofort mit. */
  function farbVorschauAktualisieren(form) {
    const q = {
      accentColor: form.accentColor.value,
      gradientEnabled: form.gradientEnabled.checked,
      gradientColor2: form.gradientColor2.value,
      gradientDirection: form.gradientDirection.value,
    };
    const hg = kachelHintergrund(S.customer, q);
    $$("[data-kachel]").forEach((el) => { el.style.background = hg; });
    // Das Licht im Seitenhintergrund zieht live mit, sonst passt es nach dem Speichern nicht mehr.
    const rgb = (hex) => { const n = parseInt(String(hex || "").slice(1), 16); return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", ") : null; };
    const a1 = rgb(q.accentColor);
    if (a1 && q.gradientEnabled) {
      const zahlen = (t) => t.split(",").map((x) => Number(x.trim()));
      const st = lichtStaerke(zahlen(a1));
      document.documentElement.style.setProperty("--licht-1", `rgba(${a1}, ${st})`);
      document.documentElement.style.setProperty("--licht-2", `rgba(${rgb(q.gradientColor2) || a1}, ${Math.round(st * 720) / 1000})`);
      document.documentElement.style.setProperty("--licht-3", `rgba(${a1}, ${Math.round(st * 360) / 1000})`);
    }
    const v = $("#picker-vorschau", form);
    if (v) v.style.background = hg;
    const box = $("#partner-vorschlaege", form);
    if (box) {
      const aktuell = (form.gradientColor2.value || "").toLowerCase();
      box.innerHTML = partnerVorschlaege(q.accentColor).map((h) => `<button type="button" class="swatch" data-swatch="gradientColor2" data-hex="${h}" aria-pressed="${aktuell === h.toLowerCase()}" style="background:${h}" aria-label="${h}"></button>`).join("");
    }
    const nurVerlauf = $("[data-nur-verlauf]", form);
    if (nurVerlauf) nurVerlauf.hidden = !q.gradientEnabled;
  }

  async function planUebernehmen() {
    const btn = $("#btn-plan-uebernehmen");
    beschaeftigt(btn, true, "Wird übernommen …");
    try {
      const r = await api("POST", "/api/tour-done");
      uebernehmen(r);
      try { await api("POST", "/api/start/replan"); } catch { /* nichts Neues */ }
      go("verbinden");
    } catch (err) { beschaeftigt(btn, false); toast(err.message, "bad"); }
  }

  function jetztPostenOeffnen() {
    const c = S.customer;
    const kanaele = aktiveKanaele(c);
    const offen = new Set((c.postRequests || []).filter((r) => r.status === "pending").map((r) => r.channel));
    $("#sheet-title").textContent = "Jetzt posten";
    $("#sheet-body").innerHTML = `
      <p class="small muted">Ein zusätzlicher Beitrag, außerhalb des Plans. Er wird in den nächsten Minuten erstellt${c.approvalMode ? " und wartet dann auf deine Freigabe" : " und veröffentlicht"}.</p>
      <form id="f-jetzt">
        <div class="wahl">${kanaele.map((ch) => `<label><input type="checkbox" name="ch" value="${ch}" ${offen.has(ch) ? "disabled" : kanaele.length === 1 ? "checked" : ""}><span>${esc(KANAL[ch].label)}${offen.has(ch) ? `<small>schon angefragt</small>` : ""}</span></label>`).join("")}</div>
        <div class="field" style="margin-top:14px"><label for="topic">Thema <span class="muted">(optional)</span></label><input class="input" id="topic" name="topic" maxlength="300" placeholder="z. B. unser neues Angebot ab Oktober"></div>
        <p class="error" id="err-topic" aria-live="assertive"></p>
        <div class="actions" style="margin-top:16px"><button class="btn lg" type="submit">Jetzt posten</button></div>
      </form>`;
    $("#sheet-overlay").hidden = false;
  }
  function sheetSchliessen() {
    const overlay = $("#sheet-overlay");
    overlay.hidden = true;
    // War es das Farbblatt, muss auch die Zeile wieder zugehen - sonst bleibt sie offen
    // zurueck und das Blatt springt beim naechsten Rendern wieder hoch.
    if (overlay.classList.contains("halb")) {
      overlay.classList.remove("halb");
      document.body.classList.remove("blatt-offen");
      $("#sheet-body").innerHTML = "";
      if (S.editing === "farbe") { S.editing = null; render(); }
    }
  }

  async function jetztPostenAbsenden(form) {
    const kanaele = $$("input[name=ch]:checked", form).map((i) => i.value);
    feldFehler("topic", "");
    if (!kanaele.length) { feldFehler("topic", "Bitte mindestens einen Kanal auswählen."); return; }
    const btn = $("button[type=submit]", form);
    beschaeftigt(btn, true, "Wird angefragt …");
    try {
      const r = await api("POST", "/api/post-now", { channels: kanaele, topic: form.topic.value.trim(), format: "single" });
      uebernehmen(r);
      sheetSchliessen();
      S.notice = { kind: "ok", text: `Angefragt für ${kanaele.map((ch) => KANAL[ch].label).join(" und ")}. Der Beitrag entsteht in den nächsten Minuten${S.customer.approvalMode ? " und erscheint dann oben zur Freigabe" : ""}.` };
      render();
    } catch (err) { beschaeftigt(btn, false); feldFehler("topic", err.message); }
  }

  /* ---- Reihenfolge ---- */
  function kanalReihenfolge(channel) {
    return $$(`#woche .post[data-channel="${channel}"]`).filter((el) => ["planned", "edited", "approved"].includes(S.status.posts.find((p) => p.id === el.dataset.id)?.status)).map((el) => el.dataset.id);
  }
  async function umsortieren(channel, ids) {
    try {
      const { posts } = await api("POST", "/api/planned-posts/reorder", { channel, ids });
      posts.forEach((u) => { const i = S.status.posts.findIndex((p) => p.id === u.id); if (i >= 0) S.status.posts[i] = u; });
      wocheAktualisieren();
      toast("Reihenfolge gespeichert.");
    } catch (err) { toast(err.message, "bad"); wocheAktualisieren(); }
  }
  function verschieben(id, richtung) {
    const el = $(`#woche .post[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const ids = kanalReihenfolge(el.dataset.channel);
    const i = ids.indexOf(id);
    const j = richtung === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    umsortieren(el.dataset.channel, ids);
  }
  let zieht = null;
  document.addEventListener("dragstart", (e) => {
    const griff = e.target.closest?.("[data-drag]");
    if (!griff) return;
    zieht = griff.dataset.drag;
    griff.closest(".post").classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", zieht); } catch { /* egal */ }
  });
  document.addEventListener("dragover", (e) => {
    if (!zieht) return;
    const ziel = e.target.closest?.(".post[data-id]");
    const quelle = $(`#woche .post[data-id="${CSS.escape(zieht)}"]`);
    if (!ziel || !quelle || ziel === quelle || ziel.dataset.channel !== quelle.dataset.channel) return;
    e.preventDefault();
    $$("#woche .post.is-over").forEach((el) => el.classList.remove("is-over"));
    ziel.classList.add("is-over");
  });
  document.addEventListener("drop", (e) => {
    if (!zieht) return;
    const ziel = e.target.closest?.(".post[data-id]");
    const quelle = $(`#woche .post[data-id="${CSS.escape(zieht)}"]`);
    $$("#woche .post.is-over, #woche .post.is-dragging").forEach((el) => el.classList.remove("is-over", "is-dragging"));
    if (!ziel || !quelle || ziel === quelle || ziel.dataset.channel !== quelle.dataset.channel) { zieht = null; return; }
    e.preventDefault();
    const ids = kanalReihenfolge(quelle.dataset.channel);
    const von = ids.indexOf(quelle.dataset.id);
    const nach = ids.indexOf(ziel.dataset.id);
    if (von < 0 || nach < 0) { zieht = null; return; }
    ids.splice(von, 1);
    ids.splice(nach, 0, quelle.dataset.id);
    zieht = null;
    umsortieren(quelle.dataset.channel, ids);
  });
  document.addEventListener("dragend", () => { $$("#woche .post.is-over, #woche .post.is-dragging").forEach((el) => el.classList.remove("is-over", "is-dragging")); zieht = null; });

  /* ================= Ereignisse ================= */
  document.addEventListener("submit", (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.id === "f-email") emailAbsenden(form);
    else if (form.id === "f-anmelden") emailAbsenden(form, "anmelden");
    else if (form.id === "f-website") vorschauAbsenden(form, "website");
    else if (form.id === "f-beschreibung") vorschauAbsenden(form, "beschreibung");
    else if (form.id === "f-anders") andersAbsenden(form);
    else if (form.dataset.zeileForm) zeileSpeichern(form);
    else if (form.id === "f-jetzt") jetztPostenAbsenden(form);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet-overlay").hidden) sheetSchliessen();
    if (e.key === "Enter" && e.target.id === "chip-input") { e.preventDefault(); chipHinzu(e.target); }
  });
  function chipHinzu(input) {
    const form = input.closest("form");
    const liste = JSON.parse(form.pillars.value || "[]");
    const t = input.value.trim().slice(0, 60);
    if (!t || liste.includes(t) || liste.length >= 6) { input.value = ""; return; }
    liste.push(t);
    form.pillars.value = JSON.stringify(liste);
    input.value = "";
    chipsNeu(form);
  }
  function chipsNeu(form) {
    const liste = JSON.parse(form.pillars.value || "[]");
    const box = $("#chip-edit", form);
    box.innerHTML = `${liste.map((t, i) => `<span class="chip">${esc(t)}<button type="button" data-chip-remove="${i}" aria-label="${esc(t)} entfernen">×</button></span>`).join("")}<span class="chip add"><input id="chip-input" placeholder="Thema hinzufügen, Enter" aria-label="Thema hinzufügen" maxlength="60"></span>`;
    $("#chip-input", form).focus();
  }

  document.addEventListener("input", (e) => {
    const pick = e.target.closest?.("[data-pick]");
    if (pick) {
      const form = pick.closest("form");
      form[pick.dataset.pick].value = pick.value;
      if (pick.dataset.pick === "gradientColor2") form.gradientEnabled.checked = true;
      farbVorschauAktualisieren(form);
    }
    if (e.target.name === "gradientEnabled") {
      const form = e.target.closest("form");
      if (e.target.checked && !form.gradientColor2.value) form.gradientColor2.value = partnerVorschlaege(form.accentColor.value)[0];
      farbVorschauAktualisieren(form);
    }
  });

  document.addEventListener("click", async (e) => {
    const t = e.target;
    const gehe = t.closest("[data-go]");
    if (gehe) {
      e.preventDefault();
      const ziel = gehe.dataset.go;
      if (ziel === "home") { go(angemeldet() ? (eingerichtet() ? "dashboard" : "ergebnis") : "konto"); return; }
      if (ziel === "dashboard" && !eingerichtet()) { go("plan"); return; }
      go(ziel);
      return;
    }
    const tagKarte = t.closest("[data-tagwahl]");
    if (tagKarte) { S.tagWahl = tagKarte.dataset.tagwahl; render(); return; }
    if (t.closest("#test-neu")) { testNeu(); return; }
    if (t.closest("#test-ende")) { testEnde(); return; }
    if (t.closest("#ki-verbessern")) { kiVerbessern(); return; }
    if (t.closest("[data-more]")) { const post = t.closest(".post"); post.classList.toggle("is-open"); t.closest("[data-more]").textContent = post.classList.contains("is-open") ? "weniger" : "mehr"; return; }
    const stift = t.closest("[data-edit]");
    if (stift) {
      S.editing = stift.dataset.edit;
      render();
      const form = $(`[data-zeile-form="${S.editing}"]`);
      if (S.editing === "farbe" && form) farbVorschauAktualisieren(form);
      $(`#zeile-${S.editing} input, #zeile-${S.editing} textarea`)?.focus();
      return;
    }
    if (t.closest("[data-cancel-edit]")) { S.editing = null; render(); return; }
    const chipWeg = t.closest("[data-chip-remove]");
    if (chipWeg) { const form = chipWeg.closest("form"); const liste = JSON.parse(form.pillars.value || "[]"); liste.splice(Number(chipWeg.dataset.chipRemove), 1); form.pillars.value = JSON.stringify(liste); chipsNeu(form); return; }
    const sw = t.closest("[data-swatch]");
    if (sw) {
      const form = sw.closest("form");
      form[sw.dataset.swatch].value = sw.dataset.hex;
      if (sw.dataset.swatch === "gradientColor2") form.gradientEnabled.checked = true;
      $$(`[data-swatch="${sw.dataset.swatch}"]`, form).forEach((b) => b.setAttribute("aria-pressed", String(b === sw)));
      farbVorschauAktualisieren(form);
      return;
    }
    const richtung = t.closest("[data-richtung]");
    if (richtung) {
      const form = richtung.closest("form");
      form.gradientDirection.value = richtung.dataset.richtung;
      $$("[data-richtung]", form).forEach((b) => b.setAttribute("aria-pressed", String(b === richtung)));
      farbVorschauAktualisieren(form);
      return;
    }
    if (t.closest("#btn-plan-uebernehmen")) { planUebernehmen(); return; }
    if (t.closest("#btn-zum-dashboard")) { go("dashboard"); return; }
    if (t.closest("#btn-jetzt-posten")) { jetztPostenOeffnen(); return; }
    if (t.closest("#sheet-close") || t.id === "sheet-overlay") { sheetSchliessen(); return; }
    const skip = t.closest("[data-skip]");
    if (skip) { try { uebernehmen(await api("POST", `/api/skip-provider/${skip.dataset.skip}`)); render(); } catch (err) { toast(err.message, "bad"); } return; }
    const trennen = t.closest("[data-disconnect]");
    if (trennen) { if (!confirm(`${anbieter(trennen.dataset.disconnect)?.name || "Kanal"} wirklich trennen? Der Kanal wird im Plan abgeschaltet.`)) return; try { uebernehmen(await api("POST", `/api/disconnect/${trennen.dataset.disconnect}`)); render(); toast("Getrennt."); } catch (err) { toast(err.message, "bad"); } return; }
    const frei = t.closest("[data-freigeben]");
    if (frei) { beschaeftigt(frei, true, "…"); try { await api("POST", `/api/approvals/${frei.dataset.freigeben}/approve`); toast("Freigegeben - wird in Kürze veröffentlicht."); await dashboardNachladen(); } catch (err) { beschaeftigt(frei, false); toast(err.message, "bad"); } return; }
    const ab = t.closest("[data-ablehnen]");
    if (ab) { try { await api("POST", `/api/approvals/${ab.dataset.ablehnen}/reject`); toast("Abgelehnt."); await dashboardNachladen(); } catch (err) { toast(err.message, "bad"); } return; }
    const freiPlan = t.closest("[data-freigeben-plan]");
    if (freiPlan) { beschaeftigt(freiPlan, true, "…"); try { const { post } = await api("POST", `/api/planned-posts/${freiPlan.dataset.freigebenPlan}/approve`); const i = S.status.posts.findIndex((p) => p.id === post.id); if (i >= 0) S.status.posts[i] = post; wocheAktualisieren(); toast("Freigegeben."); } catch (err) { beschaeftigt(freiPlan, false); toast(err.message, "bad"); } return; }
    const skipPlan = t.closest("[data-skip-plan]");
    if (skipPlan) { try { const { post } = await api("POST", `/api/planned-posts/${skipPlan.dataset.skipPlan}/skip`); const i = S.status.posts.findIndex((p) => p.id === post.id); if (i >= 0) S.status.posts[i] = post; wocheAktualisieren(); toast("Übersprungen - an dem Tag geht nichts raus."); } catch (err) { toast(err.message, "bad"); } return; }
    const mv = t.closest("[data-move]");
    if (mv) { verschieben(mv.dataset.id, mv.dataset.move); return; }
    if (t.closest("[data-replan]")) { try { await api("POST", "/api/start/replan"); pollStarten(); toast("Wird geplant …"); } catch (err) { toast(err.message, "bad"); } return; }
    const pause = t.closest("[data-pause]");
    if (pause) { try { uebernehmen(await api("POST", "/api/pause", { paused: pause.dataset.pause === "1" })); render(); } catch (err) { toast(err.message, "bad"); } return; }
    if (t.closest("#verify-neu")) { const b = t.closest("#verify-neu"); beschaeftigt(b, true, "Wird gesendet …"); try { await api("POST", "/api/resend-verification"); toast(S.sandbox ? "Testversion: keine echte Mail, nur ein Log-Eintrag." : "Bestätigungsmail ist unterwegs."); } catch (err) { toast(err.message, "bad"); } beschaeftigt(b, false); return; }
    if (t.closest("#abmelden") || t.closest("#abmelden-anderes")) { try { await api("POST", "/api/logout"); } catch { /* egal */ } S.customer = null; S.connections = []; S.status = null; go("konto"); return; }
  });

  window.addEventListener("hashchange", () => {
    if (!eingerichtet()) return;
    const h = location.hash.replace("#", "");
    if ((h === "dashboard" || h === "einstellungen") && S.screen !== h) go(h);
  });

  /* ================= Start ================= */
  async function boot() {
    schriftenLaden();
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
    try { S.authProviders = (await api("GET", "/api/start/config")).authProviders || []; } catch { S.authProviders = []; }
    try { uebernehmen(await api("GET", "/api/me")); } catch { /* nicht angemeldet */ }

    const q = new URLSearchParams(location.search);
    const sauber = () => history.replaceState(null, "", location.pathname + location.hash);
    if (q.get("autherror")) {
      const fn = FEHLER[q.get("autherror")] || FEHLER.failed;
      const name = (S.authProviders.find((p) => p.id === q.get("provider"))?.name) || "";
      S.notice = { kind: "bad", text: fn(name) };
      sauber();
    }
    if (S.customer) {
      S.email = S.customer.email;
      S.website = S.customer.website || "";
      await statusHolen();
      const pName = anbieter(q.get("provider"))?.name || "";
      if (q.get("connected") || q.get("error")) {
        const id = q.get("connected") || q.get("provider");
        S.notice = q.get("connected") && anbieter(id)
          ? { provider: id, kind: "ok", text: `${anbieter(id).name} verbunden als ${kanal(id)?.accountName || "—"}.` }
          : { provider: q.get("provider"), kind: "bad", text: (FEHLER[q.get("error")] || FEHLER.failed)(pName) };
        sauber();
        go(eingerichtet() ? "einstellungen" : "verbinden", { keepNotice: true });
        return;
      }
      if (q.get("verified")) {
        sauber();
        S.notice = { kind: "ok", text: "E-Mail-Adresse bestätigt - danke. Die restlichen Bilder werden jetzt erstellt." };
        go(eingerichtet() ? "dashboard" : "ergebnis", { keepNotice: true });
        return;
      }
      const h = location.hash.replace("#", "");
      if (eingerichtet()) { go(h === "einstellungen" ? "einstellungen" : h === "dashboard" ? "dashboard" : "willkommen"); return; }
      const job = S.status?.job;
      const laeuft = job && !["done", "error", "idle"].includes(job.phase);
      // Neu geladen, waehrend noch gearbeitet wird: zurueck auf den Ladezustand, nicht in
      // eine halb gefuellte Woche.
      if (laeuft || (S.status?.posts?.length && !alleBilderDa(S.status))) { S.arbeitSeit = Date.now(); S.jobFertigSeit = 0; go("arbeitet"); }
      // Auch beim Neuladen erst vorladen: sonst tropfen die Bilder hier genauso nach wie
      // frueher beim ersten Mal, nur dass es niemandem auffaellt, weil sie meist schon im
      // Zwischenspeicher des Browsers liegen. Beim ersten Neuladen auf einem anderen Geraet
      // taeten sie das nicht.
      else if (S.status?.posts?.length) { await zumErgebnis(S.status); }
      else go("website", { keepNotice: true });
      return;
    }
    if (q.get("error")) { S.notice = { kind: "bad", text: (FEHLER[q.get("error")] || FEHLER.failed)("") }; sauber(); }
    go("konto", { keepNotice: true });
    if (S.notice) toast(S.notice.text, "bad");
  }

  boot();
})();
