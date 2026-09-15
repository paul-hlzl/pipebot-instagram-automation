# Video-Diashow (Instagram Reels) - Betriebshandbuch

Teil B des Karussell-Auftrags (v12), gebaut am 15.09.2026. Kurze Hochformat-Videos mit bewegter
Typografie und Sprachausgabe, deterministisch per ffmpeg gerendert - **kein KI-Videomodell**.

---

## 1. Was der Server dafür braucht

| Voraussetzung | Warum | Ohne das passiert Folgendes |
|---|---|---|
| **ffmpeg + ffprobe** im `PATH` | Rendern und Dauer messen | Die Video-Automatik überspringt den Kunden mit einer Log-Zeile, alles andere läuft weiter (`videoRenderingAvailable()`) |
| **`GOOGLE_TTS_API_KEY`** | Sprachausgabe | Das Video entsteht **stumm**, der Text steht ohnehin im Bild. Der Vorhör-Knopf im Panel sagt, dass er gerade nicht kann |
| Marken-Schriften (`assets/fonts`) | Textsatz im Video | Fallback auf die Systemschrift, wie bei den Bildern auch |
| R2-Bucket | Instagram lädt Reels nur über eine öffentliche URL | Ohne Upload keine Veröffentlichung |

Prüfen lässt sich das mit `ffmpeg -version && ffprobe -version` auf dem Server. Version 6.x ist
getestet; gebraucht werden die Filter `zoompan`, `overlay`, `fade` und der Encoder `libx264`.

## 2. Wie ein Video entsteht

1. **Drehbuch** (Anthropic, `generateVideoScript`): Hook, 1-4 Kernaussagen, Call-to-Action - jeweils
   in zwei Fassungen. `text` steht im Bild (kurz), `spoken` wird vorgelesen (ganzer Satz). Das ist
   der Kern der Anpassung an gesprochene Sprache: ein Stichpunkt liest sich gut und klingt
   vorgelesen abgehackt.
2. **Harte Wortgrenzen** des Kunden (verbotene Wörter, Pflicht-Elemente) werden geprüft, mit genau
   einem Nachversuch - identisch zur Beitrags-Vorausplanung.
3. **Sprachausgabe** (Google WaveNet, ein Aufruf je Abschnitt), danach wird jede Audiodatei mit
   `ffprobe` **gemessen**.
4. **Timing** richtet sich nach diesen Messwerten, nicht nach der Einstellung: Ein Abschnitt bleibt
   so lange stehen, wie sein Satz dauert (mindestens 1,3 s). Die eingestellte Länge steuert das
   Zeichen-Budget des Drehbuchs, nicht den Schnitt.
5. **Hintergrund**: ein einziges Bild (fal.ai oder der deterministische Farbverlauf des Kunden),
   textfrei.
6. **Rendern**: Ken-Burns-Zoom über die volle Laufzeit, Textkarten werden ein- und ausgeblendet,
   Markenecke (Logo oder Wasserzeichen) durchgehend, Ton daruntergelegt.
7. **Upload** nach R2 (Video + Standbild), dann je nach Freigabe-Modus ab in die Freigabe oder
   direkt als Reel veröffentlicht.

## 3. Rechenlast (gemessen, nicht geschätzt)

Gemessen auf 4 vCPU (Intel Xeon 2,8 GHz), leerer Maschine:

| Videolänge | Abschnitte | Renderzeit | Dateigröße |
|---|---|---|---|
| 5 s | 3 | **10,3 s** | 0,51 MB |
| 10 s | 5 | **18,6 s** | 0,89 MB |
| 15 s | 6 | **27,9 s** | 1,14 MB |

Das sind rund zwei Sekunden Rechenzeit je Sekunde Video, und ffmpeg nutzt dabei alle Kerne.

**Deshalb gibt es eine Warteschlange:** `VIDEO_RENDER_CONCURRENCY` (Standard **1**) - es wird immer
nur ein Video gleichzeitig gerendert, alle weiteren warten. Liefen fünf Kundenvideos parallel,
würden sie sich gegenseitig und die stündliche Posting-Routine ausbremsen. Serialisiert ist die
Rechnung dagegen entspannt: selbst 20 Kunden mit je einem 15-Sekunden-Video pro Woche brauchen
zusammen keine 10 Minuten CPU-Zeit pro Woche.

Zwei Dinge wurden beim Bauen gemessen und dann geändert, weil sie teuer waren:

- **Textebenen zuschneiden** statt bildfüllend übereinanderzulegen: halbiert die Renderzeit
  (10 s Video: 28,7 s → 18,6 s).
- **Hintergrund nur 1,35-fach hochskalieren** statt 2-fach vor dem Zoom: das Quellbild ist ohnehin
  nur 768 px breit, mehr Auflösung kostet Rechenzeit ohne sichtbaren Gewinn.

Das x264-Preset bringt hier **nichts** (veryfast 27,8 s vs. medium 29,0 s bei identischem Inhalt) -
der Aufwand steckt im Filtergraph, nicht im Encoder. Deshalb bleibt es bei `medium`.

## 4. Was ein Video kostet

Pro Beitrag, bei Standardeinstellungen (10 s, WaveNet-Stimme):

| Posten | Video-Diashow | Karussell (5 Bilder) |
|---|---|---|
| Bilder (fal.ai) | 1 Hintergrund = **0,003 USD** (0 USD bei Farbverlauf-Kunden) | 5 × 0,003 = **0,015 USD** |
| Sprachausgabe (Google TTS) | ~150 Zeichen = **0,0006 USD** | – |
| Text (Anthropic) | ein Aufruf, Größenordnung 0,001-0,003 USD | vergleichbar |
| Rendern | **0 USD** (eigener Server) | – |
| **Summe** | **rund 0,005 USD** | **rund 0,017 USD** |

**Eine Video-Diashow ist also billiger als ein Karussell**, nicht teurer - sie braucht nur ein
einziges Hintergrundbild, und die Sprachausgabe kostet weniger als ein Fünftel eines einzelnen
fal.ai-Bildes. Die 4 Mio. Freizeichen pro Monat reichen rechnerisch für rund 26.000 Videos.

Geloggt wird in `usage_costs` unter `video-post` (Text + Bild) und `video-tts` (Sprachausgabe),
getrennt, damit der Anteil der Sprachausgabe sichtbar bleibt.

## 5. Einstellungen im Panel

Eigener Bereich "Video-Diashow" (nicht nur eine Format-Option):

- **Ein/Aus** - Standard aus.
- **Eigener Wochenplan** - eigene Tage, optional eigene Uhrzeit. Ohne angehakten Tag entsteht nie
  automatisch ein Video; ein normaler Feed-Beitrag am selben Tag blockiert das Video nicht und
  umgekehrt.
- **Länge**: 5 / 10 / 15 Sekunden. Steuert, wie viele Kernaussagen das Drehbuch bekommt (1 / 2-3 /
  3-4) und wie viel Text gesprochen werden darf.
- **Bildbewegung**: hinein, heraus oder abwechselnd (Standard).
- **Stimme** mit Vorhören - ein Beispielsatz pro Stimme, direkt im Panel abspielbar.
- **Sprachausgabe an/aus**.

## 6. Stimmen

**Befund vom 15.09.2026, direkt gegen die API geprüft:** Google liefert für Deutsch nur noch **zwei
WaveNet-Stimmen** aus (`de-DE-Wavenet-G` weiblich, `de-DE-Wavenet-H` männlich) - die früheren A-F
existieren nicht mehr. Weil zwei Stimmen für eine Auswahl dünn sind, stehen zusätzlich die beiden
Neural2-Stimmen zur Verfügung, im Panel als teurere Variante gekennzeichnet (16 statt 4 USD je Mio.
Zeichen, und nur 1 statt 4 Mio. Freizeichen). Chirp3-HD (30 USD) und Studio (160 USD) sind bewusst
draußen.

Gemessene Sprechgeschwindigkeit (Basis der Textlängen-Budgets, drei Testsätze je Stimme):
14,6-16,4 Zeichen pro Sekunde bei normalem Tempo.

## 7. Bewusste Abweichungen vom Auftrag

- **Ein Hintergrund statt eines Bildes pro Abschnitt.** Der Auftrag wollte "keine harten Schnitte" -
  mehrere Hintergründe wären genau das. Nebeneffekt: geringere Kosten (siehe oben). Die
  Karussell-Slide-Anzahl des Kunden wird deshalb **nicht** wiederverwendet; die Zahl der Abschnitte
  ergibt sich aus der gewählten Videolänge, wie im Auftrag beschrieben.
- **Freigegebene Videos veröffentlicht der Server selbst**, nicht die stündliche Claude-Routine.
  Die Routine kann kein Video hochladen; Video-Anfragen und freigegebene Video-Beiträge sind
  deshalb aus `list_open_post_requests`/`list_approved_pending_posts` herausgefiltert, damit nicht
  beide Seiten dasselbe zu veröffentlichen versuchen.
- **Textsatz über SVG/sharp statt ffmpegs `drawtext`.** `drawtext` bricht nicht um und kennt keine
  Breitengrenze - im ersten Prototyp lief jede längere Zeile über den Bildrand. Der SVG-Weg ist
  derselbe, mit dem die Beitragsbilder gesetzt werden, inklusive der harten Breiten-Sicherung.

## 8. Was noch nicht gegen die echte Welt getestet ist

- **Die Veröffentlichung als Reel** (`media_type=REELS`) - dafür braucht es einen echten
  verbundenen Instagram-Account. Der Code ist gebaut und typgeprüft, aber noch nie gegen die
  Graph-API gelaufen. **Vor dem ersten echten Test kurz Rücksprache**, wie vereinbart.
- **Die Drehbuch-Erzeugung** gegen die echte Anthropic-API (in der Entwicklungsumgebung lag kein
  Schlüssel). Dieselbe Bauart wie die bereits laufenden Generatoren, aber ungetestet.
- Alles andere - Rendern, Sprachausgabe, Timing, Zeitplan, Panel, Kosten - ist mit echten Aufrufen
  bzw. echten Renderings getestet (`npm run test:video`, `npm run test:panel`).
