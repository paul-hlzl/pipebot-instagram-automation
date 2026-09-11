# Panel v5 Report - Vorausplanung & Vorschau

Laufender Report für die autonome Arbeitssitzung "Kunden-Panel v5". Wird während der Sitzung
fortlaufend aktualisiert (erledigt / Entscheidungen / offene Punkte).

Sicherheitsnetz: Tag `pre-panel-v5` auf dem Stand vor dieser Sitzung, Branch `panel-v5`.

## Status je Aufgabe

- [x] Aufgabe 1 - Sicherheitsnetz (Tag + Branch)
- [x] Aufgabe 2 - "KI-Ideen"-Button beim "Jetzt posten"-Thema-Feld (Commit c3c26cd)
- [x] Aufgabe 3 - Datenmodell `planned_posts` (Commit c2b6b4c)
- [x] Aufgabe 4 - Serverseitige tägliche Vorausplanung
- [ ] Aufgabe 5 - Panel-Oberfläche "Vorschau"
- [ ] Aufgabe 6 - K1-K9-Routinen-Ergänzung (docs/ROUTINE_TEIL1_V5.md)
- [ ] Aufgabe 7 - Abschluss und Deploy

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

## Bekannte Risiken / offene Punkte

- Aufgabe 4 wurde mit einem echten, aber bewusst auf 1 Kunde/1 Kanal/1 Tag eingeschränkten Lauf
  gegen eine Staging-DB-Kopie verifiziert (Kostenkontrolle) - Bild und Text kamen korrekt an,
  Wiederholungslauf hat korrekt übersprungen (idempotent). Ein Lauf mit vielen Kunden/allen
  Kanälen/vollen 7 Tagen wurde NICHT ausprobiert (Kosten) - das reale Anlaufverhalten (Laufzeit,
  Fehlerquote bei echten, unterschiedlich konfigurierten Kunden) zeigt sich erst im echten Betrieb
  um 03:00 UTC. `planning_errors` sammelt Fehler, ohne den Lauf abzubrechen.

## Was Paul manuell tun muss

(wird nach Aufgabe 6 befüllt: die Ergänzung für die K1-K9-Routine)
