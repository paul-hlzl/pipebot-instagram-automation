# Panel v3 – Fortschrittsbericht

Autonome Sitzung gestartet: 2026-09-11 09:00 UTC (Ausgangspunkt: `origin/main` @ `54712b3`).
Sicherheits-Tag: `pre-panel-v3`. Arbeitsbranch: `panel-v3`.

Dieser Bericht wird nach JEDER Aufgabe aktualisiert. Bei Abbruch der Sitzung: hier lesen,
um zu sehen, wo der Stand ist.

## Status je Aufgabe

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | Sicherheitsnetz (Tag/Branch/Staging/Testskript) | ✅ erledigt |
| 2 | Probekonto (Trial) | ⏳ offen |
| 3 | Admin-Dashboard | ⏳ offen |
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

---
*(wird fortgesetzt)*
