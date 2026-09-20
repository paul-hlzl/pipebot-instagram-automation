# Datenschutzerklärung – offene Punkte

Stand 20.09.2026. Diese Liste stand bis heute als **unsichtbarer HTML-Kommentar** in
`assets/datenschutz.html` und wurde dort auf Wunsch entfernt – der ausgelieferten Seite sah man
nicht an, dass sie ein Entwurf ist. Der Inhalt ist hier erhalten, damit nichts verlorengeht.

## Weiterhin gültig

> **ENTWURF IN FERTIGER FORM – VOR ENDGÜLTIGER VERWENDUNG ANWALTLICH PRÜFEN LASSEN.**
>
> Erstellt am 15.09.2026 aus `docs/DATENSCHUTZ_ENTWURF.md` und einer Code-Inventur des
> tatsächlichen Systemverhaltens. Eine fachliche Arbeitsgrundlage, KEINE Rechtsberatung.

Vor der endgültigen Verwendung:

1. Anwaltliche bzw. WKO-Prüfung des gesamten Textes.
2. Die sechs Stellen unten ausfüllen.
3. Nach der OG-Gründung: Abschnitt 1 (Verantwortlicher) auf die OG umstellen – Firmenname,
   Rechtsform, Firmenbuchnummer, Gesellschafter, Anschrift.

## Die sechs offenen Stellen

Fünf stehen **sichtbar** im Text der Seite, die sechste stand im entfernten Kommentar.

| # | Abschnitt | Was fehlt |
| --- | --- | --- |
| 1 | 1. Verantwortlicher | Vollständige Firmenanschrift |
| 2 | 1. Verantwortlicher | Gewerbewortlaut / GISA-Zahl, falls anzugeben |
| 3 | 4. Eingesetzte Dienstleister | Für jeden Anbieter den tatsächlich vorliegenden Auftragsverarbeitungsvertrag und die jeweilige Drittland-Grundlage konkret benennen |
| 4 | 6. Speicherdauer | Aufbewahrungsdauer der Server-/Webserver-Logs (gemessen: nginx 14 Tage, pm2 7 Tage) |
| 5 | 6. Speicherdauer | Frist für Kundendaten nach Vertragsende festlegen (z. B. 24 Monate) |
| 6 | 1. Verantwortlicher | Umstellung auf die OG nach der Gründung |

## Inhaltliche Lücken aus der Bestandsaufnahme vom 20.09.2026

Nicht als Platzhalter markiert, aber gemessen am tatsächlichen Verhalten fehlend:

- **Microsoft** ist als Anmeldeanbieter nicht genannt (Zugangsdaten sind auf Produktion gesetzt).
- **Hostinger** ist nur als DNS-Anbieter genannt, verarbeitet aber auch den gesamten Mailversand
  über `smtp.hostinger.com`.
- **Daten dritter Personen** kommen nicht vor: Instagram-Kommentare samt Benutzername und
  Google-Rezensionen samt Klarnamen werden gespeichert und zur Antworterzeugung an Anthropic in
  die USA übermittelt. Die Erklärung spricht durchgehend nur den Kunden an.
- **Bilder im Objektspeicher** wurden bei einer Kontolöschung bisher nicht entfernt. Seit dem
  20.09.2026 werden sie mitgelöscht – der Text sollte das abbilden.
