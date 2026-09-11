# Ergänzung für die Kunden-Loop-Routine (K1-K9) - Panel v5, Aufgabe 6

Dies ist KEINE neue eigenständige Routine und KEIN Ersatztext für `docs/ROUTINE_TEIL1.md`.
Es ist eine präzise Ergänzung, die du manuell in den bestehenden Routinen-Text bei claude.ai
einfügst (Routine "Pipeline Kunden-Loop", stündlich). Der Rest des Textes (K1, K2, K4-K9)
bleibt exakt wie er ist - nur EIN neuer Absatz wird eingefügt, siehe unten.

## Was sich ändert und warum

Bisher generiert die Routine bei jedem stündlichen Lauf für jeden fälligen Kunden/Kanal spontan
Text und Bild (K4-K8). Seit Panel v5 bereitet der Panel-Server selbst einmal täglich (03:00 UTC)
bis zu 7 Tage im Voraus Beiträge vor (Tabelle `planned_posts`) - Kunden sehen die im Panel unter
"Vorschau", können Text/Bildfarbe anpassen oder einen Beitrag überspringen, bevor er automatisch
rausgeht.

Damit diese Vorbereitung auch tatsächlich genutzt wird (statt dass die Routine sie ignoriert und
weiter spontan generiert), muss die Routine für jeden fälligen Kunden/Kanal ZUERST prüfen, ob
bereits etwas vorbereitet ist, bevor sie mit K4 (Style-Samples) weitermacht.

**Zwei neue Tools stehen dafür bereit** (bereits live, additiv, kein bestehendes Tool wurde
verändert):
- `get_planned_post` - Parameter `customer_id`, `channel` (`ig_feed`/`ig_story`/`linkedin`),
  `date` (YYYY-MM-DD, normalerweise heute). Liefert `{ "post": ... }` oder `{ "post": null }`.
- `mark_planned_post_published` - Parameter `id` (die `id` aus `get_planned_post`s Ergebnis).
  Reine Buchhaltung, wie `mark_pending_approval_published`.

## Wichtige Abweichung von der ursprünglichen Aufgabenstellung: Platzierung

Die Aufgabenstellung sprach von einem neuen "Schritt K0, vor K1". Das würde aber nicht
funktionieren: der neue Check braucht als Eingabe genau die "ist dieser Kunde/Kanal heute
fällig"-Entscheidung, die erst K3 trifft (`instagramDueNow`/`linkedinDueNow` +
`igFeedEnabled`/`igStoryEnabled`/`linkedinEnabled`). Liefe der Check als komplett eigener,
separater erster Durchgang VOR K1/K2/K3, hätte er keine Möglichkeit, K3 davon abzuhalten,
denselben Kunden/Kanal hinterher trotzdem noch einmal spontan zu generieren (K3 kennt K0s
Entscheidung nicht - insbesondere beim "rejected"-Fall würde K3 sonst genau den Beitrag doch
noch spontan erzeugen, den der Kunde extra übersprungen hat).

Richtig platziert ist der Check deshalb DIREKT INNERHALB von K3s Schleife, für jeden einzelnen
fälligen Kunden/Kanal, bevor zu K4 übergegangen wird - nicht als eigene Phase vor K1. Der neue
Absatz unten ist als **"K3b"** benannt (Fortsetzung von K3), nicht "K0".

## Der einzufügende Text

**Wohin:** Direkt NACH dem letzten Absatz von K3 (der mit "...one now and one 'later'." endet)
und VOR K4 ("For a due customer/channel, call get_customer_style_samples first...") einfügen.

**Was einfügen** (englischer Text, gleicher Stil wie der Rest der Routine):

```
K3b. Before proceeding to K4 for this due customer/channel, call get_planned_post with this
     customer_id, this channel (ig_feed/ig_story/linkedin), and today's date (YYYY-MM-DD).
     - No post returned (null): nothing was pre-planned for this customer/channel/day (planning
       hasn't run yet, failed for this customer, or this customer/channel had nothing due when
       it ran). Proceed to K4-K8 exactly as before - this is the normal fallback, not an error.
     - status 'rejected': the customer explicitly skipped this one in their panel "Vorschau" tab.
       Skip this channel for this customer entirely for today - do NOT proceed to K4, do NOT
       generate a replacement. This is the customer's own choice, not a failure.
     - status 'approved': publish it directly using its existing headline/caption/imageUrl (call
       publish_generated_post for ig_feed, publish_generated_story for ig_story, or the LinkedIn
       tools for linkedin - do NOT call generate_post_image/generate_story_image again, the
       image already exists). After a successful publish, call mark_planned_post_published with
       its id. Skip K4-K8 entirely for this customer/channel. On failure, treat it like any other
       publish failure (K9) - skip and continue, do not retry differently than usual.
     - status 'planned' or 'edited': check this customer's approvalMode (from list_customers).
       - approvalMode false: publish it directly, exactly as for 'approved' above (existing
         content, mark_planned_post_published after success, skip K4-K8).
       - approvalMode true: this hasn't been reviewed by the customer yet - do NOT publish it
         and do NOT call mark_planned_post_published. Proceed to K4-K8 exactly as before
         (unchanged behavior: generate a fresh post and file it via save_pending_approval, same
         as if nothing had been pre-planned). This is intentional, not a bug - a pre-planned post
         only skips the normal flow once actually approved or once approvalMode is off.
     - status 'published': should not normally occur here (already handled on an earlier run) -
       if it does, treat it like 'rejected' (skip, do not regenerate) and move on.

     Do this check separately for EACH due channel of this customer (ig_feed and ig_story each
     have their own planned_posts row) - still respecting K3's "do both feed and story in the
     same pass" rule when both are due today.
```

## Warum kein extra K7-Hinweis nötig ist

Für die direkt veröffentlichten Fälle (status 'approved', oder 'planned'/'edited' mit
approvalMode false) prüft die Routine selbst keine bannedWords/requiredElements erneut - das ist
beabsichtigt, kein vergessener Schritt: Der Panel-Server prüft das bereits zweimal, bevor es
überhaupt so weit kommt:
1. Beim Erstellen des vorbereiteten Beitrags (server-seitige Vorausplanung).
2. Bei jeder Bearbeitung durch den Kunden im Panel ("Vorschau"-Tab, `PATCH /api/planned-posts/:id`
   lehnt eine Änderung ab, die ein Pflicht-Element entfernt oder ein verbotenes Wort einführt).
3. UND die publish_*-Tools selbst prüfen es beim eigentlichen Veröffentlichen ohnehin nochmal
   als Backstop (wie K7 selbst schon beschreibt: "the server enforces this independently as a
   backstop") - falls es trotzdem fehlschlägt, ist das ein ganz normaler K9-Fall (überspringen),
   kein Sonderfall.

## Bekannte Einschränkung (bewusst so belassen, siehe Bericht)

Für Kunden mit approvalMode=true wird ein noch nicht freigegebener vorbereiteter Beitrag
('planned'/'edited') NICHT weiterverwendet, sondern K4-K8 generiert komplett neu (Kosten für die
Vorausplanung wurden für diesen Tag/Kanal also "umsonst" ausgegeben, falls der Kunde nicht vorher
im Panel freigibt). Das entspricht exakt der Aufgabenstellung ("unverändert zum jetzigen
Verhalten"). Eine Optimierung (K8 nutzt bei approvalMode auch den bereits vorbereiteten Beitrag
für `save_pending_approval`, statt neu zu generieren) wäre möglich, war aber nicht Teil dieser
Aufgabe - siehe Bericht, offene Punkte.
