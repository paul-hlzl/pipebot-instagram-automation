# Designplan „Easy Onboarding" (Sandbox-Auftrag, 19.09.2026)

Vorbild: ads.openai.com (Onboarding des ChatGPT Ads Managers), 1:1 in der Anmutung, nur mit
Pipeflow-Funktionen. Gemessen am 19.09.2026 im Headless-Browser gegen die Live-Seite (nicht
geschätzt): Hintergrund Weiß, Text `#0d0d0d`, Sekundärtext `#5d5d5d`, eine Sans-Schrift
(„OpenAI Sans"), Überschriften Gewicht 500 mit leicht negativer Laufweite, Buttons als Pillen
(Radius 9999px, Höhe 40 px, 14 px, Gewicht 500), Primär schwarz gefüllt, Sekundär als Umriss.
Karten mit 1 px heller Linie, großer Radius, kein Schatten. Viel Weißraum, eine Spalte.

Abweichung zum Auftragstext („ruhig und dunkel"): Die zweite Nachricht („genau so wie
ads.openai.com, 1:1") hat Vorrang - das Vorbild ist hell. Das bestehende Panel ist ebenfalls
hell (`--paper #fff`), die Verwandtschaft bleibt also erhalten. Falls doch dunkel gewünscht:
alle Farben sind Tokens in `start.css`, ein Umschalten ist ein Block. **Offene Entscheidung für
Paul, siehe Report.**

## 1. Farbe (Tokens in `public/panel/start/start.css`)

| Token | Wert | Rolle |
|---|---|---|
| `--paper` | `#ffffff` | Fläche |
| `--ink` | `#0d0d0d` | Text, Primärbutton, Fokusring (gemessen am Vorbild) |
| `--ink-2` | `#5d5d5d` | Sekundärtext, Sekundärbutton-Rand (gemessen) |
| `--line` | `#e6e6e6` | Trennlinien, Kartenrand, Eingabefeld-Rand |
| `--wash` | `#f7f7f5` | ruhige Hinterlegung (Tabellenzeile, Platzhalter-Kachel) |
| `--go` / `--stop` | `#137a3f` / `#b42318` | ausschließlich Bedeutung: Erfolg / Fehler (aus panel.css übernommen) |

Keine weiteren Farbtöne im UI. Die einzige „Farbe" auf der Seite ist die **Akzentfarbe des
Kunden** in den Beitragskarten - die Seite nimmt ihre Farbe vom Kunden, nicht von Pipeflow.

## 2. Schrift (selbst gehostet, CSP erlaubt nur `font-src 'self'`)

| Rolle | Schrift | Größe / Gewicht |
|---|---|---|
| Wortmarke „Pipeflow" | Instrument Serif 400 | 22 px - der eine Faden zum bestehenden Panel |
| Display (Titel je Bildschirm) | Inter 500, `letter-spacing -0.02em` | `clamp(30px, 6vw, 44px)`, Zeilenhöhe 1.08 |
| Fließtext | Inter 400 | 16 px / 1.5 (Eingabefelder ebenfalls 16 px: kein iOS-Zoom) |
| Sekundär | Inter 400 | 14 px, `--ink-2` |
| Mikro (Kanal-Badge, Datum) | Inter 500 | 12 px, `tabular-nums` |
| Headline im Beitragsbild | die Bildschrift des Kunden (Standard Inter 700) | Karte rendert sie wie das echte Bild |

OpenAI Sans ist nicht frei verfügbar; Inter ist die nächste selbst gehostete Verwandte und
liegt bereits unter `assets/fonts/`. Keine Mono-Kleinlabels (das Vorbild hat keine).

## 3. Leitprinzipien

1. **Das System schlägt vor, der Nutzer korrigiert.** Kein Feld ist je leer. Jede Vorbelegung
   hat einen Stift, der ein Inline-Feld an Ort und Stelle öffnet.
2. **Ein Bildschirm, eine Aufgabe.** Höchstens ein Pflichtfeld, ein Primärbutton, ein
   sekundärer Link. Alles Weitere lebt hinter „Einstellungen" oder im klassischen Panel.
3. **Der Beitrag ist der Held.** Die Wochenkarten sind das größte und schärfste Element; sie
   zeigen das Bild im echten Seitenverhältnis des Kanals (4:5 Instagram, 1.91:1 LinkedIn).
4. **Ehrlich warten.** Fortschritt in Klartext, Schritt für Schritt; die Woche erscheint
   Beitrag für Beitrag, sobald er fertig ist (das ist der eine Bewegungsmoment des Ergebnis-
   Bildschirms). Kein Endlos-Spinner.
5. **Ein Wort, eine Bedeutung.** Beitrag (nie Post/Posting), Kanal (nie Plattform/Provider),
   Freigabe (nie Genehmigung), Vorschau (nie Preview), verbinden (nie verknüpfen). Buttons
   sagen, was passiert.

## 4. Bildschirme (ASCII, Handybreite 360 px; Desktop: dieselbe Spalte, max. 560 px, zentriert;
   Wochenansicht auf Desktop bis 1040 px)

```
1 Einstieg                         1b Wiederkehrend
┌──────────────────────────┐       ┌──────────────────────────┐
│ Pipeflow                 │       │ Pipeflow                 │
│                          │       │                          │
│ Deine Beiträge.          │       │ Willkommen zurück        │
│ Jede Woche. Automatisch. │       │ ┌──────────────────────┐ │
│ Pipeflow schreibt und    │       │ │ ● Hölzl Physio       │ │
│ gestaltet, du gibst frei.│       │ │   Weiter als …    →  │ │
│ ┌──────────────────────┐ │       │ └──────────────────────┘ │
│ │ E-Mail-Adresse       │ │       │ Mit anderem Konto        │
│ └──────────────────────┘ │       │ anmelden                 │
│ [    Los geht's        ] │       └──────────────────────────┘
│ Mit „Los geht's" stimmst │
│ du der Datenverarbeitung │
│ zu. Datenschutz          │
└──────────────────────────┘

2 Die eine Frage                   2b Ohne Website
┌──────────────────────────┐       ┌──────────────────────────┐
│ Pipeflow                 │       │ Was macht dein           │
│ So könnte deine erste    │       │ Unternehmen?             │
│ Woche aussehen           │       │ ┌──────────────────────┐ │
│ ┌──────────────────────┐ │       │ │ (Textfeld, 3 Zeilen) │ │
│ │ deine-website.at     │ │       │ └──────────────────────┘ │
│ └──────────────────────┘ │       │ [  Vorschau erstellen  ] │
│ [  Vorschau erstellen  ] │       │ Nichts wird veröffent-   │
│ Nichts wird veröffent-   │       │ licht, bevor du es       │
│ licht, bevor du es       │       │ freigibst.               │
│ freigibst.               │       └──────────────────────────┘
│ Ich habe keine Website   │
└──────────────────────────┘

3 Es arbeitet                      4 Das Ergebnis
┌──────────────────────────┐       ┌──────────────────────────┐
│ Pipeflow                 │       │ Pipeflow                 │
│ Wir lesen deine Website  │       │ Deine nächste Woche      │
│ ✓ Website gelesen        │       │ ist fertig               │
│ ✓ Themen erkannt         │       │ Wir haben sie rund um    │
│ ● Beiträge entworfen 4/10│       │ Rückenschmerzen und      │
│ ○ Bilder erstellt        │       │ Prävention geplant - zwei│
│   (dauert gerade etwas   │       │ Themen, die auf hoelzl…  │
│    länger …)             │       │ besonders hervorstachen. │
│                          │       │ ┌──────────────────────┐ │
└──────────────────────────┘       │ │ Mo 21.9. · Instagram │ │
                                   │ │ ┌──────────────────┐ │ │
                                   │ │ │  [Bild 4:5]      │ │ │
                                   │ │ │  Headline im Bild│ │ │
                                   │ │ └──────────────────┘ │ │
                                   │ │ Caption … mehr       │ │
                                   │ └──────────────────────┘ │
                                   │ ┌ Mo 21.9. · LinkedIn ─┐ │
                                   │ │ [Bild 1.91:1] …      │ │
                                   │ └──────────────────────┘ │
                                   │ Sa 26.9. · kein Beitrag  │
                                   │ …                        │
                                   │ ─── klebt unten ───────  │
                                   │ [    Passt, weiter     ] │
                                   │ Anders machen            │
                                   └──────────────────────────┘

4b Anders machen                   5 Der Plan
┌──────────────────────────┐       ┌──────────────────────────┐
│ Was soll anders sein?    │       │ Dein Plan                │
│ ┌──────────────────────┐ │       │ Unternehmen  Hölzl Physio│
│ │ z. B. „lockerer, keine│ │       │              Physiothe…✎ │
│ │ Preise nennen"        │ │       │ Themen       Rücken, …  ✎│
│ └──────────────────────┘ │       │ Kanäle       Instagram   │
│ [  Neu erstellen       ] │       │              LinkedIn   ✎│
│ Zurück zur Vorschau      │       │ Rhythmus     Werktags   ✎│
└──────────────────────────┘       │ Farbe        ■ #0a0e1a  ✎│
                                   │ Freigabe     An         ✎│
                                   │  Jeder Beitrag wartet auf│
                                   │  dein OK, bevor er raus- │
                                   │  geht.                   │
                                   │ [   Plan übernehmen    ] │
                                   └──────────────────────────┘

6 Verbinden                        Dashboard
┌──────────────────────────┐       ┌──────────────────────────┐
│ Kanäle verbinden         │       │ Pipeflow      Einstellungen│
│ ┌──────────────────────┐ │       │ ⚠ E-Mail bestätigen …    │
│ │ ◎ Instagram verbinden│ │       │ Als Nächstes             │
│ └──────────────────────┘ │       │ ┌──────────────────────┐ │
│ Später verbinden         │       │ │ Mo 21.9. · Instagram │ │
│ ┌──────────────────────┐ │       │ │ [Bild]               │ │
│ │ in LinkedIn verbinden│ │       │ │ Headline             │ │
│ └──────────────────────┘ │       │ │ [Freigeben] Jetzt    │ │
│ Später verbinden         │       │ │             posten   │ │
│ [   Zum Dashboard      ] │       │ └──────────────────────┘ │
└──────────────────────────┘       │ ≡ Karten per Griff       │
                                   │   umsortierbar           │
                                   │ ─────────────────────── │
                                   │ Einstellungen (Plan wie  │
                                   │ Bildschirm 5, Verbinden, │
                                   │ Verlauf, Klassisches     │
                                   │ Panel)                   │
                                   └──────────────────────────┘
```

Konstruktiv gegen überlappende Labels: keine horizontale Schritt-Navigation. Der Fortschritt in
Bildschirm 3 ist eine vertikale Liste; der Rest hat keinen Stepper. Nichts kann sich überlappen,
weil nichts nebeneinander steht, das nicht umbrechen darf.

## 5. Bewegung

Genau ein Moment pro Bildschirm: (1) keiner, (2) keiner, (3) das Häkchen rastet ein, (4) jede
fertige Karte blendet einmal ein (opacity/translateY 8px, 320 ms), (5) das Inline-Feld klappt
auf (Höhe), (6) keiner, Dashboard: die Karte beim Umsortieren gleitet. `prefers-reduced-motion`
setzt alle Dauern auf 1 ms. Der bestehende Intro-Splash aus `index.html` wird unverändert
übernommen (einmal pro Browser-Sitzung).

## 6. Selbstprüfung: „käme dieser Plan auch für ein beliebiges SaaS heraus?"

Erster Entwurf: ja. Weiß, Inter, schwarze Pillen, zentrierte Karte, Fortschrittsliste - das ist
jedes Onboarding von 2026. Geändert gegenüber dem ersten Entwurf:

1. **Die Seite trägt die Farbe des Kunden, nicht unsere.** Beitragskarten rendern Hintergrund
   (Akzentfarbe/Verlauf), Schrift und Wasserzeichen exakt so, wie die Bildpipeline sie baut.
   Der Ergebnis-Bildschirm eines Physiotherapeuten sieht anders aus als der eines Tischlers.
2. **Die Woche ist eine Woche.** Sieben Tageszeilen Mo-So mit Datum, ruhige Tage bleiben als
   schmale Zeile sichtbar („kein Beitrag - Wochenende"). Keine anonyme Kartenliste.
3. **Die Erklärung nennt die Quelle.** „… zwei Themen, die auf hoelzl-physio.at besonders
   hervorstachen" - die Domain, die der Nutzer selbst getippt hat, steht im Satz.
4. **Wortmarke in der Serif des bestehenden Panels** statt eines weiteren Sans-Logos. Das
   ist der einzige Schmuck und zugleich die Brücke zur alten Oberfläche.
5. **Karten ohne Rahmen-Einheitsbrei:** Nur die Beitragskarte hat einen Rand. Plan-Zeilen sind
   Zeilen mit Trennlinie, Fortschritt ist eine Liste, Buttons sind Pillen. Drei Formen, drei
   Bedeutungen.
