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
- [ ] Aufgabe 2.5 - Verifikation (nur prüfen, nicht neu bauen)
- [ ] Aufgabe 3 - Dashboard-Umbau
- [ ] Aufgabe 4 - Kunden-E-Mails
- [ ] Aufgabe 5 - Zugangslink-Wiederherstellung
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

## Kosteneinschätzung (Regel 11)

- Turnstile-Verifizierung: kostenlos (siehe oben), ein zusätzlicher schneller HTTP-Aufruf pro
  Signup-Versuch, kein Rate-Limit nötig (Cloudflares eigener Dienst, kein Anthropic/fal.ai).
- E-Mail-Versand: über bestehende SMTP-Infrastruktur, kein zusätzlicher Dienst, keine
  zusätzlichen laufenden Kosten (Hostinger-Postfach existiert bereits).
- Die eigentliche Kostenersparnis überwiegt bei Weitem: jeder Signup, der nie bestätigt wird,
  spart ab sofort dauerhaft 1 Anthropic- + 1 fal.ai-Aufruf pro fälligem Kanal/Tag (siehe
  PANEL_V5_REPORT.md's Kostenrechnung) - genau die Lücke, die diese Aufgabe schließen sollte.

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

(wird nach dem Produktions-Deploy dieses Abschnitts aktualisiert)
