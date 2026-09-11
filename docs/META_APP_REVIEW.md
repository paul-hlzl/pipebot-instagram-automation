# Vorbereitung Meta App Review

**Status: Vorbereitung/Entwurf.** Nichts hieraus wurde bei Meta eingereicht. Vor dem
tatsächlichen Einreichen bitte die Checkliste unten durchgehen und die Platzhalter (Domain,
E-Mail, Firmendaten) prüfen.

Betroffene Berechtigungen: `instagram_business_basic`, `instagram_business_content_publish`.

---

## 1. Nutzungsbeschreibung je Berechtigung

Meta verlangt für jede beantragte Berechtigung eine konkrete Beschreibung, wozu die App sie
braucht ("How will your business use this permission?"). Vorschlag:

### `instagram_business_basic`

**Deutsch:**
> Pipeline liest über diese Berechtigung ausschließlich Basisdaten des professionellen
> Instagram-Kontos, das ein Kunde selbst in unserem Kunden-Panel verbunden hat: Konto-ID,
> Kontoname und die letzten eigenen Beiträge (Bildunterschrift, Medientyp, Datum). Diese Daten
> werden genutzt, um (a) die Verbindung im Panel korrekt anzuzeigen und (b) neue, automatisch
> erstellte Beiträge im bestehenden Tonfall des Kunden zu formulieren. Es werden keine Daten
> anderer Instagram-Konten, keine Follower- oder Insights-Daten und keine Daten außerhalb des
> vom Kunden selbst verbundenen Kontos gelesen.

**English:**
> Pipeline uses this permission strictly to read basic data of the professional Instagram
> account a customer has connected themselves in our customer panel: account ID, account name,
> and their own most recent posts (caption, media type, date). This data is used to (a) show
> the connection status correctly in the panel and (b) draft new, automatically generated posts
> that match the customer's existing tone of voice. No data from any other Instagram account,
> no follower or insights data, and no data outside the account the customer themselves
> connected is ever read.

### `instagram_business_content_publish`

**Deutsch:**
> Pipeline veröffentlicht im Auftrag des Kunden automatisch erstellte Beiträge (Bild-Feed-Posts
> und Storys) auf dem professionellen Instagram-Konto, das der Kunde im Panel verbunden hat.
> Die Veröffentlichung geschieht nach einem vom Kunden im Panel festgelegten Rhythmus
> (z. B. werktags um 15:00 Uhr) oder über eine manuelle Freigabe. Der Kunde sieht jeden
> veröffentlichten Beitrag im Panel unter "Verlauf" und kann die Verbindung jederzeit selbst
> trennen, wodurch keine weiteren Veröffentlichungen mehr stattfinden.

**English:**
> Pipeline publishes automatically generated posts (image feed posts and stories) on behalf of
> the customer to the professional Instagram account they connected in our panel. Publishing
> happens on a schedule the customer configures in the panel (e.g. weekdays at 15:00) or via
> manual approval. The customer can see every published post in the panel's "Verlauf" (history)
> tab and can disconnect the account themselves at any time, which immediately stops any further
> publishing.

---

## 2. Skript für das Screencast-Video

Meta verlangt ein Video, das den kompletten Nutzungsfluss zeigt. Vorschlag für den Ablauf
(ca. 3-5 Minuten, Bildschirmaufnahme des Panels unter `https://mcp.pipebot.at/panel`):

1. **Signup:** Auf der Panel-Startseite den kurzen Einstieg zeigen ("3 Schritte", Trial-Hinweis),
   dann das Formular mit Beispieldaten eines fiktiven Testunternehmens ausfüllen (Firmenname,
   Branche, Beschreibung, Tonalität) und absenden.
2. **Instagram verbinden:** Im nächsten Schritt auf "Verbinden" bei Instagram klicken, den
   echten Meta-OAuth-Dialog durchlaufen (Login, Auswahl des professionellen Kontos, Bestätigung
   der angezeigten Berechtigungen), zurück im Panel landen und den Status "verbunden" zeigen.
3. **Beitrag wird veröffentlicht:** Zeigen, wie ein Beitrag entsteht und veröffentlicht wird -
   entweder live über die MCP-Tools (`generate_and_publish_post` für den verbundenen Testkunden)
   oder, falls das für die Aufnahme einfacher ist, einen bereits zuvor ausgelösten Beitrag im
   Instagram-Konto selbst zeigen (kurz zur echten Instagram-App/-Website wechseln).
4. **Kunde sieht ihn im Verlauf:** Zurück im Panel, Tab "Verlauf" öffnen, den soeben
   veröffentlichten Beitrag mit Bild, Bildunterschrift und Zeitstempel zeigen.
5. **Verbindung trennen:** Im Panel unter "Ihr Unternehmen"/Kanalübersicht bei Instagram auf
   "Trennen" klicken, den Bestätigungsdialog bestätigen, zeigen dass der Status danach
   "nicht verbunden" ist - und erwähnen, dass ab diesem Zeitpunkt nichts mehr veröffentlicht wird.
6. *(Optional, zeigt gute Praxis für Datenlöschung):* Kurz das "Konto und Daten löschen" im
   Kunden-Bereich zeigen, ohne es für den Demo-Account tatsächlich auszuführen, oder mit einem
   eigens dafür angelegten Wegwerf-Testkonto.

**Hinweis:** Für die Aufnahme einen echten, eigens für den Review angelegten Test-Account
verwenden (nicht den Produktions-/Verkaufs-Account), damit reale Kundendaten nirgends im Video
auftauchen.

---

## 3. Checkliste Voraussetzungen

- [ ] **Datenschutzerklärung-URL** öffentlich erreichbar und bei Meta hinterlegt (siehe
      `docs/DATENSCHUTZ_ENTWURF.md` - **muss erst rechtlich geprüft und dann echt veröffentlicht
      werden**, aktuell nur Entwurf, nirgends verlinkt).
- [ ] **Datenlöschungs-Anleitung** ("Data Deletion Instructions") - kann auf den
      Selbstbedienungs-Weg im Panel verweisen: eingeloggter Kunde → "Konto und Daten löschen"
      (`DELETE /panel/api/me`, in dieser Sitzung bereits gebaut, siehe Aufgabe 11 im
      Fortschrittsbericht). Meta akzeptiert auch einen Data-Deletion-Callback-Endpunkt statt
      einer reinen Anleitungs-URL - aktuell ist nur der manuelle Weg im Panel vorhanden.
- [ ] **App-Icon** (1024×1024, von Meta gefordertes Format) - noch nicht vorhanden, muss erstellt
      werden.
- [ ] **Unternehmensverifizierung** ("Business Verification") bei Meta abgeschlossen für den
      Account/die Organisation, die die App besitzt.
- [ ] **App-Datenschutzerklärung-Feld** und **Nutzungsbedingungen-URL** im Meta App Dashboard
      ausgefüllt.
- [ ] **Testdaten/Testzugang** für die Meta-Reviewer vorbereiten (ein funktionierender
      Test-Account inkl. Zugangsdaten, falls Meta danach fragt).
- [ ] Screencast-Video (siehe Skript oben) aufgenommen und hochgeladen.
- [ ] Beide Nutzungsbeschreibungen (oben) ins App-Review-Formular übertragen.

**Nicht Teil dieser Sitzung:** das eigentliche Einreichen beim Meta App Review - das ist ein
manueller Schritt im Meta-Entwicklerportal, den nur du (mit Zugriff auf die Meta Business
Suite) machen kannst.
