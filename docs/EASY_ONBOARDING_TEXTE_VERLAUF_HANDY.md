# Easy Onboarding: Texte, Verlauf, Handy

Stand 19.09.2026. Sandbox. Vorgelegt als Claude-Doc:
https://claude.ai/code/artifact/12a9d43e-4589-4d46-8fcd-9901019d6600

Die Texte sind ein Vorschlag und noch **nirgends eingebaut**. Der Verlauf ist
fertig und in der Sandbox zu sehen. Beim Handy gibt es eine Stelle, die ohne
Pauls Entscheidung nicht umgebaut wird.

## Teil 1: Texte (Vorschlag, nicht eingebaut)

21 Aenderungen an 15 Bildschirmen. Drei davon sind Fehler, keine Geschmacksfrage.

### Fehler im Text

| Bildschirm | Aktuell | Neu | Warum |
| --- | --- | --- | --- |
| E-Mail | Zurueck zu Google, Microsoft und Apple | Zurueck zu den Anmeldewegen | Apple ist entfernt, der Text nennt ihn noch |
| Kanaele verbinden | Zum Dashboard | Zur Uebersicht | Der Kopfknopf heisst schon "Zur Uebersicht" und fuehrt auf denselben Bildschirm |
| Arbeitet | ... wir nehmen unser Standardthema. | ... wir nehmen unsere Standardfarben. | "Thema" kollidiert mit der Zeile "Themen erkannt" zwei Zeilen darueber |

### Doppelte Ueberschrift

"So koennte deine naechste Woche aussehen" steht auf Website- und Ergebnis-Bildschirm.

| Bildschirm | Aktuell | Neu | Warum |
| --- | --- | --- | --- |
| Website | So koennte deine naechste Woche aussehen | Deine Website genuegt. | Ueberschrift soll die eine Frage nennen, nicht das Versprechen vorwegnehmen |
| Website | Gib deine Website ein. Wir lesen sie, erkennen Themen und Farben und planen die naechsten sieben Tage. | Wir lesen sie einmal, erkennen Themen und Farben und planen daraus die naechsten sieben Tage. | Aufforderung steht schon am Feld; "einmal" nimmt die Sorge vor Dauerzugriff |

### Erster Bildschirm

| Bildschirm | Aktuell | Neu | Warum |
| --- | --- | --- | --- |
| Konto | Deine Beitraege. Jede Woche. Automatisch. | Aus deiner Website wird deine naechste Woche. | Drei Fragmente sind Werbesprache; neu nennt Eingang und Ergebnis |
| Konto | Pipeflow liest deine Website ... Du gibst nur noch frei. | Wir lesen deine Website, erkennen Themen und Farben und legen dir sieben Tage Instagram und LinkedIn vor. Veroeffentlicht wird nur, was du freigibst. | "Du gibst nur noch frei" klingt nach Pflicht; als Zusage nimmt es die groesste Sorge |
| Konto | ... stimmst du zu, dass Pipeline AI Solutions deine Angaben speichert, um Beitraege fuer dich vorzubereiten. | ... erlaubst du Pipeline AI Solutions, deine Angaben zu speichern und daraus Beitraege vorzubereiten. | Spart eine Verschachtelung, inhaltlich identisch |

### Anmelden und E-Mail

| Bildschirm | Aktuell | Neu | Warum |
| --- | --- | --- | --- |
| Anmelden | Melde dich so an, wie du dein Konto angelegt hast. Es entsteht dabei nichts Neues. | Nimm den Weg, mit dem du dein Konto angelegt hast. | Zweiter Satz beruhigt wegen einer Sorge, die hier niemand hat |
| Anmelden | Noch kein Konto? Hier geht's los | Noch kein Konto? Hier anlegen | Gegenstueck heisst "Hier anmelden" |
| E-Mail | Mit E-Mail fortfahren | Deine E-Mail-Adresse | Ueberschrift wiederholt sonst den gerade gedrueckten Knopf |
| E-Mail | Wir erkennen selbst, ob wir dich schon kennen. | Kennen wir die Adresse schon, schicken wir dir einen Anmeldelink. Sonst geht es direkt weiter. | Alter Satz klingt nach Ueberwachung und sagt nicht, was passiert |
| Gesendet | Willkommen zurueck | Schau in dein Postfach | Begruessung steht schon auf dem Kontokarten-Bildschirm |
| Gesendet | ... Er gilt eine Stunde. | ... Er gilt eine Stunde und laesst sich einmal verwenden. | Link ist tatsaechlich einmalig |
| Gesendet | Fuer X gibt es schon ein Konto. In der letzten Stunde wurden bereits Anmeldelinks verschickt - bitte schau ins Postfach. | An X haben wir in der letzten Stunde schon einen Anmeldelink geschickt. Bitte nimm den, ein neuer kommt erst danach. | Passiv, erklaert nicht, warum nichts Neues ankommt |

### Beschreibung, Ergebnis, Anders

| Bildschirm | Aktuell | Neu | Warum |
| --- | --- | --- | --- |
| Beschreibung | Ein, zwei Saetze reichen. Wenn es holprig klingt: "Mit KI verbessern" macht einen sauberen Absatz daraus, den du weiter bearbeiten kannst. | Ein, zwei Saetze reichen. Stichworte auch - der Knopf darunter macht einen sauberen Absatz daraus. | Zitiert den Knopf daneben; "Stichworte auch" senkt die Huerde staerker |
| Ergebnis | ... zwei Themen, die auf deiner Website besonders hervorstachen. | ... die zwei Themen, die auf deiner Website am deutlichsten sind. | Vergangenheit klingt nach abgeschlossenem Vorgang |
| Ergebnis | Die Farben stammen von deiner Website. | Die Farben kommen ebenfalls von dort. | Dritte Nennung von "deiner Website" im selben Absatz |
| Anders | Wir uebersetzen das in Beschreibung, Tonalitaet und Themen und schreiben die Woche neu. | Wir schreiben die offenen Beitraege damit neu. | Datenfeldnamen raus; wichtig ist, dass nur offene Beitraege betroffen sind |

### Plan, Verbinden, Einstellungen, Uebersicht

| Bildschirm | Aktuell | Neu | Warum |
| --- | --- | --- | --- |
| Plan | Jede Zeile laesst sich mit dem Stift aendern. | Jede Zeile kannst du aendern. | Der Stift ist sichtbar |
| Verbinden | Damit Pipeflow fuer dich veroeffentlichen kann. Jeder Kanal einzeln, jeder ueberspringbar. | Damit Pipeflow veroeffentlichen kann. Jeden Kanal kannst du auch spaeter verbinden. | Zwei Satzfragmente; "ueberspringbar" ist Behoerdendeutsch |
| Einstellungen | Dein Plan, deine Kanaele, dein Verlauf. Alles Weitere bleibt im klassischen Panel. | Dein Plan, deine Kanaele, deine veroeffentlichten Beitraege. Alles Weitere findest du im klassischen Panel. | Abschnitt heisst weiter unten "Veroeffentlicht", nicht "Verlauf" |
| Uebersicht | Erst danach wird veroeffentlicht und die restlichen Bilder werden erstellt. | Erst danach veroeffentlichen wir und erstellen die restlichen Bilder. | Doppeltes Passiv, obwohl klar ist, wer handelt |

### Unveraendert

"Was macht dein Unternehmen?", "Wir lesen <domain>", "Das dauert meistens unter
einer Minute", die fuenf Fortschrittsschritte, "So koennte deine naechste Woche
aussehen." (Ergebnis), "Passt, weiter", "Anders machen", "Nichts wird
veroeffentlicht, bevor du es freigibst", "Ich habe keine Website", "Dein Plan",
"Plan uebernehmen", "Spaeter verbinden", "So sehen deine naechsten Tage aus",
"Jetzt posten", "Noch nichts veroeffentlicht ...", "Das hat nicht geklappt",
alle Fehlermeldungen.

## Teil 2: Hintergrund als Verlauf (gebaut)

Zwei radiale Lichtkegel von oben links (12% / -2%) und oben rechts (96% / 2%),
Hoehe 900 bzw. 760 Pixel, in `public/panel/start/start.css`. Ohne erkannte
Farben sind sie neutrales Grau (`--licht-1` rgba(13,13,13,.05), `--licht-2`
rgba(13,13,13,.03)). Mit erkannten Markenfarben setzt `lichtSetzen()` in
`start.js` Hauptfarbe mit 13% und Verlaufspartner mit 8,5% Deckkraft.

Damit die Vorschauen sich weiter abheben: Grundflaeche von Weiss auf `#faf9f7`,
alle Karten auf reines Weiss.

Gemessen (hittaro.com, 360 und 1440 Pixel, identisch):

| Messung | Wert |
| --- | --- |
| Hintergrund oben | rgb(241, 238, 231) |
| Kontrast Flisstext zu Hintergrund | 16,8 : 1 |
| Karte zu Umgebung | Delta 11 |

**Wo es nicht traegt:** auf den langen Bildschirmen nur oben. Ergebnis 7208 px,
Uebersicht 8578 px bei 360 Pixel; das Licht endet nach 900 px. Bewusst nicht
ueber die ganze Laenge gezogen - ein Verlauf, der sich ueber 8000 px
wiederholt, waere ein Muster, keine Beleuchtung.

## Teil 3: Handy bei 360 Pixel

Gemessen mit `scripts/handy-audit.mjs`, echter Browser, Screenshots unter
`docs/easy-onboarding/handy/`. Nichts kaputt, kein Ueberlauf. Vier Stellen sind
am Handy schlechter als am Desktop:

1. **Farbpicker zeigt am Handy nicht, was er tut.** Picker beginnt bei 197 px,
   ist 505 px hoch, Fenster 780 px. Die live mitlaufenden Vorschauen darueber
   sind dann aus dem Bild (`vorschauSichtbar: false`). Am Desktop sichtbar.
2. **Ergebnis ist am Handy fast doppelt so lang.** 9,2 Bildschirmlaengen bei
   360 gegen 5,5 bei 1440; Uebersicht 11. Kachel 328 x 408 px, sieben Beitraege.
3. **Zwei Tippziele zu klein.** Der "mehr"-Link in den Beitragskacheln ist
   32 px (Vorgabe 44), auf Ergebnis und Uebersicht. Alles andere >= 44.
4. **Umgekehrt: Desktop schlechter als Handy.** Einstellungen und Picker laufen
   bei 1440 px auf bis zu 150 Zeichen pro Zeile. Handy 39-47, also richtig.

| Bildschirm | Breite | Seitenhoehe | Bildschirmlaengen | Zeichen/Zeile | Kachel | Bildhoehe | Kleinstes Ziel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Konto | 360 | 898 | 1,2 | 47 | - | - | 44 |
| Website | 360 | 780 | 1,0 | 47 | - | - | 47 |
| Arbeitet | 360 | 780 | 1,0 | 41 | - | - | keins |
| Ergebnis | 360 | 7208 | 9,2 | 43 | 328 | 408 | 32 |
| Plan | 360 | 2574 | 3,3 | 39 | 328 | 408 | 44 |
| Plan mit Picker | 360 | 3093 | 4,0 | 39 | 328 | 408 | 44 |
| Verbinden | 360 | 955 | 1,2 | 42 | - | - | 44 |
| Uebersicht | 360 | 8578 | 11,0 | 43 | 328 | 408 | 32 |
| Einstellungen | 360 | 2416 | 3,1 | 47 | - | - | 44 |
| Konto | 1440 | 900 | 1,0 | 75 | - | - | 44 |
| Uebersicht | 1440 | 4927 | 5,5 | 60 | 443 | 551 | 32 |
| Einstellungen | 1440 | 2128 | 2,4 | 150 | - | - | 44 |
| Plan mit Picker | 1440 | 2572 | 2,9 | 150 | - | - | 44 |

## Offene Entscheidungen

1. Gehen die 21 Textaenderungen so durch? Die drei Fehler wuerde ich in jedem
   Fall machen.
2. Farbpicker am Handy - Umbau, daher vorher gefragt. (a) eine Vorschaukachel
   klebt beim Oeffnen oben fest, (b) Picker faehrt als halbhohes Blatt von unten
   hoch und laesst die obere Haelfte frei, (c) so lassen.
3. "mehr"-Link auf 44 px vergroessern - reiner Klickbereich, kein optischer
   Unterschied.

Zur Laenge des Ergebnisses am Handy kein Vorschlag: sieben Beitraege mit Bild
kleiner zu machen wuerde genau das kaputtmachen, worum es geht.

## Produktion

Nach jedem Schritt gegengeprueft mit `scripts/easy-onboarding-baseline-check.sh`:
gleiche Prozess-IDs, gleiche sha256 in `/root/panel-live`, `panel.db` unveraendert
(6 Kunden, 174 geplante Beitraege, keine `start_previews`-Tabelle).
