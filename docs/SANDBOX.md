# Dauerhafte Staging-Testadresse (/panel/sandbox)

Eingerichtet 2026-09-12, Auftrag "Sandbox" (im Zuge des K3b-Duplikat-Bugs: der Bug entstand
u.a. dadurch, dass waehrend aktiver Entwicklung direkt am laufenden Produktions-Server
gebaut/neu gestartet wurde und dabei echte Kunden-Routine-Laeufe mitten drin abbrachen - siehe
Bericht vom selben Tag). Ab jetzt gilt: neue Aenderungen zuerst hier testen, Produktion erst
neu bauen/starten, wenn eine Aenderung auf dieser Adresse bereits fertig UND getestet ist.

## Erreichbar unter

**https://mcp.pipebot.at/panel/sandbox/** - oeffentlich, ohne eigene Subdomain/Zertifikat (Vorgabe:
die echte Kunden-URL `/panel` bleibt unveraendert). Zeigt IMMER den aktuellen Stand des
Staging-Prozesses, nicht Produktion.

Auffaelliger gelber Banner oben ("TESTVERSION") macht das unmissverstaendlich.

## Wie es technisch zusammenhaengt

- **nginx** (`/etc/nginx/sites-available/mcp.pipebot.at`): eigener `location /panel/sandbox/`
  Block, schneidet `/sandbox` ab und reicht an `http://127.0.0.1:3100` weiter (`rewrite ...
  break` + `proxy_pass`). Ein `location = /panel/sandbox` (ohne Slash) redirected auf die
  Slash-Variante, sonst würde die bare URL versehentlich bei Produktion landen.
- **pm2-Prozess** `instagram-mcp-staging`, Port 3100, **derselbe** `dist/index.js` wie
  Produktion (identischer Code - das ist Absicht, kein separates Deployment). Persistiert via
  `pm2 save`, ueberlebt also Reboots. NICHT wieder loeschen wie in frueheren Sessions
  (docs/PANEL_V3_REPORT.md, Schritt 6) - diesmal ist er dauerhaft gedacht.
- **Eigene DB**: `data/panel-staging.db` - komplett getrennt von `data/panel.db`, keine echten
  Kundendaten, nur Testkunden (siehe unten).
- **Eigene `.env`-Ueberschreibungen** (per pm2-Startbefehl gesetzt, NICHT in der gemeinsamen
  `.env`-Datei - die App laedt `.env` immer vom Paket-Root, dotenv ueberschreibt aber keine
  bereits gesetzten process.env-Werte, siehe `src/config.ts`):
  - `PORT=3100`
  - `PANEL_DB_PATH=/root/mcp-server/data/panel-staging.db`
  - `PANEL_BASE_URL=https://mcp.pipebot.at` + `PANEL_MOUNT_PATH=/panel/sandbox` (NICHT als ein
    zusammengesetzter Wert in PANEL_BASE_URL - server-generierte Links/Redirects/Cookie-Path
    verwenden `baseUrl() + MOUNT` getrennt, siehe router.ts)
  - `PANEL_SANDBOX=true` - steuert nur den Frontend-Banner + Demo-Hinweistext, sonst nichts
  - `PANEL_MAIL_DRY_RUN=1` - keine echten E-Mails, nur Log-Eintrag
  - `PANEL_ENCRYPTION_KEY` - eigener, frisch generierter Schluessel (nicht der Produktions-Key)
  - `MCP_AUTH_TOKEN` - eigener, frisch generierter Token
  - `IG_APP_ID` / `IG_APP_SECRET` / `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` /
    `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` - bewusst leer gesetzt, damit
    `isConfigured()` fuer beide Provider `false` liefert: kein echter OAuth-Flow moeglich,
    selbst wenn man es versuchen wollte. Die "Verbinden"-Buttons zeigen stattdessen (getrieben
    vom `sandbox`-Flag aus `/api/providers`) einen Demo-Hinweistext.
  - `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` leer - CAPTCHA aus, leichteres Testen
  - `ROUTINE_TRIGGER_URL` / `ROUTINE_TRIGGER_TOKEN` leer - kein Sofort-Trigger noetig
  - Bewusst NICHT gesetzt (erbt aus der echten `.env`): `ANTHROPIC_API_KEY`,
    `ANTHROPIC_MODEL`, `FAL_API_KEY`, `MEDIA_STORAGE_*` - fuer echte KI-/Bild-Tests im Panel.
- **Frontend** (`public/panel/index.html`, identische Datei fuer Produktion und Sandbox):
  `CONFIG.mount` wird jetzt aus `location.pathname` abgeleitet (`/panel/sandbox` erkannt an
  seinem eigenen Pfad-Praefix) statt fest "/panel" zu sein - sonst waeren alle Fetch-Aufrufe der
  Sandbox-Seite versehentlich an die echte Produktion gegangen. Fuer Produktion selbst aendert
  sich dadurch nichts (ihr Pfad startet nie mit "/panel/sandbox").

## Vorhandene Test-Kunden

Zwei Test-Kunden existieren bereits in der Staging-DB (per echtem Signup-Flow angelegt, keine
Hand-editierten DB-Zeilen):

- **Testfirma Eins** (`approvalMode: false`, taeglich/09:00) -
  `https://mcp.pipebot.at/panel/sandbox/login?key=<SANDBOX_KEY_A>`
- **Testfirma Zwei (Freigabe-Modus)** (`approvalMode: true`, taeglich/10:00) -
  `https://mcp.pipebot.at/panel/sandbox/login?key=<SANDBOX_KEY_B>`

Weitere Test-Kunden: einfach ueber `https://mcp.pipebot.at/panel/sandbox/` normal signupen -
CAPTCHA ist aus, es passiert nichts Echtes (keine E-Mail, keine echte Verbindung moeglich).

## Admin-Oberflaeche der Sandbox

`https://mcp.pipebot.at/panel/sandbox/admin` - gleiches Passwort wie Produktion (der Bequemlichkeit
halber uebernommen, da ohnehin nur Paul Zugriff hat).

## Was NICHT ueber die Sandbox getestet werden kann

Echte Instagram-/LinkedIn-Verbindungen und echtes Veroeffentlichen (Provider absichtlich
deaktiviert). Fuer ein Feature, das sich wirklich nur mit einer echten Verbindung sinnvoll
testen laesst: kurze Ruecksprache statt stillschweigend Produktions-Zugangsdaten in die
Sandbox-Umgebung zu kopieren.

## Deploy-Reihenfolge ab jetzt (siehe auch Chat-Bericht vom 2026-09-12)

1. Neue Aenderung auf einem Feature-Branch entwickeln.
2. `npm run build`, dann `pm2 restart instagram-mcp-staging` (Port 3100) - NICHT Produktion.
3. Unter `https://mcp.pipebot.at/panel/sandbox/` selbst durchklicken/verifizieren.
4. Erst wenn das fertig UND getestet ist: `pm2 restart instagram-mcp` (Produktion) - moeglichst
   ausserhalb des stuendlichen Routine-Zeitfensters (`:43` jede Stunde, siehe bestehende Regel).
5. Faellt ein Produktions-Deploy doch mitten in ein Routine-Zeitfenster: im Bericht ausdruecklich
   vermerken (moeglicher abgebrochener Lauf in diesem Fenster).

## Zugangslinks (nicht im Repo)

Die beiden Testkonto-Links stehen seit 15.09.2026 **nicht mehr hier** - dieses Repository ist
oeffentlich. Sie liegen auf dem Server in `/root/sandbox-keys.env` (Rechte 600) und werden fuer
Testlaeufe so geladen:

```
set -a && . /root/sandbox-keys.env && set +a
node scripts/redesign-func-test.mjs
```

Die zuvor hier dokumentierten Schluessel wurden dabei rotiert und sind ungueltig. Ein neuer Link
entsteht im Panel unter Einstellungen -> Konto -> "Persoenlichen Link erzeugen" (entwertet den alten).
