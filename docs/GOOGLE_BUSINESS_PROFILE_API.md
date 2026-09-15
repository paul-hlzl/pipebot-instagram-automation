# Vorbereitung Google Business Profile API (Google-Bewertungen)

**Status: Vorbereitung/Entwurf.** Nichts hieraus wurde bei Google eingereicht. Der Antrag ist
**ohne ein eigenes, seit mindestens 60 Tagen verifiziertes Google-Unternehmensprofil nicht
sinnvoll stellbar** (siehe Abschnitt 0) - dieses Dokument ist die Vorarbeit für danach.

Faktencheck-Stand: **15.09.2026.** Quellen und die Grenzen dieser Recherche stehen in
Abschnitt 8 - bitte dort lesen, bevor jemand einen Punkt hier für in Stein gemeißelt hält.

---

## 0. Der limitierende Faktor zuerst

Alles andere in diesem Dokument hängt an **einer** Voraussetzung:

> Der Antragsteller muss ein **verifiziertes Google-Unternehmensprofil** verwalten, das **seit
> mindestens 60 Tagen aktiv** ist, plus eine zugehörige Unternehmens-Website.

Nach allem, was sich von hier aus prüfen ließ, hat **Pipeline AI Solutions / pipebot.at aktuell
kein solches Profil** (siehe Abschnitt 7: wie das geprüft wurde und was diese Prüfung nicht
abdeckt). Damit gilt:

1. **Heute Profil anlegen und verifizieren** (Postkarte/Telefon/E-Mail/Video, je nach Kategorie -
   die Postkarte dauert in Österreich üblicherweise 1-2 Wochen).
2. **60 Tage warten.** Diese Frist lässt sich durch nichts abkürzen; ein zu junges Profil führt
   laut mehreren übereinstimmenden Praxisberichten zur direkten Ablehnung des Antrags.
3. **Dann erst** den API-Antrag stellen (Abschnitt 2), Bearbeitung nochmals ca. 2 Wochen.

**Realistischer frühester Zeitpunkt für einen funktionierenden API-Zugang: rund drei Monate ab
Profilanlage** (2 Wochen Verifizierung + 60 Tage Wartefrist + ~2 Wochen Antragsbearbeitung, ohne
Nachreichungen). Erst danach lässt sich irgendetwas an dieser Anbindung mit echten Daten testen.

**Eine mögliche Abkürzung, ungeprüft:** In mindestens einer Quelle heißt es, es genüge, ein
verifiziertes Profil zu **verwalten** - "das eigene Büro **oder das eines Kunden**". Falls das
stimmt, könnte ein bestehender Kunde mit altem, verifiziertem Profil, der Pipeline als Verwalter
einträgt, die 60-Tage-Wartefrist ersetzen. Das ließ sich gegen Googles eigene Dokumentation
**nicht** verifizieren (Abschnitt 8) und sollte vor einem Antragsversuch geklärt werden - ein
abgelehnter Antrag kostet eine weitere Runde Bearbeitungszeit.

---

## 1. Was technisch gebraucht wird (und was nicht)

Google hat die alte "Google My Business API v4.9" in **acht** einzelne APIs zerlegt. Für die
Bewertungs-Automatisierung sind davon nur diese relevant:

| API | Wozu | Basis-URL |
|---|---|---|
| **My Business Account Management API** | Das Unternehmensprofil-Konto ermitteln, an dem alles hängt (`accounts/{id}`) | `mybusinessaccountmanagement.googleapis.com/v1` |
| **My Business Business Information API** | Die Filialen/Standorte des Kontos auflisten | `mybusinessbusinessinformation.googleapis.com/v1` |
| **Google My Business API (v4)** | **Bewertungen lesen und beantworten** | `mybusiness.googleapis.com/v4` |
| *(optional, später)* **My Business Notifications API** | Push statt Polling bei neuen Bewertungen | `mybusinessnotifications.googleapis.com/v1` |

**Wichtig und leicht zu übersehen:** Bewertungen sind als einziger Bereich **nie** auf eine neue
v1-API migriert worden. `accounts.locations.reviews.list` und
`accounts.locations.reviews.updateReply` liegen bis heute auf der alten **v4**-API. Wer in der
Cloud Console nach einer "Reviews API" sucht, findet keine - freigeschaltet wird die
**"Google My Business API"**.

Nicht gebraucht (und bewusst nicht angebunden): Local Posts, Verifications, Place Actions,
Performance, Q&A. Die Q&A-API ist zudem seit 03.11.2024 eingestellt.

**Kosten:** Die APIs selbst sind kostenlos, es gibt kein Abrechnungskonto und kein Kontingent, das
Geld kostet. Ein Kosten-Tracking wie bei fal.ai/Anthropic braucht es dafür also nicht - was bei
diesem Feature Geld kostet, sind ausschließlich die Anthropic-Aufrufe (eine Antwort pro Bewertung)
und, falls das Content-Recycling eingeschaltet ist, die fal.ai-Bildgenerierung pro erzeugtem
Beitragsvorschlag. Beides läuft bereits über das bestehende `usage_costs`-Tracking
(`review-reply` / `review-post`).

---

## 2. Der Zugangsprozess

Der entscheidende Punkt, der das von Instagram/LinkedIn unterscheidet: **jedes neue
Google-Cloud-Projekt startet mit einem Kontingent von 0 Anfragen pro Minute.** Die APIs lassen
sich in der Console zwar aktivieren, liefern aber bei jedem Aufruf einen Fehler, bis Google den
Antrag freigegeben hat. Es gibt keinen Testmodus, keine Sandbox und keinen "es geht nur langsamer"-
Zustand - vorher geht gar nichts.

Ablauf:

1. **Google-Cloud-Projekt** anlegen (oder ein bestehendes wählen) und die **Projektnummer**
   notieren - sie wird im Antrag abgefragt.
2. **APIs aktivieren** (API-Bibliothek der Cloud Console): Google My Business API, My Business
   Account Management API, My Business Business Information API. (Google empfiehlt, gleich alle
   acht zu aktivieren; nötig sind für uns diese drei.)
3. **OAuth-Zustimmungsbildschirm** konfigurieren (Nutzertyp "Extern"), App-Name, Support-E-Mail,
   Logo, Links zu **Datenschutzerklärung und Nutzungsbedingungen**, autorisierte Domain.
4. **OAuth-Client** (Typ "Webanwendung") anlegen, als autorisierte Weiterleitungs-URI eintragen:
   `https://mcp.pipebot.at/panel/callback/google` (Sandbox zusätzlich:
   `https://mcp.pipebot.at/panel/sandbox/callback/google`).
5. **Antrag stellen:** GBP-API-Kontaktformular öffnen, im Auswahlmenü **"Application for Basic API
   Access"** wählen, alle Felder ausfüllen (Projektnummer, Anwendungsfall, Website).
   - **Mit dem Google-Konto anmelden, das INHABER des Unternehmensprofils ist**, nicht mit einem
     Konto, das nur Verwalter-Rechte hat - Anträge von Verwalter-Konten werden laut mehreren
     Berichten abgewiesen.
6. **Warten.** Offiziell 14 Tage, praktisch oft länger, meist mit ein bis zwei Rückfragen.
7. Nach Freigabe: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in die `.env` eintragen (siehe
   `.env.example`) und neu starten - erst dadurch taucht der Kanal überhaupt im Panel auf.
8. **OAuth-App veröffentlichen** ("In Produktion"). Solange die App im Testmodus steht, laufen
   Refresh-Tokens nach 7 Tagen ab - jede Kundenverbindung wäre nach einer Woche tot. Eine
   veröffentlichte App mit dem Scope `business.manage` kann außerdem eine Google-Prüfung
   ("Verification") nach sich ziehen; das ist ein zweiter, eigener Prozess.

### Text für das Antragsformular (Vorschlag)

> Pipeline AI Solutions betreibt Pipeflow, ein Panel, über das kleine Unternehmen in Österreich
> ihre Social-Media-Präsenz automatisieren. Kunden verbinden ihr eigenes Google-Unternehmensprofil
> per OAuth selbst. Für diese Profile liest Pipeflow neue Bewertungen und veröffentlicht im Namen
> des Unternehmens Antworten darauf - wahlweise automatisch oder erst nach ausdrücklicher Freigabe
> durch den Kunden im Panel. Es werden ausschließlich Bewertungen und Antworten verarbeitet; an den
> Profildaten selbst (Öffnungszeiten, Adresse, Fotos, Kategorien) nimmt Pipeflow keinerlei
> Änderungen vor. Verarbeitet werden nur Profile, deren Inhaber Pipeflow dafür selbst autorisiert
> haben.

---

## 3. Was Paul manuell bereitstellen/beantragen muss

| # | Was | Warum | Stand |
|---|---|---|---|
| 1 | **Eigenes Google-Unternehmensprofil anlegen und verifizieren** | Harte Antragsvoraussetzung | **Fehlt** (siehe Abschnitt 7) - blockiert alles Weitere |
| 2 | 60 Tage Wartefrist nach der Verifizierung | Harte Antragsvoraussetzung | Läuft erst ab Punkt 1 |
| 3 | Unternehmens-Website, die zum Profil passt | Wird im Antrag geprüft | pipebot.at vorhanden; ob sie inhaltlich zum Profil passt, bitte selbst prüfen |
| 4 | **Veröffentlichte Datenschutzerklärung** auf der Website | Pflicht für den OAuth-Zustimmungsbildschirm und den Antrag | **Nur Entwurf** (`docs/DATENSCHUTZ_ENTWURF.md`, ausdrücklich "nicht veröffentlichen") - muss vorher finalisiert werden. Wird ohnehin auch für Meta und LinkedIn gebraucht |
| 5 | Nutzungsbedingungen/Impressum auf der Website | Wie 4 | Bitte prüfen |
| 6 | Google-Cloud-Projekt + Projektnummer | Antragsfeld | Offen |
| 7 | OAuth-Client + Weiterleitungs-URI (Abschnitt 2, Punkt 4) | Technisch nötig | Offen |
| 8 | Antrag über das GBP-API-Kontaktformular, **als Profil-Inhaber angemeldet** | Der eigentliche Zugang | Offen |
| 9 | OAuth-App auf "In Produktion" setzen | Sonst Refresh-Token nach 7 Tagen tot | Offen |
| 10 | Datenschutzerklärung um Google-Bewertungsdaten ergänzen | Neue Datenkategorie (Bewertungstexte, Namen bewertender Personen) | Offen |

### Zeitrahmen (Schätzung)

| Schritt | Dauer |
|---|---|
| Profil anlegen + Verifizierung (Postkarte) | 1-2 Wochen |
| Wartefrist bis zur Antragsberechtigung | 60 Tage |
| Antragsbearbeitung durch Google | ~2 Wochen, mit Nachreichungen länger |
| OAuth-App-Veröffentlichung/ggf. Prüfung | 1 Tag bis mehrere Wochen |
| **Summe bis zum ersten echten Test** | **realistisch ~3 Monate** |

---

## 4. Was bereits gebaut ist

Die gesamte technische Anbindung liegt fertig im Code und wartet ausschließlich auf die Freigabe:

- `src/panel/providers/google.ts` - OAuth nach demselben Muster wie Instagram/LinkedIn. Der Kunde
  verbindet sein eigenes Google-Konto, ein Scope: `https://www.googleapis.com/auth/business.manage`.
- `src/google-business.ts` - API-Client: Filialen auflisten, Bewertungen lesen, antworten,
  Moderationsstatus auswerten.
- `src/panel/reviews.ts` - die eigentliche Automatisierung (Cron, Antwortlogik, Moderations-
  Nachkontrolle, Content-Recycling).
- `src/anthropic.ts` - `generateReviewReply` (Antworttext) und `generateReviewSocialPost`
  (Beitragsvorschlag aus einer guten Bewertung).
- Panel: zwei getrennte Schalter (Antworten / Beitragsvorschläge), beide standardmäßig **aus**,
  Freigabe-Modus wie bei der Kommentar-Automatik, Freigabe-Karten auf der Übersicht.

**Solange `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` leer sind, ist davon im Panel nichts zu sehen**
(`hiddenUntilConfigured` in `providers/types.ts`) - kein Kunde bekommt einen Kanal angeboten, den
niemand verbinden kann.

---

## 5. Später: Push statt Polling

Die aktuelle Umsetzung fragt alle 60 Minuten nach neuen Bewertungen (`PANEL_REVIEW_CRON_MINUTES`).
Googles **Notifications API** könnte das ersetzen: Sie kennt die Benachrichtigungstypen
`NEW_REVIEW` und `UPDATED_REVIEW` (per Discovery-Dokument vom 13.09.2026 bestätigt) und liefert
dabei `review_name` und `location_name` mit - die Bewertung selbst muss man danach trotzdem über
die v4-API nachladen.

Der Haken, weshalb das **nicht** Teil dieser ersten Version ist: Google stellt nicht wie Meta auf
einen gewöhnlichen HTTPS-Webhook zu, sondern **ausschließlich in ein Google-Cloud-Pub/Sub-Thema**.
Nötig wären dafür:

- ein Pub/Sub-Thema in unserem Cloud-Projekt,
- Veröffentlichungsrechte für Googles Service-Konto
  (`mybusiness-api-pubsub@system.gserviceaccount.com`) auf diesem Thema,
- eine Push-Subscription auf einen eigenen Endpunkt im Panel (inkl. Signaturprüfung),
- **pro Kundenkonto** ein `accounts.updateNotificationSetting`-Aufruf. Achtung: Es gibt **genau
  eine** Benachrichtigungs-Einstellung pro Unternehmensprofil-Konto - wer sie überschreibt, schaltet
  eine eventuell vorhandene andere Integration des Kunden stumm.

Das ist eine eigene, nicht kleine Baustelle, die sich erst nach der Zugangsfreigabe überhaupt
testen lässt. Der Polling-Cron deckt den Anwendungsfall bis dahin vollständig ab (eine Bewertung
innerhalb einer Stunde zu beantworten ist völlig ausreichend - anders als bei Instagram-Kommentaren
gibt es hier keine Erwartung an Sekunden).

---

## 6. Moderation der Antworten

Google prüft Inhaber-Antworten automatisch und kann eine bereits abgeschickte Antwort nachträglich
ablehnen. Dafür gibt es in `ReviewReply` zwei 2026 ergänzte, nur lesbare Felder:
`reviewReplyState` (Moderationsstatus) und `policyViolation` (Begründung bei Ablehnung), abrufbar
über `reviews.get`, `reviews.list` und `locations.batchGetReviews`.

Unsere Umsetzung:

- Nach jedem Versand wird die Bewertung im nächsten Lauf erneut geladen und der Status geprüft.
- Bei einer Ablehnung wird die Bewertung im Panel auf `reply_rejected` gesetzt und der Kunde
  bekommt **genau einmal** eine E-Mail mit der Begründung (gleiches Prinzip wie bei versteckten
  Instagram-Kommentaren - nicht still scheitern).
- Die Auswertung ist bewusst tolerant: Alles, was "REJECT" enthält, gilt als Ablehnung, ein
  vorhandener `policyViolation`-Block ebenfalls; fehlen beide Felder, gilt die Antwort als in
  Ordnung. Grund: Der exakte Wertebereich ließ sich hier nicht gegen Googles Referenz prüfen
  (Abschnitt 8), und eine falsch verschickte "Ihre Antwort wurde abgelehnt"-Mail wäre schlimmer als
  eine, die einmal ausbleibt.

**Das ist der Punkt, der nach der Freigabe als Erstes am eigenen Profil verifiziert gehört:**
Ein Test mit einer absichtlich richtlinienwidrigen Antwort (z.B. mit Telefonnummer oder Rabatt-
Versprechen) zeigt, welchen Wert Google in `reviewReplyState` tatsächlich liefert. Danach kann
`isReplyRejected()` in `src/google-business.ts` von "tolerant" auf "exakt" umgestellt werden.

---

## 7. Prüfung des eigenen Unternehmensprofils (Aufgabe 0)

**Ergebnis: kein Hinweis auf ein verifiziertes Google-Unternehmensprofil für Pipeline AI
Solutions / pipebot.at.**

Wie geprüft wurde: Das Google-Konto `paul.hoelzl1@gmail.com` wurde per Gmail-Suche nach
Unternehmensprofil-Korrespondenz durchsucht (Suchbegriffe: Google Business Profile,
Unternehmensprofil, Google My Business, Absender google.com/business.google.com, Zeitraum 2 Jahre).
Ein verifiziertes Profil erzeugt zwangsläufig Post von Google - Verifizierungscode,
Bestätigungsmail, monatliche Leistungsberichte, Hinweise auf neue Bewertungen. **Nichts davon
existiert.** Die einzige Google-Maps-Mail im Postfach betrifft Pauls eigene *abgegebene* Rezension
zu einem fremden Unternehmen ("Deine Rezension wurde 50-mal aufgerufen", 10.09.2026) - das ist die
Local-Guide-Seite, kein Inhaber-Signal.

**Was diese Prüfung nicht abdeckt:** Ein Profil, das unter einer anderen Adresse läuft (z.B.
`office@pipeline-solutions.at` oder `office@pipebot.at`), wäre hier unsichtbar. Falls es so eines
gibt: Anlagedatum prüfen (Profil → "Profil ist seit ... aktiv") - die 60 Tage laufen ab der
Verifizierung, nicht ab der Anlage.

---

## 8. Faktencheck: Quellen und Grenzen

**Direkt an der Quelle geprüft** (Googles eigene, maschinenlesbare Discovery-Dokumente, abgerufen
am 15.09.2026, Revision jeweils 20260913):

- `mybusinessnotifications.googleapis.com/$discovery/rest?version=v1` - bestätigt die
  Benachrichtigungstypen `NEW_REVIEW`/`UPDATED_REVIEW`, die Pub/Sub-Zustellung, "nur **eine**
  Einstellung pro Konto" und die Methoden `getNotificationSetting`/`updateNotificationSetting`.
- `mybusinessaccountmanagement.googleapis.com/$discovery/rest?version=v1` - bestätigt
  `accounts.list` und die Pfadform `accounts/{id}`.
- `mybusiness.googleapis.com/$discovery/rest?version=v4` antwortet mit **404**. Das ist selbst ein
  Befund: Die Reviews-API liefert kein öffentliches Discovery-Dokument aus, weil sie vollständig
  zugangsbeschränkt ist.

**Nur über Suchergebnisse und Fremdquellen geprüft** (mittelbar, mehrere unabhängige Quellen
stimmen überein): die 60-Tage-Frist, das Kontingent 0/Minute bei neuen Projekten, "Application for
Basic API Access" als Formularauswahl, die Bearbeitungsdauer von ca. 14 Tagen, die Anmeldung als
Inhaber statt Verwalter, die Felder `reviewReplyState`/`policyViolation` samt der Zustände
pending/approved/rejected sowie die Zuordnung der acht Teil-APIs.

**Grenze dieser Recherche - bitte mitlesen:** `developers.google.com` und `support.google.com`
sind aus der Arbeitsumgebung dieser Sitzung heraus **durch die Netzwerk-Richtlinie gesperrt**
(HTTP 403 am Egress-Proxy). Googles offizielle Referenzseiten konnten deshalb **nicht** im
Wortlaut gelesen werden - die Punkte im zweiten Absatz stammen aus Suchergebnis-Zusammenfassungen
und Fremdquellen, nicht aus dem Primärdokument. Für pipebot.at selbst gilt dasselbe: auch die
eigene Website war von hier aus nicht abrufbar, die Angaben zu Punkt 3-5 in Abschnitt 3 sind
deshalb ungeprüft.

**Vor dem Antrag deshalb bitte einmal selbst gegenlesen** (dauert 10 Minuten, verhindert eine
Ablehnung):

- https://developers.google.com/my-business/content/prereqs (Voraussetzungen)
- https://developers.google.com/my-business/content/basic-setup (Projekt/APIs aktivieren)
- https://developers.google.com/my-business/content/review-data (Bewertungen, v4)
- https://developers.google.com/my-business/content/notification-setup (Pub/Sub-Benachrichtigungen)
- https://support.google.com/business/workflow/16726127 (geführter Ablauf "Applying for Google
  Business Profile API access")

Falls sich dabei etwas anders darstellt als hier beschrieben: Das Dokument ist der Stand vom
15.09.2026, nicht das Gesetz. Änderungen bitte hier nachtragen.
