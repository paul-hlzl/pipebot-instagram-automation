# Panel unter zwei Adressen (Stand 15.09.2026)

| Adresse | Panel liegt unter | Zweck |
|---|---|---|
| `https://mcp.pipebot.at/panel` | `/panel` | historisch, bleibt bis auf Weiteres |
| `https://app.pipeflow.at` | `/` (Wurzel) | neu |
| `https://mcp.pipebot.at/mcp` | unverändert | MCP-Server für Claude-Routine und Connector |

Beide Panel-Adressen zeigen auf **denselben Prozess** (`instagram-mcp`, Port 3000) und **dieselbe
Datenbank**. Es gibt keinen Stichtag und kein Umschalten.

## Wie der Prozess die Adresse unterscheidet

`PANEL_APP_HOSTS` (Standard `app.pipeflow.at`) listet die Hosts, unter denen das Panel auf der
Wurzel liegt. Daraus leitet `src/panel/router.ts` **pro Anfrage** ab:

- den Mount (`""` statt `/panel`),
- den Cookie-Pfad (`/` statt `/panel`) – auch für das Admin-Cookie,
- die Basis-URL für Links in E-Mails und für erzeugte Zugangslinks,
- die **OAuth-`redirect_uri`** – deshalb müssen beide Varianten bei Meta und LinkedIn hinterlegt sein.

Vorher stand das alles in einer globalen Konstante. Genau dieser Fehler hatte schon einmal die
Sandbox-Admin-Seite unbenutzbar gemacht (Cookie fest auf `/panel/admin`).

## Sitzungen

Cookies gelten je Domain. Wer unter der alten Adresse angemeldet ist, ist unter der neuen **nicht**
automatisch angemeldet – das ist technisch nicht umgehbar. Der Weg hinein ist derselbe wie immer:
der persönliche Zugangslink, der unter **beiden** Adressen funktioniert. Ein im Panel neu erzeugter
Link zeigt jeweils auf die Adresse, unter der er erzeugt wurde.

## Was noch manuell fehlt

1. **DNS:** A-Record `app.pipeflow.at` → `2.29.38.44`
2. **Zertifikat:** danach `certbot --nginx -d app.pipeflow.at` (ersetzt das Übergangszertifikat,
   Erneuerung läuft dann automatisch wie bei `mcp.pipebot.at`)
3. **Redirect-URIs** bei Meta und LinkedIn zusätzlich eintragen (siehe Sitzungsbericht)

## Bevor `mcp.pipebot.at/panel` abgeschaltet werden darf

- [ ] DNS und Zertifikat für `app.pipeflow.at` stehen
- [ ] Redirect-URIs bei Meta und LinkedIn für die neue Adresse eingetragen **und** einmal echt getestet
- [ ] Alle bestehenden Kunden haben sich mindestens einmal unter der neuen Adresse angemeldet
- [ ] Datenschutz-URL bei Meta, LinkedIn und Google zeigt auf die dauerhafte Adresse
- [ ] Instagram-Webhook-Callback geprüft (siehe Bericht: bleibt auf der alten Adresse)
- [ ] Zugangslinks in alten E-Mails sind abgelaufen oder ersetzt
- [ ] `PANEL_BASE_URL` in `.env` auf die neue Adresse umgestellt
- [ ] Sandbox-Adresse entschieden (bleibt unter `mcp.pipebot.at/panel/sandbox` oder zieht mit)
