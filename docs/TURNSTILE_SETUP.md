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

## Stand 15.09.2026: scharf geschaltet

Echte Keys liegen in `/root/mcp-server/.env` (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`),
Produktion wurde um 18:06 neu gestartet. Widget: Hostname `app.pipeflow.at`, Modus "Managed".

**Nachgewiesen:**
- Das Secret ist bei Cloudflare gültig: eine Anmeldung mit erfundenem Token wird mit
  `invalid-input-response` abgelehnt (bei falschem Secret käme `invalid-input-secret`).
- Der Hostname ist korrekt hinterlegt: derselbe Site Key liefert auf `mcp.pipebot.at` sofort
  Fehlercode **110200** ("invalid domain"), auf `app.pipeflow.at` dagegen keinerlei Fehler.
- Anmeldung ohne Token und mit erfundenem Token werden serverseitig mit 400 abgewiesen.
- Die CSP erlaubt `challenges.cloudflare.com` in `script-src` und `frame-src` - keine
  CSP-Verstöße im Browser, keine blockierten Cloudflare-Anfragen.

**Nicht nachweisbar von hier aus:** dass ein Mensch die Prüfung tatsächlich abschließt. Im
"Managed"-Modus verweigert Cloudflare einem automatisierten Browser die Challenge - das Widget
bleibt still leer, ohne Fehlercode. Genau dafür ist Turnstile da. Das ist der einzige Schritt,
den Paul einmal selbst im eigenen Browser bestätigen muss (siehe unten).

**Wieder abschalten, falls das Widget bei echten Besuchern nicht erscheint:** in
`/root/mcp-server/.env` die beiden `TURNSTILE_*`-Zeilen mit `#` auskommentieren und
`pm2 restart instagram-mcp --update-env` - danach ist das Feature wie vorher unsichtbar aus, und
Anmeldungen laufen ohne CAPTCHA weiter.

### Hostname-Prüfung serverseitig

Seit 15.09.2026 prüft `verifyTurnstileToken` zusätzlich den von Cloudflare zurückgemeldeten
`hostname` gegen den Host, unter dem das Formular abgeschickt wurde (plus die Liste in
`TURNSTILE_EXPECTED_HOSTNAMES`, Standard `app.pipeflow.at`). Ein anderswo gelöster Token wird
damit auch dann abgelehnt, wenn später weitere Domains ins selbe Widget eingetragen werden.

### Sandbox

Die Sandbox liegt unter `https://mcp.pipebot.at/panel/sandbox/` (nicht unter
`app.pipeflow.at/sandbox` - das leitet seit dem 15.09.2026 nur noch dorthin um, siehe
`docs/ZWEITE_ADRESSE.md`). Sie braucht **keinen eigenen Eintrag bei Cloudflare**: dort laufen
Cloudflares öffentliche Testschlüssel ("always passes", dazu
`TURNSTILE_EXPECTED_HOSTNAMES=example.com`, weil Testschlüssel immer `example.com` melden). Der
echte Site Key würde dort ohnehin mit Fehlercode 110200 scheitern - nachgemessen.

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
