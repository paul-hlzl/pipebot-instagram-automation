# Panel-Adresse (Stand 15.09.2026, alte Adresse abgeschaltet)

| Adresse | Was passiert |
|---|---|
| `https://app.pipeflow.at` | **die** Panel-Adresse, Panel liegt auf der Wurzel |
| `https://mcp.pipebot.at/panel…` | 301 auf `app.pipeflow.at`, Pfad und Query bleiben erhalten |
| `https://mcp.pipebot.at/mcp` | unverändert – MCP-Server für Claude-Routine und Connector |
| `https://mcp.pipebot.at/webhooks/instagram` | unverändert – Instagram-Webhook |
| `https://mcp.pipebot.at/panel/sandbox/` | unverändert – interne Sandbox (Port 3100) |

Beide Panel-Adressen zeigten auf **denselben Prozess** (`instagram-mcp`, Port 3000) und dieselbe
Datenbank. Die Abschaltung war deshalb reine Wegbeschreibung, kein Datenumzug.

## Wie der Prozess die Adresse unterscheidet

`PANEL_APP_HOSTS` (Standard `app.pipeflow.at`) listet die Hosts, unter denen das Panel auf der
Wurzel liegt. Daraus leitet `src/panel/router.ts` **pro Anfrage** ab:

- den Mount (`""` statt `/panel`),
- den Cookie-Pfad (`/` statt `/panel`) – auch für das Admin-Cookie,
- die Basis-URL für Links in E-Mails und für erzeugte Zugangslinks,
- die **OAuth-`redirect_uri`**.

Vorher stand das alles in einer globalen Konstante. Genau dieser Fehler hatte schon einmal die
Sandbox-Admin-Seite unbenutzbar gemacht (Cookie fest auf `/panel/admin`).

## Umleitung im Detail

In `/etc/nginx/sites-available/mcp.pipebot.at`:

```nginx
location = /panel { return 301 https://app.pipeflow.at/; }
location /panel/  { rewrite ^/panel/(.*)$ https://app.pipeflow.at/$1 permanent; }
```

Bewusst 301 statt 404: alte Lesezeichen, alte Zugangslinks aus E-Mails und die Datenschutz-URL
landen dadurch weiterhin am Ziel. `location /panel/sandbox/` steht davor und ist spezifischer,
die Sandbox bleibt also erreichbar.

**Nebenwirkung, die man kennen muss:** auch `/panel/api/…` wird umgeleitet. Für Browser ist das
folgenlos, weil das Panel seine Aufrufe immer relativ zur geladenen Adresse macht. Ein externes
Skript, das noch fest auf `mcp.pipebot.at/panel/api/…` zeigt und **POST** schickt, würde beim
Folgen der Umleitung auf GET wechseln. Uns ist kein solches Skript bekannt; der MCP-Server und
der Webhook liegen nicht unter `/panel`.

## Sitzungen

Cookies gelten je Domain. Wer noch unter der alten Adresse angemeldet war, ist unter der neuen
**nicht** automatisch angemeldet – technisch nicht umgehbar. Der Weg hinein ist der persönliche
Zugangslink; alte Links funktionieren über die Umleitung weiter und landen auf der neuen Adresse.

## Sandbox

Die Sandbox behält genau eine Adresse: `https://mcp.pipebot.at/panel/sandbox/`.
`app.pipeflow.at/sandbox/` leitet mit 301 dorthin. Grund: unter `app.pipeflow.at` liegt das Panel
auf der Wurzel, das Sandbox-Cookie wäre damit ebenfalls `Path=/` und würde an die Produktion
mitgeschickt. Der Start des Sandbox-Prozesses steht in `/root/staging.ecosystem.json` (600).

## Erledigt

- [x] DNS und Zertifikat für `app.pipeflow.at` (Let's Encrypt, gültig bis 14.12.2026, `certbot.timer`)
- [x] `PANEL_BASE_URL` in `.env` auf `https://app.pipeflow.at`, `PANEL_MOUNT_PATH` leer
- [x] Datenschutz: `https://app.pipeflow.at/datenschutz` ist kanonisch, alte URL leitet dorthin
- [x] Instagram-Webhook geprüft – liegt nicht unter `/panel`, bleibt auf der alten Adresse
- [x] Alte Zugangslinks: laufen über die 301 weiter, kein Versand nötig
- [x] Kundenzugang nach der Umstellung live gegengeprüft (Zugangslink → Sitzung → Freigaben)
- [x] `pending_approvals` und `planned_posts` unverändert; keine Tabelle enthält die alte Domain
- [x] Sandbox-Adresse entschieden (bleibt unter `mcp.pipebot.at/panel/sandbox`)

## Offen, nur von Paul zu erledigen

- [ ] Redirect-URIs bei Meta und LinkedIn für `https://app.pipeflow.at/callback/…` eintragen und
      einmal echt testen. Die alten Einträge **bleiben stehen** – sie stören nicht und sind der
      Rückweg, falls etwas klemmt.
- [ ] Datenschutz-URL bei Meta, LinkedIn und Google auf `https://app.pipeflow.at/datenschutz`
