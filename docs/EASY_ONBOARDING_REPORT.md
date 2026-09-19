# Report: Easy Onboarding (Sandbox-Auftrag, 19.09.2026)

**Stand: nur Sandbox.** Nichts auf Produktion. Anschauen:
**https://mcp.pipebot.at/panel/sandbox/start/** (neuer Flow) - das klassische Panel liegt
unveraendert daneben unter `https://mcp.pipebot.at/panel/sandbox/` (bzw. `?classic=1` fuer
einen Kunden, der ueber den neuen Flow gekommen ist). Testkunden-Links: `/root/sandbox-keys.env`
(beide Schluessel am 19.09. neu erzeugt, die alten waren ungueltig).

Branch `feature/easy-onboarding` im Worktree `/root/mcp-sandbox`. Designplan:
`docs/EASY_ONBOARDING_DESIGN.md`. Screenshots (echter Chromium, 360 und 1440 px):
`docs/easy-onboarding/shots/`. Produktions-Baseline: `docs/easy-onboarding/baseline-produktion.txt`.

---

## 1. Empfehlung zum Kostenschutz-Konflikt (Abschnitt 4) - gebaut

**Gewaehlt: Kombination aus drei der vorgeschlagenen Wege**, serverseitig erzwungen
(`src/panel/start-quota.ts`, Tabelle `start_previews`, neustartfest - nicht der In-Memory-Zaehler
aus router.ts):

1. **Turnstile unsichtbar direkt vor der Vorschau** (Bildschirm 2, `appearance: interaction-only`).
   Ohne gueltiges Token keine Generierung, sobald `TURNSTILE_SECRET_KEY` gesetzt ist (Produktion).
   In der Sandbox laufen Cloudflares Testschluessel - der Weg ist damit end-to-end getestet.
2. **Ganze Woche als Text, aber nur die ersten drei Slots mit echtem Bild** vor der Bestaetigung.
   Die uebrigen Karten zeigen einen Platzhalter, der wie das echte Bild gebaut ist (Akzentflaeche,
   Headline in der Bildschrift, gedrehtes Wasserzeichen) und tragen den Hinweis "Bild folgt nach
   der Bestaetigung". Der Eindruck "die Woche ist fertig" bleibt; nach dem Klick auf den
   Bestaetigungslink zieht `backfillMissingImages` die Bilder im Hintergrund nach, der Kunde sieht
   sie im Dashboard eintrudeln.
3. **Harte Deckel pro IP, pro Domain und global pro Tag**, dazu: eine bekannte E-Mail-Adresse
   bekommt nie eine zweite Vorschau (sie bekommt ihr Konto per Anmeldelink zurueck), "Anders
   machen" vor der Bestaetigung genau einmal, hoechstens 14 Beitraege pro unbestaetigtem Konto
   (deckelt auch "taeglich + drei Kanaele" im Plan).

| Grenze (Umgebungsvariable) | Standard |
|---|---|
| Vorschauen je IP und 24 h (`PANEL_PREVIEW_PER_IP_DAY`) | 3 |
| Vorschauen je Domain und 24 h (`PANEL_PREVIEW_PER_DOMAIN_DAY`) | 2 |
| Vorschauen weltweit je 24 h (`PANEL_PREVIEW_GLOBAL_DAY`) | 40 |
| Echte Bilder vor der Bestaetigung (`PANEL_PREVIEW_IMAGES_UNVERIFIED`) | 3 |
| "Anders machen" vor der Bestaetigung (`PANEL_PREVIEW_ADJUST_UNVERIFIED`) | 1 |
| Beitraege je unbestaetigtem Konto (`PANEL_PREVIEW_POSTS_UNVERIFIED`) | 14 |

**Gemessene Kosten pro nicht bestaetigtem Besucher** (usage_costs des Testkunden im HTTP-Test,
Haiku 4.5 + fal.ai zu 0,003 USD/Bild):

| Posten | USD |
|---|---|
| Website-Analyse (ein Aufruf, liefert Branche, Beschreibung, Ton, Firmenname, drei Themen) | 0,002 |
| Woche als Text, 10 Beitraege (werktags, Feed + LinkedIn) | 0,015 |
| 3 echte Bilder | 0,009 |
| **Normalfall** | **ca. 0,03** |
| + einmal "Anders machen" (Wunsch uebersetzen 0,002, 10 Texte neu, 3 Bilder neu) | + ca. 0,03 |
| **Schlimmster Fall je Besucher** | **ca. 0,06** |
| Schlimmster Fall je Tag (globaler Deckel 40) | ca. 2,40 |

Nach der Bestaetigung kommen die restlichen 7 Bilder (0,02 USD) dazu - das ist dann ein
bestaetigter Kunde, wie bisher.

Verworfen: "Vorschau erst nach Bestaetigung" (bricht genau den Moment, um den es geht), "nur
Text sofort, Bilder spaeter" (ohne ein einziges echtes Bild wirkt die Woche wie eine Attrappe),
"Vorausplanung erst nach Kanal-Verbindung" (in der Sandbox ist keine Verbindung moeglich, und
in Produktion waere es wieder ein Formular vor dem Ergebnis).

**Nachweis (Abnahme 4):** `npm run test:start` befuellt die Zaehler-Tabelle direkt und ruft dann
mehrfach auf: IP-Deckel -> 429 `ip`, Domain-Deckel (normalisiert, `https://www.X/` = `X`) -> 429
`domain`, globaler Deckel -> 429 `global`, Zaehler aelter als 24 h zaehlen nicht, bekannte E-Mail
-> 409, zweites "Anders machen" unbestaetigt -> 429 `unverified`, hoechstens 3 Bilder in der
echten Vorschau, Bild-Deckel gilt auch beim Neuschreiben. Reine Entscheidungslogik zusaetzlich in
`npm run test:start-quota` (6 Tests).

---

## 2. Klick- und Feldzaehlung: vorher gegen nachher

**Vorher (klassisches Onboarding, `companyHtml()` im Panel):** vier Wizard-Seiten (Unternehmen,
Inhalt, Stil, Kanaele). Pflichteingaben bis zum Abschicken: Firmenname, Ansprechperson, E-Mail,
Zustimmungs-Haekchen = **4 Pflichteingaben** (dazu Turnstile). Klicks: 3x "Weiter", 1x "Weiter zu
Instagram" (Absenden), 2x "Spaeter verbinden" = **6 Klicks** bis zum Dashboard - und dort ist
noch **kein einziger echter Beitrag** zu sehen: die Vorausplanung laeuft erst um 03:00 UTC und
nur fuer bestaetigte Adressen. Erstes echtes Ergebnis also fruehestens am naechsten Morgen, nach
zusaetzlich einem Klick im Postfach.

**Nachher:** **1 Eingabe neben der E-Mail (die Domain), 2 Klicks** ("Los geht's", "Vorschau
erstellen"). Erster fertiger Beitrag mit Bild nach **11 Sekunden** auf dem Bildschirm, die ganze
Woche nach rund 25 Sekunden (gemessen im Browser-Test, 10 Beitraege, 3 Bilder). Bis dahin hat der
Besucher keine Einstellung vorgenommen: Themen, Ton, Farbe, Rhythmus, Kanaele und Freigabe sind
aus der Website abgeleitet bzw. vorbelegt.

Kein Bildschirm hat mehr als ein Pflichtfeld oder mehr als zwei Buttons (der Browser-Test zaehlt
das je Bildschirm, siehe Abschnitt 6; Ausnahmen mit Begruendung: "Verbinden" hat einen Button je
Kanal plus "Zum Dashboard", die Einstellungen sind bewusst kein Onboarding-Bildschirm).

---

## 3. Designplan und was sich gegenueber dem ersten Entwurf geaendert hat

Vollstaendig in `docs/EASY_ONBOARDING_DESIGN.md` (Farben, Schriften, ASCII-Wireframes je
Bildschirm, fuenf Leitprinzipien). Kurz: Vorbild ads.openai.com, am 19.09. im Headless-Browser
gemessen (nicht geraten): Weiss, `#0d0d0d` / `#5d5d5d`, eine Sans, Ueberschriften Gewicht 500,
Pillen-Buttons 40 px, Karten mit 1-px-Linie ohne Schatten. Umgesetzt mit der selbst gehosteten
Inter (OpenAI Sans ist nicht frei), Wortmarke in der Instrument Serif des bestehenden Panels.

Selbstpruefung "kaeme das auch fuer jedes andere SaaS heraus?": beim ersten Entwurf ja. Geaendert:
(1) die Seite traegt die Farbe des Kunden - Beitragskarten rendern Akzentflaeche, Bildschrift und
Wasserzeichen wie die echte Bildpipeline, der Ergebnis-Bildschirm eines Physiotherapeuten sieht
anders aus als der eines Tischlers; (2) die Woche ist eine Woche - sieben Tageszeilen Mo-So, ruhige
Tage bleiben als schmale Zeile sichtbar; (3) die Prosa nennt die Quelle ("zwei Themen, die auf
pipeflow.at besonders hervorstachen"); (4) Wortmarke in der Serif als einziger Schmuck und
Bruecke zum alten Panel; (5) drei Formen mit drei Bedeutungen statt Kartenwueste (Karte = Beitrag,
Zeile = Einstellung, Liste = Fortschritt).

Konstruktiv gegen ueberlappende Schritt-Labels: es gibt keinen horizontalen Stepper mehr. Der
Fortschritt ist eine vertikale Liste, alles andere hat keinen.

Abweichung: der Auftragstext sagt "ruhig und dunkel", die zweite Nachricht "1:1 wie
ads.openai.com" - das Vorbild ist hell, das bestehende Panel auch. Gebaut ist hell; ein dunkles
Thema waere ein Token-Block in `start.css` (offene Entscheidung, Abschnitt 8).

---

## 4. Wie die Vorausplanung sofort laeuft - ohne Umbau der Routine

`planning.ts`: die Kundenschleife aus `planUpcomingPosts()` ist als `planCustomerWeek(row, opts)`
herausgeloest (gleiche Slot-Auswahl, gleiche Idempotenz ueber `getPlannedPostByChannelDate`,
gleiche Saeulen-Rotation). Der Nachtlauf ruft sie fuer jeden Kunden auf wie bisher; das Onboarding
ruft sie **sofort** fuer den gerade angelegten Kunden auf, mit drei Arbeitern parallel und den
Deckeln aus Abschnitt 1 (`imageBudget`, `postBudget`). Neu ist ausserdem `generatePost(...,
{ withImage: false })` fuer die Text-nur-Zeilen und `backfillMissingImages(row)` fuer das
Nachziehen; `ensureFreshPlannedPost` (das Tor, durch das die Routine jeden vorbereiteten Beitrag
holt) prueft zusaetzlich "Bild fehlt?" und zieht es nach - eine Zeile ohne Bild erreicht die
Routine damit nie als "Bild existiert schon". Der Nachtlauf zieht fehlende Bilder bestaetigter
Kunden ebenfalls nach (Sicherheitsnetz gegen einen Prozess-Neustart mitten im Nachtrag).

**Die Routine bei claude.ai (K1-K9, K3b) braucht keine Aenderung:** sie liest weiterhin nur ueber
`get_planned_post`/`list_customers`, ob fuer heute eine Zeile existiert und ob der Kunde faellig ist.
Ein unbestaetigter Easy-Kunde ist wie bisher nie faellig (`notReady` in `credentials.ts`). Es gibt
deshalb auch keinen Prompt-Text in `docs/` zur Freigabe.

**Drag-and-drop:** geht sauber. `reorderPlannedPosts()` tauscht nur die vorhandenen Termine
innerhalb eines Kanals unter den Zeilen mit Status planned/edited/approved - es entsteht nie ein
zweiter Beitrag fuer denselben Kanal/Tag und nie ein neuer Termin, die Routine findet weiterhin
genau eine Zeile je Slot (im HTTP-Test per SQL gegengeprueft). Eingereichte/veroeffentlichte
Zeilen lehnt der Server ab. Bedienung: Ziehen am Griff (Desktop) und Pfeile hoch/runter (44 px,
Tastatur, Handy).

---

## 5. Was neu ist (additiv) und wie das Alte bleibt

**Server, additiv:** Spalten `customers.ui_mode`, `customers.plan_tier`,
`customers.login_link_token_hash`, `customers.login_link_expires_at` (alle NULL = bisheriges
Verhalten), Tabelle `start_previews`. Routen `POST /api/start/begin`, `POST /api/start/preview`,
`GET /api/start/status`, `POST /api/start/adjust`, `POST /api/start/replan`,
`POST /api/planned-posts/reorder`; `GET /start`. Bestehende Routen unveraendert, mit drei kleinen
Ergaenzungen: `GET /` leitet einen Easy-Kunden nach `/start/` (mit `?classic=1` nicht),
`/connect?return=start` und `/verify-email` kehren fuer Easy-Kunden nach `/start/` zurueck,
`publicState` liefert zusaetzlich `uiMode`, `planTier`, `features`. `suggestFromWebsite` liefert
zusaetzlich `company` und `pillars` (derselbe eine Anthropic-Aufruf; der alte Aufrufer ignoriert
die Felder). Neue Funktion `interpretAdjustmentWish` fuer "Anders machen".

**Frontend, neu, kein Framework, kein Build:** `public/panel/start/index.html`, `start.css`,
`start.js`. Alles andere unter `public/panel/` unveraendert (nur der Cache-Buster in
`index.html` wurde im Sandbox-Ordner auf den Repo-Stand gezogen).

**Alte Oberflaeche:** Koexistenz ueber den **eigenen Pfad** `/start/` plus **Merkmal am Kunden**
(`ui_mode`). Bestehende Kunden (Andrea Hoelzl, Paul) haben `ui_mode NULL` und sehen exakt das
Bisherige - im Test gegen die Produktionskopie fuer alle sechs aktiven Kunden gezeigt (Abnahme 6).
Umschalten spaeter: pro Kunde `ui_mode='easy'` setzen, oder global (Vorschlag: eine Variable
`PANEL_EASY_DEFAULT=true`, noch nicht gebaut, weil der Standard fuer Neukunden Pauls
Entscheidung ist).

**"Plan uebernehmen"** setzt `tour_done_at` (bestehender Endpunkt `/api/tour-done`) als Marke
"Onboarding abgeschlossen" - keine weitere Spalte; Nebeneffekt: der alte Erst-Rundgang erscheint
fuer Easy-Kunden im klassischen Panel nicht mehr, was gewollt ist.

**Preisstufen (Abschnitt 7):** `src/panel/tiers.ts` - `plan_tier` basic/pro, ein
`features`-Objekt in `/api/me` (weekdayMatrix, multiThemes, analytics, formatOptions,
automations). Die neue Oberflaeche blendet danach ein/aus (z. B. "Einzelne Wochentage je Kanal
gibt es in der naechsten Stufe"). Keine Bezahlfunktion, kein Stripe, kein Admin-Schalter (Wert
derzeit nur per SQL setzbar - offene Entscheidung).

**Wortliste, vereinheitlicht im neuen Flow:** Beitrag, Kanal, Freigabe, Vorschau, verbinden,
Woche, Plan. Buttons benennen die Handlung ("Vorschau erstellen", "Passt, weiter", "Anders
machen", "Plan uebernehmen", "Instagram verbinden", "Spaeter verbinden", "Freigeben", "Jetzt
posten"). Das klassische Panel wurde sprachlich **nicht** angefasst (dort "Sie", hier "du" -
offene Entscheidung, Abschnitt 8).

---

## 6. Tests

| Suite | Ergebnis |
|---|---|
| `npm run test:start-quota` (reine Kostenschutz-Logik) | 6/6 |
| `npm run test:start` (HTTP, Staging, echte Vorschau) | siehe Abschnitt 6.1 |
| `npm run test:start-browser` (Chromium 360/1440, alle Bildschirme) | siehe Abschnitt 6.1 |
| `npm run test:prod-copy` (Sandbox-Build auf Kopie der Produktions-DB, Port 3111) | 64/64 |
| `npm run test:backoff` (bestehend) | 15/15 |
| `npm run audit:panel` (bestehend) | ein Befund, **vorbestehend** auf `main` (87 `ob-*`-Klassen: die Pruefung liest `onboarding.css` nicht) - nichts Neues; die Pruefung kennt jetzt zusaetzlich `start.js`/`start-routes.ts` |
| `npm run test:panel`, `npm run test:onboarding` (bestehend) | siehe Abschnitt 6.1 |

### 6.1 Ergebnisse der Laeufe vom 19.09.2026 (Staging, letzter Stand des Codes)

| Lauf | Ergebnis |
|---|---|
| `test:start-quota` | 6 passed, 0 failed |
| `test:start` (HTTP, mit echter Vorschau, Anpassung, Bestaetigung + Bild-Nachtrag) | 53 passed, 0 failed - Vorschau 10 Beitraege + 3 Bilder in 11-21 s, Kosten 0,023-0,024 USD |
| `test:start-browser` (Chromium, 360 px kompletter Flow, 1440 px Dashboard/Einstellungen/Einstieg) | 119 ok, 0 Probleme - je Bildschirm: nichts ueber den Rand, <= 1 Pflichtfeld, <= 2 Buttons, Tap-Ziele >= 44 px, keine Ueberlappung, keine JS-Fehler |
| `test:prod-copy` (Kopie von `panel-2026-09-19.db`, sechs aktive Kunden) | 64 passed, 0 failed |
| `test:backoff` | 15 passed, 0 failed |
| `audit:panel` | 1 Befund, identisch auf `main` (vorbestehend, s. o.); alle 50 API-Aufrufe beider Oberflaechen haben eine Route, jede Route wird aufgerufen |
| `test:onboarding` (klassisches Onboarding, Demo-Modus) | **schlaegt fehl - vorbestehend**: das Skript sucht `#fp-progress`, das es seit dem Onboarding-Neubau vom 18.09. auch auf `main` nicht mehr gibt (letzte Aenderung am Skript: `7c6ea5b`). Nichts am klassischen Panel wurde in diesem Auftrag veraendert (`git status`: `public/panel/panel.js` unveraendert). |
| `test:panel` (bestehende HTTP-Suite, 251 Pruefungen) | **251 passed, 0 failed** - direkt als `STAGING_DB=/root/mcp-server/data/panel-staging.db node scripts/test-panel.mjs` nach einem Staging-Neustart. Ueber `npm run test:panel` laeuft die Suite derzeit gar nicht an, weil ihr `pretest` zuerst `audit:panel` ausfuehrt und der am vorbestehenden Befund scheitert (auch auf `main`); ausserdem erwartet sie die DB relativ zum Arbeitsverzeichnis (`data/panel-staging.db`), was in einem Worktree ohne `data/` ins Leere zeigt. Beides vorbestehend, nicht Teil dieses Auftrags. |

Frueher im Auftrag gefundene und behobene Fehler (damit sie nicht als "lief sofort" erscheinen):
`/start` ohne Slash wurde von `express.static` hinter dem Sandbox-Proxy falsch umgeleitet (Route
jetzt vor der Statik); das Polling endete stumm beim Wechsel "Es arbeitet" -> "Ergebnis" (die
Woche blieb auf "in Arbeit" stehen); jedes Neuzeichnen durch das Polling hat den Bildschirm neu
eingeblendet (Flackern); Turnstile-Token war beim schnellen Tippen noch nicht da (jetzt bis 8 s
warten, sonst klare Meldung); Tap-Ziele unter 44 px in Dashboard und Zeilen-Editor; Kanal-Texte in
der Sie-Form; und der Einmal-Anmeldelink statt des Ersetzens des dauerhaften Zugangslinks.

---

## 7. Nachweis: Produktion unberuehrt

Baseline vor Beginn (`docs/easy-onboarding/baseline-produktion.txt`, 09:00:38 UTC) und
Kontrolle danach (`docs/easy-onboarding/kontrolle-produktion.txt`, `scripts/easy-onboarding-
baseline-check.sh`, nur lesend), inhaltlich identisch bis auf die Staging-Zeile: `instagram-mcp` PID 420644, Restarts 7, beides unveraendert;
sha256 aller Dateien in `/root/panel-live` unveraendert; `/root/mcp-live` auf `6b4f913`, Arbeitsbaum
sauber, `dist/index.js` mit Zeitstempel 18.09. 15:44 unveraendert (in `/root/mcp-live` wurde nicht
gebaut - dafuer gibt es den Worktree); Produktions-DB `panel.db` hat weiterhin 68 Spalten in
`customers`, keine Tabelle `start_previews` (nur lesend geoeffnet, `mode=ro`). Der einzige
Prozess, der neu gestartet wurde, ist `instagram-mcp-staging` (Sandbox), ausserhalb :43 und
ausserhalb der Sperrminuten.

Was sich am Server ausserhalb des Repos geaendert hat (alles Sandbox):
`/root/staging.ecosystem.json` (Script-Pfad -> `/root/mcp-sandbox/dist/index.js`; Sicherung
`.bak-20260919`), `pm2 save` (Dump enthaelt den neuen Staging-Pfad), `/root/panel-work/`
(Sandbox-Statikordner, neuer Unterordner `start/`), `/root/sandbox-keys.env` (Schluessel neu,
Sicherung `.bak-20260919`), `/root/backups/panel-staging-vor-easy-onboarding-20260919.db`
(Sicherung der Staging-DB vor der Migration), Git-Worktree `/root/mcp-sandbox`.

### Dateien, die bei einem spaeteren Produktions-Schritt ersetzt/ergaenzt werden muessten

Server (Build aus dem gemergten Branch, dann Neustart ausserhalb :43):
`src/panel/db.ts`, `src/panel/router.ts`, `src/panel/planning.ts`, `src/panel/credentials.ts`,
`src/anthropic.ts`, neu `src/panel/start-routes.ts`, `src/panel/start-jobs.ts`,
`src/panel/start-quota.ts`, `src/panel/tiers.ts`.
Statik nach `/root/panel-live` (nur ueber `node scripts/deploy-panel.mjs produktion`):
neu `start/index.html`, `start/start.css`, `start/start.js`; `index.html` unveraendert im Inhalt.
Dazu: `docs/SANDBOX.md`, `package.json` (Test-Skripte), `scripts/audit-panel.mjs`, neue Tests.
Nginx: nichts (`/start/` liegt unter dem bestehenden Mount). `.env`: nichts zwingend; die
Deckel haben Standardwerte.

---

## 8. Offene Entscheidungen fuer Paul

1. **Hell oder dunkel.** Gebaut wie das Vorbild (hell). Dunkel = Token-Block in `start.css`.
2. **Zustimmung per Satz statt Haekchen.** Bildschirm 1 hat nur das E-Mail-Feld; die
   Datenschutz-Zustimmung steht als Satz unter dem Button ("Mit 'Los geht's' stimmst du zu ...").
   `consent_at` wird gesetzt. Ob das rechtlich reicht, gehoert zu dir bzw. deiner Rechtsberatung;
   ein Haekchen waere ein zweites Pflichtfeld.
3. **"Du" statt "Sie".** Der neue Flow duzt (wie das Vorbild). Das klassische Panel siezt. Beides
   nebeneinander ist ein Bruch, sobald ein Kunde ueber `?classic=1` wechselt.
4. **E-Mail-Existenz wird sichtbar.** Bildschirm 1 verhaelt sich bei bekannter Adresse anders
   ("Anmeldelink geschickt") als bei neuer - so gefordert ("das System erkennt selbst"), aber ein
   Angreifer kann damit pruefen, ob eine Adresse Kunde ist (Limit 15/h je IP). "Zugang verloren?"
   im alten Panel verraet das bewusst nicht. Was ich dagegen bereits abgesichert habe: der
   verschickte Link ist ein **Einmal-Anmeldelink** (eine Stunde gueltig, genau einmal nutzbar) -
   der dauerhafte Zugangslink des Kunden bleibt unangetastet. Die erste Fassung hatte den
   dauerhaften Link ersetzt (wie "Zugang verloren?"); damit haette jeder Fremde, der eine bekannte
   Adresse eintippt, Andreas gespeicherten Link entwertet. Der HTTP-Test hat genau das aufgedeckt
   (Testfirma Eins war danach nicht mehr anmeldbar) - deshalb geaendert.
5. **Standardwerte:** werktags, 15:00, Instagram-Feed + LinkedIn (Story aus), Freigabe an,
   Sprache Deutsch, Farbe Standard-Navy. Alles per Stift aenderbar - aber die Vorbelegung praegt.
6. **Deckel-Hoehen** (Abschnitt 1), insbesondere 3 Bilder und 40 Vorschauen/Tag.
7. **Wer bekommt den neuen Flow?** Heute nur, wer `/start/` aufruft. Vorschlag fuer spaeter:
   `app.pipeflow.at/` fuer Nicht-Angemeldete auf `/start/` leiten, Bestandskunden bleiben
   klassisch (ui_mode NULL). Nicht gebaut.
8. **Preisstufen setzen:** derzeit nur per SQL (`plan_tier`). Admin-Schalter fehlt bewusst.
9. **Vorbestehender Audit-Befund** (`ob-*`-Klassen ohne CSS in der Pruefung, weil sie
   `onboarding.css` nicht liest) - klein, aber nicht Teil dieses Auftrags.
10. **`/root/panel-live` zurueck nach Git** (bekannter offener Punkt): weiterhin empfohlen, nicht
    gemacht.

---

## 9. Nicht im echten Browser getestet (ehrlich)

- **Echte Instagram-/LinkedIn-Verbindung** aus Bildschirm 6 heraus (in der Sandbox gibt es keine
  Provider-Schluessel; der Rueckweg `/callback` -> `/start/?connected=...` ist nur im Code und per
  Route-Logik geprueft, nicht mit einem echten OAuth-Lauf).
- **Echter E-Mail-Versand** (Sandbox = Dry-Run). Der Bestaetigungslink wurde im Test durch direktes
  Setzen des Token-Hashs simuliert - derselbe Serverpfad, aber ohne Postfach.
- **Echtes Turnstile in "Managed"-Modus** mit Produktionsschluessel; getestet nur mit Cloudflares
  Testschluessel (immer bestanden). Der Wartepfad "Token noch nicht da -> bis 8 s warten" ist im
  Code, aber mit dem Testschluessel praktisch nie ausgeloest.
- **Drag-and-drop per Maus** (nur die Pfeil-Variante ist im Browser-Test geklickt; die
  HTML5-Drag-Ereignisse sind nicht automatisiert, Touch-Ziehen gibt es bewusst nicht).
- **Safari/iOS und Firefox** - nur Chromium (Playwright).
- **"Jetzt posten" bis zur Veroeffentlichung** - die Anfrage wird angenommen (HTTP-Test), die
  Ausfuehrung liegt bei der Routine, die in der Sandbox nicht laeuft.
- **Der Weg ohne Website** (Beschreibung statt Domain) ist im Browser nur als Bildschirm geprueft,
  die Generierung darueber nur im Code (gleicher Serverpfad mit `suggestFromWebsite`).
- **Verhalten bei Anthropic-/fal.ai-Ausfall mitten im Lauf** (Fehlerbildschirm mit "Noch einmal
  versuchen") - nur im Code, nicht provoziert.

---

## 10. Rollback in einem Satz

`cp /root/staging.ecosystem.json.bak-20260919 /root/staging.ecosystem.json && pm2 delete
instagram-mcp-staging && pm2 start /root/staging.ecosystem.json && pm2 save && rm -r
/root/panel-work/start` - Staging laeuft wieder aus `/root/mcp-live`, der Worktree
`/root/mcp-sandbox` bleibt als Branch erhalten (die zwei neuen Spalten und die Tabelle in
`panel-staging.db` stoeren den alten Code nicht; Produktion hat nie etwas davon gesehen).
