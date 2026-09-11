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
| 4 | Posting-Rhythmus (isDue) | ⏳ offen |
| 5 | "Mit KI verbessern" | ⏳ offen |
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

---
*(wird fortgesetzt)*
