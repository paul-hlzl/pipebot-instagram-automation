# Tageslimit: neuer Text (gebaut) und Ausnahme fuer Demos (Vorschlag)

Stand 19.09.2026. Sandbox. Vorgelegt als Claude-Doc:
https://claude.ai/code/artifact/12a9d43e-4589-4d46-8fcd-9901019d6600

## Teil A: der neue Text (gebaut und ausgeliefert)

Drei Aenderungen.

**Eine Grenze ist kein Fehler.** Die Antwort traegt jetzt `limit: true`. Die
Oberflaeche zeigt daraufhin eine ruhige graue Karte (`.notice.ruhig`) statt der
roten Feldmeldung, und `aria-invalid` bleibt am Eingabefeld aus. Vorher lief
alles durch `feldFehler()`, also durch `.error { color: var(--schlecht) }`.

**Echte Uhrzeit statt "morgen".** Die Zaehler laufen rollierend ueber 24 Stunden
(`created_at > now - 86400000`), nicht nach Kalendertag - "morgen" stimmte nie.
`naechsterPlatz()` liest den aeltesten gezaehlten Eintrag und rechnet 24 Stunden
drauf, `zeitSatz()` formatiert das in Europe/Vienna, weil der Server in UTC
laeuft. Ergebnis: "Ab 16:42 Uhr ist wieder eine frei." bzw. "Morgen ab 09:15 Uhr
ist wieder eine frei."

**Jeder Text fuehrt irgendwohin.** Bei der Domain-Grenze ein Knopf zum Anmelden,
bei der Konto-Grenze ein Knopf zur bestehenden Woche (nur wenn es eine gibt).

| Fall | Alt | Neu (ohne den angehaengten Zeitsatz) |
| --- | --- | --- |
| IP | Von deinem Anschluss wurden heute schon mehrere Vorschauen erstellt. Bitte versuche es morgen noch einmal oder melde dich mit deinem bestehenden Konto an. | Aus deinem Netzwerk sind heute schon mehrere Vorschauen entstanden. Wenn ihr zu mehreren im selben WLAN sitzt, zaehlt das zusammen. Eine Website, die heute schon einmal gelesen wurde, geht trotzdem sofort durch. |
| Domain | Fuer diese Website wurde heute schon eine Vorschau erstellt. Melde dich mit der E-Mail-Adresse an, die du dabei verwendet hast. | Fuer diese Website sind heute schon Vorschauen entstanden. War eine davon von dir, kommst du ueber "Anmelden" direkt zu ihr. |
| Konto | Mehr als 3 Vorschauen pro Tag sind fuer ein Konto nicht vorgesehen. Bitte morgen noch einmal. | Fuer dieses Konto sind heute schon mehrere Vorschauen entstanden. Deine bisherige Woche bleibt bestehen. |
| Global | Heute sind alle Vorschau-Plaetze vergeben. Bitte versuche es morgen noch einmal - oder bestaetige deine E-Mail-Adresse, dann geht es sofort weiter. | Heute sind alle Vorschauen vergeben, die wir pro Tag einplanen. Das liegt an uns, nicht an dir. Dein Konto bleibt bestehen, du musst nichts noch einmal eingeben. |

Der alte globale Text war nicht nur unschoen, sondern **falsch**: die globale
Grenze gilt auch fuer bestaetigte Konten, eine Bestaetigung hat daran nie etwas
geaendert. `scripts/start-quota.test.ts` und `scripts/test-start.mjs` verbieten
diesen Satz jetzt ausdruecklich.

Geaenderte Dateien: `src/panel/start-quota.ts`, `src/panel/start-routes.ts`,
`public/panel/start/start.js`, `public/panel/start/start.css`,
`scripts/start-quota.test.ts`, `scripts/test-start.mjs`.

## Teil B: Ausnahme fuer eigenes Konto und Demos (Vorschlag, NICHT gebaut)

### Welcher Deckel wirklich zuschlaegt

| Deckel | Grenze | Variable |
| --- | --- | --- |
| pro Konto | 3 / Tag | PANEL_PREVIEW_PER_ACCOUNT_DAY |
| pro IP | 3 / Tag | PANEL_PREVIEW_PER_IP_DAY |
| pro Domain | 2 / Tag | PANEL_PREVIEW_PER_DOMAIN_DAY |
| global | 40 / Tag | PANEL_PREVIEW_GLOBAL_DAY |

Der Konto-Deckel wird **vor** dem Domain-Zwischenspeicher geprueft
(`start-routes.ts`). Deshalb hilft es nicht, dieselbe Website noch einmal
einzugeben, obwohl die dann nichts mehr kostet. Genau das hat Paul beim Testen
ausgesperrt.

Fuer eine Vorfuehrung kommt dazu: dort zeigt man den Weg eines **neuen** Kunden,
legt also jedes Mal ein neues Konto an. Eine Ausnahme nur fuer Pauls Konto hilft
dann nicht, und nach drei Durchlaeufen greift der IP-Deckel - im Konferenz-WLAN
sitzt das Publikum auf derselben Adresse.

### Vorschlag

1. **`PANEL_PREVIEW_EXEMPT_EMAILS`** (Komma-Liste) in
   `/root/staging.ecosystem.json`, neben den OAuth-Werten. Wer darauf steht,
   laeuft an allen vier Deckeln vorbei. Keine DB-Migration, nichts im Repo.
   Aufwand ca. 30 Minuten.
2. **`PANEL_DEMO_KEY`** in derselben Datei. `…/start/?demo=<schluessel>` setzt
   ein Kennzeichen im Browser (8 h). Solange es gilt, greift kein Deckel, egal
   wie viele Konten in der Zeit entstehen. Jede so entstandene Vorschau wird als
   `kind='demo'` in `start_previews` geschrieben (Kosten bleiben sichtbar und
   trennbar), plus ein eigenes Tagesbudget fuer den Demo-Weg, damit ein
   weitergegebener Link keine Rechnung produziert. Aufwand ca. 2-3 Stunden.

Kosten sprechen nicht dagegen: ein Durchlauf mit erkannten Markenfarben kostet
0,017 EUR (Verlaufsbilder entstehen lokal, fal.ai wird nicht gefragt). Bei
immer derselben Demo-Website kommt die Analyse aus dem Zwischenspeicher und es
kostet praktisch nichts. 50 Vorfuehrungen liegen unter einem Euro.

### Was ich nicht machen wuerde

- Die allgemeinen Grenzen anheben. Sie sind der einzige Schutz davor, dass ein
  unbestaetigtes Konto Kosten verursacht.
- Eine IP freischalten. Die Adresse des Veranstaltungsorts kennt man vorher
  nicht, und wenn doch, teilt man sie mit dem Publikum.

### Offene Frage

Mit freigeschaltetem eigenem Konto springt der Ablauf beim zweiten Durchlauf
direkt zur fertigen Woche (409 `ready`), statt sie neu zu erzeugen. Das ist eine
andere Sperre als das Tageslimit. Soll der Demo-Modus die auch aufheben, also
die bestehende Woche verwerfen und neu bauen? Das waere eine Loeschung, deshalb
Pauls Entscheidung.
