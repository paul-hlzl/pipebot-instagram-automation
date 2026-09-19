# Testmodus der Sandbox

Stand 19.09.2026. Nur Sandbox. Produktion hat den Weg nicht: er existiert nur,
wenn `PANEL_SANDBOX=true` **und** `PANEL_TEST_KEY` gesetzt sind.

## Wofuer noch, seit die Deckel weg sind

Seit dem 19.09.2026 sind in der Sandbox alle Tagesgrenzen und Sperren
abgeschaltet (siehe `EASY_ONBOARDING_TAGESLIMIT.md`). Der normale Einstieg
laesst sich also beliebig oft durchklicken, ohne Schluessel. Der Testmodus
bleibt trotzdem nuetzlich, und zwar fuer genau zwei Dinge:

- **Kein Konto ausdenken.** Der Einstieg legt den Durchlauf an, ohne nach einer
  E-Mail-Adresse zu fragen.
- **Zuruecksetzen mit einem Klick.** Wer sich ueber den normalen Weg anmeldet,
  bekommt beim zweiten Durchlauf seine bestehende Woche zu sehen
  ("Für dieses Konto liegt schon eine Woche bereit"). Im Testmodus raeumt
  "Neu starten" das weg.

## Benutzen

**Einstieg:** `https://mcp.pipebot.at/panel/sandbox/start/test?key=<SCHLUESSEL>`

Der Schluessel steht in `/root/staging.ecosystem.json` (Rechte 600, ausserhalb
des Repos). Auslesen mit:

```
grep -o '"PANEL_TEST_KEY": *"[^"]*"' /root/staging.ecosystem.json
```

Bewusst nicht in dieser Datei und in keinem Chat-Verlauf. Wer ihn ersetzen will,
traegt einen eigenen Wert ein und startet die Sandbox neu
(`pm2 startOrRestart /root/staging.ecosystem.json --update-env`).

Ein Aufruf legt einen frischen Testlauf an und leitet auf `/start/` um. Der
Schluessel bleibt **nicht** in der Adresszeile stehen - wichtig bei Beamer,
Screenshots und Browserverlauf. Ab da laeuft der ganz normale Flow, beginnend
bei der Website-Frage. Oben sitzt eine schmale graue Leiste:

- **Neu starten** - wirft den laufenden Testlauf weg und faengt sofort neu an.
- **Beenden** - wirft ihn weg und meldet ab.

Ein erneuter Aufruf des Einstiegslinks macht dasselbe wie "Neu starten".

## Kosten

Gemessen am 19.09.2026, hittaro.com, Domain aus dem Zwischenspeicher:

| Posten | Wert |
| --- | --- |
| Dauer bis zur fertigen Woche | 12 Sekunden |
| Beitraege | 10, alle mit Bild |
| Kosten | 0,01715 USD = **0,0158 EUR** |

Die Bilder kosten nichts: bei eingeschaltetem Farbverlauf rendert
`generateImageUrl` lokal und ruft fal.ai gar nicht auf. Bezahlt wird nur die
Textgenerierung (Haiku). Eine **neue, noch nie gelesene Domain** kommt mit der
Website-Analyse dazu, dann sind es rund 0,02 EUR. Hundert Durchlaeufe liegen
unter zwei Euro.

## Wie es gebaut ist

Ein Testkunde bekommt `status = 'test'` statt `'active'`. Das ist der ganze
Trick: alle bestehenden Abfragen filtern auf `status = 'active'` und sparen ihn
damit **automatisch** aus - naechtliche Planung, Kommentar- und
Bewertungsautomatik, Analytics, Trial-Mails, Stillstands-Wache,
`list_customers`, Video-Kandidaten, Credentials-Liste. Kein neuer Filter an
zwanzig Stellen, der irgendwann vergessen wird.

Genau drei Stellen mussten angepasst werden, alle drei in `start-testmode.ts`
dokumentiert:

| Datei | Warum |
| --- | --- |
| `router.ts`, `currentCustomer()` | laesst `'test'` als Sitzung zu, sonst koennte der Testkunde das Panel nicht bedienen |
| `admin.ts`, `/api/overview` | listet bewusst alle Status, also auch `'test'` - dort `WHERE status != 'test'` |
| `analytics.ts`, Kostenuebersicht | summiert `usage_costs` ohne Kundenbezug - dort per Unterabfrage ausgeschlossen |

Die `usage_costs`-Zeilen eines Testlaufs bleiben stehen, damit man einzeln
nachrechnen kann; in der Kostenuebersicht tauchen sie nicht auf. Beim
Zuruecksetzen verschwinden sie mit dem Kunden.

**Sperren:** in `start-routes.ts` setzt `istTestkunde(c)` das Stundenlimit, die
Turnstile-Pruefung und alle vier Tagesgrenzen ausser Kraft.

**Zuruecksetzen** loescht ueber alle Tabellen, die eine `customer_id` haben -
die Liste wird zur Laufzeit aus `sqlite_master` gelesen, damit eine spaeter
dazukommende Tabelle nicht vergessen wird. `testkundeLoeschen()` **wirft**, wenn
der Kunde kein Testkunde ist; diese Funktion kann keinen echten Kunden anfassen.

**Aufraeumen:** Testkunden aelter als 24 Stunden raeumt der naechste Einstieg weg.

## Sicherheit

- Ohne `PANEL_SANDBOX=true` und ohne `PANEL_TEST_KEY` sind die Routen nicht
  registriert.
- Falscher Schluessel faellt durch auf denselben Status wie ein unbekannter
  Pfad (401 hinter dem Sandbox-Tor) - man kann nicht erraten, dass es den Weg
  gibt.
- Der Schluessel wird konstant verglichen (`timingSafeEqual`).
- 60 Einstiege pro Stunde und IP.
- `POST /api/start/test/reset` und `/end` verlangen eine laufende Testsitzung,
  sonst 403.

## Pruefen

```
node scripts/test-testmodus.mjs
```

29 Pruefungen zu allen sechs Zusagen aus dem Auftrag, inklusive der Frage, ob
ein Testkunde in einer der echten Kundenabfragen auftaucht. Lief am 19.09.2026
vollstaendig gruen.
