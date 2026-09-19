# Report: Easy Onboarding (Sandbox-Auftrag, Fassung vom 19.09.2026)

**Stand: nur Sandbox.** Nichts auf Produktion, `/root/panel-live` nicht angefasst. Anschauen:

**https://mcp.pipebot.at/panel/sandbox/start/**

Das klassische Panel liegt unverändert daneben unter `https://mcp.pipebot.at/panel/sandbox/`
(für einen Kunden aus dem neuen Flow: `?classic=1`). Branch `feature/easy-onboarding` im
Worktree `/root/mcp-sandbox`. Designplan: `docs/EASY_ONBOARDING_DESIGN.md`. Screenshots aus
echtem Chromium bei 360 und 1440 px: `docs/easy-onboarding/shots/`. Farbproben:
`docs/easy-onboarding/farben/`.

---

## 1. Anmeldung über Google, Microsoft, Apple - Stand und Aufwand

**Stand 19.09.2026, 11:05 Uhr:** Microsoft ist eingetragen und der Knopf ist live geschaltet -
aber der gelieferte Clientschlüssel ist die **Geheimnis-ID**, nicht der **Wert**, und wird von
Microsoft abgelehnt (AADSTS7000215, zweimal gegengeprüft: einmal mit dem eingetragenen Wert,
einmal mit einem absichtlich falschen - beide Male dieselbe Ablehnung). Bis der richtige Wert da
ist, bricht die Anmeldung im letzten Schritt ab und zeigt „Die Anmeldung mit Microsoft ist noch
nicht fertig eingerichtet." Google und Apple sind unverändert ohne Zugangsdaten.

**Was fehlt und nur du anlegen kannst:** die Anbieter-Apps selbst und ihre Schlüssel. Der
Auftrag sagt ausdrücklich, dass du sie anlegst, nicht ich.

**Gebaut ist er vollständig**, nicht als Attrappe: `src/panel/auth-providers.ts` und die Routen
`/auth/:provider` und `/auth/:provider/callback` sprechen echtes OpenID Connect im
Authorization-Code-Flow mit vertraulichem Client. Sobald zwei Umgebungsvariablen gesetzt sind,
ist der Knopf live - **keine Code-Änderung nötig**.

**Getestet ist er Ende zu Ende**, gegen einen eigenen, regelkonformen Attrappen-Anbieter
(`scripts/test-auth.mjs`, 21 Prüfungen, alle grün): Weiterleitung mit `state` und `nonce`,
Code-Tausch mit Client-Secret, Profilabruf, Kontoanlage, Wiedererkennen beim zweiten Mal,
Verknüpfen mit einem bestehenden Konto, Abbruch durch den Nutzer, gefälschter `state`,
zweifache Verwendung desselben Rückwegs. Was dieser Test **nicht** beweist: dass Google sich
exakt so verhält wie die Attrappe. Das zeigt erst der erste echte Anmeldeversuch.

### Was du anlegen musst

| Anbieter | Wo | Aufwand bei dir | Kosten | Aufwand bei mir danach |
|---|---|---|---|---|
| **Google** | Google Cloud Console, „OAuth-Client-ID", Typ Webanwendung | ca. 10 Minuten | keine | ca. 15 Minuten (eintragen, echt durchklicken) |
| **Microsoft** | Microsoft Entra, „App-Registrierung" | ca. 10 Minuten | keine | ca. 15 Minuten |
| **Apple** | Apple Developer Program nötig | ca. 1 Stunde plus Wartezeit auf die Freischaltung | **99 USD im Jahr** | ca. 3 Stunden (siehe unten) |

Einzutragende Weiterleitungsadressen (beide, Sandbox und später Produktion; für Microsoft
bereits verbindlich, zeichengenau aus der laufenden Sandbox ausgelesen):

```
https://mcp.pipebot.at/panel/sandbox/auth/microsoft/callback
https://mcp.pipebot.at/panel/sandbox/auth/google/callback
https://app.pipeflow.at/auth/microsoft/callback
https://app.pipeflow.at/auth/google/callback
```

(Die Produktionsadressen erst eintragen, wenn der Flow wirklich dorthin geht.) Was du mir gibst:
Client-ID und Client-**Secret-Wert**. Ich trage sie als `AUTH_<ANBIETER>_CLIENT_ID` und
`AUTH_<ANBIETER>_CLIENT_SECRET` in `/root/staging.ecosystem.json` ein (Rechte 600, außerhalb des
Repos) - **nicht** in `/root/mcp-sandbox/.env`, denn das ist ein Symlink auf die gemeinsame
Produktions-`.env`, und ein Eintrag dort würde beim nächsten Neustart auch den
Produktionsprozess erreichen.

**Mandant:** `AUTH_MICROSOFT_TENANT` wird bewusst **nicht** gesetzt, damit der Code den
`common`-Endpunkt nimmt. Mit der Verzeichnis-ID könnte sich nur dein eigener Mandant anmelden.
Live gegengeprüft: die Weiterleitung geht an
`https://login.microsoftonline.com/common/oauth2/v2.0/authorize`.

**Warum Apple mehr ist als 99 Dollar:** Apple verlangt statt eines festen Client-Secrets ein
selbst signiertes JWT (ES256) aus einem privaten Schlüssel, das **höchstens sechs Monate** gilt
und danach jedes Mal neu erzeugt werden muss - das ist eine wiederkehrende Wartungsaufgabe, kein
einmaliges Eintragen. Außerdem liefert Apple Name und E-Mail **nur beim allerersten Anmelden**
mit; wer das Konto einmal löscht und neu anlegt, bekommt sie nie wieder. Und mit „E-Mail
verbergen" kommt eine Weiterleitungsadresse (`@privaterelay.appleid.com`), an die wir zwar
schreiben können, die aber als Kundenadresse im Panel unbrauchbar aussieht. Mein Vorschlag:
Apple erst, wenn ein Kunde ausdrücklich danach fragt. Im Panel steht der Knopf sichtbar da und
sagt ehrlich „kommt noch", es ist nichts nachgebaut.

**Der E-Mail-Weg bleibt** als Rückfalloption unter den drei Knöpfen, wie beauftragt: Adresse
eingeben, Konto entsteht sofort, Bestätigungsmail geht raus, und der Bestätigungsschritt bleibt
für diesen Weg bestehen. Bei einem Anbieter-Login entfällt er ersatzlos - die Adresse ist dort
bereits bestätigt.

---

## 2. Kosten pro neuem Konto, mit Rechenweg

Grundpreise, gemessen an den eigenen Protokollen (`usage_costs`) und den Modellpreisen:
Textgenerierung Haiku 4.5, ein Beitrag ≈ **0,0015 USD**, Website-Analyse ≈ **0,003 USD**,
ein fal.ai-Bild = **0,003 USD**. Kurs 1 EUR = 1,08 USD.

**Wichtiger Befund, der die Rechnung verändert:** Sobald Markenfarben erkannt werden, rendert
die Bildpipeline den Hintergrund als Farbverlauf **lokal** und ruft fal.ai gar nicht auf
(`gradient.ts`, seit Panel v15). Die Bilder sind dann **kostenlos**. Bis heute hat
`planning.ts` trotzdem pauschal 0,003 USD je Bild gebucht - das war systematisch zu hoch für
genau diese Kunden. Ich habe das korrigiert: `generateImageUrl` gibt jetzt zurück, was das Bild
tatsächlich gekostet hat, und nur das wird gebucht.

| Fall | Analyse | 10 Texte | 10 Bilder | Summe USD | **Summe EUR** |
|---|---|---|---|---|---|
| **Konto mit erkannten Markenfarben** (Regelfall) | 0,003 | 0,015 | 0,000 (Verlauf, lokal) | 0,018 | **≈ 0,017 €** |
| Konto ohne Markenfarben (stiller Fallback) | 0,003 | 0,015 | 0,030 | 0,048 | **≈ 0,044 €** |
| dazu einmal „Anders machen" | 0,002 | 0,015 | 0,000 / 0,030 | +0,017 / +0,047 | +0,016 € / +0,044 € |
| **Schlimmster Fall, ein Konto, ein Tag** (3 Vorschauen erlaubt) | | | | 0,195 | **≈ 0,18 €** |

Gemessener echter Lauf (Testkunde, `pipeflow.at`, ohne Markenfarben, drei Bilder vor der
Bestätigung): 0,026 USD ≈ 0,024 €.

**Für deine Preisgestaltung:** rechne mit **2 Cent pro neuem Konto** im Regelfall und **5 Cent**
im teuersten. Der laufende Betrieb danach ist der eigentliche Posten: eine Woche pro Woche sind
bei Markenfarben-Kunden rund 1,5 Cent, sonst rund 4,5 Cent - also unter 2,50 € pro Kunde und
Jahr an KI-Kosten, solange keine Videos dazukommen.

---

## 3. Kostenschutz (Abschnitt 8) - alles serverseitig

In `src/panel/start-quota.ts`, Tabelle `start_previews`, neustartfest (nicht der
In-Memory-Zähler aus `router.ts`). Im Browser wird nichts davon durchgesetzt.

| Grenze (Umgebungsvariable) | Standard |
|---|---|
| Vorschauen je **Konto** und Tag (`PANEL_PREVIEW_PER_ACCOUNT_DAY`) | 3 |
| Vorschauen je **IP** und Tag (`PANEL_PREVIEW_PER_IP_DAY`) | 3 |
| Vorschauen je **Domain** und Tag (`PANEL_PREVIEW_PER_DOMAIN_DAY`) | 2 |
| Vorschauen **weltweit** je Tag (`PANEL_PREVIEW_GLOBAL_DAY`) | 40 |
| Neue Konten je IP und Tag | 5 |
| Echte Bilder vor der E-Mail-Bestätigung (`PANEL_PREVIEW_IMAGES_UNVERIFIED`) | 3 |
| „Anders machen" vor der Bestätigung (`PANEL_PREVIEW_ADJUST_UNVERIFIED`) | 1 |
| Beiträge je unbestätigtem Konto (`PANEL_PREVIEW_POSTS_UNVERIFIED`) | 14 |
| Zwischenspeicher je Domain (`PANEL_DOMAIN_CACHE_HOURS`) | 168 (7 Tage) |

Dazu: eine schon analysierte Domain wird aus `domain_cache` bedient - keine zweite Analyse, kein
zweiter Abruf der Website, und der Deckel greift für sie gar nicht erst. Turnstile läuft
unsichtbar direkt vor der Vorschau, aber **nur** für Konten aus dem E-Mail-Weg; nach einem
Anbieter-Login wäre es doppelt geprüft.

Die Variante aus Abschnitt 8 („die ersten zwei bis drei Tage mit echtem Bild, Rest als
Textkarte") ist für den E-Mail-Weg umgesetzt: drei echte Bilder, der Rest bekommt eine
Platzhalterkachel, die wie das echte Bild gebaut ist (Markenverlauf, Schlagzeile in der
Bildschrift, gedrehtes Wasserzeichen) und den Hinweis „Bild folgt nach der Bestätigung" trägt.
Nach dem Klick auf den Bestätigungslink werden sie im Hintergrund nachgezogen. Ein Konto aus
einem Anbieter-Login bekommt die Woche gleich vollständig - dort ist die Adresse ja bestätigt.

**Nachweis:** `npm run test:start` befüllt die Zählertabelle direkt und ruft dann mehrfach auf.
Alle vier Deckel antworten mit 429 und dem richtigen Grund (`account`, `ip`, `domain`, `global`),
Zähler älter als 24 Stunden zählen nicht mehr, die Domain-Normalisierung greift
(`https://www.X/` = `X`), eine zweite Vorschau für dasselbe Konto wird abgelehnt, und der
zweite Kunde auf derselben Domain zahlt keine Analyse mehr. Dazu `npm run test:start-quota`
(6 Prüfungen der reinen Entscheidungslogik).

---

## 4. Markenfarben aus der Website (Abschnitt 6)

`src/panel/brand-colors.ts`. Drei Stufen: sammeln, wegwerfen, tauglich machen.

**Sammeln** (mit unterschiedlichem Gewicht): `<meta name="theme-color">` und
`msapplication-TileColor`, CSS-Variablen deren Name nach Marke klingt (`--brand`, `--primary`,
`--accent`, `--cta` …), sonstige CSS-Variablen, Flächenfarben (`background`, `fill`), alle
übrigen Farbangaben, dazu Logo und Favicon (per `sharp` auf 48 px verkleinert, Pixel gezählt,
durchsichtige Bereiche ignoriert). Bis zu drei Stylesheets, eigene Herkunft bevorzugt.
Kein Screenshot, kein Headless-Browser - das wäre pro Aufruf mehrere Sekunden und ein weiterer
Dienst im Betrieb.

**Wegwerfen:** alles über 93 % Helligkeit (Weiß), unter 4 % (Schwarz), unter 18 % Sättigung
(Grau), blasse Pastelltöne, und eine Liste der Hausfarben fremder Dienste - Facebook,
Instagram, LinkedIn, YouTube, WhatsApp, Google, TikTok, Pinterest, Amazon, Stripe, PayPal,
Discord. Ohne diese Liste ist die „Markenfarbe" der meisten Handwerksbetriebe das Blau eines
Social-Icons im Fußbereich. Preis dieser Entscheidung: eine Marke, deren echte Farbe zufällig
genau Facebook-Blau ist, verliert sie hier.

**Tauglich machen:** Auf dem Beitragsbild steht **weiße** Schlagzeile. Jede übernommene Farbe
wird deshalb so weit abgedunkelt, bis der Kontrast zu Weiß 4,5:1 erreicht (WCAG AA), unter
Beibehaltung von Farbton und Sättigung. Lesbarkeit geht vor Treue. Der Verlaufspartner ist die
nächstbeste Farbe mit deutlich anderem Farbton - aber nur, wenn sie mindestens 40 % der
Punktzahl der Hauptfarbe erreicht, sonst wird aus der Hauptfarbe selbst ein dunklerer Ton
abgeleitet. (Ohne diese Regel bekam Apple neben sein Markenblau ein olivgrünes Kachelgrün aus
einem einzelnen `style`-Attribut.)

**Fallback:** Findet sich nichts Brauchbares, bleibt still das Standardthema. Keine Fehlermeldung,
kein leeres Feld - der Nutzer merkt nichts davon.

### Ergebnis an fünf echten Websites

Erzeugt mit `node scripts/brand-colors-proof.mjs`, die Bilder liegen in
`docs/easy-onboarding/farben/` und sind **echte Beitragsbilder** aus derselben Pipeline, die auch
der Kunde bekommt (Schlagzeile, Wasserzeichen, 4:5).

| Website | Akzent | Partner | Quelle | Anmerkung |
|---|---|---|---|---|
| pipeflow.at | #0a0e1a | #1a1a2e | **Fallback** | fast nur Weiß, Schwarz und Grau - nichts Brauchbares, stilles Standardthema |
| hittaro.com | #8f6d33 | #d53f2a | CSS-Variable `--accent` | aus #d9c4a0 abgedunkelt, sonst wäre weiße Schrift unlesbar |
| orf.at | #b81818 | #3b76ba | Logo/Favicon | ORF-Rot, unverändert übernommen |
| apple.com | #0071e3 | #062877 | CSS-Variable | Apple-Blau, Partner aus der Hauptfarbe abgeleitet |
| oebb.at | #111b42 | #e41c68 | Flächenfarbe | Navy und Pink aus dem Designsystem |

Vier von fünf liefern sichtbar die Marke, bei der fünften greift der Fallback still - das ist
genau Abnahmekriterium 4. Dass ausgerechnet **unsere eigene** Website das Fallback-Beispiel ist,
ist keine Schwäche der Erkennung: pipeflow.at ist schwarz-weiß-grau gestaltet.

Laufzeit: 60 ms bis 1,4 s je Website, im selben Abruf wie die Textanalyse (die Seite wird nur
einmal geladen).

---

## 5. Klick- und Feldzählung: vorher gegen nachher

**Vorher** (klassisches Onboarding, vier Wizard-Seiten): Pflichteingaben bis zum Abschicken sind
Firmenname, Ansprechperson, E-Mail und das Zustimmungs-Häkchen = **4 Pflichteingaben**. Klicks:
dreimal „Weiter", einmal absenden, zweimal „Später verbinden" = **6 Klicks** bis zum Dashboard -
und dort ist **kein einziger Beitrag** zu sehen. Die Vorausplanung läuft erst um 03:00 Uhr und
nur für bestätigte Adressen; das erste echte Ergebnis kommt also frühestens am nächsten Morgen,
nach einem weiteren Klick im Postfach.

**Nachher:** **eine Eingabe (die Domain) und zwei Klicks** bis zur fertigen Woche. Mit
Anbieter-Login: „Mit Google fortfahren" (1), Domain tippen, „Vorschau erstellen" (2). Über den
E-Mail-Weg kommt ein Klick dazu („Mit E-Mail fortfahren"), also drei - beides innerhalb der
geforderten Grenze. Erster fertiger Beitrag nach rund **11 Sekunden**, die ganze Woche nach rund
**25 Sekunden**. Bis dahin hat der Besucher **nichts** eingestellt: Themen, Ton, Farben,
Rhythmus, Kanäle und Freigabe kommen aus der Website.

Kein Bildschirm des neuen Flows hat mehr als ein Pflichtfeld; der Browser-Test zählt das je
Bildschirm einzeln. Buttons: Bildschirme 1 bis 5 haben höchstens zwei (die drei Anmeldeknöpfe
auf Bildschirm 1 zähle ich als eine Gruppe, wie im Vorbild). Ausnahmen mit Absicht: „Verbinden"
hat einen Knopf je Kanal plus „Zum Dashboard", das Dashboard hat die Aktionen an den Karten.

---

## 6. Wie die Vorausplanung sofort läuft - ohne Umbau der Routine

Die Kundenschleife aus `planUpcomingPosts()` ist als `planCustomerWeek(row, opts)`
herausgelöst - gleiche Slot-Auswahl, gleiche Idempotenz über `getPlannedPostByChannelDate`,
gleiche Säulen-Rotation. Der Nachtlauf ruft sie auf wie bisher; das Onboarding ruft sie sofort
für den gerade angelegten Kunden auf, mit drei parallelen Arbeitern und den Deckeln aus
Abschnitt 3. Neu dazu: `generatePost(..., { withImage: false })` für die Textkarten,
`backfillMissingImages()` für das Nachziehen nach der Bestätigung und `recolorPlannedPosts()`
für den Farbwechsel.

**Die Routine bei claude.ai braucht keine Änderung.** Sie liest weiterhin nur über
`get_planned_post` und `list_customers`, ob für heute eine Zeile existiert und ob der Kunde
fällig ist. Ein unbestätigter Kunde ist wie bisher nie fällig. Das Tor, durch das die Routine
jeden vorbereiteten Beitrag holt (`ensureFreshPlannedPost`), prüft zusätzlich „Bild fehlt?" und
zieht es nach - eine Zeile ohne Bild erreicht die Routine nie als „Bild existiert schon". Es
liegt deshalb auch kein Prompt-Text in `docs/` zur Freigabe.

**Drag-and-drop geht sauber.** `reorderPlannedPosts()` tauscht nur die vorhandenen Termine
innerhalb eines Kanals unter Zeilen mit Status planned/edited/approved. Es entsteht nie ein
zweiter Beitrag für denselben Kanal und Tag und nie ein neuer Termin - im Test per SQL
gegengeprüft. Bedienung: Ziehen am Griff und Pfeile hoch/runter (44 px, auch mit Tastatur).

---

## 7. Tests

| Lauf | Ergebnis |
|---|---|
| `npm run test:auth` (Anmeldung Ende zu Ende gegen Attrappen-Anbieter) | **21 passed, 0 failed** |
| `npm run test:start-quota` (Kostenschutz-Logik) | **6 passed, 0 failed** |
| `npm run test:start` (HTTP gegen Staging, echte Vorschau) | **60 passed, 0 failed** |
| `npm run test:start-browser` (Chromium 360 und 1440 px, jeder Bildschirm) | **141 Prüfungen, 0 Probleme** |
| `npm run test:prod-copy` (Sandbox-Build gegen Kopie der Produktions-DB) | **64 passed, 0 failed** |
| `npm run test:panel` (bestehende Suite, 251 Prüfungen) | **251 passed, 0 failed** |
| `npm run test:backoff` | **15 passed, 0 failed** |
| `npm run audit:panel` | ein Befund, **vorbestehend auch auf `main`** (87 `ob-*`-Klassen; die Prüfung liest `onboarding.css` nicht). Beide Oberflächen sind erfasst: jeder API-Aufruf hat eine Route, jede Route wird aufgerufen. |
| `npm run test:onboarding` (klassisches Onboarding) | **schlägt fehl, vorbestehend**: das Skript sucht `#fp-progress`, das es seit dem Umbau vom 18.09. auch auf `main` nicht mehr gibt. Am klassischen Panel wurde in diesem Auftrag nichts geändert. |

Was der Browser-Lauf im Einzelnen belegt: drei Anmeldewege sichtbar und ehrlich als „kommt
noch" gekennzeichnet, Kopfzeile mit Produktname und Zusatzzeile auf jedem Bildschirm, fünf
Fortschrittsschritte einschließlich „Farben übernommen", erster fertiger Beitrag nach 4
Sekunden, drei echte Bilder und sieben Platzhalter vor der Bestätigung, **kein leerer Tag** im
Ergebnis und im Dashboard, die Vorschaukarten ändern sich beim Ziehen am Farbregler live mit,
Umsortieren per Pfeil vom Server bestätigt, nach der Bestätigung null Platzhalter übrig. Je
Bildschirm geprüft: nichts über den Rand, höchstens ein Pflichtfeld, Tap-Ziele ab 44 px, keine
Überlappung, keine JavaScript-Fehler.

Unterwegs gefunden und behoben, damit es nicht wie „lief sofort" aussieht: `/start` ohne Slash
wurde hinter dem Sandbox-Proxy falsch umgeleitet; das Polling endete stumm beim Wechsel von
„Es arbeitet" auf „Ergebnis"; jedes Neuzeichnen blendete den Bildschirm neu ein (Flackern);
das Turnstile-Token war beim schnellen Tippen noch nicht da; Tap-Ziele unter 44 px im Dashboard;
Kanaltexte in der Sie-Form; die Kostenbuchung für lokal gerenderte Bilder; der
Einmal-Anmeldelink statt des Ersetzens des dauerhaften Zugangslinks (die erste Fassung hätte
jedem Fremden erlaubt, den gespeicherten Link eines Kunden zu entwerten - der Test hat es
aufgedeckt); „Mit Microsoft fortfahren" brach bei 360 px zweizeilig um; und die Rhythmus-Zeile
zeigte „3× pro Woche, 3× pro Woche", weil die Zahl zweimal angehängt wurde.

Ein Lauf davor meldete einen einzelnen 502-Fehler - den hatte ich selbst verursacht, weil ich
den Sandbox-Prozess mitten im Browser-Test neu gestartet habe. Der abschließende Lauf ist
ungestört gelaufen.

---

## 8. Nachweis: Produktion unberührt

Baseline vor Beginn (`docs/easy-onboarding/baseline-produktion.txt`) und Kontrolle danach
(`docs/easy-onboarding/kontrolle-produktion.txt`, erzeugt mit
`scripts/easy-onboarding-baseline-check.sh`, nur lesend):

- `instagram-mcp` unverändert PID 420644, Neustartzähler 7, nicht neu gestartet.
- Alle Dateien in `/root/panel-live` mit identischer Prüfsumme - das Verzeichnis wurde in diesem
  Auftrag überhaupt nicht angefasst (Regel 4).
- `/root/mcp-live` auf Commit `6b4f913`, Arbeitsbaum sauber, `dist/index.js` mit dem Zeitstempel
  vom 18.09. - dort wurde nicht gebaut. Gebaut wird ausschließlich im Worktree `/root/mcp-sandbox`.
- Produktions-Datenbank `panel.db` nur lesend geöffnet (`mode=ro`), weiterhin 68 Spalten in
  `customers`, keine Tabelle `start_previews`.
- Neu gestartet wurde nur `instagram-mcp-staging`, außerhalb der Minute :43 und außerhalb der
  Sperrzeiten.

Geändert am Server außerhalb des Repos, alles Sandbox: `/root/staging.ecosystem.json` (zeigt auf
den Worktree; Sicherung `.bak-20260919`), `pm2 save`, `/root/panel-work/start/`,
`/root/sandbox-keys.env` (die beiden Testschlüssel waren ungültig, neu erzeugt; Sicherung
`.bak-20260919`), `/root/backups/panel-staging-vor-easy-onboarding-20260919.db`.

### Dateien, die ein späterer Produktions-Schritt bräuchte

Server (Build aus dem gemergten Branch, dann Neustart außerhalb :43):
`src/panel/db.ts`, `router.ts`, `planning.ts`, `credentials.ts`, `emails.ts`, `src/anthropic.ts`,
`src/fal.ts`, `src/ssrf-safe-fetch.ts`, neu `src/panel/start-routes.ts`, `start-analysis.ts`,
`start-jobs.ts`, `start-quota.ts`, `brand-colors.ts`, `auth-providers.ts`, `tiers.ts`.
Statisch nach `/root/panel-live`, ausschließlich über `node scripts/deploy-panel.mjs produktion`:
neu `start/index.html`, `start/start.css`, `start/start.js`.
Umgebung: nichts zwingend (alle Deckel haben Standardwerte); für den Login zusätzlich
`AUTH_GOOGLE_CLIENT_ID` und `AUTH_GOOGLE_CLIENT_SECRET`. Nginx: nichts.

---

## 9. Offene Entscheidungen für dich

1. **Anbieter-Apps anlegen** (Abschnitt 1). Ohne sie bleibt der Hauptweg der E-Mail-Weg.
2. **Apple ja oder nein** - 99 USD im Jahr plus halbjährlich neu zu erzeugendes Secret.
3. **Dunkel war deine Vorgabe aus Abschnitt 9, das klassische Panel ist hell.** Der neue Flow
   ist jetzt dunkel; wer über „Einstellungen" ins klassische Panel wechselt, erlebt einen
   sichtbaren Bruch. Entweder das klassische Panel folgt später nach, oder wir bleiben hell.
   Umschalten kostet mich etwa eine Stunde, die Farben sind sechs Tokens in `start.css`.
4. **„Du" statt „Sie".** Der neue Flow duzt, das klassische Panel siezt.
5. **Zustimmung als Satz statt Häkchen** auf Bildschirm 1 (ein Pflichtfeld weniger). Ob das
   rechtlich reicht, gehört zu dir bzw. deiner Rechtsberatung. `consent_at` wird gesetzt.
6. **Bekannte E-Mail-Adresse wird erkennbar.** Wer eine fremde Adresse eintippt, erfährt, ob sie
   Kunde ist (Limit 15 pro Stunde und IP). Der verschickte Link ist ein Einmal-Link, der
   dauerhafte Zugangslink bleibt unangetastet.
7. **Vorbelegungen:** werktags 15:00, Instagram-Feed und LinkedIn, Story aus, Freigabe an. Die
   Story ist aus, weil sie die Kosten verdoppelt; ein Klick im Plan schaltet sie ein.
8. **Deckelhöhen** aus Abschnitt 3, besonders die 40 Vorschauen pro Tag weltweit.
9. **Wer bekommt den neuen Flow?** Heute nur, wer `/start/` aufruft. Vorschlag für später:
   Nicht-Angemeldete auf `app.pipeflow.at` dorthin leiten, Bestandskunden bleiben klassisch.
10. **Preisstufen setzen** geht derzeit nur per SQL (`plan_tier`); ein Admin-Schalter fehlt
    bewusst.

---

## 10. Was ich NICHT im echten Browser getestet habe

- **Die echte Anmeldung bei Google, Microsoft oder Apple.** Getestet ist der komplette Ablauf
  gegen einen selbst gebauten, regelkonformen Anbieter - nicht gegen Google.
- **Echte Instagram- und LinkedIn-Verbindung** aus Bildschirm 6 heraus (in der Sandbox sind die
  Provider-Schlüssel bewusst leer).
- **Echter E-Mail-Versand.** Die Sandbox schreibt Mails nur ins Log. Der Bestätigungslink wurde
  im Test durch direktes Setzen des Token-Hashs ausgelöst - derselbe Serverpfad, aber ohne
  Postfach.
- **Turnstile mit Produktionsschlüssel** im „Managed"-Modus; getestet nur mit Cloudflares
  Testschlüsseln.
- **Drag-and-drop mit der Maus.** Im Browser-Test sind nur die Pfeiltasten geklickt; die
  HTML5-Drag-Ereignisse sind nicht automatisiert. Touch-Ziehen gibt es bewusst nicht, dafür die
  Pfeile.
- **Safari, iOS und Firefox** - alles nur Chromium.
- **„Jetzt posten" bis zur Veröffentlichung.** Die Anfrage wird angenommen; die Ausführung liegt
  bei der Routine, die in der Sandbox nicht läuft.
- **Der Weg ohne Website** ist im Browser nur als Bildschirm samt „Mit KI verbessern" geprüft,
  die Generierung darüber nur über denselben Serverpfad im Code.
- **Verhalten bei einem Ausfall von Anthropic oder fal.ai mitten im Lauf** (Fehlerbildschirm) -
  nur im Code, nicht provoziert.
- **Die Farberkennung an mehr als fünf Websites.** Fünf sind belegt, eine davon als Fallback.

---

## 11. Rollback in einem Satz

`cp /root/staging.ecosystem.json.bak-20260919 /root/staging.ecosystem.json && pm2 delete
instagram-mcp-staging && pm2 start /root/staging.ecosystem.json && pm2 save && rm -r
/root/panel-work/start` - danach läuft Staging wieder aus `/root/mcp-live`, der Worktree bleibt
als Branch erhalten, und Produktion hat von alldem ohnehin nie etwas gesehen.
