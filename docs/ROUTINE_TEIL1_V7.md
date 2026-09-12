# Bugfix für K3b (Panel v7) - approvalMode-Kunden bekommen den bereits vorbereiteten Beitrag

Dies ist KEINE neue eigenständige Routine und KEIN Ersatztext für `docs/ROUTINE_TEIL1.md`. Es ist
eine präzise Korrektur des bestehenden Routinen-Texts bei claude.ai (Routine "Pipeline
Kunden-Loop", stündlich), K3b-Schritt. Der Rest des Textes (K1-K3, K3b's anderen Zweigen, K4-K9)
bleibt exakt wie er ist - nur der `approvalMode true`-Zweig innerhalb von K3b wurde geändert, plus
ein neuer Status-Fall `submitted` ergänzt.

## Was kaputt war (echtes Kundenfeedback, Andrea Hölzl)

Die nächtliche Vorausplanung (`planning.ts`) bereitet für jeden fälligen Kunden/Kanal/Tag einen
Beitrag vor (Bild + Text), sichtbar/bearbeitbar in "Vorschau". Für einen `approvalMode=true`-
Kunden sollte dieser vorbereitete Beitrag beim Fälligwerden dann in "Wartet auf Ihre Freigabe"
landen - **aber K3b tat das nicht**. Der bisherige Text sagte ausdrücklich:

> approvalMode true: ... Proceed to K4-K8 exactly as before (unchanged behavior: generate a fresh
> post and file it via save_pending_approval, same as if nothing had been pre-planned).

Das bedeutet: der Beitrag, den die Kundin in "Vorschau" schon gesehen (und ggf. bearbeitet) hatte,
wurde beim Fälligwerden **verworfen** und ein **komplett neuer, anderer** Beitrag spontan generiert
und zur Freigabe eingereicht - für die Kundin sah das aus wie ständig neue, unzusammenhängende
Einträge, die nichts mit dem zu tun hatten, was sie in der Vorschau gesehen hatte. Zusätzlich:
doppelte Kosten (1x nachts in der Vorausplanung, 1x nochmal beim Fälligwerden) für denselben Slot.

## Die Korrektur

**Neues Tool `submit_planned_post_for_approval`** (Parameter: `id`, die `id` des planned_post aus
`get_planned_post`). Nimmt den bereits vorhandenen Beitrag (Headline/Caption/Bild, so wie er in
der Vorschau existiert/bearbeitet wurde) und überführt ihn 1:1 in die Freigabe-Warteschlange -
serverseitig identisch zu `save_pending_approval`, aber ohne irgendetwas neu zu generieren. Setzt
danach den planned_post-Status auf `'submitted'`, damit er nicht doppelt eingereicht wird.

**Wohin:** Innerhalb K3b, im Fall `status 'planned' or 'edited'` → `approvalMode true`. Ersetzt
den bisherigen Text (siehe oben) durch:

```
- approvalMode true: this hasn't been reviewed by the customer yet, but it already exists
  (headline/caption/image) - call submit_planned_post_for_approval with this planned post's
  id. This files the EXISTING content into the customer's approval queue exactly as-is - do
  NOT call generate_post_image/generate_story_image, do NOT call save_pending_approval
  yourself, do NOT proceed to K4-K8 at all for this customer/channel. The tool call itself
  handles marking the planned post so it isn't submitted twice. On failure (e.g. the planned
  post was already submitted by an earlier run), treat it like any other K9 case - skip and
  continue, do not retry differently than usual.
```

**Neuer Status-Fall**, direkt danach eingefügt (vorher gab es keinen `'submitted'`-Fall):

```
- status 'submitted': this was already filed into the customer's approval queue on an
  earlier run via submit_planned_post_for_approval - do NOT regenerate, do NOT resubmit,
  treat it exactly like 'rejected' (skip, move on). It now lives in the approval queue
  (list_approved_pending_posts / K1 handles it from here once the customer approves it).
```

Der `approvalMode false`-Zweig (direkt veröffentlichen mit vorhandenem Bild/Text) und der
`status 'approved'`-Zweig (Kunde hat in der Vorschau schon vorab freigegeben) waren bereits
korrekt und bleiben unverändert.

## Warum kein K0/eigener Schritt, sondern innerhalb K3b

Exakt dieselbe Begründung wie beim ursprünglichen K3b-Einbau (siehe `docs/ROUTINE_TEIL1_V5.md`):
der Check braucht K3's "ist dieser Kunde/Kanal heute fällig"-Information und muss an der Stelle
sitzen, an der sonst K4-K8 ausgelöst würde, um diese zuverlässig zu verhindern.

## Kosten-Auswirkung

Für `approvalMode=true`-Kunden entsteht jetzt nur noch **eine** Generierung pro fälligem
Slot (nachts in der Vorausplanung), nicht mehr zwei (nachts + nochmal beim Fälligwerden) - siehe
`docs/PANEL_V7_REPORT.md` für die konkrete Neueinschätzung. Das war in der ursprünglichen
Kostenrechnung in `docs/PANEL_V5_REPORT.md` als "echte Mehrkosten" für approvalMode-Kunden
explizit benannt ("dort ist die Vorausplanung also tatsächlich zusätzliche Kosten, keine
Verschiebung") - dieser Fix behebt genau das.

## Status

Live in die Routine eingespielt (Commit-Referenz siehe `docs/PANEL_V7_REPORT.md`), per
`RemoteTrigger get` direkt danach verifiziert (Diff gegen den vorherigen Stand geprüft - nur
dieser eine Absatz + der neue `submitted`-Fall haben sich geändert, alles andere zeichengleich).
`docs/ROUTINE_TEIL1.md` ist entsprechend nachgezogen und entspricht dem echten Live-Stand.
