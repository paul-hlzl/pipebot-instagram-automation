# Panel v5 Report - Vorausplanung & Vorschau

Laufender Report für die autonome Arbeitssitzung "Kunden-Panel v5". Wird während der Sitzung
fortlaufend aktualisiert (erledigt / Entscheidungen / offene Punkte).

Sicherheitsnetz: Tag `pre-panel-v5` auf dem Stand vor dieser Sitzung, Branch `panel-v5`.

## Status je Aufgabe

- [x] Aufgabe 1 - Sicherheitsnetz (Tag + Branch)
- [x] Aufgabe 2 - "KI-Ideen"-Button beim "Jetzt posten"-Thema-Feld (Commit c3c26cd)
- [x] Aufgabe 3 - Datenmodell `planned_posts` (Commit c2b6b4c)
- [x] Aufgabe 4 - Serverseitige tägliche Vorausplanung (Commit 6d521bf)
- [x] Aufgabe 5 - Panel-Oberfläche "Vorschau" (Commit 699ca65)
- [x] Aufgabe 6 - K1-K9-Routinen-Ergänzung (Server: Commit 2bb304b; Text: docs/ROUTINE_TEIL1_V5.md)
- [x] Aufgabe 7 - Abschluss und Deploy (Merge-Commit a1a9f4b, Produktion neu gestartet 2026-09-11 18:02 UTC)

## Deploy-Status

**Deployed.** Branch `panel-v5` in `main` gemerged (`--no-ff`, Commit `a1a9f4b`), gepusht,
Produktion (`pm2 restart instagram-mcp`) um ca. 2026-09-11 18:02 UTC neu gestartet - außerhalb
des 14:30-15:45-UTC-Blackouts, kurz nach der vollen Stunde (Kunden-Loop-Routine feuert um
:00 und ist bei der aktuellen Kundenzahl in Sekunden fertig).

Vor dem Neustart: Backup `backups/panel-pre-v5-deploy-2026-09-11T18-01-01-977Z.db` (via
better-sqlite3 `.backup()`).

Nach dem Neustart geprüft (alles grün):
- `/health` -> 200
- `/mcp` ohne Bearer-Token -> 401 (unverändert)
- CSP-Header enthält weiterhin die R2-Medien-Domain (aus der letzten Sitzung)
- `planned_posts`/`planning_errors`-Tabellen existieren (additive Migration erfolgreich)
- `tools/list` per echtem MCP-Handshake: 22 Tools (20 vorher + `get_planned_post` +
  `mark_planned_post_published`), alle bisherigen Namen weiterhin vorhanden
- `list_customers` per echtem MCP-Aufruf: bestehende Felder (`instagramDueNow`, `igFeedEnabled`,
  `approvalMode`, `trialExpired`, ...) korrekt und unverändert für beide echten Kunden
- `get_planned_post` gegen Produktion (noch keine Daten dort) liefert sauber `null`, kein Fehler
- Admin-Login -> 200

Rollback-Bereitschaft: Tag `pre-panel-v5` (Code-Stand vor der Sitzung) und die DB-Backups
(`backups/panel-pre-v5-deploy-*.db` sowie das ältere `panel-pre-approval-badge-fix-*.db` von der
vorherigen Sitzung) sind vorhanden. Ein Rollback wäre: `git checkout pre-panel-v5 -- .` (oder
`git revert` des Merge-Commits) + `npm run build` + DB-Datei aus dem Backup zurückkopieren + `pm2
restart instagram-mcp`.

## Entscheidungen

**Aufgabe 4 - Refactoring vor der eigentlichen Aufgabe:** `resolveInstagramCredentials`,
`resolveLinkedInCredentials`, `resolveImageBranding` und die komplette
`get_customer_style_samples`-Logik (Cache-Check, Credential-Auflösung, Graph-API-Aufruf,
Cache-Schreiben) waren private Helper in `src/index.ts`, nur von MCP-Tools aufrufbar. Nach
`src/panel/credentials.ts` verschoben und dort exportiert (`resolveInstagramCredentials`,
`resolveLinkedInCredentials`, `resolveImageBranding`, `getStyleSamples`), `index.ts` importiert
sie jetzt von dort statt eigener Kopien zu halten. Grund: planning.ts (serverseitige
Vorausplanung) braucht exakt dieselbe Logik, ohne über ein MCP-Tool zu gehen - eine zweite,
leicht abweichende Kopie hätte über die Zeit auseinanderdriften können. Reines Verschieben,
keine Verhaltensänderung, kein MCP-Tool-Signatur betroffen (tsc + `npm run test:panel`, 73/73,
danach grün).

**Content-Säulen-Rotation über mehrere Tage:** `pickPillarForToday()` vermeidet nur die Säule
des letzten ECHTEN Posts (`posts`-Tabelle) - bei einer frisch generierten 7-Tage-Woche ändert
sich diese Tabelle während des Laufs nicht, jeder Tag hätte dieselbe (oder rein zufällige, nicht
rotierende) Säule bekommen. Kern-Logik aus `pickPillarForToday` in eine neue Funktion
`pickWeightedPillar(pillars, avoidTitle)` extrahiert; `planning.ts` verfolgt pro Kunde lokal
innerhalb eines Laufs, welche Säule zuletzt vergeben wurde, und vermeidet genau die beim
nächsten Tag/Kanal. `pickPillarForToday`s eigenes Verhalten/Signatur unverändert.

**Tagesbezogene Fälligkeits-Prüfung:** `isDueForChannel()`/`isDue()` prüfen "ist es JETZT fällig"
(inkl. Uhrzeit und "heute schon gepostet"-Check gegen die `posts`-Tabelle) - für die
Vorausplanung wird nur gebraucht "wäre an DIESEM Kalendertag überhaupt fällig" (Wochentag +
Pause-Bereich, ohne Uhrzeit/Bereits-gepostet). Neue Funktion `isPostingDayForChannel()` in
`schedule.ts` ergänzt (rein additiv, bestehende Funktionen unverändert).

**Harte Vorgaben (bannedWords/requiredElements) werden zusätzlich zur Prompt-Anweisung
serverseitig re-verifiziert** (assertNoBannedWords/assertRequiredElements, ein Retry mit
Fehler-Feedback im Prompt, dann Abbruch für diesen einen Beitrag) - eine reine Prompt-Anweisung
ist keine Garantie, exakt dieselbe Begründung wie überall sonst im Code. Für `ig_story` wird
dabei bewusst NUR die Headline geprüft (nicht die Caption) - spiegelt den Fix aus der letzten
Sitzung (`save_pending_approval`), weil `publish_generated_story` auch nur die Headline prüft
und Instagram Stories kein sichtbares Caption-Feld haben.

**Fehler-Log als eigene Tabelle** (`planning_errors`, ohne Foreign Key auf `customer_id` - ein
Log-Eintrag soll eine spätere Kontolöschung überleben) statt einer Datei - passt zum Rest des
Codes (alles andere ist auch DB-basiert), leicht abfragbar für einen künftigen Admin-Blick.

**Vorausplanungs-Zeitplan 03:00 UTC**, fest an eine UTC-Uhrzeit verankert (nicht wie
`startTokenRefreshSchedule` ein einfaches `setInterval` ab Prozessstart) - sonst würde ein
Neustart zu einer zufälligen Tageszeit den Lauf dauerhaft auf diese Zeit verschieben. 03:00 UTC
liegt weit außerhalb des 14:30-15:45-UTC-Blackouts und trifft keine volle Stunde (Kunden-Loop).

**Aufgabe 5 - `scheduled_for` in Vienna- statt UTC-Kalendertagen:** Die Aufgabenstellung nennt
"UTC-Datum als YYYY-MM-DD". Die gesamte bestehende Zeitplanungs-Logik (`schedule.ts`: Wochentage,
Pause-Bereiche, `isDue`/`isDueForChannel`) arbeitet aber durchgängig in Europe/Vienna-Kalendertagen
- ein UTC-Datum hätte nahe der Mitternachtsgrenze gelegentlich vom Vienna-Tag abgewichen (z. B.
1 Uhr UTC = 2 oder 3 Uhr Vienna, schon der nächste Kalendertag), was zu falschen
Pause-Bereichs-Treffern oder einem scheinbar falschen Wochentag geführt hätte. Bewusst abgewichen:
`scheduled_for` ist ein Vienna-Kalendertag (`viennaDateStr()`), konsistent mit `pauseFrom`/
`pauseUntil` und den Wochentag-Feldern.

## Kosten-Hinweis (Aufgabe im Abschlussbericht gefordert)

Pro fälligem Kunde/Kanal/Tag verursacht die Vorausplanung 1 Anthropic-Aufruf (Text, plus im
Ausnahmefall 1 Wiederholung bei einem verletzten Pflicht-Element/verbotenen Wort) und 1
fal.ai-Bildaufruf - dieselbe Größenordnung, die die stündliche Routine heute pro Beitrag ohnehin
verursacht. Der Unterschied: die Vorausplanung generiert bis zu 7 Tage im Voraus, nicht erst zum
Fälligkeitszeitpunkt.

- **Erste Nacht nach dem Deploy (Nachhol-Effekt):** bis zu (Anzahl aktiver Kunden × aktivierte
  Kanäle × 7 Tage) Aufrufe auf einmal - bei den aktuell 2 aktiven Kunden mit je bis zu 3 Kanälen
  im Extremfall (beide täglich, alle Kanäle) bis zu 42 Anthropic- + 42 fal.ai-Aufrufe in einer
  Nacht.
- **Danach im Normalbetrieb (steady state):** nur der jeweils neu hinzukommende 7. Tag pro
  Kunde/Kanal und Nacht - bei den aktuellen 2 Kunden also bis zu ~6 Anthropic- + ~6 fal.ai-Aufrufe
  pro Nacht, linear mit der Kundenzahl wachsend.
- **Das ersetzt größtenteils bestehende Kosten, ist nicht rein zusätzlich:** dank K3b (siehe
  docs/ROUTINE_TEIL1_V5.md, sobald Paul sie einträgt) generiert die stündliche Routine für einen
  bereits vorbereiteten Beitrag NICHT mehr spontan neu - die Generierung verschiebt sich von
  "zum Fälligkeitszeitpunkt" auf "in der Nacht davor", statt zusätzlich zu passieren.
- **Echte Mehrkosten entstehen** (a) wenn ein Kunde einen vorbereiteten Beitrag im Panel
  überspringt (die Generierung war dann "umsonst", da nie veröffentlicht) und (b) durch "Mit
  dieser Farbe neu erstellen" (pro Klick 1 fal.ai-Aufruf, hart gedeckelt auf 3 pro Beitrag).
- approvalMode-Kunden: siehe bekannte Einschränkung oben - ein noch nicht freigegebener
  vorbereiteter Beitrag wird bei Fälligkeit trotzdem nochmal komplett neu generiert, dort ist die
  Vorausplanung also tatsächlich zusätzliche Kosten, keine Verschiebung.

## Bekannte Risiken / offene Punkte

- Aufgabe 4 wurde mit einem echten, aber bewusst auf 1 Kunde/1 Kanal/1 Tag eingeschränkten Lauf
  gegen eine Staging-DB-Kopie verifiziert (Kostenkontrolle) - Bild und Text kamen korrekt an,
  Wiederholungslauf hat korrekt übersprungen (idempotent). Ein Lauf mit vielen Kunden/allen
  Kanälen/vollen 7 Tagen wurde NICHT ausprobiert (Kosten) - das reale Anlaufverhalten (Laufzeit,
  Fehlerquote bei echten, unterschiedlich konfigurierten Kunden) zeigt sich erst im echten Betrieb
  um 03:00 UTC. `planning_errors` sammelt Fehler, ohne den Lauf abzubrechen.
- **Aufgabe 5 (Vorschau-UI) wurde NICHT in einem echten Browser getestet** - in dieser Sitzung
  stand kein Browser-Werkzeug zur Verfügung. Backend (alle Endpunkte inkl. Validierung,
  Kostendeckel, Freigabe-Gate) ist per Black-Box-HTTP-Tests (11 neue, 84/84 gesamt) verifiziert;
  reine JS-Syntax wurde geprüft. Was NICHT geprüft wurde: tatsächliches Rendering, CSS-Layout
  (insbesondere die Karten auf Mobilgeräten), Klick-Interaktionen im echten DOM, das
  Zusammenspiel von `previewSelectedDate` mit `renderPreview()` bei schnellem Tage-Wechsel. Bitte
  vor dem ersten echten Kundenzugriff einmal manuell durchklicken.

**Aufgabe 6 - "K0" umbenannt/umplatziert zu "K3b":** Die Aufgabenstellung wollte den neuen Check
als "Schritt K0, vor K1". Das würde die Kern-Anforderung selbst brechen: der Check braucht die
"ist dieser Kunde/Kanal heute fällig"-Information aus K3, und der wichtigste Fall
(status='rejected' → nicht spontan neu generieren) funktioniert nur, wenn der Check an genau der
Stelle sitzt, wo sonst die spontane Generierung ausgelöst würde - sonst würde K3 hinterher, ohne
von der Entscheidung zu wissen, trotzdem spontan generieren. Als "K3b" direkt in K3s Schleife
platziert, vor K4. Vollständige Begründung in docs/ROUTINE_TEIL1_V5.md.

**Aufgabe 6 - approvalMode-Kunden nutzen einen noch nicht freigegebenen vorbereiteten Beitrag
NICHT wieder:** Exakt wie in der Aufgabenstellung verlangt ("unverändert zum jetzigen
Verhalten") - K4-K8 generiert für diese Kunden weiterhin komplett neu, bis der Kunde im Panel
freigibt. Als bekannte Einschränkung dokumentiert (siehe unten), nicht stillschweigend anders
gelöst.

## Was Paul manuell tun muss

1. **Die K1-K9-Routine bei claude.ai ergänzen** - genaue Anleitung inkl. des einzufügenden Texts
   in `docs/ROUTINE_TEIL1_V5.md` (nicht hier im Chat, siehe Regel 11). Kurzfassung: ein neuer
   Absatz "K3b" wird zwischen dem Ende von K3 und dem Anfang von K4 eingefügt. Ohne diese
   Ergänzung läuft die Routine unverändert weiter (Rückwärtskompatibilität ist gegeben - siehe
   Regel 6), die Vorausplanung/Vorschau würde dann aber nie tatsächlich genutzt, nur angezeigt.
2. Die tägliche Vorausplanung läuft automatisch (03:00 UTC), sobald die Produktion neu gestartet
   ist - keine manuelle Aktion nötig, aber der erste echte Lauf mit allen Kunden/Kanälen/7 Tagen
   war in dieser Sitzung nicht beobachtbar (siehe Risiken). Ein Blick in `planning_errors` (DB-
   Tabelle) nach dem ersten Lauf ist sinnvoll.
3. Die "Vorschau"-Oberfläche im Panel bitte einmal selbst im Browser durchklicken (kein
   Browser-Werkzeug in dieser Sitzung verfügbar, siehe Risiken).
