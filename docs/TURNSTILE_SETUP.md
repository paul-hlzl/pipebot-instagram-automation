# Cloudflare Turnstile einrichten (echte Keys)

Das CAPTCHA-Feature ist im Code fertig und in der Sandbox mit Cloudflares offiziellen
öffentlichen Test-Keys komplett end-to-end getestet (siehe
`docs/SECURITY_UX_REVIEW_REPORT.md`, Abschnitt CAPTCHA). Es fehlen nur noch die ECHTEN Keys -
die kann nur Paul selbst anlegen (eigener Cloudflare-Account, eigene Identität). Diese Anleitung
ist bewusst kurz und Schritt für Schritt.

## 1. Kostenlosen Cloudflare-Account anlegen

Falls noch nicht vorhanden: https://dash.cloudflare.com/sign-up - nur E-Mail-Adresse und Passwort
nötig, keine Zahlungsdaten, keine eigene Domain bei Cloudflare nötig. Turnstile läuft laut
Cloudflare ausdrücklich unabhängig davon, ob die eigene Website überhaupt über Cloudflare läuft.

## 2. Neue Turnstile-"Site" anlegen

1. Einloggen, dann links im Menü **Turnstile** wählen (oder direkt
   https://dash.cloudflare.com/?to=/:account/turnstile öffnen).
2. **Add site** klicken.
3. **Site name**: frei wählbar, z. B. "Pipeflow Panel Signup" - nur zur eigenen Orientierung,
   hat keine technische Wirkung.
4. **Domains**: beide folgenden Hostnamen eintragen (mehrere Zeilen/Einträge möglich):
   - `mcp.pipebot.at`
   - `app.pipeflow.at` (falls diese Domain zum Zeitpunkt der Einrichtung noch nicht live/DNS-
     verbunden ist: trotzdem schon eintragen, das schadet nicht - Cloudflare verlangt nur, dass
     eine spätere echte Anfrage von einem der eingetragenen Hostnamen kommt, nicht dass die Domain
     beim Anlegen bereits erreichbar ist).
5. **Widget Mode**: "Managed" (Cloudflares empfohlener Standard - zeigt meist nur eine
   unsichtbare Prüfung, gelegentlich eine kurze interaktive Challenge). Die anderen Modi
   ("Non-Interactive", "Invisible") funktionieren mit dem bestehenden Code auch, "Managed" ist
   aber die von Cloudflare empfohlene Wahl für ein normales Signup-Formular.
6. **Create**.

## 3. Site-Key und Secret-Key finden

Direkt nach dem Anlegen zeigt Cloudflare beide Werte an:
- **Site Key** (beginnt meist mit `0x4...`) - das ist der öffentliche Wert, landet im Browser.
- **Secret Key** - das ist der geheime Wert, bleibt ausschließlich serverseitig.

Beide auch jederzeit später wieder auffindbar: Turnstile-Übersicht → die angelegte Site anklicken.

## 4. In die `.env`-Datei eintragen

Datei: `/root/mcp-server/.env` (die echte Produktions-`.env`, NICHT `.env.example`).

Exakte Variablennamen (bereits als leere Platzhalter-Kommentarzeile in `.env.example`
dokumentiert, hier nur ausfüllen bzw. neu ergänzen):

```
TURNSTILE_SITE_KEY=<der Site Key aus Schritt 3>
TURNSTILE_SECRET_KEY=<der Secret Key aus Schritt 3>
```

Wichtig:
- Nur diese zwei Zeilen ergänzen/ausfüllen - keine anderen bestehenden Zeilen in der `.env`
  verändern oder löschen.
- Keine Anführungszeichen um die Werte, keine Leerzeichen um das `=`.

## 5. Neu starten - fertig, kein Code nötig

```
cd /root/mcp-server
pm2 restart instagram-mcp
```

Das war's. Der Server liest `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` bei jeder Anfrage direkt
aus der Umgebung (`src/panel/turnstile.ts`) - keine Code-Änderung, kein Rebuild nötig, nur der
Neustart, damit der Prozess die neue `.env` einliest. Bitte außerhalb des stündlichen
Routine-Zeitfensters neu starten (nicht um :43).

Bereits vorher: solange `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` leer sind, bleibt das Feature
komplett unsichtbar deaktiviert (kein Fehler, kein leeres Widget) - der aktuelle Zustand ist also
sicher, es eilt nicht, aber es ist ein offener Punkt (echte Signups sind bis dahin ohne
CAPTCHA-Schutz).

## Wie man später prüft, dass es wirklich läuft

1. https://mcp.pipebot.at/panel/ öffnen, Signup-Formular bis Seite 2 ("Ihr Stil") durchklicken -
   dort sollte jetzt sichtbar ein Cloudflare-Widget erscheinen (Häkchen-Symbol, "Verifying you are
   human..." oder ähnlich).
2. Ein Cloudflare-Dashboard-Blick unter Turnstile → die Site → "Analytics" zeigt nach den ersten
   echten Aufrufen Zahlen (Anzahl Verifizierungen, Erfolgsrate).

## Falls die Sandbox nochmal mit Test-Keys durchgespielt werden soll

Cloudflares offizielle, immer gültige Test-Keys (funktionieren auf jeder Domain, auch localhost,
ohne echten Account) - siehe https://developers.cloudflare.com/turnstile/troubleshooting/testing/:

| Zweck | Site Key | Secret Key |
|---|---|---|
| Immer erfolgreich | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| Immer abgelehnt | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |
| Erzwingt interaktive Challenge | `3x00000000000000000000FF` | (mit "immer erfolgreich"-Secret kombinierbar) |

Diese NIEMALS in Produktion eintragen (die Sitekeys sind öffentlich bekannt und lassen jeden
Bot durch) - nur zum Testen in der Sandbox, wie in dieser Sitzung geschehen.
