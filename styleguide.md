# Pipeline AI Solutions — Instagram Styleguide

**Markenname:** Pipeline AI Solutions (kurz: "Pipeline AI" für kleine On-Image-Brandings). Nicht "Pipebot" — bestimmt Ton, Headline und Caption aller Posts.

## BILDSTIL (cloudstrata-Referenz, Layout v3 — Headline jetzt per Code gerendert, siehe BILDGENERIERUNG)
- **Hintergrund:** Dunkles Blau-Schwarz, nicht reines Schwarz (z.B. `#0a0e1a` oder ähnlicher dunkler Navy-Ton), mit subtiler Textur. Minimalistisch, aber nicht langweilig. Bleibt clean & professionell. Einziger Teil des Bildes, der noch von fal.ai generiert wird.
- **Text (Headline):** Weiße, klassische Serif-Schrift (`Liberation Serif`, elegant, nicht modern) — wird NICHT mehr von der KI gerendert, sondern per Code aufgelegt (siehe unten). Garantiert exakt, einheitlich, keine Interpunktions-/Schrift-Mix-Fehler mehr möglich.
- **Text-Größe:** Großer, dominanter Headline (2-4 Wörter), Schriftgröße automatisch an Zeilenlänge angepasst (siehe `addHeadlineText` in `src/watermark.ts`)
- **Text-Positionierung:** Links/mittig positioniert (nicht zentriert über die volle Breite), bei 3-4 Wörtern automatisch auf 2 Zeilen umgebrochen
- **Wasserzeichen-Branding:** "Pipeline" als großer, vertikaler Schriftzug am rechten Bildrand, transparent/dezent (~15-20% Deckkraft, wie ein Wasserzeichen), um 90 Grad gedreht (von unten nach oben lesbar). Ebenfalls per Code aufgelegt. Übernimmt allein die Markenerkennung — **kein separates kleines Branding unten mehr nötig**.
- **Sonstige Grafiken:** KEINE — kein Icon, keine Pixel-Art, keine geometrischen Formen/Dreiecke/Deko-Elemente, kein Rahmen, nichts außer Hintergrund + Headline-Text + Wasserzeichen
- **Gesamteindruck:** Minimalistisch, edel, "AI-generated" Look, professionell

## BEISPIEL-LAYOUT
[Dunkler Navy-Hintergrund mit Textur, Headline links/mittig:]
"Helping Businesses to
Build, Deploy and
Scale AI Systems"

[Rechter Bildrand, groß, vertikal, 90° gedreht, ~15-20% Deckkraft:]
"Pipeline" (von unten nach oben lesbar, wie ein Wasserzeichen)

## TEXT-VORGABEN
- **Headline:** 2-4 Wörter, kurz & prägnant (kürzer ist besser: bei Flux Schnell rendert 2-3-Wort-Text spürbar zuverlässiger als 5 Wörter — eigener Test 2026-09-05: 2/2 korrekt bei 2 Wörtern, 0/3 korrekt bei 3-5 Wörtern)
- **Ton:** Professionell, elegant, nicht verspielt
- **Sprache:** Englisch (oder Deutsch, je nach Post)
- **Keine Hashtags im Bild selbst** (die gehen in Caption)

## BILDGENERIERUNG (für fal.ai Flux Schnell)

**Architektur seit 2026-09-05 (Layout v3): Headline und Wasserzeichen werden BEIDE per Code aufgelegt, NICHT von der KI gerendert.** Text-zu-Bild-Modelle rendern Text unzuverlässig — Vorgeschichte: erst nur das Wasserzeichen (gedrehter Text, exakte Deckkraft) war betroffen, dann zeigte eine 12er-Testreihe mit der Headline im KI-Prompt nur 16,7% Erfolgsquote (verstümmelter Text, fehlende/vertauschte Wörter, Streu-Interpunktion, inkonsistente Schrift-Mischung), und eine weitere Verschärfung des Prompts verschlimmerte das sogar auf 0/12 (das Modell rendert dann teils den Text "Instagram" aus dem eigenen Stil-Prefix statt der Headline, oder gar keinen Text). Lösung: fal.ai bekommt gar keine Text-Anfrage mehr, sondern generiert NUR noch den reinen Hintergrund — Headline und Wasserzeichen kommen danach beide per SVG/sharp exakt, garantiert korrekt dazu.

**fal.ai-Prompt (reiner Hintergrund, siehe `IMAGE_STYLE_PREFIX` in `src/fal.ts`):**
"minimalist background for a social media graphic, dark navy-black (near #0a0e1a) with a subtle fine linen texture, barely visible. Professional, clean, AI-generated aesthetic. Plain and uncluttered. Absolutely no text, no letters, no numbers, no words, no typography of any kind. No icons, no illustrations, no photographic elements, no neural network or circuit graphics, no robotic elements, no geometric shapes, no triangles, no abstract decorative graphics, no borders, no frames, no additional graphic elements of any kind — just the plain dark textured background, nothing else"

**Code-Rendering-Spezifikation (`addHeadlineText` in `src/watermark.ts`, läuft VOR dem Wasserzeichen-Overlay):**
- Schrift: `Liberation Serif, serif`, Farbe `#ffffff` (weiß), einheitlicher Schnitt (kein Bold/Italic-Mix möglich, da programmatisch)
- Position: links, x-Start bei **18%** der Bildbreite (siehe „GRID-SICHERHEITSZONE" unten — nicht mehr 10%); vertikal um die Bildmitte zentriert
- Zeilenumbruch: ≤2 Wörter → 1 Zeile; 3-4 Wörter → automatisch 2 Zeilen (je die Hälfte der Wörter)
- Schriftgröße: automatisch an die längste Zeile angepasst (Ziel: Text bleibt innerhalb der 18%-82%-Sicherheitszone, ~64% der Bildbreite), Bandbreite 6-12% der Bildhöhe
- Reihenfolge: Hintergrund generieren → Headline auflegen → Wasserzeichen auflegen → JPEG-Export

**GRID-SICHERHEITSZONE (Stand 2026-09-05, real beobachtetes Problem):** Instagram beschneidet quadratische Posts in der Profil-Grid-Kachelansicht sichtbar enger als das volle 1:1-Bild — real beobachtet: bei x-Start=10% der Bildbreite wurde der erste Buchstabe der Headline ("S" von "Scale Without Limits") im Grid abgeschnitten, im normalen Feed-Post (nach Antippen) aber korrekt vollständig angezeigt. Das exakte Crop-Verhältnis ist nicht zuverlässig offiziell dokumentiert (Quellen widersprechen sich, teils wird ein zentrierter ~3:4-Ausschnitt berichtet, was bei einem 1024px breiten Bild ~128px/12,5% Beschnitt auf jeder Seite bedeuten würde). Da keine exakte Zahl verlässlich ist, wurde ein großzügiger Sicherheitsabstand gewählt: Headline-Text bleibt jetzt strikt innerhalb von **18%-82% der Bildbreite** (statt vorher 10%-88%) — das hält auch bei einem eventuell noch aggressiveren Crop als den berichteten ~12,5% sicher Abstand. Getestet: In einer simulierten 3:4-Grid-Crop-Vorschau (zentrierter 768px-Ausschnitt aus 1024px) ist die Headline jetzt vollständig sichtbar mit echtem Rand auf beiden Seiten.

⚠️ **Bekanntes, noch NICHT behobenes Folgeproblem:** Das "Pipeline"-Wasserzeichen (x-Zentrum bei `Bildbreite - 7%` ≈ 95% der Breite, siehe `addPipelineWatermark`) liegt außerhalb dieser Sicherheitszone und fällt in der simulierten Grid-Vorschau komplett weg (nicht mehr sichtbar). Das war zum Zeitpunkt dieses Fixes noch nicht behoben — nur die Headline-Positionierung war beauftragt. Falls das Wasserzeichen auch im Grid sichtbar bleiben soll, muss `addPipelineWatermark`'s `marginRight` ebenfalls nach innen verschoben werden.

(Historie der gescheiterten Prompt-Iterationen — 16,7% dann 0/12 — bleibt zur Nachvollziehbarkeit im Git-Log dieser Datei erhalten, nicht mehr hier ausgeführt, da inzwischen strukturell obsolet.)

## QUALITÄTSPRÜFUNG BEFORE POSTING
✅ Hintergrund dunkles Navy/Blau-Schwarz (nicht reines Schwarz), mit sichtbarer, subtiler Textur, keine Artefakte/Flecken?
✅ Keine unerwarteten Grafiken/Formen im Hintergrund (Formen/Text sind jetzt strukturell ausgeschlossen, da nicht angefragt — aber Bildmodelle können theoretisch trotzdem abweichen, daher weiterhin kurz gegenprüfen)?
→ Headline-Text, Schriftart und Positionierung müssen NICHT mehr geprüft werden — die sind seit Layout v3 code-generiert und damit garantiert korrekt. Die Prüfung betrifft nur noch den Hintergrund.
→ Falls NEIN zum Hintergrund: Neugeneration (bis zu 3 Versuche, siehe Routine-Prompt) — dieser Fall sollte jetzt aber deutlich seltener auftreten als früher, da das Bildmodell nur noch eine simple, textfreie Aufgabe hat.

**Zusätzlich nach dem automatischen Headline- und Wasserzeichen-Overlay prüfen:** "Pipeline"-Schriftzug rechts sichtbar, korrekt orientiert (nicht gespiegelt), vertikal lesbar von unten nach oben, dezent/transparent? (Rein zur Vollständigkeit — dieser Teil war schon vor Layout v3 code-generiert und zuverlässig.)

## CAPTION (Instagram Post-Text)
- Kurzer, lockerer Text zu Headline, IMMER auf Englisch (siehe Sprachregel oben)
- Marke im Text als "Pipeline AI Solutions" (ausgeschrieben) oder "Pipeline AI" referenzieren, nicht "Pipebot"
- Hashtags: siehe die separate Hashtag-Strategie im Routine-Prompt (4-5 Tags nach fester Formel: #pipelinesolutions + 1 Kategorie-Tag + 2 Core-B2B-Tags + 1 Nischen-Tag, alle Englisch) — die alte feste Liste #AI #Claude #PipelineAI #Tech ist veraltet und wird nicht mehr benutzt
- Link zur Website falls nötig

## POSTING-ZEITPLAN
- **Täglich um 15:00 UTC**
- Variable Themen OR Rotations-Plan (TBD)

## INSTAGRAM STORIES (zusätzlich zum Feed-Post, seit 2026-09-05)

Zusätzlich zum quadratischen Feed-Post kann derselbe Content auch als Instagram Story
veröffentlicht werden — eigener Media-Container-Typ (`media_type=STORIES`) über dieselbe
Graph-API-Endpoint (`POST /{ig-user-id}/media`, dann `media_publish` wie beim Feed-Post,
siehe `publishStoryToInstagram` in `src/instagram.ts`).

**Bildformat:** 9:16 Hochformat (Ziel 1080x1920) statt quadratisch. fal.ai liefert dafür
`image_size=portrait_16_9` (das nächstliegende unterstützte Preset — fal dokumentiert die
exakten Pixelmaße dieses Presets nicht, ist aber irrelevant, da `addHeadlineText` und
`addPipelineWatermark` die tatsächliche Bildgröße aus den Metadaten lesen und Position/
Schriftgröße relativ dazu berechnen, siehe `src/watermark.ts`). Derselbe textfreie
Hintergrund-Prompt (`IMAGE_STYLE_PREFIX`) wird für beide Formate verwendet.

**Positionierung (Layout-Anpassung ggü. Feed):**
- Horizontal: Sicherheitszone **10%-90%** der Bildbreite (statt 18%-82% beim Feed) — die
  18%-Marge beim Feed existiert speziell wegen des Grid-Kachel-Crops im Profil, den es bei
  Stories nicht gibt (Stories werden nie ins Grid eingebettet).
- Vertikal: Sicherheitszone **20%-80%** der Bildhöhe, um die Story-UI-Overlays am oberen
  Rand (Profilbild/Username/Fortschrittsbalken) und unteren Rand (Antwortfeld/CTA-Leiste)
  nicht zu verdecken. Beim Feed ist die volle Bildhöhe sicher (kein UI-Overlay), daher dort
  keine vertikale Einschränkung.
- Wasserzeichen: gleiche Logik wie beim Feed (rechter Bildrand, 90° gedreht), mit etwas
  größerem `marginRight` (10% statt 7% der Breite) als zusätzlicher Puffer zur rechten
  Tap-Zone, über die man in Stories zur nächsten Story weiterwischt.

**Caption/Hashtags:** Von der Instagram Graph API für Stories **nicht unterstützt** — ein
Story-Container akzeptiert keinen `caption`-Parameter (auch kein `alt_text`, `tags` oder
`location`). Die Botschaft steckt ausschließlich in der aufs Bild gerenderten Headline; es
gibt keinen Text-Sticker-Weg über die API (interaktive Sticker wie Umfragen, Fragen,
Countdown oder Link-Sticker sind laut Meta-Dokumentation ausschließlich über die
Instagram-App selbst setzbar, nicht über die Graph API).

**Rate-Limit:** Stories zählen in dasselbe rollierende 100-Posts/24h-Kontingent wie
Feed-Posts, Reels und Karussells — es gibt **kein separates Story-Kontingent**.
`check_publishing_limit` deckt beide ab; ein Story-Post reduziert das für den Feed-Post
verbleibende Kontingent (und umgekehrt).

**Qualitätsprüfung:** Identisch zum Feed — nur der Hintergrund wird geprüft (Navy/Textur,
keine Artefakte), die Headline ist auch hier code-generiert und garantiert korrekt. Bei
Fehlschlag nach 3 Versuchen: `STORY_SKIPPED_REVIEW_FAILED` im Routine-Log (siehe
`README.md` Abschnitt zur Routine) — kein kritischer Fehler, der Feed-Post bleibt davon
unberührt, da die Story ein "Nice to have" zusätzlich zum Feed-Post ist, nicht umgekehrt.

**MCP-Tools:** `generate_story_image`, `publish_generated_story`,
`generate_and_publish_story` — analog zu den drei Feed-Tools, siehe `README.md`.
