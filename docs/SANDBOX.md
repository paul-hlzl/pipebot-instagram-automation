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

## Frontend ausliefern (seit 15.09.2026)

Die Produktion serviert das Panel-Frontend NICHT mehr aus der Arbeitskopie, sondern aus einem
eigenen Verzeichnis. Vorher zeigte `PANEL_PUBLIC_DIR` auf `/root/mcp-live/public/panel` - eine
gespeicherte `panel.js` war damit in derselben Sekunde live, ohne Neustart, ohne Sandbox-Stufe
und ohne Rücksicht auf das Routine-Fenster. Für die Server-Seite galt "erst Sandbox, dann
Produktion", fürs Frontend faktisch nicht.

| Umgebung | serviert aus | Prozess |
|---|---|---|
| Sandbox | `/root/panel-work` | `instagram-mcp-staging` (Port 3100) |
| Produktion | `/root/panel-live` | `instagram-mcp` (Port 3000) |

Gefüllt werden beide nur über:

```
node scripts/deploy-panel.mjs sandbox
node scripts/deploy-panel.mjs produktion
node scripts/deploy-panel.mjs produktion --pruefen   # zeigt nur, was sich ändern würde
```

Das Skript listet vor dem Kopieren jede neue und geänderte Datei, meldet verwaiste Dateien im
Ziel (löscht sie aber nie von selbst) und verweigert die Auslieferung nach Produktion im
Routine-Fenster :38-:48. Bewusst ohne Watcher und ohne Hook: Ausliefern ist eine Entscheidung.

Ein Neustart ist nur nötig, wenn sich auch die Server-Seite geändert hat - statische Dateien
liest der Prozess bei der nächsten Anfrage.

Die Produktions-Konfiguration liegt in `/root/produktion.ecosystem.json` (Rechte 600), die der
Sandbox in `/root/staging.ecosystem.json`.

## Verbindliche Selbstprüfung vor "erledigt"

Nichts gilt als erledigt, was nicht **in der ausgelieferten Fassung im echten Browser**
gegengeprüft wurde - Desktop **und** Handy-Breite (360-390px), an der Stelle, an der der Kunde
es sieht. Nicht per API, nicht aus dem Quelltext geschlossen, nicht in der Arbeitskopie.

Grund: mehrere Fehler in diesem Projekt waren im Code "richtig" und trotzdem kaputt - ein
Selektor zeigte ins Leere (`.dictate-wrap` gegen `.with-dictate`), eine Klasse hatte gar kein CSS
(`.is-filtered`, die ganze Verbinden-Seite), eine Option war beim Dateiumbau untergegangen
(Video-Diashow, Bewertungs-Freigaben). Keiner dieser Fälle fällt auf, solange man nur den
Quelltext liest oder die API abfragt.

Dazu gehört ebenso:

- **Systematisch suchen, nicht die gemeldete Stelle reparieren.** Wird ein Muster gemeldet
  (unklare Anzeige, zu enge Abstände, fehlende Option), erst alle Fundstellen auflisten, dann
  einen gemeinsamen Baustein bauen - keine Reparatur Seite für Seite.
- **Abstände bringt jedes Element selbst mit**, nie das Nachbar-Element. Für Reihen
  auswählbarer Kacheln gilt `--gap-kacheln` aus panel.css; wer eine neue Reihe baut, nimmt
  diesen Wert statt eines frisch ausgedachten.
- **Eine Einstellung, eine Umsetzung.** Kommt dieselbe Einstellung an zwei Orten vor
  (Onboarding und Einstellungen), teilen sich beide eine Funktion - siehe `gradientFieldsHtml`.
- `npm run audit:panel` und `npm run test:panel` laufen vor jedem Ausliefern.
