# Abschlussbericht — Panel-Redesign „Flow"

Stand: 15.09.2026 · in `main` · Rollback-Tags `pre-flow-live` (Stand vor dem Livegang) und `pre-redesign`
**Seit 15.09.2026, 13:45 Uhr ist das neue Panel live** unter https://mcp.pipebot.at/panel/
(`public/panel/index.html`, md5 `653e985c…`). Alles bis dahin Beschriebene entstand in der Sandbox,
Produktion blieb während der gesamten Bauzeit unangetastet. Rollback siehe Abschnitt 6.

---

## 0. Zuerst: ein Fund, der alles andere bestimmt hat

Produktion und Sandbox laufen aus **demselben Arbeitsverzeichnis** und liefern `index.html` per
`res.sendFile` **direkt von der Platte**. Eine Änderung an dieser Datei wäre also **ohne Deploy,
ohne Neustart, sofort in Produktion live** gewesen — das hätte die Vorgabe „Produktion nie
anfassen" beim ersten Speichern gebrochen.

Deshalb zuerst die Sandbox isoliert: `PANEL_SANDBOX=true` serviert jetzt `public/panel-redesign`,
Produktion bleibt auf `public/panel`. Die Weiche ist selbstbegrenzend (Produktion hat die Variable
nicht) und fällt automatisch zurück, wenn das Verzeichnis fehlt. Die pm2-Umgebung wurde **nicht**
angefasst — sonst hätten Secrets über die Kommandozeile gehen müssen.

Zwei weitere Funde aus derselben Ecke:
- Die CSP erlaubte **kein** `font-src 'self'` — selbst gehostete Schriften wären blockiert gewesen.
- Für das Panel-Verzeichnis gab es **kein** `express.static`, nur `index.html` per `sendFile`.

---

## 1. Was gebaut wurde

Vorher-/Nachher-Screenshots: `docs/redesign/before/` und `docs/redesign/after/` (je 390 px und 1440 px).
Die Vorher-Bilder stammen vom alten Panel aus einem lokalen Static-Server im Demo-Modus
(`scripts/redesign-before-shots.mjs`) — ohne Produktion und ohne echte Kundenkonten. Die beiden
Admin-Bildpaare (`20-admin-*`) entstanden dagegen in der Sandbox gegen die Staging-Datenbank: erst
mit der alten Datei, dann mit der neuen, also gleiche Daten auf beiden Seiten. Alle dort
sichtbaren Firmen sind Testkonten.

### Fundament
| Thema | Vorher | Jetzt |
|---|---|---|
| Dateien | eine Datei, 252 KB, 4126 Zeilen | `index.html` + `panel.css` + `panel.js` (neue `express.static`-Route, geprüft für `/panel` **und** `/panel/sandbox`) |
| Schrift | Google Fonts (DSGVO-Risiko) | Schibsted Grotesk selbst gehostet über die bestehende `/fonts`-Route, `font-display: swap`, Preload |
| Farben | `#C9C9C9`, `#FDF2E0`, `#E8C468` hartkodiert | als Tokens `--line-strong`, `--warn-bg`, `--warn-line`; keine neuen Töne |
| Mount | `"/panel"` bzw. `"/panel/sandbox"` fest im Code | aus dem Pfad abgeleitet — läuft unverändert unter einer eigenen Domain |
| Icons | Emojis (💬, ✕, ⚠️) | 15 eigene Pixel-Icons, 11×11, `crispEdges`, `currentColor` |
| Navigation | brach am Handy zweizeilig um | Bottom-Bar (Daumenzone, Labels immer sichtbar, `safe-area-inset`), Kopfzeile ab 1024 px mit gleitendem Unterstrich |
| Routing | Ansicht nur in `S.step`, URL nie geändert | Hash-Deep-Links (`#beitraege/freigabe`, `#einstellungen/aussehen`, `#posten`), Zurück-Geste funktioniert |

**Fallstrick unterwegs:** `https://…/panel` **ohne** abschließenden Slash antwortet mit 200 (kein
Redirect). Relative Pfade (`panel.css`) hätten dort auf `/panel.css` gezeigt — das Panel wäre
unformatiert gewesen. Gelöst über ein `<base>`-Tag, das denselben Mount ableitet wie das Skript.

### Die Pipe (Signature)
Ein Beitrag ist ein Quadrat an einer Leitung: Umriss = geplant, Umriss mit Kern = wartet auf
Freigabe, gefüllt = veröffentlicht, `--stop` = Problem. Dieselbe Sprache in Flow-Leiste,
Tagesreitern, Beitragskarte, Onboarding-Fortschritt und Einrichtungs-Checkliste — mit Klartext für
Screenreader (`role="img"` + `aria-label`) und einer Legende unter der Wochenleiste.
Beim Freigeben füllt sich das Quadrat in Pixel-Stufen (`steps(7,end)`) — der einzige Ort mit
dieser Bewegung.

### Übersicht
Statt „Willkommen zurück" plus vier Kennzahlen: **ein Satz** in Display-Größe, nach
Handlungspriorität (Problem → Freigabe → Testphase/Pause → läuft), mit genau einer Aktion daneben.
Darunter die Flow-Leiste der nächsten sieben Tage, dann die letzten Beiträge als großes Bildraster
(die Bilder sind die einzige Farbe im Panel), die Kanäle kompakt und eine Einrichtungs-Checkliste,
die bei 100 % ganz verschwindet.

### Beiträge
Ein Bereich mit drei Ansichten derselben Pipe: **Geplant / Zur Freigabe / Veröffentlicht**
(Segmented Control, Zähler an „Zur Freigabe"). Vorher waren das zwei Navigationspunkte mit
uneinheitlichen Begriffen („Beiträge" vs. „Vorschau", „Verlauf" vs. „Ihre bisherigen Beiträge").

Die Detailkarte zeigt den Beitrag so, wie er erscheinen wird: Bild groß, Kanal und Termin als Satz
(„Geht am Mittwoch um 9:00 Uhr raus, sobald Sie freigeben"), Text im Klartext. Bearbeiten liegt
hinter einem Schalter, damit die Karte im Normalfall wie ein Beitrag wirkt und nicht wie ein
Formular.

### Freigabe mit Rückgängig (kritischer Punkt)
Freigeben/Ablehnen passiert sofort, mit Toast „Freigegeben. Rückgängig" (6 s). **Der Server-Aufruf
geht erst nach Ablauf des Fensters raus**, weil `/api/approvals/:id/approve` serverseitig sofort
einen Routine-Lauf auslöst (`triggerRoutineNow` in `router.ts`) — würde direkt gesendet, wäre
„Rückgängig" gelogen. Mit Playwright nachgewiesen: kein Netzwerkaufruf im Fenster, keiner nach
Rückgängig, genau einer nach 6,0 s (`scripts/redesign-undo-test.mjs`, 10/10).
Destruktive Kontoaktionen (Konto löschen, Verbindung trennen) behalten den Bestätigungsdialog.

### Jetzt posten
Bottom-Sheet (Desktop zentriert), überall erreichbar: Kopfzeile ab 1024 px, sonst als eigene
Aktion in der Bottom-Bar, zusätzlich per `#posten`. Kanäle und Format als große Toggle-Kacheln
statt Standard-Checkboxen, Diktat-Knopf sitzt im Feld statt darunter.

### Einstellungen
Mobil: Gruppenliste wie in den iOS-Einstellungen, Tipp öffnet die Gruppe, „Zurück" führt zur
Liste. **Von 15.230 px Scrollhöhe auf 2.216 px.** Ab 1024 px bleibt die sticky Sprungliste mit
Suche. Alle sieben Gruppen bleiben dabei immer im DOM (nur ausgeblendet) — `PATCH /api/me` sendet
das ganze Briefing, ein Entfernen hätte stillschweigend Werte verloren. Genau das prüft der
Funktionstest.

### Onboarding: „Ihr erster Beitrag" (Phase 7)
Das Briefing war bisher ein Formular, das nichts zurückgab — der Kunde sah erst nach dem Einrichten,
was aus seinen Angaben wird. Jetzt steht unter dem Formular eine Vorschau, die **mitwächst**:
Beitragsbild in der Akzentfarbe mit Beschriftung, darüber Kanal und Zeitpunkt aus den Kanalfeldern,
darunter Beispieltext, Hashtags und eine Zeile zu Ton, Sprache und Emojis. Ab 1024 px steht sie als
eigene Spalte **neben** dem Formular und bleibt beim Scrollen stehen — sonst läge sie auf Seite 2
zweitausend Pixel unter dem Feld, das gerade geändert wird. Am Handy bleibt sie im Lesefluss unter
den Feldern.

Sie ist **rein lokal zusammengesetzt**: kein API-Aufruf, keine KI, keine Vertragsänderung. Solange
die Beschreibung fehlt, steht dort ein Platzhalter (Skeleton) statt eines erfundenen Werbetextes,
und eine Zeile sagt, was noch fehlt („Noch offen: Firmenname, Kanal."), bzw. „Alles da, was wir für
Ihren ersten Beitrag brauchen.". Die Überschrift nimmt die erste Content-Säule, sonst den ersten
Satz der Beschreibung (nur wenn er ungekürzt passt — ein abgeschnittener Satz sähe im Bild aus wie
ein Fehler), sonst Branche oder Firmenname. Beispiel-Hashtags entstehen aus Säulen, Branche, Firma
und den großgeschriebenen Wörtern der Beschreibung, mit Umlauten (`#Rückenschmerzen`, nicht
`#Ruckenschmerzen`).

**„Vorschlag aus meiner Website holen"** war ein Textlink in einer Fußnote unter dem Website-Feld
und wurde übersehen. Jetzt ist es ein eigener Knopf (am Handy volle Breite, 51 px hoch) mit einem
Satz daneben, was dabei passiert: Startseite einmalig lesen, Branche/Beschreibung/Tonalität
vorschlagen, Vorschlag zuerst zeigen — übernommen wird nichts automatisch. Nach dem Übernehmen zieht
die Vorschau sofort nach.

### Admin-Seite (Phase 6)
`admin.html` läuft jetzt auf denselben Tokens, derselben Schrift und denselben Komponenten wie das
Kunden-Panel — Google Fonts ist damit auch hier weg. Oben steht **ein Satz** statt einer Kachelwand
(„Alles läuft." · „3 Verbindungen brauchen Handlung." · „2 Testphasen sind abgelaufen."), danach
Zahlen, Kunden, Werkzeuge — vorher stand das Werkzeug (Test-E-Mail) ganz oben und die Kunden
darunter. Zustände sind Umriss-Chips in der Pipe-Sprache (gefüllter Punkt = ok/erledigt, `--stop` =
Problem), die ALL-CAPS-Spaltenköpfe sind weg, am Handy steht in jeder Kundenkarte Bezeichnung links
und Wert rechts statt zwölf Zeilen untereinander, am Desktop bleiben die vier Zeilenaktionen in
einer Zeile. Der letzte Systemdialog der Anwendung ist damit ebenfalls weg: „+7 Tage" fragt nicht
mehr über `window.prompt()`, sondern im eigenen Dialog (Zahlenfeld, mit 7 vorbelegt, Enter
bestätigt, Escape bricht ab). Der Detail-Dialog schließt jetzt auch mit Escape und gibt den Fokus
an den auslösenden Knopf zurück. Die KI-Kosten-Tabelle zeigt deutsche Namen statt der internen
Kürzel (`voice-dictation` → „Diktat-Transkription", alle sechs erfasst).

### Weitere
Analytics nutzt dieselbe Segmented-Control wie Beiträge · Skeletons in der Form des Inhalts statt
„Wird geladen …" · Fehlertexte mit „Erneut versuchen" · leere Zustände als Einladung · Toast-System
mit `aria-live` · Sheets mit Fokus-Falle und Escape · Kontomenü · Hilfe-Chat als Sheet mit
Startvorschlägen · relative Zeiten · Auto-Aktualisierung beim Zurückkehren in den Tab (nie während
einer Eingabe) · kurzes `navigator.vibrate` beim Freigeben · PWA-Manifest samt Icons aus dem
Pixel-Logo (Scope relativ, dadurch für `/panel` und `/panel/sandbox` automatisch getrennt).

---

## 2. Abweichungen vom Auftrag

| Abweichung | Begründung |
|---|---|
| **Splash nur einmal pro Browser-Sitzung** (statt bei jedem Reload), Dauer 1,5 s → 1,1 s, Öffnen in Pixel-Stufen | Beim zehnten Öffnen am Tag ist ein Markenmoment eine Wartezeit. Wie gefordert ausgewiesen und per Konstante `SPLASH_EVERY_LOAD` in `index.html` zurückdrehbar. |
| **Aufteilung in drei Dateien** statt einer | Vom Auftrag erlaubt, wenn beide Mount-Pfade und die CSP funktionieren — beides nachgewiesen. Eine 252-KB-Datei war nicht mehr sinnvoll zu bearbeiten. |
| **Vier Server-Änderungen** (`express.static`, `font-src 'self'`, Admin-Verzeichnis aus dem Panel-Router, Cookie-Pfad der Admin-Sitzung) | Ohne die ersten beiden ließen sich weder die Aufteilung noch die selbst gehostete Schrift ausliefern; ohne die letzten beiden war die Admin-Seite in der Sandbox weder sichtbar noch benutzbar (siehe Abschnitt 4). Alle vier additiv, in Produktion verhalten sie sich unverändert, `npm run test:panel` bleibt grün (179/179). |
| **Sandbox-Weiche im Router** (`public/panel-redesign`) | Siehe Abschnitt 0 — ohne sie wäre jede Änderung sofort in Produktion gewesen. Sollte nach dem Produktions-Deploy wieder entfernt werden. |
| **Redundante „Zurück zur Übersicht"-Knöpfe entfernt** | Chanel-Regel: die Navigation ist ohnehin immer sichtbar. |

---

## 3. Was nur emuliert oder gar nicht geprüft wurde

- **iOS-Safari-Eigenheiten** (Sticky-Leisten bei offener Tastatur, `visualViewport`, Diktat-Fallback
  über Server-Transkription) wurden **nicht** auf echtem Gerät getestet — nur in Chromium mit
  Mobil-Emulation (390 px, `isMobile`, `hasTouch`). Der Diktat-Pfad braucht ein echtes Mikrofon.
- **Lighthouse** wurde nicht gemessen (kein Lighthouse in dieser Umgebung). Die Grundlagen dafür
  sind da: keine externen Anfragen mehr, Schrift lokal mit Preload, Bildplätze über `aspect-ratio`,
  `loading="lazy"`/`decoding="async"`.
- **Echtes Veröffentlichen, OAuth, KI-Aufrufe**: in der Sandbox bewusst deaktiviert (siehe
  `docs/SANDBOX.md`), also nicht durchgespielt.
- **PWA-Installation** (Home-Bildschirm, Standalone) wurde nicht auf einem Gerät geprüft; Manifest
  und Icons werden korrekt ausgeliefert (HTTP 200).

---

## 4. Offene Punkte (bewusst nicht gebaut)

1. **Autosave pro Feld** in den Einstellungen — aktuell weiterhin „Änderungen speichern". Der
   Vertrag (`PATCH /api/me` mit allen Feldern) macht Autosave nur mit Debounce + Konfliktschutz
   sinnvoll; das gehört in eine eigene Runde.
2. **Befehlspalette ⌘K** und Tastenkürzel (F/E/?) — Desktop-Komfort, kein Handy-Nutzen.
3. **Service Worker** (Offline-Hülle). Manifest und Icons sind da; der Worker fehlt bewusst, weil
   er sauber getrennte Scopes für `/panel` und `/panel/sandbox` und eine Cache-Strategie braucht,
   die **nie** API-Antworten cacht.
4. **Wischen in der Freigabe** und **Lightbox mit Wischen/Doppeltipp-Zoom** — die Buttons bzw. die
   einfache Lightbox funktionieren, die Gesten fehlen.
5. **Rundgang als Spotlight an echten Elementen** — läuft weiterhin als Dialog (4 Schritte).
6. ~~**`admin.html`** wurde noch nicht auf die neuen Tokens gezogen (Phase 6).~~ **Erledigt** —
   siehe „Admin-Seite (Phase 6)" in Abschnitt 1.
7. ~~**Onboarding**: neuer Pipe-Fortschritt und neue Komponenten sind drin, die im Plan skizzierte
   mitwachsende Live-Vorschau des ersten Beitrags und die Hervorhebung von „Vorschlag aus meiner
   Website holen" stehen noch aus.~~ **Erledigt** — siehe „Onboarding: Ihr erster Beitrag" in
   Abschnitt 1.
8. **Web-Push** — laut Auftrag nur vormerken, siehe `docs/redesign/IDEEN.md`.

### Zwei Altbestand-Fehler an der Admin-Seite (gefunden in Phase 6, beide behoben)

**1. Die Admin-Seite war in der Sandbox nicht benutzbar.** Das Sitzungs-Cookie wurde fest mit
`Path=/panel/admin` gesetzt. Unter `/panel/sandbox/admin/` schickt der Browser es damit nie zurück:
die Anmeldung antwortete mit 200, der nächste Aufruf von `/api/me` mit 401 — die Seite fiel sofort
auf die Anmeldemaske zurück, in einer Endlosschleife. Der Pfad wird jetzt wie im Kunden-Router aus
`PANEL_MOUNT_PATH` abgeleitet (`src/panel/admin.ts`). Ohne diese Variable — also in Produktion —
kommt exakt `/panel/admin` heraus wie bisher.

**2. Die Sandbox servierte die Produktions-`admin.html`.** `createAdminRouter()` hat sein
Verzeichnis selbst bestimmt (immer `public/panel`) und die Sandbox-Weiche des Panel-Routers nicht
gekannt. Ein Redesign dieser Datei wäre dort gar nicht sichtbar gewesen — änderbar nur direkt in
Produktion, also genau der Fall, den Abschnitt 0 verhindern soll. Der Panel-Router reicht das
Verzeichnis jetzt durch; ohne Argument bleibt das Verhalten unverändert.

### Gefundener Altbestand-Fehler (nicht vom Redesign verursacht, nicht behoben)
Fehlt der Instagram-Verbindung der Kommentar-Scope, sind die Radios für
`commentAutomationMode` deaktiviert — das Feld fehlt dann im `PATCH /api/me`, und der Server setzt
es auf seinen Standard („approval") zurück. Ein Kunde mit „automatisch" verliert diese Einstellung
also beim nächsten Speichern. Das Verhalten stammt unverändert aus dem alten Panel; der
Funktionstest weist es ausdrücklich als erwarteten Altbestand aus, statt es als Regression zu
melden. Empfehlung für die nächste Runde: Feld auch im deaktivierten Zustand mitsenden.

---

## 5. Nachweise

| Prüfung | Ergebnis |
|---|---|
| `npm run test:panel` | **179/179 grün** |
| `node scripts/redesign-func-test.mjs` | **17/17** — Deep-Links, Zurück-Geste, Reiterwechsel, alle 38 Briefing-Felder im Speichern, Kontomenü, Sheet |
| `node scripts/redesign-undo-test.mjs` | **10/10** — Rückgängig ohne vorzeitigen Routine-Trigger |
| `node scripts/redesign-a11y.mjs` (axe-core 4.10) | **0 kritische/ernste Verstöße**, 5 Ansichten × 2 Breiten |
| `node scripts/redesign-check.mjs` | kein horizontales Scrollen bei 390 und 1440, **keine Konsolenfehler** |
| `npm run test:onboarding` (neu) | **62/62** — Vorschau wächst mit (Firma, Branche, Beschreibung, Säule, Farbe, Hashtags, Emojis, Aufruf, Kanal), Platzhalter statt erfundenem Text, Website-Vorschlag als Knopf mit Erklärung und Prüfschritt, kein horizontales Scrollen, axe ohne kritische/ernste Verstöße |
| `npm run test:admin` (neu) | **41/41** — Anmeldung (richtig/falsch), Statussatz, Kundenliste, Detail-Dialog mit Escape und Fokus-Rückgabe, eigener Eingabedialog statt `window.prompt`, kein horizontales Scrollen, axe ohne kritische/ernste Verstöße, **keine externen Anfragen** |
| `node scripts/live-smoke.mjs` (nach dem Livegang) | **13/13** — alle Dateien 200 (`index.html`, `panel.css`, `panel.js`, `admin.html`, Manifest, Schrift, Icon, `/api/health`), Seite rendert, Schrift selbst gehostet, **keine externen Anfragen**, keine Konsolenfehler, kein horizontales Scrollen bei 390 |
| Produktion während der Bauzeit unverändert | bis zum Livegang `md5sum public/panel/index.html` = `089c8228…` (wie bei `pre-redesign`); seither `653e985c…` |

Vier Fehler haben erst diese Tests gefunden: ein Beitragsbild ohne `max-width` sprengte bei 390 px
das Layout; der Reiterwechsel legte keinen History-Eintrag an (Zurück-Geste sprang aus dem Bereich);
`#einstellungen/<gruppe>` öffnete die Gruppe mobil nicht; abgebrochene View Transitions warfen einen
unbehandelten Fehler. Zusätzlich war die Überlauf-Prüfung selbst blind (sie verglich gegen
`innerWidth`, das bei Überlauf mitwächst) — sie prüft jetzt gegen die eingestellte Breite und nennt
das breiteste Element.

---

## 6. Schritte für Paul

### Sandbox-Adresse
**https://mcp.pipebot.at/panel/sandbox/** — zeigt seit dem Livegang dieselben Dateien wie
Produktion, aber weiterhin die Staging-Datenbank. Zum gefahrlosen Durchklicken mit Testkonten ist
sie also unverändert brauchbar; zum Bauen an einer neuen Fassung genügt künftig `PANEL_PUBLIC_DIR`
in der Staging-Umgebung.

Testkunden (echte Sandbox-Konten, keine Kundendaten):
- Ohne Freigabe-Modus: `…/panel/sandbox/login?key=<SANDBOX_KEY_A>`
- **Mit Freigabe-Modus** (hier liegen Beispiel-Freigaben und geplante Beiträge):
  `…/panel/sandbox/login?key=<SANDBOX_KEY_B>`

In diesem zweiten Konto liegen für den Rundgang **3 wartende Freigaben** und **4 geplante
Beiträge** bereit (direkt in der Staging-DB angelegt, reine Testdaten). Beides ist verbraucht,
sobald Sie es freigeben oder überspringen — zum Neuanlegen genügt ein Hinweis, das ist ein
Einzeiler.

### Admin-Seite (nur für Sie)
Live: **https://mcp.pipebot.at/panel/admin/** (echte Kunden) · Sandbox:
**https://mcp.pipebot.at/panel/sandbox/admin/** — Passwort wie gehabt aus der `.env`. Zu sehen sind
dort die zehn Testkunden der Staging-Datenbank, keine echten. Bitte kurz prüfen: Sagt Ihnen der
Satz ganz oben, ob etwas zu tun ist? Und fühlt sich die Kundenliste am Handy kürzer an als vorher?
(Bisher war diese Seite in der Sandbox gar nicht anmeldbar, siehe Abschnitt 4.)

### Handy-Checkliste (bitte am Telefon durchklicken)
1. Zweiten Link öffnen: Steht oben **ein** Satz, der sagt, was zu tun ist — nicht vier Kennzahlen?
2. Von dort **zwei Taps** bis zur Freigabe: „Beiträge" → „Zur Freigabe". Fühlt sich das kurz genug an?
3. „Freigeben" tippen: Verschwindet die Karte sofort und erscheint unten „Freigegeben. Rückgängig"?
4. Direkt „Rückgängig" tippen: Ist die Karte wieder da? (Es darf nichts veröffentlicht worden sein.)
5. Reiter „Geplant": Lassen sich die Tage seitlich wischen, öffnet „Text bearbeiten" die Felder?
6. Unten „Posten": Öffnet das Sheet von unten, sind die Kanal-Kacheln groß genug für den Daumen?
7. „Einstellungen": Sehen Sie **eine Liste** mit sieben Gruppen statt einer endlosen Seite?
   Eine Gruppe öffnen, etwas ändern, speichern, zurück — steht die Änderung noch da?
8. Zurück-Geste (vom linken Rand wischen): Landen Sie im vorigen Reiter statt aus dem Panel heraus?
9. Seite neu laden: Kommt der Splash beim zweiten Mal **nicht** mehr?
10. Gesamteindruck: Wirkt es ruhig und leicht — oder fehlt Ihnen etwas, das Sie vorher hatten?

Punkt 10 ist der wichtigste. Wenn irgendetwas fehlt, bitte notieren: die Inventur
(`docs/redesign/INVENTUR.md`) listet jede Funktion des alten Panels, wir hängen den Punkt dort an.

### Onboarding ansehen (ohne Konto)
**https://mcp.pipebot.at/panel/sandbox/?demo** — Vorschau-Modus: nichts wird gespeichert, keine
Verbindung aufgebaut. Tippen Sie Firmenname und ein, zwei Sätze zu Ihrem Geschäft ein und schauen
Sie zu, wie „Ihr erster Beitrag" darunter entsteht. Zwei Fragen dazu: Wird damit klarer, wofür die
Angaben gut sind? Und ist deutlich genug, dass das ein **Beispiel** ist und nicht der fertige
Beitrag? Vorher/Nachher: `docs/redesign/after/21-onboarding-*.png`.

### Livegang — erledigt am 15.09.2026, 13:45 Uhr (auf Ihre ausdrückliche Freigabe)
So ist es gelaufen:
1. Datenbank gesichert (`npm run backup:db`), Tag `pre-flow-live` auf den letzten Stand vor dem
   Livegang gesetzt.
2. `panel-redesign` nach `main` gemergt (Fast-Forward).
3. Sandbox-Weiche aus `src/panel/router.ts` entfernt; die CSP verschärft — `fonts.googleapis.com`
   und `fonts.gstatic.com` sind raus, weil nur noch das alte Panel sie brauchte. Das Panel lädt
   damit **nichts mehr von Dritten**.
4. `npm run build`.
5. **Erst** `pm2 restart instagram-mcp`, **unmittelbar danach** die Dateien nach `public/panel/`
   kopiert. Diese Reihenfolge ist wichtig: andersherum wäre das neue Panel für die Dauer des
   Neustarts live, während der alte Prozess `panel.css`/`panel.js` noch gar nicht ausliefern kann
   — es wäre für ein paar Sekunden kaputt gewesen. So blieb in diesen Sekunden das alte Panel voll
   funktionsfähig.
6. `node scripts/live-smoke.mjs` — 13/13 grün (siehe Nachweise). Danach `instagram-mcp-staging`
   neu gestartet, damit die Sandbox dieselben Dateien zeigt, und `public/panel-redesign` gelöscht.

Zum Zeitpunkt des Neustarts lief nachweislich kein Veröffentlichungslauf (0 aktive Anfragen,
letzter Beitrag drei Stunden alt) — sonst gilt weiterhin: **nicht** zwischen :38 und :48 neu
starten.

### Rollback
`git checkout pre-flow-live -- public/panel/ src/panel/router.ts && npm run build && pm2 restart instagram-mcp`

Das setzt Panel **und** Server-Code auf den Stand von vor dem Livegang zurück. `pre-redesign` zeigt
auf denselben Stand der Panel-Dateien und bleibt als zweiter Anker bestehen. Die Datenbank ist von
beidem nicht betroffen (kein Schema- und kein Datenänderung im Redesign); das Backup vom 15.09.
liegt unter `/root/backups/panel/`.
