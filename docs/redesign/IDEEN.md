# Ideen für die nächste Runde (nicht gebaut)

Gesammelt während des Redesigns „Flow". Nichts davon ist umgesetzt — bewusst, damit der Auftrag
nicht ausufert. Reihenfolge = grobe Einschätzung von Nutzen zu Aufwand.

## 1. Web-Push „Freigabe wartet" (im Auftrag ausdrücklich nur vorzumerken)
Der einzige Weg, einen Kunden zu erreichen, ohne dass er das Panel öffnet — E-Mail geht im Alltag
unter. Braucht: Service Worker, `PushManager`-Abo, VAPID-Schlüssel, eine neue Tabelle für Abos und
einen Auslöser im bestehenden Freigabe-Pfad. Heikel: iOS verlangt dafür eine installierte PWA.
**Vorschlag:** erst bauen, wenn die PWA-Installation (siehe 2.) von Kunden tatsächlich genutzt wird.

## 2. „Zum Home-Bildschirm hinzufügen"
Manifest und Icons liegen bereits. Fehlt: der einmalige Hinweis nach der ersten Freigabe am Handy
(iOS mit Anleitung, Android über `beforeinstallprompt`) und ein Service Worker für die App-Hülle,
der **niemals** API-Antworten cacht, mit getrennten Scopes für `/panel` und `/panel/sandbox`.

## 3. Autosave in den Einstellungen
Heute: „Änderungen speichern". `PATCH /api/me` sendet immer das ganze Briefing, deshalb braucht
Autosave Debounce, einen Konfliktschutz (zwei Geräte gleichzeitig) und eine bewusste Bestätigung
dort, wo eine Änderung Geld kostet oder sofort wirkt (die heutigen `.consequence`-Hinweise).

## 4. Wischgesten
Freigabe-Karte nach rechts/links wischen, Lightbox mit Wischen zwischen Bildern und
Doppeltipp-Zoom. Immer zusätzlich zu den sichtbaren Buttons, nie als einziger Weg.

## 5. Rundgang als Spotlight
Statt Dialog: echte Elemente hervorheben (Freigabe-Karte, „Jetzt posten", Flow-Leiste), maximal
vier Schritte, jederzeit abbrechbar.

## 6. Befehlspalette (⌘K / Strg+K) und Tastenkürzel
Bereiche und Einstellungen per Suche erreichen, `F` freigeben, `E` bearbeiten, `?` zeigt alle
Kürzel. Reiner Desktop-Komfort — am Handy ohne Nutzen, deshalb hinten angestellt.

## 7. `commentAutomationMode` auch deaktiviert mitsenden
Altbestand-Fehler, im Bericht beschrieben: Fehlt der Instagram-Verbindung der Kommentar-Scope,
sind die Radios deaktiviert, das Feld fehlt im Speichern und der Server setzt es auf „approval"
zurück. Ein Kunde mit „automatisch" verliert die Einstellung beim nächsten Speichern.

## 8. Flow-Leiste mit einer Spur je Kanal
Aktuell ein Knoten je Beitrag innerhalb des Tages. Ab Tablet-Breite wären drei Spuren
(Feed / Story / LinkedIn) lesbarer und würden zeigen, welcher Kanal wann bespielt wird.

## 9. Statusanzeige nach „Jetzt posten"
Heute endet der Ablauf mit einer Bestätigung. Schöner wäre der Zustand direkt in der Pipe
(„Wird erstellt …" → „Zur Freigabe bereit" → „Veröffentlicht"), per Polling nur bei sichtbarem Tab,
mit Backoff und Beachtung des bestehenden Cooldowns.

## 10. Eigene Pipeflow-Domain
Das Panel ist jetzt mount-agnostisch (Pfad wird abgeleitet, keine hartkodierten `/panel`-Pfade),
liefe also ohne Codeänderung unter z. B. `app.pipeflow.at`. Offen sind nur nginx, Zertifikat und
`PANEL_BASE_URL`/`PANEL_MOUNT_PATH`.
