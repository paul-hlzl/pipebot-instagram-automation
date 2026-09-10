# LinkedIn Styleguide – Pipeline AI Solutions

Vorgaben für die automatisierte tägliche LinkedIn-Post-Routine.
Ziel: Paul Hölzl als kompetenten Ansprechpartner für KI-Automatisierung
im deutschsprachigen KMU-Umfeld positionieren.

---

## 1. Grundlegendes

**Kanal:** Persönliches Profil (Paul Hölzl), nicht Firmenseite.
**Sprache:** Deutsch. Kein Denglisch-Overkill, aber Fachbegriffe
(Workflow, Automation, Prompt, API) bleiben englisch – das ist im
Zielpublikum normal.
**Ansprache:** Du-Form. Persönlich, nicht Konzern-Sprech.
**Frequenz:** 1 Post pro Werktag. Keine Wochenendposts.
**Uhrzeit:** 07:30 oder 11:30 Ortszeit (Wien). Nicht 15:00 wie bei
Instagram – LinkedIn-Reichweite ist vormittags deutlich besser.

---

## 2. Tonalität

**So klingt es:**
- Klar, konkret, ohne Buzzword-Nebel
- Erfahrungsbericht statt Ratgeber-Belehrung
- Ehrlich über Grenzen und Fehlschläge
- Kurze Sätze. Absätze mit maximal 2–3 Zeilen.

**So klingt es nicht:**
- "In der heutigen schnelllebigen Geschäftswelt…"
- "Revolutionär", "bahnbrechend", "Game-Changer", "disruptiv"
- Emoji-Ketten, 🚀 als Satzzeichen
- Hustle-Motivation, Erfolgs-Storytelling, "Ich habe gelernt, dass…"
- Rhetorische Fragen als Aufhänger ("Wusstest du, dass…?")
- KI-typische Floskeln: "Es ist wichtig zu beachten", "nicht nur…
  sondern auch", Gedankenstrich-Einschübe als Stilmittel

---

## 3. Postformat

**Länge:** 600–1.200 Zeichen. Kürzer geht, länger selten.

**Aufbau:**
1. **Hook (1–2 Zeilen):** Konkrete Aussage oder Beobachtung. Muss
   allein stehen können, weil LinkedIn nach ca. 210 Zeichen abschneidet.
2. **Hauptteil:** Ein einziger Gedanke, sauber ausgeführt. Kein
   Rundumschlag.
3. **Abschluss:** Konkrete Frage an die Leser oder ein Fazit.
   Keine Call-to-Action-Bettelei ("Like & teilen!").

**Hashtags:** 3–5, am Ende, keine im Fließtext.
Feste Auswahl: #KIAutomatisierung #n8n #Prozessautomatisierung
#Mittelstand #KünstlicheIntelligenz
Maximal ein situatives Hashtag zusätzlich.

**Keine @-Erwähnungen** – die API rendert die als Plaintext,
das sieht kaputt aus.

**Zeilenumbrüche:** Großzügig. Ein Gedanke pro Absatz. LinkedIn
liest sich am Handy.

---

## 4. Themen-Rotation

Damit die Routine nicht jeden Tag dasselbe schreibt – rotierend:

| Tag | Kategorie | Inhalt |
|-----|-----------|--------|
| Mo | Praxisfall | Ein konkretes Automatisierungsproblem und wie man es löst |
| Di | Tool/Technik | n8n, MCP, APIs – was funktioniert, was nicht |
| Mi | Beobachtung | Was mir bei Kunden oder im Markt auffällt |
| Do | Anleitung | Ein umsetzbarer Tipp, den man heute anwenden kann |
| Fr | Einordnung | Was sich in KI/Automatisierung gerade bewegt und was das für KMU heißt |

Jede Kategorie braucht einen eigenen Prompt-Baustein. Nicht einfach
"schreib einen LinkedIn-Post" – das produziert Einheitsbrei.

---

## 5. Bilder

**Nicht jeden Post bebildern.** Auf LinkedIn performen reine
Textposts oft besser als Bildposts. Richtwert: 2–3 Bilder pro Woche,
der Rest Text.

**Wenn Bild, dann:**
- Format 1200 × 627 px (Landscape), nicht quadratisch wie bei Instagram
- Stil wie beim Instagram-Guide: clean, minimalistisch, schwarz-weiß
  bzw. sehr reduzierte Farbigkeit
- Simple Icons, Diagramme, Schaltbilder – keine fotorealistischen
  Menschen, keine Stock-Photo-Ästhetik
- **Kein Text im generierten Bild.** fal.ai/Flux rendert Text
  unzuverlässig, und falsch geschriebene Wörter im Bild sind auf
  LinkedIn peinlicher als auf Instagram.

**Qualitätsprüfung vor dem Posten** (wie bei Instagram):
Bild ansehen, auf Rendering-Fehler prüfen, im Zweifel neu generieren.

---

## 6. Harte Regeln

- Keine erfundenen Zahlen, Studien oder Kundenreferenzen
- Keine Kundennamen ohne Freigabe
- Keine politischen oder gesellschaftlich kontroversen Themen
- Keine KI-Weltuntergangs- oder Heilsversprechen
- Keine Konkurrenz namentlich schlechtmachen
- Bei Unsicherheit über eine Faktenaussage: Aussage weglassen,
  nicht abschwächen

---

## 7. Dubletten-Vermeidung

Analog zu `posted-headlines.txt` bei Instagram:
`posted-linkedin.txt` mit Datum, Kategorie und Hook-Zeile jedes Posts.
Vor dem Generieren einlesen, damit Themen nicht innerhalb von
30 Tagen wiederholt werden.

---

## 8. Prompt-Gerüst für die Routine

```
Du schreibst einen LinkedIn-Post für Paul Hölzl, Inhaber von
Pipeline AI Solutions (KI- und Automatisierungslösungen für KMU,
Oberösterreich).

Kategorie heute: {kategorie}
Bereits gepostete Themen (nicht wiederholen): {posted_linkedin}
Stichpunkte/Vorgaben von Paul: {input}

Halte dich exakt an linkedin-styleguide.md.
Gib nur den fertigen Post-Text aus, keine Erklärung, keine
Anführungszeichen, keine Alternativvorschläge.
```
