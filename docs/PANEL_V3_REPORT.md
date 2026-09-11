# Panel v3 – Fortschrittsbericht

Autonome Sitzung gestartet: 2026-09-11 09:00 UTC (Ausgangspunkt: `origin/main` @ `54712b3`).
Sicherheits-Tag: `pre-panel-v3`. Arbeitsbranch: `panel-v3`.

Dieser Bericht wird nach JEDER Aufgabe aktualisiert. Bei Abbruch der Sitzung: hier lesen,
um zu sehen, wo der Stand ist.

## Status je Aufgabe

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | Sicherheitsnetz (Tag/Branch/Staging/Testskript) | ✅ erledigt |
| 2 | Probekonto (Trial) | ✅ erledigt |
| 3 | Admin-Dashboard | ✅ erledigt |
| 4 | Posting-Rhythmus (isDue) | ✅ erledigt (Code) – Routine-Umstellung durch Paul nötig |
| 5 | "Mit KI verbessern" | ✅ Code fertig, ⚠️ ANTHROPIC_API_KEY fehlt (Feature bleibt bis dahin ausgeblendet) |
| 6 | Stil aus Instagram-Posts lernen | ⏳ offen |
| 7 | Kanal-/Formateinstellungen | ⏳ offen |
| 8 | Onboarding aufwerten | ⏳ offen |
| 9 | Kunden-Dashboard ausbauen | ⏳ offen |
| 10 | Betrieb absichern (Backup/Health) | ⏳ offen |
| 11 | Meta App Review Vorbereitung | ⏳ offen |
| 12 | Abschluss & Deploy | ⏳ offen |

## Aufgabe 1 – Sicherheitsnetz ✅

**Erledigt:**
- `git tag pre-panel-v3` gesetzt und gepusht (Rollback-Punkt: `origin/main` @ `54712b3`).
- Branch `panel-v3` erstellt, auf `origin/panel-v3` getrackt.
- Staging-Instanz:
  - pm2-Prozess `instagram-mcp-staging`, Port `3100`, eigene DB `data/panel-staging.db`
    (Online-Backup von `data/panel.db` via `better-sqlite3`'s `.backup()`, da kein
    `sqlite3`-CLI auf dem Server installiert ist – funktional identisch).
  - Nicht über Nginx erreichbar, nur `127.0.0.1:3100` lokal.
  - **Nicht** per `pm2 save` persistiert – fliegt nicht automatisch beim Reboot mit hoch,
    wird am Ende der Sitzung wieder entfernt (Aufgabe 12).
- Testskript `npm run test:panel` (`scripts/test-panel.mjs`, reines Node, kein zusätzliches
  Test-Framework): Signup-Validierung, erfolgreicher Signup, `/api/me` (mit/ohne Session),
  `PATCH /api/me`, `/api/posts` (401 ohne Login), `/connect` ohne Session → `error=session`,
  `/mcp` ohne Bearer → 401. Admin- und Health-Checks sind vorbereitet und erkennen
  automatisch, ob die jeweilige Route schon existiert (siehe Entscheidung unten) – laufen
  erst „scharf“, sobald Aufgabe 3 / 10 fertig sind.
  - `pretest:panel` npm-Hook startet die Staging-Instanz vor jedem Lauf neu (siehe
    Entscheidung unten) und das Skript wartet aktiv auf `/health`, statt blind zu schlafen.
  - Test legt einen echten Test-Kunden an und löscht ihn am Ende wieder (DB-Cascade über
    `customer_id`) – Staging-DB bleibt nach jedem Lauf sauber.
  - Aktueller Stand: **19 passed, 0 failed** (2 Checks übersprungen, weil Aufgabe 3/10 noch
    nicht gebaut sind).

**Entscheidungen:**
- Kein `sqlite3`-CLI vorhanden → Staging-Backup und (später) Produktions-Backup laufen über
  `better-sqlite3`'s eingebaute Online-`backup()`-API statt `sqlite3 .backup`. Gleiche
  Sicherheitseigenschaft (konsistente Kopie auch bei laufendem Schreibzugriff), keine externe
  Abhängigkeit nötig.
- **Wichtiger Fund:** Der globale MCP-Bearer-Token-Gate (`requireBearerToken` in
  `src/http-server.ts`) ist NACH dem `/panel`-Router, aber ohne Pfad-Einschränkung montiert.
  Jede noch nicht existierende Route unter `/panel/...` fällt dadurch bis zu diesem Gate durch
  und bekommt zufällig ebenfalls `401 {"error":"Unauthorized"}` – nicht `404`. Das Testskript
  kann das also nicht als "Route existiert noch nicht" werten. Fix: Das Skript prüft die genaue
  Fehler-Body-Form dieses Fallthrough-Gates, um "noch nicht gebaut" von "bewusst mit 401
  geschützt" zu unterscheiden. **Für Aufgabe 3 und 10 wichtig:** neue Panel-/Admin-Routen
  müssen im `/panel`-Router selbst registriert werden (vor dem globalen Bearer-Gate), sonst
  greift versehentlich der MCP-Token-Schutz statt der eigenen Auth-Logik.
- Rate-Limiter (5 Signups/Stunde/IP) griff bei wiederholten Testläufen von derselben lokalen
  IP. Statt die Produktions-Sicherheitslogik fürs Testen aufzuweichen, startet
  `pretest:panel` die Staging-Instanz vor jedem Lauf neu (frischer In-Memory-Zustand). Auf
  Produktion bleibt der Rate-Limiter unverändert scharf.

**Für Paul:** nichts zu tun.

## Aufgabe 2 – Probekonto (Trial) ✅

**Erledigt:**
- `.env`: neue Variable `PANEL_TRIAL_DAYS=7` angehängt (bestehende Werte unverändert).
  Code-seitiger Default bleibt zusätzlich 7, falls die Variable fehlt.
- `POST /panel/api/signup` setzt jetzt `trial_ends_at = jetzt + PANEL_TRIAL_DAYS`.
  Bestehende Kunden in der DB wurden **nicht** angefasst (`trial_ends_at` bleibt bei ihnen
  `NULL` = unbefristet) - `PATCH /api/me` ändert `trial_ends_at` ebenfalls nie.
- `CustomerOverview` (und damit `list_customers`) liefert pro Kunde zusätzlich
  `trialExpired: boolean` und `trialDaysLeft: number | null` (null = unbefristet).
  Tool-Beschreibung von `list_customers` weist die Routine explizit an, Kunden mit
  `trialExpired: true` zu überspringen.
- **Doppelte Absicherung:** `getCredentials()` (der einzige Weg, wie alle Publish-Tools an
  Zugangsdaten kommen) prüft `trial_ends_at` selbst und bricht mit der Fehlermeldung
  "Probezeitraum abgelaufen" ab, bevor überhaupt ein Token zurückgegeben wird - unabhängig
  davon, ob die Routine `trialExpired` beachtet. Mit einem synthetischen Testkunden
  (abgelaufener Trial + Fake-Connection) gegen die Staging-DB verifiziert.
- Panel-UI: schwarze Leiste "Probezeitraum: noch X Tage" über der gesamten Pipeline-Ansicht
  (neues `#trialbar`-Element, nutzt die schon vorhandene `.trialbar`/`.trialbar.ended`-CSS),
  nach Ablauf rot mit Text + "Jetzt freischalten"-Button (`mailto:office@pipeline-solutions.at`,
  vorausgefüllter Betreff mit Firmenname). Kunden ohne Trial-Limit (bestehende Kunden) sehen
  gar keine Leiste. Auch im Demo-/Vorschau-Modus (`?demo`) nachgebildet.
- `npm run test:panel` erweitert: prüft nach Signup, dass `trialDaysLeft` gesetzt und
  `trialExpired` false ist.

**Entscheidungen:**
- Trial-Ablauf blockt nur das *Veröffentlichen* (`getCredentials`), nicht das Generieren von
  Vorschaubildern - unkritisch und im Aufgabentext nicht verlangt.

**Für Paul:** nichts zu tun.

## Aufgabe 3 – Admin-Dashboard (`/panel/admin`) ✅

**Erledigt:**
- `PANEL_ADMIN_PASSWORD`: falls beim Start nicht in `.env` gesetzt, generiert der Server
  selbst ein zufälliges Passwort (`crypto.randomBytes(24).toString("base64")`, äquivalent zu
  `openssl rand -base64 24`) und hängt es an `.env` an - **der Wert wird nirgends geloggt**.
  Beim Staging-Neustart wurde es bereits automatisch generiert.
  **Für Paul: Wert steht in `.env` unter `PANEL_ADMIN_PASSWORD` - dort nachsehen.**
- Neue Tabelle `admin_sessions` (additive Migration, `CREATE TABLE IF NOT EXISTS`).
- Eigener Router `src/panel/admin.ts`, gemountet unter `/panel/admin` **innerhalb** des
  bestehenden Panel-Routers (`router.use("/admin", createAdminRouter())`) - dadurch vor dem
  globalen MCP-Bearer-Gate und mit denselben Security-Headern/JSON-Parser wie der Rest des
  Panels (siehe Erkenntnis aus Aufgabe 1).
  - `POST /admin/api/login` (Passwort, konstante Zeit-Vergleich wie beim MCP-Token),
    IP-Rate-Limit 8 Versuche/15 Min, eigener httpOnly-Cookie `pp_admin` (Pfad `/panel/admin`,
    12h Gültigkeit, eigene Session-Tabelle).
  - Alle `/admin/api/*`-Routen außer `login`/`me` verlangen eine gültige Session (401 sonst).
  - `GET /admin/api/overview`: Kennzahlen (Kunden gesamt/aktiv/im Trial/Trial abgelaufen,
    Posts letzte 7 Tage, Verbindungen mit Handlungsbedarf) + Kundenliste (Firma, Kontakt,
    E-Mail, erstellt, Status, Trial, Kanäle mit Token-Status, Post-Anzahl, letzter Post).
  - `GET /admin/api/customers/:id`: Details (Briefing) + letzte 30 Posts.
  - `POST /admin/api/customers/:id/extend-trial` `{days}`: verlängert ab dem späteren von
    "jetzt" oder aktuellem Ablauf (verkürzt nie versehentlich einen noch laufenden Trial).
  - `POST /admin/api/customers/:id/unlimited`: setzt `trial_ends_at = NULL`.
  - `POST /admin/api/customers/:id/status` `{status: "active"|"paused"}`: nutzt die
    **bestehende** `status`-Spalte - "pausiert" sperrt automatisch Login UND Erscheinen in
    `list_customers` (beide Stellen filtern schon auf `status = 'active'`), ohne neue Spalte.
  - **Kein** Lösch-Endpunkt - wie gefordert nur über die Kunden-Selbstbedienung (Aufgabe 11).
- `public/panel/admin.html`: eigene Seite im selben Look (Schibsted Grotesk, Schwarz/Weiß,
  eckige Buttons), Login-Formular + Dashboard mit Kennzahlen-Kacheln, Kundentabelle (wird am
  Handy zu gestapelten Karten, `@media max-width:900px`), Aktions-Buttons pro Zeile, Detail-
  Modal mit Briefing + Post-Verlauf.
- Manuell gegen Staging durchgespielt: Login, `extend-trial`, `unlimited`, `status` (pausieren
  + reaktivieren, inkl. Check, dass der pausierte Testkunde aus der aktiven Liste verschwindet)
  - alles funktioniert, Staging-DB danach wieder in den Ausgangszustand zurückgesetzt.
- `npm run test:panel` erweitert: Admin-Endpunkte ohne Auth → 401, falsches Passwort → 401,
  vollständiger Login→Overview→Logout-Roundtrip mit dem echten (nie geloggten) Passwort aus
  `.env`. **28 passed, 0 failed.**

**Entscheidungen:**
- "Pausieren" ist kein neues Feld, sondern die schon vorhandene `customers.status`-Spalte -
  minimal-invasiv und automatisch an zwei bestehenden Stellen wirksam (Login, `list_customers`).
- Admin-Session getrennt von Kunden-Session (eigener Cookie-Name `pp_admin`, eigene DB-Tabelle),
  damit ein Kunde niemals versehentlich Admin-Rechte über einen geteilten Cookie-Namen bekommen
  kann.

**Für Paul:** `PANEL_ADMIN_PASSWORD` in `.env` nachsehen für den Admin-Login unter
`https://mcp.pipebot.at/panel/admin` (erst nach dem finalen Deploy in Aufgabe 12 live).

## Aufgabe 4 – Posting-Rhythmus wirklich wirksam machen ✅ (Code) / ⚠️ Routine-Umstellung nötig

**Erledigt:**
- Neues Modul `src/panel/schedule.ts` mit `isDue(customer, now)` und `nextPostAt(customer, now)`.
  Alles in **Europe/Vienna**-Wanduhrzeit berechnet (via `Intl.DateTimeFormat`, korrekt über
  CET/CEST-Zeitumstellungen hinweg, kein zusätzliches npm-Paket nötig):
  - `taeglich` = jeden Tag, `werktags` = Mo–Fr, `3x-woche` = Mo/Mi/Fr.
  - `isDue`: heute ist ein Posting-Tag UND die eingestellte Uhrzeit ist erreicht UND heute
    wurde noch kein Post für diesen Kunden geloggt (Abgleich gegen die `posts`-Tabelle).
  - `nextPostAt`: nächster Termin (Tag+Uhrzeit), für den noch kein Post existiert - überspringt
    also automatisch bereits erledigte Tage.
  - Mit synthetischen Testfällen gegen Staging verifiziert, inkl. Spezialfall "nach dem
    heutigen Post springt `nextPostAt` korrekt auf morgen und `isDue` wird `false`".
- `list_customers` liefert pro Kunde jetzt `dueNow` (boolean) und `nextPostAt` (ISO). Die
  Tool-Beschreibung weist die Routine explizit an, **nur** für Kunden mit `dueNow: true` zu
  generieren/veröffentlichen.
- Panel zeigt "Nächster Beitrag: Mittwoch, 17:00 Uhr" auf der Fertig-Seite (unter "Rhythmus")
  und als Satz oben im Verlauf-Tab (ausgeblendet, wenn der Trial abgelaufen ist).
- `npm run test:panel` erweitert um Checks, dass `nextPostAt`/`dueNow` im Signup-Response
  vorhanden und plausibel sind. **30 passed, 0 failed.**

**Bekannte, bewusst akzeptierte Einschränkung:** `nextPostAt` verwendet für jeden Kandidatentag
den Vienna-UTC-Offset an dessen lokalem Mittag - das ist über eine ganze 14-Tage-Vorschau hinweg
korrekt, mit einer theoretischen Ungenauigkeit von bis zu 1h nur für Slots, die exakt in der
Umstellungsnacht selbst liegen (letztes Wochenende im März/Oktober, 1-3 Uhr) - für eine reine
Anzeige unkritisch.

**⚠️ Wichtig – das kann ich nicht selbst ändern:** Die tägliche Cloud-Routine (läuft aktuell
1×/Tag ca. 15:00 UTC) ruft `list_customers` auf und postet vermutlich für alle Kunden auf
einmal, unabhängig vom eingestellten Rhythmus/Uhrzeit. Damit `dueNow`/`nextPostAt` tatsächlich
etwas bewirken, muss die Routine selbst umgestellt werden: **stündlich laufen** und **nur
Kunden mit `dueNow: true` bearbeiten**. Das kannst nur du auf claude.ai ändern. Fertiger
Prompt-Text dafür ganz unten in diesem Bericht (Abschnitt "Routine-Prompt-Text").

**Für Paul:** Cloud-Routine auf stündlichen Rhythmus umstellen und den neuen Prompt-Text
(siehe unten) einfügen - sonst bleibt die Rhythmus-Einstellung im Panel wirkungslos.

---

## Routine-Prompt-Text (für claude.ai einfügen)

Dieser Abschnitt wird während der Sitzung weiter ergänzt (Aufgabe 6 fügt einen Absatz zum
Stil-Lernen hinzu) und am Ende noch einmal als Ganzes im Abschlussbericht wiederholt.

**Zeitplan der Routine:** von 1×/Tag (~15:00 UTC) auf **stündlich** umstellen (z. B. `0 * * * *`
UTC), damit für jeden Kunden möglichst nah an seiner eingestellten `postTime` gepostet wird -
`dueNow` verhindert Mehrfach-Posts an Tagen, an denen schon veröffentlicht wurde.

```
Du bist die automatische Posting-Routine von Pipeline. Du läufst stündlich. Bei jedem Lauf:

1. Rufe `list_customers` auf.
2. Gehe jeden Kunden einzeln durch. Überspringe einen Kunden sofort (kein Tool-Aufruf für ihn),
   wenn `trialExpired` true ist ODER `dueNow` false ist. Nur Kunden mit `dueNow: true` und
   `trialExpired: false` werden in diesem Lauf bearbeitet.
3. Für jeden fälligen Kunden:
   a. Formuliere ein Thema und eine kurze, prägnante Headline (2-4 Wörter) passend zu seinem
      Briefing (`about`, `industry`, `tone`, `avoidTopics`, `ctaPreference`).
   b. Erzeuge das Bild mit `generate_post_image` (customer_id angeben) und prüfe kurz, ob der
      Hintergrund sauber aussieht (keine Artefakte, keine unerwünschten Texte/Icons).
   c. Veröffentliche mit `publish_generated_post` (customer_id angeben, Caption passend zum
      Tonfall und `ctaPreference` des Kunden, inkl. sinnvoller Hashtags/Emojis nur wenn zum
      Ton passend).
   d. Wiederhole das für jeden Kanal, den der Kunde verbunden hat (`channels`), sofern für
      LinkedIn ein eigenes Text-Tool nötig ist statt eines Bild-Posts.
4. Poste NIE für einen Kunden mit `trialExpired: true` oder `dueNow: false` - auch nicht
   "vorsorglich" oder weil gerade sonst nichts zu tun ist.
5. Bei einem Fehler für einen Kunden (z. B. abgelaufene Verbindung): den Kunden überspringen,
   kurz notieren welcher Fehler auftrat, und mit dem nächsten Kunden weitermachen - ein
   einzelner fehlerhafter Kunde darf den Lauf für alle anderen nicht abbrechen.
```

*(wird nach Aufgabe 6 um einen Absatz zu `get_customer_style_samples` ergänzt - siehe dort.)*

## Aufgabe 5 – "Mit KI verbessern" ✅ Code fertig / ⚠️ Key fehlt

**Erledigt:**
- `src/anthropic.ts`: `improveBriefing({company, industry, about})` ruft die Anthropic Messages
  API auf (`POST https://api.anthropic.com/v1/messages`), System-Prompt auf Deutsch, liefert
  einen konkreten 3-5-Satz-Absatz (Zielgruppe, Themen, Nutzen) zum direkten Übernehmen ins
  Formularfeld - keine Anrede, keine Überschrift, keine Marketing-Floskeln.
- `config.ts`: `anthropicApiKey`/`anthropicModel` (Default `claude-haiku-4-5-20251001`, über
  `ANTHROPIC_MODEL` überschreibbar) - **optional**, kein `required()`, damit der Server ohne
  Key wie bisher normal startet.
- `.env`: zwei **auskommentierte** Beispielzeilen angehängt (`# ANTHROPIC_API_KEY=`,
  `# ANTHROPIC_MODEL=...`) als Vorlage - keine echten Werte gesetzt, da mir kein Anthropic-Key
  vorliegt.
- `POST /panel/api/improve-briefing`: funktioniert auch **ohne Login** (während des Signups),
  IP-Rate-Limit 6 Anfragen/10 Minuten, Eingabe `about` max. 2000 Zeichen, liefert `503` wenn
  kein Key konfiguriert ist (Server-seitige Absicherung zusätzlich zum ausgeblendeten Button).
- `GET /panel/api/providers` liefert zusätzlich `aiAvailable: boolean` - das Panel blendet den
  "Mit KI verbessern"-Button beim Feld "Worum soll es in den Beiträgen gehen?" nur ein, wenn
  dieses Flag `true` ist.
- Panel-UI: Vorschlag erscheint unter dem Feld in einer eigenen Box mit "Übernehmen" (ersetzt
  den Textarea-Inhalt) / "Verwerfen" (blendet die Box aus) - **überschreibt nie automatisch**.
  Arbeitet direkt am DOM (kein Re-Render über `render()`), damit ungespeicherte Eingaben in
  anderen Feldern währenddessen nicht verloren gehen.
- Auch im Demo-/Vorschau-Modus nachgebildet (`aiAvailable: true`, realistischer Beispieltext
  mit Hinweis "(Vorschau-Beispiel)").
- `npm run test:panel`: prüft, dass `/api/providers` das Flag liefert, und dass
  `/api/improve-briefing` ohne Key sauber `503` liefert statt eines Serverfehlers.
  **32 passed, 0 failed.**

**Für Paul:** `ANTHROPIC_API_KEY` (und optional `ANTHROPIC_MODEL`) in `.env` eintragen -
danach erscheint der Button automatisch, ohne weiteren Deploy-Schritt. Bis dahin bleibt das
Feature sauber ausgeblendet, keine Fehler im laufenden Betrieb.

---
*(wird fortgesetzt)*
