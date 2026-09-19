# Der Ergebnisbildschirm erscheint fertig (19.09.2026)

## Was falsch war

`pollStarten()` schaltete um, sobald **ein** Beitrag existierte
(`daten.posts.length && (job.done >= 1 || !laeuft)`). Danach tropfte der Rest
in die Seite, Karte fuer Karte, und die Woche sprang bei jedem Nachzuegler -
auf beiden Bildschirmgroessen.

Zwei weitere Stellen kamen dazu, beide erst beim Messen gefunden:

1. **`wocheAktualisieren()` zeichnete die ganze Seite neu.** Sie sucht
   `#woche`; den gibt es im neuen Wochenstreifen nicht mehr, also griff der
   Notfallpfad `render()`. Gemessen sprang die Seitenhoehe dabei von 2707 auf
   2044 px.
2. **Beim Neuladen wurde gar nicht vorgeladen.** `boot()` ging direkt auf
   `go("ergebnis")`. Auf dem eigenen Geraet faellt das nicht auf, weil die
   Bilder im Browser liegen - auf einem zweiten Geraet schon.

## Was jetzt passiert

- Umgeschaltet wird erst, wenn der Lauf fertig gemeldet ist **und** jedes
  erwartete Bild da ist (`alleBilderDa`).
- Danach laedt der Browser die Bilddateien selbst, bevor der Bildschirm kommt
  (`bilderVorladen`). Ohne das waere das Problem nur verschoben: der Server
  meldet fertig, der Browser laedt erst beim Anzeigen.
- Der letzte Schritt im Ladezustand bekommt dafuer eine eigene Zeile
  ("Bilder erstellt - werden geladen …"), damit sichtbar bleibt, dass gearbeitet
  wird.
- `wocheAktualisieren()` tauscht auf dem Ergebnisbildschirm Streifen und
  Tagesdetail an Ort und Stelle und laeuft nur noch, wenn sich die Woche
  wirklich geaendert hat (`wochenSignatur`).

### Drei Notbremsen

| Fall | Deckel |
| --- | --- |
| Gesamtdauer ab dem Klick | 75 s, danach wird gezeigt was da ist |
| Lauf fertig, aber Bilder fehlen | 15 s Nachfrist |
| Browser laedt eine Bilddatei nicht | 9 s, danach kommt der Bildschirm trotzdem |

## Gemessene Wartezeiten

Echte Durchlaeufe gegen channoine-mayr.at, Zwischenspeicher jeweils geleert:

| Fall | Wartezeit |
| --- | --- |
| neue Website, 360 px | 26,4 s |
| neue Website, 1440 px | 26,4 s |
| Website schon gelesen (zweiter Kunde, Vorfuehrung) | 9,3 s |
| ein Bild haengt | Bildschirm kommt nach 9,5 s statt nie |

Wohin die 26 Sekunden gehen:

| Abschnitt | Dauer |
| --- | --- |
| Website und fuenf Unterseiten lesen, Themen und Farben finden | 17,5 s |
| zehn Beitraege schreiben | 8,2 s |
| Bilder in den Browser laden | ~1 s |

Die Bilder selbst kosten fast nichts: sie werden lokal gerendert.

**Eine Verbesserung ist schon drin:** die Beitraege entstehen jetzt mit
Parallelitaet 6 statt 3, weil waehrenddessen ein Kunde auf einen leeren
Bildschirm schaut. Das Schreiben sank von 13,5 auf 8,2 Sekunden. Die
Wiederholungssperre haelt trotzdem - gemessen 0 von 45 auffaelligen Paaren,
hoechste Aehnlichkeit 0,20 -, weil Pruefen und Belegen synchron in einem
Schritt passieren. Der Nachtrag nach der E-Mail-Bestaetigung bleibt bei 3: dort
wartet niemand.

## Was noch ginge (nicht gebaut, Entscheidung offen)

| Massnahme | Ersparnis | Preis |
| --- | --- | --- |
| Kuerzere Themenbeschreibungen anfordern | ca. 4 s | duennere Beschreibungen |
| Analyse in zwei parallele Aufrufe teilen (Profil und Themen) | ca. 5-6 s | ca. +0,003 USD je Lauf |
| Weniger Beitraege vorab, Rest nach "Passt, weiter" | ca. 3 s | die Woche ist beim ersten Blick nicht mehr ganz |

Realistische Untergrenze ohne Aenderung am Versprechen: rund 18 bis 20
Sekunden. Unter "ein paar Sekunden" kommt man nur, wenn man weniger zeigt.

## Pruefen

```
npm run test:ladezustand
```

Zwei echte Durchlaeufe (360 und 1440) plus der Haenger-Fall. Geprueft wird mit
einem MutationObserver, dass nach dem Erscheinen keine Karte mehr dazukommt und
die Seitenhoehe sich nicht mehr aendert, dass alle Bilder beim Erscheinen schon
geladen sind, und wie lange der Ladezustand jeweils gedauert hat.
