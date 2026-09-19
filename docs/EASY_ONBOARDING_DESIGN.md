# Designplan „Easy Onboarding" (Sandbox-Auftrag, 19.09.2026)

Vorbild: ads.openai.com (Onboarding des ChatGPT Ads Managers), 1:1 in der Anmutung, nur mit
Pipeflow-Funktionen. Gemessen am 19.09.2026 im Headless-Browser gegen die Live-Seite (nicht
geschätzt): Hintergrund Weiß, Text `#0d0d0d`, Sekundärtext `#5d5d5d`, eine Sans-Schrift
(„OpenAI Sans"), Überschriften Gewicht 500 mit leicht negativer Laufweite, Buttons als Pillen
(Radius 9999px, Höhe 40 px, 14 px, Gewicht 500), Primär schwarz gefüllt, Sekundär als Umriss.
Karten mit 1 px heller Linie, großer Radius, kein Schatten. Viel Weißraum, eine Spalte.

Zur Farbstimmung, die zwischendurch zweimal gewechselt hat: Der Auftrag sagt in Abschnitt 9
„ruhig und dunkel gehalten, im Charakter des bestehenden Panels". Beides zusammen geht nicht -
das bestehende Panel ist weiss, und ads.openai.com ebenfalls. Gebaut war kurzzeitig eine dunkle
Fassung; **entschieden und umgesetzt ist jetzt hell** (19.09.2026). Der Umbau war ein einziger
Token-Block: jede Regel in `start.css` benutzt ausschliesslich die sechs Tokens, keine festen
Farben. Die drei verbliebenen festen Weisswerte sind Absicht - sie stehen auf der Markenfarbe
des Kunden (Kachel-Schlagzeile, Vorschau im Farbpicker, Schalter-Knauf) und muessen dort weiss
bleiben, weil das echte Beitragsbild es auch ist.

## 1. Farbe (Tokens in `public/panel/start/start.css`)

| Token | Wert | Rolle |
|---|---|---|
| `--grund` | `#ffffff` | Seitenhintergrund |
| `--flaeche` | `#fbfbfa` | Karten, Felder, alles Erhobene |
| `--linie` | `#e5e5e2` | Trennlinien, Kartenrand, Eingabefeld-Rand |
| `--text` | `#0d0d0d` | Fließtext und Überschriften (am Vorbild gemessen) |
| `--text-2` | `#5d5d5d` | Sekundärtext, Beschriftungen (gemessen) |
| `--aktion` / `--aktion-text` | `#0d0d0d` / `#ffffff` | Hauptaktion: schwarze Pille, weiße Schrift |
| `--wash` | `#f2f2f0` | neutrale Hinterlegung hinter einem Bild |
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
1 Konto                            1b Wiederkehrend
┌──────────────────────────┐       ┌──────────────────────────┐
│ Pipeflow                 │       │ Pipeflow                 │
│ powered by Pipeline AI…  │       │ powered by Pipeline AI…  │
│                          │       │                          │
│ Deine Beiträge.          │       │ Willkommen zurück        │
│ Jede Woche. Automatisch. │       │ ┌──────────────────────┐ │
│ Pipeflow liest deine     │       │ │ (H) Hittaro          │ │
│ Website, erkennt Themen  │       │ │  Weiter als …     →  │ │
│ und Farben …             │       │ └──────────────────────┘ │
│ ┌──────────────────────┐ │       │ Mit einem anderen Konto  │
│ │ G  Mit Google …      │ │       │ anmelden                 │
│ ├──────────────────────┤ │       └──────────────────────────┘
│ │ ▣  Mit Microsoft …   │ │
│ ├──────────────────────┤ │       1c Nur E-Mail
│ │ ⌘  Mit Apple …       │ │       ┌──────────────────────────┐
│ └──────────────────────┘ │       │ Mit E-Mail fortfahren    │
│ ────────  oder  ──────── │       │ ┌──────────────────────┐ │
│ [ Mit E-Mail fortfahren ]│       │ │ E-Mail-Adresse       │ │
│ Mit dem Fortfahren       │       │ └──────────────────────┘ │
│ stimmst du zu … Daten-   │       │ [       Weiter         ] │
│ schutzerklärung          │       │ Zurück zu Google, …      │
└──────────────────────────┘       └──────────────────────────┘

2 Die eine Frage                   2b Ohne Website
┌──────────────────────────┐       ┌──────────────────────────┐
│ So könnte deine nächste  │       │ Was macht dein           │
│ Woche aussehen           │       │ Unternehmen?             │
│ ┌──────────────────────┐ │       │ ┌──────────────────────┐ │
│ │ deine-firma.at       │ │       │ │ (Textfeld)           │ │
│ └──────────────────────┘ │       │ │      [Mit KI verbes.]│ │
│ [  Vorschau erstellen  ] │       │ └──────────────────────┘ │
│ Nichts wird veröffent-   │       │ [  Vorschau erstellen  ] │
│ licht, bevor du es       │       │ Ich habe doch eine       │
│ freigibst.               │       │ Website                  │
│ Ich habe keine Website   │       └──────────────────────────┘
└──────────────────────────┘

3 Es arbeitet                      4 Das Ergebnis
┌──────────────────────────┐       ┌──────────────────────────┐
│ Wir lesen hittaro.com    │       │ So könnte deine nächste  │
│ ✓ Website gelesen        │       │ Woche aussehen.          │
│ ✓ Themen erkannt         │       │ Wir haben diese Beiträge │
│   KI-Sichtbarkeit, …     │       │ rund um X und Y erstellt │
│ ✓ Farben übernommen      │       │ - zwei Themen, die auf   │
│   ■■ #8f6d33             │       │ hittaro.com besonders    │
│ ● Beiträge entworfen 4/10│       │ hervorstachen. Die Farben│
│ ○ Bilder erstellt  0/3   │       │ stammen von deiner Seite.│
│                          │       │ Mo 21.9. Montag          │
│ (dauert gerade etwas     │       │ ┌──────────────────────┐ │
│  länger …)               │       │ │ INSTAGRAM            │ │
└──────────────────────────┘       │ │ ┌──────────────────┐ │ │
                                   │ │ │ [Bild 4:5 in der │ │ │
KEINE leeren Tage: Samstag und     │ │ │  Markenfarbe]    │ │ │
Sonntag erscheinen gar nicht,      │ │ └──────────────────┘ │ │
nicht als graue Karte, nicht als   │ │ Headline             │ │
Zeile. Nur Tage mit Beitrag.       │ │ Caption … mehr       │ │
                                   │ └──────────────────────┘ │
                                   │ Di 22.9. Dienstag        │
                                   │ …                        │
                                   │ ══ klebt unten ════════  │
                                   │ [    Passt, weiter     ] │
                                   │ Anders machen            │
                                   └──────────────────────────┘

5 Der Plan                         5b Farbe bearbeiten (inline)
┌──────────────────────────┐       ┌──────────────────────────┐
│ Dein Plan                │       │ … Vorschaukarten oben …  │
│ ┌────┐┌────┐┌────┐       │       │ Farbe                    │
│ │Vor-││schau││karten│    │       │ ┌──────────────────────┐ │
│ └────┘└────┘└────┘       │       │ │  Beispiel (Verlauf)  │ │
│ Unternehmen  Hittaro   ✎ │       │ └──────────────────────┘ │
│ Themen       ○ ○ ○     ✎ │       │ Hauptfarbe ● ● ● ● ● ⬤  │
│ Kanäle       IG, LI    ✎ │       │ [x] Farbverlauf statt    │
│ Rhythmus     Werktags  ✎ │       │     einer Farbe          │
│ Farbe        ■ #8F6D33 ✎ │       │ Zweite Farbe ● ● ● ⬤     │
│ Freigabe     An        ✎ │       │ Richtung (Diag)(Waag)(Sen)│
│ [   Plan übernehmen    ] │       │ [Speichern] Abbrechen    │
└──────────────────────────┘       └──────────────────────────┘

6 Verbinden                        Dashboard
┌──────────────────────────┐       ┌──────────────────────────┐
│ Kanäle verbinden         │       │ Pipeflow    Einstellungen│
│ ┌──────────────────────┐ │       │ So sehen deine nächsten  │
│ │ ◎ Instagram verbinden│ │       │ Tage aus   [Jetzt posten]│
│ └──────────────────────┘ │       │ ⚠ Instagram noch nicht   │
│ Ihre Beiträge erscheinen…│       │   verbunden  [Verbinden] │
│ Später verbinden         │       │ Wartet auf deine Freigabe│
│ ┌──────────────────────┐ │       │ ┌──────────────────────┐ │
│ │ in LinkedIn verbinden│ │       │ │ [Bild] Headline      │ │
│ └──────────────────────┘ │       │ │ [Freigeben] Ablehnen │ │
│ Später verbinden         │       │ └──────────────────────┘ │
│ [   Zum Dashboard      ] │       │ Geplant   ↑↓ oder Ziehen │
└──────────────────────────┘       │ Mo 21.9. …               │
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
