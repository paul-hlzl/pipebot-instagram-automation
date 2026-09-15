# Datenschutzerklärung - ENTWURF

> **Stand 15.09.2026: Dieser Arbeitsentwurf wurde zu `assets/datenschutz.html` ausgebaut und ist
> unter https://mcp.pipebot.at/panel/datenschutz live.** Er stammt aus der Zeit von `panel-v3` und
> ist inhaltlich überholt (es fehlten u. a. Google Text-to-Speech, Cloudflare Turnstile, Hostinger,
> Hetzner, Kommentar- und Bewertungsdaten, Analytics-Momentaufnahmen, Sprachaufnahmen und das
> Kostenprotokoll). Änderungen bitte direkt in `assets/datenschutz.html` vornehmen - diese Datei
> bleibt nur als Ursprungsdokument erhalten.
>
> **Die ausgelieferte Fassung ist weiterhin ein Entwurf in fertiger Form und vor endgültiger
> Verwendung anwaltlich bzw. über die WKO zu prüfen.**

---


## 1. Verantwortlicher

[Platzhalter - Firmenname, Anschrift, Vertretungsberechtigte Person]
Pipeline AI Solutions
Kontakt: office@pipeline-solutions.at

## 2. Welche Daten wir verarbeiten

Beim Anlegen eines Kontos im Kunden-Panel und während der laufenden Nutzung werden folgende
Daten gespeichert:

- **Stammdaten:** Firmenname, Ansprechperson, E-Mail-Adresse, Website (optional), Branche
  (optional).
- **Briefing-Daten für die Beitragserstellung:** frei formulierte Beschreibung des
  Unternehmens/der Themen, gewünschte Tonalität, zu vermeidende Themen, bevorzugter
  Call-to-Action, Akzentfarbe und Beschriftungstext für generierte Bilder, gewünschte
  Kanäle/Formate (Instagram Feed/Story, LinkedIn), Hashtag- und Emoji-Präferenz, Sprache.
- **Zugangsdaten zu Social-Media-Konten:** OAuth-Zugriffstoken (und ggf. Refresh-Token) für die
  vom Kunden selbst verbundenen Instagram- und/oder LinkedIn-Konten. Diese Token werden
  **verschlüsselt** (AES-256-GCM) in der Datenbank gespeichert, nie im Klartext.
- **Nutzungs-/Verlaufsdaten:** Zeitpunkt der Zustimmung, Zeitpunkt der Kontoerstellung/letzten
  Änderung, Status des Kontos (aktiv/pausiert), Verlauf der veröffentlichten Beiträge (Plattform,
  Zeitpunkt, Bildunterschrift, verwendetes Bild).
- **Technische Daten (Login):** ein gehashter Sitzungs-Token (Cookie), keine Klartext-Passwörter
  - der Zugang erfolgt über einen persönlichen Link bzw. eine zufällig erzeugte Login-Kennung.

Wir erheben **keine** besonderen Kategorien personenbezogener Daten (Art. 9 DSGVO) und richten
uns nicht an Kinder.

## 3. Zweck der Verarbeitung

Die Daten werden ausschließlich verarbeitet, um im Auftrag und mit Zustimmung des Kunden
automatisiert Social-Media-Beiträge zu erstellen und auf den vom Kunden selbst verbundenen
Konten zu veröffentlichen, sowie um dem Kunden im Panel Einblick in den Status seiner
Verbindungen und bisherigen Beiträge zu geben.

## 4. Rechtsgrundlage

Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die der Kunde beim Anlegen des Kontos aktiv erteilt
(Checkbox, nicht vorausgewählt) - und Erfüllung des zwischen Kunde und Pipeline bestehenden
Vertrags/der Geschäftsbeziehung (Art. 6 Abs. 1 lit. b DSGVO).

## 5. Empfänger / eingesetzte Dienstleister (Auftragsverarbeitung)

Zur Erbringung der Leistung werden folgende Dienste einbezogen, denen die jeweils nötigen Daten
übermittelt werden:

- **Meta/Instagram Graph API** - zum Lesen der Basisdaten und Veröffentlichen von Beiträgen auf
  dem vom Kunden verbundenen Instagram-Konto.
- **LinkedIn API** - entsprechend für LinkedIn.
- **fal.ai** - Erstellung der Bildhintergründe für Beiträge (erhält keine personenbezogenen
  Kundendaten, nur eine Stilbeschreibung/Farbwert).
- **Cloudflare R2** - Hosting der generierten Bilder, damit Instagram/LinkedIn sie abrufen
  können.
- **Anthropic API** (nur falls vom Kunden über "Mit KI verbessern" genutzt) - erhält Firmenname,
  Branche und die vom Kunden eingegebenen Stichworte, um einen Formulierungsvorschlag zu
  erstellen.

[Platzhalter: für jeden Dienstleister prüfen, ob ein Auftragsverarbeitungsvertrag (AVV) nach
Art. 28 DSGVO nötig/vorhanden ist, und ob eine Übermittlung in Drittländer (USA) zusätzliche
Garantien braucht (Standardvertragsklauseln).]

## 6. Speicherdauer

Die Daten werden gespeichert, solange das Kundenkonto besteht. Der Kunde kann sein Konto
jederzeit selbst und vollständig löschen (siehe Punkt 8) - danach werden alle Stammdaten,
Zugangsdaten und der Beitrags-Verlauf unwiderruflich entfernt.

[Platzhalter: eine maximale Aufbewahrungsdauer für inaktive/nicht gelöschte Konten (z. B. nach
Vertragsende) ist aktuell nicht technisch umgesetzt und sollte festgelegt werden.]

## 7. Datensicherheit

Zugriffstoken für verbundene Social-Media-Konten werden verschlüsselt gespeichert
(AES-256-GCM). Die Verbindung zum Panel erfolgt verschlüsselt (HTTPS). Sitzungs-Cookies sind
`HttpOnly` und `Secure` gesetzt. Der Zugang zum Admin-Bereich ist durch ein separates,
zufällig erzeugtes Passwort mit Rate-Limit gegen Brute-Force-Versuche geschützt.

## 8. Widerruf, Löschung, Betroffenenrechte

- **Kanäle trennen:** Der Kunde kann jede verbundene Plattform (Instagram, LinkedIn) jederzeit
  im Panel selbst trennen - danach wird dort nichts mehr veröffentlicht.
- **Konto und Daten löschen:** Der Kunde kann im Panel unter "Konto und Daten löschen" sein
  gesamtes Konto inkl. aller gespeicherten Daten, Verbindungen und des Beitrags-Verlaufs
  selbst und endgültig löschen.
- **Auskunft, Berichtigung, Einschränkung, Widerspruch:** über office@pipeline-solutions.at.
- **Beschwerderecht:** bei der zuständigen Datenschutz-Aufsichtsbehörde
  [Platzhalter: für Österreich vermutlich die österreichische Datenschutzbehörde -
  Zuständigkeit rechtlich bestätigen lassen].

## 9. Cookies

Es wird ausschließlich ein technisch notwendiges Sitzungs-Cookie gesetzt (Login-Status), keine
Tracking- oder Marketing-Cookies.

---
*(Ende Entwurf)*
