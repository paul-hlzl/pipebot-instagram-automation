# Inventur Panel v20 (Ist-Zustand vor dem Redesign "Flow")

Vollständige Auflistung aller Funktionen, Zustände, Endpunkt-Aufrufe und Bedienelemente aus
`public/panel/index.html` (4126 Zeilen, 252 KB, Stand Commit `5c5b389`, Tag `pre-redesign`).

**Zweck:** Am Ende des Redesigns wird jede Zeile einzeln abgehakt. Nichts darf verloren gehen.

Legende Status: `[ ]` offen · `[x]` im neuen Panel vorhanden und getestet · `[–]` bewusst entfallen (mit Begründung)

---

## A. Ansichten (`S.step`)

| # | Step | Funktion | Status |
|---|---|---|---|
| A1 | `company` | Onboarding/Briefing-Formular, 2 Seiten (`formpart-a`/`formpart-b`) | [x] |
| A2 | `instagram` / `linkedin` | Kanal-Verbinden-Schritt pro Provider (dynamisch aus `/api/providers`) | [x] |
| A3 | `done` | Abschluss-Screen Erstanmeldung | [x] |
| A4 | `dashboard` | Übersicht (Landepunkt für wiederkehrende Kunden) | [x] |
| A5 | `preview` | Vorschau „Die nächsten 7 Tage" | [x] |
| A6 | `history` | Verlauf „Bereits veröffentlicht" | [x] |
| A7 | `analytics` | Analytics mit Instagram/LinkedIn-Reitern (v20) | [x] |
| A8 | `settings` | Einstellungen, 7 Gruppen | [x] |
| A9 | `guide` | „Was kann Pipeflow?" inkl. Rundgang-Neustart | [x] |
| A10 | `recover` | „Zugang verloren?" (ohne Session erreichbar) | [x] Markup übernommen; nur ohne Session erreichbar, nicht automatisiert geprüft |

## B. Endpunkt-Aufrufe (API-Verträge bleiben unverändert)

| # | Aufruf | Genutzt von | Status |
|---|---|---|---|
| B1 | `GET /api/providers` | Start, Feature-Flags (`aiAvailable`, `sandbox`, Turnstile-Key) | [x] |
| B2 | `GET /api/me` | Start, nach jedem Zustandswechsel | [x] |
| B3 | `PATCH /api/me` | Einstellungen speichern (**alle** Briefing-Felder, s. Abschnitt F) | [x] |
| B4 | `POST /api/signup` | Erstanmeldung (inkl. `consent`, Turnstile-Token) | [x] im Demo-Modus durchgespielt (Vorher-Screenshots); echter Signup nicht erneut ausgelöst |
| B5 | `DELETE /api/me` | Konto löschen (mit `confirm: true`) | [x] Bedienelement + Bestätigungsdialog vorhanden; Löschen bewusst nicht ausgelöst |
| B6 | `GET /api/posts` | Verlauf, „Letzte Beiträge" | [x] |
| B7 | `GET /api/planned-posts` | Vorschau 7 Tage | [x] |
| B8 | `PATCH /api/planned-posts/:id` | Headline/Caption bearbeiten | [x] |
| B9 | `POST /api/planned-posts/:id/approve` | Vorab freigeben (nur `approvalMode`) | [x] |
| B10 | `POST /api/planned-posts/:id/skip` | Beitrag überspringen | [x] |
| B11 | `POST /api/planned-posts/:id/regenerate-image` | Bild in neuer Farbe (Limit 3/Beitrag) | [x] |
| B12 | `POST /api/planned-posts/regenerate-for-branding` | Branding-Regen-Angebot (v18) | [x] |
| B13 | `GET /api/approvals` | Wartende Freigaben | [x] |
| B14 | `POST /api/approvals/:id/approve|reject` | Freigeben/Ablehnen | [x] |
| B15 | `GET /api/comment-approvals` | Kommentar-Antworten zur Freigabe | [x] |
| B16 | `POST /api/comment-approvals/:id/approve|reject` | Kommentar-Antwort freigeben/ablehnen | [x] |
| B17 | `POST /api/post-now` | „Jetzt posten" (Thema, Kanäle, Format) | [x] |
| B18 | `GET /api/analytics?channel=` | Analytics je Kanal (v20) | [x] |
| B19 | `POST /api/analytics-summary` | KI-Zusammenfassung (Kosten!) | [x] |
| B20 | `POST /api/improve-briefing` | KI: Briefing verbessern | [x] |
| B21 | `POST /api/analyze-website` | KI: Vorschlag aus Website | [x] |
| B22 | `POST /api/suggest-pillars` | KI: Content-Säulen per Websuche | [x] |
| B23 | `POST /api/suggest-topics` | KI: Themen-Ideen für „Jetzt posten" | [x] |
| B24 | `POST /api/help-chat` | Hilfe-Chat | [x] |
| B25 | `POST /api/transcribe-audio` | Diktat-Fallback (iOS) | [x] |
| B26 | `POST /api/logo` / `DELETE /api/logo` | Logo hochladen/entfernen | [x] |
| B27 | `POST /api/themes` / `/:id/activate` / `/deactivate` | Farbthemen | [x] |
| B28 | `POST /api/pause` | Posting pausieren/fortsetzen | [x] |
| B29 | `POST /api/disconnect/:provider` | Kanal trennen | [x] |
| B30 | `POST /api/skip-provider/:provider` | „Später verbinden" | [x] |
| B31 | `POST /api/access-link` | Persönlichen Zugangslink neu erzeugen | [x] |
| B32 | `POST /api/recover-access` | Zugang verloren | [x] Ansicht übernommen; Versand nicht ausgelöst |
| B33 | `POST /api/resend-verification` | Bestätigungsmail erneut senden | [x] |
| B34 | `POST /api/logout` | Abmelden | [x] |
| B35 | `POST /api/tour-done` | Rundgang als gesehen markieren | [x] |
| B36 | `GET /connect/:provider` (Link) | OAuth-Start (kein fetch, echte Navigation) | [x] |

## C. Zustände und Banner

| # | Zustand | Verhalten | Status |
|---|---|---|---|
| C1 | Intro-Splash (Türflügel) | 1,5 s bei **jedem** Laden | [–] **bewusst geändert**: nur noch einmal pro Browser-Sitzung, 1,1 s, Öffnen in Pixel-Stufen. Per `SPLASH_EVERY_LOAD` zurückdrehbar (REPORT.md Abschnitt 2) |
| C2 | Sandbox-Banner | gelb, „TESTVERSION", nur wenn `sandbox` aus `/api/providers` | [x] |
| C3 | Trialbar | „Probezeitraum: noch N Tage" bzw. abgelaufen + „Jetzt freischalten" | [x] |
| C4 | E-Mail-Bestätigungs-Banner | inkl. „Bestätigungsmail erneut senden" + Status | [x] |
| C5 | `needs-action`-Hinweis | Kanal abgelaufen/nicht verbunden usw. | [x] |
| C6 | Banner ok/bad (`S.banner`) | nach Speichern/Fehlern | [x] |
| C7 | Kunde pausiert | Anzeige + „Fortsetzen" | [x] |
| C8 | Verbindung `renew-soon` / `expired` | Badge + Text mit Ablaufdatum | [x] |
| C9 | Leere Zustände | Verlauf, Vorschau, Analytics, Freigaben | [x] |
| C10 | Ladezustände | „Wird geladen …" | [x] |
| C11 | Offline / Fehler beim Laden | „… konnte gerade nicht geladen werden." | [x] |

## D. Interaktive Bausteine

| # | Baustein | Details | Status |
|---|---|---|---|
| D1 | Schritt-Rail (`#rail`) | Onboarding-Fortschritt, Pipe-Knoten, `.is-current` | [x] |
| D2 | Hauptnavigation (`#mainnav`) | Übersicht/Beiträge/Einstellungen/Analytics/Was kann Pipeflow? + Badge | [–] **bewusst umgebaut**: vier Bereiche (Übersicht/Beiträge/Analytics/Einstellungen) als Bottom-Bar bzw. Kopfzeile; „Was kann Pipeflow?" liegt jetzt im Kontomenü. Zähler erhalten |
| D3 | Lightbox | Bild groß (`data-lightbox`) | [x] |
| D4 | Hilfe-Chat | Sheet, Verlauf, Eingabe, Schließen | [x] |
| D5 | Rundgang | 4 Schritte, Punkte, Weiter/Überspringen, `tour-done` | [x] |
| D6 | Eigene Dialoge | `showConfirm`/`showAlert`/`showError`, Fokus-Trap, Escape | [x] |
| D7 | `typeToConfirm` | Konto löschen: Firmenname eintippen | [x] |
| D8 | Diktierfunktion | Web Speech API + Server-Transkription (iOS), an allen Textfeldern | [x] |
| D9 | Turnstile | Signup-CAPTCHA (nur wenn Key gesetzt) | [x] Code unverändert; in der Sandbox ist der Turnstile-Key leer, daher nicht auslösbar |
| D10 | Kalender | Monatsraster, veröffentlicht/geplant, Legende | [–] **ersetzt** durch die Flow-Leiste (7 Tage, Pipe-Knoten, Legende). Das Monatsraster entfällt — dieselbe Information, weniger Fläche |
| D11 | Vorschau-Streifen | 7 Tage, Tagesauswahl, Detail | [x] |
| D12 | Beitrags-Detail (Vorschau) | Bild, Headline/Caption bearbeiten, Speichern-Status | [x] |
| D13 | Farb-Swatches | Akzentfarbe, Verlauf-Partner, gespeicherte Themen | [x] |
| D14 | Logo-Upload | Datei wählen, Vorschau, Entfernen | [x] |
| D15 | Wochentage | je Kanal (Instagram/LinkedIn) 7 Schalter | [x] |
| D16 | Content-Säulen | hinzufügen/entfernen, KI-Vorschläge übernehmen/verwerfen | [x] |
| D17 | „Jetzt posten" | Thema, Ideen-Chips, Kanal-Checkboxen, Format (Einzel/Karussell) | [x] |
| D18 | Einstellungs-Suche | `#set-search-input`, Sprungziele, „kein Treffer" | [x] |
| D19 | Formular-Seitenwechsel | `data-formpart` im Onboarding | [x] |
| D20 | Freigabe-Karten | Bild, Texte, Freigeben/Ablehnen | [x] |
| D21 | Kommentar-Freigaben | Kommentar + Antwortvorschlag, freigeben/ablehnen | [x] |
| D22 | Analytics-Reiter | Instagram/LinkedIn (v20), LinkedIn mit Erklärtext | [x] |
| D23 | Analytics-Diagramme | SVG-Linien Follower/Reichweite, Top-Beiträge | [x] |
| D24 | KI-Zusammenfassung | Button + Ergebnisbox + Stand-Zeitstempel | [x] |
| D25 | Branding-Regen-Angebot | Dialog nach Branding-Änderung (+ Zweitfrage bearbeitete Beiträge) | [x] |

## E. Einstellungs-Gruppen

| # | Gruppe | Inhalt | Status |
|---|---|---|---|
| E1 | Mein Unternehmen | Firmenname, Name, E-Mail, Website (+Website-Analyse), Branche, Beschreibung (+KI verbessern), Tonalität | [x] |
| E2 | Aussehen | Akzentfarbe + Swatches, Beschriftung/Wasserzeichen, Bildvorschau, Schriftwahl, Farbverlauf (an/aus, 2. Farbe, Richtung), gespeicherte Themen, Logo | [x] |
| E3 | Inhalt & Sprache | Content-Säulen (+KI), CTA-Präferenz, Hashtags, Sprache, Emojis, Pflichtwörter, verbotene Wörter, zu vermeidende Themen | [x] |
| E4 | Kanäle & Zeitplan | Kanal-Schalter (ig_feed/ig_story/linkedin), Karussell-Slides + Auto-Frequenz, Wochentage je Kanal, Uhrzeit, Pause von/bis, Posting pausieren | [x] |
| E5 | Freigaben & Automatik | Freigabe-Modus, Kommentar-Automatik an/aus + Modus (Freigabe/automatisch) | [x] |
| E6 | Benachrichtigungen | E-Mail bei Veröffentlichung, wöchentlicher Bericht | [x] |
| E7 | Konto | Verbundene Kanäle + trennen, Status/Trial, persönlicher Zugangslink, Abmelden, Konto löschen | [x] |

## F. Felder in `PATCH /api/me` (Vertrag, vollständig)

`company`, `contactName`, `email`, `website`, `industry`, `about`, `tone`, `frequency`, `postTime`,
`accentColor`, `watermarkText`, `avoidTopics`, `ctaPreference`, `bannedWords`, `requiredElements`,
`igFeedEnabled`, `igStoryEnabled`, `linkedinEnabled`, `hashtagPreference`, `emojisEnabled`,
`language`, `contentPillars[]`, `activeWeekdays`, `instagramWeekdays`, `linkedinWeekdays`,
`pauseFrom`, `pauseUntil`, `approvalMode`, `notifyOnPublish`, `notifyWeeklyReport`,
`commentAutomationEnabled`, `commentAutomationMode`, `carouselSlideCount`, `carouselAutoFrequency`,
`fontChoice`, `gradientEnabled`, `gradientColor2`, `gradientDirection`  → **[x] alle 38 Felder im Speichern nachgewiesen** (`scripts/redesign-func-test.mjs`). Ausnahme mit Begründung: `commentAutomationMode` fehlt, solange der Instagram-Verbindung der Kommentar-Scope fehlt — unverändertes Verhalten des alten Panels, siehe REPORT.md.

## G. Technische Rahmenbedingungen

| # | Punkt | Status |
|---|---|---|
| G1 | `CONFIG.mount` aus `location.pathname` (läuft unter `/panel` **und** `/panel/sandbox`) | [x] |
| G2 | Demo-Modus `?demo` mit `mockApi`, alle Zustände abbildbar | [x] |
| G3 | `esc()` konsequent, kein ungeescaptes `innerHTML` | [x] |
| G4 | CSP eingehalten, keine externen CDNs | [x] |
| G5 | `npm run test:panel` grün | [x] |
| G6 | `admin.html` funktionsgleich | [–] **offen**: unverändert übernommen, noch nicht auf die neuen Tokens gezogen (Phase 6) |

---

## Bekannte Schwächen (Ausgangspunkt, siehe Auftrag Abschnitt 2)

1. Wirkt wie ein sauberes Formular, kein Produkt — kein visueller Anker.
2. Mobil nachträglich angepasst: Hauptnavigation bricht zweizeilig um, Rail nur noch Symbole.
3. Übersicht ist eine Blockliste; der wichtigste Zustand steht klein in einer Statuszeile.
4. Uneinheitliche Begriffe („Beiträge" vs. „Vorschau", „Verlauf" vs. „Ihre bisherigen Beiträge").
5. Emojis als Icons (💬, ✕, ⚠️).
6. Ladezustände nur „Wird geladen …".
7. Uppercase-Labels, hartkodierte Farben außerhalb der Tokens (`#C9C9C9`, `#FDF2E0`, `#E8C468`, `#FFF3CD`).
8. Schibsted Grotesk von Google Fonts (DSGVO-Risiko in AT/DE).
9. Splash bei jedem Reload (1,5 s).

### Zusätzlich gefunden (nicht im Auftrag genannt)

10. **Produktion und Sandbox teilen sich `public/panel/index.html`** — die Datei wird per
    `sendFile` direkt von der Platte gelesen. Eine Änderung wäre **ohne Deploy sofort in
    Produktion live**. Für das Redesign daher Sandbox auf `public/panel-redesign` umgelenkt
    (`PANEL_SANDBOX=true`), Produktion bleibt unverändert auf `public/panel`.
11. **CSP erlaubt kein `font-src 'self'`** — selbst gehostete Schriften wären blockiert gewesen.
12. **Kein `express.static` für das Panel-Verzeichnis** — nur `index.html` per `sendFile`; eine
    Aufteilung in CSS/JS brauchte deshalb eine zusätzliche Route.
13. `/panel/fonts` liefert bereits `assets/fonts` aus (für die Schrift-Live-Vorschau) — damit ist
    das Selbsthosten der UI-Schrift ohne neue Route möglich.
14. Kein Deep-Linking: Ansicht liegt nur in `S.step`, die URL ändert sich nie → Zurück-Geste am
    Handy verlässt das Panel, E-Mail-Links können nicht auf eine Ansicht zeigen.


---

## Abgleich am Ende des Redesigns

Abgehakt heißt: im neuen Panel vorhanden **und** geprüft — automatisiert
(`scripts/redesign-func-test.mjs`, `redesign-inventory-test.mjs`, `redesign-undo-test.mjs`,
`redesign-a11y.mjs`, `redesign-check.mjs`) oder per Screenshot in `after/`.

**Nicht abgehakt, ehrlich offen:**
- **G6 `admin.html`** - unverändert übernommen, noch nicht auf die neuen Tokens gezogen.
- Pfade, die in der Sandbox nicht auslösbar sind (echter OAuth, echtes Veröffentlichen, Turnstile,
  E-Mail-Versand, Konto löschen): Markup und Logik sind unverändert übernommen, der Vollzug wurde
  bewusst nicht ausgelöst.
- Komfort-Punkte aus Abschnitt 7 des Auftrags, die nicht gebaut wurden, stehen in `REPORT.md`
  Abschnitt 4 und in `IDEEN.md` - sie waren nie Teil der Inventur, sind also kein Verlust.
