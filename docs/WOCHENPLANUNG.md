# Wochenplanung (20.09.2026)

Bis zum 19.09.2026 lief die Vorausplanung jede Nacht um 03:00 UTC und schob ein rollendes
Fenster von sieben Tagen vor sich her - jede Nacht wuchs genau ein Tag hinten nach. Der Kunde
sah nie eine Woche entstehen, sondern jeden Morgen einen Beitrag mehr.

Seit dem 20.09.2026 gilt ein fester Rhythmus.

## Die vier Läufe

| Wann | Was | Wo im Code |
| --- | --- | --- |
| **Sonntag 18:00 Wiener Zeit** | Die ganze Planweite für alle aktiven Kunden | `startWeeklyPlanningSchedule` (planning.ts) |
| **Täglich 03:00 UTC** | Nur Pflege: veraltete Zeilen auffrischen, fehlende Bilder nachtragen | `startDailyPlanningSchedule` → `planUpcomingPosts({ plan: false })` |
| **Montag 03:00 UTC** | Derselbe tägliche Lauf, aber MIT Planung - der Nachfasser zum Sonntagslauf | `viennaWeekday() === 1` |
| **Beim Anmelden** | Unverändert sofort, sieben Tage | `runPreviewJob` → `planCustomerWeek({ bis: erstPlanungEnde() })` |

Dazu **sofortiges Nachplanen**, wenn ein Kunde seinen Rhythmus ändert oder einen Kanal
dazunimmt (`PATCH /api/me` in router.ts). Ohne das bliebe die neue Lücke bis zum nächsten
Sonntag offen: wer am Mittwoch LinkedIn dazunimmt, sähe bis dahin keinen LinkedIn-Beitrag.
Ein abgeschalteter Kanal löst nichts aus - `planCustomerWeek` füllt ausschließlich leere Tage.

## Die Planweite: zwei Kalenderwochen

`planWindowEnd()` liefert das Ende der **nächsten** Kalenderwoche (Sonntag). Damit reicht die
Vorschau immer 8 bis 14 Tage weit:

| Tag | Planweite reicht bis | Tage |
| --- | --- | --- |
| Sonntag nach dem Lauf | Sonntag in zwei Wochen | 14 |
| Mittwoch | derselbe Sonntag | 11 |
| Freitag | derselbe Sonntag | 9 |
| Samstag | derselbe Sonntag | 8 |

Eine reine Ein-Wochen-Planung wäre einfacher gewesen, hätte aber genau das kaputtgemacht, was
der Kunde sieht: ohne tägliches Nachwachsen schrumpft sie im Lauf der Woche von sieben Tagen auf
einen, und am Freitag steht fast nichts mehr da.

Zwei Wochen kosten **nicht mehr**: im geregelten Betrieb legt jeder Sonntagslauf genau eine neue
Woche an, die andere steht schon (`getPlannedPostByChannelDate` überspringt sie). Nur der erste
Lauf nach der Umstellung schreibt einmalig doppelt.

Erwünschte Nebenwirkung: **ein ausgefallener Sonntagslauf ist für den Kunden unsichtbar.** Die
kommende Woche wurde eine Woche vorher geplant. Der Montags-Nachfasser ist Reserve, nicht Rettung.

## Was mitwandern muss, wenn jemand die Planweite ändert

1. **`PLANNED_POST_MAX_AGE_DAYS`** (planning.ts, jetzt 21). Der Wert muss deutlich über der
   Planweite liegen. Liegt er darunter, hält die nächtliche Auffrischung jeden frisch geplanten
   Beitrag für veraltet und schreibt ihn Nacht für Nacht neu - Kosten für jeden Kunden jede
   Nacht, und der Kunde findet jeden Morgen anderen Text vor.
2. **Die Wiederholungssperre** in `planCustomerWeek` (`vergeben`) liest die schon vergebenen
   Überschriften über die GANZE Planweite. Über sieben Tage gelesen, kennt Woche 2 die
   Überschriften aus Woche 1 nicht und wiederholt sie.
3. **`previewWindow()`** in start-routes.ts hängt an derselben Funktion - das Panel zeigt
   deshalb automatisch genau die Planweite. Kein zweiter Wert.

## Was der Kunde sieht

Das Dashboard listet die Tage, an denen etwas geplant ist - ohne Änderung an der Oberfläche
reicht die Woche jetzt weiter. Das Freigabefenster darüber (`freigabenHtml` in start.js) zeigt
oben die fälligen Beiträge aus der Warteschlange und darunter die geplanten mit Datum, beide
freigebbar; ist nichts offen, steht dort eine Zeile.

Die Routine bei claude.ai merkt von alldem nichts: sie liest wie bisher über `get_planned_post`,
ob für heute eine Zeile existiert.
