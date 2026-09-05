# Pipeline AI Solutions — Instagram Styleguide

**Markenname:** Pipeline AI Solutions (kurz: "Pipeline AI" für kleine On-Image-Brandings). Nicht "Pipebot" — bestimmt Ton, Headline und Caption aller Posts.

## BILDSTIL (cloudstrata-Referenz, Layout v2)
- **Hintergrund:** Dunkles Blau-Schwarz, nicht reines Schwarz (z.B. `#0a0e1a` oder ähnlicher dunkler Navy-Ton), mit subtiler Textur. Minimalistisch, aber nicht langweilig. Bleibt clean & professionell.
- **Text (Headline):** Weiße, klassische Serif-Schrift (elegant, nicht modern)
- **Text-Größe:** Großer, dominanter Headline (3-5 Wörter max)
- **Text-Positionierung:** Links/mittig positioniert (nicht mehr zentriert über die volle Breite)
- **Wasserzeichen-Branding:** "Pipeline" als großer, vertikaler Schriftzug am rechten Bildrand, transparent/dezent (~15-20% Deckkraft, wie ein Wasserzeichen), um 90 Grad gedreht (von unten nach oben lesbar). Übernimmt allein die Markenerkennung — **kein separates kleines Branding unten mehr nötig**.
- **Sonstige Grafiken:** KEINE — kein Icon, keine Pixel-Art, keine geometrischen Formen/Dreiecke/Deko-Elemente, kein Rahmen, nichts außer Hintergrund + Headline-Text
- **Gesamteindruck:** Minimalistisch, edel, "AI-generated" Look, professionell

## BEISPIEL-LAYOUT
[Dunkler Navy-Hintergrund mit Textur, Headline links/mittig:]
"Helping Businesses to
Build, Deploy and
Scale AI Systems"

[Rechter Bildrand, groß, vertikal, 90° gedreht, ~15-20% Deckkraft:]
"Pipeline" (von unten nach oben lesbar, wie ein Wasserzeichen)

## TEXT-VORGABEN
- **Headline:** 3-5 Wörter, kurz & prägnant
- **Ton:** Professionell, elegant, nicht verspielt
- **Sprache:** Englisch (oder Deutsch, je nach Post)
- **Keine Hashtags im Bild selbst** (die gehen in Caption)

## BILDGENERIERUNG (für fal.ai Flux Schnell)
**Wichtig:** Das "Pipeline"-Wasserzeichen wird NICHT mehr von der KI gezeichnet — Text-zu-Bild-Modelle rendern gedrehten Text und exakte Deckkraft-Werte unzuverlässig (getestet: gespiegelte Buchstaben, halluzinierter Text-Müll). Das Wasserzeichen wird stattdessen **automatisch per Code** (`src/watermark.ts`, sharp/SVG) nach der Bildgenerierung aufgelegt — exakte Position, Rotation (90°, von unten nach oben lesbar) und Deckkraft (~18%), garantiert korrekt.

Prompt-Template (nur Headline, KEIN Wasserzeichen-Text anfordern):
"Dark navy-black background (near #0a0e1a), subtle fine linen texture, barely visible. Traditional white serif typeface only, NOT sans-serif, NOT bold, NOT decorative. Text positioned left-of-center reading: '[HEADLINE]'. The text must be rendered exactly as written, no missing or extra characters. Professional, clean, minimalist. No shapes, no triangles, no icons, no decorative graphics, no borders — nothing besides the background and the headline text. No other text/numbers/labels anywhere else in the image."

(Stand 2026-09-05: Textur-Beschreibung bewusst NICHT mehr als "geometrisches Muster" formuliert — das führte nachweislich zu halluzinierten Dreiecken/Deko-Grafiken im Bild. Nur noch "fine linen texture", eindeutig nicht-geometrisch.)

## QUALITÄTSPRÜFUNG BEFORE POSTING
✅ Text lesbar, links/mittig positioniert (nicht zentriert über volle Breite)?
✅ Hintergrund dunkles Navy/Blau-Schwarz (nicht reines Schwarz), mit sichtbarer, subtiler Textur?
✅ Keine zusätzlichen/halluzinierten Text-Elemente, Zeichen oder Interpunktion außer der exakten Headline (das Wasserzeichen kommt separat per Code dazu, danach prüfen — siehe unten)?
✅ Keine zusätzlichen Grafiken/Icons/Formen/Dreiecke/Rahmen — nur Hintergrund + Text?
✅ Schrift elegant Serif — NICHT sans-serif, NICHT bold, NICHT verspielt/dekorativ?
→ Falls NEIN zu etwas: Neugeneration mit angepasstem Prompt.

**Zusätzlich nach dem automatischen Wasserzeichen-Overlay prüfen:** "Pipeline"-Schriftzug rechts sichtbar, korrekt orientiert (nicht gespiegelt), vertikal lesbar von unten nach oben, dezent/transparent?

## CAPTION (Instagram Post-Text)
- Kurzer, lockerer Text zu Headline
- Marke im Text als "Pipeline AI Solutions" (ausgeschrieben) oder "Pipeline AI" referenzieren, nicht "Pipebot"
- #AI #Claude #PipelineAI #Tech relevante Hashtags
- Link zur Website falls nötig

## POSTING-ZEITPLAN
- **Täglich um 15:00 UTC**
- Variable Themen OR Rotations-Plan (TBD)
