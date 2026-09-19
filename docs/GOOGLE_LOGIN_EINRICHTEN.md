# Anmeldung mit Google einrichten (Sandbox)

Stand 19.09.2026. Microsoft läuft bereits nach demselben Muster; für Google fehlt nur noch die
OAuth-Client-ID aus der Google Cloud Console.

---

## 1. Die Redirect-URI, zeichengenau

Genau diese eine Zeile in der Google Cloud Console unter **Autorisierte Weiterleitungs-URIs**
eintragen (nicht unter „Autorisierte JavaScript-Quellen", das ist ein anderes Feld und bleibt
leer):

```
https://mcp.pipebot.at/panel/sandbox/auth/google/callback
```

Zum Kopieren ohne Zeilenumbruch, dieselbe Adresse in ihre Bestandteile zerlegt - falls beim
Einfügen etwas verrutscht, kannst du Stück für Stück vergleichen:

| Teil | Wert |
|---|---|
| Schema | `https://` |
| Host | `mcp.pipebot.at` |
| Pfad, Teil 1 | `/panel` |
| Pfad, Teil 2 | `/sandbox` |
| Pfad, Teil 3 | `/auth` |
| Pfad, Teil 4 | `/google` |
| Pfad, Teil 5 | `/callback` |

Kein abschließender Schrägstrich, alles klein geschrieben, kein Port, keine Parameter.

**Woher diese Adresse stammt:** nicht abgetippt. Der Server baut sie in `start-routes.ts` für
jeden Anbieter aus derselben Zeile zusammen (`baseUrl + mount + /auth/<anbieter>/callback`).
Für Microsoft wurde genau dieser Weg live ausgelesen und funktioniert; Google unterscheidet
sich nur im Wort `google`. Dass der Pfad existiert, ist geprüft: ein Aufruf von
`/panel/sandbox/auth/google/callback` antwortet mit 303 und der Meldung „state fehlt" - also
mit der Route, nicht mit 404.

---

## 2. Was du in der Google Cloud Console sonst einstellst

- **Anwendungstyp:** Webanwendung.
- **Zustimmungsbildschirm (OAuth consent screen):** Nutzertyp **Extern**. Solange die App im
  Status „Testing" steht, müssen alle Konten, die sich anmelden, unter **Testnutzer**
  eingetragen sein - sonst kommt beim Anmelden „Zugriff blockiert: … hat den Zugriff nicht
  abgeschlossen". Für den Sandbox-Test reicht deine eigene Adresse als Testnutzer.
- **Bereiche (Scopes):** Es werden nur `openid`, `email` und `profile` angefragt. Die gelten bei
  Google als nicht sensibel, es braucht also **keine** App-Überprüfung und keine Wartezeit.
- **Veröffentlichungsstatus:** „Testing" genügt für die Sandbox. Erst wenn der Login später für
  fremde Kunden auf `app.pipeflow.at` laufen soll, auf „In Produktion" umstellen. Achtung, das
  ist dieselbe Falle wie bei der Google-Drive-Sicherung: bei „Testing" laufen Tokens nach
  sieben Tagen ab. Für die reine Anmeldung ist das egal, weil wir kein Refresh-Token behalten -
  wir fragen nur einmal Name und Adresse ab und legen danach unsere eigene Sitzung an.

---

## 3. Was ich von dir brauche

Zwei Werte aus der Console, nach dem Anlegen im Dialog „OAuth-Client erstellt":

1. **Client-ID** - endet auf `.apps.googleusercontent.com`.
2. **Clientschlüssel** - beginnt bei Google üblicherweise mit `GOCSPX-`.

Wichtig, weil es bei Microsoft genau daran gescheitert ist: Es ist der **Wert** gemeint, nicht
eine ID des Geheimnisses. Bei Google gibt es diese Verwechslungsgefahr weniger, das Feld heißt
schlicht „Clientschlüssel".

Ich trage beides als `AUTH_GOOGLE_CLIENT_ID` und `AUTH_GOOGLE_CLIENT_SECRET` in
`/root/staging.ecosystem.json` ein (Rechte 600, außerhalb des Git-Repos), prüfe den Schlüssel
vor deinem ersten Versuch direkt bei Google gegen und starte den Sandbox-Prozess neu. Danach
wird aus „kommt noch" ein echter Anmeldeknopf - dieselbe Änderung wie bei Microsoft, ohne
Eingriff in den Code.

---

## 4. Für später: Produktion

Wenn der Flow irgendwann unter `app.pipeflow.at` laufen soll, kommt in derselben
OAuth-Client-ID eine zweite Weiterleitungs-URI dazu:

```
https://app.pipeflow.at/auth/google/callback
```

Jetzt noch nicht eintragen - dieser Auftrag endet in der Sandbox.
