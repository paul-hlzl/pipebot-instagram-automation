# Sofort-Trigger fuer die Kunden-Loop-Routine (Panel-Aufgabe "Teil A")

Ergaenzung zu `docs/ROUTINE_TEIL1.md` (K1-K9-Routine). Betrifft nur, WANN die Routine laeuft,
nicht was sie tut - der Prompt/die K1-K9-Schritte bleiben unveraendert.

## Ausgangslage

Bisher hat die "Pipeline Kunden-Loop"-Routine (`trig_01KbzBBGocL97GzzMJah39Lx`) nur einen
Zeitplan-Trigger (`43 * * * *`, stuendlich). Klickt ein Kunde "Jetzt posten" oder gibt einen
vorbereiteten Beitrag frei, dauert es bis zu 60 Minuten, bis die Routine das aufgreift.

## Recherche-Ergebnis (verifiziert gegen die offizielle Doku, nicht geraten)

Der vermutete Mechanismus existiert tatsaechlich, exakt wie in der Aufgabenstellung
beschrieben - **API-Trigger fuer Routinen**, offiziell dokumentiert unter
<https://code.claude.com/docs/en/routines#add-an-api-trigger> und
<https://platform.claude.com/docs/en/api/claude-code/routines-fire> (Stand 2026-09-12, als
"experimentell"/"research preview" gekennzeichnet).

- Ein Routine kann mehrere Trigger gleichzeitig haben (Zeitplan + API + GitHub) - additiv, der
  bestehende Stunden-Zeitplan bleibt unveraendert bestehen.
- Ein API-Trigger gibt der Routine eine eigene HTTP-URL
  (`POST https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire`) plus einen
  eigenen Bearer-Token (`sk-ant-oat01-...`), der NUR diese eine Routine ausloesen kann (kein
  Lesezugriff, kein Zugriff auf andere Routinen oder Kontodaten - siehe "Authentication" in der
  Platform-Doku).
- Aufruf: `Authorization: Bearer <token>` + `anthropic-beta: experimental-cc-routine-2026-04-01`
  + `anthropic-version: 2023-06-01`. Optionaler Body `{"text": "..."}` wird nur genutzt, wenn
  der Routine-Prompt explizit darauf verweist (unsere K1-K9-Routine tut das nicht - der Aufruf
  laeuft daher ohne Body, loest einfach einen normalen Durchlauf aus).
- Antwort bei Erfolg: neue Session-ID + Session-URL, kein Warten auf das Ergebnis.

## Wichtige Einschraenkung, die die Aufgabenstellung nicht kannte

**Der Bearer-Token kann NICHT ueber eine API/dieses Panel/RemoteTrigger selbst erzeugt werden.**
Aus der Doku (auch durch einen echten Blick in unser eigenes Routine-Objekt via `RemoteTrigger
get` bestaetigt: `api_token_hint` existiert als Feld, ist aber bei allen unseren Routinen aktuell
leer): *"There is no public API for token management."* Das Erzeugen/Rotieren/Widerrufen des
Tokens geht nur manuell im Web-UI unter claude.ai/code/routines. Deshalb konnte ich diesen einen
Schritt nicht selbst erledigen (anders als K3b in der letzten Sitzung, das direkt per
`RemoteTrigger update` ging) - das ist der einzige manuelle Schritt, der bei Paul liegt (siehe
unten).

## Was Paul einmalig manuell tun muss

1. https://claude.ai/code/routines oeffnen, "Pipeline Kunden-Loop" anklicken, Stift-Icon
   ("Edit routine").
2. Runter zu "Select a trigger" -> "Add another trigger" -> "API" auswaehlen.
3. Die angezeigte URL kopieren (enthaelt die Routine-ID, sieht aus wie
   `https://api.anthropic.com/v1/claude_code/routines/trig_01KbzBBGocL97GzzMJah39Lx/fire`).
4. "Generate token" klicken, den Token (`sk-ant-oat01-...`) SOFORT kopieren - er wird nur
   dieses eine Mal angezeigt.
5. Beides in `.env` eintragen (Beispiel in `.env.example`):
   ```
   ROUTINE_TRIGGER_URL=https://api.anthropic.com/v1/claude_code/routines/trig_.../fire
   ROUTINE_TRIGGER_TOKEN=sk-ant-oat01-...
   ```
6. `pm2 restart instagram-mcp` (liest `.env` nur beim Start neu ein).

Ohne diese zwei Werte ist der neue Code ein reines No-op - alles verhaelt sich exakt wie vorher
(Bearbeitung beim naechsten stuendlichen Lauf), kein Fehler, kein Absturz.

## Serverseitige Umsetzung

`src/panel/routine-trigger.ts`, `triggerRoutineNow(reason)` - fire-and-forget (4s Timeout,
Fehler werden nur geloggt, nie geworfen), aufgerufen NACH erfolgreichem Speichern in:
- `POST /panel/api/post-now`
- `POST /panel/api/approvals/:id/approve` ("Freigeben" im "Wartet auf Ihre Freigabe"-Bereich)
- `POST /panel/api/planned-posts/:id/approve` ("Jetzt schon freigeben" in der Vorschau)

**Cooldown von 15 Sekunden** (in-memory, pro Prozess): mehrere Klicks kurz hintereinander (z. B.
mehrere Freigaben) loesen nur einen zusaetzlichen Lauf aus, nicht einen pro Klick - ein Lauf
verarbeitet ohnehin ALLE faelligen Kunden/Kanaele in einem Durchgang, ein zweiter waehrenddessen
haette meist nichts mehr zu tun, wuerde aber unnoetig gegen das taegliche Routine-Kontingent
zaehlen (siehe naechster Abschnitt).

## Bekannte Grenzen (bewusst in Kauf genommen, nicht uebersehen)

- **Kein Idempotenz-Schutz auf claude.ai-Seite**: laut Doku erzeugt jeder erfolgreiche
  `/fire`-Aufruf eine neue Session, unabhaengig davon, ob eine andere gerade noch laeuft. Der
  15s-Cooldown mildert das fuer Klicks aus demselben Prozess, verhindert aber nicht jeden
  theoretischen Overlap (z. B. wenn der stuendliche Zeitplan-Trigger zufällig fast gleichzeitig
  feuert). Unkritisch: die Routine selbst ist idempotent (K1-K3b markieren Eintraege sofort als
  erledigt), zwei parallele Laeufe wuerden sich hoechstens gegenseitig nichts mehr zu tun lassen.
- **Taegliches Routine-Kontingent**: laut Doku zaehlen Sofort-Ausloesungen gegen ein
  Tages-Limit pro Account (Groesse variiert je nach Plan, sichtbar unter
  claude.ai/code/routines). Bei sehr vielen Kunden mit haeufigen Freigaben koennte das Limit
  theoretisch erreicht werden - dann liefert `/fire` einen 429 zurueck, der hier nur geloggt
  wird (Kunde merkt nichts, naechster stuendlicher Lauf greift wie bisher). Bitte das Limit im
  Auge behalten, falls die Kundenzahl deutlich waechst.
- **Kein Race-Schutz zwischen "gerade gespeichert" und "Routine liest schon"**: wenn zwei
  Freigaben knapp innerhalb des 15s-Fensters passieren, kann es sein, dass die zweite erst vom
  naechsten (stuendlichen oder erneut ausgeloesten) Lauf erfasst wird, nicht vom allerersten
  Sofort-Lauf. In der Praxis normalerweise trotzdem "in wenigen Minuten", nicht bis zu 60.
- Der `/fire`-Endpunkt ist als "experimentell"/"research preview" gekennzeichnet - Anthropic
  kann Verhalten/Limits/Header-Version aendern (mit Uebergangsfrist ueber neue
  `anthropic-beta`-Datumsversionen).
