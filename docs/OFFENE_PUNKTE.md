# Offene Punkte – Stand 2026-09-13

Konsolidiert aus allen Panel-/Routine-/Security-Berichten, Code-Kommentaren und
`.env`-Ist-Zustand. **Keine neuen Aufgaben erfunden** – nur Zusammentragen, was bereits
als offen, vorgemerkt oder „Paul muss noch …“ dokumentiert war.

**Methodik:** Sources: `docs/PANEL_V3`–`V6_REPORT.md`, `docs/ROUTINE_TEIL1*.md`,
`docs/ROUTINE_TEIL_A.md`, `docs/SANDBOX.md`, `docs/SECURITY_UX_REVIEW_REPORT.md`,
`docs/TURNSTILE_SETUP.md`, `docs/META_APP_REVIEW.md`, `docs/DATENSCHUTZ_ENTWURF.md`,
`styleguide.md`, Code-TODOs/`FIXME`-nahe Kommentare, aktueller `.env`-Check (nur
gesetzt/leer, keine Werte).

**Bereits erledigt (hier bewusst nicht als offen geführt):** E-Mail-Bestätigung vor
Generierung (v6/2b), dauerhafte Sandbox, K3b/`submit_planned_post_for_approval` (v7),
serverseitiger Duplikat-Schutz für Freigabe-Entwürfe, LinkedIn-Bild-Pflicht serverseitig,
HSTS + Logo-Upload-Rate-Limit, Turnstile-Code inkl. Soft-Lock-/Fallback-Fixes (Sandbox),
`ROUTINE_TRIGGER_URL`/`ROUTINE_TRIGGER_TOKEN` in Produktion gesetzt (Teil A).

---

## 1. BLOCKIERT echte Kunden (vor dem nächsten Pilotkunden)

### 1.1 Cloudflare Turnstile – echte Keys fehlen
**Was fehlt:** `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` sind in der Produktions-`.env`
leer; Signup läuft ohne CAPTCHA (nur IP-Rate-Limit 5/h). Anleitung: `docs/TURNSTILE_SETUP.md`.
**Warum wichtig:** Ohne Mensch-Nachweis bleiben vollautomatisierte Massen-Signups möglich.
E-Mail-Bestätigung deckt die KI-Kostenlücke ab, nicht Bot-Anmeldungen selbst.
Quellen: PANEL_V6, SECURITY_UX_REVIEW, TURNSTILE_SETUP; `.env`-Check 2026-09-13.

### 1.2 Datenschutzerklärung – Entwurf, Link tot, TODO im Panel
**Was fehlt:** `docs/DATENSCHUTZ_ENTWURF.md` ist ausdrücklich nicht freigegeben/nicht
veröffentlichen; Panel verlinkt `https://pipebot.at/datenschutz` (`CONFIG.privacyUrl` mit
TODO) – URL liefert aktuell **HTTP 404**. Rechtliche Prüfung, Platzhalter, echte
Veröffentlichung und korrekter Link fehlen.
**Warum wichtig:** Beim Signup stimmen Kunden der Datenverarbeitung zu und klicken auf
eine kaputte Datenschutz-URL. Für fremde Kunden (DSGVO) und Meta App Review Voraussetzung.
Quellen: DATENSCHUTZ_ENTWURF, META_APP_REVIEW, `public/panel/index.html`, Live-Check 404.

### 1.3 Meta App Review / Instagram für Nicht-Tester
**Was fehlt:** Checkliste in `docs/META_APP_REVIEW.md` ist unerledigt (u. a. Datenschutz-URL,
App-Icon 1024×1024, Unternehmensverifizierung, Screencast, Nutzungsbedingungen, Einreichen).
Nichts bei Meta eingereicht.
**Warum wichtig:** Solange die Meta-App im Development Mode bleibt, können fremde Kunden
Instagram typischerweise nur verbinden, wenn sie als Tester freigeschaltet sind – kein
skalierbarer Pilot ohne Review (oder manuelles Tester-Whitelisting pro Kunde).
Quelle: META_APP_REVIEW, README (Development-Mode-Hinweis).

### 1.4 Echter E-Mail-Versand an Kunden nicht bestätigt
**Was fehlt:** Kunden-Mails (Bestätigung, Zugang verloren, Benachrichtigungen) wurden in den
Bau-Sitzungen bewusst nicht live verschickt (`PANEL_MAIL_DRY_RUN` / Regel). Paul sollte im
Admin einmal **„Test-E-Mail senden“** an die eigene Adresse prüfen.
**Warum wichtig:** Ohne funktionierende Zustellung bleibt E-Mail-Bestätigung wirkungslos –
neue Kunden können Generierung/Routine nie freischalten.
Quelle: PANEL_V6 Abschlussbericht.

### 1.5 Gesamtes Panel nie in echtem Browser/Handy durchgeklickt
**Was fehlt:** Über v3–v6 und den Security/UX-Review hinweg fehlte ein Display/Browser-Tool.
Onboarding, Dashboard, Vorschau, Freigabe, Wochentage, Themen, Logo-Upload-Dialog,
Hilfe-Chat, Mobile – nur API/`jsdom`/Syntax, keine echte visuelle Session.
**Warum wichtig:** Höchstes wiederkehrendes Restrisiko in allen Abschlussberichten; Layout-
und Klickfehler würden erst der Pilotkunde sehen.
Quellen: PANEL_V3–V6, PANEL_V5 Vorschau-Risiken, SECURITY_UX_REVIEW Aufgabe 3.

### 1.6 `PANEL_ENCRYPTION_KEY` nur auf dem Server
**Was fehlt:** Key liegt nicht in den DB-Backups (bewusst). Externes Backup (z. B.
Passwort-Manager) war seit v3 als Paul-Aufgabe offen – **Status unklar, ob erledigt**
(in späteren Reports nicht als „done“ abgehakt).
**Warum wichtig:** Ohne Key sind alle Instagram-/LinkedIn-Tokens in einem DB-Restore unlesbar
→ Totalausfall der Kundenverbindungen nach Disaster Recovery.
Quellen: PANEL_V3 Aufgabe 10, PANEL_V4 „weiterhin offen“.

---

## 2. Bekannte Bugs / Lücken (noch nicht behoben)

### 2.1 ig_story + Pflicht-Elemente / Hashtags
**Was fehlt:** Stories haben kein Caption-Feld. Generierung setzt Caption leer und ignoriert
`hashtagPreference` für Stories. `assertRequiredElements` / `assertNoBannedWords` prüfen bei
`ig_story` **nur die Headline** (bewusst, damit Freigabe nicht „durchrutscht“ und Publish
danach endlos scheitert). Pflicht-Hashtags als `required_elements` können in einer 2–4-Wörter-
Headline praktisch nicht sinnvoll erfüllt werden → Planung/Freigabe/Publish scheitern oder
Hashtag-Präferenz wirkt für Stories gar nicht.
**Warum wichtig:** Kunden mit Stories + Pflicht-Hashtag erleben stille Fehlschläge oder
inkonsistentes Verhalten gegenüber Feed/LinkedIn. Dokumentiert als bewusste Asymmetrie nach
einem Fix, nicht als Produktlösung.
Quellen: Code-Kommentare `src/index.ts` (`save_pending_approval`), `planning.ts`
(`checkTextsFor`), `anthropic.ts` (Story-Hashtag-Zeile), PANEL_V5 (nur Headline prüfen).

### 2.2 UX: Leere Zustände = Ladefehler, kein Retry
**Was fehlt:** Dieselbe `.empty`-Optik für „noch nichts da“ und „konnte nicht geladen
werden“; bei echten Fehlern kein „Erneut versuchen“, nur Seiten-Reload.
**Warum wichtig:** Kunden können Netz-/API-Fehler nicht von „leer“ unterscheiden.
Quelle: SECURITY_UX_REVIEW Aufgabe 3 „Vorgemerkt“.

### 2.3 UX: Keine echte visuelle / Screenreader-Prüfung
**Was fehlt:** Kontrast nur rechnerisch; kein Screenreader-Durchlauf, kein echter Blick auf
gerendertes UI.
**Warum wichtig:** Barrierefreiheit und Feinschliff bleiben ungeprüft trotz „UX-Review“.
Quelle: SECURITY_UX_REVIEW Aufgabe 3/4.

### 2.4 Instagram-Grid schneidet „Pipeline“-Wasserzeichen weg
**Was fehlt:** Headline liegt in der Grid-Sicherheitszone (18–82 %); das vertikale
Wasserzeichen (`marginRight` ~7 % vom rechten Rand) liegt außerhalb und verschwindet in der
simulierten Grid-Vorschau.
**Warum wichtig:** Nur Grid-Ansicht betroffen (Feed nach Antippen ok); Branding in der
Profilübersicht fehlt. Bewusst zurückgestellt.
Quelle: `styleguide.md` „Bekanntes, noch NICHT behobenes Folgeproblem“.

### 2.5 Routine-Prompt K3a / LinkedIn-Hinweis – Live-Stand widersprüchlich
**Was fehlt / Unsicher:** `docs/ROUTINE_TEIL1.md` behauptet, der 2026-09-13-Text (K3a +
LinkedIn-Bild) sei per RemoteTrigger live. `docs/SECURITY_UX_REVIEW_REPORT.md` (später am
selben Tag) sagt, genau diese Prompt-Änderung sei **noch nicht** live und Paul müsse
entscheiden. Serverseitige Guards (Duplikat-Schutz, LinkedIn-Bild-Pflicht) sind unabhängig
davon aktiv (auch per Prod-Log bestätigt).
**Warum wichtig:** Prompt-Absicherung vs. nur Server-Reject; bei Drift erzeugt die Routine
unnötige Fehlversuche. **Nicht raten – per `RemoteTrigger get` gegen Live-Prompt prüfen.**
Quellen: ROUTINE_TEIL1 Update 2026-09-13 vs. SECURITY Aufgabe 4 Punkt „Was Paul noch …“.

### 2.6 UI-Teile einzelner Features nie browser-getestet (Detailreste)
**Was fehlt:** Explizit genannt u. a. Weekday-Picker, „Jetzt posten“, Freigabe-UI,
Farbthemen-Chips, Vorschau-Karten mobil, Logo-`<input type="file">`-Dialog, Dashboard-Kacheln,
Hilfe-Chat mobil, Turnstile-Widget mit echten Keys.
**Warum wichtig:** Teilmenge von 1.5; hier nur als bekannte Einzelpunkte festgehalten.
Quellen: PANEL_V3–V6 Aufgaben-Warnungen.

---

## 3. Sicherheitsrelevant, aber nicht akut blockierend

### 3.1 Signup ohne CAPTCHA (solange Keys leer)
Siehe 1.1. Restschutz: Rate-Limit + E-Mail-Verifikation vor Kosten.
Quelle: PANEL_V6 / SECURITY.

### 3.2 Timing-Seitenkanal bei „Zugang verloren?“
**Was fehlt:** Antwortzeit zwischen Treffer/Nicht-Treffer nicht künstlich angeglichen.
**Warum (nicht) wichtig:** Millisekundenbereich, praktisch kaum messbar; bewusst nicht behoben,
aber dokumentiert.
Quellen: PANEL_V6 Aufgabe 5, SECURITY Punkt 11.

### 3.3 HSTS ohne `preload`
**Was fehlt:** `preload`-Direktive bewusst weggelassen (würde die ganze Domain inkl. anderer
Dienste langfristig binden).
**Warum (nicht) wichtig:** HSTS selbst ist seit dem Review live; `preload` nur nach
expliziter Entscheidung.
Quelle: SECURITY Punkt 9.

### 3.4 Secrets einmal in Sitzungs-Tool-Ausgabe sichtbar
**Was fehlt:** Kein Code-Fix nötig; bei `pm2 env` / Redaktions-Maske landeten u. a.
`PANEL_ENCRYPTION_KEY` / Admin-Passwort / MCP-Token kurz in der Tool-Historie einer Sitzung
(nicht extern versendet). Werte wurden nicht geändert.
**Warum wichtig:** Sitzungs-Logs auf dem Server sind ein zusätzlicher Secret-Träger – bei
Bedarf Rotation erwägen (nur mit Paul, Regel: Keys nicht anfassen ohne Auftrag).
Quelle: SECURITY „Hinweis in eigener Sache“.

### 3.5 Cookie-Path `/panel` trifft auch `/panel/sandbox`-Requests
**Was fehlt:** Produktions-Cookie wird technisch mitgeschickt; Sandbox-DB erkennt den Token
nicht → kein Zugriff, nur unnötige Bytes.
**Warum (nicht) wichtig:** Kein Cross-Environment-Zugriff möglich; kosmetisch/gering.
Quelle: SECURITY Punkt 1.

### 3.6 Keine Zahlung / Identitätsprüfung
**Was fehlt:** Bewusst nicht gebaut. Entschlossener Nutzer mit Wegwerf-Mail kann nach
Bestätigung trotzdem Generierungskosten verursachen (ohne echte Social-Verbindung kein
Publish).
**Warum (nicht) wichtig:** Grenze der E-Mail-Methode; für großen Missbrauch relevant, für
einen Pilotkunden eher theoretisch.
Quelle: PANEL_V6 Kosten-/Risikoeinschätzung.

### 3.7 In-Memory-Rate-Limits überleben Prozess-Neustart nicht
**Was fehlt:** Zähler leben nur im Prozess (wie bestehende Limits); nach `pm2 restart` frisch.
**Warum (nicht) wichtig:** Kurzfenster nach Deploy; konsistent mit dem Rest des Panels,
kein neues Risiko.
Quelle: PANEL_V6 Risiken.

---

## 4. Nice-to-have / spätere Ideen (schon erwähnt)

### 4.1 Meta-Checkliste Feinschliff
App-Icon, Business Verification, Screencast, Data-Deletion-Anleitung-URL bei Meta,
Nutzungsbedingungen-URL – alles vor/bei App-Review, siehe 1.3.
Quelle: META_APP_REVIEW.

### 4.2 Domain `app.pipeflow.at`
In TURNSTILE_SETUP als zweiter Hostname vorgesehen, „falls noch nicht live“.
**Status unklar**, ob DNS/Hosting geplant oder nur vorsorglich genannt.
Quelle: TURNSTILE_SETUP.

### 4.3 Produkt-Rebrand-Reste / Branding-Text
Rebrand zu „Pipeflow“ (Commit-Historie); Datenschutz-Entwurf und mancher Copy sprechen noch
von „Pipeline AI Solutions“; Wasserzeichen-Text historisch „Pipeline“.
**Nicht als klarer offener Auftrag in einem Report abgehakt** – nur als bekannte
Inkonsistenz erwähnen, falls Markenführung wichtig wird.

### 4.4 Hilfe-Chat: Verlauf nur Sitzungs-Speicher
Kein serverseitiger Chat-Verlauf; nach Reload weg.
Quelle: PANEL_V6 Aufgabe 6.

### 4.5 Claude-Routinen-Tageskontingent beobachten
Sofort-Trigger zählen gegen Anthropic-Tageslimit; bei vielen Kunden/Freigaben theoretisch 429
(nur geloggt, stündlicher Lauf als Fallback).
Quelle: ROUTINE_TEIL_A.

### 4.6 `usage_costs` / Kosten-Tracking pro Kunde
Im Security-Auftrag erwähnt, **existiert im Code nicht** – keine offene Bugfix-Aufgabe,
eher mögliche spätere Produktidee.
Quelle: SECURITY Punkt 2.

### 4.7 GitHub `origin/main` 10 Commits hinter lokalem `main`
Sandbox, v7-Fixes, Security/UX liegen lokal deployed, aber noch nicht gepusht.
**Warum (nicht) wichtig für Kundenbetrieb:** Produktion läuft vom Server-Stand. Relevant für
Cloud Agents, Backup/Zweitmaschine und externe GitHub-Sicht.
Ist-Zustand: `git status` 2026-09-13 (`main` ahead 10).

### 4.8 Erster voller 7-Tage-Vorausplanungslauf „unter Beobachtung“
v5: eingeschränkter Staging-Lauf ok; voller Produktiv-Lauf mit allen Kunden/Kanälen/7 Tagen
war in der Bau-Sitzung nicht beobachtbar – `planning_errors` beobachten.
Quelle: PANEL_V5 Risiken / „Was Paul manuell tun muss“.

---

## Kurz: Was Paul selbst entscheiden / tun muss (ohne Code)

1. Turnstile-Keys anlegen und in `.env` setzen → Restart außerhalb Routine-Fenster.
2. Datenschutz rechtlich freigeben, live stellen, Panel-Link korrigieren (404 beheben).
3. Meta App Review vorbereiten/einreichen **oder** jeden Pilotkunden als Instagram-Tester
   whitelisten.
4. Admin-Test-E-Mail einmal echt empfangen.
5. Panel einmal selbst auf Desktop + Handy durchklicken (Sandbox und/oder Prod).
6. `PANEL_ENCRYPTION_KEY` extern sichern (falls noch nicht).
7. Live-Routine-Prompt per RemoteTrigger gegen `docs/ROUTINE_TEIL1.md` abgleichen (Punkt 2.5).
8. Optional: lokale 10 Commits nach GitHub pushen.

---

*Datei angelegt 2026-09-13 im Auftrag „Was ist noch offen?“ – bei Fortschritt diese Datei
mitpflegen statt neue Parallel-Listen.*
