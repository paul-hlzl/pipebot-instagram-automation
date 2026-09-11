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
| 8 | Mehrere Farbthemen | ✅ Code fertig, ⚠️ Panel-Teil nicht im Browser getestet |
| 9 | Eigenes Logo | ✅ erledigt (End-to-End mit echtem Bild verifiziert) |
| 10 | Abschluss & Deploy | ✅ **deployed, live auf mcp.pipebot.at** |

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

## Aufgabe 8 – Mehrere Farbthemen speichern ✅ Code / ⚠️ Panel-Teil-Browser-Test steht aus

**Erledigt:**
- Neue Tabelle `saved_themes` (id, customer_id, name, accent_color, watermark_text,
  created_at), neue Spalte `active_theme_id` auf `customers` (nullable, additiv). `NULL`
  bedeutet exakt das v3-Verhalten: die einzelnen `accent_color`/`watermark_text`-Felder gelten.
- **Wichtige Design-Entscheidung:** das im Formular editierbare `accentColor`/`watermarkText`
  (`GET/PATCH /api/me`) bleibt bewusst immer das **rohe Feld** - unabhängig davon, ob ein Thema
  aktiv ist. Der tatsächlich für Bildgenerierung verwendete Wert (`CustomerOverview` /
  `list_customers`, über eine neue `effectiveBranding()`-Auflösung in `credentials.ts`) ist
  dagegen **immer** themen-aufgelöst: aktives Thema, falls gesetzt, sonst die rohen Felder.
  Damit können Formular-Bearbeitung und Themen-Umschalten sich nie gegenseitig überschreiben.
  Mit einem echten Staging-Kunden verifiziert: Thema "Sommer-Kampagne" (#2e2410, "Sommer")
  angelegt und aktiviert → `GET /api/me` zeigt weiterhin die alte rohe Farbe fürs Formular,
  `list_customers` liefert korrekt `#2e2410`/"Sommer" - und nach `deactivate` wieder das alte
  Verhalten.
- Endpunkte: `POST /api/themes` (anlegen), `POST /api/themes/:id/activate` (nur eigene Themen,
  404 sonst), `POST /api/themes/deactivate` (zurück auf rohe Felder).
- Panel: unter der bestehenden Farbwahl ein Bereich "Gespeicherte Farbthemen" - Liste als
  Chips mit Farbpunkt zum Umschalten, "+ Aktuelle Farbe/Beschriftung als Thema speichern"-
  Button (fragt nach einem Namen), Hinweis welches Thema aktiv ist mit Link zum Zurückschalten.
  Ein Hinweistext bei der Farbwahl selbst macht klar, dass sie gerade wirkungslos ist, solange
  ein Thema aktiv ist.
- `npm run test:panel` erweitert (anlegen/aktivieren/deaktivieren/404 bei fremdem Thema).
  **65 passed, 0 failed.**

**⚠️ Gleiche Einschränkung wie die übrigen v4-UI-Arbeiten:** die neuen Buttons/Chips wurden
nicht in einem echten Browser angeklickt, nur die API dahinter (ausführlich, siehe oben).

**Für Paul:** nichts zu tun, außer dem Browser-Check am Ende der Sitzung.

## Aufgabe 9 – Eigenes Logo statt nur Text-Wasserzeichen ✅

**Erledigt:**
- Neue Spalte `logo_url` (TEXT, nullable) auf `customers` - **kein öffentlicher Link**,
  sondern ein absoluter lokaler Dateipfad. `watermark.ts` liest die Datei direkt von der
  Platte, kein R2/Upload nötig für den Kompositing-Schritt selbst (R2 kommt erst danach für
  das fertige Bild ins Spiel, wie schon bisher).
- `POST /panel/api/logo` (Kunden-Session, JSON mit `imageBase64`, eigener 3MB-Body-Parser NUR
  für diese Route - der globale 50kb-Parser hätte ein Bild sonst schon vorher abgelehnt):
  validiert Format (PNG/JPG per Data-URL-Präfix), Größe (max. 2MB vor dem Verkleinern),
  verkleinert serverseitig auf max. 512×512 (Seitenverhältnis erhalten) via `sharp`, speichert
  unter `/root/mcp-server/data/logos/<customer_id>.png`.
- `GET /panel/api/logo` liefert das eigene Logo zur Vorschau zurück (nur mit gültiger Session -
  ein Kunde kann nie das Logo eines anderen abrufen, kein erratbarer öffentlicher Pfad).
  `DELETE /panel/api/logo` entfernt Logo-Datei und `logo_url` wieder (nicht explizit im
  Aufgabentext verlangt, aber naheliegend und trivial mit demselben Muster).
- `watermark.ts`: `addPipelineWatermark()` bekommt einen neuen optionalen `logoPath`-Parameter.
  Ist er gesetzt, wird das Logo klein unten rechts eingeblendet **statt** des rotierten
  Text-Wasserzeichens; schlägt das Einfügen fehl (kaputte/fehlende Datei), fällt der Code
  automatisch auf das Text-Wasserzeichen zurück, bricht die Bildgenerierung nie ab. Ohne
  `logoPath` exakt bisheriges Verhalten - volle Rückwärtskompatibilität.
- **Kompletter End-to-End-Test mit einem echten Bild gegen Staging:** 300×300-PNG hochgeladen
  → korrekt auf der Platte gespeichert → `GET /api/logo` liefert es unverändert zurück → über
  das MCP-Tool `generate_post_image` ein echtes Bild für den Testkunden erzeugt → das
  generierte Bild tatsächlich angeschaut (siehe Chat-Verlauf) - das Logo erscheint korrekt
  klein unten rechts, das Text-Wasserzeichen ist weg, Headline unverändert korrekt.
- **Bug beim Testen gefunden und behoben:** `DELETE /api/me` (Konto löschen, aus Aufgabe 11 der
  letzten Sitzung) hat die Logo-**Datei** auf der Platte nicht mitgelöscht (nur DB-Zeilen via
  `ON DELETE CASCADE` - eine Datei auf der Platte ist davon nie betroffen). Behoben: löscht vor
  dem Entfernen des Kunden jetzt zusätzlich die Logo-Datei, falls vorhanden.
- Panel: Datei-Upload-Feld mit sofortiger Client-seitiger Vorschau (vor dem eigentlichen
  Hochladen), "Logo hochladen"-Button, "Logo entfernen"-Button, Hinweistext dass es klein am
  Bildrand erscheint statt als Vollbild-Logo.
- `npm run test:panel` erweitert (Upload, Abruf mit korrektem `Content-Type`, 401 ohne Login,
  400 bei Nicht-Bild-Datei, Entfernen) - **ein zweiter Bug direkt im Testskript gefunden und
  behoben:** ein von Hand getipptes Base64-PNG war ungültig; jetzt wird ein echtes winziges
  PNG zur Laufzeit mit `sharp` erzeugt. **71 passed, 0 failed.**

**⚠️ Einzige verbleibende Lücke:** nur der reine Datei-Upload-Dialog selbst (Browser-natives
`<input type="file">`) wurde nicht in einem echten Browser angeklickt - die serverseitige
Verarbeitung und das Ergebnis wurden aber, anders als bei den meisten übrigen v4-UI-Arbeiten,
vollständig mit einem echten Bild end-to-end verifiziert.

**Für Paul:** nichts zu tun.

## Aufgabe 10 – Abschluss und Deploy ✅

**Voraussetzungen geprüft, bevor deployed wurde:**
- `npm run build`: fehlerfrei.
- `npm run test:panel`: **71 passed, 0 failed** (letzter Lauf direkt vor dem Merge, gegen den
  frischen Staging-Build von `main`).
- Alle 9 Content-Aufgaben manuell gegen Staging durchgespielt (siehe jeweilige Abschnitte oben) -
  mehrere davon (Content-Säulen-Rotation, Farbthemen-Auflösung, kompletter Freigabe-Modus-
  Kreislauf, Logo-Kompositing mit einem echten generierten Bild) end-to-end mit echten
  Testkunden, nicht nur isolierte Funktionsaufrufe.
- Uhrzeit beim Deploy: **15:55 UTC** - außerhalb des Sperrfensters 14:30-15:45 UTC (kurz
  danach geprüft, keine Cloud-Routine-Kollision).
- Keine MCP-Tool-Namenskollisionen (20 Tools total, alle eindeutig geprüft).

**Ablauf (identisch zur letzten Sitzung):**
1. Zusätzliches, klar benanntes Vor-Deploy-Backup der Produktions-DB
   (`panel-pre-deploy-panel-v4-<Zeitstempel>.db`), durch Öffnen verifiziert.
2. `panel-v4` mit `--no-ff` in `main` gemerged (sauber, keine Konflikte), gepusht.
3. `npm run build` + `npm run test:panel` auf dem frischen `main`-Staging-Build - grün.
4. `pm2 restart instagram-mcp` (Produktion).
5. **Nach dem Deploy geprüft (alles erfolgreich):** `/panel` lädt (lokal und über
   `https://mcp.pipebot.at`), `/panel/api/health` ok, `/mcp` ohne Bearer-Token → 401,
   `list_customers` (roher MCP-HTTP-Aufruf) liefert weiterhin **beide** bestehenden Kunden mit
   intakten Verbindungen UND allen neuen v4-Feldern (leere `contentPillars`, `approvalMode:
   false`, usw. - die additiven Migrationen liefen sauber gegen die echte Produktions-DB),
   Admin-Login funktioniert.
6. Staging-Prozess entfernt, DB-Dateien aufgeräumt. `pm2 list` zeigt wieder genau die
   ursprünglichen drei Prozesse.

**Ergebnis: erfolgreich deployed.** Kein Rollback nötig.

Finaler Commit auf `main`: `ba4d0e0` (Merge-Commit von `panel-v4`, Ausgangspunkt `1f99a40`).
Tag `pre-panel-v4` bleibt als Rollback-Punkt bestehen.

---

# Abschlussbericht

## 1. Welche Aufgaben erledigt, welche teilweise, welche nicht - Phase 2 (Meta-Berechtigungen)

**Alle 10 Aufgaben erledigt und deployed.** Keine einzige Aufgabe brauchte eine zusätzliche
Meta-Berechtigung über die bereits bestehenden (`instagram_business_basic`,
`instagram_business_content_publish`) hinaus - **nichts musste auf Phase 2 verschoben werden.**
Alles ließ sich mit den bestehenden Berechtigungen bauen, da v4 ausschließlich interne
Personalisierungs-Logik (eigene DB-Tabellen, Panel-Formulare, MCP-Tools) hinzufügt, ohne neue
Instagram-/LinkedIn-API-Endpunkte zu benötigen.

Einschränkungen bei einzelnen Aufgaben:
- **Aufgaben 5-8** (granulare Zeitplanung, "Jetzt posten", Freigabe-Modus, Farbthemen): Code
  fertig und über die API/MCP-Tools gründlich end-to-end gegen Staging getestet, aber die
  jeweiligen **Panel-UI-Bedienelemente** (Wochentage-Picker, Freigeben/Ablehnen-Buttons,
  Themen-Chips) wurden **nie in einem echten Browser angeklickt** - diese Sitzung lief ohne
  Display/Chrome-Zugriff (Claude-in-Chrome probiert, nicht verbunden).
- **Aufgabe 9** (Logo): als einzige UI-Aufgabe **doch vollständig end-to-end verifiziert**,
  inklusive eines tatsächlich generierten, visuell geprüften Bildes - nur der reine
  Datei-Auswahl-Dialog selbst wurde nicht angeklickt.
- Alle anderen Aufgaben (2, 3, 4, Backend-Teile von 5-8): vollständig getestet, keine
  Einschränkung.

## 2. Deployed oder nur im Branch?

**Deployed und live.** `main` wurde mit `panel-v4` gemerged (Merge-Commit `ba4d0e0`), gepusht,
Produktion (`pm2`-Prozess `instagram-mcp`) läuft seit 15:55 UTC mit diesem Stand. Verifiziert
über `https://mcp.pipebot.at/panel` und `/panel/api/health`. Branch `panel-v4` bleibt bestehen,
Tag `pre-panel-v4` zeigt weiter auf den Stand vor dieser Sitzung.

## 3. Was DU manuell tun musst

1. **Cloud-Routine komplett ersetzen** mit dem Prompt-Text unten (Abschnitt 4) - er ersetzt
   den aus der letzten Sitzung vollständig (enthält alle v3- UND v4-Fähigkeiten). Ohne diesen
   Schritt bringt der gesamte Umbau dieser Sitzung nichts: die Routine kennt sonst keines der
   neuen Felder/Tools.
2. **Kurzer Browser-Check** der UI-Teile von Aufgaben 5-8 (siehe Einschränkung oben) - am
   besten mit deinem eigenen Account (`Pipeline Ai Solutions`) oder dem Testkunden
   (`Testunternehmen`) unter `https://mcp.pipebot.at/panel`: Wochentage-Picker pro Kanal,
   Pause-Datumsfelder, "Jetzt posten"-Feld, Freigabe-Modus-Umschalter samt Dashboard-Bereich,
   Farbthemen-Chips.
3. Weiterhin offen aus der letzten Sitzung (unverändert): `PANEL_ENCRYPTION_KEY` extern
   sichern, `PANEL_ADMIN_PASSWORD` steht in `.env`.

## 4. KOMPLETT NEUER Routine-Prompt-Text für claude.ai/customize

Dieser Text **ersetzt** den aus der v3-Sitzung vollständig - er enthält alle v3- und
v4-Fähigkeiten in der richtigen Reihenfolge.

```
Du bist die automatische Posting-Routine von Pipeline. Du läufst stündlich. Bei jedem Lauf,
IN DIESER REIHENFOLGE:

1. Rufe `list_approved_pending_posts` auf. Für jeden Eintrag: veröffentliche ihn mit dem
   passenden Publish-Tool (`publish_generated_post` für Provider "instagram" ohne
   Story-Kennzeichnung, `publish_generated_story` falls als Story markiert, die LinkedIn-Tools
   für Provider "linkedin"), unter Verwendung von `imageUrl`/`caption`/`headline`, mit
   `customerId` als `customer_id` und `pillarTitle` als `pillar_title`. Nach Erfolg:
   `mark_pending_approval_published` mit der `id` aufrufen.

2. Rufe `list_post_requests` auf und arbeite JEDE offene Anfrage ab, bevor du mit der
   regulären Kundenliste weitermachst - ein Kunde, der explizit "Jetzt posten" gedrückt hat,
   soll nicht hinter der normalen Zeitplanung warten. Nutze `topic` als Thema (leer: nutze das
   übliche Briefing/die Content-Säulen des Kunden). Beachte für diesen Kunden trotzdem
   `approvalMode` (Schritt 7) - eine "Jetzt posten"-Anfrage überspringt NICHT die Freigabe.
   Nach erfolgreicher Veröffentlichung (oder erfolgreichem Einreichen zur Freigabe):
   `mark_post_request_done` mit der `id` aufrufen - nie doppelt bearbeiten.

3. Rufe `list_customers` auf. Überspringe einen Kunden vollständig, wenn `trialExpired` true
   ist. Prüfe sonst pro Kanal: `igFeedEnabled`/`igStoryEnabled` zusammen mit `instagramDueNow`,
   und `linkedinEnabled` zusammen mit `linkedinDueNow` - bearbeite nur die Kanäle, die aktiv
   UND laut Zeitplan gerade fällig sind (Wochentage pro Kanal, Pause/Urlaub-Zeitraum, "heute
   schon gepostet" werden bereits serverseitig in `instagramDueNow`/`linkedinDueNow`
   berücksichtigt). Das allgemeine `dueNow`/`nextPostAt` gilt weiterhin als grobe
   Gesamtkunden-Einschätzung, für die eigentliche Kanal-Entscheidung zählen die
   kanal-spezifischen Felder.

4. Rufe für jeden fälligen Kunden/Kanal `get_customer_style_samples` auf, um Tonfall,
   Emoji-Nutzung, Hashtag-Stil und wiederkehrende Themen zu übernehmen, sofern vorhanden.

5. Prüfe `contentPillars`/`suggestedPillar`: ist `suggestedPillar` gesetzt, formuliere Thema,
   Headline und Caption danach und gib den exakten `title` als `pillar_title` beim
   Publish-/`save_pending_approval`-Tool mit. Ist es `null`, nutze `about` wie bisher. Schreibe
   die Caption in der eingestellten Sprache (`language`: de/en), mit Hashtags gemäß
   `hashtagPreference` (keine/wenige/viele) und Emojis nur wenn `emojisEnabled` true ist.

6. Prüfe `bannedWords`/`requiredElements`, BEVOR du einen Text abschickst: baue verbotene
   Wörter gar nicht erst ein, Pflicht-Elemente immer ein (irgendwo in Headline+Caption
   zusammen reicht). Schlägt ein Tool trotzdem mit einer entsprechenden Fehlermeldung fehl,
   lies den fehlenden/verbotenen Begriff aus der Fehlermeldung, formuliere die Caption
   angepasst um und versuche es GENAU EINMAL erneut für diesen Kunden - gib nicht schon nach
   dem ersten Fehlversuch auf, aber versuche es auch nicht endlos.

7. **Prüfe `approvalMode` für diesen Kunden, BEVOR du tatsächlich veröffentlichst:**
   - `approvalMode: false` (Standard) → wie gewohnt: `publish_generated_post` (Feed),
     `publish_generated_story` (Story) oder die LinkedIn-Tools direkt aufrufen. Nach Erfolg
     wird automatisch `logPost` intern aufgerufen (kein separater Schritt nötig).
   - `approvalMode: true` → NIE direkt veröffentlichen. Stattdessen `save_pending_approval`
     mit `customer_id`, `channel` (`ig_feed`/`ig_story`/`linkedin`), `headline`, `caption`,
     `image_url`, `pillar_title` aufrufen. Der Kunde entscheidet selbst im Panel, ob und wann
     veröffentlicht wird - das erledigt danach ein SPÄTERER Lauf über Schritt 1.

8. Bei einem Fehler für einen Kunden (z. B. abgelaufene Verbindung, Trial abgelaufen): diesen
   Kunden überspringen, kurz notieren welcher Fehler auftrat, und mit dem nächsten Kunden
   weitermachen - ein einzelner fehlerhafter Kunde darf den Lauf für alle anderen nicht
   abbrechen.

Zeitplan dieser Routine: stündlich (z. B. `0 * * * *` UTC) statt 1×/Tag, damit jeder Kunde
möglichst nah an seiner eingestellten `postTime` und seinem eingestellten Wochentag pro Kanal
dran ist.
```

## 5. Bekannte Risiken

- **Kein echter Browser-Test** für die UI-Teile der Aufgaben 5-8 (Wochentage-Picker,
  Freigabe-Dashboard, Themen-Umschalter) - größtes Restrisiko dieser Sitzung, siehe Punkt 1.
- **Bis die Cloud-Routine umgestellt ist**, bleiben `bannedWords`, `requiredElements`,
  `approvalMode` und die kanal-spezifische Zeitplanung wirkungslos für die alte, v4-unwissende
  Routine - ABER die harten serverseitigen Sperren (`assertNoBannedWords`,
  `assertRequiredElements`, `assertChannelEnabled`, Trial-/Pause-Sperren in `getCredentials`)
  greifen bereits jetzt unabhängig davon: eine alte Routine, die versehentlich ein verbotenes
  Wort postet oder einen pausierten Kunden bedient, wird vom Server selbst abgelehnt, nicht nur
  von der Routine-Logik. `approvalMode` ist die einzige Ausnahme ohne Server-seitige
  Zwangsdurchsetzung (das war eine bewusste Design-Vorgabe: "das entscheidet die Routine") -
  bei einem Kunden mit `approvalMode: true` UND einer noch nicht umgestellten Routine würde
  also **trotzdem direkt veröffentlicht**, ohne die gewünschte Freigabe abzuwarten. Bis die
  Routine umgestellt ist, diese Funktion Kunden gegenüber besser noch nicht aktiv bewerben.
- Zwei echte Bugs während dieser Sitzung selbst gefunden und behoben (nicht mehr im
  deployten Code): ein Rate-Limit-Konflikt im Testskript (Aufgabe 5) und fehlende
  Logo-Datei-Bereinigung beim Konto-Löschen (Aufgabe 9) - beide Details in den jeweiligen
  Abschnitten oben.
- `weekly-report.mjs` bleibt weiterhin unangetastet als untracked Datei liegen.
- Eine harmlose, unbeabsichtigte Nebenwirkung: beim Bearbeiten von `src/index.ts` in Aufgabe 4
  wurden per Skript versehentlich alle Zeilenumbrüche der Datei von CRLF auf LF normalisiert
  (die Datei hatte das schon vor dieser Sitzung, aus einer früheren Bearbeitung). Funktional
  unverändert (Build und alle Tests grün), aber dadurch zeigt der Git-Diff dieses einen
  Commits mehr geänderte Zeilen als inhaltlich tatsächlich geändert wurden - falls das beim
  Durchsehen der Historie auffällt: kein Grund zur Sorge, rein kosmetisch.

---
*(Ende des Berichts)*
