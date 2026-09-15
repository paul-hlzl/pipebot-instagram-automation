# Vorbereitung LinkedIn Community Management API

**Status: Vorbereitung/Entwurf.** Nichts hieraus wurde bei LinkedIn eingereicht. Der Antrag ist
**vor der OG-Gründung nicht sinnvoll stellbar** (siehe Abschnitt 1) - dieses Dokument ist Vorarbeit
für danach, keine Aufforderung, jetzt schon einzureichen.

Faktencheck gegen LinkedIns aktuelle Dokumentation (Microsoft Learn, Stand 15.09.2026) - siehe
Session-Bericht für die vollständige Recherche und Quellen.

---

## 0. Warum wir das überhaupt brauchen

Alles, was über reines Text-/Bild-Posten (`w_member_social`, self-service, bereits vorhanden)
hinausgeht, sitzt hinter der Community Management API:

- **Member Post Analytics** (`r_member_postAnalytics`) - Follower-/Engagement-Zahlen für den
  LinkedIn-Tab im Panel (siehe `linkedin-analytics.ts`, bereits gebaut und getestet, wartet nur
  auf diese Freigabe).
- **Dokument-Beiträge (PDF-Karussell)** - per Faktencheck bestätigt: geht **nicht** über
  `w_member_social` allein, egal ob der Dokument-Eigentümer eine Person- oder Organisations-URN
  ist. Documents API und Posts API liegen beide unter demselben
  `marketing/community-management/...`-Pfad wie alles andere Partnerprodukt - die self-service
  "Share on LinkedIn"-Seite dokumentiert ausschließlich die alten `/v2/ugcPosts`/`/v2/assets`-
  Endpunkte (Text/Bild/Artikel, kein Dokument-Support). Damit entfällt der ursprünglich geplante
  PDF-Karussell-Auftrag vorerst - sobald diese Freigabe steht, ist er ein separater, kleiner
  Folgeauftrag (die Karussell-Slide-Generierung aus v14 existiert bereits und kann wiederverwendet
  werden).
- **Programmatic refresh tokens** (kein 60-Tage-Ablauf mehr) - laut Microsoft Learn nur für
  freigegebene Marketing Developer Platform-Partner verfügbar, derselbe Freigabe-Pfad.

## 1. Voraussetzungen

| Voraussetzung | Unser Stand |
|---|---|
| Eingetragenes Rechtssubjekt (LinkedIn nennt explizit LLC/Corporation/vergleichbar - **keine** Einzelentwickler/unregistrierte Projekte) | **Fehlt.** Einzelunternehmen ist riskant, OG ist die saubere Lösung. **Der Antrag ist ohne eingetragene Gesellschaft nicht sinnvoll stellbar.** |
| Verifizierte LinkedIn-Unternehmensseite, von einem Super-Admin bestätigt | Vorhanden - Pipeline AI Solutions, Company-ID 144956099 |
| Geschäftliche E-Mail-Adresse (private E-Mail wird abgelehnt, Verifizierungsmail beachten - auch Spam/Promotions-Ordner prüfen) | Vorhanden - office@pipeline-solutions.at |
| Firmenname, eingetragene Adresse, Website, Datenschutzerklärung | Teilweise - Datenschutzerklärung liegt nur als Entwurf vor (`DATENSCHUTZ_ENTWURF.md`), muss vor Antrag finalisiert sein (wird auch für Meta gebraucht) |
| **Neue, leere** Entwickler-App (keine anderen API-Produkte) | Fehlt - die bestehende App hat bereits "Share on LinkedIn" + "Sign In with LinkedIn" |
| App darf "Linked"/"In"/LinkedIn- oder Microsoft-Namen/Logos nicht enthalten | Zu prüfen bei App-Anlage |
| Zweistufige Prüfung: Development Tier → Standard Tier, jeweils eigenes Antragsformular | Noch nicht begonnen |
| Development Tier: Integration muss innerhalb von 12 Monaten nach Zugang abgeschlossen sein | - |
| Standard Tier: Screencast pro Anwendungsfall, hochauflösend, herunterladbar | Noch nicht erstellt |

**Wichtig, laut LinkedIns eigener Dokumentation wörtlich:** *"If your application is rejected,
review the qualifications, create a new app, and submit a new [Development/Standard] tier access
request form. You won't be able to re-apply for [...] access with your existing app."* - eine
abgelehnte App ist verbrannt, nicht nachbesserbar. Deshalb: alle Voraussetzungen unten VOR dem
ersten Antrag prüfen, nicht erst danach nachbessern.

## 2. Anwendungsfall für das Antragsformular

Passt am ehesten zu **"Executive Management"** (Posten/Interaktion auf persönlichen Profilen,
nicht auf einer Unternehmensseite) - unser Setup postet für Kunden auf deren eigenem LinkedIn-
Profil, nicht auf einer Company Page. Das bestimmt auch, welches Screencast-Testfall-Set unten
(Abschnitt 4) gilt.

## 3. Was Paul manuell bereitstellen muss

- Rechtsform + Firmenbuchnummer der OG (erst nach Eintragung vorhanden)
- Eingetragene Geschäftsadresse
- Geschäftliche E-Mail (bereits vorhanden: office@pipeline-solutions.at)
- URL der finalisierten Datenschutzerklärung (aktuell nur Entwurf, siehe `DATENSCHUTZ_ENTWURF.md`)
- Bestätigung als Super-Admin der LinkedIn-Unternehmensseite (Pipeline AI Solutions), dass die neue
  App damit verknüpft werden darf
- Kurzbeschreibung des Anwendungsfalls für das Formular (Entwurf unten, Abschnitt 5)

## 4. Screencast-Drehbuch (Standard Tier, erst nach Development-Tier-Freigabe nötig)

Allgemeine Anforderungen (wörtlich aus der Doku):
- Hohe Auflösung, herunterladbar
- Nur die eigenen Bildschirme der Anwendung im Bild (alles andere vorher schließen)
- Narration empfohlen - Prüfer sollen ohne Rückfrage verstehen, was gerade gezeigt wird
- Für jeden im Antragsformular angegebenen Anwendungsfall die zugehörigen Testfälle zeigen

Für **Executive Management** (unser Fall), in dieser Reihenfolge:
1. Ein App-Nutzer (Testkunde im Panel) durchläuft den vollständigen OAuth-Flow und gibt Zugriff
   auf sein LinkedIn-Profil frei.
2. Der Nutzer veröffentlicht über die App einen Beitrag auf seinem persönlichen LinkedIn-Profil
   (z.B. über "Jetzt posten" im Panel).
3. Ein Kommentar eines anderen Mitglieds auf diesen Beitrag wird in der App angezeigt.
4. Welche personenbezogenen Felder des kommentierenden Mitglieds dabei angezeigt werden.
5. Jede weitere Kernfunktion, die personenbezogene LinkedIn-Daten nutzt (Profildaten, Beitrags-/
   Kommentarinhalte usw.) - falls eine der obigen Funktionen (z.B. Kommentare) in der App gar
   nicht existiert, das im Video kurz benennen statt es wegzulassen.

**Hinweis:** Punkt 3/4 oben (Kommentare auf persönlichen Profilen) sind für uns **nicht baubar** -
`r_member_social` ist laut Recherche seit mindestens 2023 geschlossen ("resource constraints"),
keine neuen Anfragen werden angenommen (Stand konnte für 2026 nicht letztgültig verifiziert
werden - vor dem Antrag im Developer Portal gegenprüfen). Das Antragsformular/Screencast muss das
entsprechend so benennen ("diese Funktionalität ist nicht Teil unserer Anwendung"), statt sie
vorzutäuschen.

## 5. Entwurf: Beschreibung des Anwendungsfalls

**Deutsch:**
> Pipeflow erstellt und veröffentlicht im Auftrag unserer Kunden automatisch Social-Media-
> Beiträge auf deren eigenem, persönlichem LinkedIn-Profil (kein Zugriff auf fremde Profile oder
> Unternehmensseiten Dritter). Zusätzlich zeigen wir dem Kunden im eigenen Kunden-Panel
> Leistungskennzahlen (Impressionen, Reichweite, Reaktionen, Kommentare, Reposts) zu seinen
> eigenen veröffentlichten Beiträgen, damit er nachvollziehen kann, wie seine Beiträge performen.

**English:**
> Pipeflow generates and publishes social media posts on behalf of our customers to their own
> personal LinkedIn profile (no access to other members' profiles or third-party company pages).
> We additionally show the customer performance metrics (impressions, reach, reactions, comments,
> reshares) for their own published posts inside our customer panel, so they can see how their
> posts are performing.

## 6. Nach Freigabe - was sofort aktiviert werden kann

- `linkedin-analytics.ts` ist bereits fertig implementiert und getestet (`npm run
  test:linkedin-analytics`) - Aktivierung ist eine Änderung in `analytics.ts`s
  `runDailyAnalyticsSnapshot` (ein zusätzlicher Fetch-Aufruf pro LinkedIn-verbundenem Kunden),
  keine neue Entwicklung.
- Panel zeigt den LinkedIn-Analytics-Tab bereits an (aktuell mit Erklärtext statt Zahlen, siehe
  `analyticsBodyHtml`) - schaltet automatisch auf echte Zahlen um, sobald `available` für den
  Kanal `true` liefert.
- PDF-Karussell-Beiträge (Abschnitt 0) sind ein separater, danach neu zu planender Auftrag.
