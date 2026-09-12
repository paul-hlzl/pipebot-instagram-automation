# Panel v6 Report - Missbrauchsschutz, Dashboard-Umbau, Kunden-E-Mails, Chatbot-Hilfe

Laufender Report für die autonome Arbeitssitzung "Kunden-Panel v6". Wird während der Sitzung
fortlaufend aktualisiert.

Sicherheitsnetz: Tag `pre-panel-v6` auf dem Stand vor dieser Sitzung (Commit `9bdf9a2`, main),
Branch `panel-v6`.

**Vorab nachgeholt:** Der Code-Stand aus der letzten Sitzung (Sofort-Trigger, Erklärtexte,
Mobile-Fixes, Lightbox - "Aufgabe 2.5" unten) war bereits live deployed, aber nie committet.
Vor dem Tag als eigenen Commit `9bdf9a2` auf `main` nachgezogen, damit `pre-panel-v6` den
tatsächlichen Produktions-Stand widerspiegelt.

## Status je Aufgabe

- [x] Aufgabe 1 - Sicherheitsnetz (Tag + Branch + vorheriger Stand nachcommitet)
- [x] Aufgabe 2 - Missbrauchsschutz (CAPTCHA + E-Mail-Bestätigung) - **siehe unten, mit einer
      wichtigen Einschränkung: 2a ist bei mir nur teilweise scharf, siehe "Was Paul noch tun muss"**
- [x] Aufgabe 2.5 - Verifikation: Teil A-D aus der letzten Sitzung sind unverändert vorhanden
      (routine-trigger.ts, alle 3 triggerRoutineNow-Aufrufstellen, ROUTINE_TRIGGER_URL/TOKEN in
      .env, Lightbox-Overlay, Mobile-Tap-Ziel-CSS, Erklärtexte) - per grep geprüft, nichts
      nachgebaut, wie gefordert.
- [x] Aufgabe 3 - Dashboard-Umbau (siehe unten - UI-only, NICHT in einem echten Browser getestet)
- [x] Aufgabe 4 - Kunden-E-Mails (siehe unten)
- [x] Aufgabe 5 - Zugangslink-Wiederherstellung (siehe unten)
- [ ] Aufgabe 6 - Chatbot-Hilfe
- [ ] Aufgabe 7 - Abschluss-Deploy

## Zwischenfall (Transparenz)

Beim Aufräumen einer Test-Instanz habe ich versehentlich `pkill -f "dist/index.js"` verwendet -
das trifft nicht nur meine eigene Staging-Instanz, sondern jeden Prozess mit diesem Pfad-Muster,
also auch `tiktok-mcp` (unabhängiger, unbeteiligter Dienst). Es wurde kurz beendet, pm2 hat es
binnen Sekunden automatisch neu gestartet (Restart-Zähler +1), Health-Check danach geprüft: sauber
hochgefahren, keine Fehler im Log. Kein Datenverlust, keine Downtime für echte Nutzer erkennbar
(TikTok-Dienst hat vermutlich ohnehin keine Dauerverbindungen). Ab sofort beende ich Test-Prozesse
nur noch über ihre exakte PID, nie mehr über ein Pfad-Muster.

## Aufgabe 2 - Missbrauchsschutz beim Signup

### 2a. CAPTCHA (Cloudflare Turnstile)

Recherchiert gegen die aktuelle offizielle Doku (developers.cloudflare.com/turnstile, Stand
2026-09), nicht geraten:

- **Kostenlos ohne dokumentiertes Mengenlimit** - die Free-Plan-Grenzen betreffen nur Anzahl
  Widgets (20) und Hostnamen pro Widget (10), nicht das Verifizierungs-Volumen selbst.
- **Kein Cloudflare-DNS/Zone-Umzug nötig** - laut offizieller Doku ausdrücklich "designed to be
  an independent service", funktioniert auf jeder Website mit nur einem kostenlosen
  Cloudflare-Account.
- Einrichtung: dash.cloudflare.com -> Turnstile -> "Add widget" -> Domain(s) eintragen -> liefert
  Sitekey (öffentlich, geht ans Frontend) + Secret Key (bleibt serverseitig).
- Server-Verifizierung: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` mit
  `secret`/`response`/optional `remoteip`, liefert `{success, "error-codes": [...]}`. Token ist
  einmalig verwendbar, 300s gültig.
- Test-Keys für lokale Entwicklung ohne echten Account: Sitekey `1x00000000000000000000AA`
  (immer erfolgreich), Secret `1x0000000000000000000000000000000AA`.

**Umgesetzt:** `src/panel/turnstile.ts` (Verifizierung, "fail closed" bei Netzwerkfehler/Timeout -
5s Timeout, damit ein haengender Cloudflare-Aufruf nie das Signup-Formular blockiert),
eingebunden in `POST /api/signup` (lehnt ohne gültiges Token ab, sobald `TURNSTILE_SECRET_KEY`
gesetzt ist). Frontend: Widget wird nur gerendert, wenn ein `TURNSTILE_SITE_KEY` vom Server
kommt (`GET /api/providers`), explizites Rendering beim Wechsel auf Formular-Seite 2 (dort liegt
auch die Einwilligung), CSP entsprechend erweitert (`script-src`/`frame-src` für
challenges.cloudflare.com).

**WICHTIGER OFFENER PUNKT, nicht stillschweigend versteckt:** `TURNSTILE_SITE_KEY` und
`TURNSTILE_SECRET_KEY` sind in `.env`/`.env.example` nur als leere Platzhalter angelegt - ich habe
keinen Cloudflare-Account für Sie eingerichtet (kein Zugriff auf Ihre Zugangsdaten, und das wäre
ohnehin Ihre Entscheidung). **Solange diese beiden Werte leer sind, läuft das Signup-Formular
komplett OHNE CAPTCHA** - technisch identisch zum Verhalten der KI-Buttons ohne API-Key (Feature
sauber deaktiviert, kein Fehler), aber inhaltlich ist das hier keine Nebensächlichkeit: **ohne
Turnstile ist die einzige verbleibende automatisierte Bremse gegen Massen-Signups weiterhin nur
das IP-Rate-Limit (5/Stunde), nicht ein echter Mensch-Nachweis.** Das dringend nachzuholen, sobald
ein Cloudflare-Account existiert: dash.cloudflare.com -> Turnstile -> Add widget -> Domain
`mcp.pipebot.at` -> Sitekey/Secret in `.env` eintragen -> `pm2 restart instagram-mcp`. Kein
Code-Deploy nötig, nur die zwei .env-Werte.

### 2b. E-Mail-Bestätigung vor erster automatischer Generierung

- Migration (additiv, idempotent): `customers.email_verified` (Standard 0),
  `customers.email_verify_token_hash`. Bestehende Kunden (Paul/Andrea, Testunternehmen, Johannes
  Reiter) wurden in der Migration **einmalig** rückwirkend auf `email_verified=1` gesetzt (geprüft
  gegen eine echte Kopie der Produktions-DB via `db.backup()`, siehe unten) - für sie ändert sich
  nichts. Der Backfill läuft nachweislich nur EIN einziges Mal (Guard: nur wenn die Spalte gerade
  neu angelegt wird), sonst würde er auch künftige, noch unbestätigte Signups fälschlich
  freischalten.
- Neuer, wiederverwendbarer Baustein `src/panel/mailer.ts` (reiner Versandweg, `execFileSync` über
  das bereits konfigurierte `msmtp`/Hostinger-SMTP-Konto "pipebot" - **kein neuer Dienst/Account
  nötig**, dieselbe Technik, mit der `weekly-report.mjs` seit Längerem echte Mails an Sie
  verschickt, hier nur erstmals auch an Kunden gerichtet) + `src/panel/emails.ts` (Text-Vorlagen,
  aktuell die Bestätigungsmail; Aufgabe 4/5 ergänzen hier weitere Vorlagen, ohne den Versandweg zu
  duplizieren). `PANEL_MAIL_DRY_RUN=1` unterdrückt echten Versand (nur Log) - so in dieser
  Sitzung für alle Tests genutzt, in Produktion bleibt die Variable ungesetzt.
- `POST /api/signup` erzeugt einen Bestätigungs-Token (wie beim bestehenden `login_key`-Muster:
  roher Token nur in der Mail, Hash in der DB), verschickt die Mail (`sendMailBestEffort` - ein
  Mail-Fehler blockiert das Signup selbst NIE), `GET /verify-email?token=...` bestätigt, loggt
  automatisch ein (wer den Link öffnen konnte, hat die Adresse bewiesen) und macht den Token
  einmalig ungültig. `POST /api/resend-verification` (Login nötig, 1x/5min) fordert erneut an.
- **Gesperrt bis zur Bestätigung** (HTTP 403 "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse."):
  `/api/post-now`, `/api/improve-briefing`, `/api/analyze-website`, `/api/suggest-pillars`,
  `/api/suggest-topics`, `/api/planned-posts/:id/regenerate-image` (Letzteres war in der
  Aufgabenstellung nicht explizit genannt, aber ebenfalls ein echter fal.ai-Aufruf pro Klick -
  aus Konsistenzgründen mit gesperrt). `planning.ts` überspringt unbestätigte Kunden komplett
  (kein Anthropic-/fal.ai-Aufruf mehr in der nächtlichen Vorausplanung).
- **Zusätzlich gefunden und geschlossen, über die Aufgabenstellung hinaus:** die STÜNDLICHE
  K1-K9-Routine selbst (bei claude.ai, darf laut Regel 7 nicht editiert werden) hätte über ihren
  K4-K8-Fallback für einen unbestätigten, aber laut Zeitplan "fälligen" Kunden trotzdem spontan
  generiert - `planning.ts` zu sperren allein hätte diese Lücke NICHT geschlossen, da die Routine
  nichts von `planning.ts` weiß und nur `list_customers` (MCP-Tool) befragt. Gelöst OHNE die
  Routine anzufassen: `credentials.ts`'s `overview()` (das ist die Funktion hinter
  `list_customers`) liefert `dueNow`/`instagramDueNow`/`linkedinDueNow` jetzt `false` für
  unbestätigte Kunden - exakt derselbe Mechanismus, der schon für `customer_paused` genutzt wird.
  Die Routine "sieht" einen unbestätigten Kunden dadurch nie als fällig und überspringt ihn von
  selbst (K3), ganz ohne Prompt-Änderung.
- Panel-UI: `emailVerifyBannerHtml()` zeigt auf der "Fertig"-Seite (und künftig auf dem neuen
  Dashboard aus Aufgabe 3) einen klaren Hinweis mit "Bestätigungsmail erneut senden"-Button,
  solange `emailVerified` false ist. Kanäle verbinden bleibt ausdrücklich möglich.

### 2c. Rate-Limits durchgesehen

Signup bleibt bei 5/Stunde/IP - Einschätzung: das Limit war schon vorher eine grobe Bremse gegen
Massen-Signups, ist aber **nicht mehr die wichtigste Verteidigungslinie**. Der eigentliche
finanzielle Schaden (nächtliche Anthropic-/fal.ai-Kosten für nie aktivierte Accounts) ist jetzt
durch 2b strukturell verhindert, unabhängig davon, wie viele Accounts jemand anlegt - ein Account
ohne Bestätigung kostet nichts mehr außer einer DB-Zeile und einer verschickten Mail. 5/Stunde
bleibt sinnvoll als Bremse gegen das Verbrauchen des Mail-Versand-Kontingents/der
Sender-Reputation (viele Bestätigungsmails an ungültige/gemeldete Adressen könnten dem
office@pipebot.at-Ruf schaden) und gegen reines DB-Zumüllen - keine Änderung vorgenommen, aber
explizit geprüft statt unverändert übernommen, wie gefordert.

## Verifikation vor Deploy

- `npm run build` fehlerfrei.
- `npm run test:panel`: 98/98 grün gegen frische Staging-Instanz (eigene DB, Port 3100, danach
  entfernt) - inkl. neuem Abschnitt "E-Mail-Bestätigung" (Sperre vor Bestätigung, Freischaltung
  nach Bestätigung über einen selbst gesetzten Test-Token-Hash, Einmaligkeit des Tokens,
  Resend-Verhalten).
- **Migration zusätzlich gegen eine ECHTE Kopie der Produktions-DB geprüft** (via
  `better-sqlite3`s `.backup()` - konsistente Kopie inkl. WAL-Inhalt, nie die echte Datei
  angefasst): alle 3 echten Bestandskunden (Andrea Hölzl, Testunternehmen, Johannes Reiter) haben
  nach der Migration korrekt `email_verified=1` und `email_verify_token_hash=NULL`, Admin-Übersicht
  lädt normal weiter. Kopie danach gelöscht.

## Aufgabe 3 - Dashboard-Umbau für wiederkehrende Kunden

Rein clientseitig (`public/panel/index.html`), kein neuer/geänderter Server-Endpunkt, kein
Kosten-Impact.

- Neuer Schritt `"dashboard"` (parallel zu, nicht Teil von, der bestehenden `steps()`-Kette) -
  die Pipeline-Navigation links (`renderRail()`) bleibt für die Schritt-Kette bytegleich
  unverändert, zeigt sich aber gar nicht mehr, sobald `S.step === "dashboard"` ist (leeres Rail,
  `.shell` bekommt `no-rail` und nutzt die volle Breite).
- **Landepunkt-Logik** (`landingStep()`): ein Kunde landet künftig auf `"dashboard"`, sobald
  `S.customer` existiert UND mindestens eine Verbindung (`S.connections.length > 0`) je
  hergestellt wurde - unabhängig davon, ob ALLE Kanäle verbunden sind (bewusst niedrigere Hürde
  als die alte `firstOpenStep()`-Logik, die "alle Anbieter verbunden" für "done" verlangte, exakt
  wie in der Aufgabenstellung "mindestens ein Kanal"). Angewendet beim Seitenaufruf/Login, nach
  E-Mail-Bestätigung und nach dem Speichern im Formular (`"Speichern und weiter"` im
  Bearbeiten-Modus). Ein Kunde OHNE jede Verbindung durchläuft die Schritt-Kette exakt wie bisher
  (`landingStep()` fällt dann auf die unveränderte `firstOpenStep()` zurück).
- **Nichts entfernt:** der komplette bisherige Inhalt der "Fertig"-Seite (Freigaben, 7-Tage-
  Vorschau-Verweis, Jetzt-posten, Letzte Beiträge, Kalender, Später-wiederkommen-Link,
  Konto-löschen) wurde in eine gemeinsame Funktion `dashboardSectionsHtml(c)` ausgelagert und wird
  von BEIDEN Seiten (`doneHtml()` unverändert für den Erst-Abschluss, `dashboardHtml()` neu für
  wiederkehrende Kunden) genutzt - keine Logik dupliziert, `loadDashboardExtras()` befüllt exakt
  dieselben Element-IDs auf beiden Seiten.
- **Neu auf dem Dashboard:** vier Navigations-Kacheln oben (Vorschau/Verlauf/Kanäle
  verwalten/Stil bearbeiten, `.dash-tiles`, 4→2→1 Spalten je nach Breite), eine kompakte
  Kanal-Status-Liste (`.dash-channel-row`, min. 44px hoch, tippbar -> springt direkt zur
  jeweiligen Anbieter-Seite) und eine Statuszeile mit dem nächsten geplanten Beitrag.
  "Zurück zur Übersicht"-Buttons (Vorschau/Verlauf-Seite) und die "Weiter"-Buttons am Ende der
  Anbieter-Kette (`overviewStep()`) führen jetzt ebenfalls zum Dashboard statt zu "Fertig", sobald
  ein Kunde als wiederkehrend gilt.
- Mobile: `.dash-tiles`/`.dash-channels` nutzen dieselben Breakpoints/Tap-Ziel-Vorgaben (≥44px)
  wie der Rest des Panels aus der letzten Sitzung (Teil C).

**Nicht in einem echten Browser getestet** (kein Browser-Werkzeug in dieser Sitzung verfügbar,
wie schon beim Panel-v5-Report vermerkt) - geprüft wurden: `node --check` auf beiden extrahierten
Inline-Skript-Blöcken (fehlerfrei), Grep-Zählung aller neuen/veränderten Funktionen (keine
Duplikate), und der komplette `test:panel`-Lauf (98/98 grün, unverändert - dieser Task berührt
keinen Server-Endpunkt). Bitte vor dem nächsten echten Kundenzugriff einmal mit einem Kunden mit
mindestens einem verbundenen Kanal durchklicken, insbesondere: landet man nach Login wirklich auf
dem Dashboard, funktionieren alle vier Kacheln, sieht die Kanal-Liste auf einem echten Handy gut
aus.

## Aufgabe 4 - Kunden-E-Mails

Baut auf dem in Aufgabe 2b angelegten Baustein auf (`src/panel/mailer.ts` = Versandweg über das
bestehende msmtp/Hostinger-Konto, `src/panel/emails.ts` = Text-Vorlagen) - kein neuer Dienst, kein
neuer Account, wie in der Aufgabenstellung verlangt erst geprüft, was schon da ist.

- **4a Bestätigungsmail:** bereits in 2b umgesetzt (nichts Neues hier).
- **4b "X Beiträge warten auf Ihre Freigabe":** Hook direkt in `savePendingApproval()`
  (`credentials.ts`) - dem einzigen Ort, an dem eine `pending_approvals`-Zeile entsteht, egal ob
  über die K1-K9-Routine (MCP-Tool `save_pending_approval`) oder einen künftigen anderen Aufrufer.
  Max. 1 Mail/24h pro Kunde (`approval_email_sent_at`-Zeitstempel als Guard, atomarer
  `UPDATE ... WHERE`-"Claim" gegen doppelten Versand): die erste neue Zeile innerhalb eines
  24h-Fensters löst die Mail mit der AKTUELLEN Gesamtzahl wartender Beiträge aus, jede weitere im
  selben Fenster wird nur mitgezählt, nicht nochmal gemailt.
- **4c "Ihr Probezeitraum endet in 2 Tagen":** neuer, eigenständiger täglicher Check
  (`src/panel/trial-emails.ts`, 04:00 UTC - eine Stunde nach der Vorausplanung, bewusst getrennt
  geplant, damit ein Fehler in der einen Aufgabe die andere nie mitreißt). Feuert einmalig, sobald
  `trialDaysLeft() === 2`, markiert per `trial_ending_email_sent_at`.
- **4d "Ihr erster Beitrag ist live!":** Hook in `logPost()` (`credentials.ts`) - dem einzigen Ort,
  an dem ein ECHTER Post verbucht wird (von allen publish_*-Tools genutzt). Zählt VOR dem Insert,
  ob es der erste ist, danach atomarer `UPDATE ... WHERE first_post_email_sent_at IS NULL`-Claim.
- **Admin-Test-Funktion:** neuer Button "Test-E-Mail senden" im Admin-Dashboard
  (`/panel/admin/api/test-email`, admin-authentifiziert) - beliebige Zieladresse, Auswahl
  zwischen allen 4 Vorlagen, immer mit `[TEST]`-Präfix im Betreff. Nutzt `sendMail` (nicht
  `sendMailBestEffort`), damit ein echter Fehlschlag beim Testen sichtbar wird statt nur geloggt.

### Deploy-Status

**Deployed.** `panel-v6` in `main` gemerged (Commit `80440a7`), Produktion um ca. 2026-09-12 08:38
UTC neu gestartet (Backup vorher, `/health`/`/mcp`/`/panel/api/health` danach grün, Log sauber).
`PANEL_MAIL_DRY_RUN` ist in Produktion NICHT gesetzt - echte Mails funktionieren dort ab jetzt
technisch (nutzt dieselbe msmtp/Hostinger-Verbindung, mit der `weekly-report.mjs` seit Längerem
echte Mails verschickt), aber ich habe in dieser Sitzung selbst KEINE einzige echte Mail
verschickt (Regel 3). **Bitte als Erstes den neuen "Test-E-Mail senden"-Button im Admin-Bereich
an Ihre eigene Adresse nutzen**, um den echten Versand einmal selbst zu bestätigen.

### Verifikation

- `npm run test:panel`: 104/104 grün (6 neue Tests für `/admin/api/test-email`: Auth-Gate,
  Validierung, alle 4 Vorlagen). Alle Staging-Läufe dieser Sitzung mit `PANEL_MAIL_DRY_RUN=1` -
  **kein einziger echter Mail-Versand in dieser Sitzung**, wie von Regel 3 verlangt.
- **4b/4d sind nicht über HTTP testbar** (nur über die MCP-Tools der Routine erreichbar, nicht
  über einen Panel-Endpunkt) - deshalb zusätzlich einmalig manuell verifiziert: ein Wegwerf-Skript
  gegen eine komplett isolierte Scratch-DB (nicht Staging, nicht Produktion,
  `/tmp/panel-aufgabe4-verify.db`, danach gelöscht) hat `savePendingApproval()` zweimal
  hintereinander für denselben Kunden aufgerufen (genau 1 Mail-Versuch geloggt, `pending count`
  trotzdem korrekt 2) und `logPost()` zweimal (genau 1 "erster Beitrag"-Mail-Versuch geloggt) -
  beide Drossel-Mechanismen funktionieren wie vorgesehen.

## Aufgabe 5 - Zugangslink-Wiederherstellung

- Neuer, eingeklappter Bereich ("Sie haben schon ein Konto? Zugang verloren?") unterhalb des
  Signup-Formulars auf der Panel-Startseite, nur für nicht angemeldete Besucher (`!edit` in
  `companyHtml()`).
- `POST /panel/api/recover-access`: bei Treffer wird - genau wie beim bestehenden "Persönlichen
  Link erzeugen"-Button - ein neuer `login_key_hash` gesetzt (ersetzt jeden älteren Link
  automatisch) und per Mail verschickt. **Antwort ist in JEDEM Fall identisch** (geprüft: Text
  bei bekannter und unbekannter Adresse ist wortgleich) - verrät nie, ob ein Konto existiert.
- Zwei Rate-Limit-Ebenen: 3x/Stunde pro E-Mail-Adresse (wie gefordert) UND zusätzlich 10x/Stunde
  pro IP (Backstop gegen das Durchprobieren vieler verschiedener Adressen von einem Absender).
- **Bekannte Grenze, offen benannt:** die Antwortzeit selbst ist NICHT künstlich angeglichen -
  ein Treffer schreibt in die DB und stößt einen echten Mail-Versand an, ein Nicht-Treffer tut
  nichts davon, was einen minimalen Zeitunterschied verursachen könnte (Timing-Seitenkanal). Für
  dieses Panel als vertretbar eingeschätzt (kein hochsensibles Ziel, keine großen Nutzerzahlen),
  aber bewusst nicht verschwiegen.

### Verifikation

`npm run test:panel`: 110/110 grün (6 neue Tests: ungültiges Format, unbekannte vs. bekannte
Adresse mit identischer Antwort, alter Link nach Wiederherstellung tatsächlich ungültig,
Rate-Limit greift nach 3 Anfragen). Kein echter Mail-Versand (`PANEL_MAIL_DRY_RUN=1`).

## Kosteneinschätzung (Regel 11)

- Turnstile-Verifizierung: kostenlos (siehe oben), ein zusätzlicher schneller HTTP-Aufruf pro
  Signup-Versuch, kein Rate-Limit nötig (Cloudflares eigener Dienst, kein Anthropic/fal.ai).
- E-Mail-Versand: über bestehende SMTP-Infrastruktur, kein zusätzlicher Dienst, keine
  zusätzlichen laufenden Kosten (Hostinger-Postfach existiert bereits).
- Die eigentliche Kostenersparnis überwiegt bei Weitem: jeder Signup, der nie bestätigt wird,
  spart ab sofort dauerhaft 1 Anthropic- + 1 fal.ai-Aufruf pro fälligem Kanal/Tag (siehe
  PANEL_V5_REPORT.md's Kostenrechnung) - genau die Lücke, die diese Aufgabe schließen sollte.
- Aufgabe 4 (Kunden-E-Mails): kein Anthropic-/fal.ai-Aufruf, kein Rate-Limit nötig (kein
  KI-/kostenpflichtiger Dienst beteiligt) - reiner SMTP-Versand über das bestehende Postfach, mit
  eigenen Drossel-Mechanismen (max. 1x/24h bzw. genau 1x einmalig) statt eines klassischen
  Rate-Limits, da es hier nicht um Missbrauch durch Dritte geht, sondern um "nicht zuspammen".

## Bekannte Grenzen (nicht beschönigt)

- **Wegwerf-E-Mail-Adressen umgehen 2b vollständig**: ein Bot/Missbraucher, der eine
  Wegwerf-Adresse (10minutemail o.ä.) nutzt, kann den Bestätigungslink trotzdem anklicken und ist
  dann ein ganz normaler "verifizierter" Kunde - E-Mail-Bestätigung beweist nur "jemand kontrolliert
  kurzzeitig ein Postfach", nicht "das ist ein echtes Unternehmen". Das ist eine grundsätzliche
  Grenze von E-Mail-Bestätigung als Methode, keine Bug in der Umsetzung. 2a (CAPTCHA) hilft hier
  nur gegen VOLLAUTOMATISIERTE Massen-Angriffe (verhindert das Skripten des gesamten Ablaufs
  inkl. Wegwerf-Postfach-Abruf), nicht gegen einen einzelnen Menschen, der sich die Mühe macht.
  Reale Abhilfe dagegen wäre eine Zahlungsmethode/Identitätsprüfung - bewusst nicht Teil dieser
  Aufgabe.
- **CAPTCHA ist bei mir aus** (siehe 2a) - bis Paul die Turnstile-Keys einträgt, ist die einzige
  Bremse gegen automatisierte Signup-Skripte weiterhin nur das IP-Rate-Limit.
- Der Resend-Rate-Limiter (1x/5min) ist wie alle bestehenden Rate-Limits in diesem Panel
  In-Memory (kein DB-Zähler) - überlebt einen Server-Neustart nicht. Bewusst genauso belassen wie
  alle anderen bestehenden Rate-Limits im Panel (Konsistenz), kein neues Risiko gegenüber vorher.

## Deploy-Status Aufgabe 2

**Deployed.** `panel-v6` in `main` gemerged (`--no-ff`, Commit `8c56f76`), gepusht, Produktion
(`pm2 restart instagram-mcp --update-env`) um ca. 2026-09-12 08:24 UTC neu gestartet - außerhalb
des 14:30-15:45-UTC-Blackouts, mit Abstand zum naechsten stuendlichen Routinen-Lauf (08:43).

Vor dem Neustart: Backup `backups/panel/panel-2026-09-12.db`.

Nach dem Neustart geprüft (alles grün):
- `/health` -> 200, `/mcp` ohne Bearer -> 401 (unverändert), `/panel/api/health` -> 200
- `/panel/api/providers` liefert `turnstileSiteKey: null` (CAPTCHA korrekt aus, wie erwartet ohne
  eingetragene Keys)
- Log sauber, keine neuen Fehler (nur bekannte, unveränderte LinkedIn-/Pillar-Warnungen aus dem
  laufenden Betrieb)
- Echte Produktions-DB direkt (read-only) geprüft: alle 3 echten Kunden (Andrea Hölzl,
  Testunternehmen, Johannes Reiter) haben `email_verified=1` - Migration hat in Produktion
  genauso funktioniert wie zuvor gegen die Kopie verifiziert.

Rollback-Bereitschaft: Tag `pre-panel-v6` (Code-Stand vor dieser Sitzung) und das DB-Backup von
eben vorhanden. Rollback wäre: `git revert` des Merge-Commits `8c56f76` + `npm run build` + `pm2
restart instagram-mcp` (die Migration selbst ist additiv/idempotent, ein Rollback des Codes muss
die DB-Spalten nicht zurückrollen - sie werden einfach nicht mehr gelesen/geschrieben).
