/**
 * Der Firmenname auf dem Beitragsbild (Auftrag vom 19.09.2026, Punkt 3).
 *
 * Prueft mit echten Pixeln, nicht mit dem SVG-Quelltext: Wo steht der Name, ist er hell genug,
 * und - der eigentliche Fehler von vorher - ueberlebt er den 4:5-Beschnitt, den die
 * Wochenvorschau anwendet (start.css: .media.feed { aspect-ratio: 4/5 }).
 *
 *   node scripts/test-firmenname.mjs
 */
import sharp from "sharp";
import { renderGradientBackground } from "../dist/gradient.js";
import { addHeadlineText, addPipelineWatermark } from "../dist/watermark.js";

let fehler = 0;
const ok = (t, b, e = "") => { console.log(`  ${b ? "ok  " : "FAIL"} - ${t}${e ? ` :: ${e}` : ""}`); if (!b) fehler++; };
const SCHRIFT = { family: "Liberation Sans, sans-serif", weight: 700 };

/** Findet die Spalten und Zeilen, in denen deutlich hellere Pixel als der Hintergrund liegen. */
async function textKasten(buf, bereich) {
  const { data, info } = await sharp(buf).extract(bereich).greyscale().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1, hell = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] > 200) {
        hell++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY, hell };
}

for (const [name, text] of [["kurzer Name", "Channoine Mayr"], ["sehr langer Name", "Mayr Kosmetik und Hautpflege Handelsgesellschaft"]]) {
  console.log(`\n${name}: "${text}"`);
  const bg = await renderGradientBackground("#a36629", "#56441a", "diagonal", 1024, 1024);
  const mitKopf = await addHeadlineText(bg, "Deine Schönheit, Dein Business", "feed", SCHRIFT);
  const fertig = await addPipelineWatermark(mitKopf, "feed", text, null, SCHRIFT);

  // Untere 14 % des Bildes: dort und nur dort gehoert der Name hin.
  const unten = await textKasten(fertig, { left: 0, top: 880, width: 1024, height: 144 });
  ok("Der Name steht im unteren Bildstreifen", unten.hell > 800, `${unten.hell} helle Pixel`);
  ok("Er beginnt auf der Fluchtlinie der Headline (18 %)", Math.abs(unten.minX - 184) <= 12, `x=${unten.minX}`);
  ok("Er endet vor der 82-%-Kante", unten.maxX <= 840, `x=${unten.maxX}`);
  ok("Er liegt im Bereich, den ein 4:5-Beschnitt stehen laesst (102..922)", unten.minX >= 102 && unten.maxX <= 922, `${unten.minX}..${unten.maxX}`);

  // Genau der Beschnitt, den die Wochenvorschau zeigt.
  const beschnitten = await sharp(fertig).extract({ left: 102, top: 0, width: 820, height: 1024 }).jpeg().toBuffer();
  const nachher = await textKasten(beschnitten, { left: 0, top: 880, width: 820, height: 144 });
  ok("Nach dem 4:5-Beschnitt ist er noch ganz da", nachher.hell >= unten.hell * 0.98, `${nachher.hell} von ${unten.hell}`);

  // Schriftgrad 4,2 % von 1024 = 43 px, Versalhoehe rund 30 px. Ein sehr langer Name faellt auf
  // die Untergrenze von 3,2 % - kleiner wird er bewusst nicht, dann staucht textLength.
  const hoehe = unten.maxY - unten.minY;
  const untergrenze = text.length > 30 ? 26 : 34;
  ok("Die Schrift ist gross genug zum Lesen", hoehe >= untergrenze, `${hoehe} px, Untergrenze ${untergrenze}`);

  // Und die Headline darf ihn nicht beruehren.
  const zwischen = await textKasten(fertig, { left: 0, top: 850, width: 1024, height: 28 });
  ok("Zwischen Headline und Name bleibt Luft", zwischen.hell === 0, `${zwischen.hell} helle Pixel im Zwischenraum`);
}

console.log(fehler ? `\n${fehler} Problem(e)` : "\nalles gruen");
process.exit(fehler ? 1 : 0);
