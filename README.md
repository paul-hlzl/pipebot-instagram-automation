# Instagram MCP Server

Ein MCP-Server (Model Context Protocol), der Claude erlaubt, Instagram-Feed-Posts eigenständig zu erstellen und zu veröffentlichen — inklusive KI-generierter Bilder. Läuft als HTTP-Server und kann sowohl lokal von Claude Code als auch als Custom Connector von claude.ai (inkl. Cloud-Routinen) angesprochen werden.

## 1. Projektübersicht

Das Projekt ist ein MCP-Server, der Claude neun Werkzeuge (Tools) für Instagram-Marketing an die Hand gibt: Bilder per KI generieren (fal.ai, Modell "Flux Schnell"), eigene Bilder hochladen, Captions verfassen, beides gemeinsam als Feed-Post ODER als Instagram Story auf einem Instagram Business/Creator-Konto veröffentlichen, das Publishing-Kontingent abfragen und den Access Token erneuern — über die offizielle Instagram Graph API. Claude steuert den kompletten Ablauf: Themenwahl, Bildprompt, Captiontext und den eigentlichen Publish-Call. Das macht automatisiertes, KI-gestütztes Instagram-Posting per Chat oder per zeitgesteuerter Claude-Routine möglich, ohne dass ein Mensch die einzelnen API-Schritte manuell ausführen muss.

# 2. Architektur

```
Claude (claude.ai Routine oder manueller Chat)
        │  MCP über HTTPS (Bearer-Token)
        ▼
Nginx Reverse Proxy (mcp.pipebot.at, Let's Encrypt/TLS)
        │  proxy_pass → 127.0.0.1:3000
        ▼
MCP-Server (dieses Projekt, Node.js/Express, von pm2 am Leben gehalten)
        │
        ├──► fal.ai API            (Bildgenerierung, Modell "flux/schnell")
        │        │
        │        ▼
        ├──► Cloudflare R2         (optionales Bild-Hosting bei Base64-Upload)
        │
        └──► Instagram Graph API   (Media-Container anlegen, pollen, veröffentlichen)
```

**Datenfluss beim typischen Ablauf (`generate_and_publish_post`):**
1. Claude leitet aus einem Thema eine kurze (2-4 Wörter) `headline` ab sowie eine Caption.
2. Der MCP-Server ruft fal.ai (Flux Schnell) mit einem festen, komplett textfreien Hintergrund-Prompt auf (dunkler Navy-Ton, subtile Textur — keine Erwähnung von Text/Headline, siehe `styleguide.md`) → erhält eine Bild-URL. Anschließend werden Headline und "Pipeline"-Wasserzeichen per Code (`src/watermark.ts`, sharp/SVG) exakt aufs Bild gerendert — das Bildmodell muss selbst nie Text zeichnen.
3. Der Server legt bei Instagram einen Media-Container mit dieser Bild-URL und der Caption an, pollt den Status bis `FINISHED` und veröffentlicht den Post.
4. Das Ergebnis (Post-ID, Bild-URL, tatsächlich genutzter Prompt) geht zurück an Claude.

Bei `upload_and_publish_post` mit `image_base64` wird das Bild stattdessen zuerst nach Cloudflare R2 hochgeladen (Instagram braucht eine öffentlich erreichbare Bild-URL), danach läuft derselbe Publish-Ablauf.

**Zusätzlich seit 2026-09-05: Instagram Stories.** Derselbe Ablauf existiert im 9:16-Hochformat für Stories (`generate_story_image` / `publish_generated_story` / `generate_and_publish_story`, siehe Abschnitt 6) — eigener Media-Container-Typ (`media_type=STORIES`) über dieselbe Graph-API-Endpoint, ohne Caption (von der API für Stories nicht unterstützt) und im selben rollierenden 100-Posts/24h-Kontingent wie Feed-Posts. Details zu Format und Positionierung siehe `styleguide.md`, Abschnitt „INSTAGRAM STORIES".

**Hosting-Aufbau:**
- **Server:** Hetzner VPS (Ubuntu/Linux), Node.js
- **Prozess-Persistenz:** [pm2](https://pm2.keymetrics.io/) startet den Server, hält ihn bei Absturz am Leben und fährt ihn nach einem Server-Reboot automatisch wieder hoch (via systemd-Service `pm2-<user>`)
- **Reverse Proxy:** Nginx terminiert TLS und leitet Requests an `127.0.0.1:3000` weiter (inkl. Streaming-Unterstützung für die MCP-Streamable-HTTP-Verbindung)
- **TLS-Zertifikat:** Let's Encrypt via Certbot (`certbot --nginx`), automatische Erneuerung über den `certbot.timer`-systemd-Timer

## 3. Instagram/Meta-Setup

Schritt für Schritt, um den Server an ein eigenes Instagram-Konto anzubinden:

1. **Instagram Business- oder Creator-Konto** anlegen bzw. ein bestehendes privates Konto in den Kontotyp "Business" oder "Creator" umwandeln (Instagram-App → Einstellungen → Konto → Zu professionellem Konto wechseln).
2. **Meta Developer App anlegen** unter [developers.facebook.com](https://developers.facebook.com/) → "App erstellen". Als Use Case **"Messaging und Content auf Instagram verwalten"** auswählen (nicht der alte "Instagram Basic Display"-Flow).
3. **Instagram-Tester-Rolle vergeben:** Im App-Dashboard unter "Instagram" → "API Setup with Instagram Login" (bzw. Rollen/Testers) das eigene Instagram-Konto als Tester hinzufügen und die Einladung im Instagram-Account bestätigen. Für reinen Eigengebrauch reicht das — es ist **kein App Review** durch Meta nötig, solange die App im Development Mode bleibt und nur getestete Konten verwendet werden.
4. **Access Token holen:** Im App-Dashboard unter "Instagram" → "API Setup with Instagram Login" gibt es einen Button **"Generate Token"**. Der so erzeugte Token ist bereits ein **60 Tage gültiger Long-Lived Token** — ein zusätzlicher Exchange-Call (Short-Lived → Long-Lived) ist bei diesem Flow nicht mehr nötig.
5. Token als `IG_ACCESS_TOKEN` in die `.env` eintragen, die zugehörige Instagram-User-ID als `IG_USER_ID` (der Server ermittelt die ID bei Bedarf aber auch selbst über `/me`, siehe `src/instagram.ts`).
6. **Rate Limit beachten:** Die Instagram Graph API begrenzt Content-Publishing aktuell auf **100 Posts pro rollierendem 24-Stunden-Fenster** je Konto (das exakte Kontingent kann je nach Kontostatus abweichen). Das Tool `check_publishing_limit` fragt das aktuelle Kontingent live ab.

## 4. fal.ai-Setup

1. Account auf [fal.ai](https://fal.ai/) anlegen.
2. Unter [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) einen API-Key erzeugen und als `FAL_API_KEY` in die `.env` eintragen.
3. Verwendetes Modell: **`fal-ai/flux/schnell`** — ein sehr schnelles, günstiges Text-zu-Bild-Modell, gut geeignet für Social-Media-Grafiken.
4. **Kosten:** Größenordnung wenige US-Cent pro generiertem Bild (Stand Modell-Release; aktuelle Preise unter [fal.ai/pricing](https://fal.ai/pricing) prüfen, da sich das ändern kann). Guthaben wird unter [fal.ai/dashboard/settings/credits](https://fal.ai/dashboard/settings/credits) aufgeladen.

## 5. Server-Setup

**Voraussetzungen:** Node.js ≥ 18 (siehe `package.json` → `engines`).

```bash
# Abhängigkeiten installieren
npm install

# .env aus der Vorlage anlegen und Werte eintragen (siehe Abschnitt 8)
cp .env.example .env

# TypeScript → JavaScript bauen (Ausgabe landet in dist/)
npm run build

# Testlauf ohne pm2 (nur zum Debuggen)
npm start
```

**Dauerhafter Betrieb mit pm2:**

```bash
npm install -g pm2

npm run build
pm2 start dist/index.js --name instagram-mcp

# Autostart nach Server-Reboot einrichten (einmalig)
pm2 startup
pm2 save
```

Nach Code-Änderungen: `npm run build && pm2 restart instagram-mcp`. Logs: `pm2 logs instagram-mcp`. Status: `pm2 status`.

**Nginx-Reverse-Proxy (Grundzüge):**

Der Server lauscht lokal nur auf `127.0.0.1:3000` (kein direkter öffentlicher Zugriff). Nginx nimmt Requests auf Port 443 an und reicht sie durch:

```nginx
server {
    listen 443 ssl;
    server_name mcp.pipebot.at;

    ssl_certificate     /etc/letsencrypt/live/mcp.pipebot.at/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.pipebot.at/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Streamable HTTP (SSE) braucht langlebige, ungepufferte Verbindungen
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

Ein `server { listen 80; ... return 301 https://...; }`-Block leitet HTTP auf HTTPS um (wird von Certbot automatisch ergänzt, siehe unten).

**Let's Encrypt / Certbot:**

```bash
apt-get install -y nginx certbot python3-certbot-nginx
certbot --nginx -d mcp.pipebot.at
```

Voraussetzung: Ein A-Record der Domain muss bereits auf die öffentliche IP des Servers zeigen, sonst schlägt die HTTP-01-Challenge fehl. Certbot richtet automatisch einen systemd-Timer (`certbot.timer`) ein, der Zertifikate rechtzeitig vor Ablauf erneuert — kein manueller Eingriff nötig.

## Bild-Design-Standards

Verbindliche Vorgabe für alle generierten Post-Bilder (Details und Beispiel-Prompt siehe `styleguide.md` — dort steht der aktuelle Stand, dieser Abschnitt ist nur eine Kurzfassung):

- **Hintergrund:** Dunkles Blau-Schwarz (z.B. `#0a0e1a`), nicht reines Schwarz, mit subtiler Textur — minimalistisch, aber nicht langweilig, bleibt clean & professionell.
- **Text:** Weiße, elegante Serif-Schrift, links/mittig positioniert (nicht zentriert über die volle Breite), als dominantes Element im Bild. **Seit Layout v3 (2026-09-05) komplett per Code gerendert** (`addHeadlineText` in `src/watermark.ts`), nicht mehr vom Bildmodell — das Bild-Generierungs-Tool bekommt nur noch `headline` als reinen Textwert übergeben, keine Layout-Beschreibung mehr nötig.
- **Branding:** "Pipeline" als großes, vertikales Wasserzeichen am rechten Bildrand (90° gedreht, ~15-20% Deckkraft), **automatisch per Code aufgelegt** (`src/watermark.ts`) — nicht Teil des KI-Bildprompts.
- **Keine sonstigen Grafiken:** keine Icons, keine Illustrationen, keine Fotoelemente — nur Typografie auf strukturiertem, dunklem Grund.

## 6. MCP-Tools (Referenz)

Der Server registriert neun Tools (siehe `src/index.ts`): sechs für den Feed, drei für Stories.

### `upload_and_publish_post`
Veröffentlicht einen einzelnen Instagram-Feed-Post. Nimmt entweder eine bereits öffentlich erreichbare Bild-URL oder ein Base64-kodiertes Bild (wird zuerst nach Cloudflare R2 hochgeladen).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `image_url` | string | genau eines von `image_url`/`image_base64` | Öffentlich erreichbare Bild-URL, wird von Instagram direkt abgerufen |
| `image_base64` | string | genau eines von `image_url`/`image_base64` | JPEG/PNG als Base64 (optional als Data-URL), wird nach R2 hochgeladen |
| `caption` | string | ja | Caption, max. 2200 Zeichen |

Beispielaufruf (JSON-RPC-Params):
```json
{
  "image_url": "https://example.com/bild.jpg",
  "caption": "Neuer Post! 🚀 #ki #automatisierung"
}
```

### `generate_post_image`
Generiert ein Bild per fal.ai (Flux Schnell), **ohne** es zu veröffentlichen. Gibt die Bild-URL zum Review zurück, bevor überhaupt gepostet wird — gedacht für den zweistufigen Ablauf `generate_post_image` → visuelle Prüfung → `publish_generated_post` (siehe Empfehlung unten).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `topic` | string | ja | Ursprüngliches Thema, nur fürs Logging — wird nicht an das Bildmodell geschickt |
| `headline` | string | ja | Der kurze (2-4 Wörter) Headline-Text, wortwörtlich. Wird NICHT an fal.ai geschickt, sondern nach der Bildgenerierung per Code exakt aufs Bild gerendert (siehe `styleguide.md` Abschnitt „BILDGENERIERUNG" — seit Layout v3 garantiert korrekte Rechtschreibung/Schrift/Position, kein Bildmodell-Text-Risiko mehr) |

Beispielaufruf:
```json
{
  "topic": "Deploy AI in Minutes",
  "headline": "Deploy AI Fast"
}
```
→ liefert `{ imageUrl, promptUsed, topic }`.

### `publish_generated_post`
Veröffentlicht einen Post mit einer bereits vorliegenden (idealerweise bereits geprüften) Bild-URL — z. B. dem Ergebnis von `generate_post_image`.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `imageUrl` | string | ja | Bild-URL, typischerweise aus `generate_post_image`; muss öffentlich erreichbar sein |
| `caption` | string | ja | Caption, max. 2200 Zeichen |

Beispielaufruf:
```json
{
  "imageUrl": "https://fal.media/files/.../beispiel.png",
  "caption": "Unser KI-Chatbot ist rund um die Uhr für dich da. 🤖"
}
```

### `generate_and_publish_post`
Komfort-Variante **ohne** Review-Schritt: generiert das Bild direkt per fal.ai (Flux Schnell) und veröffentlicht es sofort im selben Aufruf. Intern identisch zu `generate_post_image` gefolgt von `publish_generated_post`. Nutzt kein R2, da fal.ai bereits eine öffentliche Bild-URL liefert.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `topic` | string | ja | Ursprüngliches Thema, nur fürs Logging — wird nicht an das Bildmodell geschickt |
| `headline` | string | ja | Der kurze (2-4 Wörter) Headline-Text, wortwörtlich — per Code gerendert, siehe oben bei `generate_post_image` |
| `caption` | string | ja | Caption, max. 2200 Zeichen |

Beispielaufruf:
```json
{
  "topic": "Deploy AI in Minutes",
  "headline": "Deploy AI Fast",
  "caption": "Unser KI-Chatbot ist rund um die Uhr für dich da. 🤖"
}
```

> **Empfehlung für automatisierte Routinen:** Seit Layout v3 (2026-09-05) ist die Headline selbst code-gerendert und damit immer korrekt — das ursprüngliche Risiko für `generate_and_publish_post` (Bildmodell verstümmelt Text) besteht für die Headline nicht mehr. Ein Review-Schritt bleibt trotzdem sinnvoll, weil das fal.ai-Bildmodell den (jetzt textfreien) Hintergrund gelegentlich mit Artefakten liefern kann. Für unbeaufsichtigte Routinen daher weiterhin den zweistufigen Weg nutzen: `generate_post_image` → Hintergrund visuell prüfen → bei Bedarf bis zu 2× neu generieren → erst dann `publish_generated_post`. Ein Beispiel-Routine-Prompt für genau diesen Ablauf steht unten in Abschnitt 7.

### `generate_story_image`
Generiert ein 9:16-Story-Bild per fal.ai (Flux Schnell), **ohne** es zu veröffentlichen — das Story-Pendant zu `generate_post_image`. Gleicher Hintergrund-Prompt, aber Hochformat statt Quadrat, und Headline/Wasserzeichen-Positionierung an das Story-Sicherheitsraster angepasst (siehe `styleguide.md`, Abschnitt „INSTAGRAM STORIES").

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `topic` | string | ja | Ursprüngliches Thema, nur fürs Logging — wird nicht an das Bildmodell geschickt |
| `headline` | string | ja | Der kurze (2-4 Wörter) Headline-Text, wortwörtlich, code-gerendert (siehe `generate_post_image`) |

Beispielaufruf:
```json
{
  "topic": "Deploy AI in Minutes",
  "headline": "Deploy AI Fast"
}
```
→ liefert `{ imageUrl, promptUsed, topic }`.

### `publish_generated_story`
Veröffentlicht eine Instagram Story mit einer bereits vorliegenden (idealerweise bereits geprüften) Bild-URL — z. B. dem Ergebnis von `generate_story_image`. **Kein `caption`-Parameter**, da die Instagram Graph API für Stories keine Caption unterstützt. Teilt sich das 24h-Publishing-Kontingent mit Feed-Posts (kein separates Story-Kontingent).

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `imageUrl` | string | ja | Bild-URL, typischerweise aus `generate_story_image`; muss öffentlich erreichbar sein |

Beispielaufruf:
```json
{
  "imageUrl": "https://fal.media/files/.../beispiel.png"
}
```

### `generate_and_publish_story`
Komfort-Variante **ohne** Review-Schritt: generiert das Story-Bild direkt per fal.ai und veröffentlicht es sofort im selben Aufruf. Intern identisch zu `generate_story_image` gefolgt von `publish_generated_story`.

| Parameter | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `topic` | string | ja | Ursprüngliches Thema, nur fürs Logging |
| `headline` | string | ja | Der kurze (2-4 Wörter) Headline-Text, wortwörtlich — code-gerendert |

Beispielaufruf:
```json
{
  "topic": "Deploy AI in Minutes",
  "headline": "Deploy AI Fast"
}
```

> **Empfehlung für automatisierte Routinen:** Wie beim Feed-Post gilt: für unbeaufsichtigte Läufe den zweistufigen Weg nutzen (`generate_story_image` → Hintergrund visuell prüfen → bei Bedarf bis zu 2× neu generieren → erst dann `publish_generated_story`), damit ein fehlerhafter Hintergrund abgefangen werden kann, bevor er live geht.

### `check_publishing_limit`
Fragt das aktuelle Instagram-Publishing-Kontingent für das konfigurierte Konto ab (gilt für Feed-Posts UND Stories gemeinsam — es gibt kein separates Story-Kontingent). Keine Parameter.

Beispielaufruf: `{}`
→ liefert u. a. `quota_usage`, `quota_total`, `quota_duration`, `remaining`.

### `refresh_access_token`
Erneuert den Long-Lived Instagram-Access-Token (muss mindestens 24 Stunden alt sein) und schreibt den neuen Token automatisch zurück in die lokale `.env`. Keine Parameter.

Beispielaufruf: `{}`

## 7. Einbindung als Custom Connector bei claude.ai

1. Auf [claude.ai/customize/connectors](https://claude.ai/customize/connectors) (bzw. Einstellungen → Connectors) **"Custom Connector hinzufügen"** wählen.
2. **URL:** `https://mcp.pipebot.at/mcp`
3. **Authentifizierung:** Header-basiert, `Authorization: Bearer <MCP_AUTH_TOKEN>` (den Wert aus der `.env` des Servers eintragen).
4. Nach dem Verbinden erscheinen die neun Tools in der Tool-Liste. Für **Cloud-Routinen** (zeitgesteuerte, unbeaufsichtigte Ausführung) müssen die gewünschten Tools auf **"Immer erlauben"** gestellt werden (statt "Bei jeder Nutzung fragen"), da während eines automatisierten Routine-Laufs niemand eine Rückfrage bestätigen kann. Das lässt sich pro Tool in den Connector-/Tool-Einstellungen umstellen.
5. Ein lokal auf `localhost` laufender Server ist für claude.ai **nicht** erreichbar — deshalb der öffentliche Domain+HTTPS-Aufbau aus Abschnitt 2/5 (siehe auch Abschnitt 9).

**Routine-Prompt mit Bild-Review (empfohlen statt `generate_and_publish_post`):**

Der Ablauf mit Qualitätsprüfung gehört in den Prompt-Text der Routine selbst (nicht in den Server-Code), z. B. so:

```
1. Lies styleguide.md für Bildstil, Textvorgaben und Caption-Regeln.
2. Leite aus dem Thema eine kurze Headline (2-4 Wörter) ab und rufe
   `generate_post_image` mit topic und headline (dem reinen Headline-Text,
   z. B. "Deploy AI Fast") auf — Headline und Wasserzeichen werden beide
   automatisch per Code aufgelegt, siehe Bild-Design-Standards.
3. Sieh dir das zurückgegebene Bild (inline im Tool-Ergebnis, bereits inkl.
   Headline und Wasserzeichen) an.
4. Prüfe nur noch den Hintergrund gegen die Qualitätscheckliste aus dem
   Styleguide: dunkles Navy mit Textur, keine Artefakte/unerwarteten
   Grafiken? (Headline-Text/Schrift/Position sind code-generiert und
   müssen nicht mehr geprüft werden.)
5. Falls der Hintergrund fehlerhaft aussieht: Rufe `generate_post_image`
   erneut auf (max. 2 weitere Versuche).
6. Erst wenn das Bild die Checkliste besteht: Rufe `publish_generated_post`
   mit dieser imageUrl und der Caption auf.
```

Dieser Prompt-Text muss manuell in die Routinen-Konfiguration unter [claude.ai/customize](https://claude.ai/customize) (bzw. im jeweiligen Routine-Editor) eingetragen werden — er ist nicht Teil dieses Repos.

## 8. Environment-Variablen (Referenz)

Alle Variablen aus `.env.example` — **ohne echte Werte**, nur zur Orientierung, was jede bewirkt:

| Variable | Bedeutung |
|---|---|
| `PORT` | Lokaler Port, auf dem der MCP-HTTP-Server lauscht (Standard: 3000) |
| `MCP_AUTH_TOKEN` | Bearer-Token, mit dem sich MCP-Clients (z. B. claude.ai) am `/mcp`-Endpoint authentifizieren. Wird beim ersten Start automatisch generiert, falls leer |
| `IG_USER_ID` | Instagram-Business-Account-ID, an die veröffentlicht wird (Fallback, falls `/me` nicht auflösbar ist) |
| `IG_ACCESS_TOKEN` | Long-Lived Access Token der Meta-App für die Instagram Graph API |
| `IG_APP_ID` | App-ID der Meta Developer App |
| `IG_APP_SECRET` | App-Secret der Meta Developer App |
| `MEDIA_STORAGE_BUCKET_URL` | Öffentliche Basis-URL des Cloudflare-R2-Buckets (für hochgeladene Base64-Bilder) |
| `MEDIA_STORAGE_ENDPOINT` | S3-kompatibler API-Endpoint des R2-Buckets |
| `MEDIA_STORAGE_ACCESS_KEY` | R2 Access Key ID |
| `MEDIA_STORAGE_SECRET_KEY` | R2 Secret Access Key |
| `MEDIA_STORAGE_BUCKET_NAME` | Name des R2-Buckets |
| `FAL_API_KEY` | API-Key für fal.ai (Bildgenerierung) |

## 9. Bekannte Probleme / Learnings

- **CRLF-Zeilenenden in `.env` können den `Authorization`-Header brechen.** Wenn die `.env`-Datei mit Windows-Zeilenenden (`\r\n`) gespeichert wird, kann ein aus der Datei extrahierter Wert (z. B. beim manuellen Kopieren des Tokens) ein unsichtbares `\r` mitschleppen. Landet das im `Authorization`-Header, lehnt Node's HTTP-Parser den Request bereits auf Protokollebene mit einem rohen `400 Bad Request` ab — noch bevor die eigene Anwendungslogik überhaupt läuft. **Lösung:** `.env` konsequent mit LF-Zeilenenden speichern (`sed -i 's/\r$//' .env`), gerade wenn sie unter Windows bearbeitet wurde.
- **Flux Schnell konnte Text im Bild verstümmeln — deshalb wird die Headline seit Layout v3 (2026-09-05) gar nicht mehr vom Bildmodell gerendert.** Ursprünglich war die Headline Teil des fal.ai-Prompts (`IMAGE_STYLE_PREFIX` in `src/fal.ts`); eine 12-Bild-Testreihe zeigte dabei nur 16,7% korrekte Ergebnisse (verstümmelter Text, fehlende/vertauschte Wörter, Streu-Interpunktion, inkonsistente Schrift-Mischung), und ein Versuch, den Prompt noch strenger zu formulieren, verschlechterte das sogar auf 0/12 (das Modell rendert dann teils irrelevante Wörter aus dem eigenen Stil-Prefix statt der Headline). Lösung: fal.ai bekommt nur noch einen komplett textfreien Hintergrund-Prompt, Headline und Wasserzeichen werden beide per Code aufgelegt (`addHeadlineText`/`addPipelineWatermark` in `src/watermark.ts`) — eine erneute 12-Bild-Testreihe damit ergab 12/12 (100%). Der zweistufige Ablauf (`generate_post_image` → Review → `publish_generated_post`) bleibt trotzdem sinnvoll, jetzt aber nur noch zur Kontrolle des Hintergrunds (seltene Bildmodell-Artefakte), nicht mehr wegen Text-Risiko.
- **Cloud-Routinen brauchen einen öffentlich erreichbaren MCP-Server.** Claude-Routinen bei claude.ai laufen serverseitig in der Cloud und können keinen `stdio`-MCP-Server oder einen nur lokal (`localhost`) erreichbaren HTTP-Server ansprechen. Für Automatisierung ist daher zwingend ein öffentlich per HTTPS erreichbarer Server nötig (siehe Hosting-Aufbau in Abschnitt 2) — rein lokale Setups funktionieren nur für manuelle Nutzung über Claude Code oder den Desktop-Client mit lokalem MCP-Server.
