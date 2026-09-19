# Sprachwache: russische Beitraege (19.09.2026)

Anlass: bei channoine-mayr.at erschien "Система красоты" im Bild und in der
Caption.

## Was ich geprueft und ausgeschlossen habe

| Hypothese | Pruefung | Ergebnis |
| --- | --- | --- |
| Die Website enthaelt Russisch | Startseite + 5 Unterseiten, Fliesstext UND Quelltext auf Kyrillisch durchsucht | ausgeschlossen, 0 Treffer |
| Die Analyse liefert Russisch | `domain_cache`-Eintrag komplett durchsucht; Saeulen, Branche, Beschreibung gelesen | ausgeschlossen, alles Deutsch |
| Es steckt noch in der Datenbank | alle 191 geplanten Beitraege, alle Freigaben, alle veroeffentlichten | 0 Treffer (Pauls Lauf war geloescht) |
| Die Sprachvorgabe fehlte im Prompt | Prompt gelesen | nein, "Schreibe vollständig auf Deutsch" stand drin - mitten im Block als Halbsatz |
| Es ist deterministisch reproduzierbar | 64 echte Erzeugungen: 40 mit den heutigen 10 Saeulen, 24 mit den alten 3 (darunter "Beauty mit System", die woertliche Vorlage von "Система красоты") | **nicht reproduziert**, 0 Treffer, Kosten 0,108 USD |

## Wie sicher ich mir bin

**Ursache: seltener Ausrutscher des Modells, keine deterministische Kette.**
Sicherheit: hoch fuer das, was es NICHT ist (die vier ausgeschlossenen
Hypothesen sind gemessen), begrenzt fuer die genaue Rate. Bei 64 Versuchen ohne
Treffer liegt die Obergrenze bei rund 4,6 % je Beitrag (95 %). Bei zehn
Beitraegen je Woche waere damit bis zu jede dritte Woche betroffen - passt
dazu, dass Paul es gesehen hat und ich es nicht ausloesen konnte.

**Konsequenz fuer den Fix:** Ein staerkerer Prompt senkt die
Wahrscheinlichkeit, garantiert aber nichts. Die Garantie muss aus einer
Pruefung des fertigen Textes kommen.

## Was gebaut ist

1. **`src/panel/sprache.ts`** - `fremdeSchrift()` erkennt kyrillisch,
   griechisch, hebraeisch, arabisch, chinesisch/japanisch, koreanisch, thai,
   devanagari, armenisch, georgisch. Ein einziges Zeichen genuegt.
   `sprachFehler()` prueft zusaetzlich Deutsch gegen Englisch ueber
   Funktionswoerter - bewusst zurueckhaltend: erst ab 12 Woertern und nur bei
   deutlichem Uebergewicht, damit ein englischer Slogan in einem deutschen
   Beitrag nicht zum Abbruch fuehrt.
2. **Sprache der Website statt fester Annahme.** `websiteSprache()` liest
   `<html lang>`, sonst die Funktionswoerter; das Ergebnis landet in
   `customers.language`. Vorher war "de" fest verdrahtet.
3. **Pruefung an jeder Stelle, an der Text entsteht.** In `generatePost()` bis
   zu zwei zusaetzliche Versuche nur wegen Sprache, und wenn danach immer noch
   fremde Schrift drin ist, wird **geworfen**: kein Beitrag ist besser als ein
   russischer. Die Neuversuche der anderen Pruefungen laufen ebenfalls durch
   `assertSprache()`.
4. **Auch die Analyse.** Kaeme sie in fremder Schrift zurueck, wuerde sich das
   ueber `about` und die Saeulen auf jeden Beitrag der Woche vererben - deshalb
   dort ein Neuversuch und danach Abbruch.
5. **Prompt.** Die Sprachvorgabe steht jetzt ZUERST und nennt Sprache und
   Schriftsystem getrennt.

## Belege

`npm run test:sprache` - 9 Pruefungen, darunter der Originalfall
"Система красоты", gemischte Texte, alle acht Schriftsysteme, und die
Gegenprobe, dass deutsche Beitraege mit Umlauten, Emojis und englischem Slogan
durchgehen.

Ein echter Durchlauf danach: Sprache als "de" erkannt und gespeichert, 10 von
10 Beitraegen ohne fremde Schrift.

**Was damit NICHT belegt ist:** dass die Sperre im Echtbetrieb greift, konnte
ich nicht zeigen, weil sich der Ausrutscher nicht ausloesen liess. Belegt sind
die Entscheidungslogik (9 Tests) und die Verdrahtung - letztere ist derselbe
Wurf-und-Neuversuch-Weg, den die Sperrwortpruefung seit Langem nutzt und den
`npm run test:start` abdeckt.
