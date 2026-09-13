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

Methodik: Code gelesen UND, wo sinnvoll, live in der Sandbox nachgestellt (zwei echte
Test-Kunden für Zugriffskontrolle, echte SSRF-Payloads gegen die Cloudflare-siteverify-fremde
`ssrf-safe-fetch.ts`, echte Rate-Limit-Läufe per curl).

| # | Punkt | Ergebnis |
|---|---|---|
| 1 | Session-/Cookie-Sicherheit | **Geprüft, in Ordnung.** `pp_session`/`pp_admin`: `HttpOnly; Secure; SameSite=Lax`, Token 256 Bit CSPRNG (`crypto.randomBytes(32)`), nur der SHA-256-Hash landet in der DB (wie ein Passwort-Hash). Kunden-Session 90 Tage (passt zu einem "eingeloggt bleiben"-Produkt), Admin-Session 12 Stunden (kurz, angemessen). Einzige Kleinigkeit (kein Fund): `Path=/panel` (Produktion) ist ein Präfix von `/panel/sandbox` - die Produktions-Cookie wird technisch auch mit an Sandbox-Requests gesendet, aber die Sandbox hat eine komplett andere DB/Session-Tabelle und erkennt den Token einfach nicht (kein Zugriff möglich, nur unnötig ein paar Bytes mehr im Request). |
| 2 | Zugriffskontrolle (Kunde A auf Kunde B) | **Geprüft, in Ordnung - live mit zwei echten Test-Kunden in der Sandbox bestätigt.** A konnte B's Farbthema nicht aktivieren (404), B's Freigabe-Eintrag weder annehmen noch ablehnen (404), sah nur die eigene, leere Historie/Freigabe-Liste. Code-seitig sind ausnahmslos alle kundenspezifischen Routen (`planned-posts/:id`, `approvals/:id`, `themes/:id`, `logo`, `posts`, `disconnect`) über `currentCustomer(req).id` UND die Ressourcen-ID gemeinsam in der SQL-`WHERE`-Klausel gescoped, nie nur über die ID allein. `usage_costs` (im Auftrag erwähnt) existiert im aktuellen Code nicht - kein solches Feld/Tabelle vorhanden, daher nicht separat zu prüfen. |
| 3 | Admin-Bereich | **Geprüft, in Ordnung.** Rate-Limit 8 Versuche/15 Min pro IP auf `/admin/api/login`. Passwortvergleich mit `crypto.timingSafeEqual` (inkl. Schutz gegen einen Längen-basierten Timing-Seitenkanal - bei unterschiedlicher Länge wird trotzdem ein gleich teurer Vergleich ausgeführt, nur mit sich selbst, um die Zeit anzugleichen). Eigene, von der Kunden-Session komplett getrennte Session (`pp_admin`, 12h, gleiche Cookie-Flags). Alle Datenrouten hinter `requireAdmin` gated. |
| 4 | SSRF-Schutz (`/api/analyze-website`) | **Geprüft, in Ordnung - weiterhin vollständig wirksam**, direkt gegen `ssrf-safe-fetch.ts` getestet (12 Payloads: `127.0.0.1`, `169.254.169.254`, `localhost`, `192.168.1.1`, `10.0.0.1`, `::1`, `100.64.0.1` (CGNAT), `0.0.0.0`, ein `nip.io`-DNS-Rebinding-Hostname, sowie dezimal- (`2130706433`) und hex-kodierte (`0x7f000001`) IP-Literale für 127.0.0.1) - alle korrekt abgelehnt. Auch `ftp://` korrekt abgelehnt. DNS wird einmal aufgelöst und die Verbindung an genau diese IP gepinnt (kein TOCTOU/Rebinding-Fenster), Redirects werden nicht verfolgt. |
| 5 | Datei-Upload (Logo) | **Geprüft, in Ordnung - stärker als erwartet.** Nicht nur MIME-Typ-Regex + 2-MB-Limit: jedes hochgeladene Bild wird über `sharp` dekodiert und als komplett neues PNG re-encodiert (512×512), bevor es gespeichert wird - das macht ein eingeschleustes Skript (getarnte `.svg`/`.html`, Polyglot-Datei, EXIF-Payload) technisch unmöglich, weil nur echte Rasterbild-Pixel überleben, alles andere lässt `sharp` mit einem klaren Fehler scheitern. Ausgeliefert wird die Datei immer als `.png` (`res.sendFile` setzt `Content-Type: image/png` über die Dateiendung), nie als der ursprünglich behauptete Typ. **Lücke gefunden und behoben:** dieser Endpunkt hatte als einziger kostenpflichtiger Endpunkt (sharp-Verarbeitung + Festplattenschreibzugriff) gar kein Rate-Limit - jetzt 20/Stunde pro Kunde, live in der Sandbox mit 22 schnellen Aufrufen bestätigt (ab dem 21. korrekt 429). |
| 6 | XSS / Eingabe-Escaping | **Geprüft, in Ordnung.** Jede Stelle, an der Kundentext (Firmenname, Briefing, Content-Säulen-Titel/-Beschreibung, Post-Caption/-Headline, Freigabe-Karten, Hilfe-Chat-Nachrichten inkl. KI-Antwort, Theme-Namen/-Farben) in `innerHTML` landet, geht durch die zentrale `esc()`-Funktion (HTML-Entity-Escaping) - systematisch mit `grep` durch alle 51 `innerHTML =`-Stellen gegangen, keine Ausnahme gefunden. Die einzigen zwei ungefilterten Interpolationen (Firmenname im "Konto löschen"-Bestätigungsdialog) landen über `.textContent`, nicht `.innerHTML` - dort ist Escaping unnötig UND korrekt weggelassen. |
| 7 | Rate-Limits (vollständige Liste) | **Geprüft - eine Lücke gefunden und behoben** (Logo-Upload, siehe Punkt 5). Alle anderen: Signup 5/h/IP, Login-per-Link 20/h/IP, Passwort-/Zugang-Recovery 10/h/IP UND zusätzlich 3/h/E-Mail, Admin-Login 8/15min/IP, `improve-briefing` 6/10min/IP, `analyze-website` 1/min/IP, `suggest-pillars` 3/Tag/Kunde, `suggest-topics` 6/10min/Kunde, Hilfe-Chat 20/h/Kunde, E-Mail-Bestätigung erneut senden 1/5min/Kunde. `post-now` und `regenerate-image` haben statt eines Zeitfensters eine feste Obergrenze (max. offene Anfragen/Tag bzw. max. 3 Neu-Erstellungen pro Beitrag) - funktional gleichwertig. |
| 8 | Secrets-Hygiene | **Geprüft, in Ordnung.** Working Tree UND komplette Git-Historie nach bekannten Secret-Mustern durchsucht (Anthropic/Google/GitHub-Key-Präfixe, private-key-Blöcke, `KEY=`/`TOKEN=`/`SECRET=` mit echt aussehendem Wert in docs/README) - keine Treffer. `.env` war nie getrackt (nur `.env.example` mit Platzhaltern). |
| 9 | HTTP-Security-Header | **Lücke gefunden und behoben.** `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, CSP waren bereits auf jeder geprüften Seite vorhanden (Hauptseite, Admin, API-Antworten, Login) - **aber `Strict-Transport-Security` fehlte komplett**, weder in der App noch in nginx. Jetzt ergänzt (`max-age=31536000; includeSubDomains`, bewusst ohne `preload` - das würde die ganze Domain inkl. aller anderen dort laufenden Dienste dauerhaft binden, nicht ohne Rücksprache). In der Sandbox bestätigt. |
| 10 | `npm audit` | **Geprüft, in Ordnung.** 0 Schwachstellen (info/low/moderate/high/critical alle 0). |
| 11 | E-Mail-Enumeration | **Geprüft, größtenteils in Ordnung, ein kleiner theoretischer Punkt nicht behoben.** `/api/recover-access` gibt IMMER dieselbe Meldung zurück, ob die Adresse existiert oder nicht. Signup hat gar keine E-Mail-Unique-Constraint (jede Anfrage legt einfach einen neuen Datensatz an) - dadurch ist "diese Adresse ist schon registriert" als Signal technisch unmöglich, kein Enumerations-Weg über Signup. Login-per-Zugangslink verrät nichts (ein Fehlercode für jeden Fehlerfall). Einziger Rest-Punkt: bei `/api/recover-access` macht der "gefunden"-Zweig etwas mehr Arbeit (ein zusätzlicher synchroner DB-Write + Token-Erzeugung) als der "nicht gefunden"-Zweig, bevor geantwortet wird - ein theoretischer Timing-Seitenkanal, praktisch im Millisekundenbereich und kaum über ein normales Netzwerk messbar. Nicht behoben (Aufwand/Nutzen), aber hier klar dokumentiert statt stillschweigend übergangen. |

### Zusätzlich behoben (nicht explizit im Auftrag, aber beim Durchgehen aufgefallen)
- **HSTS-Header fehlte** (Punkt 9).
- **Logo-Upload ohne Rate-Limit** (Punkt 5/7).

---

## Aufgabe 3: Nutzerfreundlichkeits-Review

Methodik: kein echter Browser verfügbar in dieser Sitzung - Code (Templates, CSS, Event-Handler)
systematisch gelesen, dort wo es um tatsächliches Verhalten (nicht nur Optik) ging zusätzlich
per `jsdom` gegen die laufende Sandbox ausgeführt. Kontrast rechnerisch (WCAG-Formel) statt
visuell geprüft - eine echte visuelle Prüfung am Bildschirm bleibt offen (siehe "Bekannte
Risiken" in Aufgabe 4).

### Gefunden und direkt behoben (einfach, risikoarm)

1. **Drei Buttons ganz ohne Ladeanzeige:** "+ Aktuelle Farbe/Beschriftung als Thema speichern",
   ein Farbthema aktivieren, und "stattdessen eigene Farbe verwenden" (Formular-Bereich "Ihr
   Stil") lösten einen Netzwerk-Aufruf aus, ohne den Button währenddessen sichtbar zu
   deaktivieren - ein Doppelklick auf einer langsamen Verbindung hätte den Aufruf zweimal
   ausgelöst, oder es hätte einfach nach "hängt" ausgesehen. Jetzt: gleiches `busy`-Muster wie
   bei jedem anderen Button im Panel (Klasse `busy` während des Requests, `finally`/Catch setzt
   sie zurück).
2. **`.link`-Buttons mit `disabled`-Attribut hatten keine garantiert sichtbare Deaktivierung.**
   Mehrere bestehende Buttons (Logo entfernen, Konto löschen, Posting pausieren,
   Bestätigungsmail erneut senden, Zugangslink anfordern) setzen beim Laden korrekt
   `btn.disabled = true`, aber es gab nur eine CSS-Regel für `.btn[disabled]`, keine für
   `.link[disabled]` (alle genannten Buttons sind `.link`-Buttons) - je nach Browser blieb die
   Deaktivierung dadurch optisch unauffällig bis unsichtbar. Jetzt eine explizite
   `.link[disabled]`-Regel ergänzt (grau, kein Unterstrich, `not-allowed`-Cursor) - konsistent
   mit der bestehenden `.btn[disabled]`-Optik.

Beide Fixes: `public/panel/index.html`, in der Sandbox geladen und auf Ladefehler-frei geprüft
(kompletter Seitenaufruf ohne JS-Fehler).

### Geprüft, in Ordnung

- **Fehlermeldungen:** kein einziger roher/technischer Fehlertext gefunden. Jeder unerwartete
  Server-Fehler (500) landet in einem zentralen Error-Handler (`router.ts`/`admin.ts`), der
  IMMER eine freundliche, deutsche Standardmeldung zurückgibt ("Da ist auf unserer Seite etwas
  schiefgelaufen. Bitte versuchen Sie es erneut."), nie den echten Fehler/Stacktrace. Alle
  client-seitigen Fallback-Texte (21 Stellen mit `err.message || "..."`) sind ebenfalls klares,
  konkretes Deutsch.
- **Ladezustände (sonst):** die meisten kostenpflichtigen/langsamen Aktionen (KI-Vorschläge,
  Bild-Neuerstellung, Hochladen, Freigeben/Ablehnen, Trennen, Website analysieren) hatten
  bereits ein klares Muster - Button deaktiviert + oft zusätzlich Text wie "Wird erstellt …"/
  "Wird recherchiert …" statt nur eines Spinners. Gutes, konsistentes Muster im ganzen Panel.
- **Leere Zustände:** wirken einladend, nicht wie ein Fehler - z. B. "Noch keine Beiträge
  veröffentlicht. Sobald der erste online geht, erscheint er hier." statt einer nackten
  "0 Ergebnisse"-Meldung. Neutrale graue Farbe (`--stone`), keine Alarmfarbe.
- **Konsistenz der Begriffe:** "Content-Säule(n)" wird ausnahmslos so genannt (keine
  "Themen-Bereiche" o. ä. gefunden), "Freigabe-Modus" konsistent. "Beitrag"(Substantiv) vs.
  "posten"(Verb) sind zwei verschiedene Wortarten für dasselbe Konzept, keine echte
  Inkonsistenz.
- **Kontrast (rechnerisch, WCAG-Formel):** Haupttext `--ink` #000 auf `--paper` #FFF = 21:1.
  Sekundärtext `--stone` #666 auf Weiß = 5,7:1. Fehlerfarbe `--stop` #B42318 = 6,6:1.
  Erfolgsfarbe `--go` #137A3F = 5,4:1. Alle drei über der WCAG-AA-Mindestanforderung (4,5:1 für
  normalen Text) - unabhängig von tatsächlicher Bildschirmwiedergabe (keine echte visuelle
  Prüfung möglich, siehe oben).
- **Formular-Validierung:** company/contactName/email/consent zeigen einen konkreten Fehler
  direkt am Feld (nicht nur oben auf der Seite) - sowohl beim Signup als auch beim späteren
  Bearbeiten des Profils (beide nutzen dieselbe `parseBriefing()`/`fields`-Fehlerstruktur
  serverseitig).
- **Buttons als klickbar erkennbar:** `.btn` hat durchgängig Rahmen/Hintergrund-Kontrast,
  `.link` durchgängig Unterstrich - keine Stelle gefunden, an der ein klickbares Element wie
  reiner Fließtext aussieht.

### Vorgemerkt, nicht selbst umgebaut (größer / Design-Entscheidung)

- **Leere Zustände und echte Ladefehler sehen optisch identisch aus** (dieselbe `.empty`-Klasse
  für "noch nichts da" UND "konnte nicht geladen werden"). Ein Kunde kann die beiden Fälle nicht
  auf einen Blick unterscheiden, und ein echter Ladefehler bietet keinen "erneut versuchen"-
  Button - nur ein manuelles Neuladen der Seite hilft. Würde eine eigene Fehler-Optik (andere
  Farbe/Icon) plus Retry-Buttons an mehreren Stellen brauchen - keine Ein-Zeilen-Änderung, daher
  hier nur vermerkt.
- **Keine echte visuelle/Screenreader-Prüfung möglich** (kein Browser in dieser Sitzung) - die
  rechnerische Kontrastprüfung und der Code-Review ersetzen keinen echten Blick auf den
  gerenderten Bildschirm bzw. einen echten Screenreader-Durchlauf.

---

## Aufgabe 4: Deploy + Zusammenfassung

*(am Ende der Sitzung)*
