(() => {
  /* ================= Einstellungen ================= */
  // mount wird aus dem tatsächlichen Pfad abgeleitet (nicht fest "/panel"), damit dieselbe
  // Datei unveraendert sowohl unter /panel (Produktion) als auch unter /panel/sandbox
  // (dauerhafte Staging-Testadresse, siehe nginx-Location) funktioniert - eigene API-Aufrufe
  // gehen dann jeweils an den richtigen Server statt versehentlich immer an die Produktion.
  // Mount-agnostisch: die SPA wird immer NUR am Mount-Wurzelpfad ausgeliefert, der Pfad ohne
  // abschliessenden Slash ist also exakt der Mount. Vorher standen "/panel" und "/panel/sandbox"
  // fest im Code - damit haette das Panel unter einer eigenen Pipeflow-Domain alle API-Aufrufe
  // an den falschen Pfad geschickt. Dieselbe Ableitung nutzt das <base>-Tag in index.html.
  const RAW_PATH = location.pathname.replace(/\/+$/, "");
  const FILE_PREVIEW = location.protocol === "file:" || /\.html?$/i.test(RAW_PATH);
  const CONFIG = {
    mount: FILE_PREVIEW ? "" : RAW_PATH,
    privacyUrl: "https://pipebot.at/datenschutz",     // TODO: echte Datenschutzerklärung verlinken
    nextSteps: "Wir sehen uns Ihre Angaben an und melden uns per E-Mail, bevor der erste Beitrag online geht.",
  };
  const DEMO = FILE_PREVIEW || new URLSearchParams(location.search).has("demo");

  const TONES = { sachlich: "Sachlich und kompetent", locker: "Locker und nahbar", inspirierend: "Inspirierend", humorvoll: "Mit Humor" };
  const FREQ = { "3x-woche": "3× pro Woche", werktags: "Werktags", taeglich: "Täglich" };
  const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  const FREQ_WEEKDAYS = { "3x-woche": [1, 3, 5], werktags: [1, 2, 3, 4, 5], taeglich: [1, 2, 3, 4, 5, 6, 7] };
  // Pre-fills the weekday picker from an explicit "1,3,5"-style value if the customer already
  // has one, otherwise derives it from the legacy `frequency` radio choice - so the old and new
  // controls are never shown/edited at the same time, only one replaces the other on load.
  const weekdaysFor = (explicit, frequency) => {
    if (explicit) return explicit.split(",").map(Number).filter((n) => n >= 1 && n <= 7);
    return FREQ_WEEKDAYS[frequency] || FREQ_WEEKDAYS.werktags;
  };
  const classifyFrequency = (days) => {
    const key = [...days].sort((a, b) => a - b).join(",");
    if (key === "1,2,3,4,5,6,7") return "taeglich";
    if (key === "1,3,5") return "3x-woche";
    return "werktags";
  };
  const CTAS = { link_bio: "Link in der Bio", anrufen: "Anrufen", nachricht: "Nachricht senden", termin: "Termin buchen", keiner: "Kein Aufruf" };
  // Panel v14: muss mit CAROUSEL_MIN_SLIDES/CAROUSEL_MAX_SLIDES in instagram.ts uebereinstimmen -
  // rein informativ hier (Anzeige/Validierung im Formular), die echte Grenze setzt der Server.
  const CAROUSEL_MIN_SLIDES = 3;
  const CAROUSEL_MAX_SLIDES = 7;
  const POST_FORMATS = { single: "Einzelbild", carousel: "Karussell (mehrere Bilder zum Wischen)" };
  const HASHTAGS = { keine: "Keine", wenige: "Wenige (2-3)", viele: "Viele (5+)" };
  const LANGUAGES = { de: "Deutsch", en: "Englisch" };
  const PALETTE = ["#0a0e1a", "#1a2e1a", "#2e1a1a", "#1a1a2e", "#2e2410", "#111111"];

  // Panel v15: muss inhaltlich mit fonts.ts's FONT_OPTIONS uebereinstimmen (id/label/cssFamily) -
  // gleiches Duplizierungs-Muster wie PALETTE oben (kein Server-Roundtrip fuer eine kleine,
  // statische Liste). "file" nur hier im Frontend noetig, fuer die @font-face-Quelle.
  const FONT_OPTIONS = [
    { id: "inter", label: "Inter", cssFamily: "Inter", file: "Inter.ttf", styleNote: "Modern, klar, serifenlos" },
    { id: "poppins", label: "Poppins", cssFamily: "Poppins", file: "Poppins.ttf", styleNote: "Rund, freundlich, serifenlos" },
    { id: "playfair", label: "Playfair Display", cssFamily: "Playfair Display", file: "PlayfairDisplay.ttf", styleNote: "Elegant, klassische Serifenschrift" },
    { id: "merriweather", label: "Merriweather", cssFamily: "Merriweather", file: "Merriweather.ttf", styleNote: "Ruhig, gut lesbare Serifenschrift" },
    { id: "bebas", label: "Bebas Neue", cssFamily: "Bebas Neue", file: "BebasNeue.ttf", styleNote: "Schmal, kraftvoll, in Großbuchstaben" },
    { id: "anton", label: "Anton", cssFamily: "Anton", file: "Anton.ttf", styleNote: "Sehr kräftige Display-Schrift" },
    { id: "caveat", label: "Caveat", cssFamily: "Caveat", file: "Caveat.ttf", styleNote: "Dezente Handschrift-Optik" },
    { id: "pacifico", label: "Pacifico", cssFamily: "Pacifico", file: "Pacifico.ttf", styleNote: "Verspielte Schreibschrift" },
  ];
  const fontOption = (id) => FONT_OPTIONS.find((f) => f.id === id) || FONT_OPTIONS[0];

  const GRADIENT_DIRECTIONS = { diagonal: "Diagonal", horizontal: "Horizontal", vertical: "Vertikal" };

  // Reine HSL-Rotation/-Verschiebung, IDENTISCHE Logik wie suggestGradientPartners() in
  // gradient.ts (server-seitig) - hier dupliziert fuers sofortige Vorschau ohne Server-Roundtrip,
  // gleiches Duplizierungs-Muster wie PALETTE/FONT_OPTIONS oben. Server validiert die gespeicherte
  // Farbe beim Absenden ohnehin selbst (parseBriefing), diese Kopie hier ist rein fuer die
  // Live-Vorschlaege im Formular.
  function suggestGradientPartners(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return [];
    const n = parseInt(hex.slice(1), 16);
    const [r0, g0, b0] = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0, s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r0) h = ((g0 - b0) / d) % 6;
      else if (max === g0) h = (b0 - r0) / d + 2;
      else h = (r0 - g0) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const clampedS = Math.max(s, 0.35);
    const hueRotatedLightness = l + (0.5 - l) * 0.45;
    const hsl = (hh, ss, ll) => {
      hh = ((hh % 360) + 360) % 360; ss = Math.min(1, Math.max(0, ss)); ll = Math.min(1, Math.max(0, ll));
      const c = (1 - Math.abs(2 * ll - 1)) * ss;
      const x = c * (1 - Math.abs((hh / 60) % 2 - 1));
      const m = ll - c / 2;
      let [r, g, b] = [0, 0, 0];
      if (hh < 60) [r, g, b] = [c, x, 0]; else if (hh < 120) [r, g, b] = [x, c, 0];
      else if (hh < 180) [r, g, b] = [0, c, x]; else if (hh < 240) [r, g, b] = [0, x, c];
      else if (hh < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
      const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    };
    return [hsl(h + 35, clampedS, hueRotatedLightness), hsl(h + 180, clampedS, hueRotatedLightness), hsl(h, clampedS, Math.min(0.92, l + 0.28)), hsl(h, clampedS, Math.max(0.08, l - 0.28))];
  }

  const ERRORS = {
    cancelled: (n) => `Sie haben die Verbindung mit ${n} abgebrochen. Sie können es jederzeit erneut versuchen.`,
    state: () => "Die Anfrage ist abgelaufen. Bitte klicken Sie noch einmal auf Verbinden.",
    personal_account: () => "Ihr Instagram-Konto ist noch ein privates Konto. Stellen Sie es zuerst auf ein professionelles Konto um (Punkt 1) und verbinden Sie dann erneut.",
    missing_permission: (n) => `Die Freigabe zum Veröffentlichen fehlt. Bitte verbinden Sie ${n} erneut und bestätigen Sie alle Berechtigungen.`,
    not_configured: (n) => `Die Verbindung mit ${n} ist gerade nicht verfügbar. Schreiben Sie uns kurz, wir kümmern uns darum.`,
    failed: (n) => `Die Verbindung mit ${n || "der Plattform"} hat nicht geklappt. Bitte versuchen Sie es erneut oder schreiben Sie uns.`,
    login: () => "Dieser Zugangslink ist ungültig oder wurde durch einen neueren ersetzt.",
    session: () => "Bitte geben Sie zuerst Ihre Unternehmensdaten ein.",
    verify: () => "Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet.",
  };

  /* ================= Zustand ================= */
  const S = { providers: [], videoVoices: [], voicePreviewAvailable: false, videoLengths: [5, 10, 15], aiAvailable: false, trialDays: 7, turnstileSiteKey: null, customer: null, connections: [], step: "company", formPart: 1, banner: null, skipped: new Set(), pillarAiOpen: false, pillarAiKeywords: "", pillarSuggestions: [], settingsTarget: null, settingsQuery: "", tourIndex: -1, pendingCommentCount: 0, analyticsChannel: "instagram",
    // Redesign: aktiver Reiter im Bereich "Beiträge" und Anzahl offener Freigaben (speist den
    // Status-Satz und die Zähler in Navigation/Bottom-Bar aus derselben Quelle).
    postTab: "geplant", approvalCount: 0,
    // Mobil: welche Einstellungs-Gruppe gerade offen ist ("" = Gruppenliste).
    settingsGroup: "" };

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const conn = (id) => S.connections.find((c) => c.provider === id);
  const prov = (id) => S.providers.find((p) => p.id === id);

  /**
   * Diktierfunktion, zentrales Bauteil fuer ALLE Text-/Textarea-Felder im Kunden-Panel - siehe
   * Session-Berichte. Zwei Wege, automatisch gewaehlt, kein manuelles Umschalten:
   *
   * 1. Web Speech API (kostenlos, komplett clientseitig): wo verfuegbar (Desktop-/Android-Chrome)
   *    immer bevorzugt - kein Server-Roundtrip, keine Zusatzkosten.
   * 2. Server-seitige Transkription (Panel v13, Fallback): iOS Safari unterstuetzt Web Speech
   *    grundsaetzlich nicht (Apple-Plattform-Einschraenkung, kein Bug), hat aber MediaRecorder -
   *    dort wird stattdessen aufgenommen, die fertige Aufnahme an /api/transcribe-audio geschickt
   *    (fal.ai Whisper ueber audio-transcribe.ts, Kosten pro Aufruf in usage_costs geloggt) und der
   *    zurueckgelieferte Text eingefuegt. Kostet echtes Geld pro Nutzung - deshalb NUR der
   *    Fallback, nie der bevorzugte Weg, selbst wenn beides verfuegbar waere.
   *
   * Nur wenn WEDER 1 NOCH 2 verfuegbar ist (sehr alte Browser), wird das Mikrofon-Icon von
   * vornherein DEAKTIVIERT gerendert (disabled-Attribut + erklaerender Titel/aria-label), nie als
   * funktionsloser Button, der bei Klick einfach nichts tut oder wirft.
   *
   * `withDictate(fieldHtml)` wickelt ein bereits gerendertes <input>/<textarea> in einen
   * `.dictate-wrap` mit angehaengtem Mikrofon-Button - das ist die einzige Stelle, die jedes
   * Feld beim Rendern aufruft, keine Kopien der Button-/Icon-Auszeichnung an den einzelnen
   * Feld-Stellen. Der Klick-Handler (siehe zentraler document-Click-Listener) findet das
   * Zielfeld ueber `.closest(".dictate-wrap")` + `querySelector("input, textarea")` - bewusst
   * NICHT ueber eine id, weil manche Felder (Content-Saeulen-Zeilen, Vorausplanungs-Karten pro
   * Beitrag) mehrfach auf derselben Seite vorkommen bzw. Formulare mit identischer Feld-id an
   * zwei Stellen parallel existieren (Einrichtungs-Assistent vs. Einstellungen).
   */
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const dictateSupported = () => Boolean(SpeechRecognitionCtor); // kostenloser Web-Speech-Pfad
  const mediaRecorderSupported = () =>
    Boolean(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); // Server-Fallback-Pfad
  const dictateAvailable = () => dictateSupported() || mediaRecorderSupported();
  let activeDictation = null; // { mode: "speech"|"record", btn, target, ... } - immer hoechstens eine laufende Aufnahme gleichzeitig

  function dictateBtnHtml(forceDisabled) {
    const disabled = forceDisabled || !dictateAvailable();
    const label = dictateAvailable() ? "Diktieren" : "Diktieren wird von diesem Browser nicht unterstützt";
    // Eigenes Pixel-Icon statt Strich-Symbol, damit es zur Icon-Familie passt.
    return `<button type="button" class="dictate" data-dictate ${disabled ? "disabled" : ""} aria-label="${label}" title="${label}" aria-pressed="false">${icon("mic", 14)}</button>`;
  }

  /** Die einzige Stelle, die ein Text-/Textarea-Feld dictier-faehig macht - siehe Dateikopf-Kommentar.
   *  `forceDisabled` fuer Felder, die selbst gerade disabled sind (z. B. nicht editierbare
   *  Vorausplanungs-Karten) - der Mikrofon-Button darf dann nie aktiv wirken. */
  const withDictate = (fieldHtml, forceDisabled = false) => `<div class="with-dictate">${fieldHtml}${dictateBtnHtml(forceDisabled)}</div>`;

  /**
   * Bricht eine laufende Diktier-Sitzung sofort und OHNE Transkription ab (beide Modi) - der
   * richtige Aufruf, wenn das Zielfeld gerade verschwindet (Re-Render, siehe render()/
   * renderPillarsSection()) oder eine neue Sitzung eine alte ersetzt. Zum bewussten Beenden EINER
   * Aufnahme mit anschliessender Transkription siehe finishRecording() unten - das ist ein
   * eigener Pfad, weil Stoppen im Aufnahme-Modus ("record") eben NICHT automatisch verwerfen soll.
   */
  function stopActiveDictation() {
    if (!activeDictation) return;
    const state = activeDictation;
    activeDictation = null;
    state.listening = false;
    clearTimeout(state.autoStopTimer);
    state.btn.classList.remove("dictating", "transcribing");
    state.btn.setAttribute("aria-pressed", "false");
    state.btn.disabled = false;
    try { state.recognition?.stop(); } catch {}
    if (state.recorder && state.recorder.state !== "inactive") { try { state.recorder.stop(); } catch {} }
    if (state.stream) { try { state.stream.getTracks().forEach((t) => t.stop()); } catch {} }
  }

  /**
   * Schreibt diktierten Text an der Cursor-Position ins Zielfeld (haengt an, ueberschreibt nie
   * vorhandenen Inhalt) und feuert danach ein echtes "input"-Event - diktierter Text durchlaeuft
   * dadurch exakt dieselbe Validierung/State-Anbindung wie getippter Text, kein Sonderpfad.
   * Bricht sauber ab (schreibt nichts), wenn das Zielfeld inzwischen durch einen Re-Render
   * ersetzt/entfernt wurde (document.body.contains) - sonst wuerde das Ergebnis unsichtbar in
   * ein verwaistes DOM-Element geschrieben.
   */
  function insertDictatedText(target, text) {
    if (!text || !document.body.contains(target)) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const before = target.value.slice(0, start);
    const after = target.value.slice(end);
    const needsSpace = before && !/\s$/.test(before);
    const inserted = (needsSpace ? " " : "") + text;
    const max = target.maxLength && target.maxLength > 0 ? target.maxLength : Infinity;
    target.value = (before + inserted + after).slice(0, max);
    const caret = Math.min(before.length + inserted.length, max);
    target.setSelectionRange(caret, caret);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Startet (oder erneuert) eine Erkennungs-Runde fuer eine laufende Diktier-Sitzung. Bewusst
   * `continuous: false` + automatischer Neustart bei "onend", statt einmalig `continuous: true` -
   * Android Chrome beendet eine continuous:true-Sitzung nach wenigen Sekunden von selbst (bekannte
   * Plattform-Eigenart, kein Bug in diesem Code - siehe Session-Bericht zur A0-Nachbesserung), was
   * dort wie ein sofort abbrechendes Mikrofon wirkte. Der Neustart-Zyklus hier macht eine Sitzung
   * ununterbrochen nutzbar, bis der Nutzer selbst stoppt - auf Desktop-Chrome unveraendert nutzbar,
   * da dort onend ohnehin erst nach Sprechpausen/explizitem Stopp feuert.
   */
  function startRecognitionCycle(state) {
    if (!state.listening || activeDictation !== state) return;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "de-DE";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript;
      }
      if (finalChunk.trim()) insertDictatedText(state.target, finalChunk.trim());
    };
    recognition.onerror = (event) => {
      // "no-speech"/"aborted" sind normale Sprechpausen (v.a. haeufig auf Android) - Zyklus
      // weiterlaufen lassen statt die Sitzung deswegen zu beenden. Alles andere (z. B.
      // "not-allowed" bei verweigerter Mikrofon-Berechtigung) beendet sie wie bisher.
      if (event.error !== "no-speech" && event.error !== "aborted") stopActiveDictation();
    };
    recognition.onend = () => { if (activeDictation === state && state.listening) startRecognitionCycle(state); };
    state.recognition = recognition;
    try { recognition.start(); } catch { stopActiveDictation(); }
  }

  /**
   * Liest eine Blob (die Aufnahme) als data:-URL ein, fuer den Base64-Upload an
   * /api/transcribe-audio (gleiches Format wie der bestehende Logo-Upload, siehe router.ts).
   */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Aufnahme konnte nicht gelesen werden."));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Server-Fallback-Pfad (Panel v13, iOS Safari): nimmt per MediaRecorder auf, bis der Nutzer
   * erneut auf den Button tippt (finishRecording) oder 90s vergehen (Sicherheitsnetz gegen eine
   * vergessene laufende Aufnahme). `mimeCandidates` in Praeferenz-Reihenfolge - iOS Safari liefert
   * nur "audio/mp4" (kein WebM-Support), Chrome/Firefox typischerweise "audio/webm;codecs=opus".
   */
  function startServerRecording(btn, target) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (activeDictation) { stream.getTracks().forEach((t) => t.stop()); return; } // inzwischen ueberholt
      const mimeCandidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = mimeCandidates.find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) || "";
      let recorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        showError("Aufnahme konnte auf diesem Gerät nicht gestartet werden.");
        return;
      }
      const chunks = [];
      recorder.addEventListener("dataavailable", (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); });
      const state = { mode: "record", btn, target, listening: true, stream, recorder, chunks, startedAt: Date.now() };
      state.stoppedPromise = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
      activeDictation = state;
      btn.classList.add("dictating");
      btn.setAttribute("aria-pressed", "true");
      recorder.start();
      state.autoStopTimer = setTimeout(() => { if (activeDictation === state) finishRecording(state); }, 90_000);
    }).catch((err) => {
      console.error("[dictate] Mikrofonzugriff verweigert/fehlgeschlagen:", err);
      showError("Für das Diktieren wird Mikrofon-Zugriff benötigt. Bitte erlauben Sie den Zugriff in den Browser-/Geräteeinstellungen und versuchen Sie es erneut.");
    });
  }

  /**
   * Beendet eine laufende Aufnahme UND schickt sie zur Transkription - der bewusste "Stopp"-Klick
   * des Nutzers (anders als stopActiveDictation, das verwirft). Drei sichtbare Zustaende fuer den
   * Nutzer: aufnehmend (.dictating, rot pulsierend) -> wird transkribiert (.transcribing, Button
   * gesperrt) -> Text erscheint im Feld. Zu kurze/leere Aufnahmen (z. B. versehentlicher Doppel-Tap)
   * werden verworfen, ohne einen Server-Aufruf (und damit Kosten) auszuloesen.
   */
  async function finishRecording(state) {
    if (activeDictation !== state) return;
    clearTimeout(state.autoStopTimer);
    activeDictation = null;
    state.btn.classList.remove("dictating");
    state.btn.classList.add("transcribing");
    state.btn.disabled = true;

    const durationSeconds = (Date.now() - state.startedAt) / 1000;
    if (state.recorder.state !== "inactive") { try { state.recorder.stop(); } catch {} }
    await state.stoppedPromise;
    state.stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });

    const cleanup = () => { state.btn.classList.remove("transcribing"); state.btn.disabled = false; };
    if (!state.chunks.length || durationSeconds < 0.4) { cleanup(); return; }

    try {
      const blob = new Blob(state.chunks, { type: state.recorder.mimeType || "audio/webm" });
      const audioBase64 = await blobToDataUrl(blob);
      const data = await api("POST", "/api/transcribe-audio", { audioBase64, durationSeconds });
      if (data.text) insertDictatedText(state.target, data.text);
    } catch (err) {
      console.error("[dictate] Transkription fehlgeschlagen:", err);
      showError(err.message || "Transkription ist gerade nicht möglich. Bitte erneut versuchen oder selbst eintippen.");
    } finally {
      cleanup();
    }
  }

  function toggleDictation(btn) {
    if (!dictateAvailable() || btn.disabled) return;
    if (activeDictation && activeDictation.btn === btn) {
      if (activeDictation.mode === "record") finishRecording(activeDictation);
      else stopActiveDictation();
      return;
    }
    stopActiveDictation();
    const target = btn.closest(".dictate-wrap")?.querySelector("input, textarea");
    if (!target) return;
    if (dictateSupported()) {
      const state = { mode: "speech", btn, target, listening: true, recognition: null };
      activeDictation = state;
      btn.classList.add("dictating");
      btn.setAttribute("aria-pressed", "true");
      startRecognitionCycle(state);
    } else if (mediaRecorderSupported()) {
      startServerRecording(btn, target);
    }
  }
  // Panel v9 Punkt 7: die Erstanmeldungs-Kette (Rail) besteht nur noch aus Unternehmen/Kanaelen/
  // Fertig - Vorschau/Verlauf/Analytics sind eigene Dashboard-Unteransichten (siehe DETAIL_VIEWS),
  // kein Rail-Schritt mehr, werden ausschliesslich ueber die Dashboard-/Fertig-Buttons erreicht.
  const steps = () => ["company", ...S.providers.map((p) => p.id), "done"];
  // Panel v11: Verwaltungs-Ansichten. Keine davon ist je ein Schritt der Erstanmeldung - sie
  // haben nie den Rail, sondern die Dauer-Navigation (siehe renderMainNav/MAIN_NAV).
  const DETAIL_VIEWS = ["dashboard", "preview", "history", "analytics", "settings", "guide"];
  // Reihenfolge = Reihenfolge in der Navigationsleiste. "Beiträge" fasst Vorschau und Verlauf
  // zusammen (zwei Unter-Reiter innerhalb der Ansicht), damit die Leiste kurz bleibt.
  const MAIN_NAV = [
    { view: "dashboard", label: "Übersicht" },
    { view: "preview", label: "Beiträge", match: ["preview", "history"] },
    { view: "settings", label: "Einstellungen" },
    { view: "analytics", label: "Analytics" },
    { view: "guide", label: "Was kann Pipeflow?" },
  ];
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" }) : "";

  /**
   * Relative Zeit ("in 3 Std.", "gestern", "vor 5 Min.") - liest sich schneller als ein Datum.
   * Das exakte Datum steht immer als title-Attribut daneben (siehe Aufrufer), nichts geht verloren.
   */
  const fmtRelative = (iso) => {
    if (!iso) return "";
    const diffMs = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diffMs);
    const min = Math.round(abs / 60000);
    if (min < 1) return "gerade eben";
    const rtf = new Intl.RelativeTimeFormat("de-AT", { numeric: "auto" });
    const sign = diffMs < 0 ? -1 : 1;
    if (min < 60) return rtf.format(sign * min, "minute");
    const hours = Math.round(min / 60);
    if (hours < 24) return rtf.format(sign * hours, "hour");
    const days = Math.round(hours / 24);
    if (days < 7) return rtf.format(sign * days, "day");
    return new Date(iso).toLocaleDateString("de-AT", { day: "numeric", month: "long" });
  };
  const fmtNextPost = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const weekday = d.toLocaleDateString("de-AT", { weekday: "long", timeZone: "Europe/Vienna" });
    const time = d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
    return `${weekday}, ${time} Uhr`;
  };
  // Panel v7 (Teil 2 - Zeitstempel/Herkunft): "heute/gestern, HH:MM Uhr" fuer ganz frische
  // Eintraege, sonst Datum + Uhrzeit - alles in Europe/Vienna, wie der Rest des Panels.
  const fmtCreated = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const vDate = (x) => x.toLocaleDateString("de-AT", { timeZone: "Europe/Vienna" });
    const time = d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });
    if (now - d < 5 * 60_000) return "gerade eben";
    const yesterday = new Date(now.getTime() - 86_400_000);
    if (vDate(d) === vDate(now)) return `heute, ${time} Uhr`;
    if (vDate(d) === vDate(yesterday)) return `gestern, ${time} Uhr`;
    return `${d.toLocaleDateString("de-AT", { day: "numeric", month: "long", timeZone: "Europe/Vienna" })}, ${time} Uhr`;
  };
  // Panel v7 (Teil 2): 'planning' = aus der naechtlichen Vorausplanung uebernommen (siehe
  // submit_planned_post_for_approval), 'routine'/null = spontan von der stuendlichen Routine
  // erstellt (K2 "Jetzt posten" oder K4-K8-Fallback) - null deckt Eintraege von vor diesem Fix ab.
  const ORIGIN_LABEL = { planning: "aus der Vorausplanung", routine: "spontan erstellt" };
  const originLabel = (source) => ORIGIN_LABEL[source] || "automatisch erstellt";

  /* ================= API ================= */
  async function api(method, url, body) {
    if (DEMO) return mockApi(method, url, body);
    const res = await fetch(CONFIG.mount + url, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Unbekannter Fehler"), { status: res.status, fields: data.fields });
    return data;
  }
  const applyState = (d) => { S.customer = d.customer; S.connections = d.connections || []; S.skipped = new Set(d.customer?.skippedProviders || []); };

  /* ================= Pixel-Icons (11×11, crispEdges, currentColor) =================
   * Eigene Icons im Stil des Logos: Quadrate auf einem Raster, keine Emojis, keine fremden
   * Markenlogos - die wuerden das Schwarz-Weiss brechen und von den Beitragsbildern ablenken. */
  const ICON = {
    uebersicht: '<rect x="0" y="0" width="4" height="4"/><rect x="7" y="0" width="4" height="4"/><rect x="0" y="7" width="4" height="4"/><rect x="7" y="7" width="4" height="4"/>',
    beitraege: '<rect x="0" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="4" width="7" height="7"/>',
    analytics: '<rect x="0" y="7" width="3" height="4"/><rect x="4" y="3" width="3" height="8"/><rect x="8" y="0" width="3" height="11"/>',
    einstellungen: '<rect x="0" y="1" width="11" height="2"/><rect x="7" y="0" width="2" height="4"/><rect x="0" y="8" width="11" height="2"/><rect x="2" y="7" width="2" height="4"/>',
    posten: '<rect x="4" y="0" width="3" height="11"/><rect x="0" y="4" width="11" height="3"/>',
    check: '<rect x="0" y="5" width="3" height="3"/><rect x="2" y="7" width="3" height="3"/><rect x="4" y="4" width="3" height="3"/><rect x="6" y="2" width="3" height="3"/><rect x="8" y="0" width="3" height="3"/>',
    close: '<rect x="0" y="0" width="2" height="2"/><rect x="2" y="2" width="2" height="2"/><rect x="4" y="4" width="3" height="3"/><rect x="7" y="7" width="2" height="2"/><rect x="9" y="9" width="2" height="2"/><rect x="9" y="0" width="2" height="2"/><rect x="7" y="2" width="2" height="2"/><rect x="2" y="7" width="2" height="2"/><rect x="0" y="9" width="2" height="2"/>',
    mic: '<rect x="4" y="0" width="3" height="6"/><rect x="2" y="5" width="1" height="2"/><rect x="8" y="5" width="1" height="2"/><rect x="3" y="7" width="5" height="1"/><rect x="5" y="8" width="1" height="3"/>',
    hilfe: '<rect x="3" y="0" width="5" height="2"/><rect x="7" y="1" width="2" height="4"/><rect x="5" y="4" width="3" height="2"/><rect x="5" y="6" width="2" height="2"/><rect x="5" y="9" width="2" height="2"/><rect x="2" y="1" width="2" height="2"/>',
    warnung: '<rect x="4" y="0" width="3" height="7"/><rect x="4" y="8" width="3" height="3"/>',
    feed: '<rect x="0" y="0" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"/>',
    story: '<rect x="2" y="0" width="7" height="11" fill="none" stroke="currentColor" stroke-width="2"/>',
    linkedin: '<rect x="0" y="0" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="2" y="2" width="2" height="2"/><rect x="2" y="5" width="2" height="4"/><rect x="5" y="5" width="4" height="4"/>',
    chevron: '<rect x="3" y="1" width="2" height="2"/><rect x="5" y="3" width="2" height="2"/><rect x="7" y="5" width="2" height="1"/><rect x="5" y="6" width="2" height="2"/><rect x="3" y="8" width="2" height="2"/>',
    undo: '<rect x="0" y="4" width="3" height="3"/><rect x="2" y="2" width="2" height="2"/><rect x="2" y="7" width="2" height="2"/><rect x="4" y="4" width="7" height="3"/>',
  };
  /** @param {string} name @param {number} size */
  const icon = (name, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 11 11" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${ICON[name] || ""}</svg>`;

  /* ================= Hauptbereiche =================
   * Vier Bereiche (Auftrag Abschnitt 5). "Beiträge" fasst Vorschau, Freigaben und Verlauf als
   * drei Ansichten derselben Pipe zusammen - vorher waren das drei getrennte Navigationspunkte
   * mit uneinheitlichen Begriffen ("Beiträge" vs. "Vorschau", "Verlauf"). */
  const AREAS = [
    { view: "dashboard", label: "Übersicht", icon: "uebersicht", hash: "uebersicht" },
    { view: "posts", label: "Beiträge", icon: "beitraege", hash: "beitraege" },
    { view: "analytics", label: "Analytics", icon: "analytics", hash: "analytics" },
    { view: "settings", label: "Einstellungen", icon: "einstellungen", hash: "einstellungen" },
  ];
  const POST_TABS = [
    { id: "geplant", label: "Geplant" },
    { id: "freigabe", label: "Zur Freigabe" },
    { id: "veroeffentlicht", label: "Veröffentlicht" },
  ];

  /* ================= Toasts (mit Rückgängig) =================
   * Ersetzt die Rueckfrage-Dialoge bei Freigeben/Ablehnen/Ueberspringen: die Aktion passiert
   * sofort, laesst sich aber 6 Sekunden lang zurueckholen. WICHTIG: die eigentliche Server-
   * Anfrage wird erst NACH Ablauf des Fensters abgeschickt (siehe withUndo) - sonst wuerde der
   * Sofort-Trigger der Routine (routine-trigger.ts) schon laufen und "Rückgängig" waere gelogen. */
  const UNDO_MS = 6000;
  function toast(message, { undo = null, kind = "" } = {}) {
    const wrap = $("#toasts");
    if (!wrap) return { cancel() {} };
    const el = document.createElement("div");
    el.className = `toast${kind ? ` ${kind}` : ""}`;
    el.innerHTML = `<span>${esc(message)}</span>`;
    let done = false;
    const close = () => { if (!el.isConnected) return; el.remove(); };
    if (undo) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `${icon("undo", 13)} Rückgängig`;
      btn.addEventListener("click", () => { done = true; clearTimeout(timer); close(); undo.onUndo(); });
      el.appendChild(btn);
    }
    wrap.appendChild(el);
    const timer = setTimeout(() => { close(); if (undo && !done) undo.onCommit(); }, undo ? UNDO_MS : 3200);
    return { cancel: () => { clearTimeout(timer); close(); } };
  }

  /**
   * Fuehrt eine Aktion optimistisch aus: UI sofort, Server erst nach dem Undo-Fenster.
   * @param {{message:string, apply:Function, revert:Function, commit:Function}} o
   */
  function withUndo(o) {
    o.apply();
    toast(o.message, {
      undo: {
        onUndo: () => { o.revert(); },
        onCommit: async () => {
          try {
            await o.commit();
          } catch (err) {
            o.revert();
            toast(err.message || "Das hat nicht geklappt.", { kind: "bad" });
          }
        },
      },
    });
  }

  /* ================= Routing mit Deep-Links =================
   * Vorher lag die Ansicht nur in S.step, die URL aenderte sich nie: die Zurueck-Geste am Handy
   * hat das Panel verlassen und E-Mail-Links konnten nicht auf die Freigabe zeigen. */
  function currentHash() {
    return (location.hash || "").replace(/^#/, "");
  }
  function hashFor(view, sub) {
    const area = AREAS.find((a) => a.view === view);
    if (!area) return "";
    return sub ? `${area.hash}/${sub}` : area.hash;
  }
  function applyHash(hash, { replace = false } = {}) {
    const target = `#${hash}`;
    if (location.hash === target) return;
    if (replace) history.replaceState(null, "", target);
    else history.pushState(null, "", target);
  }
  /** URL -> Zustand. Unbekannte Hashes landen still auf der Übersicht. */
  function routeFromHash() {
    const [head, sub] = currentHash().split("/");
    if (!head) return false;
    if (head === "posten") { openPostNow(); return true; }
    if (head === "hilfe") { openHelpChat(); return true; }
    const area = AREAS.find((a) => a.hash === head);
    if (!area) return false;
    if (area.view === "posts" && sub && POST_TABS.some((t) => t.id === sub)) S.postTab = sub;
    if (area.view === "analytics" && (sub === "instagram" || sub === "linkedin")) S.analyticsChannel = sub;
    // Ohne Gruppe im Hash: mobil zurueck zur Gruppenliste (sonst bliebe die zuletzt geoeffnete
    // Gruppe haengen und "Einstellungen" in der Navigation wuerde scheinbar nichts tun).
    if (area.view === "settings") { S.settingsTarget = sub || null; S.settingsGroup = sub || ""; }
    S.step = area.view;
    return true;
  }

  /* ================= Rendering: Dauer-Navigation (Panel v11) ================= */
  // Sichtbar, sobald ein Kunde eingerichtet ist (mind. ein Kanal verbunden) - exakt dieselbe
  // Bedingung, die auch ueber den Landepunkt entscheidet (landingStep/overviewStep). Waehrend der
  // Erstanmeldung bleibt sie aus, dort fuehrt ausschliesslich die Schritt-Linie.
  const isEstablished = () => Boolean(S.customer && S.connections.length > 0);

  /** Anzahl offener Aufgaben, die als Zähler an "Beiträge" erscheinen (Freigaben + Kommentare). */
  function openTaskCount() {
    return (S.approvalCount || 0) + (S.pendingCommentCount || 0);
  }

  /** Initialen für den Kontoknopf - aus dem Firmennamen, nie aus personenbezogenen Daten. */
  function acctInitials() {
    const name = (S.customer && S.customer.company) || "";
    const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.length ? parts.map((p) => p[0].toUpperCase()).join("") : "?";
  }

  /**
   * Kopfzeile (ab 1024px) und Bottom-Bar (darunter) - dieselben vier Bereiche, unterschiedliche
   * Form. Vorher brach die Hauptnavigation am Handy zweizeilig um; jetzt liegen die Bereiche in
   * der Daumenzone, mit dauerhaft sichtbaren Beschriftungen.
   */
  function renderChrome() {
    const established = isEstablished();
    const bar = $("#appbar");
    const tabbar = $("#tabbar");
    const fab = $("#chat-fab");
    if (bar) bar.hidden = !established;
    if (tabbar) tabbar.hidden = !established;
    if (fab) fab.hidden = !established || DEMO;
    if (!established) return;

    const count = openTaskCount();
    const badge = (view, cls) =>
      view === "posts" && count ? `<span class="${cls}" aria-label="${count} offene Aufgaben">${count}</span>` : "";

    const nav = $("#appnav");
    if (nav) {
      nav.innerHTML =
        AREAS.map((a) => {
          const active = a.view === S.step;
          return `<a href="#${a.hash}" data-go="${a.view}" ${active ? 'aria-current="page"' : ""}>${esc(a.label)}${badge(a.view, "nav-badge")}</a>`;
        }).join("") + `<span class="appnav-underline" aria-hidden="true"></span>`;
      requestAnimationFrame(() => moveNavUnderline(nav));
    }

    if (tabbar) {
      tabbar.innerHTML = AREAS.map((a) => {
        const active = a.view === S.step;
        return `<a href="#${a.hash}" data-go="${a.view}" ${active ? 'aria-current="page"' : ""}>
          ${icon(a.icon, 20)}<span>${esc(a.label)}</span>${badge(a.view, "tab-badge")}
        </a>`;
      }).join("") + `<button type="button" class="tab-post" data-open-post-now>${icon("posten", 20)}<span>Posten</span></button>`;
    }

    const acct = $("#acct-btn");
    if (acct) acct.textContent = acctInitials();
  }

  /** Ein Unterstrich, der an die aktive Position gleitet (statt pro Punkt ein eigener Rahmen). */
  function moveNavUnderline(nav) {
    const active = nav.querySelector('a[aria-current="page"]');
    const line = nav.querySelector(".appnav-underline");
    if (!line) return;
    if (!active) { line.style.width = "0px"; return; }
    line.style.width = `${active.offsetWidth}px`;
    line.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  /* ================= Rendering: Pipeline ================= */
  /**
   * Onboarding-Fortschritt als Pipe: Quadrate an einer Leitung, dieselbe Zustandssprache wie die
   * Beiträge (Umriss = offen, gefüllt = erledigt). Liefert jetzt HTML zurueck, statt in einen
   * festen Rail-Container zu schreiben - dadurch steht der Fortschritt im Inhalt (mobile-first)
   * statt in einer eigenen Spalte, die am Handy ohnehin nur noch Symbole zeigte.
   */
  function railHtml() {
    const list = steps();
    const cur = list.indexOf(S.step);
    const label = (id) => (id === "company" ? "Unternehmen" : id === "done" ? "Fertig" : prov(id).name);
    const isDone = (id) => (id === "company" ? !!S.customer : id === "done" ? false : (!!conn(id) && conn(id).status !== "expired") || S.skipped.has(id));

    const nodes = list.map((id, i) => {
      const done = i < cur && isDone(id);
      const state = id === S.step ? "waiting" : done ? "published" : "planned";
      const reachable = S.customer || id === "company";
      return `${i ? `<span class="rail-seg${i <= cur ? " done" : ""}" aria-hidden="true"></span>` : ""}
        <button type="button" class="pipe-node" data-state="${state}" data-go="${id}" ${reachable ? "" : "disabled"}
          ${id === S.step ? 'aria-current="step"' : ""}
          aria-label="Schritt ${i + 1} von ${list.length}: ${esc(label(id))}${done ? ", erledigt" : id === S.step ? ", aktueller Schritt" : ""}"></button>`;
    }).join("");

    return `<div class="steplabel">Schritt ${cur + 1} von ${list.length} · ${esc(label(S.step))}</div>
      <div class="rail">${nodes}</div>`;
  }

  /* ================= Farbthemen ================= */
  function themesSectionHtml(c) {
    const themes = c.savedThemes || [];
    const activeName = themes.find((t) => t.id === c.activeThemeId)?.name;
    return `
      <label>Gespeicherte Farbthemen <span class="opt">(optional)</span></label>
      ${c.activeThemeId ? `<p class="hint">Aktives Thema: <strong>${esc(activeName || "")}</strong> - <button type="button" class="link" id="theme-deactivate">stattdessen eigene Farbe oben verwenden</button></p>` : ""}
      ${themes.length ? `<div class="theme-list">${themes.map((t) => `<button type="button" class="link theme-chip" data-theme-activate="${esc(t.id)}" ${c.activeThemeId === t.id ? "disabled" : ""}><span class="theme-dot" style="background:${esc(t.accentColor || "#0a0e1a")}"></span>${esc(t.name)}${c.activeThemeId === t.id ? " (aktiv)" : ""}</button>`).join("")}</div>` : ""}
      <button type="button" class="link" id="theme-save">+ Aktuelle Farbe/Beschriftung als Thema speichern</button>`;
  }

  /* ================= Logo ================= */
  function logoSectionHtml(c) {
    return `
      <label for="f-logo">Eigenes Logo <span class="opt">(optional, PNG oder JPG, max. 2 MB)</span></label>
      <p class="hint">Wird klein am Bildrand angezeigt und ersetzt dort die Text-Beschriftung - kein Vollbild-Logo.</p>
      <div id="logo-preview">${c.hasLogo ? `<img src="${DEMO && MOCK.logoDataUrl ? MOCK.logoDataUrl : `${CONFIG.mount}/api/logo?t=${Date.now()}`}" alt="Ihr Logo" style="width:64px;height:64px;object-fit:contain;background:var(--wash);border-radius:2px">` : ""}</div>
      <input type="file" id="f-logo" accept="image/png,image/jpeg">
      <div class="actions" style="margin-top:10px">
        <button type="button" class="link" id="logo-upload" disabled>Logo hochladen</button>
        ${c.hasLogo ? `<button type="button" class="link" id="logo-remove" style="color:var(--stop)">Logo entfernen</button>` : ""}
      </div>`;
  }

  /* ================= Content-Säulen ================= */
  function pillarSuggestionCardHtml(p, i) {
    return `<div class="ai-box" data-pillar-suggestion="${i}">
      <p><strong>${esc(p.title)}</strong><br>${esc(p.description)}</p>
      <div class="row">
        <button type="button" data-pillar-accept="${i}" ${S.pillarsDraft.length >= 6 ? "disabled" : ""}>Übernehmen</button>
        <button type="button" class="ghost" data-pillar-discard="${i}">Verwerfen</button>
      </div>
    </div>`;
  }

  /** Zeichnet die Saeulen-Liste neu und zieht die Beitrags-Vorschau nach (die Saeulen liefern die
   *  Ueberschrift und die Beispiel-Hashtags - ohne diesen Aufruf bliebe sie beim alten Stand). */
  function repaintPillars() {
    const section = $("#pillars-section");
    if (section) section.innerHTML = renderPillarsSection();
    updateFirstPostPreview();
  }

  function renderPillarsSection() {
    stopActiveDictation(); // wird bei Hinzufuegen/Entfernen/Uebernehmen neu gerendert
    const rows = S.pillarsDraft.map((p, i) => `
      <div class="pillar-row" data-pillar-index="${i}">
        ${`<input type="text" data-pillar-title placeholder="z. B. Tipps" value="${esc(p.title)}" maxlength="60" aria-label="Titel der Säule">`}
        ${`<input type="text" data-pillar-desc placeholder="Worum geht es dabei? (optional)" value="${esc(p.description)}" maxlength="300" aria-label="Beschreibung der Säule">`}
        <select data-pillar-weight aria-label="Gewichtung">${[1, 2, 3, 4, 5].map((w) => `<option value="${w}" ${p.weight === w ? "selected" : ""}>${w}×</option>`).join("")}</select>
        <button type="button" class="link" data-pillar-remove="${i}">Entfernen</button>
      </div>`).join("");
    return `
      <label>Content-Säulen <span class="opt">(optional)</span></label>
      <p class="hint">Wiederkehrende Themen, zwischen denen automatisch abgewechselt wird (z. B. "Tipps", "Hinter den Kulissen", "Kundenstimmen"). Gewicht = wie oft im Vergleich zu den anderen dran. Ohne Säulen nutzen wir einfach Ihre Beschreibung oben.</p>
      <div id="pillars-list">${rows}</div>
      ${S.pillarsDraft.length < 6 ? `<button type="button" class="link" id="pillar-add">+ Säule hinzufügen</button>` : `<p class="hint">Maximal 6 Säulen.</p>`}
      ${S.aiAvailable ? `
      <p class="hint"><button type="button" class="link" id="pillar-ai-suggest">Mit KI vorschlagen</button></p>
      <div id="pillar-ai-block" ${S.pillarAiOpen ? "" : "hidden"}>
        <div class="field">
          <label for="f-pillar-keywords" class="vh">Stichworte für Themen-Ideen</label>
          ${`<input id="f-pillar-keywords" type="text" placeholder="Stichworte für Themen-Ideen (optional, z. B. Osteopressur, Faszientherapie, Mühlviertel)" maxlength="300" value="${esc(S.pillarAiKeywords)}">`}
        </div>
        <div class="actions">
          <button type="button" class="link" id="pillar-ai-fetch">Vorschläge holen</button>
        </div>
        <div id="pillar-ai-results">${S.pillarSuggestions.map(pillarSuggestionCardHtml).join("")}</div>
      </div>` : ""}`;
  }

  function syncPillarsDraftFromDom() {
    const rows = document.querySelectorAll(".pillar-row");
    if (!rows.length && !S.pillarsDraft.length) return;
    const next = [];
    rows.forEach((row) => {
      next.push({
        title: row.querySelector("[data-pillar-title]")?.value || "",
        description: row.querySelector("[data-pillar-desc]")?.value || "",
        weight: Number(row.querySelector("[data-pillar-weight]")?.value) || 1,
      });
    });
    S.pillarsDraft = next;
  }

  /* ================= Rendering: Schritte ================= */
  function bannerHtml() {
    if (!S.banner) return "";
    return `<div class="banner ${S.banner.kind}" role="${S.banner.kind === "bad" ? "alert" : "status"}">${esc(S.banner.text)}</div>`;
  }

  // Panel v6 Aufgabe 5: fuer jemanden ohne Session, unterhalb des Signup-Formulars - bewusst
  // eingeklappt (details/summary, wie die "Häufige Fragen" andernorts im Panel), damit es das
  // Formular fuer neue Kunden nicht dominiert.
  function recoverAccessHtml() {
    return `<details class="recover-access">
      <summary>Sie haben schon ein Konto? Zugang verloren?</summary>
      <div class="field" style="margin-top:12px">
        <label for="f-recover-email">E-Mail-Adresse</label>
        <input id="f-recover-email" type="email" placeholder="ihre@email.at" autocomplete="email">
      </div>
      <div class="actions" style="margin-top:0">
        <button type="button" class="link" id="recover-submit">Neuen Zugangslink anfordern</button>
      </div>
      <p id="recover-status" style="margin-top:8px;font-size:14px" aria-live="polite"></p>
    </details>`;
  }

  function companyHtml() {
    const c = S.customer || {
      tone: "sachlich", frequency: "werktags", postTime: "15:00", accentColor: "", watermarkText: "", avoidTopics: "", ctaPreference: "link_bio",
      igFeedEnabled: true, igStoryEnabled: true, linkedinEnabled: true, hashtagPreference: "wenige", emojisEnabled: true, language: "de",
      contentPillars: [],
    };
    S.pillarsDraft = (c.contentPillars || []).map((p) => ({ title: p.title || "", description: p.description || "", weight: p.weight || 1 }));
    const edit = !!S.customer;
    const twoPart = !edit; // Beim Bearbeiten alles auf einer Seite - der Kunde kennt das Formular schon.
    const part = twoPart ? S.formPart : 1;
    const f = (name, label, type, opts = {}) => `
      <div class="field">
        <label for="f-${name}">${label}${opts.optional ? ' <span class="opt">(optional)</span>' : ""}</label>
        <input id="f-${name}" name="${name}" type="${type}" value="${esc(c[name])}" ${opts.optional ? "" : "required"} autocomplete="${opts.ac || "off"}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ""}>
      </div>`;

    // Panel v16 Fix: der fruehere 1/2/3-Erklaerblock hier wiederholte wortgleich, was die Schritt-
    // Kette (.rail) links bzw. auf Mobil als Text ueber #rail-current bereits zeigt ("Schritt 1 von
    // 4 · Unternehmen" + die 4 Knoten Unternehmen/Instagram/LinkedIn/Fertig). Auf Desktop steht die
    // Kette in einer eigenen Spalte, faellt aber auf schmalen Screens (<=820px) in dieselbe
    // einspaltige Fliessreihenfolge wie dieser Block - zwei fast identische Schritt-Aufzaehlungen
    // direkt untereinander sahen dann wie zwei verschiedene Onboarding-Versionen aus (Screenshot-
    // Beweis von Paul, 2026-09-14). Es gab nie zwei Code-Pfade, nur diese eine echte inhaltliche
    // Dopplung - deshalb hier entfernt statt per CSS versteckt; die Test-Info bleibt einzig unten.
    const introHtml = !edit ? `
      <div class="intro" id="intro-block" ${part !== 1 ? "hidden" : ""}>
        <p class="intro-trial">${S.trialDays} Tage kostenlos testen. Keine Kreditkarte nötig.</p>
      </div>` : "";

    const partAHtml = `
        <div class="grid2">
          ${f("company", "Firmenname", "text", { ac: "organization" })}
          <div class="field">
            <label for="f-website">Website <span class="opt">(optional)</span></label>
            <input id="f-website" name="website" type="url" value="${esc(c.website)}" autocomplete="url" placeholder="https://" aria-describedby="${S.aiAvailable ? "analyze-website-hint" : ""}">
            ${S.aiAvailable ? `<div class="website-suggest">
              <button type="button" class="btn" id="analyze-website">Vorschlag aus meiner Website holen</button>
              <p class="hint" id="analyze-website-hint">Wir lesen einmalig Ihre Startseite und schlagen Branche, Beschreibung und Tonalität vor. Sie sehen den Vorschlag zuerst und können alles ändern.</p>
            </div>` : ""}
          </div>
          ${f("contactName", "Ihr Name", "text", { ac: "name" })}
          ${f("email", "E-Mail", "email", { ac: "email" })}
        </div>
        <div id="website-suggestion" hidden></div>
        ${f("industry", "Branche", "text", { optional: true, ph: "z. B. Physiotherapie, Tischlerei, Steuerberatung" })}
        <div class="field">
          <label for="f-about">Worum soll es in den Beiträgen gehen?</label>
          ${withDictate(`<textarea id="f-about" name="about" placeholder="z. B. Physiotherapie-Praxis in Linz, Schwerpunkt Rückenschmerzen. Zielgruppe: Büroangestellte zwischen 35 und 60. Wir wollen Tipps geben und neue Patienten gewinnen.">${esc(c.about)}</textarea>`)}
          <p class="hint">Stichworte reichen. Je konkreter, desto besser passen die Beiträge.${S.aiAvailable ? ` <button type="button" class="link" id="ai-improve">Mit KI verbessern</button>` : ""}</p>
          <div id="ai-suggestion" hidden></div>
        </div>
        <div class="field" id="pillars-section">${renderPillarsSection()}</div>`;

    const partBHtml = `
        <div class="field">
          <label for="f-tone">Tonalität</label>
          <select id="f-tone" name="tone">${Object.entries(TONES).map(([k, v]) => `<option value="${k}" ${c.tone === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        </div>
        <div class="grid2">
          <div class="field">
            <label for="f-accentColor">Akzentfarbe für Ihre Bilder <span class="opt">(optional)</span></label>
            <div class="colorrow">
              <input id="f-accentColor" name="accentColor" type="color" value="${esc(c.accentColor || "#0a0e1a")}">
              <input type="text" value="${esc(c.accentColor || "")}" placeholder="Standard" readonly aria-hidden="true" tabindex="-1">
            </div>
            <div class="swatches" role="group" aria-label="Vorschläge">
              ${PALETTE.map((hex) => `<button type="button" class="swatch" data-swatch="${hex}" aria-pressed="${c.accentColor === hex}" style="background:${hex}" aria-label="${hex}"></button>`).join("")}
            </div>
            <p class="hint">Bestimmt den Hintergrund Ihrer generierten Bilder. Leer lassen für unser Standard-Design.${c.activeThemeId ? " <strong>Hinweis: Aktuell wird stattdessen Ihr aktives Thema unten verwendet.</strong>" : ""}</p>
          </div>
          <div class="field">
            <label for="f-watermarkText">Beschriftung im Bild <span class="opt">(optional)</span></label>
            ${`<input id="f-watermarkText" name="watermarkText" type="text" value="${esc(c.watermarkText || "")}" placeholder="${esc(c.company || "Ihr Firmenname")}">`}
            <p class="hint">Erscheint klein am Bildrand. Leer lassen, um Ihren Firmennamen zu verwenden.</p>
            <p class="hint">So ungefähr sehen Ihre Bilder aus (Beispiel, kein echtes Bild):</p>
            <div class="lp-square" id="lp-square" style="background:${esc(c.accentColor || "#0a0e1a")}">
              <span class="lp-headline" id="lp-headline">Ihr Beitrag</span>
              <span class="lp-watermark" id="lp-watermark">${esc(c.watermarkText || c.company || "Pipeline")}</span>
            </div>
          </div>
        </div>
        ${edit ? `<div class="field" id="themes-section">${themesSectionHtml(c)}</div>` : ""}
        ${edit ? `<div class="field" id="logo-section">${logoSectionHtml(c)}</div>` : ""}
        <fieldset class="field">
          <legend>Tage für Instagram</legend>
          <div class="daypicker" data-weekday-channel="instagram">${WEEKDAYS.map((label, i) => `<label><input type="checkbox" value="${i + 1}" ${weekdaysFor(c.instagramWeekdays, c.frequency).includes(i + 1) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
        </fieldset>
        <fieldset class="field">
          <legend>Tage für LinkedIn</legend>
          <div class="daypicker" data-weekday-channel="linkedin">${WEEKDAYS.map((label, i) => `<label><input type="checkbox" value="${i + 1}" ${weekdaysFor(c.linkedinWeekdays, c.frequency).includes(i + 1) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
        </fieldset>
        <div class="grid2">
          <div class="field">
            <label for="f-postTime">Um wie viel Uhr?</label>
            <input id="f-postTime" name="postTime" type="time" value="${esc(c.postTime || "15:00")}" step="900">
          </div>
          <div class="field">
            <label for="f-pauseFrom">Pause/Urlaub von <span class="opt">(optional)</span></label>
            <input id="f-pauseFrom" name="pauseFrom" type="date" value="${esc(c.pauseFrom || "")}">
          </div>
        </div>
        <div class="field">
          <label for="f-pauseUntil">Pause/Urlaub bis <span class="opt">(optional)</span></label>
          <input id="f-pauseUntil" name="pauseUntil" type="date" value="${esc(c.pauseUntil || "")}">
          <p class="hint">In diesem Zeitraum wird für Sie nichts veröffentlicht.</p>
        </div>
        <div class="grid2">
          <div class="field">
            <label for="f-ctaPreference">Bevorzugter Aufruf am Ende des Beitrags</label>
            <select id="f-ctaPreference" name="ctaPreference">${Object.entries(CTAS).map(([k, v]) => `<option value="${k}" ${(c.ctaPreference || "link_bio") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label for="f-avoidTopics">Was sollen wir vermeiden? <span class="opt">(optional)</span></label>
            ${`<input id="f-avoidTopics" name="avoidTopics" type="text" value="${esc(c.avoidTopics || "")}" placeholder="z. B. keine Preise nennen, kein Humor">`}
            <p class="hint">Eine Bitte an die KI - wird berücksichtigt, aber nicht hart erzwungen.</p>
          </div>
        </div>
        <div class="field">
          <label for="f-bannedWords">Wörter, die NIE vorkommen dürfen <span class="opt">(optional, kommagetrennt)</span></label>
          ${`<input id="f-bannedWords" name="bannedWords" type="text" value="${esc(c.bannedWords || "")}" placeholder="z. B. billig, Konkurrenzname, Rabatt">`}
          <p class="hint"><strong>Wird automatisch blockiert, nicht nur vermieden:</strong> ein Beitrag mit einem dieser Wörter wird gar nicht erst veröffentlicht.</p>
        </div>
        <div class="field">
          <label for="f-requiredElements">Muss in jedem Beitrag vorkommen <span class="opt">(optional, kommagetrennt)</span></label>
          ${`<input id="f-requiredElements" name="requiredElements" type="text" value="${esc(c.requiredElements || "")}" placeholder="z. B. #IhrHashtag, @IhrHandle">`}
          <p class="hint">Fehlt eines dieser Elemente, wird der Beitrag nicht veröffentlicht.</p>
        </div>
        <div class="field">
          <label>Welche Kanäle und Formate sollen wir für Sie bespielen?</label>
          <label class="check"><input type="checkbox" name="igFeedEnabled" ${c.igFeedEnabled !== false ? "checked" : ""}><span>Instagram Feed-Beiträge</span></label>
          <label class="check"><input type="checkbox" name="igStoryEnabled" ${c.igStoryEnabled !== false ? "checked" : ""}><span>Instagram Storys</span></label>
          <label class="check"><input type="checkbox" name="linkedinEnabled" ${c.linkedinEnabled !== false ? "checked" : ""}><span>LinkedIn-Beiträge</span></label>
          <p class="hint">Ein abgeschalteter Kanal wird nie bespielt, auch wenn er verbunden ist.</p>
        </div>
        <label class="check"><input type="checkbox" name="approvalMode" ${c.approvalMode ? "checked" : ""}><span>Beiträge vor Veröffentlichung freigeben - bevor etwas online geht, prüfen Sie es im Dashboard und geben es frei.</span></label>
        <p class="hint under-check">Ohne Ihre Freigabe wird nichts veröffentlicht. Wir bereiten Beiträge vor, Sie sehen sie unter „Vorschau“ und „Warten auf Ihre Freigabe“, und geben sie frei, sobald Sie zufrieden sind - danach wird in der Regel innerhalb weniger Minuten veröffentlicht.</p>
        <label class="check"><input type="checkbox" name="notifyOnPublish" ${c.notifyOnPublish ? "checked" : ""}><span>Ich möchte eine E-Mail bekommen, wenn ein Beitrag veröffentlicht wird${c.approvalMode ? " (bzw. sobald ein neuer Beitrag auf meine Freigabe wartet)" : ""}.</span></label>
        <p class="hint under-check">Optional, standardmäßig aus - Sie bekommen dann bei jeder tatsächlichen Veröffentlichung sofort eine kurze E-Mail.</p>
        <label class="check"><input type="checkbox" name="notifyWeeklyReport" ${c.notifyWeeklyReport ? "checked" : ""}><span>Ich möchte einmal pro Woche einen Analytics-Bericht per E-Mail bekommen (Kennzahlen + kurze Einordnung).</span></label>
        <p class="hint under-check">Optional, standardmäßig aus - unabhängig von der Benachrichtigung oben.</p>
        <label class="check"><input type="checkbox" name="commentAutomationEnabled" ${c.commentAutomationEnabled ? "checked" : ""}><span>Instagram-Kommentare automatisch mit KI beantworten.</span></label>
        <p class="hint under-check">Nur echte Fragen bekommen eine Antwort - Lob, neutrale Kommentare, Spam und Hass-Kommentare werden immer übersprungen, nie beantwortet. Standardmäßig aus.</p>
        <div class="field">
          <label>Wie soll mit den generierten Antworten umgegangen werden?</label>
          <label class="check"><input type="radio" name="commentAutomationMode" value="approval" ${(c.commentAutomationMode || "approval") === "approval" ? "checked" : ""}><span>Erst zur Freigabe vorlegen - Sie sehen jede Antwort vorher und geben sie frei.</span></label>
          <label class="check"><input type="radio" name="commentAutomationMode" value="auto" ${c.commentAutomationMode === "auto" ? "checked" : ""}><span>Automatisch abschicken - Antworten werden direkt nach der Generierung veröffentlicht.</span></label>
          <p class="hint">Gilt nur, wenn die Kommentar-Automatisierung oben eingeschaltet ist.</p>
        </div>
        <div class="grid2">
          <div class="field">
            <label for="f-hashtagPreference">Hashtags</label>
            <select id="f-hashtagPreference" name="hashtagPreference">${Object.entries(HASHTAGS).map(([k, v]) => `<option value="${k}" ${(c.hashtagPreference || "wenige") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          </div>
          <div class="field">
            <label for="f-language">Sprache der Beiträge</label>
            <select id="f-language" name="language">${Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}" ${(c.language || "de") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
          </div>
        </div>
        <label class="check"><input type="checkbox" name="emojisEnabled" ${c.emojisEnabled !== false ? "checked" : ""}><span>Emojis in Beiträgen verwenden</span></label>
        ${edit ? "" : `
        <label class="check"><input type="checkbox" name="consent" id="f-consent">
          <span>Ich stimme zu, dass Pipeline AI Solutions meine Angaben und die Freigaben der verbundenen Konten speichert, um in meinem Namen Beiträge zu veröffentlichen. Ich kann das jederzeit widerrufen. <a href="${esc(CONFIG.privacyUrl)}" target="_blank" rel="noopener">Datenschutzerklärung</a></span>
        </label>
        ${S.turnstileSiteKey ? `<div class="field"><div id="turnstile-widget"></div></div>` : ""}`}`;

    const actionsHtml = !twoPart
      ? `<div class="actions" style="margin-top:${edit ? 32 : 0}px"><button class="btn" type="submit">${edit ? "Speichern und weiter" : `Weiter zu ${esc(S.providers[0]?.name || "den Kanälen")}`}</button></div>`
      : formPartActionsHtml(part);

    return `
      ${introHtml}
      ${bannerHtml()}
      <h1>${edit ? "Ihr Unternehmen" : "Social Media, das von selbst läuft."}</h1>
      ${!edit && twoPart ? `<p class="steplabel" id="steplabel">${formPartLabel(part)}</p>` : ""}
      <p class="lede" id="lede">${edit ? "Ändern Sie hier, worüber wir für Sie posten." : formPartLede(part)}</p>
      <form id="company" novalidate>
        ${twoPart ? `<div id="formpart-a" ${part !== 1 ? "hidden" : ""}>${partAHtml}</div><div id="formpart-b" ${part !== 2 ? "hidden" : ""}>${partBHtml}</div>` : partAHtml + partBHtml}
        ${edit ? "" : firstPostPreviewHtml()}
        <div id="formpart-actions">${actionsHtml}</div>
      </form>
      ${!edit ? recoverAccessHtml() : ""}`;
  }

  /* ================= Einstellungen (Panel v11) =================
     Ersetzt fuer eingerichtete Kunden das Bearbeiten ueber den Onboarding-Schritt "Unternehmen".
     Alle Felder liegen weiterhin in EINEM <form id="company"> - der bestehende Speichern-Pfad
     (submit-Handler + PATCH /api/me mit allen Feldern gleichzeitig) bleibt damit unveraendert,
     nur die Reihenfolge/Gruppierung ist neu. Jede Einstellung existiert genau einmal und genau
     hier; das Onboarding-Formular (companyHtml) zeigt sie nur noch bei der Erstanmeldung.
     Der Konto-Block steht bewusst AUSSERHALB des Formulars: er enthaelt nur Aktionen
     (Zugangslink/Abmelden/Loeschen), die nie mitgespeichert werden sollen. */
  /* Aus Panel v21/v22 uebernommen (Merge 15.09.2026): dieselben Feldnamen wie vorher, aber in den
     Komponenten des neuen Panels - .choices statt zweier Radio-Zeilen, .daypicker statt der
     alten Kaestchen-Reihe, kuerzere Erklaerungen. Wichtig ist vor allem, dass die Felder
     ueberhaupt im Formular stehen: PATCH /api/me sendet das ganze Briefing, ein fehlendes Feld
     wuerde die Einstellung beim naechsten Speichern stillschweigend zuruecksetzen. */
  function googleReviewSettingsHtml(c) {
    if (!prov("google")) return "";
    const missing = !conn("google");
    const dis = missing ? " disabled" : "";
    return `
      <label class="check${missing ? " is-disabled" : ""}"><input type="checkbox" name="googleReviewAutomationEnabled" ${c.googleReviewAutomationEnabled ? "checked" : ""}${dis}><span>Google-Bewertungen automatisch mit KI beantworten</span></label>
      ${missing
        ? `<p class="locked">Dafür muss Ihr Google-Unternehmensprofil verbunden sein. <button type="button" class="link" data-go="google">Jetzt verbinden</button>.</p>`
        : `<span class="consequence"><strong>Jede</strong> Bewertung bekommt eine Antwort - auch schlechte. Auf Kritik wird sachlich geantwortet, nie gestritten.</span>`}
      <div class="field">
        <label>Wie mit den Antworten umgehen?</label>
        <div class="choices">
          <label class="choice"><input type="radio" name="googleReviewMode" value="approval" ${(c.googleReviewMode || "approval") === "approval" ? "checked" : ""}${dis}><span><strong>Erst zur Freigabe</strong><em>Sie sehen jede Antwort vorher.</em></span></label>
          <label class="choice"><input type="radio" name="googleReviewMode" value="auto" ${c.googleReviewMode === "auto" ? "checked" : ""}${dis}><span><strong>Automatisch abschicken</strong><em>Antworten gehen sofort online, höchstens 10 pro Stunde.</em></span></label>
        </div>
      </div>
      <label class="check${missing ? " is-disabled" : ""}"><input type="checkbox" name="googleReviewPostsEnabled" ${c.googleReviewPostsEnabled ? "checked" : ""}${dis}><span>Aus guten Bewertungen Beitragsvorschläge erstellen</span></label>
      <span class="consequence">Der Vorschlag geht <strong>immer</strong> erst zu Ihrer Freigabe.</span>
      <div class="field">
        <label for="f-googleReviewPostMinStars">Ab wie vielen Sternen?</label>
        <select id="f-googleReviewPostMinStars" name="googleReviewPostMinStars"${dis}>
          <option value="5" ${Number(c.googleReviewPostMinStars) === 5 ? "selected" : ""}>Nur 5 Sterne</option>
          <option value="4" ${Number(c.googleReviewPostMinStars || 4) === 4 ? "selected" : ""}>Ab 4 Sternen</option>
          <option value="3" ${Number(c.googleReviewPostMinStars) === 3 ? "selected" : ""}>Ab 3 Sternen</option>
        </select>
        <p class="hint">Ob ein Bewertungstext weiterveröffentlicht werden darf, hängt vom Einzelfall ab - das ist ein Hinweis, keine Rechtsberatung.</p>
      </div>`;
  }

  function videoSettingsHtml(c) {
    // Erst anzeigen, wenn der Server die Funktion ueberhaupt kennt (/api/providers liefert dann
    // videoVoices). Solange Produktion noch den Stand vor dem Merge laeuft, bleibt der Block weg,
    // statt ein leeres Stimmen-Auswahlfeld zu zeigen.
    if (!(S.videoVoices || []).length) return "";
    const voices = S.videoVoices || [];
    const chosenVoice = c.videoVoice || (voices[0] && voices[0].id) || "";
    const lengths = S.videoLengths || [5, 10, 15];
    const igMissing = !conn("instagram");
    return `
      <label class="check${igMissing ? " is-disabled" : ""}"><input type="checkbox" name="videoEnabled" ${c.videoEnabled ? "checked" : ""} ${igMissing ? "disabled" : ""}><span>Video-Diashows automatisch erstellen</span></label>
      ${igMissing
        ? `<p class="locked">Dafür muss Instagram verbunden sein. <button type="button" class="link" data-go="instagram">Jetzt verbinden</button>.</p>`
        : `<span class="consequence">Videos laufen nach ihrem eigenen Zeitplan - ohne angehakten Tag entsteht keines.</span>`}
      <fieldset class="field">
        <legend>Tage für Videos</legend>
        <div class="daypicker" data-weekday-channel="video">${WEEKDAYS.map((label, i) => `<label><input type="checkbox" value="${i + 1}" ${(c.videoWeekdays || "").split(",").includes(String(i + 1)) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
      </fieldset>
      <div class="grid2">
        <div class="field">
          <label for="f-videoPostTime">Um wie viel Uhr? <span class="opt">(optional)</span></label>
          <input id="f-videoPostTime" name="videoPostTime" type="time" value="${esc(c.videoPostTime || "")}" step="900">
          <p class="hint">Leer = wie Ihre Beiträge (${esc(c.postTime || "15:00")} Uhr).</p>
        </div>
        <div class="field">
          <label for="f-videoLengthSeconds">Wie lang?</label>
          <select id="f-videoLengthSeconds" name="videoLengthSeconds">
            ${lengths.map((l) => `<option value="${l}" ${Number(c.videoLengthSeconds || 10) === l ? "selected" : ""}>${l} Sekunden</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="grid2">
        <div class="field">
          <label for="f-videoZoomDirection">Bildbewegung</label>
          <select id="f-videoZoomDirection" name="videoZoomDirection">
            <option value="alternate" ${(c.videoZoomDirection || "alternate") === "alternate" ? "selected" : ""}>Abwechselnd</option>
            <option value="in" ${c.videoZoomDirection === "in" ? "selected" : ""}>Langsam hinein</option>
            <option value="out" ${c.videoZoomDirection === "out" ? "selected" : ""}>Langsam heraus</option>
          </select>
        </div>
        <div class="field">
          <label for="f-videoVoice">Stimme</label>
          <select id="f-videoVoice" name="videoVoice">
            ${voices.map((v) => `<option value="${esc(v.id)}" ${chosenVoice === v.id ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
          </select>
          <p class="hint" id="voice-desc">${esc((voices.find((v) => v.id === chosenVoice) || {}).description || "")}</p>
          ${S.voicePreviewAvailable
            ? `<p class="hint"><button type="button" class="link" id="voice-preview">Stimme anhören</button> <span id="voice-preview-state"></span></p>`
            : ""}
        </div>
      </div>
      <label class="check"><input type="checkbox" name="videoVoiceEnabled" ${c.videoVoiceEnabled !== false ? "checked" : ""}><span>Text im Video vorlesen lassen</span></label>
      <span class="consequence">Der Text steht <strong>immer auch im Bild</strong> - ohne Sprachausgabe entsteht dasselbe Video stumm.</span>`;
  }

  const SETTINGS_GROUPS = [
    { id: "unternehmen", label: "Mein Unternehmen" },
    { id: "aussehen", label: "Aussehen" },
    { id: "inhalt", label: "Inhalt & Sprache" },
    { id: "kanaele", label: "Kanäle & Zeitplan" },
    { id: "automatik", label: "Freigaben & Automatik" },
    { id: "mail", label: "Benachrichtigungen" },
    { id: "konto", label: "Konto" },
  ];

  /** True, wenn die Instagram-Verbindung die erst in v10 ergaenzte Kommentar-Berechtigung noch
   *  nicht hat - aeltere Verbindungen haben sie nie erteilt bekommen und muessen einmal neu
   *  verbunden werden, sonst laeuft die Kommentar-Automatisierung ins Leere. */
  function commentScopeMissing() {
    const ig = conn("instagram");
    if (!ig) return true;
    return !(ig.scopes || []).includes("instagram_business_manage_comments");
  }

  function settingsHtml() {
    const c = S.customer;
    S.pillarsDraft = (c.contentPillars || []).map((p) => ({ title: p.title || "", description: p.description || "", weight: p.weight || 1 }));
    const igMissing = commentScopeMissing();
    const trialLine = c.trialExpired
      ? "Ihr Testzeitraum ist abgelaufen - aktuell wird nichts automatisch veröffentlicht."
      : c.trialDaysLeft != null
        ? `Testzeitraum: noch ${c.trialDaysLeft} ${c.trialDaysLeft === 1 ? "Tag" : "Tage"}.`
        : "Ihr Zugang ist unbefristet freigeschaltet.";

    const group = (id, lede, body) => {
      const g = SETTINGS_GROUPS.find((x) => x.id === id);
      return `<section class="setgroup" id="setgroup-${id}" data-group="${id}">
        <h2>${esc(g.label)}</h2>
        <p class="setgroup-lede">${lede}</p>
        ${body}
      </section>`;
    };

    return `
      ${bannerHtml()}
      ${emailVerifyBannerHtml(c)}
      <h1>Einstellungen</h1>
      <p class="lede">Sieben Gruppen. Suchen geht auch.</p>
      <div class="settings-layout" id="set-layout" data-mobile-group="${esc(S.settingsGroup || "")}">
        <aside class="set-side">
          <ul style="list-style:none;margin:0;padding:0">${SETTINGS_GROUPS.map((g) => `<li><button type="button" data-setjump="${g.id}">${esc(g.label)}</button></li>`).join("")}</ul>
        </aside>
        <div>
          <!-- Mobil: Gruppenliste wie in den iOS-Einstellungen. Die Gruppen selbst bleiben dabei
               IMMER im DOM (nur ausgeblendet) - das Formular sendet alle Felder gemeinsam an
               PATCH /api/me, ein Entfernen wuerde stillschweigend Werte verlieren. -->
          <nav class="set-list" aria-label="Einstellungs-Gruppen">
            ${SETTINGS_GROUPS.map((g) => `<button type="button" data-setgroup="${g.id}">${esc(g.label)}${icon("chevron", 12)}</button>`).join("")}
          </nav>
          <button type="button" class="link set-back" data-setgroup="">Zurück zu allen Einstellungen</button>
          <div class="set-search">
            <label class="vh" for="set-search-input">Einstellung suchen</label>
            ${`<input id="set-search-input" type="search" placeholder="Einstellung suchen" autocomplete="off" value="${esc(S.settingsQuery)}">`}
          </div>
          <form id="company" novalidate>
            ${group("unternehmen", "Die Grundlage für jeden generierten Text.", `
              <div class="grid2">
                <div class="field">
                  <label for="f-company">Firmenname</label>
                  ${`<input id="f-company" name="company" type="text" value="${esc(c.company)}" required autocomplete="organization">`}
                </div>
                <div class="field">
                  <label for="f-website">Website <span class="opt">(optional)</span></label>
                  <input id="f-website" name="website" type="url" value="${esc(c.website)}" autocomplete="url" placeholder="https://">
                  ${S.aiAvailable ? `<p class="hint"><button type="button" class="link" id="analyze-website">Vorschlag aus meiner Website holen</button></p>` : ""}
                </div>
                <div class="field">
                  <label for="f-contactName">Ihr Name</label>
                  ${`<input id="f-contactName" name="contactName" type="text" value="${esc(c.contactName)}" required autocomplete="name">`}
                </div>
                <div class="field">
                  <label for="f-email">E-Mail</label>
                  <input id="f-email" name="email" type="email" value="${esc(c.email)}" required autocomplete="email">
                </div>
              </div>
              <div id="website-suggestion" hidden></div>
              <div class="field">
                <label for="f-industry">Branche <span class="opt">(optional)</span></label>
                ${`<input id="f-industry" name="industry" type="text" value="${esc(c.industry)}" placeholder="z. B. Physiotherapie, Tischlerei, Steuerberatung">`}
              </div>
              <div class="field">
                <label for="f-about">Worum soll es in den Beiträgen gehen?</label>
                ${withDictate(`<textarea id="f-about" name="about" placeholder="Stichworte reichen.">${esc(c.about)}</textarea>`)}
                <p class="hint">Je konkreter, desto besser passen die Beiträge.${S.aiAvailable ? ` <button type="button" class="link" id="ai-improve">Mit KI verbessern</button>` : ""}</p>
                <div id="ai-suggestion" hidden></div>
              </div>
              <div class="field">
                <label for="f-tone">Tonalität</label>
                <select id="f-tone" name="tone">${Object.entries(TONES).map(([k, v]) => `<option value="${k}" ${c.tone === k ? "selected" : ""}>${v}</option>`).join("")}</select>
              </div>`)}

            ${group("aussehen", "Wie Ihre generierten Bilder aussehen: Farbe, Verlauf, Schriftart, Beschriftung, Logo.", `
              <div class="grid2">
                <div class="field">
                  <label for="f-accentColor">Akzentfarbe für Ihre Bilder <span class="opt">(optional)</span></label>
                  <div class="colorrow">
                    <input id="f-accentColor" name="accentColor" type="color" value="${esc(c.accentColor || "#0a0e1a")}">
                    <input type="text" value="${esc(c.accentColor || "")}" placeholder="Standard" readonly aria-hidden="true" tabindex="-1">
                  </div>
                  <div class="swatches" role="group" aria-label="Vorschläge">
                    ${PALETTE.map((hex) => `<button type="button" class="swatch" data-swatch="${hex}" aria-pressed="${c.accentColor === hex}" style="background:${hex}" aria-label="${hex}"></button>`).join("")}
                  </div>
                  <p class="hint">Bestimmt den Hintergrund Ihrer generierten Bilder. Leer lassen für unser Standard-Design.${c.activeThemeId ? " <strong>Hinweis: Aktuell wird stattdessen Ihr aktives Farbthema verwendet.</strong>" : ""}</p>
                </div>
                <div class="field">
                  <label for="f-watermarkText">Beschriftung im Bild <span class="opt">(optional)</span></label>
                  ${`<input id="f-watermarkText" name="watermarkText" type="text" value="${esc(c.watermarkText || "")}" placeholder="${esc(c.company || "Ihr Firmenname")}">`}
                  <p class="hint">Erscheint klein am Bildrand. Leer lassen, um Ihren Firmennamen zu verwenden.</p>
                  <div class="lp-square" id="lp-square" style="background:${esc(c.accentColor || "#0a0e1a")}">
                    <span class="lp-headline" id="lp-headline" style="font-family:'${esc(fontOption(c.fontChoice).cssFamily)}'">Ihr Beitrag</span>
                    <span class="lp-watermark" id="lp-watermark" style="font-family:'${esc(fontOption(c.fontChoice).cssFamily)}'">${esc(c.watermarkText || c.company || "Pipeline")}</span>
                  </div>
                </div>
              </div>
              <div class="field">
                <label class="check"><input type="checkbox" id="f-gradientEnabled" name="gradientEnabled" ${c.gradientEnabled ? "checked" : ""}><span>Farbverlauf statt Einzelfarbe verwenden</span></label>
                <div id="gradient-options" ${c.gradientEnabled ? "" : "hidden"}>
                  <div class="grid2">
                    <div class="field">
                      <label for="f-gradientColor2">Zweite Farbe</label>
                      <div class="colorrow">
                        <input id="f-gradientColor2" name="gradientColor2" type="color" value="${esc(c.gradientColor2 || "#137A3F")}">
                        <input type="text" value="${esc(c.gradientColor2 || "")}" placeholder="Wählen" readonly aria-hidden="true" tabindex="-1">
                      </div>
                      <div class="swatches" id="gradient-suggestions" role="group" aria-label="Passende Verlauf-Vorschläge"></div>
                      <p class="hint">Automatische Vorschläge passend zu Ihrer Akzentfarbe - oder frei wählen.</p>
                    </div>
                    <div class="field">
                      <label for="f-gradientDirection">Richtung</label>
                      <select id="f-gradientDirection" name="gradientDirection">
                        ${Object.entries(GRADIENT_DIRECTIONS).map(([k, v]) => `<option value="${k}" ${(c.gradientDirection || "diagonal") === k ? "selected" : ""}>${v}</option>`).join("")}
                      </select>
                      <p class="hint">Wirkt überall dort, wo bisher die Akzentfarbe stand: Bild-Hintergründe, Wasserzeichen-Fläche, Karussell-Slides.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="field">
                <label for="f-fontChoice">Schriftart für Text auf Bildern</label>
                <select id="f-fontChoice" name="fontChoice">
                  ${FONT_OPTIONS.map((f) => `<option value="${f.id}" ${(c.fontChoice || "inter") === f.id ? "selected" : ""}>${esc(f.label)} — ${esc(f.styleNote)}</option>`).join("")}
                </select>
                <p class="hint">Gilt für Headline, Wasserzeichen und Karussell-Texte. Vorschau oben im Kasten rechts.</p>
              </div>
              <div class="field" id="themes-section">${themesSectionHtml(c)}</div>
              <div class="field" id="logo-section">${logoSectionHtml(c)}</div>`)}

            ${group("inhalt", "Worüber und wie geschrieben wird - Themen, Sprache und harte Grenzen für jeden Text.", `
              <div class="field" id="pillars-section">${renderPillarsSection()}</div>
              <div class="grid2">
                <div class="field">
                  <label for="f-ctaPreference">Bevorzugter Aufruf am Ende des Beitrags</label>
                  <select id="f-ctaPreference" name="ctaPreference">${Object.entries(CTAS).map(([k, v]) => `<option value="${k}" ${(c.ctaPreference || "link_bio") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
                </div>
                <div class="field">
                  <label for="f-hashtagPreference">Hashtags</label>
                  <select id="f-hashtagPreference" name="hashtagPreference">${Object.entries(HASHTAGS).map(([k, v]) => `<option value="${k}" ${(c.hashtagPreference || "wenige") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
                </div>
                <div class="field">
                  <label for="f-language">Sprache der Beiträge</label>
                  <select id="f-language" name="language">${Object.entries(LANGUAGES).map(([k, v]) => `<option value="${k}" ${(c.language || "de") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
                </div>
              </div>
              <label class="check"><input type="checkbox" name="emojisEnabled" ${c.emojisEnabled !== false ? "checked" : ""}><span>Emojis in Beiträgen verwenden</span></label>
              <div class="field" style="margin-top:22px">
                <label for="f-requiredElements">Muss in jedem Beitrag vorkommen <span class="opt">(optional, kommagetrennt)</span></label>
                ${`<input id="f-requiredElements" name="requiredElements" type="text" value="${esc(c.requiredElements || "")}" placeholder="z. B. #IhrHashtag, @IhrHandle">`}
                <p class="hint">Fehlt eines dieser Elemente, wird der Beitrag nicht veröffentlicht.</p>
              </div>
              <div class="field">
                <label for="f-bannedWords">Wörter, die NIE vorkommen dürfen <span class="opt">(optional, kommagetrennt)</span></label>
                ${`<input id="f-bannedWords" name="bannedWords" type="text" value="${esc(c.bannedWords || "")}" placeholder="z. B. billig, Konkurrenzname, Rabatt">`}
                <p class="hint"><strong>Wird automatisch blockiert, nicht nur vermieden:</strong> ein Beitrag mit einem dieser Wörter wird gar nicht erst veröffentlicht.</p>
              </div>
              <div class="field">
                <label for="f-avoidTopics">Was sollen wir vermeiden? <span class="opt">(optional)</span></label>
                ${`<input id="f-avoidTopics" name="avoidTopics" type="text" value="${esc(c.avoidTopics || "")}" placeholder="z. B. keine Preise nennen, kein Humor">`}
                <p class="hint">Eine Bitte an die KI - wird berücksichtigt, aber nicht hart erzwungen.</p>
              </div>`)}

            ${group("kanaele", "Wo und wann veröffentlicht wird.", `
              <div class="field">
                <label>Welche Kanäle und Formate sollen wir für Sie bespielen?</label>
                <label class="check"><input type="checkbox" name="igFeedEnabled" ${c.igFeedEnabled !== false ? "checked" : ""}><span>Instagram Feed-Beiträge</span></label>
                <label class="check"><input type="checkbox" name="igStoryEnabled" ${c.igStoryEnabled !== false ? "checked" : ""}><span>Instagram Storys</span></label>
                <label class="check"><input type="checkbox" name="linkedinEnabled" ${c.linkedinEnabled !== false ? "checked" : ""}><span>LinkedIn-Beiträge</span></label>
              </div>
              <div class="grid2">
                <div class="field">
                  <label for="f-carouselSlideCount">Bilder pro Karussell/Video-Diashow</label>
                  <input id="f-carouselSlideCount" name="carouselSlideCount" type="number" min="${CAROUSEL_MIN_SLIDES}" max="${CAROUSEL_MAX_SLIDES}" step="1" value="${esc(String(c.carouselSlideCount ?? 5))}">
                  <p class="hint">${CAROUSEL_MIN_SLIDES}-${CAROUSEL_MAX_SLIDES} Bilder, gilt für "Jetzt posten" und die automatische Routine.</p>
                </div>
                <div class="field">
                  <label for="f-carouselAutoFrequency">Karussell/Video-Diashow in der täglichen Routine</label>
                  <select id="f-carouselAutoFrequency" name="carouselAutoFrequency">
                    <option value="off" ${(c.carouselAutoFrequency || "off") === "off" ? "selected" : ""}>Aus - nur Einzelbilder</option>
                    <option value="weekly" ${c.carouselAutoFrequency === "weekly" ? "selected" : ""}>Etwa einmal pro Woche</option>
                    <option value="always" ${c.carouselAutoFrequency === "always" ? "selected" : ""}>Immer statt Einzelbild</option>
                  </select>
                  <p class="hint">Bei „Jetzt posten" wählen Sie das Format jedes Mal selbst.</p>
                </div>
              </div>
              <fieldset class="field">
                <legend>Tage für Instagram</legend>
                <div class="daypicker" data-weekday-channel="instagram">${WEEKDAYS.map((label, i) => `<label><input type="checkbox" value="${i + 1}" ${weekdaysFor(c.instagramWeekdays, c.frequency).includes(i + 1) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
              </fieldset>
              <fieldset class="field">
                <legend>Tage für LinkedIn</legend>
                <div class="daypicker" data-weekday-channel="linkedin">${WEEKDAYS.map((label, i) => `<label><input type="checkbox" value="${i + 1}" ${weekdaysFor(c.linkedinWeekdays, c.frequency).includes(i + 1) ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>
              </fieldset>
              <p class="hint">Jeder aktive Tag ergibt einen Beitrag.</p>
              <div class="grid2">
                <div class="field">
                  <label for="f-postTime">Um wie viel Uhr?</label>
                  <input id="f-postTime" name="postTime" type="time" value="${esc(c.postTime || "15:00")}" step="900">
                </div>
                <div class="field">
                  <label for="f-pauseFrom">Pause/Urlaub von <span class="opt">(optional)</span></label>
                  <input id="f-pauseFrom" name="pauseFrom" type="date" value="${esc(c.pauseFrom || "")}">
                </div>
              </div>
              <div class="field">
                <label for="f-pauseUntil">Pause/Urlaub bis <span class="opt">(optional)</span></label>
                <input id="f-pauseUntil" name="pauseUntil" type="date" value="${esc(c.pauseUntil || "")}">
                <p class="hint">In diesem Zeitraum wird für Sie nichts veröffentlicht.</p>
              </div>
              <div class="field">
                <label>Posting vorübergehend anhalten</label>
                <p class="hint" style="margin:0 0 10px">${c.customerPaused ? "Aktuell pausiert - es wird nichts veröffentlicht, bis Sie fortsetzen." : "Läuft. Anhalten geht jederzeit."}</p>
                <button type="button" class="link" id="toggle-pause">${c.customerPaused ? "Posting fortsetzen" : "Posting pausieren"}</button>
              </div>
              ${videoSettingsHtml(c) ? `<div class="field"><h3>Video-Diashow</h3>${videoSettingsHtml(c)}</div>` : ""}`)}

            ${group("automatik", "Was ohne Ihr Zutun passiert - und was vorher über Ihren Tisch geht.", `
              <label class="check"><input type="checkbox" name="approvalMode" ${c.approvalMode ? "checked" : ""}><span>Beiträge vor Veröffentlichung freigeben</span></label>
              <span class="consequence">${c.approvalMode
                ? "Aktuell an: <strong>ohne Ihre Freigabe geht nichts online.</strong> Vorbereitete Beiträge warten auf der Übersicht auf Sie."
                : "Aktuell aus: <strong>Beiträge gehen automatisch online</strong>, ohne dass Sie sie vorher sehen."}</span>
              <label class="check${igMissing ? " is-disabled" : ""}"><input type="checkbox" name="commentAutomationEnabled" ${c.commentAutomationEnabled ? "checked" : ""} ${igMissing ? "disabled" : ""}><span>Instagram-Kommentare automatisch mit KI beantworten</span></label>
              ${igMissing
                ? `<p class="locked">Dafür fehlt der Instagram-Verbindung noch die Berechtigung zum Lesen und Beantworten von Kommentaren. <button type="button" class="link" data-go="instagram">Instagram einmal neu verbinden</button>, danach lässt sich das hier einschalten.</p>`
                : `<span class="consequence">Nur echte Fragen bekommen eine Antwort. Lob, neutrale Kommentare, Spam und Hass-Kommentare werden <strong>immer übersprungen</strong>, nie beantwortet.</span>`}
              <div class="field">
                <label>Wie mit den Antworten umgehen?</label>
                <div class="choices">
                  <label class="choice"><input type="radio" name="commentAutomationMode" value="approval" ${(c.commentAutomationMode || "approval") === "approval" ? "checked" : ""} ${igMissing ? "disabled" : ""}><span><strong>Erst zur Freigabe</strong><em>Sie sehen jede Antwort vorher.</em></span></label>
                  <label class="choice"><input type="radio" name="commentAutomationMode" value="auto" ${c.commentAutomationMode === "auto" ? "checked" : ""} ${igMissing ? "disabled" : ""}><span><strong>Automatisch abschicken</strong><em>Antworten gehen sofort online.</em></span></label>
                </div>
                ${c.commentAutomationEnabled && c.commentAutomationMode === "auto"
                  ? `<span class="consequence" style="margin-top:10px">Aktuell automatisch: Antworten gehen <strong>sofort und ungeprüft</strong> unter Ihrem Namen online (höchstens 10 pro Stunde).</span>`
                  : ""}
              </div>              ${googleReviewSettingsHtml(c) ? `<div class="field"><h3>Google-Bewertungen</h3>${googleReviewSettingsHtml(c)}</div>` : ""}
`)}

            ${group("mail", "Alle E-Mails an einer Stelle. Standardmäßig ist alles aus - Sie bekommen nur, was Sie hier anhaken.", `
              <label class="check"><input type="checkbox" name="notifyOnPublish" ${c.notifyOnPublish ? "checked" : ""}><span>E-Mail, wenn ein Beitrag veröffentlicht wird${c.approvalMode ? " (bzw. sobald einer auf Ihre Freigabe wartet)" : ""}</span></label>
              <label class="check"><input type="checkbox" name="notifyWeeklyReport" ${c.notifyWeeklyReport ? "checked" : ""}><span>Einmal pro Woche ein Analytics-Bericht per E-Mail (Kennzahlen + kurze Einordnung)</span></label>`)}

            <div class="actions" style="margin-top:8px"><button class="btn" type="submit">Änderungen speichern</button></div>
          </form>

          ${group("konto", "Verbindungen, Zugang und Ihr Konto. Änderungen hier wirken sofort, ohne Speichern.", `
            <h3 style="margin-bottom:10px">Verbundene Kanäle</h3>
            ${channelsSummaryHtml()}
            <h3 style="margin-bottom:6px">Status</h3>
            <p class="hint" style="margin:0 0 22px">${esc(trialLine)}</p>
            <h3 style="margin-bottom:6px">Zugang auf anderen Geräten</h3>
            <p class="hint" style="margin:0 0 10px">Auf diesem Gerät bleiben Sie angemeldet. Für ein anderes Gerät erzeugen Sie einen persönlichen Link - behandeln Sie ihn wie ein Passwort, ein neuer Link ersetzt den alten.</p>
            <div id="linkbox"><button type="button" class="link" id="mklink">Persönlichen Link erzeugen</button></div>
            <div class="actions" style="margin-top:16px">
              <button type="button" class="link" id="logout">Abmelden</button>
              <button type="button" class="link" id="delete-account" style="color:var(--stop)">Konto und Daten löschen</button>
            </div>
            <p class="hint">Löschen entfernt Angaben, verbundene Kanäle und den Beitrags-Verlauf endgültig.</p>`)}
          <p class="set-noresult" id="set-noresult" hidden>Dazu gibt es keine Einstellung. Versuchen Sie es mit einem anderen Wort - oder fragen Sie im Hilfe-Chat unten rechts.</p>
        </div>
      </div>`;
  }

  /* ================= Was kann Pipeflow? (Panel v11) =================
     Dauerhaft ueber die Navigation erreichbar, nicht nur einmalig beim ersten Login. Jede Funktion
     bekommt genau einen Satz und einen Link genau dorthin, wo man sie benutzt/einstellt - damit
     niemand mehr raten muss, was das Produkt kann. "aktuell aus" steht dort, wo eine Funktion beim
     Kunden gerade abgeschaltet ist; nicht nutzbare Funktionen (fehlende Berechtigung) sagen, was
     zu tun ist, statt still dazustehen. */
  function guideFeatures() {
    const c = S.customer;
    const igMissing = commentScopeMissing();
    return [
      { title: "Beiträge laufen von selbst", text: "An den Tagen und zur Uhrzeit, die Sie festlegen, entsteht automatisch ein Beitrag - Text und Bild inklusive.", go: "settings:kanaele", link: "Tage und Uhrzeit einstellen" },
      { title: "Die nächsten 7 Tage vorab sehen", text: "Alles, was vorbereitet ist, können Sie vorher lesen, den Text ändern, die Bildfarbe tauschen oder einen Beitrag überspringen.", go: "preview", link: "Vorschau ansehen" },
      { title: "Freigabe vor Veröffentlichung", text: "Auf Wunsch geht nichts online, bevor Sie es gesehen und freigegeben haben.", go: "settings:automatik", link: "Freigabe-Modus einstellen", off: !c.approvalMode },
      { title: "Sofort zu einem Thema posten", text: "Sie haben gerade etwas zu erzählen? Thema eingeben, Kanäle wählen - der Rest passiert automatisch.", go: "dashboard", link: "Auf der Übersicht" },
      { title: "Kommentare automatisch beantworten", text: igMissing
          ? "Echte Fragen unter Ihren Instagram-Beiträgen werden beantwortet, Hass und Spam nie. Dafür muss Instagram einmal neu verbunden werden."
          : "Echte Fragen unter Ihren Instagram-Beiträgen bekommen eine Antwort - Lob, Spam und Hass-Kommentare werden immer übersprungen.",
        go: "settings:automatik", link: igMissing ? "Was zu tun ist" : "Kommentar-Automatik einstellen", off: !c.commentAutomationEnabled },
      { title: "Content-Säulen", text: "Legen Sie Ihre festen Themenbereiche fest - die Beiträge wechseln sich dann sinnvoll zwischen ihnen ab, statt sich zu wiederholen.", go: "settings:inhalt", link: "Säulen bearbeiten" },
      { title: "Ihr Aussehen", text: "Akzentfarbe, Beschriftung, eigenes Logo und gespeicherte Farbthemen bestimmen, wie Ihre Bilder aussehen.", go: "settings:aussehen", link: "Aussehen ändern" },
      { title: "Harte Grenzen für jeden Text", text: "Wörter, die nie vorkommen dürfen, und Elemente, die immer vorkommen müssen - beides wird erzwungen, nicht nur gewünscht.", go: "settings:inhalt", link: "Grenzen festlegen" },
      { title: "Zahlen zu Ihrem Instagram-Konto", text: "Follower, Reichweite und Ihre besten Beiträge der letzten 30 Tage, dazu eine kurze Einordnung in einfacher Sprache. Für LinkedIn gibt es das nicht.", go: "analytics", link: "Analytics ansehen" },
      { title: "Wochenbericht per E-Mail", text: "Einmal pro Woche die wichtigsten Kennzahlen ins Postfach, ohne sich einloggen zu müssen.", go: "settings:mail", link: "E-Mails einstellen", off: !c.notifyWeeklyReport },
      { title: "Alles, was schon veröffentlicht wurde", text: "Der vollständige Verlauf Ihrer Beiträge mit Bild, Text und Zeitpunkt.", go: "history", link: "Verlauf öffnen" },
      { title: "Urlaub und Pause", text: "Für einen Zeitraum oder bis auf Weiteres anhalten - Ihre Einstellungen bleiben dabei erhalten.", go: "settings:kanaele", link: "Pause einstellen" },
      { title: "Website-Analyse und KI-Hilfe", text: "Aus Ihrer Website-Adresse einen Vorschlag für Ihre Beschreibung holen oder Stichworte in einen fertigen Text verwandeln.", go: "settings:unternehmen", link: "Beschreibung bearbeiten" },
      { title: "Hilfe-Chat", text: "Fragen zum Ablauf, zu Instagram/LinkedIn oder zu Ihren Zahlen beantwortet der Chat unten rechts jederzeit.", go: null, link: null },
    ];
  }

  function guideHtml() {
    return `
      ${bannerHtml()}
      <h1>Was kann Pipeflow?</h1>
      <p class="lede">Ein Überblick über alles, was für Sie möglich ist - mit dem direkten Weg dorthin. Diese Seite bleibt dauerhaft über die Navigation erreichbar.</p>
      <div class="actions" style="margin:-16px 0 32px"><button type="button" class="link" id="restart-tour">Kurzen Rundgang noch einmal starten</button></div>
      <div class="guide-grid">
        ${guideFeatures().map((f) => `
          <div class="guide-item${f.off ? " is-off" : ""}">
            <h3>${esc(f.title)}</h3>
            <p>${esc(f.text)}</p>
            ${f.go ? `<button type="button" class="link" data-guide-go="${esc(f.go)}">${esc(f.link)} →</button>` : ""}
          </div>`).join("")}
      </div>`;
  }

  /* ================= Erst-Rundgang (Panel v11) =================
     Wenige Schritte, jederzeit schliessbar, kein Zwang und keine Modal-Kette. Der Status liegt
     serverseitig (customers.tour_done_at, siehe /api/tour-done) - nicht im Browser-Speicher, weil
     genau das bei "Später verbinden" (skipped_providers) schon einmal die Fehlerursache war.
     Wiederholbar ueber "Was kann Pipeflow?". */
  const TOUR = [
    { title: "Willkommen - kurz gezeigt, wo was liegt", text: "Vier kurze Hinweise, dann kennen Sie sich aus. Sie können jederzeit abbrechen und den Rundgang später über „Was kann Pipeflow?“ wiederholen." },
    { title: "Übersicht", text: "Ihre Startseite: was als Nächstes online geht, was auf Ihre Freigabe wartet, die letzten Beiträge - und der Knopf, um sofort zu einem Thema zu posten." },
    { title: "Beiträge", text: "Hier sehen Sie die nächsten sieben Tage im Voraus und können Texte ändern oder Beiträge überspringen, bevor sie erscheinen. Daneben liegt der Verlauf." },
    { title: "Einstellungen", text: "Alles Änderbare an einem Ort, in sieben Gruppen - mit einem Suchfeld ganz oben. Wenn Sie etwas nicht finden: dort eintippen, zum Beispiel „Kommentar“ oder „Farbe“." },
  ];

  function renderTour() {
    const overlay = $("#tour-overlay");
    if (!overlay) return;
    if (S.tourIndex < 0) { overlay.hidden = true; return; }
    const step = TOUR[S.tourIndex];
    overlay.hidden = false;
    $("#tour-step").textContent = `Schritt ${S.tourIndex + 1} von ${TOUR.length}`;
    $("#tour-title").textContent = step.title;
    $("#tour-text").textContent = step.text;
    $("#tour-dots").innerHTML = TOUR.map((_, i) => `<i class="${i <= S.tourIndex ? "on" : ""}"></i>`).join("");
    $("#tour-next").textContent = S.tourIndex === TOUR.length - 1 ? "Fertig" : "Weiter";
  }

  async function endTour() {
    S.tourIndex = -1;
    renderTour();
    if (S.customer && !S.customer.tourDone) {
      try { applyState(await api("POST", "/api/tour-done")); } catch { /* nicht kritisch - beim naechsten Mal erneut */ }
    }
  }

  function formPartLabel(part) {
    return `Schritt ${part} von 2 · ${part === 1 ? "Über Sie" : "Ihr Stil"}`;
  }
  function formPartLede(part) {
    return part === 1 ? "Erzählen Sie uns, worum es bei Ihnen geht." : "Wie sollen Ihre Beiträge aussehen und klingen?";
  }
  function formPartActionsHtml(part) {
    return part === 1
      ? `<div class="formpart-nav"><button class="btn" type="button" data-formpart="2">Weiter: Ihr Stil</button></div>`
      : `<div class="formpart-nav"><button class="btn ghost" type="button" data-formpart="1">Zurück</button><button class="btn" type="submit">Weiter zu ${esc(S.providers[0]?.name || "den Kanälen")}</button></div>`;
  }

  /* ================= Cloudflare Turnstile (Panel v6, Aufgabe 2a) ================= */
  // Nur bei tatsaechlich konfiguriertem TURNSTILE_SITE_KEY ueberhaupt geladen/gerendert - ohne
  // Key existiert weder das Skript-Tag noch der Platzhalter-Div (siehe companyHtml()).
  let turnstileScriptRequested = false;
  let turnstileScriptFailed = false;
  let turnstileWidgetId = null;
  // Bugfix (Security/UX-Review 2026-09-13): nicht nur eine ID merken, sondern den DOM-Knoten
  // selbst - nach einem fehlgeschlagenen Signup-Versuch (z.B. Turnstile lehnt ab, Banned-Word,
  // Rate-Limit) rendert render(true) companyHtml() komplett neu, das alte #turnstile-widget-Div
  // wird durch ein NEUES, leeres ersetzt. Der reine ID-Guard dachte danach faelschlich "schon
  // gerendert" und liess das neue Div fuer immer leer - der Kunde konnte nie wieder absenden,
  // ohne die Seite manuell neu zu laden (siehe TURNSTILE_SETUP.md-Testprotokoll).
  let turnstileRenderedContainer = null;
  const TURNSTILE_LOAD_TIMEOUT_MS = 8_000;
  function loadTurnstileScript(cb) {
    if (window.turnstile) { cb(); return; }
    if (!turnstileScriptRequested) {
      turnstileScriptRequested = true;
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onerror = () => { turnstileScriptFailed = true; showTurnstileLoadError(); };
      document.head.appendChild(s);
    }
    const deadline = Date.now() + TURNSTILE_LOAD_TIMEOUT_MS;
    const check = () => {
      if (window.turnstile) { cb(); return; }
      if (turnstileScriptFailed || Date.now() > deadline) { showTurnstileLoadError(); return; }
      setTimeout(check, 100);
    };
    check();
  }
  // Bugfix (Security/UX-Review 2026-09-13, Punkt 1b): ohne dies blieb der Platzhalter bei einem
  // blockierten/fehlgeschlagenen Laden (Adblocker, Netzwerkfehler, Firmen-Firewall) einfach für
  // immer leer, ohne jede Erklärung - der Kunde wusste nicht, ob er warten, neu laden oder etwas
  // anderes tun sollte. Zeigt jetzt eine klare Erklärung direkt unter dem Platzhalter; das
  // Formular selbst bleibt nutzbar (das Absenden schlägt serverseitig ohnehin klar verständlich
  // fehl, siehe ERRORS.state/den generischen Sicherheitsprüfung-Fehler - kein zusätzlicher
  // Client-seitiger Block hier).
  function showTurnstileLoadError() {
    const container = document.getElementById("turnstile-widget");
    if (!container || container.querySelector(".turnstile-load-error")) return;
    const p = document.createElement("p");
    p.className = "turnstile-load-error";
    p.style.cssText = "font-size:14px;color:var(--stone);margin-top:8px";
    p.textContent = "Die Sicherheitsprüfung konnte nicht geladen werden - möglicherweise blockiert ein Werbe-/Trackingblocker challenges.cloudflare.com. Bitte deaktivieren Sie ihn für diese Seite oder versuchen Sie es in einem anderen Browser, und laden Sie die Seite danach neu.";
    container.appendChild(p);
  }
  // Explizit statt implizit gerendert (render=explicit + eigener render()-Aufruf hier), weil der
  // Platzhalter-Div erst auf Formular-Seite 2 sichtbar wird - ein automatisches Rendern beim
  // Laden waere noch versteckt (display:none von Seite 1) und wuerde sich nicht zuverlaessig
  // sauber aufbauen. Rendert nur einmal pro Container-Knoten (turnstileRenderedContainer-Guard) -
  // wechselt der Kunde nur zwischen Seite 1/2 hin und her, bleibt der Knoten derselbe und es wird
  // nicht doppelt gerendert; entsteht nach einem fehlgeschlagenen Absenden ein neuer Knoten, wird
  // korrekt neu gerendert (siehe Bugfix-Kommentar oben).
  function renderTurnstileIfNeeded() {
    if (!S.turnstileSiteKey) return;
    const container = document.getElementById("turnstile-widget");
    if (!container || container === turnstileRenderedContainer) return;
    loadTurnstileScript(() => {
      const freshContainer = document.getElementById("turnstile-widget");
      if (!freshContainer || freshContainer === turnstileRenderedContainer) return;
      turnstileWidgetId = window.turnstile.render(freshContainer, { sitekey: S.turnstileSiteKey });
      turnstileRenderedContainer = freshContainer;
    });
  }

  /** Switches between the two signup form pages without re-rendering (would wipe unsaved input in the other page). */
  function switchFormPart(n) {
    S.formPart = n;
    const intro = document.getElementById("intro-block");
    if (intro) intro.hidden = n !== 1;
    const a = document.getElementById("formpart-a");
    const b = document.getElementById("formpart-b");
    if (a) a.hidden = n !== 1;
    if (b) b.hidden = n !== 2;
    const label = document.getElementById("steplabel");
    if (label) label.textContent = formPartLabel(n);
    const lede = document.getElementById("lede");
    if (lede) lede.textContent = formPartLede(n);
    const actions = document.getElementById("formpart-actions");
    if (actions) actions.innerHTML = formPartActionsHtml(n);
    if (n === 2) renderTurnstileIfNeeded();
    updateFirstPostPreview(); // Seite 2 blendet die Stil-Felder ein - die Vorschau gehoert dann dazu
    window.scrollTo({ top: 0 });
    $("#stage")?.focus({ preventScroll: true });
  }

  function providerHtml(p) {
    const c = conn(p.id);
    const list = steps();
    const nextId = list[list.indexOf(p.id) + 1];
    const nextTarget = nextId === "done" ? overviewStep() : nextId;
    const nextName = nextId === "done" ? (nextTarget === "dashboard" ? "Übersicht" : "Zusammenfassung") : prov(nextId).name;
    const connectBtn = (label) => p.available
      ? `<a class="btn" href="${CONFIG.mount}/connect/${p.id}" data-connect="${p.id}">${label}</a>`
      : `<span class="btn" aria-disabled="true">${label}</span>`;

    let statusBox = "";
    if (c) {
      const warn = c.status !== "ok";
      const sub = c.status === "expired" ? "Freigabe abgelaufen, bitte neu verbinden."
        : c.status === "renew-soon" ? `Freigabe läuft am ${fmtDate(c.expiresAt)} ab, bitte bald neu verbinden.`
        : `Verbunden seit ${fmtDate(c.connectedAt)}`;
      statusBox = `
        <div class="status${warn ? " warn" : ""}">
          <span class="dot" aria-hidden="true"></span>
          <div class="who"><strong>${esc(c.accountName)}</strong><small>${sub}</small></div>
          <button class="link" data-disconnect="${p.id}">Trennen</button>
        </div>`;
    }

    return `
      ${bannerHtml()}
      <h1>${esc(p.name)} verbinden</h1>
      <p class="lede">${esc(p.tagline)}</p>
      ${p.notice ? `<p class="notice">${esc(p.notice)}</p>` : ""}
      ${statusBox}
      ${c && c.status === "ok" ? `
        <div class="actions">
          <button class="btn" data-go="${nextTarget}">Weiter zu ${esc(nextName)}</button>
          <a class="link" href="${CONFIG.mount}/connect/${p.id}" data-connect="${p.id}">Anderes Konto verbinden</a>
        </div>` : `
        <h2>So geht's</h2>
        <ol class="guide">${p.guide.map((g, i) => `
          <li><span class="n" aria-hidden="true">${i + 1}</span><div>
            <h3>${esc(g.title)}</h3><p>${esc(g.text)}</p>
            ${g.link ? `<a href="${esc(g.link.url)}" target="_blank" rel="noopener">${esc(g.link.label)}<span class="vh"> (öffnet in neuem Tab)</span></a>` : ""}
          </div></li>`).join("")}
        </ol>
        <div class="actions">
          ${connectBtn(c ? `${esc(p.name)} neu verbinden` : `Mit ${esc(p.name)} verbinden`)}
          <button class="link" data-skip="${p.id}" data-go="${nextTarget}">Später verbinden</button>
        </div>
        <p class="fine">${p.available ? "Wir bekommen nur das Recht, Beiträge zu veröffentlichen. Ihr Passwort sehen wir nie." : S.sandbox ? "Demo-Modus: In der Testversion absichtlich deaktiviert - es wird kein echtes Konto verbunden." : "Diese Verbindung ist gerade nicht verfügbar. Schreiben Sie uns, wir schalten sie frei."}</p>
      `}
      <h2>Häufige Fragen</h2>
      <details><summary>Kann ich die Verbindung wieder trennen?</summary><p>Ja, jederzeit mit einem Klick hier im Panel. Danach veröffentlichen wir nichts mehr auf ${esc(p.name)}.</p></details>
      <details><summary>Sehe ich die Beiträge, bevor sie erscheinen?</summary><p>Zum Start stimmen wir Stil und Themen mit Ihnen ab. Danach laufen die Beiträge im gewählten Rhythmus automatisch.</p></details>
      <details><summary>Es kommt eine Fehlermeldung. Was tun?</summary><p>Prüfen Sie, ob Sie mit dem richtigen Konto angemeldet sind, und versuchen Sie es erneut. Klappt es nicht, schreiben Sie an <a href="mailto:office@pipeline-solutions.at">office@pipeline-solutions.at</a>.</p></details>
    `;
  }

  // Panel v8: Kanalauswahl beim "Jetzt posten" - jeder Kanal hat jetzt eine unabhängige eigene
  // Anfrage, daher überall "pro Kanal" statt der alten "genau eine Anfrage insgesamt"-Logik.
  const POST_NOW_CHANNEL_OPTIONS = [
    { id: "ig_feed", label: "Instagram Feed" },
    { id: "ig_story", label: "Instagram Story" },
    { id: "linkedin", label: "LinkedIn" },
  ];
  const POST_NOW_CHANNEL_ENABLED_FIELD = { ig_feed: "igFeedEnabled", ig_story: "igStoryEnabled", linkedin: "linkedinEnabled" };

  /** This customer's own enabled channels, in POST_NOW_CHANNEL_OPTIONS order. */
  function postNowAvailableChannels(c) {
    return POST_NOW_CHANNEL_OPTIONS.filter((o) => c[POST_NOW_CHANNEL_ENABLED_FIELD[o.id]] !== false);
  }

  /** Channel ids with a currently pending "Jetzt posten"-request - those can't be requested again yet. */
  function postNowOpenChannels(c) {
    return new Set((c.postRequests || []).filter((r) => (r.status === "pending" || r.status === "processing") && r.channel).map((r) => r.channel));
  }

  /** True once every channel this customer has enabled already has an open request - nothing left to submit. */
  function postNowAllBusy(c) {
    const available = postNowAvailableChannels(c);
    if (!available.length) return true;
    const open = postNowOpenChannels(c);
    return available.every((o) => open.has(o.id));
  }

  /** The most recent request per channel (server already returns them newest-first), for the per-channel status lines. */
  function postNowLatestByChannel(c) {
    const map = {};
    for (const r of c.postRequests || []) {
      if (r.channel && !map[r.channel]) map[r.channel] = r;
    }
    return map;
  }

  function postNowStatusHtml(c) {
    const byChannel = postNowLatestByChannel(c);
    const lines = POST_NOW_CHANNEL_OPTIONS
      .filter((o) => byChannel[o.id])
      .map((o) => {
        const r = byChannel[o.id];
        const topicPart = r.topic ? `: "${esc(r.topic)}"` : "";
        return r.status === "pending" || r.status === "processing"
          ? `<div class="banner" role="status">${esc(o.label)} ausstehend${topicPart} - angefragt am ${esc(fmtDate(r.createdAt))}. Wird in der Regel innerhalb weniger Minuten bearbeitet.</div>`
          : `<div class="banner ok" role="status">${esc(o.label)} erledigt${topicPart}.</div>`;
      });
    return lines.join("");
  }

  function postNowChannelsHtml(c) {
    const available = postNowAvailableChannels(c);
    if (!available.length) {
      return `<p class="hint">Aktivieren Sie mindestens einen Kanal unter „Kanäle &amp; Formate“ in Ihren Einstellungen, um sofort zu posten.</p>`;
    }
    const open = postNowOpenChannels(c);
    // Panel v14: Format nur fuer Instagram Feed relevant (Karussell gibt es nicht bei Story/
    // LinkedIn) - trotzdem immer sichtbar mit erklaerendem Hinweis, statt sich dynamisch je nach
    // Kanalauswahl ein-/auszublenden (einfacher zu verstehen als ein Feld, das verschwindet).
    // Grosse Kacheln statt Standard-Checkboxen: am Handy sicher treffbar (44px+) und der Zustand
    // ist auf einen Blick lesbar (Ink-Flaeche = ausgewaehlt), ohne dass eine Legende noetig waere.
    const chanIcon = (id) => (id === "linkedin" ? "linkedin" : id === "ig_story" ? "story" : "feed");
    return `<fieldset class="field post-now-channels">
      <legend class="lbl">Wo soll es erscheinen?</legend>
      <div class="tiles">
        ${available.map((o) => `
          <label class="tile${open.has(o.id) ? " is-disabled" : ""}">
            <input type="checkbox" name="postNowChannel" value="${o.id}" ${open.has(o.id) ? "disabled" : "checked"}>
            <span class="tile-face">${icon(chanIcon(o.id), 18)}<span>${esc(o.label)}</span>
            ${open.has(o.id) ? `<span class="micro muted">schon angefragt</span>` : ""}</span>
          </label>`).join("")}
      </div>
    </fieldset>
    <fieldset class="field post-now-format">
      <legend class="lbl">Format <span class="opt">(nur für Instagram Feed)</span></legend>
      <div class="tiles">
        ${Object.entries(POST_FORMATS).map(([k, label]) => `
          <label class="tile">
            <input type="radio" name="postNowFormat" value="${k}" ${k === "single" ? "checked" : ""}>
            <span class="tile-face">${icon(k === "carousel" ? "beitraege" : "feed", 18)}<span>${esc(k === "carousel" ? "Karussell" : label)}</span></span>
          </label>`).join("")}
      </div>
      <p class="hint">Karussell verbraucht ${CAROUSEL_MIN_SLIDES}-${CAROUSEL_MAX_SLIDES}× die Bildkosten eines Einzelbild-Beitrags (aktuell ${esc(String(c.carouselSlideCount ?? 5))} Bilder, einstellbar unter „Kanäle &amp; Zeitplan“).</p>
    </fieldset>`;
  }

  function statusHtml(c) {
    if (c.trialExpired) return `<span class="dash-status warn">Trial abgelaufen</span>`;
    if (c.customerPaused) return `<span class="dash-status warn">Pausiert (von Ihnen)</span>`;
    if (c.trialDaysLeft != null) return `<span class="dash-status">Trial · noch ${c.trialDaysLeft} ${c.trialDaysLeft === 1 ? "Tag" : "Tage"}</span>`;
    return `<span class="dash-status">Aktiv</span>`;
  }

  function needsActionHtml() {
    const bad = S.connections.filter((k) => k.status !== "ok");
    if (!bad.length) return "";
    return `<div class="needs-action">${bad.map((k) => {
      const p = prov(k.provider);
      return k.status === "expired"
        ? `${esc(p?.name || k.provider)}: Freigabe abgelaufen - <a href="${CONFIG.mount}/connect/${k.provider}" data-connect="${k.provider}">jetzt neu verbinden</a>.`
        : `${esc(p?.name || k.provider)}: Freigabe läuft bald ab - <a href="${CONFIG.mount}/connect/${k.provider}" data-connect="${k.provider}">jetzt erneuern</a>.`;
    }).join("<br>")}</div>`;
  }

  // Panel v6 Aufgabe 2b: solange email_verified false ist, keine KI-Generierung (Server lehnt
  // ohnehin ab) - hier nur die dazugehoerige, klare Anzeige mit Resend-Moeglichkeit. Kanäle
  // verbinden bleibt ausdrücklich möglich (kostet nichts), nur das wird hier klargestellt.
  function emailVerifyBannerHtml(c) {
    if (!c || c.emailVerified) return "";
    return `<div class="needs-action" id="verify-banner">
      <strong>Bitte bestätigen Sie Ihre E-Mail-Adresse.</strong> Wir haben einen Link an ${esc(c.email)} geschickt.
      Instagram/LinkedIn können Sie schon jetzt verbinden - das kostet nichts. Beiträge werden aber erst nach der
      Bestätigung vorbereitet und veröffentlicht.
      <div style="margin-top:8px"><button type="button" class="link" id="resend-verify">Bestätigungsmail erneut senden</button>
      <span id="resend-verify-status" aria-live="polite"></span></div>
    </div>`;
  }

  // Panel v6 Aufgabe 3: der Teil ab "Warten auf Ihre Freigabe" war urspruenglich Teil von
  // doneHtml() allein - jetzt geteilt zwischen doneHtml() (Erst-Setup-Abschluss, unveraendertes
  // Aussehen) und dashboardHtml() (neuer Landepunkt fuer wiederkehrende Kunden), damit beide
  // dieselbe Logik (Freigaben/Vorschau/Jetzt-posten/Beitraege/Kalender/Konto) nutzen, ohne sie
  // zu duplizieren.
  function dashboardSectionsHtml(c) {
    return `
      ${c.approvalMode ? `<h2>Warten auf Ihre Freigabe</h2>
      <p class="lede" id="dash-approvals-intro" style="font-size:16px;margin-bottom:16px"></p>
      <div id="dash-approvals"><p class="empty">Wird geladen …</p></div>` : ""}
      <h2>Die nächsten 7 Tage</h2>
      <p class="lede" style="font-size:16px;margin-bottom:16px">Schauen Sie sich vorbereitete Beiträge an, bevor sie automatisch veröffentlicht werden - Text bearbeiten, Bild-Farbe ändern oder überspringen.</p>
      <div class="actions"><button class="btn" data-go="preview">Vorschau ansehen</button></div>
      <h2>Jetzt posten</h2>
      <p class="lede" style="font-size:16px;margin-bottom:16px">Sie möchten sofort zu einem bestimmten Thema einen Beitrag? Wählen Sie die Kanäle - wir übernehmen das beim nächsten Lauf.</p>
      ${postNowStatusHtml(c)}
      <div class="field">
        <label for="f-postNowTopic">Thema <span class="opt">(optional)</span></label>
        ${withDictate(`<textarea id="f-postNowTopic" rows="3" placeholder="Worum soll es gehen? (optional)" maxlength="300" ${postNowAllBusy(c) ? "disabled" : ""}></textarea>`, postNowAllBusy(c))}
      </div>
      ${S.aiAvailable && !postNowAllBusy(c) ? `<p class="hint"><button type="button" class="link" id="suggest-topics">Ideen vorschlagen</button></p>
      <div id="topic-suggestions" class="chips" hidden></div>` : ""}
      ${postNowChannelsHtml(c)}
      <div class="actions">
        <button class="btn" id="post-now-btn" ${postNowAllBusy(c) ? "disabled" : ""}>Jetzt posten</button>
      </div>
      <h2>Letzte Beiträge</h2>
      <div id="dash-posts" class="post-grid"><p class="empty">Wird geladen …</p></div>
      <div class="actions"><button class="link" data-go="history">Alle Beiträge ansehen</button></div>
      <h2>Kalender</h2>
      <div id="dash-cal" class="cal"><p class="empty">Wird geladen …</p></div>
      <h2>Später wiederkommen</h2>
      <p style="color:var(--stone)">Auf diesem Gerät bleiben Sie angemeldet. Für andere Geräte erzeugen Sie einen persönlichen Link. Behandeln Sie ihn wie ein Passwort, ein neuer Link ersetzt den alten.</p>
      <div id="linkbox"><button class="link" id="mklink">Persönlichen Link erzeugen</button></div>
      <div class="actions">
        <button class="link" id="logout">Abmelden</button>
      </div>
      <h2>Konto</h2>
      <p style="color:var(--stone)">Konto und alle gespeicherten Daten (Angaben, verbundene Kanäle, Beitrags-Verlauf) endgültig löschen. Das kann nicht rückgängig gemacht werden.</p>
      <div class="actions"><button class="link" id="delete-account" style="color:var(--stop)">Konto und Daten löschen</button></div>`;
  }

  function doneHtml() {
    const connected = S.providers.filter((p) => conn(p.id) && conn(p.id).status !== "expired");
    const missing = S.providers.filter((p) => !connected.includes(p));
    const c = S.customer;
    return `
      ${bannerHtml()}
      ${statusHtml(c)}
      ${emailVerifyBannerHtml(c)}
      <h1>${missing.length ? "Fast geschafft." : "Alles verbunden."}</h1>
      <p class="lede">${missing.length
        ? `Noch offen: ${missing.map((p) => esc(p.name)).join(" und ")}. Sie können das jederzeit nachholen.`
        : "Ab jetzt kümmern wir uns um Ihre Beiträge. Sie müssen nichts weiter tun."}</p>
      ${needsActionHtml()}
      <dl class="sum">
        <div><dt>Unternehmen</dt><dd>${esc(c.company)}</dd></div>
        ${S.providers.map((p) => {
          const k = conn(p.id);
          return `<div><dt>${esc(p.name)}</dt><dd>${k ? esc(k.accountName) + (k.status === "expired" ? " (abgelaufen)" : "") : `<button class="link" data-go="${p.id}">Jetzt verbinden</button>`}</dd></div>`;
        }).join("")}
        <div><dt>Rhythmus</dt><dd>${esc(FREQ[c.frequency] || "")} um ${esc(c.postTime)} Uhr</dd></div>
        ${c.nextPostAt && !c.trialExpired && !c.customerPaused ? `<div><dt>Nächster Beitrag</dt><dd>${esc(fmtNextPost(c.nextPostAt))}</dd></div>` : ""}
        <div><dt>Tonalität</dt><dd>${esc(TONES[c.tone] || "")}</dd></div>
        <div><dt>Bild-Akzentfarbe</dt><dd>${c.accentColor ? `<span style="display:inline-block;width:14px;height:14px;background:${esc(c.accentColor)};vertical-align:middle;margin-right:8px;border:1px solid var(--rule)"></span>${esc(c.accentColor)}` : "Standard"}</dd></div>
        <div><dt>Aufruf zum Handeln</dt><dd>${esc(CTA_LABEL(c.ctaPreference))}</dd></div>
      </dl>
      <div class="actions">
        <button class="btn" data-go="${isEstablished() ? "settings" : "company"}">Einstellungen bearbeiten</button>
        <button class="link" data-go="${S.providers[0]?.id || "company"}">Kanäle verwalten</button>
        <button class="link" id="toggle-pause">${c.customerPaused ? "Posting fortsetzen" : "Posting pausieren"}</button>
      </div>
      ${dashboardSectionsHtml(c)}`;
  }

  /* ================= Dashboard (Panel v6, Aufgabe 3) ================= */
  // Neuer Landepunkt fuer wiederkehrende Kunden (mind. 1 Kanal je verbunden) - ersetzt die
  // Schritt-Kette als Startpunkt, entfernt aber nichts: "Stil bearbeiten"/"Kanäle verwalten"
  // bleiben ueber die Kacheln unten jederzeit erreichbar, der Rest (Freigaben/Vorschau/Jetzt
  // posten/Beitraege/Kalender/Konto) ist exakt dieselbe Logik wie zuvor auf der "Fertig"-Seite
  // (dashboardSectionsHtml, s.o.), nur umsortiert.
  const CHANNEL_STATUS_LABEL = { ok: "Verbunden", "renew-soon": "Läuft bald ab", expired: "Abgelaufen" };
  function channelsSummaryHtml() {
    return `<ul class="chan-list">${S.providers.map((p) => {
      const k = conn(p.id);
      const label = k ? CHANNEL_STATUS_LABEL[k.status] || k.status : "Nicht verbunden";
      const bad = !k || k.status !== "ok";
      return `<li class="chan-row">
        <span class="chan-name">${icon(p.id === "linkedin" ? "linkedin" : "feed", 14)} ${esc(p.name)}</span>
        <span class="chan-state${bad ? " bad" : ""}">${esc(label)}</span>
        ${bad ? `<a class="link small" href="${CONFIG.mount}/connect/${p.id}" data-connect="${p.id}">${k ? "Neu verbinden" : "Verbinden"}</a>` : ""}
      </li>`;
    }).join("")}</ul>`;
  }

  // Panel v9 Punkt 0: Dashboard v2, ersetzt die drei v8-Entwürfe komplett (Feedback: alle drei
  // wirkten wie ein schmal gestrecktes Handy-Layout, siehe CSS-Kommentar bei .stage.dash-wide).
  // Dichtes 12-Spalten-Raster statt gestapelter Vollbreite-Abschnitte, alles gleichzeitig
  // sichtbar (kein Akkordeon/Tab für Haupt-Inhalt), nur echte/genutzte Funktionen - kein
  // Platzhalter. Dieselben Daten-Funktionen wie zuvor (loadDashboardExtras, postNow*,
  // channelsSummaryHtml, approvalCardHtml/calendarHtml über dieselben #dash-*-IDs).
  /**
   * Der Status-Satz: genau EINE Aussage, nach Handlungspriorität (Auftrag Abschnitt 5).
   * Vorher stand der wichtigste Zustand klein in einer Statuszeile zwischen vier Kennzahlen -
   * jetzt ist er das Erste und Größte auf der Seite. Reihenfolge: Problem > Freigabe >
   * Hinweis (Testphase/Pause) > läuft.
   * @returns {{tone:string, text:string, action?:{label:string, go?:string, hash?:string, connect?:string}, sub?:string}}
   */
  function statusSentence() {
    const c = S.customer;
    const expired = S.connections.find((k) => k.status === "expired");
    const soon = S.connections.find((k) => k.status === "renew-soon");
    const provName = (id) => (prov(id) ? prov(id).name : id);

    if (c && !c.emailVerified) {
      return {
        tone: "problem",
        text: "Bitte bestätigen Sie Ihre E-Mail-Adresse.",
        sub: `Wir haben einen Link an ${c.email} geschickt. Bis dahin wird nichts veröffentlicht.`,
        action: { label: "Bestätigungsmail erneut senden", resend: true },
      };
    }
    if (expired) {
      return {
        tone: "problem",
        text: `Ihre ${provName(expired.provider)}-Verbindung ist abgelaufen.`,
        sub: "Solange sie abgelaufen ist, kann für diesen Kanal nichts veröffentlicht werden.",
        action: { label: "Neu verbinden", connect: expired.provider },
      };
    }
    if (c && c.trialExpired) {
      return { tone: "problem", text: "Ihre Testphase ist abgelaufen.", sub: "Es werden vorübergehend keine neuen Beiträge veröffentlicht.", action: { label: "Jetzt freischalten", mail: true } };
    }
    const tasks = openTaskCount();
    if (tasks > 0) {
      const approvals = S.approvalCount || 0;
      const comments = S.pendingCommentCount || 0;
      const text = approvals
        ? `${pluralDe(approvals, "Beitrag wartet", "Beiträge warten")} auf Ihre Freigabe.`
        : `${pluralDe(comments, "Antwort wartet", "Antworten warten")} auf Ihre Freigabe.`;
      return {
        tone: "task",
        text,
        sub: approvals && comments ? `Dazu ${pluralDe(comments, "Kommentar-Antwort", "Kommentar-Antworten")}.` : "",
        action: { label: "Jetzt ansehen", hash: hashFor("posts", "freigabe") },
      };
    }
    if (c && c.customerPaused) {
      return { tone: "hint", text: "Ihr Posting ist pausiert.", sub: "Es wird nichts veröffentlicht, bis Sie fortsetzen.", action: { label: "Fortsetzen", resume: true } };
    }
    if (c && c.pauseFrom && c.pauseUntil) {
      return { tone: "hint", text: `Pause vom ${fmtDate(c.pauseFrom)} bis ${fmtDate(c.pauseUntil)}.`, sub: "In diesem Zeitraum wird nichts veröffentlicht." };
    }
    if (c && c.trialDaysLeft != null && c.trialDaysLeft <= 3) {
      return { tone: "hint", text: `Ihre Testphase endet in ${pluralDe(c.trialDaysLeft, "Tag", "Tagen")}.`, action: { label: "Jetzt freischalten", mail: true } };
    }
    if (soon) {
      return {
        tone: "hint",
        text: `Ihre ${provName(soon.provider)}-Verbindung läuft bald ab.`,
        sub: soon.expiresAt ? `Gültig bis ${fmtDate(soon.expiresAt)}. Einmal neu verbinden genügt.` : "",
        action: { label: "Neu verbinden", connect: soon.provider },
      };
    }
    if (c && c.nextPostAt) {
      return { tone: "ok", text: "Alles läuft.", sub: `Nächster Beitrag ${fmtNextPost(c.nextPostAt)}.` };
    }
    return { tone: "ok", text: "Alles läuft.", sub: "Aktuell ist kein Beitrag geplant." };
  }

  function statusSentenceHtml() {
    const s = statusSentence();
    const a = s.action;
    let actionHtml = "";
    if (a) {
      if (a.connect) actionHtml = `<a class="btn btn-primary" href="${CONFIG.mount}/connect/${a.connect}" data-connect="${a.connect}">${esc(a.label)}</a>`;
      else if (a.mail) actionHtml = `<a class="btn btn-primary" href="mailto:office@pipeline-solutions.at?subject=${encodeURIComponent(`Jetzt freischalten - ${S.customer?.company || ""}`)}">${esc(a.label)}</a>`;
      else if (a.resume) actionHtml = `<button type="button" class="btn btn-primary" id="toggle-pause">${esc(a.label)}</button>`;
      else if (a.resend) actionHtml = `<div><button type="button" class="btn" id="resend-verify">${esc(a.label)}</button> <span id="resend-verify-status" class="small" aria-live="polite"></span></div>`;
      else actionHtml = `<a class="btn btn-primary" href="${esc(a.hash || "")}" data-go="posts" data-tab="freigabe">${esc(a.label)}</a>`;
    }
    return `<div class="status ${s.tone === "problem" ? "is-problem" : ""}">
      <h1>${esc(s.text)}</h1>
      ${s.sub ? `<p class="sub">${esc(s.sub)}</p>` : ""}
      ${actionHtml}
    </div>`;
  }

  /**
   * Flow-Leiste: die nächsten 7 Tage als Pipe. Ein Knoten pro Tag (bei 360px sind drei Spuren
   * nebeneinander nicht mehr lesbar - die Kanäle stehen deshalb als kleine Knoten im Tag).
   * Wird nach dem Laden der geplanten Beiträge befüllt (renderFlow).
   */
  function flowHtml() {
    return `<div class="section">
      <div class="section-head"><h2>Diese Woche</h2>
        <a class="link small" href="#${hashFor("posts", "geplant")}" data-go="posts" data-tab="geplant">Alle ansehen</a></div>
      <div class="flow" id="flow"><div class="flow-track">${
        nextSevenDates().map(() => `<div class="flow-day"><span class="sk sk-line" style="width:60%"></span></div>`).join("")
      }</div></div>
    </div>`;
  }

  function dashboardHtml() {
    const c = S.customer;
    return `
      ${bannerHtml()}
      ${needsActionHtml()}
      ${statusSentenceHtml()}
      ${flowHtml()}
      <div class="section">
        <div class="section-head"><h2>Letzte Beiträge</h2>
          <a class="link small" href="#${hashFor("posts", "veroeffentlicht")}" data-go="posts" data-tab="veroeffentlicht">Alle ansehen</a></div>
        <div id="dash-posts" class="post-grid">${skeletonTiles(4)}</div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Ihre Kanäle</h2></div>
        ${channelsSummaryHtml()}
      </div>
      ${setupChecklistHtml(c)}`;
  }

  /** Skeleton in der Form des Inhalts (Bildquadrate), nicht "Wird geladen …". */
  function skeletonTiles(n) {
    return Array.from({ length: n }, () => `<div class="sk sk-tile"></div>`).join("");
  }

  /**
   * Einrichtungs-Checkliste: verschwindet vollständig, sobald alles erledigt ist - sie soll
   * keine Dauerdeko sein. Fortschritt in derselben Pipe-Sprache wie alles andere.
   */
  function setupChecklistHtml(c) {
    if (!c) return "";
    const items = [
      { done: Boolean(c.emailVerified), label: "E-Mail bestätigen", action: null },
      { done: S.connections.some((k) => k.status !== "expired"), label: "Einen Kanal verbinden", go: "instagram" },
      { done: Array.isArray(c.contentPillars) && c.contentPillars.length > 0, label: "Content-Säulen festlegen", settings: "inhalt" },
      { done: Boolean(c.hasLogo), label: "Logo hinzufügen", settings: "aussehen" },
    ];
    const open = items.filter((i) => !i.done);
    if (!open.length) return "";
    return `<div class="section">
      <div class="section-head"><h2>Noch offen</h2></div>
      <div class="rail" style="max-width:220px">${items.map((i, idx) => `${idx ? '<span class="rail-seg' + (i.done ? " done" : "") + '" aria-hidden="true"></span>' : ""}<span class="pipe-node" data-state="${i.done ? "published" : "planned"}" role="img" aria-label="${esc(i.label)}${i.done ? ": erledigt" : ": offen"}"></span>`).join("")}</div>
      <ul style="list-style:none;padding:0;margin:var(--s4) 0 0">
        ${open.map((i) => `<li style="margin-bottom:var(--s3)"><button type="button" class="link" ${i.settings ? `data-go="settings" data-sub="${i.settings}"` : i.go ? `data-go="${i.go}"` : "disabled"}>${esc(i.label)}</button></li>`).join("")}
      </ul>
    </div>`;
  }

  function calendarHtml(posts, frequency) {
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mo=0..So=6
    const postingDays = { taeglich: [0, 1, 2, 3, 4, 5, 6], werktags: [1, 2, 3, 4, 5], "3x-woche": [1, 3, 5] }[frequency] || [1, 2, 3, 4, 5];
    const postedDates = new Set(posts.map((p) => new Date(p.postedAt).toDateString()));
    const todayStr = now.toDateString();

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(`<div></div>`);
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const isPast = d < new Date(year, month, now.getDate());
      const posted = postedDates.has(d.toDateString());
      const planned = !posted && !isPast && postingDays.includes(d.getDay());
      cells.push(`<div class="cal-day${d.toDateString() === todayStr ? " today" : ""}">${day}${posted ? '<span class="dot posted"></span>' : planned ? '<span class="dot planned"></span>' : ""}</div>`);
    }
    const monthLabel = now.toLocaleDateString("de-AT", { month: "long", year: "numeric", timeZone: "Europe/Vienna" });
    return `<p class="hint" style="margin-bottom:8px">${esc(monthLabel)}</p>
      <div class="cal-grid">
        ${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => `<div class="hd">${d}</div>`).join("")}
        ${cells.join("")}
      </div>
      <div class="cal-legend"><span><i class="dot posted"></i>Veröffentlicht</span><span><i class="dot planned"></i>Geplant</span></div>`;
  }

  /** Beitragskachel fürs Bildraster - die Bilder sind die einzige Farbe im Panel, also gross. */
  function postTileHtml(p) {
    const label = p.headline || CHANNEL_BADGE_LABEL[p.provider] || "Beitrag";
    return `<button type="button" class="post-tile" data-lightbox="${esc(p.imageUrl || "")}" aria-label="${esc(label)}">
      ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" decoding="async">` : ""}
      <span class="meta">${esc(fmtRelative(p.postedAt))}</span>
    </button>`;
  }

  /** Füllt die Flow-Leiste: geplante Beiträge + bereits veröffentlichte der letzten Tage. */
  function renderFlow(planned, posted) {
    const box = $("#flow");
    if (!box) return;
    const days = nextSevenDates();
    const todayStr = localDateStr(new Date());
    const byDay = new Map(days.map((d) => [d, []]));
    (planned || []).forEach((p) => {
      if (byDay.has(p.scheduledFor)) byDay.get(p.scheduledFor).push({ state: p.status === "rejected" ? "none" : p.status === "published" ? "published" : p.status === "submitted" || p.status === "approved" ? "waiting" : "planned", p });
    });
    (posted || []).forEach((p) => {
      const d = localDateStr(new Date(p.postedAt));
      if (byDay.has(d)) byDay.get(d).push({ state: "published", p });
    });

    box.innerHTML = `<div class="flow-track">${days.map((d) => {
      const date = new Date(d + "T12:00:00");
      const items = byDay.get(d) || [];
      const nodes = items.length
        ? items.slice(0, 3).map((i) => `<span class="pipe-node" data-state="${i.state}" role="img" aria-label="${esc(flowNodeLabel(date, i))}"></span>`).join("")
        : `<span class="pipe-node" data-state="none" role="img" aria-label="${esc(WEEKDAYS[(date.getDay() + 6) % 7])}: kein Beitrag geplant"></span>`;
      return `<button type="button" class="flow-day" data-go="posts" data-tab="geplant" ${d === todayStr ? 'aria-current="date"' : ""}>
        <span class="d">${esc(WEEKDAYS[(date.getDay() + 6) % 7])}</span>
        <span class="flow-nodes pipe">${nodes}</span>
      </button>`;
    }).join("")}</div>
    <div class="flow-legend">
      <span><span class="pipe-node" data-state="planned" style="width:10px;height:10px"></span> Geplant</span>
      <span><span class="pipe-node" data-state="waiting" style="width:10px;height:10px"></span> Wartet auf Freigabe</span>
      <span><span class="pipe-node" data-state="published" style="width:10px;height:10px"></span> Veröffentlicht</span>
    </div>`;
  }

  function flowNodeLabel(date, item) {
    const day = date.toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
    const state = { planned: "geplant", waiting: "wartet auf Ihre Freigabe", published: "veröffentlicht", problem: "Problem", none: "kein Beitrag" }[item.state];
    const channel = item.p && item.p.channel ? ` ${CHANNEL_BADGE_LABEL[item.p.channel] || item.p.channel}` : "";
    return `${day}:${channel} ${state}`;
  }

  /**
   * Lädt alles, was die Übersicht nachträglich braucht. Zählt dabei die offenen Freigaben, damit
   * der Status-Satz und die Zähler in der Navigation dieselbe Wahrheit zeigen.
   */
  async function loadDashboardExtras() {
    let posted = [];
    const postsBox = $("#dash-posts");
    try {
      const { posts } = await api("GET", "/api/posts");
      posted = posts || [];
      if (postsBox) {
        postsBox.innerHTML = posted.length
          ? posted.slice(0, 8).map(postTileHtml).join("")
          : `<p class="empty">Noch keine Beiträge veröffentlicht. Der erste kommt automatisch — oder Sie starten selbst einen über „Jetzt posten".</p>`;
      }
    } catch {
      if (postsBox) postsBox.innerHTML = `<p class="empty">Die Beiträge konnten gerade nicht geladen werden. <button type="button" class="link" data-reload>Erneut versuchen</button></p>`;
    }

    try {
      const { posts } = await api("GET", "/api/planned-posts");
      renderFlow(posts || [], posted);
    } catch {
      const box = $("#flow");
      if (box) box.innerHTML = `<p class="empty">Die Wochenübersicht konnte gerade nicht geladen werden. <button type="button" class="link" data-reload>Erneut versuchen</button></p>`;
    }

    // Zähler für Navigation/Status-Satz aktuell halten (auch wenn kein Freigabe-Modus aktiv ist:
    // dann sind es schlicht null offene Freigaben).
    try {
      const { approvals } = await api("GET", "/api/approvals");
      const next = (approvals || []).length;
      if (next !== S.approvalCount) { S.approvalCount = next; renderChrome(); }
    } catch { /* Zähler bleibt wie er war - lieber kein Badge als ein falsches */ }
  }

  const CHANNEL_BADGE_LABEL = {
    ig_feed: "Instagram Feed",
    ig_story: "Instagram Story",
    linkedin: "LinkedIn",
    instagram: "Instagram",
  };

  function channelBadgeLabel(a) {
    const key = a.channel || a.provider || "";
    return CHANNEL_BADGE_LABEL[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");
  }

  function approvalCardHtml(a) {
    const badge = channelBadgeLabel(a);
    const pillarPart = a.pillarTitle ? `, basierend auf Ihrer Content-Säule „${esc(a.pillarTitle)}“` : "";
    const isCarousel = a.format === "carousel" && Array.isArray(a.slides) && a.slides.length > 0;
    const formatNote = isCarousel ? ` Karussell mit ${a.slides.length} Bildern - wischen Sie im veröffentlichten Post durch alle Slides.` : "";
    const context = `Erstellt ${esc(fmtCreated(a.createdAt))} für ${esc(badge || "Ihren Kanal")} (${esc(originLabel(a.source))})${pillarPart}.${formatNote} Prüfen Sie Text und Bild${isCarousel ? "er" : ""}, dann geben Sie frei oder lehnen Sie ab.`;
    // Karussell: alle Slides als kleine Bild-Reihe (gleiche .post-grid-Optik wie der Verlauf),
    // nicht nur die erste - der Kunde muss vor der Freigabe jedes einzelne Bild sehen koennen.
    const mediaHtml = isCarousel
      ? `<div class="post-grid" style="flex:none;width:220px">${a.slides.map((s) => `<img src="${esc(s.imageUrl)}" alt="" data-lightbox>`).join("")}</div>`
      : (a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="" data-lightbox>` : `<div class="ph"></div>`);
    return `<div class="approval-card" data-approval-id="${esc(a.id)}">
      ${mediaHtml}
      <div class="approval-body">
        ${badge ? `<span class="channel-badge">${esc(badge)}</span>` : ""}
        ${isCarousel ? `<span class="channel-badge">Karussell</span>` : ""}
        <p class="hint" style="margin:2px 0 10px">${context}</p>
        ${a.headline ? `<strong>${esc(a.headline)}</strong>` : ""}
        ${a.caption ? `<p>${esc(a.caption)}</p>` : ""}
        <div class="actions">
          <button class="btn" data-approve="${esc(a.id)}">Freigeben</button>
          <button class="link" data-reject="${esc(a.id)}">Ablehnen</button>
        </div>
      </div>
    </div>`;
  }

  /** Freigabe-Karte fuer eine KI-Antwort auf einen Instagram-Kommentar (Panel v10) - gleiches
   *  Muster wie approvalCardHtml, aber die Antwort ist direkt bearbeitbar (Textarea statt reinem
   *  Text), weil "Bearbeiten" hier eine sinnvolle dritte Aktion neben Freigeben/Ablehnen ist. */
  function commentApprovalCardHtml(a) {
    return `<div class="approval-card" data-comment-approval-id="${esc(a.id)}">
      <div class="approval-body">
        <span class="channel-badge">Instagram-Kommentar</span>
        <p class="hint" style="margin:2px 0 10px">${esc(a.authorUsername ? `@${a.authorUsername}` : "Jemand")} schrieb: „${esc(a.commentText)}“</p>
        <label style="display:block;margin-bottom:4px">Ihre Antwort</label>
        ${withDictate(`<textarea class="comment-reply-text" rows="3" maxlength="1000">${esc(a.generatedReply || "")}</textarea>`)}
        <div class="actions">
          <button class="btn" data-comment-approve="${esc(a.id)}">Freigeben</button>
          <button class="link" data-comment-reject="${esc(a.id)}">Ablehnen</button>
        </div>
      </div>
    </div>`;
  }

  const CTA_LABEL = (k) => CTAS[k] || CTAS.link_bio;
  const PLATFORM_LABEL = (p) => prov(p)?.name || p;

  /** Panel v11: Vorschau und Verlauf sind ein Bereich ("Beiträge") mit zwei Reitern - in der
   *  Navigation steht dafuer nur ein Eintrag, damit die Leiste kurz bleibt. Fuer einen Kunden
   *  mitten im Onboarding (noch keine Navigation) wird nichts angezeigt. */
  /**
   * "Beiträge" ist EIN Bereich mit drei Ansichten derselben Pipe (Geplant / Zur Freigabe /
   * Veröffentlicht). Vorher waren das zwei getrennte Navigationspunkte mit je eigener Überschrift
   * und uneinheitlichen Begriffen ("Die nächsten 7 Tage" vs. "Ihre bisherigen Beiträge").
   */
  function postsHtml() {
    const count = S.approvalCount || 0;
    const tabs = POST_TABS.map((t) => {
      const active = S.postTab === t.id;
      const badge = t.id === "freigabe" && count ? `<span class="count">${count}</span>` : "";
      return `<button type="button" role="tab" aria-selected="${active}" data-tab="${t.id}">${esc(t.label)}${badge}</button>`;
    }).join("");

    let body = "";
    if (S.postTab === "geplant") body = `<div id="preview-strip"></div><div id="preview-detail"></div>`;
    else if (S.postTab === "freigabe") body = `<div id="approvals-list">${skeletonTiles(0)}<p class="empty">Wird geladen …</p></div>`;
    else body = `<div id="historylist" class="post-grid">${skeletonTiles(6)}</div>`;

    return `
      ${bannerHtml()}
      <h1>Beiträge</h1>
      <div class="segmented" role="tablist" style="margin:var(--s4) 0 var(--s6)">${tabs}</div>
      ${body}`;
  }

  /** Lädt den Inhalt des aktiven Reiters. */
  function loadPostsTab() {
    if (S.postTab === "geplant") return loadPreview();
    if (S.postTab === "freigabe") return loadApprovals();
    return loadHistory();
  }

  /** Leerer Zustand des Freigabe-Reiters - als Einladung formuliert, nicht als "Keine Einträge". */
  function loadApprovalsEmptyState(box) {
    const c = S.customer;
    box.innerHTML = `<div class="empty-invite"><h2>Nichts zu tun.</h2><p class="lede">Sobald ein Beitrag Ihre Freigabe braucht, steht er hier.${c && !c.approvalMode ? " Der Freigabe-Modus ist aus — Beiträge gehen automatisch online." : ""}</p></div>`;
  }

  /** Reiter "Zur Freigabe": Freigaben und Kommentar-Antworten an einer Stelle. */
  async function loadApprovals() {
    const box = $("#approvals-list");
    if (!box) return;
    const c = S.customer;
    try {
      const [{ approvals }, comments] = await Promise.all([
        api("GET", "/api/approvals"),
        c && c.commentAutomationEnabled && c.commentAutomationMode !== "auto"
          ? api("GET", "/api/comment-approvals").catch(() => ({ approvals: [] }))
          : Promise.resolve({ approvals: [] }),
      ]);
      S.approvalCount = (approvals || []).length;
      S.pendingCommentCount = (comments.approvals || []).length;
      renderChrome();

      const parts = [];
      if (approvals && approvals.length) parts.push(approvals.map(approvalCardHtml).join(""));
      if (comments.approvals && comments.approvals.length) {
        parts.push(`<div class="section"><div class="section-head"><h2>Kommentar-Antworten</h2></div>
          <p class="lede small">Diese Antworten hat die KI auf echte Fragen unter Ihren Beiträgen vorbereitet.</p>
          ${comments.approvals.map(commentApprovalCardHtml).join("")}</div>`);
      }
      box.innerHTML = parts.length
        ? parts.join("")
        : `<div class="empty-invite"><h2>Nichts zu tun.</h2><p class="lede">Sobald ein Beitrag Ihre Freigabe braucht, steht er hier.${c && !c.approvalMode ? " Der Freigabe-Modus ist aus — Beiträge gehen automatisch online." : ""}</p></div>`;
    } catch (err) {
      box.innerHTML = `<p class="empty">${esc(err.message || "Konnte nicht geladen werden.")} <button type="button" class="link" data-reload>Erneut versuchen</button></p>`;
    }
  }

  async function loadHistory() {
    const box = $("#historylist");
    if (!box) return;
    try {
      const { posts } = await api("GET", "/api/posts");
      if (!posts.length) {
        box.innerHTML = `<p class="empty">Noch keine Beiträge veröffentlicht. Sobald der erste online geht, erscheint er hier.</p>`;
        return;
      }
      // Dichtes Bildraster statt Listenzeilen mit Meta-Kette: die Beiträge selbst sind die
      // Information, das Detail (Text, Kanal, Zeit) oeffnet sich beim Antippen.
      box.className = "post-grid";
      box.innerHTML = posts.map(postTileHtml).join("");
      S.historyCache = posts;
    } catch {
      box.innerHTML = `<p class="empty">Die Beiträge konnten gerade nicht geladen werden. <button type="button" class="link" data-reload>Erneut versuchen</button></p>`;
    }
  }

  /* ================= Analytics (Panel v9 Aufgabe 2, Instagram v1) ================= */
  const ANALYTICS_CHANNELS = [
    { id: "instagram", label: "Instagram" },
    { id: "linkedin", label: "LinkedIn" },
  ];

  function analyticsTabsHtml() {
    return `<div class="segmented" role="tablist" style="margin:var(--s4) 0 var(--s6)">${ANALYTICS_CHANNELS.map((c) => `
      <button type="button" role="tab" aria-selected="${S.analyticsChannel === c.id}" data-analytics-channel="${c.id}">${esc(c.label)}</button>`).join("")}</div>`;
  }

  function analyticsHtml() {
    return `
      ${bannerHtml()}
      <h1>Analytics</h1>
      <p class="lede">Kennzahlen der letzten 30 Tage, einmal täglich im Hintergrund aktualisiert.</p>
      ${analyticsTabsHtml()}
      <div id="analytics-body"><p class="empty">Wird geladen …</p></div>`;
  }

  function anDelta(curr, prev) {
    if (curr == null || prev == null || prev === 0) return "";
    const pct = Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
    if (pct === 0) return `<div class="delta">± 0% ggü. Vorwoche</div>`;
    const up = pct > 0;
    return `<div class="delta ${up ? "up" : "down"}">${up ? "↑" : "↓"} ${Math.abs(pct)}% ggü. Vorwoche</div>`;
  }

  function anStatHtml(label, value, deltaHtml) {
    return `<div class="an-stat"><div class="lbl">${esc(label)}</div><div class="val">${value}</div>${deltaHtml}</div>`;
  }

  /** Simple hand-rolled SVG line chart (no charting library - CSP only allows scripts from
   *  self/Cloudflare, and a hand-rolled chart matches the rest of the panel's own-built
   *  components like the calendar grid, not a bundled dependency). */
  function anChartSvg(trend, field, label) {
    const points = trend.filter((t) => t[field] != null);
    if (points.length < 2) return `<p class="hint">Noch nicht genug Tage für einen Trend.</p>`;
    const values = points.map((p) => p[field]);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const w = 600, h = 110, pad = 6;
    const coords = points.map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p[field] - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `
      <div class="an-chart-wrap">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}-Trend der letzten ${points.length} Tage">
          <polyline points="${coords.join(" ")}" fill="none" stroke="var(--ink)" stroke-width="2" vector-effect="non-scaling-stroke" />
          ${coords.map((c) => { const [x, y] = c.split(","); return `<circle cx="${x}" cy="${y}" r="3" fill="var(--ink)" vector-effect="non-scaling-stroke" />`; }).join("")}
        </svg>
        <div class="an-chart-label"><span>${esc(fmtDate(points[0].date))}</span><span>${esc(label)}</span><span>${esc(fmtDate(points[points.length - 1].date))}</span></div>
      </div>`;
  }

  function anTopPostHtml(p) {
    const topicPart = p.headline ? esc(p.headline) : "Instagram-Beitrag";
    return `<div class="an-top-post">
      ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" data-lightbox>` : `<div class="ph"></div>`}
      <div>
        <strong>${topicPart}</strong>
        <div class="stats">${esc(fmtDate(p.postedAt))} · ${p.likes ?? 0} Likes · ${p.comments ?? 0} Kommentare · ${p.saved ?? 0} Gespeichert${p.reach != null ? ` · Reichweite ${p.reach}` : ""}</div>
      </div>
    </div>`;
  }

  function analyticsBodyHtml(d) {
    if (!d.available) {
      // Panel v20: nie stumm leer lassen, was (noch) nicht funktioniert (Styleguide-Regel) -
      // LinkedIn-Kennzahlen brauchen r_member_postAnalytics, das hinter der Community Management
      // API steckt (siehe docs/LINKEDIN_COMMUNITY_API.md), eine reine Partnerfreigabe, kein
      // Code-Problem hier im Panel.
      return `<div class="needs-action">
        <strong>LinkedIn-Kennzahlen sind noch nicht verfügbar.</strong>
        Dafür braucht es eine Partnerfreigabe von LinkedIn (Community Management API), die wir gerade beantragen.
        Sobald sie da ist, erscheinen hier dieselben Zahlen wie bei Instagram - ohne dass Sie etwas tun müssen.
      </div>`;
    }
    if (!d.hasData) {
      return `<p class="empty">Noch keine Daten. Der tägliche Abgleich läuft im Hintergrund - in ein paar Tagen sehen Sie hier Zahlen.</p>`;
    }
    return `
      <div class="an-stats">
        ${anStatHtml("Follower", d.current.followerCount ?? "–", anDelta(d.current.followerGrowth, d.previous.followerGrowth))}
        ${anStatHtml("Reichweite (7 Tage)", d.current.reach, anDelta(d.current.reach, d.previous.reach))}
        ${anStatHtml("Reichweite (30 Tage)", d.reach30d, "")}
        ${anStatHtml("Views (7 Tage)", d.current.views, anDelta(d.current.views, d.previous.views))}
        ${anStatHtml("Engagement-Rate", d.current.engagementRate != null ? `${d.current.engagementRate}%` : "–", anDelta(d.current.engagementRate, d.previous.engagementRate))}
      </div>
      <div class="an-charts">
        <section><h2>Follower-Verlauf</h2>${anChartSvg(d.trend, "followerCount", "Follower")}</section>
        <section><h2>Reichweite-Verlauf</h2>${anChartSvg(d.trend, "reach", "Reichweite")}</section>
      </div>
      <h2>Top-Beiträge (30 Tage)</h2>
      ${d.topPosts.length ? `<div class="an-top-posts">${d.topPosts.map(anTopPostHtml).join("")}</div>` : `<p class="empty">Noch keine Beiträge mit genug Daten.</p>`}
      <h2>Was bedeutet das für mich?</h2>
      <div id="analytics-summary-box">${analyticsSummaryBoxHtml(d.aiSummary)}</div>
      <p class="hint"><button type="button" class="link" id="analytics-summary-btn">Zusammenfassung anzeigen</button></p>`;
  }

  function analyticsSummaryBoxHtml(aiSummary) {
    if (!aiSummary) return `<p class="empty">Noch keine Zusammenfassung erstellt.</p>`;
    return `<p>${esc(aiSummary.summary)}</p><p class="hint">Stand: ${esc(fmtCreated(aiSummary.generatedAt))}</p>`;
  }

  async function loadAnalytics() {
    const box = $("#analytics-body");
    if (!box) return;
    box.innerHTML = `<p class="empty">Wird geladen …</p>`;
    try {
      const data = await api("GET", `/api/analytics?channel=${S.analyticsChannel}`);
      box.innerHTML = analyticsBodyHtml(data);
    } catch {
      box.innerHTML = `<p class="empty">Analytics konnten gerade nicht geladen werden.</p>`;
    }
  }

  /* ================= Vorschau (Panel v5, Aufgabe 5) ================= */
  const PP_CHANNEL_LABEL = { ig_feed: "Instagram Feed", ig_story: "Instagram Story", linkedin: "LinkedIn" };
  const PP_STATUS_LABEL = { planned: "Geplant", edited: "Bearbeitet", approved: "Freigegeben", rejected: "Übersprungen", published: "Veröffentlicht", submitted: "Wartet auf Ihre Freigabe" };
  let previewCache = { posts: [], maxRegenerate: 3 };
  let previewSelectedDate = null;

  function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function nextSevenDates() {
    const out = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      out.push(localDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)));
    }
    return out;
  }

  function previewHtml() {
    const c = S.customer;
    return `
      ${bannerHtml()}
      <h1>Vorschau - die nächsten 7 Tage</h1>
      <p class="lede">Diese Beiträge hat Pipeflow für Sie vorbereitet. Passen Sie Text oder Bild-Farbe an oder überspringen Sie einen Beitrag, bevor er automatisch veröffentlicht wird.${c.approvalMode ? " Da Sie Beiträge vor Veröffentlichung freigeben, können Sie das hier schon vorab tun - nach Ihrer Freigabe wird in der Regel innerhalb weniger Minuten veröffentlicht." : ""}</p>
      ${postsTabsHtml("preview")}
      <div id="preview-strip"><p class="empty">Wird geladen …</p></div>
      <p class="preview-hint">← Tage seitlich wischen, um sie zu wechseln.</p>
      <div id="preview-detail"></div>`;
  }

  function previewStripHtml() {
    const dates = nextSevenDates();
    const byDate = {};
    for (const p of previewCache.posts) (byDate[p.scheduledFor] ||= []).push(p);
    if (!previewSelectedDate || !dates.includes(previewSelectedDate)) {
      previewSelectedDate = dates.find((d) => (byDate[d] || []).length) || dates[0];
    }
    // Tagesreiter in derselben Pipe-Sprache wie die Übersicht: ein Knoten je Beitrag, Zustand
    // über data-state. Bei schmalen Screens horizontal scrollbar mit scroll-snap.
    const stateOf = (p) => (p.status === "published" ? "published" : p.status === "approved" || p.status === "submitted" ? "waiting" : p.status === "rejected" ? "none" : "planned");
    return `<div class="preview-days">
      ${dates.map((d) => {
        const items = byDate[d] || [];
        const date = new Date(`${d}T00:00:00`);
        const wd = date.toLocaleDateString("de-AT", { weekday: "short" });
        const dm = date.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" });
        const nodes = items.length
          ? items.map((it) => `<span class="pipe-node" data-state="${stateOf(it)}" role="img" aria-label="${esc(PP_CHANNEL_LABEL[it.channel] || it.channel)}"></span>`).join("")
          : `<span class="pipe-node" data-state="none" aria-hidden="true"></span>`;
        return `<button type="button" class="preview-day${d === previewSelectedDate ? " is-selected" : ""}" data-preview-day="${d}"
            aria-pressed="${d === previewSelectedDate}" aria-label="${esc(wd)}, ${esc(dm)}: ${items.length ? pluralDe(items.length, "Beitrag", "Beiträge") : "nichts geplant"}">
          <span class="preview-day-label"><span class="wd">${esc(wd)}</span><span class="dm">${esc(dm)}</span></span>
          <span class="preview-day-dots">${nodes}</span>
        </button>`;
      }).join("")}
    </div>`;
  }

  function previewCardHtml(p) {
    const atMax = p.regenerateCount >= previewCache.maxRegenerate;
    // Panel v7 fix: 'submitted' bedeutet, der Beitrag wurde schon 1:1 in die Freigabe-
    // Warteschlange uebernommen (siehe "Wartet auf Ihre Freigabe") - ab dann lebt der Inhalt dort,
    // ein Bearbeiten/Ueberspringen hier haette keine Wirkung mehr.
    const editable = p.status !== "published" && p.status !== "submitted";
    const canSkip = editable && p.status !== "rejected";
    const canApprove = S.customer.approvalMode && editable && p.status !== "approved" && p.status !== "rejected";
    // Karte zeigt den Beitrag so, wie er erscheinen wird: Bild gross, darunter Kanal + Termin in
    // einem Satz, dann Text. Bearbeiten liegt hinter einem Schalter, damit die Karte im Normalfall
    // ruhig bleibt und nicht wie ein Formular wirkt.
    const time = S.customer && S.customer.postTime ? ` um ${esc(S.customer.postTime)} Uhr` : "";
    const when = p.scheduledFor === localDateStr(new Date())
      ? `Geht heute${time} raus`
      : `Geht am ${esc(new Date(`${p.scheduledFor}T00:00:00`).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" }))}${time} raus`;
    const statusNote = p.status === "rejected" ? "Übersprungen — wird nicht veröffentlicht."
      : p.status === "published" ? "Bereits veröffentlicht."
      : p.status === "submitted" ? "Liegt zur Freigabe bereit."
      : p.status === "approved" ? "Von Ihnen freigegeben."
      : S.customer.approvalMode ? `${when}, sobald Sie freigeben.` : `${when}.`;

    return `<article class="card preview-card is-${esc(p.status)}" data-plan-id="${esc(p.id)}">
      ${p.imageUrl
        ? `<img class="card-media${p.channel === "ig_story" ? " story" : ""}" src="${esc(p.imageUrl)}" alt="Vorschaubild: ${esc(p.headline || "")}" data-lightbox loading="lazy" decoding="async">`
        : `<div class="card-media"></div>`}
      <div class="card-body">
        <div class="card-kicker">
          ${icon(p.channel === "linkedin" ? "linkedin" : p.channel === "ig_story" ? "story" : "feed", 12)}
          ${esc(PP_CHANNEL_LABEL[p.channel] || p.channel)}
          <span class="pipe-node" data-state="${p.status === "published" ? "published" : p.status === "approved" || p.status === "submitted" ? "waiting" : p.status === "rejected" ? "none" : "planned"}"
            style="width:10px;height:10px" role="img" aria-label="${esc(PP_STATUS_LABEL[p.status] || p.status)}"></span>
        </div>
        <p class="small" style="margin:var(--s2) 0 var(--s4)">${statusNote}</p>

        ${p.headline ? `<h2 style="margin-bottom:var(--s2)">${esc(p.headline)}</h2>` : ""}
        ${p.caption && p.channel !== "ig_story" ? `<p class="prose">${esc(p.caption)}</p>` : ""}

        ${editable ? `
        <details class="pp-edit">
          <summary>Text bearbeiten</summary>
          <div class="field" style="margin-top:var(--s4)">
            <label for="pp-headline-${esc(p.id)}">Schlagzeile im Bild</label>
            ${`<input id="pp-headline-${esc(p.id)}" type="text" value="${esc(p.headline || "")}" maxlength="100" placeholder="Schlagzeile">`}
          </div>
          ${p.channel !== "ig_story" ? `<div class="field">
            <label for="pp-caption-${esc(p.id)}">Beitragstext</label>
            ${withDictate(`<textarea id="pp-caption-${esc(p.id)}" maxlength="2200" placeholder="Beitragstext">${esc(p.caption || "")}</textarea>`)}
          </div>` : ""}
          <div class="field">
            <label>Bild-Farbe</label>
            <div class="swatches">
              ${PALETTE.map((hex) => `<button type="button" class="swatch" data-pp-swatch="${hex}" style="background:${hex}" aria-label="Farbe ${hex}"></button>`).join("")}
              <input type="color" data-pp-color="${esc(p.id)}" value="${esc(p.accentColorUsed || "#0a0e1a")}" aria-label="Eigene Farbe">
            </div>
            ${atMax
              ? `<p class="hint">Maximale Anzahl an Neuerstellungen erreicht.</p>`
              : `<p class="hint"><button type="button" class="link" data-pp-regenerate="${esc(p.id)}">Bild mit dieser Farbe neu erstellen</button> — noch ${previewCache.maxRegenerate - p.regenerateCount} von ${previewCache.maxRegenerate}</p>`}
          </div>
          <div class="actions">
            <button type="button" class="btn" data-pp-save="${esc(p.id)}">Änderungen speichern</button>
            <span class="saved" data-pp-save-status="${esc(p.id)}" aria-live="polite"></span>
          </div>
        </details>` : ""}

        <div class="card-actions">
          ${canApprove ? `<button type="button" class="btn btn-primary" data-pp-approve="${esc(p.id)}">Jetzt schon freigeben</button>` : ""}
          ${canSkip ? `<button type="button" class="btn btn-quiet" data-pp-skip="${esc(p.id)}">Überspringen</button>` : ""}
        </div>
      </div>
    </article>`;
  }

  function previewDetailHtml() {
    const items = previewCache.posts.filter((p) => p.scheduledFor === previewSelectedDate).sort((a, b) => a.channel.localeCompare(b.channel));
    if (!items.length) return `<p class="empty">Für diesen Tag ist nichts vorbereitet - entweder ist an diesem Tag laut Ihrem Zeitplan nichts fällig, oder die tägliche Vorausplanung hat diesen Tag noch nicht erreicht.</p>`;
    return items.map(previewCardHtml).join("");
  }

  function renderPreview() {
    const strip = $("#preview-strip");
    const detail = $("#preview-detail");
    if (strip) strip.innerHTML = previewStripHtml();
    if (detail) detail.innerHTML = previewDetailHtml();
  }

  async function loadPreview() {
    const strip = $("#preview-strip");
    if (!strip) return;
    try {
      const { posts, maxRegenerate } = await api("GET", "/api/planned-posts");
      previewCache = { posts, maxRegenerate };
      renderPreview();
    } catch {
      strip.innerHTML = `<p class="empty">Vorschau konnte gerade nicht geladen werden.</p>`;
    }
  }

  function updatePlannedPostInCache(updated) {
    if (!updated) return;
    const i = previewCache.posts.findIndex((p) => p.id === updated.id);
    if (i >= 0) previewCache.posts[i] = updated;
    renderPreview();
  }

  /** n + a German noun, switched singular/plural - same pattern as the emails.ts server templates. */
  function pluralDe(n, singular, plural) { return `${n} ${n === 1 ? singular : plural}`; }

  /**
   * "Diese Änderung betrifft deine noch nicht veröffentlichten Beiträge - jetzt neu generieren?"
   * (Panel v18) - shown after saving settings that changed a content-relevant field (see
   * router.ts's brandingFieldsChanged). Never automatic: the customer explicitly confirms here,
   * and again separately if any of the affected posts were already hand-edited by them - both
   * gates exist because a re-generation costs real Anthropic/fal.ai money and could otherwise
   * silently discard a manual edit.
   */
  async function offerBrandingRegen(offer) {
    let message = `Sie haben ${offer.changedFieldLabels.join(", ")} geändert. `;
    if (offer.eligibleCount > 0) {
      message += `Das betrifft ${pluralDe(offer.eligibleCount, "noch nicht veröffentlichten Beitrag", "noch nicht veröffentlichte Beiträge")} der nächsten 7 Tage. `;
    }
    if (offer.editedCount > 0) {
      message += `${pluralDe(offer.editedCount, "Beitrag davon haben Sie", "Beiträge davon haben Sie")} bereits selbst bearbeitet - dafür fragen wir gleich noch einmal gesondert nach.`;
    }
    const wantsRegen = await showConfirm({
      title: "Vorbereitete Beiträge aktualisieren?",
      message: message.trim(),
      confirmLabel: "Jetzt neu generieren",
      cancelLabel: "Nicht jetzt",
    });
    if (!wantsRegen) return;

    let includeEdited = false;
    if (offer.editedCount > 0) {
      includeEdited = await showConfirm({
        title: "Bereits bearbeitete Beiträge auch überschreiben?",
        message: `${pluralDe(offer.editedCount, "Beitrag wurde", "Beiträge wurden")} von Ihnen bereits bearbeitet. Sollen auch diese mit den neuen Angaben überschrieben werden? Ihre bisherige Bearbeitung geht dabei verloren.`,
        confirmLabel: "Auch überschreiben",
        cancelLabel: "Bearbeitete behalten",
      });
    }
    if (offer.eligibleCount === 0 && !includeEdited) return; // nothing left to regenerate

    S.banner = { kind: "ok", text: "Beiträge werden mit den neuen Angaben neu generiert …" };
    render(true);
    try {
      const result = await api("POST", "/api/planned-posts/regenerate-for-branding", { includeEdited });
      previewCache = { posts: result.posts, maxRegenerate: result.maxRegenerate };
      if (S.step === "preview") renderPreview();
      S.banner = {
        kind: result.errors ? "bad" : "ok",
        text: `${pluralDe(result.updated, "Beitrag", "Beiträge")} aktualisiert${result.errors ? `, ${pluralDe(result.errors, "Beitrag", "Beiträge")} fehlgeschlagen` : ""}.`,
      };
      render(true);
    } catch (err) {
      S.banner = { kind: "bad", text: err.message || "Die Neugenerierung konnte gerade nicht durchgeführt werden." };
      render(true);
    }
  }

  async function suggestPillarsUi() {
    const btn = $("#pillar-ai-fetch");
    const form = $("#company");
    const company = form?.querySelector("[name=company]")?.value || "";
    const industry = form?.querySelector("[name=industry]")?.value || "";
    const about = $("#f-about")?.value || "";
    const website = $("#f-website")?.value || "";
    const keywords = $("#f-pillar-keywords")?.value || "";
    const box = $("#pillar-ai-results");
    if (!box) return;
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Wird recherchiert …";
    box.innerHTML = "";
    try {
      const { pillars } = await api("POST", "/api/suggest-pillars", { company, industry, about, website, keywords });
      S.pillarSuggestions = pillars;
      box.innerHTML = pillars.map(pillarSuggestionCardHtml).join("");
    } catch (err) {
      box.innerHTML = `<p style="color:var(--stop)">${esc(err.message || "Die Vorschläge konnten gerade nicht erstellt werden.")}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  }

  function renderTrialBar() {
    const bar = $("#trialbar");
    const c = S.customer;
    if (!c || c.trialDaysLeft == null) { bar.style.display = "none"; return; }
    bar.style.display = "flex";
    bar.classList.toggle("ended", c.trialExpired);
    if (c.trialExpired) {
      const subject = encodeURIComponent(`Jetzt freischalten - ${c.company || ""}`);
      bar.innerHTML = `<span>Ihr kostenloser Probezeitraum ist abgelaufen. Es werden vorübergehend keine neuen Beiträge veröffentlicht.</span>
        <a class="btn2" href="mailto:office@pipeline-solutions.at?subject=${subject}">Jetzt freischalten</a>`;
    } else {
      bar.innerHTML = `<span>Probezeitraum: noch ${c.trialDaysLeft} ${c.trialDaysLeft === 1 ? "Tag" : "Tage"}</span>`;
    }
  }

  /* ================= Sheets =================
   * Am Handy als Bottom-Sheet (Griff, wischbar, in der Daumenzone), ab 1024px zentriert.
   * Fokus-Falle und Escape wie beim Bestaetigungsdialog - gleiche Regeln, ein Muster. */
  let sheetLastFocus = null;
  function openSheet(title, bodyHtml, onMount) {
    const overlay = $("#sheet-overlay");
    if (!overlay) return;
    sheetLastFocus = document.activeElement;
    $("#sheet-title").textContent = title;
    $("#sheet-body").innerHTML = bodyHtml;
    overlay.hidden = false;
    document.addEventListener("keydown", onSheetKeydown, true);
    if (onMount) onMount();
    const focusable = $("#sheet").querySelector("input, textarea, button:not(#sheet-close), [href]");
    (focusable || $("#sheet-close")).focus({ preventScroll: true });
  }
  function closeSheet() {
    const overlay = $("#sheet-overlay");
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    $("#sheet-body").innerHTML = "";
    document.removeEventListener("keydown", onSheetKeydown, true);
    if (currentHash() === "posten" || currentHash() === "hilfe") history.replaceState(null, "", location.pathname + location.search);
    if (sheetLastFocus && sheetLastFocus.focus) sheetLastFocus.focus();
  }
  function onSheetKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
    if (e.key !== "Tab") return;
    const els = [...$("#sheet").querySelectorAll("button, input, textarea, select, [href]")].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** "Jetzt posten" ist die Primäraktion und überall erreichbar - deshalb ein Sheet statt einer
   *  eigenen Ansicht: der Kunde verliert nie den Ort, an dem er gerade war. */
  function openPostNow() {
    const c = S.customer;
    if (!c) return;
    const busy = postNowAllBusy(c);
    openSheet("Jetzt posten", `
      ${postNowStatusHtml(c)}
      <div class="field">
        <label for="f-postNowTopic">Worum soll es gehen? <span class="opt">(optional)</span></label>
        ${withDictate(`<textarea id="f-postNowTopic" rows="3" placeholder="z. B. Neue Öffnungszeiten ab Montag" maxlength="300" ${busy ? "disabled" : ""}></textarea>`, busy)}
      </div>
      ${S.aiAvailable && !busy ? `<p class="hint"><button type="button" class="link" id="suggest-topics">Ideen vorschlagen</button></p>
      <div id="topic-suggestions" class="chips" hidden></div>` : ""}
      ${postNowChannelsHtml(c)}
      <div class="actions">
        <button class="btn btn-primary btn-block" id="post-now-btn" ${busy ? "disabled" : ""}>Beitrag erstellen</button>
      </div>
    `);
  }

  /* ================= Kontomenü ================= */
  function toggleAcctMenu(force) {
    const menu = $("#acct-menu");
    const btn = $("#acct-btn");
    if (!menu || !btn) return;
    const open = force != null ? force : menu.hidden;
    if (!open) { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); return; }
    menu.innerHTML = `
      <button type="button" data-go="guide">${icon("hilfe")} Was kann Pipeflow?</button>
      <button type="button" data-restart-tour>${icon("beitraege")} Rundgang starten</button>
      <button type="button" data-open-chat>${icon("hilfe")} Hilfe-Chat</button>
      <hr>
      <button type="button" data-go="settings" data-sub="konto">${icon("einstellungen")} Konto</button>
      <button type="button" id="logout">${icon("close")} Abmelden</button>`;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    menu.querySelector("button").focus({ preventScroll: true });
  }

  /** Onboarding-Schritte zeigen die Pipe als Fortschritt, die Bereiche nicht. */
  const ONBOARDING_STEPS = () => steps();

  function render(focus) {
    // View Transitions fuer den Bereichswechsel, mit Fallback: wo es die API nicht gibt (Firefox,
    // aeltere Safari), rendert es einfach direkt - kein Unterschied ausser der Ueberblendung.
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Abgebrochene Uebergaenge (z. B. wenn sich waehrenddessen die Fenstergroesse aendert) sind
      // erwartbar und duerfen keinen unbehandelten Fehler erzeugen.
      const t = document.startViewTransition(() => renderNow(focus));
      t.finished.catch(() => {});
      t.ready.catch(() => {});
      t.updateCallbackDone.catch(() => {});
    } else {
      renderNow(focus);
    }
  }

  function renderNow(focus) {
    stopActiveDictation(); // #stage wird gleich komplett neu gerendert - eine laufende Aufnahme haette sonst kein gueltiges Zielfeld mehr
    renderTrialBar();
    renderChrome();
    const stage = $("#stage");
    const onboarding = ONBOARDING_STEPS().includes(S.step) && !isEstablished();
    const rail = onboarding ? railHtml() : "";

    if (S.step === "dashboard") { stage.innerHTML = dashboardHtml(); loadDashboardExtras(); }
    else if (S.step === "company") { stage.innerHTML = rail + companyHtml(); updateLivePreview(); updateFirstPostPreview(); }
    else if (S.step === "settings") stage.innerHTML = settingsHtml();
    else if (S.step === "guide") stage.innerHTML = guideHtml();
    else if (S.step === "done") { stage.innerHTML = rail + doneHtml(); }
    else if (S.step === "posts") { stage.innerHTML = postsHtml(); loadPostsTab(); }
    else if (S.step === "preview") { stage.innerHTML = previewHtml(); loadPreview(); }
    else if (S.step === "analytics") { stage.innerHTML = analyticsHtml(); loadAnalytics(); }
    else stage.innerHTML = rail + providerHtml(prov(S.step));

    syncHash();
    if (focus) { stage.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
    if (S.step === "settings") {
      // Suchbegriff ueberlebt das Neu-Rendern (z. B. nach dem Speichern), und ein Sprungziel aus
      // der Funktionsuebersicht landet direkt bei der richtigen Gruppe statt nur "irgendwo" in den
      // Einstellungen.
      if (S.settingsQuery) applySettingsFilter(S.settingsQuery);
      if (S.settingsTarget) { jumpToSettingsGroup(S.settingsTarget); S.settingsTarget = null; }
      updateGradientSuggestions();
      updateLivePreview();
    }
    maybeStartTour();
  }

  /** Der Rundgang startet genau einmal, erst wenn der Kunde fertig eingerichtet auf der Übersicht
   *  landet - nie mitten im Onboarding und nie ungefragt ueber einer anderen Ansicht. */
  function maybeStartTour() {
    if (DEMO) return;
    if (S.tourIndex >= 0) { renderTour(); return; }
    if (S.step !== "dashboard" || !isEstablished() || !S.customer || S.customer.tourDone) return;
    S.tourIndex = 0;
    renderTour();
  }

  function jumpToSettingsGroup(id) {
    const el = document.getElementById(`setgroup-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("is-flash");
    void el.offsetWidth; // Neustart der Hervorhebung erzwingen, falls dieselbe Gruppe erneut angesprungen wird
    el.classList.add("is-flash");
    document.querySelectorAll("[data-setjump]").forEach((b) => b.classList.toggle("is-active", b.dataset.setjump === id));
  }

  /** Blendet Gruppen/Felder aus, die nicht zum Suchbegriff passen - die Eingaben bleiben dabei im
   *  Formular (nur versteckt), es geht also nie ein Wert verloren. */
  function applySettingsFilter(rawQuery) {
    const q = rawQuery.trim().toLowerCase();
    const groups = [...document.querySelectorAll(".setgroup")];
    if (!groups.length) return;
    let anyVisible = false;
    groups.forEach((group) => {
      const groupTitle = (group.querySelector("h2")?.textContent || "").toLowerCase();
      const blocks = [...group.querySelectorAll(":scope > .field, :scope > .check, :scope > fieldset, :scope > h3, :scope > .consequence, :scope > .locked, :scope > .grid2, :scope > .dash-channels, :scope > .actions, :scope > p, :scope > div")];
      if (!q) {
        group.classList.remove("is-filtered");
        blocks.forEach((b) => b.classList.remove("is-filtered"));
        anyVisible = true;
        return;
      }
      const groupMatches = groupTitle.includes(q);
      let hits = 0;
      blocks.forEach((b) => {
        const match = groupMatches || (b.textContent || "").toLowerCase().includes(q);
        b.classList.toggle("is-filtered", !match);
        if (match) hits++;
      });
      const visible = groupMatches || hits > 0;
      group.classList.toggle("is-filtered", !visible);
      if (visible) anyVisible = true;
    });
    const none = $("#set-noresult");
    if (none) none.hidden = anyVisible;
    const hint = $("#set-search-hint");
    if (hint) hint.textContent = q ? `Gefiltert nach „${rawQuery.trim()}“ - Feld leeren, um wieder alles zu sehen.` : "Zeigt sofort nur die passenden Einstellungen an.";
  }

  // Panel v11: "settings:aussehen" springt zur Einstellungs-Ansicht UND dort zur Gruppe - so kann
  // jede Stelle im Panel (Funktionsuebersicht, Dashboard-Hinweise) direkt auf die zustaendige
  // Einstellung zeigen, statt nur grob "in die Einstellungen" zu schicken.
  /** Zustand -> URL. Damit funktionieren Zurück-Geste, Neuladen und E-Mail-Links auf eine Ansicht. */
  function syncHash() {
    const area = AREAS.find((a) => a.view === S.step);
    if (!area) return; // Onboarding bleibt bewusst ohne Deep-Link (linearer Ablauf)
    let sub = "";
    if (area.view === "posts") sub = S.postTab;
    else if (area.view === "analytics") sub = S.analyticsChannel;
    else if (area.view === "settings") sub = S.settingsGroup || "";
    applyHash(hashFor(area.view, sub), { replace: true });
  }

  function go(target, sub) {
    const [step, groupId] = String(target).split(":");
    if (!DETAIL_VIEWS.includes(step) && !steps().includes(step) && step !== "posts") return;
    if (step === "settings" && !isEstablished()) return go("company");
    if (step !== "company" && !S.customer) return go("company");
    if (groupId) S.settingsTarget = groupId;
    if (step === "settings") { S.settingsTarget = sub || S.settingsTarget; S.settingsGroup = sub || ""; }
    if (sub && step === "posts" && POST_TABS.some((t) => t.id === sub)) S.postTab = sub;
    if (sub && step === "analytics" && (sub === "instagram" || sub === "linkedin")) S.analyticsChannel = sub;
    if (step !== "settings") S.settingsQuery = "";
    S.step = step; S.banner = null;
    const area = AREAS.find((a) => a.view === step);
    if (area) applyHash(hashFor(step, sub || (step === "posts" ? S.postTab : step === "analytics" ? S.analyticsChannel : "")));
    render(true);
  }

  // Panel v6 Aufgabe 3: wo bisher hart "done" verlinkt war ("Zurück zur Übersicht" etc.), soll
  // ein wiederkehrender Kunde (mind. 1 Kanal je verbunden) zum neuen Dashboard zurückkehren
  // statt zur alten Schritt-Kette - fuer einen noch mitten im Erst-Setup befindlichen Kunden
  // bleibt "done" exakt wie bisher das Ziel.
  function overviewStep() {
    return (S.customer && S.connections.length > 0) ? "dashboard" : "done";
  }

  // Fuer automatische Weiterleitungen (Seitenaufruf, Speichern im Formular) - anders als
  // overviewStep() faellt das bei einem noch nicht wiederkehrenden Kunden auf firstOpenStep()
  // zurueck, damit die Schritt-Kette (naechster noch offener Kanal) exakt wie bisher
  // weiterlaeuft, statt verfrueht auf "done" zu springen.
  function landingStep() {
    return (S.customer && S.connections.length > 0) ? "dashboard" : firstOpenStep();
  }

  function firstOpenStep() {
    if (!S.customer) return "company";
    const open = S.providers.find((p) => !S.skipped.has(p.id) && (!conn(p.id) || conn(p.id).status !== "ok"));
    return open ? open.id : "done";
  }

  const GRADIENT_CSS_ANGLE = { horizontal: "90deg", vertical: "180deg", diagonal: "135deg" };

  /** Panel v15: zeigt zur aktuellen Akzentfarbe passende Verlauf-Vorschlaege als klickbare
   *  Farbfelder (gleiches .swatch-Muster wie die Akzentfarben-Palette) - neu berechnet, sobald
   *  sich die Akzentfarbe aendert, damit die Vorschlaege nie zu einer inzwischen anderen
   *  Grundfarbe passen. */
  function updateGradientSuggestions() {
    const box = document.getElementById("gradient-suggestions");
    if (!box) return;
    const hex = document.getElementById("f-accentColor")?.value || "#0a0e1a";
    const current = document.getElementById("f-gradientColor2")?.value || "";
    box.innerHTML = suggestGradientPartners(hex).map((s) => `<button type="button" class="swatch" data-gradient-swatch="${s}" aria-pressed="${current.toLowerCase() === s.toLowerCase()}" style="background:${s}" aria-label="${s}"></button>`).join("");
  }

  function updateLivePreview() {
    const square = document.getElementById("lp-square");
    if (!square) return;
    const hex = document.getElementById("f-accentColor")?.value || "#0a0e1a";
    const gradientOn = document.getElementById("f-gradientEnabled")?.checked;
    const color2 = document.getElementById("f-gradientColor2")?.value;
    const direction = document.getElementById("f-gradientDirection")?.value || "diagonal";
    square.style.background = gradientOn && color2
      ? `linear-gradient(${GRADIENT_CSS_ANGLE[direction] || GRADIENT_CSS_ANGLE.diagonal}, ${hex}, ${color2})`
      : hex;
    const wm = document.getElementById("lp-watermark");
    const company = document.querySelector('#formpart-a [name=company]')?.value || document.querySelector('[name=company]')?.value || "";
    const watermarkText = document.getElementById("f-watermarkText")?.value || "";
    if (wm) wm.textContent = watermarkText || company || "Pipeline";
    const family = fontOption(document.getElementById("f-fontChoice")?.value).cssFamily;
    const headlineEl = document.getElementById("lp-headline");
    if (headlineEl) headlineEl.style.fontFamily = `'${family}'`;
    if (wm) wm.style.fontFamily = `'${family}'`;
  }

  /* ================= „Ihr erster Beitrag" - Live-Vorschau im Onboarding =================
     Waechst mit, waehrend das Briefing ausgefuellt wird: dasselbe Bildquadrat wie in den
     Einstellungen, dazu Kanal und Zeitpunkt aus den Kanalfeldern und ein Beispieltext aus
     Beschreibung, Saeulen und Aufruf. Rein lokal zusammengesetzt - kein API-Aufruf, keine KI,
     keine Vertragsaenderung. Der Text ist ausdruecklich als Beispiel ausgewiesen: den echten
     schreibt die Routine spaeter aus genau diesen Angaben. Nur im Onboarding - wer eingerichtet
     ist, sieht in den Einstellungen echte Beitraege statt einer Attrappe. */
  const CTA_PREVIEW = {
    link_bio: "Mehr dazu über den Link in unserer Bio.",
    anrufen: "Rufen Sie uns an - wir nehmen uns Zeit.",
    nachricht: "Schreiben Sie uns eine Nachricht.",
    termin: "Termin buchen - online in zwei Minuten.",
    keiner: "",
  };
  const FP_SKELETON = '<div class="sk sk-line" style="width:92%"></div><div class="sk sk-line" style="width:78%"></div><div class="sk sk-line" style="width:54%"></div>';

  function firstPostPreviewHtml() {
    return `
      <section class="fp" id="first-post" aria-labelledby="fp-title">
        <h2 id="fp-title">Ihr erster Beitrag</h2>
        <p class="hint">Wächst mit, während Sie ausfüllen - ein Beispiel dafür, wie Ihr Beitrag aussehen wird. Den Text schreibt die KI später aus genau diesen Angaben.</p>
        <div class="fp-card">
          <div class="fp-media" id="fp-media">
            <span class="fp-headline" id="fp-headline">Ihr Beitrag</span>
            <span class="fp-watermark" id="fp-watermark">Ihr Firmenname</span>
          </div>
          <div class="fp-body">
            <p class="card-kicker"><span class="pipe-node" data-state="planned" aria-hidden="true"></span><span id="fp-kicker">Noch kein Kanal gewählt</span></p>
            <div class="fp-caption" id="fp-caption">${FP_SKELETON}</div>
            <p class="fp-tags micro muted" id="fp-tags" hidden></p>
            <p class="fp-style micro muted" id="fp-style"></p>
          </div>
        </div>
        <p class="fp-progress small" id="fp-progress" aria-live="polite"></p>
      </section>`;
  }

  const fpVal = (sel) => { const el = document.querySelector(sel); return el ? String(el.value || "").trim() : ""; };
  const fpChecked = (name) => { const el = document.querySelector(`#company [name="${name}"]`); return el ? el.checked : false; };

  /** Erster Satz, hoechstens `max` Zeichen - der Beispieltext soll nach Beitrag aussehen, nicht
   *  nach abgeschnittenem Formularfeld. */
  function fpFirstSentence(text, max) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    const end = clean.search(/[.!?](\s|$)/);
    const sentence = end > 0 ? clean.slice(0, end + 1) : clean;
    return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
  }

  /** Beispiel-Hashtags aus den Angaben: Wortgrenzen zu CamelCase, Dubletten weg. Umlaute bleiben
   *  stehen - Instagram und LinkedIn koennen sie, "#Ruckenschmerzen" saehe aus wie ein Tippfehler. */
  function fpTags(words, count) {
    const seen = new Set();
    const tags = [];
    for (const word of words) {
      const tag = String(word || "")
        .replace(/[^A-Za-z0-9\u00C0-\u024F ]+/g, " ")
        .trim().split(/\s+/).filter(Boolean)
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join("");
      if (tag.length < 4 || seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      tags.push(`#${tag}`);
      if (tags.length >= count) break;
    }
    return tags;
  }

  /** Aus der Beschreibung taugen als Hashtag vor allem Hauptwoerter - im Deutschen also die
   *  grossgeschriebenen Woerter, abzueglich der ueblichen Satzanfaenge. */
  const FP_STOPWORDS = new Set(["wir", "sie", "ihr", "ihre", "unser", "unsere", "der", "die", "das",
    "ein", "eine", "einen", "einem", "einer", "und", "aber", "auch", "dabei", "damit", "durch",
    "für", "hier", "immer", "mehr", "nach", "oder", "viele", "wenn", "zwischen"]);
  function fpNouns(text) {
    return String(text || "").split(/[\s,.;:!?()"„“]+/)
      .filter((w) => w.length > 4 && /^[A-ZÄÖÜ]/.test(w) && !FP_STOPWORDS.has(w.toLowerCase()));
  }

  function updateFirstPostPreview() {
    const media = document.getElementById("fp-media");
    if (!media) return;

    const company = fpVal('#company [name="company"]');
    const industry = fpVal("#f-industry");
    const about = fpVal("#f-about");
    const pillars = Array.from(document.querySelectorAll("#company [data-pillar-title]"))
      .map((el) => el.value.trim()).filter(Boolean);
    const accent = document.getElementById("f-accentColor")?.value || "#0a0e1a";
    const watermark = fpVal("#f-watermarkText");
    const tone = fpVal("#f-tone") || "sachlich";
    const language = fpVal("#f-language") || "de";
    const cta = fpVal("#f-ctaPreference") || "link_bio";
    const hashtagPref = fpVal("#f-hashtagPreference") || "wenige";
    const emojis = fpChecked("emojisEnabled");
    const postTime = fpVal("#f-postTime") || "15:00";

    // Bild: gleiche Herleitung wie die Vorschau in den Einstellungen (Akzentfarbe, Beschriftung)
    media.style.background = accent;
    // Ueberschrift im Bild: nur was auch als Ueberschrift taugt. Ein abgeschnittener Satz mit "…"
    // saehe im Beitragsbild aus wie ein Fehler - dann lieber Branche oder Firmenname.
    const aboutLine = fpFirstSentence(about, 42);
    const headline = pillars[0] || (aboutLine.endsWith("…") ? "" : aboutLine) || industry || company || "Ihr Beitrag";
    document.getElementById("fp-headline").textContent = headline;
    document.getElementById("fp-watermark").textContent = watermark || company || "Ihr Firmenname";

    // Kanal und Zeitpunkt aus denselben Feldern, die spaeter den Plan steuern
    const channels = [];
    if (fpChecked("igFeedEnabled")) channels.push("Instagram Feed");
    if (fpChecked("igStoryEnabled")) channels.push("Instagram Story");
    if (fpChecked("linkedinEnabled")) channels.push("LinkedIn");
    const dayRow = channels[0] === "LinkedIn" ? "linkedin" : "instagram";
    const days = Array.from(document.querySelectorAll(`#company [data-weekday-channel="${dayRow}"] input:checked`))
      .map((el) => Number(el.value)).sort((a, b) => a - b);
    const dayText = !days.length ? "noch kein Tag gewählt"
      : days.length === 7 ? "täglich"
      : days.join(",") === "1,2,3,4,5" ? "werktags"
      : days.map((d) => WEEKDAYS[d - 1]).join(", ");
    document.getElementById("fp-kicker").textContent = channels.length
      ? `${channels[0]} · ${dayText} um ${postTime} Uhr`
      : "Noch kein Kanal gewählt";

    // Text: erst wenn die Beschreibung steht - vorher ehrlich ein Platzhalter statt erfundener Werbetext
    const caption = document.getElementById("fp-caption");
    const lead = fpFirstSentence(about, 150);
    if (!lead) {
      caption.innerHTML = FP_SKELETON;
    } else {
      const ctaLine = CTA_PREVIEW[cta] || "";
      caption.innerHTML = [emojis ? `✨ ${lead}` : lead, ctaLine].filter(Boolean)
        .map((line) => `<p>${esc(line)}</p>`).join("");
    }

    const tagsEl = document.getElementById("fp-tags");
    const count = hashtagPref === "keine" ? 0 : hashtagPref === "viele" ? 6 : 3;
    const tags = count ? fpTags([...pillars, industry, company, ...fpNouns(about)], count) : [];
    tagsEl.hidden = !tags.length;
    tagsEl.textContent = tags.join(" ");

    document.getElementById("fp-style").textContent =
      `Ton: ${TONES[tone] || tone} · Sprache: ${LANGUAGES[language] || language} · ${emojis ? "mit" : "ohne"} Emojis`;

    // Der einzige Satz, der sagt, was noch fehlt - aria-live, aber nur bei echter Aenderung
    const missing = [];
    if (!company) missing.push("Firmenname");
    if (!about) missing.push("Beschreibung");
    if (!channels.length) missing.push("Kanal");
    if (!days.length) missing.push("Tag");
    const progress = document.getElementById("fp-progress");
    const text = missing.length
      ? `Noch offen: ${missing.join(", ")}.`
      : "Alles da, was wir für Ihren ersten Beitrag brauchen.";
    if (progress.textContent !== text) progress.textContent = text;
  }

  document.addEventListener("input", (e) => {
    if (e.target.id === "f-accentColor" || e.target.id === "f-watermarkText" || e.target.name === "company" ||
        e.target.id === "f-gradientColor2" || e.target.id === "f-gradientDirection" || e.target.id === "f-fontChoice") {
      updateLivePreview();
    }
    // Die Vorschau "Ihr erster Beitrag" haengt an fast allen Briefing-Feldern - ein Aufruf fuer
    // alle ist billiger und vollstaendiger als eine Liste von IDs, die beim naechsten neuen Feld
    // wieder vergessen wird. Sie liest nur DOM-Werte, kein Netz.
    if (e.target.closest && e.target.closest("#company")) updateFirstPostPreview();
    if (e.target.id === "f-accentColor") updateGradientSuggestions();
    if (e.target.id === "f-pillar-keywords") {
      S.pillarAiKeywords = e.target.value;
    }
    // Panel v11: Einstellungs-Suche - filtert beim Tippen, ohne neu zu rendern (das wuerde den
    // Fokus aus dem Feld reissen und nicht gespeicherte Eingaben in anderen Feldern verwerfen).
    if (e.target.id === "set-search-input") {
      S.settingsQuery = e.target.value;
      applySettingsFilter(S.settingsQuery);
    }
  });

  document.addEventListener("change", (e) => {
    if (e.target.id === "f-gradientEnabled") {
      const box = document.getElementById("gradient-options");
      if (box) box.hidden = !e.target.checked;
      if (e.target.checked) updateGradientSuggestions();
      updateLivePreview();
    }
    // Auswahlfelder, Haken und Wochentage loesen kein "input" aus, veraendern die Vorschau aber
    // genauso (Kanal, Uhrzeit, Hashtags, Emojis, Sprache, Ton).
    if (e.target.closest && e.target.closest("#company")) updateFirstPostPreview();
    // Stimmen-Beschreibung zur Auswahl (aus v22)
    if (e.target.id === "f-videoVoice") {
      const desc = document.getElementById("voice-desc");
      const v = (S.videoVoices || []).find((x) => x.id === e.target.value);
      if (desc) desc.textContent = (v && v.description) || "";
    }
  });

  let pendingLogoDataUrl = null;
  document.addEventListener("change", (e) => {
    if (e.target.id !== "f-logo") return;
    const file = e.target.files?.[0];
    const uploadBtn = $("#logo-upload");
    pendingLogoDataUrl = null;
    if (uploadBtn) uploadBtn.disabled = true;
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      showAlert({ title: "Ungültige Datei", message: "Bitte eine PNG- oder JPG-Datei wählen." });
      e.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showAlert({ title: "Datei zu groß", message: "Bitte eine Datei bis maximal 2 MB wählen." });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingLogoDataUrl = reader.result;
      const preview = $("#logo-preview");
      if (preview) preview.innerHTML = `<img src="${pendingLogoDataUrl}" alt="Vorschau" style="width:64px;height:64px;object-fit:contain;background:var(--wash);border-radius:2px">`;
      if (uploadBtn) uploadBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  });

  async function improveBriefing() {
    const btn = $("#ai-improve");
    const form = $("#company");
    const company = form.querySelector("[name=company]")?.value || "";
    const industry = form.querySelector("[name=industry]")?.value || "";
    const about = $("#f-about").value || "";
    if (!about.trim()) {
      $("#f-about").focus();
      return;
    }
    const box = $("#ai-suggestion");
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Wird erstellt …";
    box.hidden = true;
    try {
      const { suggestion } = await api("POST", "/api/improve-briefing", { company, industry, about });
      box.dataset.suggestion = suggestion;
      box.hidden = false;
      box.className = "ai-box";
      box.innerHTML = `<p>${esc(suggestion)}</p>
        <div class="row">
          <button type="button" data-ai-accept>Übernehmen</button>
          <button type="button" class="ghost" data-ai-discard>Verwerfen</button>
        </div>`;
    } catch (err) {
      box.hidden = false;
      box.className = "ai-box";
      box.innerHTML = `<p style="color:var(--stop)">${esc(err.message || "Der Vorschlag konnte gerade nicht erstellt werden.")}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  }

  async function analyzeWebsiteSuggestion() {
    const btn = $("#analyze-website");
    const website = $("#f-website")?.value || "";
    if (!website.trim()) {
      $("#f-website").focus();
      return;
    }
    const box = $("#website-suggestion");
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Wird analysiert …";
    box.hidden = true;
    try {
      const { suggestion } = await api("POST", "/api/analyze-website", { website });
      box.dataset.suggestion = JSON.stringify(suggestion);
      box.hidden = false;
      box.className = "ai-box";
      box.innerHTML = `<p><strong>Branche:</strong> ${esc(suggestion.industry || "–")}</p>
        <p><strong>Beschreibung:</strong> ${esc(suggestion.about || "–")}</p>
        <p><strong>Tonalität:</strong> ${esc(TONES[suggestion.tone] || suggestion.tone || "–")}</p>
        <p><strong>Hashtag-Vorschläge:</strong> ${suggestion.hashtags?.length ? suggestion.hashtags.map((h) => `#${esc(h)}`).join(" ") : "–"}</p>
        <div class="row">
          <button type="button" data-website-accept>Übernehmen</button>
          <button type="button" class="ghost" data-website-discard>Verwerfen</button>
        </div>`;
    } catch (err) {
      box.hidden = false;
      box.className = "ai-box";
      box.innerHTML = `<p style="color:var(--stop)">${esc(err.message || "Die Website konnte gerade nicht analysiert werden.")}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  }

  async function suggestTopicsUi() {
    const btn = $("#suggest-topics");
    const box = $("#topic-suggestions");
    if (!btn || !box) return;
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Wird erstellt …";
    box.hidden = true;
    try {
      const { topics } = await api("POST", "/api/suggest-topics", {});
      box.hidden = false;
      box.innerHTML = topics.map((t) => `<button type="button" class="chip" data-topic-chip="${esc(t)}">${esc(t)}</button>`).join("");
    } catch (err) {
      box.hidden = false;
      box.innerHTML = `<p style="color:var(--stop)">${esc(err.message || "Die Vorschläge konnten gerade nicht erstellt werden.")}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  }

  async function analyticsSummaryUi() {
    const btn = $("#analytics-summary-btn");
    const box = $("#analytics-summary-box");
    if (!btn || !box) return;
    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Wird erstellt …";
    try {
      const result = await api("POST", "/api/analytics-summary", { channel: S.analyticsChannel });
      box.innerHTML = analyticsSummaryBoxHtml(result);
    } catch (err) {
      box.innerHTML = `<p style="color:var(--stop)">${esc(err.message || "Die Zusammenfassung konnte gerade nicht erstellt werden.")}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = oldLabel;
    }
  }

  /* ================= Eigener Bestaetigungs-/Hinweis-Dialog ================= */
  /* Ersetzt window.confirm()/window.alert() ueberall im Panel durch ein Overlay im
     bestehenden Design (statt haesslichem, browserabhaengigem nativen Popup). Fokus wird beim
     Oeffnen in den Dialog gesetzt, Tab bleibt darin gefangen, Klick daneben oder Escape wirkt
     wie Abbrechen. showConfirm() kann optional per typeToConfirm einen Eintipp-Schutz verlangen
     (ersetzt an der Loesch-Konto-Stelle das bisherige confirm()+prompt()-Duo durch einen
     einzigen Dialog). */
  const confirmOverlay = $("#confirm-overlay");
  const confirmDialog = confirmOverlay.querySelector(".confirm-dialog");
  const confirmTitleEl = $("#confirm-title");
  const confirmMessageEl = $("#confirm-message");
  const confirmCancelBtn = $("#confirm-cancel");
  const confirmOkBtn = $("#confirm-ok");
  const confirmTypecheck = $("#confirm-typecheck");
  const confirmTypeLabel = $("#confirm-type-label");
  const confirmTypeInput = $("#confirm-type-input");

  let confirmResolve = null;
  let confirmLastFocused = null;
  let confirmTypeToConfirm = null;

  function confirmFocusables() {
    return Array.from(confirmDialog.querySelectorAll("button, input, [href], [tabindex]"))
      .filter((el) => !el.hidden && !el.disabled);
  }

  function confirmUpdateOkState() {
    if (confirmTypeToConfirm === null) return;
    confirmOkBtn.disabled = confirmTypeInput.value !== confirmTypeToConfirm;
  }

  function closeConfirm(result) {
    confirmOverlay.hidden = true;
    document.removeEventListener("keydown", onConfirmKeydown, true);
    confirmTypeInput.removeEventListener("input", confirmUpdateOkState);
    const resolve = confirmResolve;
    confirmResolve = null;
    if (confirmLastFocused && confirmLastFocused.focus) confirmLastFocused.focus();
    if (resolve) resolve(result);
  }

  function onConfirmKeydown(e) {
    if (e.key === "Escape") { e.preventDefault(); closeConfirm(false); return; }
    if (e.key !== "Tab") return;
    const els = confirmFocusables();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  confirmOverlay.addEventListener("mousedown", (e) => { if (e.target === confirmOverlay) closeConfirm(false); });
  confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
  confirmOkBtn.addEventListener("click", () => {
    if (confirmTypeToConfirm !== null && confirmTypeInput.value !== confirmTypeToConfirm) return;
    closeConfirm(true);
  });
  confirmTypeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !confirmOkBtn.disabled) { e.preventDefault(); confirmOkBtn.click(); }
  });

  function showConfirm({ title, message, confirmLabel = "Bestätigen", cancelLabel = "Abbrechen", danger = false, typeToConfirm = null, typeToConfirmLabel = null } = {}) {
    return new Promise((resolve) => {
      if (confirmResolve) closeConfirm(false); // falls schon einer offen ist (sollte nicht vorkommen): sauber schliessen statt zu stapeln
      confirmLastFocused = document.activeElement;
      confirmResolve = resolve;
      confirmTitleEl.textContent = title || "";
      confirmMessageEl.textContent = message || "";
      confirmOkBtn.textContent = confirmLabel;
      confirmOkBtn.className = "confirm-ok" + (danger ? " danger" : "");
      if (cancelLabel === null) {
        confirmCancelBtn.hidden = true;
      } else {
        confirmCancelBtn.hidden = false;
        confirmCancelBtn.textContent = cancelLabel;
      }
      confirmTypeToConfirm = typeToConfirm;
      if (typeToConfirm !== null) {
        confirmTypecheck.hidden = false;
        confirmTypeLabel.textContent = typeToConfirmLabel || `Zur Bestätigung "${typeToConfirm}" eingeben:`;
        confirmTypeInput.value = "";
        confirmOkBtn.disabled = true;
        confirmTypeInput.addEventListener("input", confirmUpdateOkState);
      } else {
        confirmTypecheck.hidden = true;
        confirmOkBtn.disabled = false;
      }
      confirmOverlay.hidden = false;
      document.addEventListener("keydown", onConfirmKeydown, true);
      // Bei gefaehrlichen Aktionen ohne Eintipp-Schutz startet der Fokus auf "Abbrechen" - ein
      // versehentliches Enter darf nichts Destruktives auslösen.
      const initialFocus = typeToConfirm !== null ? confirmTypeInput : danger && !confirmCancelBtn.hidden ? confirmCancelBtn : confirmOkBtn;
      requestAnimationFrame(() => initialFocus.focus());
    });
  }

  function showAlert({ title, message, okLabel = "OK" } = {}) {
    return showConfirm({ title, message, confirmLabel: okLabel, cancelLabel: null });
  }

  function showError(message) {
    return showAlert({ title: "Fehler", message: message || "Etwas ist schiefgelaufen." });
  }

  /* ================= Events ================= */
  function openLightbox(src, alt) {
    if (!src) return;
    const overlay = $("#lightbox");
    const img = $("#lightbox-img");
    if (!overlay || !img) return;
    img.src = src;
    img.alt = alt || "";
    overlay.hidden = false;
  }
  function closeLightbox() {
    const overlay = $("#lightbox");
    if (overlay) overlay.hidden = true;
    const img = $("#lightbox-img");
    if (img) img.src = "";
  }
  /* ================= Hilfe-Chat (Panel v6, Aufgabe 6) ================= */
  // Verlauf bewusst nur im Speicher dieser Seiten-Sitzung (kein localStorage/Server-Speicher
  // noetig laut Aufgabenstellung) - ein Neuladen der Seite startet den Chat einfach neu.
  const helpChat = { messages: [], open: false, busy: false };

  /** Der Hilfe-Chat haengt jetzt am runden Knopf unten rechts (Pixel-Icon statt Emoji) und
   *  oeffnet sich als Sheet - am Handy also in der Daumenzone statt als kleines Fenster. */
  function updateHelpChatVisibility() {
    const fab = $("#chat-fab");
    if (fab) {
      fab.innerHTML = icon("hilfe", 18);
      fab.hidden = !S.aiAvailable || !isEstablished() || DEMO;
    }
  }

  function renderHelpChatMessages() {
    const box = $("#help-chat-messages");
    if (!box) return;
    box.innerHTML = helpChat.messages.map((m) =>
      `<div class="chat-msg ${m.role === "user" ? "me" : "bot"}${m.pending ? " pending" : ""}">${esc(m.content)}</div>`
    ).join("");
    box.scrollTop = box.scrollHeight;
  }

  const CHAT_STARTERS = ["Wie ändere ich meine Farbe?", "Was bedeutet Freigabe-Modus?", "Wie verbinde ich Instagram?"];

  function openHelpChat() {
    helpChat.open = true;
    openSheet("Hilfe", `
      <div class="chat-log" id="help-chat-messages"></div>
      ${helpChat.messages.length ? "" : `<div class="chips" style="margin-bottom:var(--s4)">${CHAT_STARTERS.map((s) => `<button type="button" class="chip" data-chat-starter="${esc(s)}">${esc(s)}</button>`).join("")}</div>`}
      <form class="chat-form" id="help-chat-form">
        ${withDictate(`<textarea id="help-chat-input" rows="1" placeholder="Ihre Frage" maxlength="500"></textarea>`)}
        <button class="btn btn-primary" type="submit">Senden</button>
      </form>`, renderHelpChatMessages);
    applyHash("hilfe", { replace: true });
  }
  function closeHelpChat() {
    helpChat.open = false;
    closeSheet();
  }

  async function sendHelpChatMessage(text) {
    if (!text || helpChat.busy) return;
    helpChat.messages.push({ role: "user", content: text });
    helpChat.messages.push({ role: "assistant", content: "…", pending: true });
    helpChat.busy = true;
    renderHelpChatMessages();
    try {
      const history = helpChat.messages.filter((m) => !m.pending).map((m) => ({ role: m.role, content: m.content }));
      const { reply } = await api("POST", "/api/help-chat", { messages: history });
      helpChat.messages.pop();
      helpChat.messages.push({ role: "assistant", content: reply });
    } catch (err) {
      helpChat.messages.pop();
      helpChat.messages.push({ role: "assistant", content: err.message || "Der Hilfe-Chat konnte gerade nicht antworten. Bitte später erneut versuchen." });
    } finally {
      helpChat.busy = false;
      renderHelpChatMessages();
    }
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLightbox(); closeHelpChat(); } });

  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "help-chat-form") return;
    e.preventDefault();
    const input = $("#help-chat-input");
    const text = (input?.value || "").trim();
    if (!text) return;
    input.value = "";
    await sendHelpChatMessage(text);
  });

  document.addEventListener("click", async (e) => {
    /* --- Redesign: neue Bedienelemente zuerst --- */
    const postNowTrigger = e.target.closest("[data-open-post-now]");
    if (postNowTrigger) { e.preventDefault(); openPostNow(); return; }

    const setGroupBtn = e.target.closest("[data-setgroup]");
    if (setGroupBtn) {
      S.settingsGroup = setGroupBtn.dataset.setgroup || "";
      const layout = $("#set-layout");
      if (layout) layout.dataset.mobileGroup = S.settingsGroup;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn && !tabBtn.dataset.go) {
      const id = tabBtn.dataset.tab;
      if (POST_TABS.some((t) => t.id === id) && id !== S.postTab) {
        S.postTab = id;
        applyHash(hashFor("posts", id)); // pushState: die Zurück-Geste führt zum vorigen Reiter
        render(true);
      }
      return;
    }

    if (e.target.closest("#sheet-close") || e.target === $("#sheet-overlay")) { closeSheet(); return; }

    if (e.target.closest("#acct-btn")) { e.preventDefault(); toggleAcctMenu(); return; }
    if (!e.target.closest("#acct-menu") && !$("#acct-menu")?.hidden) toggleAcctMenu(false);
    if (e.target.closest("[data-open-chat]")) { toggleAcctMenu(false); openHelpChat(); return; }
    if (e.target.closest("#chat-fab")) { openHelpChat(); return; }
    if (e.target.closest("[data-restart-tour]")) { toggleAcctMenu(false); S.tourIndex = 0; renderTour(); return; }
    if (e.target.closest("[data-reload]")) { render(false); return; }

    const dictateBtn = e.target.closest("[data-dictate]");
    if (dictateBtn) { toggleDictation(dictateBtn); return; }
    const tile = e.target.closest(".post-tile");
    if (tile && tile.dataset.lightbox) { openLightbox(tile.dataset.lightbox, tile.getAttribute("aria-label") || ""); return; }
    const lightboxTrigger = e.target.closest("[data-lightbox]");
    if (lightboxTrigger && lightboxTrigger.tagName === "IMG") {
      openLightbox(lightboxTrigger.currentSrc || lightboxTrigger.src, lightboxTrigger.alt);
      return;
    }
    if (e.target.closest(".lightbox-close") || e.target.id === "lightbox") { closeLightbox(); return; }
    if (e.target.id === "lightbox-close" || e.target.id === "lightbox-overlay") {
      closeLightbox();
      return;
    }
    const chatStarter = e.target.closest("[data-chat-starter]");
    if (chatStarter) {
      const input = $("#help-chat-input");
      if (input) { input.value = chatStarter.dataset.chatStarter; input.focus(); }
      return;
    }
    if (e.target.closest("#help-chat-close")) {
      closeHelpChat();
      return;
    }

    const swatch = e.target.closest("[data-swatch]");
    if (swatch) {
      const hex = swatch.dataset.swatch;
      const picker = document.getElementById("f-accentColor");
      if (picker) picker.value = hex;
      document.querySelectorAll("[data-swatch]").forEach((b) => b.setAttribute("aria-pressed", String(b === swatch)));
      updateGradientSuggestions();
      updateLivePreview();
      return;
    }
    const gradientSwatch = e.target.closest("[data-gradient-swatch]");
    if (gradientSwatch) {
      const hex = gradientSwatch.dataset.gradientSwatch;
      const picker = document.getElementById("f-gradientColor2");
      if (picker) picker.value = hex;
      document.querySelectorAll("[data-gradient-swatch]").forEach((b) => b.setAttribute("aria-pressed", String(b === gradientSwatch)));
      updateLivePreview();
      return;
    }
    const formPartBtn = e.target.closest("[data-formpart]");
    if (formPartBtn) return switchFormPart(Number(formPartBtn.dataset.formpart));
    if (e.target.closest("#ai-improve")) return improveBriefing();
    if (e.target.closest("#voice-preview")) {
      const btn = e.target.closest("#voice-preview");
      const voice = document.querySelector('[name="videoVoice"]')?.value || "";
      const state = $("#voice-preview-state");
      btn.classList.add("busy");
      if (state) state.textContent = "wird erzeugt …";
      try {
        const { audioDataUrl } = await api("POST", "/api/voice-preview", { voice });
        const audio = new Audio(audioDataUrl);
        if (state) state.textContent = "spielt ab";
        audio.onended = () => { if (state) state.textContent = ""; };
        await audio.play();
      } catch (err) {
        if (state) state.textContent = "";
        showError(err.message || "Hörprobe fehlgeschlagen.");
      } finally {
        btn.classList.remove("busy");
      }
      return;
    }
    if (e.target.closest("#analyze-website")) return analyzeWebsiteSuggestion();
    if (e.target.closest("#suggest-topics")) return suggestTopicsUi();
    if (e.target.closest("#analytics-summary-btn")) return analyticsSummaryUi();
    const analyticsTabBtn = e.target.closest("[data-analytics-channel]");
    if (analyticsTabBtn) {
      S.analyticsChannel = analyticsTabBtn.dataset.analyticsChannel;
      applyHash(hashFor("analytics", S.analyticsChannel));
      render(true);
      return;
    }
    const topicChip = e.target.closest("[data-topic-chip]");
    if (topicChip) {
      const input = $("#f-postNowTopic");
      if (input) { input.value = topicChip.dataset.topicChip; input.focus(); }
      return;
    }

    const previewDay = e.target.closest("[data-preview-day]");
    if (previewDay) {
      previewSelectedDate = previewDay.dataset.previewDay;
      renderPreview();
      return;
    }
    const ppSwatch = e.target.closest("[data-pp-swatch]");
    if (ppSwatch) {
      const colorInput = ppSwatch.closest(".preview-card-body")?.querySelector("[data-pp-color]");
      if (colorInput) colorInput.value = ppSwatch.dataset.ppSwatch;
      return;
    }
    const ppSave = e.target.closest("[data-pp-save]");
    if (ppSave) {
      const id = ppSave.dataset.ppSave;
      const headlineEl = document.getElementById(`pp-headline-${id}`);
      const captionEl = document.getElementById(`pp-caption-${id}`);
      const statusEl = document.querySelector(`[data-pp-save-status="${id}"]`);
      if (statusEl) statusEl.textContent = "";
      ppSave.disabled = true;
      try {
        const body = {};
        if (headlineEl) body.headline = headlineEl.value;
        if (captionEl) body.caption = captionEl.value;
        const { post } = await api("PATCH", `/api/planned-posts/${id}`, body);
        updatePlannedPostInCache(post);
      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message || "Konnte nicht gespeichert werden."; statusEl.style.color = "var(--stop)"; }
        ppSave.disabled = false;
      }
      return;
    }
    const ppRegen = e.target.closest("[data-pp-regenerate]");
    if (ppRegen) {
      const id = ppRegen.dataset.ppRegenerate;
      const colorInput = ppRegen.closest(".preview-card-body")?.querySelector("[data-pp-color]");
      const accentColor = colorInput ? colorInput.value : "#0a0e1a";
      const oldLabel = ppRegen.textContent;
      ppRegen.disabled = true;
      ppRegen.textContent = "Wird erstellt …";
      try {
        const { post } = await api("POST", `/api/planned-posts/${id}/regenerate-image`, { accentColor });
        updatePlannedPostInCache(post);
      } catch (err) {
        showError(err.message || "Das Bild konnte nicht neu erstellt werden.");
        ppRegen.disabled = false;
        ppRegen.textContent = oldLabel;
      }
      return;
    }
    const ppSkip = e.target.closest("[data-pp-skip]");
    if (ppSkip) {
      if (!(await showConfirm({ title: "Beitrag überspringen?", message: "Er wird dann nicht veröffentlicht.", confirmLabel: "Überspringen" }))) return;
      const id = ppSkip.dataset.ppSkip;
      ppSkip.classList.add("busy");
      try {
        const { post } = await api("POST", `/api/planned-posts/${id}/skip`);
        updatePlannedPostInCache(post);
      } catch (err) {
        showError(err.message || "Konnte nicht übersprungen werden.");
        ppSkip.classList.remove("busy");
      }
      return;
    }
    const ppApprove = e.target.closest("[data-pp-approve]");
    if (ppApprove) {
      const id = ppApprove.dataset.ppApprove;
      ppApprove.classList.add("busy");
      try {
        const { post } = await api("POST", `/api/planned-posts/${id}/approve`);
        updatePlannedPostInCache(post);
      } catch (err) {
        showError(err.message || "Konnte nicht freigegeben werden.");
        ppApprove.classList.remove("busy");
      }
      return;
    }
    if (e.target.closest("[data-website-accept]")) {
      const box = $("#website-suggestion");
      const suggestion = JSON.parse(box.dataset.suggestion || "{}");
      if (suggestion.industry) $("#f-industry").value = suggestion.industry;
      if (suggestion.about) {
        const hashtagLine = suggestion.hashtags?.length ? `\n\nHashtag-Vorschläge: ${suggestion.hashtags.map((h) => `#${h}`).join(" ")}` : "";
        $("#f-about").value = suggestion.about + hashtagLine;
      }
      if (suggestion.tone && $("#f-tone")) $("#f-tone").value = suggestion.tone;
      box.hidden = true;
      box.innerHTML = "";
      updateFirstPostPreview(); // gesetzte Felder loesen kein input-Ereignis aus
      return;
    }
    if (e.target.closest("[data-website-discard]")) {
      const box = $("#website-suggestion");
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    if (e.target.closest("#logo-upload")) {
      const btn = e.target.closest("#logo-upload");
      if (!pendingLogoDataUrl) return;
      btn.classList.add("busy");
      try {
        applyState(await api("POST", "/api/logo", { imageBase64: pendingLogoDataUrl }));
        pendingLogoDataUrl = null;
        const section = $("#logo-section");
        if (section) section.innerHTML = logoSectionHtml(S.customer);
      } catch (err) {
        showError(err.message || "Hochladen fehlgeschlagen.");
        btn.classList.remove("busy");
      }
      return;
    }
    if (e.target.closest("#logo-remove")) {
      const btn = e.target.closest("#logo-remove");
      if (!(await showConfirm({ title: "Logo entfernen?", message: "Danach wird wieder die Text-Beschriftung verwendet." }))) return;
      btn.disabled = true;
      try {
        applyState(await api("DELETE", "/api/logo"));
        const section = $("#logo-section");
        if (section) section.innerHTML = logoSectionHtml(S.customer);
      } catch (err) {
        showError(err.message || "Konnte nicht entfernt werden.");
        btn.disabled = false;
      }
      return;
    }
    const themeSaveBtn = e.target.closest("#theme-save");
    if (themeSaveBtn) {
      const name = prompt("Name für dieses Farbthema (z. B. \"Sommer-Kampagne\"):");
      if (!name || !name.trim()) return;
      themeSaveBtn.classList.add("busy");
      try {
        const accentColor = $("#f-accentColor")?.value || "";
        const watermarkText = $("#f-watermarkText")?.value || "";
        const result = await api("POST", "/api/themes", { name: name.trim(), accentColor, watermarkText });
        S.customer.savedThemes = result.savedThemes;
        const section = $("#themes-section");
        if (section) section.innerHTML = themesSectionHtml(S.customer);
      } catch (err) {
        showError(err.message || "Konnte nicht gespeichert werden.");
        themeSaveBtn.classList.remove("busy");
      }
      return;
    }
    const activateBtn = e.target.closest("[data-theme-activate]");
    if (activateBtn) {
      activateBtn.classList.add("busy");
      try {
        applyState(await api("POST", `/api/themes/${activateBtn.dataset.themeActivate}/activate`));
        const section = $("#themes-section");
        if (section) section.innerHTML = themesSectionHtml(S.customer);
      } catch (err) {
        showError(err.message || "Konnte nicht aktiviert werden.");
        activateBtn.classList.remove("busy");
      }
      return;
    }
    const themeDeactivateBtn = e.target.closest("#theme-deactivate");
    if (themeDeactivateBtn) {
      themeDeactivateBtn.classList.add("busy");
      try {
        applyState(await api("POST", "/api/themes/deactivate"));
        const section = $("#themes-section");
        if (section) section.innerHTML = themesSectionHtml(S.customer);
      } catch (err) {
        showError(err.message || "Konnte nicht geändert werden.");
        themeDeactivateBtn.classList.remove("busy");
      }
      return;
    }
    if (e.target.closest("#pillar-add")) {
      syncPillarsDraftFromDom();
      if (S.pillarsDraft.length < 6) S.pillarsDraft.push({ title: "", description: "", weight: 1 });
      repaintPillars();
      return;
    }
    const pillarRemove = e.target.closest("[data-pillar-remove]");
    if (pillarRemove) {
      syncPillarsDraftFromDom();
      S.pillarsDraft.splice(Number(pillarRemove.dataset.pillarRemove), 1);
      repaintPillars();
      return;
    }
    if (e.target.closest("#pillar-ai-suggest")) {
      S.pillarAiOpen = true;
      repaintPillars();
      $("#f-pillar-keywords")?.focus();
      return;
    }
    if (e.target.closest("#pillar-ai-fetch")) return suggestPillarsUi();
    const pillarAccept = e.target.closest("[data-pillar-accept]");
    if (pillarAccept) {
      const i = Number(pillarAccept.dataset.pillarAccept);
      const suggestion = S.pillarSuggestions[i];
      if (!suggestion) return;
      syncPillarsDraftFromDom();
      if (S.pillarsDraft.length < 6) S.pillarsDraft.push({ title: suggestion.title, description: suggestion.description, weight: 1 });
      S.pillarSuggestions.splice(i, 1);
      repaintPillars();
      return;
    }
    const pillarDiscard = e.target.closest("[data-pillar-discard]");
    if (pillarDiscard) {
      const i = Number(pillarDiscard.dataset.pillarDiscard);
      S.pillarSuggestions.splice(i, 1);
      repaintPillars();
      return;
    }
    if (e.target.closest("[data-ai-accept]")) {
      const box = $("#ai-suggestion");
      $("#f-about").value = box.dataset.suggestion;
      box.hidden = true;
      box.innerHTML = "";
      updateFirstPostPreview(); // gesetzter Wert loest kein input-Ereignis aus
      return;
    }
    if (e.target.closest("[data-ai-discard]")) {
      const box = $("#ai-suggestion");
      box.hidden = true;
      box.innerHTML = "";
      return;
    }

    const approveBtn = e.target.closest("[data-approve]");
    const rejectBtn = e.target.closest("[data-reject]");
    if (approveBtn || rejectBtn) {
      const btn = approveBtn || rejectBtn;
      const id = btn.dataset.approve || btn.dataset.reject;
      const action = approveBtn ? "approve" : "reject";
      const card = btn.closest(".approval-card");
      // Rückgängig statt Nachfrage: die Karte verschwindet sofort, der Server erfährt erst nach
      // Ablauf des Undo-Fensters davon. WICHTIG: /api/approvals/:id/approve loest serverseitig
      // sofort einen Routine-Lauf aus (routine-trigger.ts) - wuerde hier direkt gesendet, waere
      // "Rückgängig" gelogen, weil die Veroeffentlichung schon angestossen ist.
      const placeholder = document.createComment("undo");
      withUndo({
        message: action === "approve" ? "Freigegeben." : "Abgelehnt.",
        apply: () => {
          if (action === "approve") {
            const node = card?.querySelector(".pipe-node");
            if (node) { node.dataset.state = "published"; node.classList.add("filling"); }
            if (navigator.vibrate) navigator.vibrate(12); // kurzes Feedback, nur Android
          }
          card?.replaceWith(placeholder);
          S.approvalCount = Math.max(0, (S.approvalCount || 0) - 1);
          renderChrome();
          const box = $("#approvals-list");
          if (box && !box.querySelector(".approval-card")) loadApprovalsEmptyState(box);
        },
        revert: () => {
          if (placeholder.isConnected && card) placeholder.replaceWith(card);
          S.approvalCount = (S.approvalCount || 0) + 1;
          renderChrome();
        },
        commit: async () => {
          await api("POST", `/api/approvals/${id}/${action}`);
          placeholder.remove();
        },
      });
      return;
    }

    const commentApproveBtn = e.target.closest("[data-comment-approve]");
    const commentRejectBtn = e.target.closest("[data-comment-reject]");
    if (commentApproveBtn || commentRejectBtn) {
      const btn = commentApproveBtn || commentRejectBtn;
      const id = btn.dataset.commentApprove || btn.dataset.commentReject;
      const action = commentApproveBtn ? "approve" : "reject";
      if (action === "reject" && !(await showConfirm({ title: "Antwort ablehnen?", message: "Sie wird dann nicht an Instagram gesendet.", confirmLabel: "Ablehnen" }))) return;
      const card = btn.closest(".approval-card");
      const body = action === "approve" ? { reply: card?.querySelector(".comment-reply-text")?.value ?? "" } : undefined;
      btn.classList.add("busy");
      try {
        await api("POST", `/api/comment-approvals/${id}/${action}`, body);
        card?.remove();
        const box = $("#dash-comment-approvals");
        if (box && !box.querySelector(".approval-card")) box.innerHTML = `<p class="empty">Aktuell nichts, das auf Ihre Freigabe wartet.</p>`;
        refreshPendingCommentBadge();
      } catch (err) {
        showError(err.message || "Aktion fehlgeschlagen.");
        btn.classList.remove("busy");
      }
      return;
    }
    if (e.target.closest("#post-now-btn")) {
      const btn = e.target.closest("#post-now-btn");
      const topic = $("#f-postNowTopic")?.value || "";
      const channels = [...document.querySelectorAll('input[name="postNowChannel"]:checked:not(:disabled)')].map((el) => el.value);
      if (!channels.length) {
        showError("Bitte wählen Sie mindestens einen Kanal aus.");
        return;
      }
      const format = document.querySelector('input[name="postNowFormat"]:checked')?.value || "single";
      btn.classList.add("busy");
      try {
        applyState(await api("POST", "/api/post-now", { topic, channels, format }));
        S.banner = { kind: "ok", text: "Angefragt - wir kümmern uns beim nächsten Lauf darum." };
        render(true);
      } catch (err) {
        showError(err.message || "Anfrage fehlgeschlagen.");
        btn.classList.remove("busy");
      }
      return;
    }
    if (e.target.closest("#recover-submit")) {
      const btn = e.target.closest("#recover-submit");
      const email = $("#f-recover-email")?.value.trim() || "";
      const status = $("#recover-status");
      if (!email) {
        if (status) { status.textContent = "Bitte geben Sie Ihre E-Mail-Adresse ein."; status.style.color = "var(--stop)"; }
        return;
      }
      btn.classList.add("busy");
      try {
        await api("POST", "/api/recover-access", { email });
        if (status) { status.textContent = "Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde eine E-Mail mit einem neuen Zugangslink verschickt."; status.style.color = ""; }
      } catch (err) {
        if (status) { status.textContent = err.message || "Anfrage fehlgeschlagen."; status.style.color = "var(--stop)"; }
      } finally {
        btn.classList.remove("busy");
      }
      return;
    }
    if (e.target.closest("#resend-verify")) {
      const btn = e.target.closest("#resend-verify");
      const status = $("#resend-verify-status");
      btn.disabled = true;
      try {
        await api("POST", "/api/resend-verification");
        if (status) status.textContent = " Erneut verschickt.";
      } catch (err) {
        if (status) status.textContent = ` ${err.message || "Konnte nicht verschickt werden."}`;
      } finally {
        setTimeout(() => { btn.disabled = false; }, 3000);
      }
      return;
    }
    if (e.target.closest("#toggle-pause")) {
      const btn = e.target.closest("#toggle-pause");
      const nextPaused = !S.customer.customerPaused;
      if (nextPaused && !(await showConfirm({ title: "Posting pausieren?", message: "Es werden dann keine neuen Beiträge mehr veröffentlicht, bis Sie es wieder fortsetzen.", confirmLabel: "Pausieren" }))) return;
      btn.disabled = true;
      try {
        applyState(await api("POST", "/api/pause", { paused: nextPaused }));
        render();
      } catch (err) {
        showError(err.message || "Konnte nicht geändert werden.");
        btn.disabled = false;
      }
      return;
    }
    if (e.target.closest("#delete-account")) {
      const btn = e.target.closest("#delete-account");
      const company = S.customer?.company || "Ihr Konto";
      const ok = await showConfirm({
        title: "Konto endgültig löschen?",
        message: `"${company}" inkl. aller verbundenen Kanäle und des Beitrags-Verlaufs wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.`,
        confirmLabel: "Endgültig löschen",
        danger: true,
        typeToConfirm: company,
        typeToConfirmLabel: `Zur Bestätigung "${company}" eingeben:`,
      });
      if (!ok) return;
      btn.disabled = true;
      try {
        if (DEMO) {
          MOCK.customer = null; MOCK.connections = [];
        } else {
          await api("DELETE", "/api/me", { confirm: true });
        }
        S.customer = null; S.connections = []; S.formPart = 1;
        go("company");
        S.banner = { kind: "ok", text: "Konto und alle Daten wurden gelöscht." };
        render(true);
      } catch (err) {
        showError(err.message || "Löschen fehlgeschlagen.");
        btn.disabled = false;
      }
      return;
    }

    // --- Panel v11: Einstellungs-Sprungliste, Funktionsuebersicht, Rundgang ---
    const jump = e.target.closest("[data-setjump]");
    if (jump) { jumpToSettingsGroup(jump.dataset.setjump); return; }

    const guideGo = e.target.closest("[data-guide-go]");
    if (guideGo) { go(guideGo.dataset.guideGo); return; }

    if (e.target.closest("#restart-tour")) { S.tourIndex = 0; renderTour(); return; }
    if (e.target.closest("#tour-skip")) { await endTour(); return; }
    if (e.target.closest("#tour-next")) {
      if (S.tourIndex >= TOUR.length - 1) await endTour();
      else { S.tourIndex++; renderTour(); }
      return;
    }

    const t = e.target.closest("[data-go],[data-connect],[data-disconnect],#mklink,#logout,[data-copy]");
    if (!t) return;

    if (t.dataset.connect) {
      if (DEMO) { e.preventDefault(); return demoConnect(t.dataset.connect); }
      t.classList.add("busy"); return; // echter Link zur Plattform
    }
    if (t.dataset.skip) {
      S.skipped.add(t.dataset.skip);
      // Serverseitig persistieren, damit ein Reload/Tab-Wechsel vor dem naechsten Schritt nicht
      // wieder hierher zurueckspringt (firstOpenStep()) - nie blockierend fuer die Navigation.
      if (!DEMO) api("POST", `/api/skip-provider/${t.dataset.skip}`).catch(() => {});
    }
    if (t.dataset.go) {
      // Navigationsziele sind jetzt echte <a href="#...">-Links (Deep-Links, Zurück-Geste,
      // "in neuem Tab oeffnen") - der Klick wird hier abgefangen, damit kein Doppel-Rendern
      // durch das zusaetzliche hashchange-Ereignis entsteht.
      if (t.tagName === "A") e.preventDefault();
      toggleAcctMenu(false);
      closeSheet();
      return go(t.dataset.go, t.dataset.sub || t.dataset.tab || "");
    }

    if (t.dataset.disconnect) {
      const p = prov(t.dataset.disconnect);
      if (!(await showConfirm({ title: `${p.name} trennen?`, message: "Danach veröffentlichen wir dort nichts mehr.", confirmLabel: "Trennen", danger: true }))) return;
      t.disabled = true;
      try {
        applyState(await api("POST", `/api/disconnect/${p.id}`));
        S.banner = { kind: "", text: `${p.name} getrennt.` };
        return render();
      } catch (err) {
        showError(err.message || "Trennen fehlgeschlagen.");
        t.disabled = false;
      }
      return;
    }
    if (t.id === "mklink") {
      t.classList.add("busy");
      try {
        const { link } = await api("POST", "/api/access-link");
        $("#linkbox").innerHTML = `<label class="vh" for="acc">Ihr persönlicher Link</label>
          <div class="copyrow"><input id="acc" type="text" readonly value="${esc(link)}"><button class="btn" data-copy>Kopieren</button></div>`;
      } catch { t.classList.remove("busy"); }
      return;
    }
    if (t.dataset.copy !== undefined) {
      const input = $("#acc"); input.select();
      try { await navigator.clipboard.writeText(input.value); } catch { document.execCommand("copy"); }
      t.textContent = "Kopiert";
      return;
    }
    if (t.id === "logout") {
      await api("POST", "/api/logout");
      S.customer = null; S.connections = []; S.skipped.clear();
      return go("company");
    }
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "company") return;
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    const edit = !!S.customer;
    // FormData omits unchecked boxes entirely (rather than sending false), so read these
    // direkt von den Elementen. Panel v11: ueber querySelector statt ueber den Namens-Zugriff
    // (form.igFeedEnabled) - der lieferte bei nachtraeglich eingefuegtem Markup undefined, was
    // still ein "false" gespeichert haette, und ein Feldname wie "action"/"method" wuerde dort
    // ohnehin die Form-Eigenschaft treffen statt das Feld.
    const checked = (name) => Boolean(form.querySelector(`[name="${name}"]`)?.checked);
    if (!edit) body.consent = checked("consent");
    body.igFeedEnabled = checked("igFeedEnabled");
    body.igStoryEnabled = checked("igStoryEnabled");
    body.linkedinEnabled = checked("linkedinEnabled");
    body.emojisEnabled = checked("emojisEnabled");
    body.approvalMode = checked("approvalMode");
    body.notifyOnPublish = checked("notifyOnPublish");
    body.notifyWeeklyReport = checked("notifyWeeklyReport");
    body.commentAutomationEnabled = checked("commentAutomationEnabled");
    body.gradientEnabled = checked("gradientEnabled");
    // Aus v21/v22 - ohne diese Zeilen kaeme das Feld nie im PATCH an und der Server setzte es zurueck.
    body.googleReviewAutomationEnabled = checked("googleReviewAutomationEnabled");
    body.googleReviewPostsEnabled = checked("googleReviewPostsEnabled");
    body.videoEnabled = checked("videoEnabled");
    body.videoVoiceEnabled = checked("videoVoiceEnabled");
    syncPillarsDraftFromDom();
    body.contentPillars = S.pillarsDraft.filter((p) => p.title.trim());
    const igDays = Array.from(form.querySelectorAll('[data-weekday-channel="instagram"] input:checked')).map((el) => Number(el.value));
    const liDays = Array.from(form.querySelectorAll('[data-weekday-channel="linkedin"] input:checked')).map((el) => Number(el.value));
    body.instagramWeekdays = igDays.join(",");
    body.linkedinWeekdays = liDays.join(",");
    body.videoWeekdays = Array.from(form.querySelectorAll('[data-weekday-channel="video"] input:checked')).map((el) => Number(el.value)).join(",");
    body.activeWeekdays = body.instagramWeekdays;
    body.frequency = classifyFrequency(igDays.length ? igDays : [1, 2, 3, 4, 5]);

    form.querySelectorAll(".err").forEach((n) => n.remove());
    form.querySelectorAll("[aria-invalid]").forEach((n) => n.removeAttribute("aria-invalid"));

    const errors = {};
    if (!body.company?.trim()) errors.company = "Bitte geben Sie Ihren Firmennamen ein.";
    if (!body.contactName?.trim()) errors.contactName = "Bitte geben Sie Ihren Namen ein.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email || "")) errors.email = "Bitte geben Sie eine gültige E-Mail-Adresse ein.";
    if (!edit && !body.consent) errors.consent = "Ohne Ihre Zustimmung können wir nicht für Sie posten.";
    if (Object.keys(errors).length) {
      // Required fields on page 1 are exempt from HTML5 validation while hidden behind page 2 -
      // jump back so the error is actually visible instead of failing silently.
      const part1Fields = ["company", "contactName", "email"];
      if (!edit && S.formPart !== 1 && Object.keys(errors).some((k) => part1Fields.includes(k))) {
        switchFormPart(1);
      }
      return showFieldErrors(form, errors);
    }

    // Panel v11: Auf Seite 1 des Signup-Formulars gibt es keinen Absenden-Knopf (nur "Weiter") -
    // wer dort die Eingabetaste drueckt, loest trotzdem submit aus und lief bisher in einen
    // Absturz (btn war null). Der Ablauf selbst bleibt gleich, nur ohne "busy"-Anzeige.
    const btn = form.querySelector("button[type=submit]");
    btn?.classList.add("busy");
    try {
      const saveRes = await api(edit ? "PATCH" : "POST", edit ? "/api/me" : "/api/signup", body);
      applyState(saveRes);
      // Panel v11: Aus den Einstellungen heraus bleibt man nach dem Speichern in den Einstellungen
      // (und in derselben Gruppe) - vorher sprang das Formular zurueck aufs Dashboard, was genau
      // das "wo bin ich jetzt?"-Gefuehl erzeugt hat, um das es in dieser Runde geht.
      S.step = edit ? (S.step === "settings" ? "settings" : landingStep()) : S.providers[0]?.id || "done";
      S.banner = edit ? { kind: "ok", text: "Angaben gespeichert." } : null;
      render(true);
      // Panel v18: Firmenname/Branche/Beschreibung/Tonalität geändert - bietet an, die noch nicht
      // veröffentlichte 7-Tage-Vorschau mit den neuen Angaben neu zu schreiben (siehe
      // offerBrandingRegen). Bewusst NACH dem render(true) oben, nie blockierend fürs Speichern
      // selbst - ein "Nein" hier darf die gespeicherten Einstellungen nicht in Frage stellen.
      if (edit && saveRes.brandingRegenOffer) offerBrandingRegen(saveRes.brandingRegenOffer);
    } catch (err) {
      btn?.classList.remove("busy");
      if (err.fields) return showFieldErrors(form, err.fields);
      S.banner = { kind: "bad", text: err.message };
      render(true);
      // Bugfix (Security/UX-Review 2026-09-13): render(true) just rebuilt the whole form,
      // including a brand-new empty #turnstile-widget div (see renderTurnstileIfNeeded's
      // comment) - without this, a rejected signup (Turnstile failure, banned word, rate limit,
      // anything) permanently lost the CAPTCHA widget and could never be retried without a full
      // manual page reload. No-op when not on the signup form's page 2 (no container to fill).
      if (!edit) renderTurnstileIfNeeded();
    }
  });

  function showFieldErrors(form, errors) {
    let first;
    for (const [name, msg] of Object.entries(errors)) {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) continue;
      input.setAttribute("aria-invalid", "true");
      const p = document.createElement("p");
      p.className = "err"; p.id = `err-${name}`; p.textContent = msg;
      input.setAttribute("aria-describedby", p.id);
      (name === "consent" ? input.closest(".check") : input).insertAdjacentElement("afterend", p);
      first = first || input;
    }
    first?.focus();
  }

  /* ================= Start ================= */
  /** Panel v15: @font-face fuer alle acht Marken-Schriften, einmalig injiziert (CONFIG.mount
   *  erst zur Laufzeit bekannt, deshalb hier statt im statischen <style> oben) - dieselben
   *  Dateien, die die Bild-Rendering-Pipeline serverseitig nutzt (fonts.ts), ueber die neue
   *  /fonts-Route ausgeliefert. font-display:swap, damit ein langsamer Font-Ladevorgang nie
   *  Text unsichtbar macht (nur kurz die System-Schrift zeigt, bis der echte Font da ist). */
  function injectFontFaces() {
    const style = document.createElement("style");
    style.textContent = FONT_OPTIONS.map((f) => `
      @font-face { font-family: "${f.cssFamily}"; src: url("${CONFIG.mount}/fonts/${f.file}") format("truetype"); font-weight: 100 900; font-display: swap; }
    `).join("");
    document.head.appendChild(style);
  }

  async function init() {
    injectFontFaces();
    // #help-chat-input ist statisches HTML (existiert schon vor diesem Script), nicht Teil des
    // render()-Kreislaufs - einmalig durch dieselbe withDictate()-Umhuellung ersetzen wie jedes
    // andere Feld, statt die Button-/Icon-Auszeichnung hier separat zu duplizieren.
    const helpChatInput = $("#help-chat-input");
    if (helpChatInput) helpChatInput.outerHTML = withDictate(helpChatInput.outerHTML);
    if (DEMO) $("#demo").hidden = false;
    try {
      const p = await api("GET", "/api/providers");
      S.providers = p.providers;
      S.aiAvailable = Boolean(p.aiAvailable);
      S.videoVoices = p.videoVoices || [];
      S.voicePreviewAvailable = Boolean(p.voicePreviewAvailable);
      S.videoLengths = p.videoLengths || [5, 10, 15];
      S.trialDays = Number(p.trialDays) || 7;
      S.turnstileSiteKey = p.turnstileSiteKey || null;
      S.sandbox = Boolean(p.sandbox);
      if (S.sandbox) $("#sandbox-banner").hidden = false;
      updateHelpChatVisibility();
    } catch {
      $("#stage").innerHTML = `<div class="banner bad" role="alert">Das Panel ist gerade nicht erreichbar. Bitte laden Sie die Seite in ein paar Minuten neu.</div>`;
      return;
    }
    try { applyState(await api("GET", "/api/me")); } catch { /* noch nicht angemeldet */ }

    const q = new URLSearchParams(location.search);
    const pName = prov(q.get("provider"))?.name || "";
    if (q.get("connected") && prov(q.get("connected"))) {
      const id = q.get("connected");
      const list = steps();
      S.step = list[list.indexOf(id) + 1];
      S.banner = { kind: "ok", text: `${prov(id).name} ist verbunden.` };
    } else if (q.get("verified")) {
      S.banner = { kind: "ok", text: "E-Mail-Adresse bestätigt - danke! Beiträge werden ab jetzt vorbereitet." };
      S.step = landingStep();
    } else if (q.get("error")) {
      const fn = ERRORS[q.get("error")] || ERRORS.failed;
      S.banner = { kind: "bad", text: fn(pName) };
      S.step = S.customer && prov(q.get("provider")) ? q.get("provider") : firstOpenStep();
    } else {
      // Panel v6 Aufgabe 3: wiederkehrender Kunde (mind. 1 Kanal je verbunden) landet direkt auf
      // dem neuen Dashboard statt wieder bei "Unternehmen"/der Schritt-Kette.
      S.step = landingStep();
    }
    if (q.has("connected") || q.has("error") || q.has("verified")) history.replaceState(null, "", location.pathname);

    // Deep-Link aus der URL hat Vorrang vor dem Standard-Landepunkt - so springt ein Link aus
    // einer Freigabe-E-Mail direkt auf den richtigen Reiter, und ein Reload bleibt, wo man war.
    if (isEstablished()) routeFromHash();

    render(false);
    refreshPendingCommentBadge();

    // Zurück-Geste am Handy / Browser-Zurück: Ansicht aus der URL wiederherstellen.
    window.addEventListener("hashchange", () => {
      if (!isEstablished()) return;
      const key = () => `${S.step}/${S.postTab}/${S.analyticsChannel}/${S.settingsGroup}`;
      const before = key();
      if (!routeFromHash()) return;
      if (key() !== before) render(true);
    });

    // Sichtbare Daten aktualisieren, wenn der Tab wieder in den Vordergrund kommt - nie waehrend
    // getippt wird (sonst wuerde eine Eingabe ueberschrieben).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !isEstablished()) return;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (S.step === "dashboard") loadDashboardExtras();
      else if (S.step === "posts") loadPostsTab();
    });
  }

  /** Panel v11: Zahl neben "Übersicht" in der Navigation, damit wartende Kommentar-Antworten auch
   *  von anderen Ansichten aus sichtbar sind. Nur ein Aufruf beim Laden bzw. nach einer Aktion -
   *  bewusst kein Polling. Schlaegt der Aufruf fehl, bleibt die Leiste einfach ohne Zahl. */
  async function refreshPendingCommentBadge() {
    const c = S.customer;
    if (DEMO || !c || !c.commentAutomationEnabled || c.commentAutomationMode === "auto") { S.pendingCommentCount = 0; return; }
    try {
      const { approvals } = await api("GET", "/api/comment-approvals");
      S.pendingCommentCount = approvals.length;
      renderMainNav();
    } catch { /* Zahl ist nur ein Hinweis, kein kritischer Zustand */ }
  }

  /* ================= Vorschau-Modus (ohne Server) ================= */
  const MOCK = { customer: null, connections: [], posts: [
    { id: "p1", provider: "instagram", headline: "Automate With Confidence", caption: "Weniger Klicks, mehr Zeit für das Wesentliche.", imageUrl: "", postedAt: new Date(Date.now() - 86400000).toISOString() },
  ] };
  const DEMO_PROVIDERS = [
    { id: "instagram", name: "Instagram", available: true, notice: null,
      tagline: "Ihre Beiträge erscheinen automatisch in Ihrem Instagram-Feed.",
      guide: [
        { title: "Professionelles Konto einrichten", text: "Automatisches Posten funktioniert nur mit einem Business- oder Creator-Konto. Das Umstellen ist kostenlos und dauert rund zwei Minuten. Haben Sie schon eines, können Sie diesen Punkt überspringen.", link: { label: "Anleitung von Instagram öffnen", url: "https://help.instagram.com/502981923235522" } },
        { title: "Zugangsdaten bereithalten", text: "Sie melden sich gleich direkt bei Instagram an. Ihr Passwort geben Sie nur dort ein, nie bei uns.", link: { label: "Passwort vergessen?", url: "https://www.instagram.com/accounts/password/reset/" } },
        { title: "Verbinden und Freigabe bestätigen", text: "Instagram zeigt Ihnen, welche Rechte Pipeflow bekommt: Profil lesen und Beiträge veröffentlichen. Bestätigen Sie, danach landen Sie automatisch wieder hier." },
      ] },
    { id: "linkedin", name: "LinkedIn", available: true,
      tagline: "Ihre Beiträge erscheinen automatisch auf Ihrem LinkedIn-Profil.",
      notice: "Gepostet wird auf Ihrem persönlichen Profil, nicht auf einer Unternehmensseite.",
      guide: [
        { title: "Mit dem richtigen Profil eingeloggt sein", text: "Die Beiträge erscheinen auf dem Profil, mit dem Sie sich gleich anmelden. Prüfen Sie kurz, ob im Browser das richtige Profil offen ist.", link: { label: "LinkedIn öffnen", url: "https://www.linkedin.com/feed/" } },
        { title: "Verbinden und Freigabe bestätigen", text: "LinkedIn fragt, ob Pipeflow in Ihrem Namen Beiträge teilen darf. Bestätigen Sie, danach landen Sie automatisch wieder hier." },
        { title: "Alle 60 Tage kurz erneuern", text: "LinkedIn begrenzt die Freigabe auf 60 Tage. Das Panel zeigt Ihnen rechtzeitig an, wann Sie mit einem Klick neu verbinden sollten." },
      ] },
  ];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mockState = () => ({ customer: MOCK.customer, connections: MOCK.connections });

  async function mockApi(method, url, body) {
    await sleep(250);
    if (url === "/api/providers") return { providers: DEMO_PROVIDERS, aiAvailable: true, trialDays: 7 };
    if (url === "/api/improve-briefing") {
      const company = body?.company || "Ihr Unternehmen";
      const industry = body?.industry ? ` in der Branche ${body.industry}` : "";
      return {
        suggestion: `${company}${industry} richtet sich an lokale Kundinnen und Kunden, die auf der Suche nach einem verlässlichen Ansprechpartner sind. Im Mittelpunkt der Beiträge stehen konkrete Tipps aus dem Alltag, Einblicke hinter die Kulissen und die Themen, die die Zielgruppe wirklich bewegen. Ziel ist es, Vertrauen aufzubauen und neue Anfragen zu gewinnen. (Vorschau-Beispiel)`,
      };
    }
    if (url === "/api/suggest-topics") {
      return { topics: ["Ein Kundenerfolg aus der letzten Woche", "Ein häufiges Missverständnis in Ihrer Branche aufklären", "Ein kurzer Tipp, den Sie sonst nur persönlich weitergeben"] };
    }
    if (url === "/api/suggest-pillars") {
      return {
        pillars: [
          { title: "Tipps & Tricks", description: "Kurze, direkt umsetzbare Ratschläge rund um Ihr Angebot. (Vorschau-Beispiel)" },
          { title: "Hinter den Kulissen", description: "Einblicke in Ihren Arbeitsalltag, die Vertrauen schaffen. (Vorschau-Beispiel)" },
          { title: "Kundenstimmen", description: "Erfahrungen und Erfolge Ihrer Kundinnen und Kunden. (Vorschau-Beispiel)" },
        ],
      };
    }
    if (url === "/api/planned-posts" && method === "GET") {
      if (!MOCK.plannedPosts) {
        const today = localDateStr(new Date());
        const tomorrow = localDateStr(new Date(Date.now() + 86400000));
        const createdAt = new Date(Date.now() - 6 * 3600000).toISOString();
        MOCK.plannedPosts = [
          { id: "plan1", channel: "ig_feed", scheduledFor: today, status: "planned", headline: "Mobilität neu entdecken", caption: "Ein Beispieltext für die Vorschau. (Vorschau-Beispiel)", imageUrl: "", pillarTitle: null, accentColorUsed: null, regenerateCount: 0, createdAt },
          { id: "plan2", channel: "ig_story", scheduledFor: today, status: "planned", headline: "Tipp des Tages", caption: "", imageUrl: "", pillarTitle: null, accentColorUsed: null, regenerateCount: 0, createdAt },
          { id: "plan3", channel: "linkedin", scheduledFor: tomorrow, status: "planned", headline: "Ein Blick hinter die Kulissen", caption: "Ein Beispieltext für die Vorschau. (Vorschau-Beispiel)", imageUrl: "", pillarTitle: null, accentColorUsed: null, regenerateCount: 1, createdAt },
        ];
      }
      return { posts: MOCK.plannedPosts, maxRegenerate: 3 };
    }
    if (/^\/api\/planned-posts\/[^/]+$/.test(url) && method === "PATCH") {
      const id = url.split("/").pop();
      const p = (MOCK.plannedPosts || []).find((x) => x.id === id);
      if (!p) throw Object.assign(new Error("Beitrag nicht gefunden."), { status: 404 });
      if (body.headline !== undefined) p.headline = body.headline;
      if (body.caption !== undefined) p.caption = body.caption;
      if (p.status === "planned") p.status = "edited";
      return { post: p };
    }
    if (/^\/api\/planned-posts\/[^/]+\/regenerate-image$/.test(url) && method === "POST") {
      const id = url.split("/")[3];
      const p = (MOCK.plannedPosts || []).find((x) => x.id === id);
      if (!p) throw Object.assign(new Error("Beitrag nicht gefunden."), { status: 404 });
      if (p.regenerateCount >= 3) throw Object.assign(new Error("Maximale Anzahl an Neuerstellungen erreicht."), { status: 429 });
      p.regenerateCount++;
      p.accentColorUsed = body?.accentColor || p.accentColorUsed;
      return { post: p, maxRegenerate: 3 };
    }
    if (/^\/api\/planned-posts\/[^/]+\/skip$/.test(url) && method === "POST") {
      const id = url.split("/")[3];
      const p = (MOCK.plannedPosts || []).find((x) => x.id === id);
      if (!p) throw Object.assign(new Error("Beitrag nicht gefunden."), { status: 404 });
      p.status = "rejected";
      return { post: p };
    }
    if (/^\/api\/planned-posts\/[^/]+\/approve$/.test(url) && method === "POST") {
      const id = url.split("/")[3];
      const p = (MOCK.plannedPosts || []).find((x) => x.id === id);
      if (!p) throw Object.assign(new Error("Beitrag nicht gefunden."), { status: 404 });
      p.status = "approved";
      return { post: p };
    }
    if (url === "/api/analyze-website") {
      return {
        suggestion: {
          industry: "Dienstleistung",
          about: "Ein lokales Unternehmen, das auf persönlichen Service und Qualität setzt. Die Zielgruppe sind Menschen in der Region, die einen verlässlichen Ansprechpartner suchen. (Vorschau-Beispiel, aus der Website-Adresse geraten)",
          tone: "sachlich",
          hashtags: ["lokal", "qualitaet", "service"],
        },
      };
    }
    if (url === "/api/me" && method === "GET") {
      if (!MOCK.customer) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
      return mockState();
    }
    if (url === "/api/signup" || (url === "/api/me" && method === "PATCH")) {
      const { consent, ...data } = body;
      const isSignup = url === "/api/signup";
      const demoNextPost = new Date(Date.now() + 2 * 86400000).toISOString();
      MOCK.customer = {
        trialDaysLeft: 7, trialExpired: false, nextPostAt: demoNextPost, dueNow: false, customerPaused: false, emailVerified: true,
        ...MOCK.customer,
        ...data,
        ...(isSignup ? { trialDaysLeft: 7, trialExpired: false, nextPostAt: demoNextPost, dueNow: false, customerPaused: false, emailVerified: true } : {}),
      };
      return mockState();
    }
    if (url.startsWith("/api/disconnect/")) {
      MOCK.connections = MOCK.connections.filter((c) => c.provider !== url.split("/").pop());
      return mockState();
    }
    if (url === "/api/pause") {
      MOCK.customer = { ...MOCK.customer, customerPaused: body.paused === true, dueNow: body.paused === true ? false : MOCK.customer.dueNow };
      return mockState();
    }
    if (url === "/api/approvals") return { approvals: [] };
    if (url === "/api/logo" && method === "POST") {
      MOCK.logoDataUrl = body.imageBase64;
      MOCK.customer = { ...MOCK.customer, hasLogo: true };
      return mockState();
    }
    if (url === "/api/logo" && method === "DELETE") {
      MOCK.logoDataUrl = null;
      MOCK.customer = { ...MOCK.customer, hasLogo: false };
      return mockState();
    }
    if (url === "/api/themes") {
      const theme = { id: `theme_${Date.now()}`, name: body.name, accentColor: body.accentColor || null, watermarkText: body.watermarkText || null, createdAt: new Date().toISOString() };
      MOCK.customer.savedThemes = [...(MOCK.customer.savedThemes || []), theme];
      return { ok: true, theme, savedThemes: MOCK.customer.savedThemes };
    }
    if (/^\/api\/themes\/.+\/activate$/.test(url)) {
      const id = url.split("/")[3];
      MOCK.customer = { ...MOCK.customer, activeThemeId: id };
      return mockState();
    }
    if (url === "/api/themes/deactivate") {
      MOCK.customer = { ...MOCK.customer, activeThemeId: null };
      return mockState();
    }
    if (/^\/api\/approvals\/.+\/(approve|reject)$/.test(url)) return { ok: true };
    if (url === "/api/post-now") {
      const now = new Date().toISOString();
      const newRequests = (body.channels || []).map((channel, i) => ({ id: `preq_demo_${i}`, topic: body.topic || "", channel, status: "pending", createdAt: now }));
      MOCK.customer = { ...MOCK.customer, postRequests: [...newRequests, ...(MOCK.customer.postRequests || [])] };
      return mockState();
    }
    if (url === "/api/me" && method === "DELETE") {
      MOCK.customer = null; MOCK.connections = [];
      return { ok: true };
    }
    if (url === "/api/access-link") return { link: "https://mcp.pipebot.at/panel/login?key=vorschau-beispiel" };
    if (url === "/api/recover-access") return { ok: true, message: "Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde eine E-Mail mit einem neuen Zugangslink verschickt. (Vorschau-Beispiel)" };
    if (url === "/api/help-chat") return { reply: "Das ist eine Vorschau ohne echte KI-Antwort - im echten Panel beantwortet der Hilfe-Chat hier Ihre Frage zum Ablauf, zu Instagram/LinkedIn oder zum Freigabe-Modus. (Vorschau-Beispiel)" };
    if (url === "/api/posts") return { posts: MOCK.posts };
    if (url === "/api/analytics") return { hasData: false };
    if (url === "/api/logout") { MOCK.customer = null; MOCK.connections = []; return { ok: true }; }
    throw new Error("Unbekannt");
  }

  async function demoConnect(id) {
    const p = prov(id);
    const ov = document.createElement("div");
    ov.className = "overlay"; ov.setAttribute("role", "status");
    ov.textContent = `Weiterleitung zu ${p.name} …`;
    document.body.append(ov);
    await sleep(1100);
    ov.remove();
    const now = new Date();
    MOCK.connections = MOCK.connections.filter((c) => c.provider !== id).concat({
      provider: id,
      accountName: id === "instagram" ? "@" + (MOCK.customer.company || "ihrfirma").toLowerCase().replace(/[^a-z0-9]/g, "") : MOCK.customer.contactName,
      connectedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 86400000).toISOString(),
      status: "ok",
    });
    S.connections = MOCK.connections;
    const list = steps();
    S.step = list[list.indexOf(id) + 1];
    S.banner = { kind: "ok", text: `${p.name} ist verbunden.` };
    render(true);
  }

  init();
})();
