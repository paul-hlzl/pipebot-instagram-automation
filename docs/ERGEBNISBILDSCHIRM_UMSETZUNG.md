# Ergebnisbildschirm: Umsetzung (19.09.2026)

Alles freigegeben und gebaut. Belege aus echten Durchlaeufen gegen
channoine-mayr.at in der Sandbox.

## 1. Wiederholung: beide Ursachen behoben

**Tiefer lesen.** `analysiereWebsite()` holt jetzt zusaetzlich bis zu fuenf
Unterseiten. `interneLinks()` sammelt interne Links aus dem Quelltext,
`unterseitenLesen()` holt bis zu zehn Kandidaten parallel und nimmt die fuenf
textreichsten, je hoechstens 3.000 Zeichen. Ausgefiltert werden Feeds,
`/wp-json/`, Warenkorb, Konto und Rechtstexte - bei channoine-mayr.at machte
`/wp-json/` allein 360.000 Zeichen aus.

**Der Parser war der zweite Fehler.** Die Analyse fordert jetzt 8-10 Themen an,
aber `suggestFromWebsite()` hatte ein `.slice(0, 3)` im Antwort-Parser und hat
alles ueber drei wieder weggeworfen. Das war die eigentliche Quelle der
Wiederholung - mehr Lesen allein haette nichts gebracht. Jetzt `.slice(0, 10)`,
`MAX_PILLARS` von 6 auf 12, `max_tokens` von 500 auf 1400.

**Beitraege wissen voneinander.** `planCustomerWeek()` fuehrt eine gemeinsame
Liste der schon vergebenen Ueberschriften. Sie geht als
`vergebeneAufhaenger` in den Prompt UND wird danach geprueft
(`aufhaengerKollision`). Kollision heisst: gleiche ersten zwei Woerter, oder
>= 30 % gemeinsame Inhaltswoerter (Fuellwoerter wie "dein" zaehlen nicht), oder
schon zwei Ueberschriften mit demselben Anfangswort. Bei Kollision greift
dieselbe Ein-Neuversuch-Regel wie bei Sperrwoertern; beim zweiten Mal wird
akzeptiert und geloggt, damit kein Tag leer bleibt.

**Wichtig - das Rennen:** Pruefen und Belegen passieren in EINEM synchronen
Schritt (`reservieren`). Der erste Versuch arbeitete mit einer Kopie der Liste,
und bei drei gleichzeitigen Laeufen schrieben zwei Beitraege beide
"Energie statt Erschoepfung". Eine Momentaufnahme genuegt hier nicht.

### Gemessen, derselbe Kunde, vorher und nachher

| | Vorher | Nachher |
| --- | --- | --- |
| Themen aus der Analyse | 3 | 10 |
| Themen tatsaechlich genutzt | 3 | 6 |
| Ueberschriftenpaare mit >= 25 % gemeinsamen Woertern | 11 von 45 | 0 von 45 |
| Hoechste Aehnlichkeit zweier Ueberschriften | 0,60 | 0,20 |
| Wortgleiche Ueberschriften | 0 (aber 1 im Zwischenstand) | 0 |
| Ueberschriften, die mit "Dein/Deine" beginnen | 9 von 10 | 1 von 10 |
| Kosten je Durchlauf (neue Website) | 0,019 EUR | 0,028 EUR |

Die Kostenschaetzung von 0,028 EUR hat gehalten: gemessen 0,01167 USD Analyse
plus 0,02217 USD Texte = 0,0338 USD = 0,031 EUR beim Lauf mit zehn Themen.

## 2. Farben variieren

`wochenfarbe()` in `brand-colors.ts` leitet aus der einen Markenfarbe vier
Stufen ab (Helligkeit und Saettigung verschoben, Farbton gleich) und wechselt
dazu die Verlaufsrichtung. Jede Stufe laeuft durch
`ensureReadableWithWhite()`, der Kontrast von 4,5:1 haelt also in jeder.

Die Stufe wird **nicht gewuerfelt**, sondern aus Datum und Kanal abgeleitet.
Damit bekommt derselbe Beitrag beim Neurendern (Farbwechsel im Plan,
`backfillMissingImages`) wieder genau seine Farbe, ohne gespeicherten Index.

Gemessen: 10 Beitraege auf 4 Stufen verteilt (3/3/2/2).

## 3. Firmenname

Siehe `ERGEBNISBILDSCHIRM_BEFUND.md`. Gebaut und mit
`scripts/test-firmenname.mjs` an echten Pixeln geprueft.

## 4. Layout: A und B gezeichnet

Entwuerfe mit den echten Beitraegen und Farben dieses Kunden:

| Datei | Was |
| --- | --- |
| `docs/easy-onboarding/layout/A-360.png` | Wochenstreifen, Handy |
| `docs/easy-onboarding/layout/A-1440.png` | Wochenstreifen, Schreibtisch |
| `docs/easy-onboarding/layout/B-360.png` | Raster, Handy |
| `docs/easy-onboarding/layout/B-1440.png` | Raster, Schreibtisch |
| `docs/easy-onboarding/layout/A.html`, `B.html` | die Entwuerfe selbst |

| Variante | Bildschirmlaengen @360 | @1440 |
| --- | --- | --- |
| A Wochenstreifen | 2,1 | 1,0 |
| B Raster | 2,0 | 1,0 |
| heute | 9,2 | 5,5 |

**Empfehlung jetzt A**, nicht mehr B. Pauls Einwand haelt der Zeichnung stand:
in B fehlt die Caption ueberall, und die Caption ist die einzige Stelle, an der
die Schreibqualitaet sichtbar wird - die Ueberschrift steht ohnehin schon im
Bild. B zeigt also zweimal dasselbe. A verliert dabei kaum etwas, weil der
Streifen selbst eine kleine Wand aus Markenbildern ist und darunter sofort zwei
vollstaendige Beitraege mit Text stehen.

## 5. Bilderbudget nach der Analyse

`runPreviewJob()` entscheidet das Budget jetzt NACH `uebernehmeAnalyse()`. Sind
Markenfarben erkannt (`gradient_enabled` + beide Farben), entfaellt der Deckel
ganz, weil die Bilder lokal gerendert werden und nichts kosten. Ohne Farben
gilt er unveraendert. Das Frontend zieht mit (`bilderKostenlos()`), der Hinweis
"Bild folgt nach der Bestaetigung" erscheint nur noch, wenn er stimmt.

Belegt mit einem **unbestaetigten** Konto: 10 von 10 Beitraegen mit Bild
(vorher 3 von 10), Kosten des Laufs 0,0198 USD, davon 0 fuer Bilder.

## 6. Texte und Farbpicker

Die 21 freigegebenen Textaenderungen sind eingebaut (20 Stellen im Quelltext,
siehe `EASY_ONBOARDING_TEXTE_VERLAUF_HANDY.md`).

Der Farbpicker faehrt am Handy als halbhohes Blatt von unten hoch
(`.sheet-overlay.halb`). Der Bereich darueber bleibt **ungetoent**, sonst waere
die Live-Vorschau zwar sichtbar, aber farblich verfaelscht. Waehrend das Blatt
offen ist, ruecken die drei Vorschaukacheln nebeneinander: einzeln untereinander
sind sie zusammen 1.381 px hoch, in den freien Streifen passt so keine einzige.
Geprueft am echten Browser: Blattkante bei 343 von 780 px, alle drei Kacheln
vollstaendig darueber, Farbwechsel kommt live an. Am Schreibtisch bleibt der
Picker im Seitenfluss.
