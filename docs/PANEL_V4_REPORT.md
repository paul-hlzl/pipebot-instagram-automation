# Panel v4 – Fortschrittsbericht (Maximale Personalisierung)

Autonome Sitzung gestartet: 2026-09-11 (Ausgangspunkt: `origin/main` @ `1f99a40`, inkl. dem
zwischenzeitlich nachgetragenen `ANTHROPIC_API_KEY`).
Sicherheits-Tag: `pre-panel-v4`. Arbeitsbranch: `panel-v4`.

Dieser Bericht wird nach JEDER Aufgabe aktualisiert.

## Status je Aufgabe

| # | Aufgabe | Status |
|---|---------|--------|
| 1 | Sicherheitsnetz | ✅ erledigt |
| 2 | Content-Säulen | ✅ erledigt |
| 3 | Wortverbote (hart) | ✅ erledigt |
| 4 | Pflicht-Elemente | ✅ erledigt |
| 5 | Granulare Zeitplanung | ⏳ offen |
| 6 | "Jetzt posten"-Button | ⏳ offen |
| 7 | Freigabe-Modus | ⏳ offen |
| 8 | Mehrere Farbthemen | ⏳ offen |
| 9 | Eigenes Logo | ⏳ offen |
| 10 | Abschluss & Deploy | ⏳ offen |

## Aufgabe 1 – Sicherheitsnetz ✅

- `git tag pre-panel-v4` gesetzt und gepusht (Rollback-Punkt: `origin/main` @ `1f99a40`).
- Branch `panel-v4` erstellt, auf `origin/panel-v4` getrackt.
- Staging-Instanz: pm2-Prozess `instagram-mcp-staging`, Port `3100`, eigene DB
  `data/panel-staging.db` (Online-Backup der Produktions-DB), nicht über Nginx erreichbar.
- `npm run test:panel` (aus v3 übernommen) läuft gegen die frische Staging-Instanz:
  **40 passed, 0 failed** (ein Test weniger als am Ende von v3, weil `ANTHROPIC_API_KEY`
  inzwischen gesetzt ist - der "kein Key"-503-Test wird dadurch übersprungen statt gezählt,
  keine Regression).

**Für Paul:** nichts zu tun.

## Aufgabe 2 – Content-Säulen statt einem Textfeld ✅

**Erledigt:**
- Neue Tabelle `content_pillars` (id, customer_id, title, description, weight 1-5, active,
  Zeitstempel), additive Migration. `posts` bekommt zusätzlich `pillar_title` (nullable).
- `credentials.ts`:
  - `listContentPillars(customerId)` - aktive Säulen, älteste zuerst.
  - `setContentPillars(customerId, pillars[])` - **Replace-all** (Panel bearbeitet die ganze
    Liste als ein Block, einfacher und robuster als ein Diff). Max. 6, Titel Pflicht (leere
    verworfen), Gewicht auf 1-5 geklemmt.
  - `pickPillarForToday(customerId)` - gewichtete Zufallsauswahl, die die zuletzt laut
    `posts.pillar_title` genutzte Säule ausschließt (bei nur 1 aktiver Säule wird die
    Ausnahme ignoriert, sonst gäbe es nie einen Treffer). Mit einem echten Testkunden gegen
    Staging verifiziert: 5 Picks vor einem Post streuen gewichtet über alle 3 Säulen, 5 Picks
    direkt nach einem geloggten "Tipps"-Post treffen **nie wieder** "Tipps".
- `list_customers`/`GET /api/me` liefern pro Kunde `contentPillars` (volle Liste) UND
  `suggestedPillar` (der aktuelle `pickPillarForToday`-Treffer, oder `null`).
- Publish-Tools (`publish_generated_post`, `generate_and_publish_post`,
  `publish_generated_story`, `generate_and_publish_story`, `publish_linkedin_post`,
  `publish_linkedin_image_post`) haben ein neues optionales `pillar_title`-Argument, das
  1:1 in `logPost()` landet - damit `pickPillarForToday` beim nächsten Aufruf weiß, was
  zuletzt dran war.
- Panel: neuer Bereich "Content-Säulen" unter dem "Worum soll es gehen?"-Feld - Zeilen mit
  Titel/Beschreibung/Gewicht, Hinzufügen/Entfernen, max. 6. Bleibt leer = optional, dann wie
  bisher nur `about`. Arbeitet mit einem lokalen Entwurfs-Array (`S.pillarsDraft`) und
  gezieltem Neuzeichnen nur dieses Abschnitts, damit Hinzufügen/Entfernen keine anderen
  ungespeicherten Formularfelder zurücksetzt (gleiches Muster wie der KI-Vorschlag aus v3).
- `npm run test:panel` erweitert: Signup mit 3 Säulen (eine mit leerem Titel wird korrekt
  verworfen), PATCH ersetzt die Liste komplett. **44 passed, 0 failed.**

**Für Paul:** nichts zu tun. Wie die Routine `suggestedPillar`/`pillar_title` nutzen soll:
siehe Routine-Prompt-Text weiter unten bzw. im Abschlussbericht.

## Aufgabe 3 – Echte Wortverbote (hart im Code) ✅

**Erledigt:**
- Neue Spalte `banned_words` (TEXT, kommagetrennt) auf `customers`, additiv. Bewusst getrennt
  von `avoid_topics` (bleibt die weiche KI-Anweisung).
- `credentials.ts`: `containsBannedWord(text, customerId)` (case-insensitive Teilstring-Suche,
  gibt das gefundene Wort zurück oder `null`) und `assertNoBannedWords(customerId, ...texte)`
  als Durchsetzungs-Helfer (wirft mit klarer Fehlermeldung, no-op ohne `customer_id` - eigener
  Account bleibt unverändert).
- **In allen 6 Publish-fähigen Tools** durchgesetzt (nicht nur den 3 explizit genannten) -
  auch `generate_and_publish_post`/`_story`, da diese ebenso direkt veröffentlichen und sonst
  eine Lücke in der "harten" Durchsetzung gewesen wären:
  - Feed-Tools: prüfen Headline UND Caption.
  - Story-Tools: prüfen nur die Headline (Instagram Stories haben keine Caption).
  - LinkedIn-Tools: prüfen den Beitragstext.
- Mit einem echten Testkunden verifiziert: Wort im Text → Fehler mit dem exakten Wort in der
  Meldung; sauberer Text → kein Fehler; ohne `customer_id` → nie geprüft (Rückwärtskompatibel).
- Panel: neues Feld "Wörter, die NIE vorkommen dürfen (optional, kommagetrennt)", mit
  Hinweistext "Wird automatisch blockiert, nicht nur vermieden" - bewusst optisch/inhaltlich
  von "Was sollen wir vermeiden?" (jetzt mit Hinweis "Eine Bitte an die KI - wird nicht hart
  erzwungen") abgesetzt.
- `list_customers` liefert `bannedWords` pro Kunde; Tool-Beschreibung weist die Routine an,
  Wörter vorher selbst zu meiden UND bei einem Fehler die Caption umzuformulieren und einmal
  erneut zu versuchen statt aufzugeben (kein automatisches Retry im Server - das macht
  bewusst die Routine, siehe Routine-Prompt-Text in Aufgabe 11).
- `npm run test:panel` erweitert (Signup speichert `bannedWords` korrekt). **45 passed, 0
  failed.**

**Für Paul:** nichts zu tun.

## Aufgabe 4 – Pflicht-Elemente ✅

**Erledigt:**
- Neue Spalte `required_elements` (TEXT, kommagetrennt), additiv, gleiches Muster wie
  `banned_words`.
- `assertRequiredElements(customerId, ...texte)` in `credentials.ts` - anders als bei den
  Wortverboten werden hier **alle übergebenen Texte zu einem String zusammengefügt**, bevor
  geprüft wird: ein Pflicht-Hashtag darf z. B. in der Headline ODER der Caption stehen, muss
  nicht in beiden vorkommen. Mit einem echten Testkunden verifiziert: fehlen beide Pflicht-
  Elemente → Fehler mit dem ersten fehlenden genannt; sind beide über Headline+Caption verteilt
  vorhanden → kein Fehler.
- In denselben 6 Publish-Tools durchgesetzt wie die Wortverbote aus Aufgabe 3 (direkt danach
  aufgerufen).
- Panel: neues Feld "Muss in jedem Beitrag vorkommen (optional, kommagetrennt)" direkt unter
  dem Wortverbote-Feld.
- `list_customers` liefert `requiredElements`; Tool-Beschreibung weist die Routine an, Pflicht-
  Elemente selbst einzubauen und bei einem entsprechenden Fehler einmal mit Ergänzung erneut
  zu versuchen.
- `npm run test:panel` erweitert. **46 passed, 0 failed.**

**Für Paul:** nichts zu tun.

---
*(wird fortgesetzt)*
