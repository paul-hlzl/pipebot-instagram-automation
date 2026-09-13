# Security- & UX-Review + CAPTCHA-Fertigstellung (2026-09-13)

Lange autonome Arbeitssitzung, Auftrag "CAPTCHA fertigstellen + umfassender Sicherheits- und
Nutzerfreundlichkeits-Review". Branch `captcha-security-ux-review-2026-09-13`, abgezweigt von
Tag `pre-captcha-security-review`. Dieses Dokument wird laufend während der Sitzung
fortgeschrieben, nicht erst am Ende.

Alle Code-Fixes werden zuerst in der Sandbox (`instagram-mcp-staging`, Port 3100, eigene DB
`data/panel-staging.db`) entwickelt und dort bestätigt getestet. Produktion wird erst am Ende
(Aufgabe 4) in einem einzigen gebündelten Deploy übernommen, außerhalb des stündlichen
Routine-Fensters (nicht um :43) - siehe Abschnitt "Deploy" ganz unten.

---

## Aufgabe 1: Cloudflare Turnstile CAPTCHA

**Status: fertig getestet in der Sandbox mit Cloudflares offiziellen Test-Keys.**

### Was schon vorhanden war (aus einer früheren Sitzung, Panel v6 Aufgabe 2a)
- `src/panel/turnstile.ts`: serverseitige Verifizierung gegen die echte Cloudflare-
  siteverify-API, "fail closed" bei jedem Fehler (fehlender Token, Netzwerkfehler, Timeout,
  Ablehnung).
- `public/panel/index.html`: Widget wird nur gerendert, wenn `TURNSTILE_SITE_KEY` gesetzt ist
  (sonst unsichtbar deaktiviert, kein Fehler) - `render=explicit`, eigener Render-Aufruf beim
  Wechsel auf Formular-Seite 2.
- `router.ts`: `/api/signup` prüft das Token vor jeder anderen Verarbeitung, wenn
  `TURNSTILE_SECRET_KEY` gesetzt ist.

### End-to-End getestet (Sandbox, mit Cloudflares offiziellen öffentlichen Test-Keys - siehe
https://developers.cloudflare.com/turnstile/troubleshooting/testing/, nicht geraten)

| Test | Sitekey/Secret verwendet | Ergebnis |
|---|---|---|
| Signup ohne jedes Token | (Feature aktiv, egal welches Keypaar) | 400, klare Meldung "Sicherheitsprüfung fehlgeschlagen. Bitte laden Sie die Seite neu und versuchen Sie es erneut." |
| Signup mit "immer erfolgreich"-Dummy-Token | `1x00000000000000000000AA` / `1x0000...AA` | 201, Signup läuft normal durch (getestet per curl UND per echtem Submit-Handler-Durchlauf mit simuliertem Widget) |
| Signup mit "immer abgelehnt"-Keypaar | `2x00000000000000000000AB` / `2x0000...AA` | 400, dieselbe klare deutsche Fehlermeldung wie oben - kein kryptischer Rohtext |

Testmethode: da kein echter Browser verfügbar war, wurde der komplette Client-Code (die
State-Machine in `public/panel/index.html`) per `jsdom` gegen die echte laufende Sandbox
ausgeführt (echte HTTP-Requests, echte Cloudflare-siteverify-Aufrufe) - nicht nur der Server
isoliert getestet.

### Zwei echte Bugs gefunden und behoben (beide vorher latent, weil `TURNSTILE_SITE_KEY` in
Produktion nie gesetzt war und das Feature dadurch nie tatsächlich durchlaufen wurde)

1. **Kritisch - Widget überlebte keinen fehlgeschlagenen Absende-Versuch.** Jeder
   Server-Fehler beim Signup (egal ob Turnstile-Ablehnung, verbotenes Wort, Rate-Limit -
   irgendein 400) löste ein volles Neu-Rendern der Formularseite aus. Das alte
   `#turnstile-widget`-Div wurde dabei durch ein neues, leeres ersetzt - der reine
   ID-basierte Guard im alten Code dachte fälschlich "schon gerendert" und ließ das neue Div für
   immer leer. Ergebnis: nach dem ersten Fehlversuch hätte JEDER Kunde ohne manuelles
   Neuladen der Seite nie wieder ein Widget zum Lösen gesehen - faktisch ein Soft-Lock direkt
   nach der ersten Cloudflare-Ablehnung. Mit einem eigenen Reproduktionstest (jsdom, echter
   Submit-Handler, `Turnstile` als "immer ablehnen" konfiguriert) bestätigt, dann behoben:
   der Code merkt sich jetzt den tatsächlichen DOM-Knoten statt nur einer ID und rendert bei
   einem neuen Knoten korrekt neu. Erneut getestet: Widget übersteht jetzt einen
   Fehlversuch und bleibt nutzbar.
2. **Mittel - kein Fallback, wenn das Turnstile-Skript nicht lädt** (Adblocker,
   Netzwerkfehler, Firmen-Firewall). Die Warteschleife pollte vorher unbegrenzt auf
   `window.turnstile`, ohne Timeout oder Fehlermeldung - der Kunde hätte vor einem leeren,
   für immer nutzlosen Platzhalter gesessen, ohne jede Erklärung. Jetzt: 8 Sekunden Timeout
   plus `onerror`-Handler am Script-Tag, danach klare Inline-Meldung ("Die
   Sicherheitsprüfung konnte nicht geladen werden - möglicherweise blockiert ein
   Werbe-/Trackingblocker..."). Timeout-Logik isoliert getestet (verkürzte Zeit), Mechanik
   bestätigt korrekt.

Beide Fixes: `public/panel/index.html`, Funktionen `loadTurnstileScript`,
`renderTurnstileIfNeeded`, neue Funktion `showTurnstileLoadError`, plus ein Aufruf in der
Signup-Formular-Fehlerbehandlung.

### Anleitung für Paul
`docs/TURNSTILE_SETUP.md` - Cloudflare-Account anlegen (kostenlos, keine Zahlungsdaten),
Turnstile-Site für `mcp.pipebot.at` und `app.pipeflow.at` anlegen, `TURNSTILE_SITE_KEY`/
`TURNSTILE_SECRET_KEY` in die echte `.env` eintragen, `pm2 restart instagram-mcp` (außerhalb
des Routine-Fensters). Kein Code, kein Rebuild nötig - die Werte werden bei jeder Anfrage
direkt aus der Umgebung gelesen.

**Bekannter offener Punkt:** ohne echte Keys ist Signup weiterhin ungeschützt gegen Bots -
das ist der aktuelle Ist-Zustand (sicher, aber nicht ideal), keine Änderung durch diese
Sitzung nötig, da echte Keys nur von Paul selbst angelegt werden können.

---

## Aufgabe 2: Sicherheits-Review

*(wird während der Sitzung befüllt)*

---

## Aufgabe 3: Nutzerfreundlichkeits-Review

*(wird während der Sitzung befüllt)*

---

## Aufgabe 4: Deploy + Zusammenfassung

*(am Ende der Sitzung)*
