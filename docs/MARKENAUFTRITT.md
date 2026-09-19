# Die Oberflaeche sieht nach dem Kunden aus (19.09.2026)

Zwei Dinge: das erkannte Logo in der Kopfzeile, die Markenfarben im
Lichtschein - deutlicher als bisher, aber weiter als Licht.

## Vorab geprueft: taugt das Logo ueberhaupt?

Der Auftrag war ausdruecklich, das vorher zu pruefen und abzusagen, falls nur
ein verpixeltes Favicon herauskommt. Geprueft an sieben echten Seiten:

| Seite | Bestes Fundstueck | Groesse | Art |
| --- | --- | --- | --- |
| channoine-mayr.at | JSON-LD `logo` | 661x252 | echte Wortmarke, transparent |
| pipeflow.at | `<img>` im Kopf | 400x228 | echte Wortmarke, transparent |
| orf.at | `<img>` im Kopf | SVG | Wortmarke, skalierbar |
| oebb.at | `link rel=icon` | SVG 260x260 | Wortmarke, skalierbar |
| hittaro.com | JSON-LD `logo` | 512x512 | App-Kachel mit eigenem Grund |
| apple.com | JSON-LD `logo` | 302x302 | quadratische Marke |
| sonnentor.com | `apple-touch-icon` | 192x192 | quadratische Marke |

**Ergebnis: sieben von sieben liefern etwas Brauchbares, und in keinem Fall war
das Beste ein 32er-Favicon.** Die kleinen 16er- und 32er-Icons existieren
ueberall, sind aber nie die beste Quelle. Deshalb gebaut statt abgesagt.

Zwei Dinge sind dabei aufgefallen und im Code beruecksichtigt:

- **`og:image` ist kein Logo.** Bei Channoine waere es ein 1161x700-Werbebild
  gewesen. Es ist als Quelle ausgeschlossen.
- **Manche "Logos" bringen ihren eigenen Hintergrund mit** (hittaro: dunkles
  Quadrat, keine Transparenz). Solche werden als App-Kachel mit runden Ecken
  gezeigt, sonst klebte ein dunkles Quadrat auf hellem Papier.

## Wie das Logo gefunden wird

`src/panel/brand-logo.ts`, Reihenfolge nach Verlaesslichkeit:

1. `JSON-LD Organization.logo` - wenn gesetzt, ist es das echte Markenlogo.
2. Ein `<img>` in den ersten 40.000 Zeichen, das sich selbst "logo" nennt.
   Nur der Kopfbereich: weiter unten stehen Partner- und Zahlungslogos.
3. Das groesste verlinkte Icon.

Innerhalb derselben Quelle gewinnt das groesste Bild. Verworfen wird alles
unter 96 px Kantenlaenge und alles, was heller als 215 (von 255) ist und
Transparenz hat - ein weisses Logo waere auf dem Papiergrund unsichtbar.

Abgelegt wird als PNG mit 84 px Hoehe (dreifache Anzeigehoehe) unter
`data/logos/auto-<kundennummer>.png`, in der **neuen** Spalte
`detected_logo_url`. `logo_url`, der eigene Upload des Kunden, wird nie
angefasst; die Kopfzeile zeigt den Upload, wenn es einen gibt.

Ein fehlgeschlagener Download bricht nichts ab - dann bleibt die Kopfzeile ohne
Logo.

## Die Lichtstaerke wird gerechnet, nicht gesetzt

Zuerst hatte ich feste Werte genommen (0,2 / 0,14 / 0,07). Gemessen war das
beim warmen Gold von Channoine genau richtig - aber ein fester Alphawert
trifft jede Marke anders. Ein sattes Rot waere bei 0,2 keine Beleuchtung mehr,
sondern eine Farbflaeche.

Deshalb rechnet `lichtStaerke()` das Alpha aus dem Abstand der Markenfarbe zum
Papierweiss: `Alpha = 26 / (Abstand x 0,75)`, gedeckelt bei 0,3. Die 26 sind
die sichtbare Abweichung an der staerksten Stelle oben links; der Zusammenhang
Alpha x Abstand x 0,75 ist am echten Browser gemessen.

| Markenfarbe | Abstand | Alpha | erwartete Abweichung |
| --- | --- | --- | --- |
| Gold (163,102,41) | 206 | 0,168 | 26 |
| sattes Rot (220,30,40) | 219 | 0,158 | 26 |
| tiefes Blau (20,40,140) | 230 | 0,151 | 26 |
| helles Beige (240,230,210) | 37 | 0,300 | 8 |
| fast Papierweiss | 1 | 0 | 0 |

Eine Farbe, die dem Papier ohnehin gleicht, erzeugt gar nichts. Das ist
richtig: da gibt es nichts zu zeigen.

Dazu ein dritter, sehr weiter Kegel von unten, damit die Farbe auch nach dem
ersten Bildschirm noch da ist, ohne dass irgendwo eine Kante entsteht.

## Die Bedingungen des Auftrags, gemessen

| Bedingung | Vorher | Jetzt |
| --- | --- | --- |
| Textkontrast | 16,8 : 1 | **17,4 : 1** |
| Karte zu Grund | Delta 11 | **Delta 13** |
| Abweichung oben links | 19 | **26** |
| Abweichung Seitenmitte | 11 | 9 |
| Abweichung unten | 0 | 0 |

Der Textkontrast ist sogar gestiegen, weil der Messpunkt tiefer liegt als die
staerkste Stelle. Die Karten sind reinweiss geblieben, deshalb waechst ihr
Abstand zum Grund mit, statt zu schrumpfen - die Beitragsvorschauen bleiben
das Auffaelligste auf dem Bildschirm.

Ohne erkannte Marke: kein Logo, Licht bleibt neutrales Grau. Auch das ist
geprueft.

## Pruefen

```
npm run test:marke
```

Echter Durchlauf gegen channoine-mayr.at, danach Messung am echten Browser bei
360 und 1440 Pixel: Logo vorhanden und in der richtigen Groesse, Licht traegt
die Markenfarbe, Textkontrast, Kartenabstand, und der stille Rueckfall vor der
Analyse.
