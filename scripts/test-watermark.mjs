#!/usr/bin/env node
/**
 * Regression test for a real customer-reported bug (Andrea Hölzl, Panel v7 Teil 6): a longer
 * headline ("Rückenschmerzen? Beweglichkeit zurückgewinnen") rendered past the right edge of the
 * generated image. Renders real headlines onto a real plain background with the actual
 * addHeadlineText() from dist/watermark.js and checks, pixel-by-pixel, that no bright
 * (headline-white) pixel ever lands to the right of the documented safe zone - a concrete,
 * visual guarantee rather than just re-checking the same width-estimate math the code itself
 * uses (which is exactly what went wrong originally: the estimate was never cross-checked
 * against anything real).
 *
 * Run after `npm run build` (imports the compiled dist/, like the actual server does).
 */
import sharp from "sharp";
import { addHeadlineText } from "../dist/watermark.js";

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok - ${name}`);
  } else {
    fail++;
    console.log(`  FAIL - ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

async function makeBackground(width, height) {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 14, b: 26 } } }).png().toBuffer();
}

/** Returns the rightmost x-coordinate of any near-white pixel at or beyond `safeRightFrac` of the width, or -1 if none. */
async function rightmostBrightPixelBeyond(buf, width, height, safeRightFrac) {
  const safeRightPx = Math.round(width * safeRightFrac);
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let maxX = -1;
  for (let y = 0; y < height; y++) {
    for (let x = safeRightPx; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (data[idx] > 200 && data[idx + 1] > 200 && data[idx + 2] > 200) {
        if (x > maxX) maxX = x;
      }
    }
  }
  return { safeRightPx, maxX };
}

async function main() {
  console.log("Watermark headline overflow test (Panel v7 Teil 6):\n");

  // feed safe zone right edge = 0.82 of width (see getHeadlineSafeZone in watermark.ts)
  const feedBg = await makeBackground(1080, 1080);
  const feedLong = await addHeadlineText(feedBg, "Rückenschmerzen? Beweglichkeit zurückgewinnen", "feed");
  const feedLongCheck = await rightmostBrightPixelBeyond(feedLong, 1080, 1080, 0.82);
  ok(
    "lange Headline (feed) bleibt innerhalb der Safe Zone",
    feedLongCheck.maxX === -1,
    `helle Pixel bis x=${feedLongCheck.maxX}, Safe Zone endet bei x=${feedLongCheck.safeRightPx}`,
  );

  // story safe zone right edge = 0.9 of width
  const storyBg = await makeBackground(1080, 1920);
  const storyLong = await addHeadlineText(storyBg, "Rückenschmerzen? Beweglichkeit zurückgewinnen", "story");
  const storyLongCheck = await rightmostBrightPixelBeyond(storyLong, 1080, 1920, 0.9);
  ok(
    "lange Headline (story) bleibt innerhalb der Safe Zone",
    storyLongCheck.maxX === -1,
    `helle Pixel bis x=${storyLongCheck.maxX}, Safe Zone endet bei x=${storyLongCheck.safeRightPx}`,
  );

  // An even more extreme case: a long unbroken compound-ish phrase with no short words to wrap on.
  const extremeBg = await makeBackground(1080, 1080);
  const extremeLong = await addHeadlineText(extremeBg, "Rückenschmerzen Beweglichkeit Lebensqualität Wohlbefinden Gesundheit", "feed");
  const extremeCheck = await rightmostBrightPixelBeyond(extremeLong, 1080, 1080, 0.82);
  ok(
    "sehr lange Headline (5 lange Wörter, feed) bleibt innerhalb der Safe Zone",
    extremeCheck.maxX === -1,
    `helle Pixel bis x=${extremeCheck.maxX}, Safe Zone endet bei x=${extremeCheck.safeRightPx}`,
  );

  // Regression check: a normal short headline still renders (nothing broken by the rewrite).
  const shortBg = await makeBackground(1080, 1080);
  const short = await addHeadlineText(shortBg, "Mehr Energie", "feed");
  const shortCheck = await rightmostBrightPixelBeyond(short, 1080, 1080, 0.82);
  ok("kurze Headline (unverändertes Verhalten) bleibt innerhalb der Safe Zone", shortCheck.maxX === -1, `helle Pixel bis x=${shortCheck.maxX}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
