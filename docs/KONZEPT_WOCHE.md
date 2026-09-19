# Der Kunde hat die Kontrolle über seine Woche (Konzept 19.09.2026, gebaut am selben Tag)

Freigegeben und gebaut - siehe Abschnitt 6 fuer den Stand. Zeichnungen bei 360 px unter
`docs/easy-onboarding/konzept/` (M1 Woche, M2 Blatt, M3 Verschieben, M4 Rückgängig).

## 1. Bedienung: ein Prinzip für Handy und Desktop

**Antippen statt Ziehen.** Jede Handlung ist ein Tipp auf eine Karte oder auf
einen Chip. Es gibt keine Geste, die am Handy schlechter funktioniert als am
Desktop, weil es keine Geste gibt. Der Desktop bekommt kein Ziehen als Bonus:
dieselben Karten, dasselbe Blatt (dort mittig statt von unten, wie das
bestehende `.sheet` es schon macht).

**Auf der Karte sichtbar (M1):** der Zustand oben rechts, darunter Bild,
Überschrift, Textanfang, und genau zwei Handlungen: **Bearbeiten** und
**Überspringen**. Rechts ein leises `···` für alles Weitere. Bei einem
übersprungenen Beitrag steht statt beidem nur **Doch posten**.

**Im Blatt (M2), das über Bearbeiten oder `···` aufgeht:** Überschrift, Text,
Bild (mit *Eigenes Bild*), Speichern. Darunter in einer leisen Reihe:
*Anderer Tag*, *Neu schreiben lassen*, *Entfernen*. Mehr nicht.

**Verschieben (M3):** Tag und Uhrzeit als Chips. Belegte Tage stehen als
„belegt“ dabei und sind nicht wählbar - ein Kanal, ein Tag, ein Beitrag bleibt
die Regel, die die Routine kennt. Sortieren innerhalb eines Tags entfällt damit
(es gibt je Kanal nur einen).

**Eigener Beitrag:** ein einziges „+ Eigenen Beitrag schreiben“ am Ende der
Woche öffnet dasselbe Blatt, leer, mit Tag/Uhrzeit-Chips.

**Pause:** eine Zeile unter der Überschrift, „Automatik läuft · pausieren“.
Pausiert heißt: nichts geht raus, nichts wird neu geschrieben, die Woche bleibt
sichtbar und bearbeitbar. Der Schalter `customer_paused` existiert bereits.

**Rückgängig (M4):** nach jeder Handlung eine schwarze Zeile unten mit
„Rückgängig“, sichtbar rund acht Sekunden. Dahinter genau ein Schritt - kein
Verlauf, keine Versionen. Das deckt den Fall „falsch getippt“, um den es geht.

## 2. Zustände

| Zustand | Wer setzt ihn | Farbe/Punkt | Routine darf |
| --- | --- | --- | --- |
| Geplant | Pipeflow | grau | veröffentlichen, bei Bedarf neu schreiben |
| Freigegeben | Kunde (Freigabemodus) | grün | veröffentlichen, **nie** neu schreiben |
| Von dir bearbeitet | Kunde (Text/Bild geändert) | schwarz | veröffentlichen, **nie** neu schreiben |
| Eigener Beitrag | Kunde (selbst geschrieben) | Markenfarbe | veröffentlichen, **nie** neu schreiben |
| Übersprungen | Kunde | grau, Karte gedimmt | nichts |
| Veröffentlicht | Routine | - | nichts |
| Pausiert (ganze Woche) | Kunde | Zeile oben | nichts |

„Verschoben“ ist kein eigener Zustand: ein verschobener Beitrag ist ein
bearbeiteter. „Übersprungen“ heißt intern heute `rejected` - der Name bleibt in
der Datenbank, im Panel heißt es übersprungen.

## 3. Wie das Überschreiben verhindert wird

Das ist der Punkt, an dem es kaputtgeht, also zuerst der Befund. Es gibt heute
**fünf** Stellen, die eine Beitragszeile nachträglich neu schreiben:

| Stelle | Fasst an | Befund |
| --- | --- | --- |
| `refreshStalePlannedPosts` (nächtlich) | nur `planned` | sicher |
| `regeneratePlannedPostsForBranding` | `planned`, mit Bestätigung auch `edited` | nach Rückfrage - bleibt so |
| `recolorPlannedPosts` (Farbwechsel) | Bild von `planned/edited/approved` | nur Bild, Text bleibt - **aber** ein eigenes hochgeladenes Bild würde überschrieben |
| **`ensureFreshPlannedPost`** (Sicherheitsnetz vor jedem Veröffentlichen) | `planned`, **`edited`, `approved`** | **Lücke.** Ändert der Kunde nach dem Bearbeiten seine Farbe, gilt der Beitrag als „veraltet“ und wird kurz vor dem Posten komplett neu geschrieben - Text weg. |
| `overwritePlannedPostContent` | setzt **immer** `status = 'planned'` zurück | jeder Aufruf löscht damit auch „bearbeitet“ und „freigegeben“ |

Das ist keine Vermutung: `ensureFreshPlannedPost` lässt `edited` und `approved`
ausdrücklich durch (Zeile 1 der Funktion) und ruft dann `overwritePlannedPostContent`.

**Die Sicherung, dreifach:**

1. **Ein Herkunftsfeld.** Neue Spalte `planned_posts.origin` mit `auto` oder
   `kunde`, additiv. Jede Kundenhandlung - Text, Bild, Verschieben, eigener
   Beitrag - setzt `kunde`. Nichts setzt es je zurück auf `auto`.
2. **Eine Schranke an genau einer Stelle.** `overwritePlannedPostContent`
   verweigert bei `origin = 'kunde'` und wirft. Damit sind alle fünf Stellen
   oben abgedeckt, auch die, die es heute noch nicht gibt - weil sie alle
   durch diese eine Funktion müssen. Zusätzlich setzt sie den Status nicht
   mehr auf `planned` zurück, sondern lässt ihn stehen.
3. **Ein Test, der es beweist.** Für jeden der fünf Wege: Beitrag anlegen,
   als Kunde ändern, Weg auslösen, prüfen, dass Text, Bild und Zustand
   unverändert sind. Läuft in der Sandbox und gegen die Produktionskopie.

Dazu: `recolorPlannedPosts` und `backfillMissingImages` überspringen Beiträge
mit eigenem Bild (neue Spalte `image_source` = `kunde`).

**Was die Routine bei claude.ai sieht:** nichts Neues. `get_planned_post`
liefert die Zeile wie bisher; übersprungene und pausierte liefern keine.
Der Routine-Prompt braucht keine Änderung.

## 4. Was ich anders lösen würde als beschrieben

- **Verschieben auf einen belegten Tag:** nicht tauschen, sondern verweigern
  („belegt“). Tauschen wäre eine zweite Handlung hinter einer ersten und am
  Handy nicht erklärbar.
- **Uhrzeit je Beitrag:** ja, aber als Auswahl aus vier Zeiten plus „andere“,
  nicht als freies Zeitfeld. Das reicht und bleibt tippbar.
- **„Ganz entfallen lassen“ und „überspringen“** sind für den Kunden dasselbe:
  der Tag bleibt leer. Ein Beitrag wird nicht gelöscht, nur übersprungen -
  sonst gibt es nichts, was Rückgängig zurückholen könnte.
- **Sortieren innerhalb eines Tags** entfällt (siehe oben). Die ↑↓-Knöpfe
  und der Ziehgriff verschwinden.

## 5. Später vielleicht (nicht bauen)

- Uhrzeit je Beitrag (braucht eine Änderung an `get_planned_post` und damit an der Routine).

- Mehrere Rückgängig-Schritte oder ein Verlauf je Beitrag.
- Vorschau des Instagram-Rasters aus den geplanten Bildern.
- Beitrag auf einen anderen Kanal kopieren.
- Vorlagen für eigene Beiträge.
- Wiederkehrende eigene Beiträge (jeden Freitag).

## 6. Gebaut (19.09.2026)

**Server** (`src/panel/woche-routes.ts`, nur diese Handlungen):

| Handlung | Endpunkt | Setzt |
| --- | --- | --- |
| Doch posten | `POST /api/planned-posts/:id/unskip` | Zustand zurueck (edited bei Kundenarbeit, sonst planned) |
| Anderer Tag | `POST /api/planned-posts/:id/move` | `scheduled_for`, origin kunde; belegte Tage werden verweigert |
| Neu schreiben lassen | `POST /api/planned-posts/:id/regenerate` | Text (und Bild, ausser eigenes Bild), origin kunde; max. 3-mal |
| Eigenes Bild | `POST /api/planned-posts/:id/image` | `image_url` (R2), `image_source` kunde |
| Eigener Beitrag | `POST /api/planned-posts` | neue Zeile, origin kunde, Bild in Markenfarben |
| Rueckgaengig | `POST /api/planned-posts/:id/undo` | einen Schritt zurueck (Tabelle `planned_post_undo`) |

Bearbeiten (`PATCH /:id`), Ueberspringen und Freigeben gab es schon; sie sichern jetzt vor der
Aenderung fuer Rueckgaengig. Rueckgaengig setzt die Herkunft nie auf `auto` zurueck - was der
Kunde einmal angefasst hat, bleibt geschuetzt.

**Oberflaeche:** Zustand oben rechts auf jeder Karte, zwei Handlungen sichtbar (Bearbeiten und
Ueberspringen; im Freigabemodus Freigeben und Bearbeiten), Rest im Blatt hinter `···`. Kein
Ziehen, keine Pfeile mehr. Tag als Chips, Eigener Beitrag als `+` am Ende der Woche, Pause als
Zeile unter der Ueberschrift, Rueckgaengig als schwarze Zeile unten fuer acht Sekunden.
Uebersprungene Beitraege bleiben in der Uebersicht sichtbar (gedaempft, "Doch posten").

**Eine Abweichung vom Konzept, bewusst:** die **Uhrzeit je Beitrag ist nicht gebaut.** Die
Routine bei claude.ai fragt stuendlich nur "gibt es fuer heute einen Beitrag" und veroeffentlicht
zur Uhrzeit des Kunden (`customers.post_time`); eine Uhrzeit je Beitrag muesste sie kennen, und
der Routine-Prompt darf in diesem Auftrag nicht veraendert werden. Steht unter "spaeter
vielleicht", mit dem Hinweis, dass es eine Aenderung an `get_planned_post` braucht.

**Nachweis:** `npm run test:woche` - jede Handlung im echten Browser bei 360 und 1440, inklusive
Rueckgaengig, belegter Tage, eigenem Bild und eigenem Beitrag; `npm run test:schranke` - die
sechs Schreibwege gegen Kundenarbeit.
