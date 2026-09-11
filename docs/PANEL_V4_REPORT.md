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
| 5 | Granulare Zeitplanung | ✅ Code fertig, ⚠️ Weekday-Picker nicht im Browser getestet |
| 6 | "Jetzt posten"-Button | ✅ Code fertig, ⚠️ Panel-Button nicht im Browser getestet |
| 7 | Freigabe-Modus | ✅ Code fertig, ⚠️ Panel-Teil nicht im Browser getestet |
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

## Aufgabe 5 – Granulare Zeitplanung ✅ Code / ⚠️ Browser-Test steht aus

**Erledigt:**
- Neue Spalten `active_weekdays`, `instagram_weekdays`, `linkedin_weekdays` (alle TEXT,
  "1,3,5"-Format, 1=Montag..7=Sonntag), `pause_from`/`pause_until` (TEXT, ISO-Datum). Additiv,
  alle nullable/opt-in.
- `schedule.ts` überarbeitet - **bewusst zwei getrennte API-Ebenen**, um einen echten Bug zu
  vermeiden (siehe unten):
  - `isDue`/`nextPostAt` (unverändertes v3-Signatur, "pro Gesamtkunde"): nutzen weiterhin
    `activeWeekdays` (Fallback `frequency`) und einen kanal-**übergreifenden** "heute schon
    gepostet"-Check - Verhalten 1:1 identisch zu v3, jetzt zusätzlich durch `pauseFrom`/
    `pauseUntil` gesperrt.
  - Neue `isDueForChannel`/`nextPostAtForChannel`: nutzen `instagramWeekdays`/
    `linkedinWeekdays` (Fallback `activeWeekdays`/`frequency`) und einen kanal-**spezifischen**
    "heute schon gepostet"-Check.
  - **Bug beim Entwerfen gefunden und vermieden:** Ein naiver kombinierter `dueNow` als
    "Instagram ODER LinkedIn fällig" hätte für Kunden mit nur einem aktiven Kanal dazu geführt,
    dass `dueNow` **dauerhaft `true`** bleibt (der nie genutzte zweite Kanal hat ja nie einen
    Post und sieht deshalb ewig "fällig" aus) - eine alte, kanal-unwissende Routine hätte dann
    an einem bereits erledigten Tag ein zweites Mal gepostet. Deshalb bleibt `dueNow` bewusst
    bei der alten, kanalübergreifenden Logik.
  - Mit echten Szenarien gegen Staging verifiziert: reine Rückwärtskompatibilität (kein
    v4-Feld gesetzt → identisch zu v3), Pause-Zeitraum blockt `isDue` und verschiebt
    `nextPostAt` korrekt auf danach, unterschiedliche Wochentage pro Kanal wirken unabhängig,
    und ein Post auf Instagram markiert **nicht** fälschlich auch LinkedIn als erledigt
    (während der kombinierte `dueNow` korrekt auf `false` fällt, wie bisher).
- `list_customers`/`GET /api/me` liefern weiterhin `dueNow`/`nextPostAt` (Gesamtkunde,
  unverändert) und zusätzlich `instagramDueNow`/`linkedinDueNow`, plus die rohen
  Zeitplan-Felder zum Bearbeiten im Formular.
- Panel: Die 3 Frequenz-Radiobuttons sind **ersetzt** durch zwei 7-Tage-Picker ("Mo"-"So",
  einzeln an/aus), einer für Instagram, einer für LinkedIn - beim ersten Öffnen aus der alten
  `frequency`/Radiobutton-Logik vorbefüllt (z. B. "werktags" → Mo-Fr angehakt), danach ist nur
  noch der Picker sichtbar, nie beides gleichzeitig. Zwei Datumsfelder "Pause/Urlaub von/bis".
  Beim Speichern wird zusätzlich weiterhin ein `frequency`-Wert mitgeschickt (aus dem
  Instagram-Picker zurück-klassifiziert: alle 7 Tage → "taeglich", Mo-Fr → "werktags", Mo/Mi/Fr
  → "3x-woche", sonst "werktags") - rein für Altsysteme, die nur `frequency` kennen.
- `npm run test:panel` erweitert (Zeitplan-Felder-Roundtrip). **Beim Erweitern einen echten
  Bug im Testskript selbst gefunden und behoben:** die neuen Content-Säulen- und
  Zeitplan-Tests legten ursprünglich jeweils einen eigenen Kunden per Signup an - zusammen mit
  den bestehenden Signup-Tests kam das auf 6 Signup-Versuche pro Testlauf, mehr als das
  5/Stunde-Rate-Limit erlaubt, wodurch der spätere Kontolöschen-Test mit 401 statt 400/200
  fehlschlug. Fix: die neuen Tests nutzen jetzt `PATCH /api/me` auf den schon vorhandenen
  Test-Kunden statt eigener Signups (spart Rate-Limit-Budget, realistischer ohnehin - ein
  Kunde bearbeitet diese Felder nach dem Signup). **51 passed, 0 failed.**

**⚠️ Gleiche Einschränkung wie die bisherigen v3-UI-Aufgaben:** kein echter Browser in dieser
Sitzung verfügbar. Die Wochentage-Picker-Logik (Vorbefüllung aus `frequency`, Auslesen beim
Speichern, `classifyFrequency`-Rückübersetzung) wurde per Code-Durchsicht, JS-Syntax-Check und
HTTP-Ebenen-Tests geprüft, aber nie tatsächlich angeklickt.

**Für Paul:** nichts zu tun, außer dem Browser-Check am Ende der Sitzung.

## Aufgabe 6 – "Jetzt posten"-Button ✅ Code / ⚠️ Browser-Test steht aus

**Erledigt:**
- Neue Tabelle `post_requests` (id, customer_id, topic, channel, status, Zeitstempel), additiv.
- `POST /panel/api/post-now` (Kunden-Session): legt eine `pending`-Anfrage an. Bewusst **keine**
  direkte KI-/MCP-Aktion vom Server aus - reine Warteschlange, wie gefordert (dieser Server hat
  in diesem Kontext keinen Anthropic-Zugriff). Rate-Limits durchgesetzt: max. 1 gleichzeitig
  offene Anfrage, max. 3 pro Tag - mit einem echten Testkunden verifiziert (erste Anfrage → 200,
  zweite sofort danach → 429 "schon offen").
- Zwei neue MCP-Tools:
  - `list_post_requests` - alle offenen Anfragen über alle Kunden, älteste zuerst. Tool-
    Beschreibung weist die Routine an, diese **vor** der regulären `list_customers`-Schleife
    abzuarbeiten.
  - `mark_post_request_done(request_id)` - Statuswechsel auf `done`. Mit einem echten
    Roundtrip gegen Staging verifiziert (anlegen → über `list_post_requests` sichtbar → über
    `mark_post_request_done` erledigt → Status in der DB tatsächlich `done`).
- `GET /api/me` liefert `lastPostRequest` (letzte Anfrage jedes Status) fürs Dashboard.
- Panel: neuer Dashboard-Bereich "Jetzt posten" - optionales Themenfeld + Button, Status der
  letzten Anfrage (ausstehend/erledigt) als Banner, Feld+Button gesperrt solange eine Anfrage
  offen ist (serverseitig ohnehin durchgesetzt, hier nur UX).
- `npm run test:panel` erweitert (Anfrage anlegen, zweite blockiert, Status in `/api/me`,
  401 ohne Login). **55 passed, 0 failed.**

**⚠️ Gleiche Einschränkung wie die übrigen v4-UI-Arbeiten:** der neue Dashboard-Bereich wurde
nicht in einem echten Browser angeklickt, nur die API dahinter (siehe oben).

**Für Paul:** nichts zu tun, außer dem Browser-Check am Ende der Sitzung.

---

## Routine-Prompt-Text - Entwurf (wird nach jeder weiteren Aufgabe ergänzt, komplette Fassung in Aufgabe 11)

```
Du bist die automatische Posting-Routine von Pipeline. Du läufst stündlich. Bei jedem Lauf,
IN DIESER REIHENFOLGE:

1. Rufe `list_approved_pending_posts` auf. Für jeden Eintrag: veröffentliche ihn mit dem
   passenden Publish-Tool (`publish_generated_post` für ig_feed-Provider "instagram" ohne
   weitere Kennzeichnung, `publish_generated_story` falls als Story markiert, LinkedIn-Tools
   für Provider "linkedin"), unter Verwendung von `imageUrl`/`caption`/`headline`, mit
   `customerId` als `customer_id` und `pillarTitle` als `pillar_title`. Nach Erfolg:
   `mark_pending_approval_published` mit der `id` aufrufen.
2. Rufe `list_post_requests` auf und arbeite JEDE offene Anfrage ab, bevor du mit der
   regulären Kundenliste weitermachst - ein Kunde, der explizit "jetzt posten" gedrückt hat,
   soll nicht hinter der normalen Zeitplanung warten. Nutze `topic` als Thema (fällt es leer
   aus: nutze das übliche Briefing/die Content-Säulen des Kunden). Prüfe für diesen Kunden
   trotzdem `approvalMode` (Schritt 5) - eine "Jetzt posten"-Anfrage überspringt NICHT die
   Freigabe. Nach erfolgreicher Veröffentlichung (oder erfolgreichem Einreichen zur Freigabe):
   `mark_post_request_done` mit der `id` aufrufen - nie doppelt bearbeiten.
3. Rufe `list_customers` auf. Überspringe einen Kunden, wenn `trialExpired` true ist ODER
   `dueNow` false ist.
4. Rufe für jeden fälligen Kunden `get_customer_style_samples` auf, um Tonfall/Hashtag-Stil
   zu übernehmen, sofern vorhanden.
5. Prüfe `contentPillars`/`suggestedPillar`: ist `suggestedPillar` gesetzt, formuliere das
   Thema danach und gib den exakten `title` als `pillar_title` mit. Sonst nutze `about`.
6. Prüfe `bannedWords`/`requiredElements`: baue verbotene Wörter gar nicht erst ein, Pflicht-
   Elemente immer ein. Schlägt ein Tool trotzdem mit einer entsprechenden Fehlermeldung fehl,
   formuliere die Caption angepasst um und versuche es genau einmal erneut - gib nicht nach
   dem ersten Fehlversuch auf.
7. **Prüfe `approvalMode` für diesen Kunden, BEVOR du veröffentlichst:**
   - `approvalMode: false` (Standard) → wie bisher: `publish_generated_post`/
     `publish_generated_story`/LinkedIn-Tools direkt aufrufen.
   - `approvalMode: true` → NIE direkt veröffentlichen. Stattdessen `save_pending_approval`
     mit `customer_id`, `channel` (ig_feed/ig_story/linkedin), `headline`, `caption`,
     `image_url`, `pillar_title` aufrufen. Der Kunde entscheidet im Panel selbst, ob und wann
     es veröffentlicht wird - das übernimmt erst ein SPÄTERER Lauf über Schritt 1.
8. Veröffentliche (bzw. reiche zur Freigabe ein) entsprechend `igFeedEnabled`/
   `igStoryEnabled`/`linkedinEnabled`.
```

## Aufgabe 7 – Freigabe-Modus ✅ Code / ⚠️ Panel-Teil-Browser-Test steht aus

**Erledigt:**
- Neue Spalte `approval_mode` (0/1, Default 0), neue Tabelle `pending_approvals` (id,
  customer_id, provider, headline, caption, image_url, pillar_title, status, Zeitstempel).
  Additiv.
- **Bewusste Design-Entscheidung, genau wie im Aufgabentext vorgegeben:** kein serverseitiges
  Abfangen von `generate_and_publish_post` & Co. - die Routine selbst entscheidet anhand von
  `approvalMode` aus `list_customers`, ob sie ein normales Publish-Tool oder das neue
  `save_pending_approval` aufruft. Das hält die bestehenden Tools unverändert (Rückwärts-
  kompatibilität) und vermeidet überraschendes verstecktes Verhalten.
- Drei neue MCP-Tools:
  - `save_pending_approval` (customer_id, channel, headline, caption, image_url, pillar_title) -
    prüft **dieselben** Banned-Words-/Pflicht-Elemente-Regeln wie die echten Publish-Tools
    (schlägt fehl, bevor der Kunde etwas zur Freigabe sieht, das ohnehin nie veröffentlicht
    werden könnte), schreibt dann nach `pending_approvals` mit Status `pending`.
  - `list_approved_pending_posts` - alle vom Kunden bereits freigegebenen (`status='approved'`)
    Beiträge über alle Kunden, älteste zuerst.
  - `mark_pending_approval_published` - Statuswechsel auf `published`, verhindert erneutes
    Veröffentlichen beim nächsten Lauf.
- Panel-Endpunkte: `GET /api/approvals` (eigene `pending`, mit Session), `POST
  /api/approvals/:id/approve` und `/:id/reject` - **veröffentlichen selbst nichts**, setzen nur
  den Status (scoped auf den eigenen Kunden, ein Kunde kann nie die Anfrage eines anderen
  anfassen).
- Panel: neuer Umschalter "Beiträge vor Veröffentlichung freigeben" in den Kanal-Einstellungen;
  neuer Dashboard-Bereich "Warten auf Ihre Freigabe" (nur sichtbar, wenn `approvalMode` an ist)
  mit Bild-Vorschau, Text, Freigeben-/Ablehnen-Buttons.
- **Kompletter Ablauf einmal end-to-end gegen Staging durchgespielt** (nicht nur einzelne
  Teile): `save_pending_approval` (mit `approvalMode:true`-Testkunde) → erscheint unter `GET
  /api/approvals` → `POST .../approve` → verschwindet aus `/api/approvals` → erscheint unter
  `list_approved_pending_posts` → `mark_pending_approval_published` → Status in der DB
  tatsächlich `published`. Jeder Schritt hat funktioniert.
- `npm run test:panel` erweitert (HTTP-Seite: approvalMode speichern, `/api/approvals` leer/
  401/404-Fälle - die MCP-Tool-Seite lässt sich in diesem reinen HTTP-Testskript nicht sauber
  abbilden, wurde stattdessen wie oben beschrieben manuell verifiziert). **59 passed, 0
  failed.**

**⚠️ Gleiche Einschränkung wie die übrigen v4-UI-Arbeiten:** der Umschalter und der neue
Dashboard-Bereich wurden nicht in einem echten Browser angeklickt.

**Für Paul:** nichts zu tun, außer dem Browser-Check am Ende der Sitzung.

---
*(wird fortgesetzt)*
