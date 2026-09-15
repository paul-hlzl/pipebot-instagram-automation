# Inventur Panel v20 (Ist-Zustand vor dem Redesign "Flow")

Vollständige Auflistung aller Funktionen, Zustände, Endpunkt-Aufrufe und Bedienelemente aus
`public/panel/index.html` (4126 Zeilen, 252 KB, Stand Commit `5c5b389`, Tag `pre-redesign`).

**Zweck:** Am Ende des Redesigns wird jede Zeile einzeln abgehakt. Nichts darf verloren gehen.

Legende Status: `[ ]` offen · `[x]` im neuen Panel vorhanden und getestet · `[–]` bewusst entfallen (mit Begründung)

---

## A. Ansichten (`S.step`)

| # | Step | Funktion | Status |
|---|---|---|---|
| A1 | `company` | Onboarding/Briefing-Formular, 2 Seiten (`formpart-a`/`formpart-b`) | [ ] |
| A2 | `instagram` / `linkedin` | Kanal-Verbinden-Schritt pro Provider (dynamisch aus `/api/providers`) | [ ] |
| A3 | `done` | Abschluss-Screen Erstanmeldung | [ ] |
| A4 | `dashboard` | Übersicht (Landepunkt für wiederkehrende Kunden) | [ ] |
| A5 | `preview` | Vorschau „Die nächsten 7 Tage" | [ ] |
| A6 | `history` | Verlauf „Bereits veröffentlicht" | [ ] |
| A7 | `analytics` | Analytics mit Instagram/LinkedIn-Reitern (v20) | [ ] |
| A8 | `settings` | Einstellungen, 7 Gruppen | [ ] |
| A9 | `guide` | „Was kann Pipeflow?" inkl. Rundgang-Neustart | [ ] |
| A10 | `recover` | „Zugang verloren?" (ohne Session erreichbar) | [ ] |

## B. Endpunkt-Aufrufe (API-Verträge bleiben unverändert)

| # | Aufruf | Genutzt von | Status |
|---|---|---|---|
| B1 | `GET /api/providers` | Start, Feature-Flags (`aiAvailable`, `sandbox`, Turnstile-Key) | [ ] |
| B2 | `GET /api/me` | Start, nach jedem Zustandswechsel | [ ] |
| B3 | `PATCH /api/me` | Einstellungen speichern (**alle** Briefing-Felder, s. Abschnitt F) | [ ] |
| B4 | `POST /api/signup` | Erstanmeldung (inkl. `consent`, Turnstile-Token) | [ ] |
| B5 | `DELETE /api/me` | Konto löschen (mit `confirm: true`) | [ ] |
| B6 | `GET /api/posts` | Verlauf, „Letzte Beiträge" | [ ] |
| B7 | `GET /api/planned-posts` | Vorschau 7 Tage | [ ] |
| B8 | `PATCH /api/planned-posts/:id` | Headline/Caption bearbeiten | [ ] |
| B9 | `POST /api/planned-posts/:id/approve` | Vorab freigeben (nur `approvalMode`) | [ ] |
| B10 | `POST /api/planned-posts/:id/skip` | Beitrag überspringen | [ ] |
| B11 | `POST /api/planned-posts/:id/regenerate-image` | Bild in neuer Farbe (Limit 3/Beitrag) | [ ] |
| B12 | `POST /api/planned-posts/regenerate-for-branding` | Branding-Regen-Angebot (v18) | [ ] |
| B13 | `GET /api/approvals` | Wartende Freigaben | [ ] |
| B14 | `POST /api/approvals/:id/approve|reject` | Freigeben/Ablehnen | [ ] |
| B15 | `GET /api/comment-approvals` | Kommentar-Antworten zur Freigabe | [ ] |
| B16 | `POST /api/comment-approvals/:id/approve|reject` | Kommentar-Antwort freigeben/ablehnen | [ ] |
| B17 | `POST /api/post-now` | „Jetzt posten" (Thema, Kanäle, Format) | [ ] |
| B18 | `GET /api/analytics?channel=` | Analytics je Kanal (v20) | [ ] |
| B19 | `POST /api/analytics-summary` | KI-Zusammenfassung (Kosten!) | [ ] |
| B20 | `POST /api/improve-briefing` | KI: Briefing verbessern | [ ] |
| B21 | `POST /api/analyze-website` | KI: Vorschlag aus Website | [ ] |
| B22 | `POST /api/suggest-pillars` | KI: Content-Säulen per Websuche | [ ] |
| B23 | `POST /api/suggest-topics` | KI: Themen-Ideen für „Jetzt posten" | [ ] |
| B24 | `POST /api/help-chat` | Hilfe-Chat | [ ] |
| B25 | `POST /api/transcribe-audio` | Diktat-Fallback (iOS) | [ ] |
| B26 | `POST /api/logo` / `DELETE /api/logo` | Logo hochladen/entfernen | [ ] |
| B27 | `POST /api/themes` / `/:id/activate` / `/deactivate` | Farbthemen | [ ] |
| B28 | `POST /api/pause` | Posting pausieren/fortsetzen | [ ] |
| B29 | `POST /api/disconnect/:provider` | Kanal trennen | [ ] |
| B30 | `POST /api/skip-provider/:provider` | „Später verbinden" | [ ] |
| B31 | `POST /api/access-link` | Persönlichen Zugangslink neu erzeugen | [ ] |
| B32 | `POST /api/recover-access` | Zugang verloren | [ ] |
| B33 | `POST /api/resend-verification` | Bestätigungsmail erneut senden | [ ] |
| B34 | `POST /api/logout` | Abmelden | [ ] |
| B35 | `POST /api/tour-done` | Rundgang als gesehen markieren | [ ] |
| B36 | `GET /connect/:provider` (Link) | OAuth-Start (kein fetch, echte Navigation) | [ ] |

## C. Zustände und Banner

| # | Zustand | Verhalten | Status |
|---|---|---|---|
| C1 | Intro-Splash (Türflügel) | 1,5 s bei **jedem** Laden | [ ] |
| C2 | Sandbox-Banner | gelb, „TESTVERSION", nur wenn `sandbox` aus `/api/providers` | [ ] |
| C3 | Trialbar | „Probezeitraum: noch N Tage" bzw. abgelaufen + „Jetzt freischalten" | [ ] |
| C4 | E-Mail-Bestätigungs-Banner | inkl. „Bestätigungsmail erneut senden" + Status | [ ] |
| C5 | `needs-action`-Hinweis | Kanal abgelaufen/nicht verbunden usw. | [ ] |
| C6 | Banner ok/bad (`S.banner`) | nach Speichern/Fehlern | [ ] |
| C7 | Kunde pausiert | Anzeige + „Fortsetzen" | [ ] |
| C8 | Verbindung `renew-soon` / `expired` | Badge + Text mit Ablaufdatum | [ ] |
| C9 | Leere Zustände | Verlauf, Vorschau, Analytics, Freigaben | [ ] |
| C10 | Ladezustände | „Wird geladen …" | [ ] |
| C11 | Offline / Fehler beim Laden | „… konnte gerade nicht geladen werden." | [ ] |

## D. Interaktive Bausteine

| # | Baustein | Details | Status |
|---|---|---|---|
| D1 | Schritt-Rail (`#rail`) | Onboarding-Fortschritt, Pipe-Knoten, `.is-current` | [ ] |
| D2 | Hauptnavigation (`#mainnav`) | Übersicht/Beiträge/Einstellungen/Analytics/Was kann Pipeflow? + Badge | [ ] |
| D3 | Lightbox | Bild groß (`data-lightbox`) | [ ] |
| D4 | Hilfe-Chat | Sheet, Verlauf, Eingabe, Schließen | [ ] |
| D5 | Rundgang | 4 Schritte, Punkte, Weiter/Überspringen, `tour-done` | [ ] |
| D6 | Eigene Dialoge | `showConfirm`/`showAlert`/`showError`, Fokus-Trap, Escape | [ ] |
| D7 | `typeToConfirm` | Konto löschen: Firmenname eintippen | [ ] |
| D8 | Diktierfunktion | Web Speech API + Server-Transkription (iOS), an allen Textfeldern | [ ] |
| D9 | Turnstile | Signup-CAPTCHA (nur wenn Key gesetzt) | [ ] |
| D10 | Kalender | Monatsraster, veröffentlicht/geplant, Legende | [ ] |
| D11 | Vorschau-Streifen | 7 Tage, Tagesauswahl, Detail | [ ] |
| D12 | Beitrags-Detail (Vorschau) | Bild, Headline/Caption bearbeiten, Speichern-Status | [ ] |
| D13 | Farb-Swatches | Akzentfarbe, Verlauf-Partner, gespeicherte Themen | [ ] |
| D14 | Logo-Upload | Datei wählen, Vorschau, Entfernen | [ ] |
| D15 | Wochentage | je Kanal (Instagram/LinkedIn) 7 Schalter | [ ] |
| D16 | Content-Säulen | hinzufügen/entfernen, KI-Vorschläge übernehmen/verwerfen | [ ] |
| D17 | „Jetzt posten" | Thema, Ideen-Chips, Kanal-Checkboxen, Format (Einzel/Karussell) | [ ] |
| D18 | Einstellungs-Suche | `#set-search-input`, Sprungziele, „kein Treffer" | [ ] |
| D19 | Formular-Seitenwechsel | `data-formpart` im Onboarding | [ ] |
| D20 | Freigabe-Karten | Bild, Texte, Freigeben/Ablehnen | [ ] |
| D21 | Kommentar-Freigaben | Kommentar + Antwortvorschlag, freigeben/ablehnen | [ ] |
| D22 | Analytics-Reiter | Instagram/LinkedIn (v20), LinkedIn mit Erklärtext | [ ] |
| D23 | Analytics-Diagramme | SVG-Linien Follower/Reichweite, Top-Beiträge | [ ] |
| D24 | KI-Zusammenfassung | Button + Ergebnisbox + Stand-Zeitstempel | [ ] |
| D25 | Branding-Regen-Angebot | Dialog nach Branding-Änderung (+ Zweitfrage bearbeitete Beiträge) | [ ] |

## E. Einstellungs-Gruppen

| # | Gruppe | Inhalt | Status |
|---|---|---|---|
| E1 | Mein Unternehmen | Firmenname, Name, E-Mail, Website (+Website-Analyse), Branche, Beschreibung (+KI verbessern), Tonalität | [ ] |
| E2 | Aussehen | Akzentfarbe + Swatches, Beschriftung/Wasserzeichen, Bildvorschau, Schriftwahl, Farbverlauf (an/aus, 2. Farbe, Richtung), gespeicherte Themen, Logo | [ ] |
| E3 | Inhalt & Sprache | Content-Säulen (+KI), CTA-Präferenz, Hashtags, Sprache, Emojis, Pflichtwörter, verbotene Wörter, zu vermeidende Themen | [ ] |
| E4 | Kanäle & Zeitplan | Kanal-Schalter (ig_feed/ig_story/linkedin), Karussell-Slides + Auto-Frequenz, Wochentage je Kanal, Uhrzeit, Pause von/bis, Posting pausieren | [ ] |
| E5 | Freigaben & Automatik | Freigabe-Modus, Kommentar-Automatik an/aus + Modus (Freigabe/automatisch) | [ ] |
| E6 | Benachrichtigungen | E-Mail bei Veröffentlichung, wöchentlicher Bericht | [ ] |
| E7 | Konto | Verbundene Kanäle + trennen, Status/Trial, persönlicher Zugangslink, Abmelden, Konto löschen | [ ] |

## F. Felder in `PATCH /api/me` (Vertrag, vollständig)

`company`, `contactName`, `email`, `website`, `industry`, `about`, `tone`, `frequency`, `postTime`,
`accentColor`, `watermarkText`, `avoidTopics`, `ctaPreference`, `bannedWords`, `requiredElements`,
`igFeedEnabled`, `igStoryEnabled`, `linkedinEnabled`, `hashtagPreference`, `emojisEnabled`,
`language`, `contentPillars[]`, `activeWeekdays`, `instagramWeekdays`, `linkedinWeekdays`,
`pauseFrom`, `pauseUntil`, `approvalMode`, `notifyOnPublish`, `notifyWeeklyReport`,
`commentAutomationEnabled`, `commentAutomationMode`, `carouselSlideCount`, `carouselAutoFrequency`,
`fontChoice`, `gradientEnabled`, `gradientColor2`, `gradientDirection`  → [ ] alle im neuen Panel

## G. Technische Rahmenbedingungen

| # | Punkt | Status |
|---|---|---|
| G1 | `CONFIG.mount` aus `location.pathname` (läuft unter `/panel` **und** `/panel/sandbox`) | [ ] |
| G2 | Demo-Modus `?demo` mit `mockApi`, alle Zustände abbildbar | [ ] |
| G3 | `esc()` konsequent, kein ungeescaptes `innerHTML` | [ ] |
| G4 | CSP eingehalten, keine externen CDNs | [ ] |
| G5 | `npm run test:panel` grün | [ ] |
| G6 | `admin.html` funktionsgleich | [ ] |

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
