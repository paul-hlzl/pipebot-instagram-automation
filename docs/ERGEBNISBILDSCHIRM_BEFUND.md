# Ergebnisbildschirm: Befund (19.09.2026)

Untersucht an einem frischen Durchlauf fuer channoine-mayr.at in der Sandbox.
Gebaut wurde nur Punkt 3. Claude-Doc mit derselben Fassung:
https://claude.ai/code/artifact/12a9d43e-4589-4d46-8fcd-9901019d6600

## 1. Wiederholung: Ursache liegt beim Lesen

**Die Analyse liest genau eine Seite.** `analysiereWebsite()` in
`start-analysis.ts` holt die Startseite, `extractPageText()` schneidet den
Fliesstext auf 2000 Zeichen. Bei channoine-mayr.at hat die Startseite nur 1873
Zeichen - die Grenze greift also gar nicht. Das Problem ist, dass keine
Unterseite geladen wird.

| Seite | Zeichen Fliesstext |
| --- | --- |
| Startseite (heute die einzige Quelle) | 1.813 |
| /channoine-premium-gesichtspflege/ | 24.826 |
| /channoine-partner-werden/ | 7.283 |
| /nobusan-vitalitaet-bewusst-begleiten/ | 6.442 |
| /karriere/ | 1.337 |
| /kontakt/ | 330 |
| **Summe** | **42.031** |

Genutzt werden 1.873 von 42.031 Zeichen = **4,5 %**. Die inhaltsreichste Seite
(Gesichtspflege, 24.826 Zeichen, Produkte und Wirkstoffe) wird nie gelesen.
Auf der Startseite steht dagegen "Beauty-Botschafter werden" viermal - einmal
als Menuepunkt, dreimal als Knopf.

**Die Generierung kennt ihre Geschwister nicht.** `suggestFromWebsite()`
verlangt im Prompt *genau 3* Saeulen. `planCustomerWeek()` erzeugt daraus 10
Beitraege in 10 getrennten Aufrufen; `generatePost()` bekommt pro Aufruf nur
Firma, Branche, about, Tonalitaet und EINE Saeule. Kein Aufruf weiss, was die
anderen neun schon sagen. Einzige Vorkehrung: `pickWeightedPillar(pillars,
lastPillarTitle)` verhindert nur zweimal dieselbe Saeule HINTEREINANDER.

Gemessener Durchlauf: 4 / 4 / 2 Beitraege auf drei Saeulen.
Neun von zehn Ueberschriften beginnen mit "Dein" oder "Deine".
11 von 45 Ueberschriftenpaaren teilen >= 25 % ihrer Woerter:

| Ueberlappung | Paar |
| --- | --- |
| 60 % | "Deine Haut verdient Perfektion" / "Deine Haut verdient Analyse" |
| 50 % | "Dein Weg zu Beauty-Erfolg" / "Dein Weg zur Beauty Unternehmerin" |
| 33 % | "Deine Schoenheit, Dein Business" / "Dein Beauty Business wartet" |

### Kosten fuer tieferes Lesen (Haiku 4.5, 1 USD/MTok ein, 5 USD/MTok aus)

| Posten | Heute | Mit 5 Unterseiten + Wiederholungssperre |
| --- | --- | --- |
| Website-Analyse | 0,0032 USD | 0,0100 USD |
| 10 Beitraege (Text) | 0,0172 USD | 0,0202 USD |
| 10 Bilder | 0 USD | 0 USD |
| **Summe je Durchlauf** | **0,019 EUR** | **0,028 EUR** |

Aufschlag rund **0,9 Cent** je Durchlauf.

### Vorschlag (nicht gebaut, wartet auf Freigabe)

1. Bis zu 5 Unterseiten aus dem Menue mitlesen, je max. 3.000 Zeichen,
   Feeds und `/wp-json/` aussortieren.
2. Statt 3 Saeulen 8-10 anfordern.
3. Jedem Beitrag die in derselben Woche bereits vergebenen Aufhaenger
   mitgeben, mit der Anweisung, einen neuen zu waehlen.
4. Pruefung nach dem Schreiben: zu aehnliche Ueberschrift -> einmal neu
   schreiben, wie es `assertNoBannedWords` heute schon tut (`avoidNote` ist
   dafuer schon im Prompt vorgesehen).

## 2. Herkunft der Farben

`accentColor` #a36629 stammt aus dem **Logo** (`source: "logo"`), dort per
Pixelzaehlung als #d09860 gefunden und auf #a36629 abgedunkelt, damit weisse
Schrift 4,5:1 erreicht (`adjustedForContrast: true`).

Alle Kandidaten, die die Erkennung gefunden hat:

| Farbe | Bewertung | Herkunft |
| --- | --- | --- |
| #d09860 | 10,24 | Logo/Favicon |
| #6ec1e4 | 3,73 | Inline-CSS `--e-global-color-primary` |
| #61ce70 | 3,61 | Inline-CSS `--e-global-color-accent` |
| #00d084 | 2,98 | Inline-CSS |
| #ff6900 | 2,86 | Inline-CSS |
| #8ed1fc | 2,40 | Inline-CSS |

Die fuenf CSS-Farben sind die **unveraenderte Standardpalette von Elementor**.
Sie stehen im Quelltext, kommen auf der Seite aber nicht vor. Der
Verlaufspartner muss >= 40 % der Bestbewertung erreichen (4,1) - keiner
schafft das, also wurde #56441a aus der Hauptfarbe abgeleitet. Das ist
richtig so; ein hellblauer Verlauf waere bei dieser Marke falsch.

**Zehnmal derselbe Ton sieht nicht gut aus.** Vorschlag: aus der einen
Markenfarbe 3-4 Abstufungen in Helligkeit/Saettigung plus 2 Verlaufsrichtungen
ableiten und ueber die Woche rotieren. Kostet nichts (lokal gerendert).

## 3. Firmenname (GEBAUT)

Zwei Ursachen. Erstens war der Name Dekoration: um 90 Grad gedreht, 11 % der
Bildhoehe, 18 % Deckkraft, am rechten Rand (`marginRight` 7 %). Zweitens wird
das 1:1-Bild in der Vorschau in einem 4:5-Rahmen gezeigt
(`start.css: .media.feed { aspect-ratio: 4/5 }`), also werden links und rechts
je 10 % der Breite weggeschnitten - genau die Zone des Namens.

Jetzt: waagrecht unten links auf der Fluchtlinie der Headline (18 % der
Breite), Grundlinie bei 93,5 % der Hoehe, 4,2 % Schriftgrad, 92 % Deckkraft
mit weichem Schatten, in der Kundenschrift. Die Headline-Safe-Zone endet
dafuer bei 86 % statt 100 % der Hoehe.

**Wichtig fuer spaeter:** `textLength`/`lengthAdjust` wird von librsvg hier
NICHT umgesetzt - gemessen lief der Name trotzdem bis x=995 statt 840. Lange
Namen werden deshalb erst verkleinert (Untergrenze 3,2 %) und dann gekuerzt.
`scripts/test-firmenname.mjs` prueft das an echten Pixeln inklusive
4:5-Beschnitt (14 Pruefungen, gruen).

**Offen:** Bilder werden 1:1 erzeugt, aber 4:5 gezeigt - 20 % der Breite gehen
bei jedem Bild verloren. Direkt in 4:5 erzeugen? Das ist auch Instagrams
bevorzugtes Feed-Format.

## 4. Ansicht: drei Varianten (nicht gebaut)

| Variante | Idee | Bildschirmlaengen @360 | Dafuer | Dagegen |
| --- | --- | --- | --- | --- |
| A Wochenstreifen | 7 schmale Tageskarten waagrecht oben, darunter der gewaehlte Tag gross | ~1 | Woche ist als Woche sichtbar | nur ein Text zugleich, waagrechtes Wischen wird uebersehen |
| B Raster | 2 Spalten (Handy) / 4 (Desktop), nur Bild + Wochentag + Ueberschrift, Antippen oeffnet das bestehende Blatt | ~2 | staerkster erster Eindruck: 10 Markenbilder auf einmal | Texte hinter einem Antippen, Freigabe muss ins Blatt |
| C Zeitachse | eine Spalte, Zeile je Beitrag mit 72px-Miniatur, Aufklappen an Ort und Stelle | ~2 | wenigster Umbau, Text bleibt sichtbar | Bilder werden klein - und die verkaufen |

Empfehlung: **B fuer den Ergebnisbildschirm, C fuer die Uebersicht.**

## 5. "Bild folgt nach der Bestaetigung"

Beides stimmt, nur nicht gleichzeitig. Mit erkannten Markenfarben rendert
`generateImageUrl` den Verlauf lokal und ruft fal.ai nicht auf: Kosten 0.
Ohne Farben laeuft das Bild ueber fal.ai: 0,003 USD.

Der Fehler ist der **Zeitpunkt**: `start-routes.ts` setzt
`imageBudget: c.email_verified ? undefined : limits.imagesUnverified`, wenn die
Anfrage eintrifft - also bevor die Website gelesen wurde und bevor irgendwer
weiss, ob es Markenfarben gibt. Deshalb bekommt auch ein Kunde mit Farben nur
3 Bilder, obwohl alle 10 nichts kosten.

Vorschlag: Budget erst nach der Analyse setzen. Mit Verlauf die ganze Woche,
ohne Verlauf weiterhin 3.
