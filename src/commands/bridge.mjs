import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { green, yellow, red } from "../util.mjs";
import { toAsc } from "../locales.mjs";
import { IOS_DEVICE, MAC_DEVICE, screenshotBase } from "../screenshots.mjs";
import { IMAGES } from "../play/commands/fill.mjs";

/**
 * Map zdymak's build output onto the folders `fill` uploads from.
 *
 * WHY THIS EXISTS. zdymak and vydanne were documented as lining up with "no glue", and they used to:
 * zdymak's default output paths were exactly vydanne's read paths. As of zdymak 0.15.0 they are not.
 * zdymak writes everything under ONE root (`out:` in zdymak.config.mjs, default `./store-assets`)
 * shaped `<locale>/<target>/NN-name.png`, while vydanne reads several hardcoded roots in a different
 * shape. Three things differ, so no amount of retuning `out` can fix it:
 *
 *   1. SEVERAL roots (fastlane/screenshots, screenshots-macos, marketing/out) versus one `out`.
 *   2. Locale CODES — zdymak writes `de`, `zh`, `ur`; Apple wants `de-DE`, `zh-Hans`, `ur-PK`.
 *   3. The slot PREFIX — `fill` picks the device slot from the token before the first underscore, so a
 *      file must be named `iphone69_…`; zdymak names it `01-fresh.png`.
 *
 * The failure mode is the dangerous one: `zdymak screenshots` reports success for every locale and
 * writes nothing vydanne can see, so `fill` re-uploads whatever was in fastlane/screenshots from the
 * last time the two tools agreed — silently shipping stale store art. One app shipped exactly that,
 * its fastlane/screenshots four days older than its own store-assets. So the mapping lives HERE, in
 * the uploader, where the locale table (`toAsc`), the slot tokens (IOS_DEVICE) and the Play read
 * paths (the Play fill's IMAGES) are the very values `fill` uploads by — imported, not copied, so the
 * bridge cannot drift from the thing it feeds.
 *
 * Idempotent by rebuild: each destination is remade from empty, so a screenshot removed upstream
 * disappears here too instead of lingering and being uploaded forever. Local files only — nothing
 * touches a store, which is why this command takes no `--apply`; pass `--dry-run` to see the counts
 * without writing.
 */

// zdymak image target -> the filename token that selects an App Store display type. The tokens are
// asserted against IOS_DEVICE at load: a token `fill` does not understand would make every bridged
// file silently ignorable, which is the exact class of failure this command exists to close.
const APPLE_SLOTS = {
  "appstore-iphone-6.9": "iphone69",
  "appstore-iphone-6.5": "iphone65",
  "appstore-ipad-13": "ipad13",
  "appstore-watch": "watch",
};
for (const t of Object.values(APPLE_SLOTS)) {
  if (!(t in IOS_DEVICE)) throw new Error(`bridge: slot token '${t}' unknown to fill — update APPLE_SLOTS`);
}
/** Mac screenshots live under a different root entirely, so they are carried separately. */
const MAC_TARGET = "appstore-mac";
const MAC_PREFIX = Object.keys(MAC_DEVICE)[0]; // 'macos' — fill selects APP_DESKTOP by this token

// zdymak image target -> Play image type; the DESTINATION comes from the Play fill's own IMAGES table,
// so where the bridge writes and where fill reads are the same string by construction. The Play icon
// is deliberately absent: it comes from znachok, not zdymak, and is already at its read path.
const PLAY_TARGETS = {
  "play-phone": "phoneScreenshots",
  "play-tablet": "tenInchScreenshots",
  "play-tablet7": "sevenInchScreenshots",
  "play-feature-graphic": "featureGraphic",
};
const playDest = (imageType) => {
  const row = IMAGES.find(([type]) => type === imageType);
  if (!row) throw new Error(`bridge: Play type '${imageType}' unknown to fill --store google — update PLAY_TARGETS`);
  return { dest: row[1], kind: row[2] };
};

const dirsIn = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
const pngsIn = (p) => (fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith(".png")).sort() : []);

export async function run(config) {
  const dryRun = process.argv.includes("--dry-run");
  const reset = (p) => { if (!dryRun) { fs.rmSync(p, { recursive: true, force: true }); fs.mkdirSync(p, { recursive: true }); } };
  const put = (from, to) => { if (!dryRun) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); } };

  // zdymak's one knob that matters here: where it wrote. Read from its own config when there is one,
  // so the two tools cannot disagree about the root; its default otherwise.
  let out = "./store-assets";
  if (fs.existsSync("zdymak.config.mjs")) {
    out = (await import(pathToFileURL(path.resolve("zdymak.config.mjs")).href)).default?.out ?? out;
  }
  const SRC = path.resolve(out);
  if (!fs.existsSync(SRC)) {
    console.error(red(`bridge: no ${path.relative(process.cwd(), SRC)} — run \`zdymak screenshots\` (or \`zdymak build\`) first.`));
    return false;
  }

  // ── Apple ─────────────────────────────────────────────────────────────────
  // The root of store-assets holds the untranslated (primary) set; every other directory is a locale.
  const localeDirs = dirsIn(SRC).filter((d) => !(d in APPLE_SLOTS) && d !== MAC_TARGET && !(d in PLAY_TARGETS));
  const APPLE = path.resolve(screenshotBase("IOS"));
  const APPLE_MAC = path.resolve(screenshotBase("MAC_OS"));
  reset(APPLE);

  let copied = 0;
  const noListing = [];
  const noLanguage = [];
  const carried = new Set();
  const written = new Set();

  for (const source of [null, ...localeDirs]) {
    const from = source ? path.join(SRC, source) : SRC;
    const asc = source ? toAsc(source) : config.primaryLocale;
    // A code with no App Store language (Belarusian) is skipped — a locale with no folder falls back
    // to the primary listing, which is the intent.
    if (!asc) { noLanguage.push(source); continue; }

    // Only ship screenshots for a locale that also has LISTING TEXT. Uploading them alone makes fill
    // create the App Store localization to attach them to, and a created localization stops falling
    // back to the primary one — the store would show a page with pictures and an empty description
    // instead of the primary text it shows today. Silent, and worse than not translating at all. When
    // the copy for a locale lands, this picks its screenshots up with no edit here.
    if (!fs.existsSync(path.join(config.metadataDir, asc))) { noListing.push(asc); continue; }

    for (const [target, slot] of Object.entries(APPLE_SLOTS)) {
      for (const png of pngsIn(path.join(from, target))) {
        put(path.join(from, target, png), path.join(APPLE, asc, `${slot}_${png}`));
        copied++; carried.add(target); written.add(asc);
      }
    }
    // Mac gets the same prefix treatment as iOS — fill selects APP_DESKTOP off the `macos_` token, so
    // an unprefixed copy would be a file fill silently ignores, in the folder where it looks.
    const mac = pngsIn(path.join(from, MAC_TARGET));
    if (mac.length) {
      if (!carried.has(MAC_TARGET)) reset(APPLE_MAC);
      for (const png of mac) put(path.join(from, MAC_TARGET, png), path.join(APPLE_MAC, asc, `${MAC_PREFIX}_${png}`));
      copied += mac.length; carried.add(MAC_TARGET); written.add(asc);
    }
  }

  console.log(`▸ Apple → ${path.relative(process.cwd(), APPLE)}`);
  console.log(`    ${copied} files · ${written.size} locale(s) · ${[...carried].join(", ") || "nothing"}`);
  if (noLanguage.length) console.log(`    no App Store language, falls back to ${config.primaryLocale}: ${noLanguage.join(" ")}`);
  if (noListing.length) console.log(`    held back (screenshots ready, listing text missing): ${noListing.join(" ")}`);

  // ── Play ──────────────────────────────────────────────────────────────────
  // Play listings take ONE image set for the whole app, so only the untranslated root is carried.
  let playCount = 0;
  const dropped = [];
  for (const [target, imageType] of Object.entries(PLAY_TARGETS)) {
    const { dest, kind } = playDest(imageType);
    if (kind === "file") {
      const file = path.join(SRC, `${target}.png`);
      if (!fs.existsSync(file)) continue;
      put(file, path.resolve(dest));
      playCount++;
      continue;
    }
    const pngs = pngsIn(path.join(SRC, target));
    // Reset even when zdymak produced NOTHING for this target. A form factor dropped from
    // zdymak.config.mjs must stop being uploaded, and "no new files" is exactly when the old ones
    // would otherwise survive and be re-uploaded forever. The emptied dir is itself a signal now:
    // `fill --store google` and `diff --store google` both report a live set with no local files.
    if (!pngs.length && !fs.existsSync(dest)) continue;
    if (!pngs.length) dropped.push(dest);
    reset(path.resolve(dest));
    for (const png of pngs) put(path.join(SRC, target, png), path.resolve(dest, png));
    playCount += pngs.length;
  }
  console.log(`▸ Play → marketing/out`);
  console.log(`    ${playCount} files`);
  if (dropped.length) console.log(`    cleared, no longer produced by zdymak: ${dropped.join(" ")}`);

  // ── Apple rejects alpha, so catch it here rather than on the last file of an upload ──
  if (!dryRun) {
    const { default: sharp } = await import("sharp");
    const withAlpha = [];
    for (const root of [APPLE, APPLE_MAC].filter((r) => fs.existsSync(r))) {
      for (const dir of dirsIn(root)) {
        for (const png of pngsIn(path.join(root, dir))) {
          const p = path.join(root, dir, png);
          if ((await sharp(p).metadata()).hasAlpha) withAlpha.push(path.relative(process.cwd(), p));
        }
      }
    }
    if (withAlpha.length) {
      console.error(red(`bridge: these carry an alpha channel and Apple will reject them:`));
      for (const p of withAlpha) console.error(`  ${p}`);
      console.error("  Flatten at the source (zdymak), or per file: VYDANNE_FLATTEN=<png> vydanne iap");
      return false;
    }
  }

  if (!copied && !playCount) {
    console.error(red("bridge: nothing was bridged — check that zdymak actually wrote store-assets."));
    return false;
  }
  console.log(green(dryRun ? "✓ dry run — nothing written" : "✓ bridged — `vydanne fill` can now find every set"));
  return true;
}
