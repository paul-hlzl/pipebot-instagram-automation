# Designplan „Flow" — Pipeflow Panel

Grundlage: Auftrag „Design-Rework Flow", Inventur in `INVENTUR.md`, Ist-Screenshots in `before/`.

**Leitsatz:** Das Interface schweigt, damit zwei Dinge sprechen: die Beiträge des Kunden und die
Pipe. Alles andere ist Schrift und Weißraum.

---

## 1. Tokens

### 1.1 Farbe (unverändert in der Bedeutung, nur vollständig gemacht)

| Token | Wert | Rolle |
|---|---|---|
| `--paper` | `#FFFFFF` | Fläche |
| `--ink` | `#000000` | Text, Primäraktion, aktive Zustände, gefüllte Pipe-Knoten |
| `--stone` | `#666666` | Sekundärtext |
| `--rule` | `#E3E3E3` | Linien, Umrisse |
| `--wash` | `#F5F5F5` | ruhige Hinterlegung |
| `--go` | `#137A3F` | Erfolg — **nur** Bedeutung |
| `--stop` | `#B42318` | Fehler/Problem/Aufnahme — **nur** Bedeutung |

**Neu, weil bisher hartkodiert** (keine neuen Töne, nur Tokenisierung vorhandener Werte):

| Token | Wert | Ersetzt |
|---|---|---|
| `--line-strong` | `#C9C9C9` | hartkodiertes `#C9C9C9` (kräftigere Trennlinie, Eingabefeld-Rand) |
| `--warn-bg` | `#FDF2E0` | `#FDF2E0`/`#FFF3CD` (Sandbox-/Hinweisbanner) |
| `--warn-line` | `#E8C468` | `#E8C468` |
| `--shadow-sheet` | `0 -8px 32px rgb(0 0 0 / .12)` | Sheets/Dialoge — **echte Ebene**, kein Deko-Schatten |
| `--shadow-menu` | `0 4px 16px rgb(0 0 0 / .10)` | Kontomenü, Befehlspalette |

Verboten bleibt: neue Farbtöne, Verläufe im UI, Glassmorphism, Schatten unter Karten.

### 1.2 Typografie — Schibsted Grotesk, selbst gehostet

`assets/fonts/SchibstedGrotesk-{400,500,700}.woff2`, ausgeliefert über die bestehende Route
`${mount}/fonts/…`, `font-display: swap`, 400 vorgeladen. Google Fonts entfällt ersatzlos (DSGVO).

| Rolle | Größe | Gewicht | Zeilenhöhe | Einsatz |
|---|---|---|---|---|
| `--t-display` | `clamp(28px, 6.5vw, 44px)` | 700 | 1.12 | Status-Satz Übersicht, Onboarding-Abschluss |
| `--t-h1` | `clamp(23px, 4.5vw, 32px)` | 700 | 1.18 | Seitentitel |
| `--t-h2` | `19px` | 700 | 1.25 | Abschnitt |
| `--t-body` | `16px` | 400 | 1.55 | Fließtext, **alle** Eingabefelder (iOS-Zoom-Grenze) |
| `--t-small` | `14px` | 400 | 1.45 | Sekundärtext, Meta |
| `--t-micro` | `12px` | 500 | 1.3 | Badges, Zähler, Achsenbeschriftung |

Laufweite: `-0.02em` ab `--t-h1`, sonst normal. `tabular-nums` für Zahlen, Zeiten, Kennzahlen.
`text-wrap: balance` für Überschriften, `text-wrap: pretty` für Fließtext, `max-width: 68ch` für
Lesetext. **Keine ALL-CAPS-Labels** — die bisherigen `.steplabel`/`.tour-step` entfallen.

### 1.3 Spacing (4/8-Raster)

`--s1 4` · `--s2 8` · `--s3 12` · `--s4 16` · `--s5 24` · `--s6 32` · `--s7 48` · `--s8 64`

Seitenrand mobil `--s4`, ab 768px `--s6`. Abstand zwischen Abschnitten `--s7`.

### 1.4 Radius

`--r1 8` (Felder, kleine Flächen) · `--r2 12` (Karten, Sheets) · `--r3 18` (Buttons, Chips).
**Pipe-Knoten sind eckig** (0–2px) — das ist der Kontrast, der sie als eigene Sprache markiert.

### 1.5 Motion

| Token | Wert | Einsatz |
|---|---|---|
| `--dur-1` | `120ms` | Hover, Press |
| `--dur-2` | `200ms` | Toggles, Toasts, Badges |
| `--dur-3` | `320ms` | Sheets, Bereichswechsel |
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | Eintritt, Standard |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | Austritt |
| `--pipe-steps` | `steps(7, end)` | **nur** Pipe-Füllung |

Nur `transform`/`opacity`. `prefers-reduced-motion: reduce` → alle Dauern auf `1ms`, Pipe rastet
ohne Zwischenstufen ein.

---

## 2. Die Pipe — Zustandssprache

Ein Beitrag ist ein Quadrat an einer 4px-Leitung. Dieselbe Darstellung überall.

```
Geplant          Wartet auf Freigabe    Veröffentlicht      Problem
┌───┐            ┌───┐                  ███                 ┌───┐   (Umriss --stop)
│   │            │ ▪ │                  ███                 │ ▪ │
└───┘            └───┘                  ███                 └───┘
Umriss --ink     Umriss + Kern          gefüllt --ink       --stop
```

- **Größen:** `--node-s 10px` (Nav-Badges, Kalender), `--node-m 16px` (Flow-Leiste),
  `--node-l 24px` (Onboarding-Rail, Abschluss).
- **Füll-Animation:** `clip-path` von unten nach oben in `steps(7,end)` über `--dur-3`. Rastet ein,
  federt nicht. Genau dieser Effekt ist „das gewisse Etwas" — deshalb wird er **nirgends** sonst
  verwendet.
- **Barrierefreiheit:** Jeder Knoten hat `role="img"` + `aria-label` in Klartext
  („Beitrag am Dienstag, 9:00 Uhr, wartet auf Freigabe"). Die Legende erscheint beim ersten
  Kontakt einmalig unter der Flow-Leiste und ist danach über „Was kann Pipeflow?" erreichbar.
- **Nie dekorativ:** Kein Pipe-Element ohne echten Zustand dahinter.

---

## 3. Informationsarchitektur

```
Übersicht          Zustand + Flow-Leiste + offene Aufgaben
Beiträge           Geplant | Zur Freigabe (N) | Veröffentlicht
Analytics          Instagram | LinkedIn
Einstellungen      7 Gruppen (Liste → Unterseite auf Mobil)
─────────────────────────────────────────────────────────
Jetzt posten       überall erreichbar (Primäraktion)
Kontomenü          Was kann Pipeflow?, Rundgang, Hilfe-Chat, Kontakt, Abmelden
```

### Deep-Links (neu)

| Hash | Ziel |
|---|---|
| `#uebersicht` | Übersicht |
| `#beitraege` / `#beitraege/geplant` | Beiträge, Reiter Geplant |
| `#beitraege/freigabe` | Beiträge, Reiter Zur Freigabe ← Ziel aus Freigabe-E-Mails |
| `#beitraege/veroeffentlicht` | Beiträge, Reiter Veröffentlicht |
| `#analytics` / `#analytics/linkedin` | Analytics je Kanal |
| `#einstellungen/<gruppe>` | Einstellungen, Gruppe direkt |
| `#posten` | „Jetzt posten" geöffnet |
| `#hilfe` | Hilfe-Chat geöffnet |

Onboarding bleibt bewusst ohne Deep-Links (linearer Ablauf).

### Glossar (verbindlich, überall identisch)

| Begriff | Nicht mehr |
|---|---|
| **Beitrag** | Post, Posting, Eintrag |
| **Kanal** | Plattform, Netzwerk |
| **Freigeben / Freigabe** | Bestätigen, Genehmigen, Approve |
| **Geplant** | Vorschau, Vorausplanung (in der Navigation) |
| **Veröffentlicht** | Verlauf, bisherige Beiträge |
| **Übersicht** | Dashboard, Startseite |
| **Jetzt posten** | Sofort-Beitrag, Ad-hoc |
| **Testphase** | Trial, Probezeitraum |
| **Pause** | Urlaub, Stopp |

Eine Aktion heißt im ganzen Ablauf gleich: Button „Freigeben" → Toast „Freigegeben".

### Zustandspriorität des Status-Satzes (genau einer, oben auf der Übersicht)

1. **Problem** — Kanal abgelaufen/getrennt, E-Mail unbestätigt, Testphase abgelaufen
2. **Freigabe wartet** — „N Beiträge warten auf Ihre Freigabe."
3. **Hinweis** — Testphase endet in N Tagen · Pausiert bis TT.MM.
4. **Läuft** — „Alles läuft. Nächster Beitrag morgen um 9:00 Uhr auf Instagram."

---

## 4. Wireframes

### 4.1 Übersicht — mobil (390)

```
┌──────────────────────────────────┐
│ ▣ Pipeflow                   (PH)│  Kopf: Logo + Kontomenü
├──────────────────────────────────┤
│                                  │
│  2 Beiträge warten               │  --t-display, max 2 Zeilen
│  auf Ihre Freigabe.              │
│                                  │
│  [ Jetzt ansehen ]               │  Primärbutton, Daumenzone erreichbar
│                                  │
│  ──────────────────────────────  │
│  Diese Woche                     │  --t-h2
│                                  │
│  Mo   Di   Mi   Do   Fr   Sa  So │  --t-micro, stone
│  ███──┌─┐──┌▪┐──┌─┐──┌─┐──·───·  │  Pipe: 4px Leitung, Knoten 16px
│       └─┘  └▪┘  └─┘  └─┘         │  heute = Di (kräftigerer Knoten)
│                                  │
│  ──────────────────────────────  │
│  Letzte Beiträge                 │
│  ┌──────────┐ ┌──────────┐       │  Bilder groß, 1:1, aspect-ratio
│  │          │ │          │       │  (die einzige Farbe im Panel)
│  │  BILD    │ │  BILD    │       │
│  └──────────┘ └──────────┘       │
│                                  │
│  Kanäle                          │
│  Instagram          Verbunden    │
│  LinkedIn      Läuft bald ab     │  --stop nur wenn Problem
│                                  │
├──────────────────────────────────┤
│  ▣      ▤      ◪      ⚙          │  Bottom-Bar, Labels sichtbar
│ Über-  Bei-   Ana-  Einst.   (+) │  (+) = Jetzt posten
│ sicht  träge² lytics             │  ² = Badge-Zähler
└──────────────────────────────────┘
```

### 4.2 Übersicht — Desktop (1440)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▣ Pipeflow   Übersicht  Beiträge²  Analytics  Einstellungen            │
│              ─────────                            [Jetzt posten]  (PH) │  3px Ink-Unterstrich
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   2 Beiträge warten auf Ihre Freigabe.          [ Jetzt ansehen ]      │
│                                                                        │
│   ─────────────────────────────────────────────────────────────────    │
│   Diese Woche                                                          │
│   Mo      Di      Mi      Do      Fr      Sa      So                   │
│   ███────┌─┐────┌▪┐────┌─┐────┌─┐────·──────·                          │
│                                                                        │
│   ─────────────────────────────────────────────────────────────────    │
│   Letzte Beiträge                              Kanäle                  │
│   ┌────────┐┌────────┐┌────────┐┌────────┐     Instagram    Verbunden  │
│   │  BILD  ││  BILD  ││  BILD  ││  BILD  │     LinkedIn  Läuft bald ab │
│   └────────┘└────────┘└────────┘└────────┘                             │
└────────────────────────────────────────────────────────────────────────┘
```

Lesetext schmal (68ch), Bildraster breit — bewusst unterschiedlich, kein Einheits-Grid.

### 4.3 Freigabe — mobil

```
┌──────────────────────────────────┐
│ ‹ Beiträge                       │
│  Geplant │ Zur Freigabe² │ Veröff.│  Segmented Control
│           ─────────────           │
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │
│  │                            │  │
│  │          BILD              │  │  so wie er erscheinen wird
│  │                            │  │
│  └────────────────────────────┘  │
│  Instagram Feed                  │  --t-small stone
│  Geht morgen um 9:00 Uhr raus,   │
│  sobald Sie freigeben.           │
│                                  │
│  „Rückenschmerzen? Drei Übungen  │
│  für den Alltag …"               │
│                                  │
│  [ Freigeben ]                   │  primär, volle Breite, 48px
│  [ Bearbeiten ]  [ Ablehnen ]    │  sekundär
└──────────────────────────────────┘
      ↓ nach „Freigeben"
   Quadrat füllt sich in Stufen,
   Toast: „Freigegeben. Rückgängig"
```

### 4.4 Jetzt posten — mobil (Bottom-Sheet)

```
┌──────────────────────────────────┐
│            ────                  │  Griff, wischbar
│  Jetzt posten                    │
│                                  │
│  Worum soll es gehen?  (optional)│
│  ┌────────────────────────┐ (🎙) │  Diktat-Icon = Pixel-Icon
│  │                        │      │
│  └────────────────────────┘      │
│  Ideen: [Tipps] [Team] [Angebot] │  antippbare Chips
│                                  │
│  Wo?                             │
│  ┌──────────┐ ┌──────────┐       │  große Toggle-Kacheln
│  │ ▣ Feed   │ │  Story   │       │  ausgewählt = Ink-Fläche
│  └──────────┘ └──────────┘       │
│  ┌──────────┐                    │
│  │ LinkedIn │                    │
│  └──────────┘                    │
│                                  │
│  [ Beitrag erstellen ]           │  sticky über Tastatur
└──────────────────────────────────┘
```

### 4.5 Einstellungen — mobil (Liste) / Desktop (Sprungliste)

```
mobil                              Desktop
┌────────────────────────┐         ┌──────────────┬──────────────────────┐
│ Einstellungen          │         │ Mein Unter.. │  Mein Unternehmen    │
│ ┌────────────────────┐ │         │ Aussehen     │  ┌────────────────┐  │
│ │ Suchen…            │ │         │ Inhalt       │  │ Firmenname     │  │
│ └────────────────────┘ │         │ Kanäle       │  └────────────────┘  │
│                        │         │ Freigaben    │   Gespeichert ✓      │
│ Mein Unternehmen     › │         │ Benachricht. │                      │
│ Aussehen             › │         │ Konto        │  Aussehen            │
│ Inhalt & Sprache     › │         │              │  ┌──────┐ ┌────┐     │
│ Kanäle & Zeitplan    › │         │ (sticky)     │  │ Feed │ │Sto.│     │
│ Freigaben & Automatik› │         │              │  │ live │ │live│     │
│ Benachrichtigungen   › │         │              │  └──────┘ └────┘     │
│ Konto                › │         └──────────────┴──────────────────────┘
└────────────────────────┘
```

---

## 5. Selbstprüfung: Was sähe bei jedem anderen SaaS gleich aus?

| Erster Entwurf | Problem | Geändert zu |
|---|---|---|
| Übersicht als 4 Kennzahl-Kacheln oben („Beiträge gesamt", „Follower", …) | Exakt das generische Dashboard-Muster. Beantwortet außerdem keine der fünf Aufgaben des Panels. | **Ein Status-Satz** in Display-Größe. Zahlen gehören nach Analytics, nicht auf die Startseite. |
| Karten mit Schatten für jeden Abschnitt | „Wand aus Karten", Schatten ohne Ebene | Abschnitte nur durch **Weißraum und eine 1px-Linie** getrennt. Schatten ausschließlich für Sheets/Menüs. |
| Fortschrittsbalken im Onboarding | Austauschbar | **Pipe mit Knoten** — dieselbe Sprache wie die Beiträge. |
| Bunte Kanal-Logos (Instagram-Verlauf, LinkedIn-Blau) | Bricht Schwarz-Weiß, lenkt von den Beitragsbildern ab | **Abstrahierte Pixel-Icons** in `currentColor`. |
| Icon-Kreise mit Hintergrundfläche | Deko ohne Funktion | Icons stehen frei, 11×11-Raster, `crispEdges`. |
| „Letzte Aktivität"-Liste mit Zeitstempel-Kette (`Instagram · 14:12 · Erfolgreich`) | Meta-Kette mit „·" — generisch und schlecht lesbar | **Bildraster**. Die Beiträge selbst sind die Information. Details im Detail-Sheet. |
| Analytics mit farbigen Flächendiagrammen | Chartjunk | **Dünne Ink-Linien**, keine Füllung, keine Gitter, Aussage als Satz zuerst. |
| Sanftes Fade-up beim Scrollen jeder Sektion | Modisch, verlangsamt gefühlt | Entfällt. Bewegung **nur** als Antwort auf eine Aktion. |
| Toast unten mittig mit Icon und Fortschrittsring | Overdesign | Schlichter Balken, Text + „Rückgängig", `aria-live`. |

**Chanel-Regel angewandt:** Aus der Übersicht entfernt: Begrüßungszeile („Willkommen zurück"),
Kennzahl-Kacheln, separater Kalenderblock (der steckt jetzt in der Flow-Leiste), Wiederholung der
Kanal-Liste im Fuß.

---

## 6. Icon-Set (Inline-SVG, 11×11, `crispEdges`, `currentColor`)

`uebersicht` (Raster 2×2) · `beitraege` (gestapelte Quadrate) · `analytics` (Balken aus Pixeln) ·
`einstellungen` (Regler) · `posten` (Plus) · `check` · `close` · `mic` · `hilfe` (Fragezeichen) ·
`warnung` (Ausrufezeichen) · `feed` (Quadrat) · `story` (Hochformat) · `linkedin` (abstrahiert:
Quadrat + Punkt) · `chevron` · `undo`.

Keine Emojis im UI. Die bisherigen 💬/✕/⚠️ entfallen ersatzlos.

---

## 7. Technische Entscheidungen

| Entscheidung | Begründung |
|---|---|
| Aufteilung in `index.html` + `panel.css` + `panel.js` | 252 KB Einzeldatei ist nicht mehr wartbar. Auslieferung über neue `express.static(publicDir)`-Route, funktioniert für `/panel` **und** `/panel/sandbox` (nachgewiesen). |
| Sandbox serviert `public/panel-redesign` | Produktion und Sandbox teilen sich sonst dieselbe Datei — Änderungen wären ohne Deploy sofort live. Weiche greift nur bei `PANEL_SANDBOX=true`. |
| Schrift selbst hosten | DSGVO; CSP um `font-src 'self'` ergänzt. |
| Hash-Routing statt `S.step` allein | Deep-Links, Zurück-Geste am Handy, E-Mail-Links auf die Freigabe. |
| Kein Framework, kein Build-Step | Vorgabe; Vanilla-JS wie bisher, `esc()` bleibt Pflicht. |
| API-Verträge unverändert | Vorgabe. Neue Endpunkte nur, wenn zwingend — bisher keiner nötig. |

---

## 8. Reihenfolge der Umsetzung

1. **Fundament:** Tokens, Schrift, Icons, Komponenten, Kopf/Bottom-Bar, Hash-Routing
2. **Kernflows:** Übersicht → Freigabe → Jetzt posten → Beiträge
3. **Rest:** Onboarding, Einstellungen, Analytics, Hilfe, Rundgang, Chat
4. **Komfort:** Status-Satz-Logik, Badges, Autosave/Undo, Skeletons, Befehlspalette, PWA
5. **admin.html** auf dieselben Tokens
