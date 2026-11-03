import fs from "node:fs";
import path from "node:path";

/**
 * Play listing images the Publishing API cannot take, which `fill` prepares and checks and leaves for Play Console.
 *
 * The API's image types are the nine below (`edits.images.upload`, imageType, from its discovery document, revision
 * 20261103, read 2026-11-03); Play Console's Chromebook screenshots are not among them. So the Chromebook set is
 * checked against Play's rule and named for a manual upload, and `fill` says plainly that it did not push it.
 */
export const PLAY_API_IMAGE_TYPES = ["phoneScreenshots", "sevenInchScreenshots", "tenInchScreenshots", "tvScreenshots",
  "wearScreenshots", "icon", "featureGraphic", "tvBanner"];

/** Manual-only type -> default local folder. `google.manualImages` in the config is merged over it. */
export const DEFAULT_PLAY_MANUAL_IMAGES = { chromebookScreenshots: "marketing/out/play-chromebook-plain" };

/**
 * Play's rule for its large-screen sets: "between 1,080 and 7,680px", "a 16:9 aspect ratio for landscape and a 9:16
 * aspect ratio for portrait", at least four for tablets and Chromebook (support.google.com/googleplay/android-developer
 * /answer/9866151, read 2026-11-03); PNG or JPEG, no alpha.
 */
export const LARGE_SCREEN_RULE = { min: 1080, max: 7680, count: 4 };

export function manualImages(config) {
  return Object.entries({ ...DEFAULT_PLAY_MANUAL_IMAGES, ...(config?.google?.manualImages || {}) });
}

/** `{ width, height, alpha }` of a PNG, or `{ width, height, alpha: false }` of a baseline or progressive JPEG. */
export function imageFacts(file) {
  const b = fs.readFileSync(file);
  if (b.length > 26 && b.readUInt32BE(0) === 0x89504e47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 };
  }
  for (let i = 2; i + 9 < b.length && b[i] === 0xff;) {
    const marker = b[i + 1];
    if (marker === 0xc0 || marker === 0xc2) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), alpha: false };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/** Check one folder against the rule: `{ files, problems }`. */
export function checkLargeScreenSet(dir, rule = LARGE_SCREEN_RULE) {
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(dir, f));
  const problems = [];
  if (files.length < rule.count) problems.push(`${files.length} image(s), Play asks for at least ${rule.count}`);
  for (const f of files) {
    const facts = imageFacts(f);
    const name = path.basename(f);
    if (!facts) { problems.push(`${name}: not a PNG or JPEG it can read`); continue; }
    const { width: w, height: h, alpha } = facts;
    if (Math.min(w, h) < rule.min || Math.max(w, h) > rule.max) problems.push(`${name}: ${w}x${h}, each side must be ${rule.min} to ${rule.max}px`);
    if (w * 9 !== h * 16 && w * 16 !== h * 9) problems.push(`${name}: ${w}x${h} is neither 16:9 nor 9:16`);
    if (alpha) problems.push(`${name}: has an alpha channel`);
  }
  return { files, problems };
}
