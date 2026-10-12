import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { green, yellow, red } from "../util.mjs";
import { toAsc } from "../locales.mjs";
import { IOS_DEVICE, MAC_DEVICE, screenshotBase, IMAGE_FILE } from "../screenshots.mjs";
import { SNAPSHOT_CATALOG, CREATIVE_SLOTS, mismatch, describeSize, matchFile } from "../assetCatalog.mjs";
import { creativeBase } from "../creative.mjs";
import { playImages } from "../play/images.mjs";

/**
 * Map zdymak's build output onto the folders `fill` uploads from.
 *
 * WHY THIS EXISTS. zdymak and vydanne were documented as lining up with "no glue", and they used to:
 * zdymak's default output paths were exactly vydanne's read paths. As of zdymak 0.15.0 they are not.
 * zdymak writes everything under ONE root (`out:` in zdymak.config.mjs, default `./store-assets`)
 * shaped `<locale>/<dir>/NN-name.png`, while vydanne reads several roots in a different shape. Three
 * things differ, so no amount of retuning `out` can fix it:
 *
 *   1. SEVERAL roots (the screenshot bases, the Play image sources) versus one `out`.
 *   2. Locale CODES — zdymak writes `de`, `zh`, `ur`; Apple wants `de-DE`, `zh-Hans`, `ur-PK`.
 *   3. The slot PREFIX — `fill` picks the device slot from the token before the first underscore, so a
 *      file must be named `iphone69_…`; zdymak names it `01-fresh.png`.
 *
 * The failure mode is the dangerous one: `zdymak screenshots` reports success for every locale and
 * writes nothing vydanne can see, so `fill` re-uploads whatever was in the screenshots folder from the
 * last time the two tools agreed — silently shipping stale store art. One app shipped exactly that, its
 * screenshots four days older than its own store-assets. So the mapping lives HERE, in the uploader,
 * where the locale table (`toAsc`), the slot tokens (IOS_DEVICE) and the Play read paths (playImages)
 * are the very values `fill` uploads by — imported, not copied, so the bridge cannot drift from the
 * thing it feeds.
 *
 * SOURCE DIRECTORIES ARE NOT TARGET NAMES. zdymak writes each shot to `<dir || target>`, and `dir:` is
 * how one target serves two purposes — a styled `play-phone/` for the website and a plain
 * `play-phone-plain/` for the Play upload, which Google requires to be the bare interface. It is also
 * the only way to produce Play's 7" slot at all: there is no `play-tablet7` target, so that set can
 * only exist as `{ target: 'play-tablet', dir: 'play-tablet7-plain' }`. Mapping by TARGET therefore got
 * two things wrong at once on any config using `dir:` — it bridged the styled variant into the plain
 * slot, and it treated the real 7" directory as a locale while wiping the destination it belonged in.
 * So the tables below are keyed by DIRECTORY, with the `-plain` convention preferred and the bare
 * target name as the fallback, and `bridge.apple` / `bridge.play` in vydanne.config.mjs override both.
 *
 * OWNERSHIP, NOT REBUILD-IF-PRESENT. The destinations are rebuilt from empty so a screenshot removed
 * upstream disappears here too instead of lingering and being uploaded forever — but only for a store
 * the bridge actually produced files for this run. Resetting a root the bridge did not fill would
 * delete the screenshots of someone who uses zdymak for Play and manages Apple's by hand; resetting it
 * only when something happened to land in it is how dropped macOS art survived a form factor being
 * removed from zdymak.config.mjs. Per STORE is the line that satisfies both: any Apple output at all
 * means the bridge owns both Apple roots, including the macOS one it wrote nothing into today.
 *
 * Local files only — nothing touches a store, which is why this command takes no `--apply`; pass
 * `--dry-run` to see exactly what a real run would write and remove.
 */

// Filename token that selects an App Store display type -> the zdymak output directory it comes from.
// The tokens are asserted against IOS_DEVICE/MAC_DEVICE at load: a token `fill` does not understand
// would make every bridged file silently ignorable, which is the exact class of failure this command
// exists to close.
const APPLE_SLOTS = {
  iphone69: "appstore-iphone-6.9",
  iphone65: "appstore-iphone-6.5",
  ipad13: "appstore-ipad-13",
  // ONE store set fed by SEVERAL directories — the only slot shaped like this. A string or array above is
  // "the first of these that exists"; an object is "every one of these that exists, merged, in this
  // order". iPhone Duo has two screens and Apple holds both in a single set (see IOS_DEVICE in
  // screenshots.mjs for the evidence), so its outer and inner captures must land in one folder side by
  // side, named so that `fill`'s filename order is the order the store shows.
  //
  // `order` is a decision Apple has not documented: nothing published says how the App Store sequences
  // a mixed Duo set or which screen a folded phone shows first. "display" (all outer, then all inner,
  // each upright before turned) is the default because the outer screen is the phone-shaped one and the
  // first few shots are what search results show; "scene" interleaves them (01 outer, 01 inner, 02 outer
  // …) for a gallery that pairs each screen with its unfolded twin. Overridable per app — `bridge.apple`.
  // The four directories are zdymak's four Duo targets; whichever of them a config renders is carried.
  iphoneduo: {
    dirs: ["appstore-iphone-duo-outer", "appstore-iphone-duo-outer-landscape", "appstore-iphone-duo-inner", "appstore-iphone-duo-inner-landscape"],
    order: "display",
  },
  watch: "appstore-watch",
};

/** A slot's directories, whichever shape it was given in. */
const slotDirs = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value.dirs || [] : [value].flat());

/**
 * What each merged directory is called inside the file name: the directory with the prefix every one of
 * them shares removed, so `appstore-iphone-duo-outer` becomes `outer`. Cut at a hyphen, so a shared
 * `appstore-iphone-duo-inner` / `-inner-landscape` pair is not trimmed into the middle of a word.
 */
export function dirLabels(dirs) {
  if (dirs.length < 2) return dirs.slice();
  let prefix = dirs[0];
  for (const d of dirs) while (!d.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.slice(0, prefix.lastIndexOf("-") + 1);
  return dirs.map((d) => d.slice(prefix.length) || d);
}

/**
 * The bridged name of one file in a merged slot. Rank and label sit in the name so that a plain sort —
 * which is all `fill` does — reproduces the order chosen:
 *   display  iphoneduo_1-outer_01-home.png, iphoneduo_1-outer_02-table.png, iphoneduo_2-inner_01-home.png
 *   scene    iphoneduo_01-home_1-outer.png, iphoneduo_01-home_2-inner.png, iphoneduo_02-table_1-outer.png
 */
export function mergedName(slot, rank, label, img, order = "display") {
  if (order === "scene") {
    const ext = path.extname(img);
    return `${slot}_${path.basename(img, ext)}_${rank + 1}-${label}${ext}`;
  }
  return `${slot}_${rank + 1}-${label}_${img}`;
}

/** macOS screenshots live under a different root entirely, so they are carried separately. */
const MAC_SLOT = { macos: "appstore-mac" };

for (const t of Object.keys(APPLE_SLOTS)) {
  if (!(t in IOS_DEVICE)) throw new Error(`bridge: slot token '${t}' unknown to fill — update APPLE_SLOTS`);
}
for (const t of Object.keys(MAC_SLOT)) {
  if (!(t in MAC_DEVICE)) throw new Error(`bridge: slot token '${t}' unknown to fill — update MAC_SLOT`);
}

// Play image type -> candidate source directories, in preference order. The `-plain` set is what Google
// asks for on a store listing ("no additional text, graphics, or backgrounds that are not part of the
// interface"), so it wins when both exist; the bare target name is what a config with no `dir:` override
// produces. The Play icon is deliberately absent: it comes from znachok, not zdymak, and is already at
// its read path.
const PLAY_SOURCES = {
  phoneScreenshots: ["play-phone-plain", "play-phone"],
  sevenInchScreenshots: ["play-tablet7-plain", "play-tablet7"],
  tenInchScreenshots: ["play-tablet-plain", "play-tablet"],
  wearScreenshots: ["play-wear-plain", "play-wear"],
  tvScreenshots: ["play-tv-plain", "play-tv"],
  featureGraphic: ["play-feature-graphic.png"],
  tvBanner: ["play-tv-banner.png"],
};

/**
 * The iOS 27 product page header and search results asset -> the zdymak files that feed them, relative
 * to a locale's output folder (or the root, for the untranslated set). zdymak writes its branded graphics
 * as `<out>/[<locale>/][<dir>/]<target>.png` and its reels as `<out>/<reel name>.mp4` — reels are never
 * localized, so a video only ever feeds the primary listing. A reel's name is the app's own choice
 * (`vinto-header` is as likely as `appstore-header`), so the reels are found by the DESTINATION they
 * declare in zdymak.config.mjs, and the conventional names below only cover a config that cannot be read.
 *
 * The universal graphic (one 5244×2950 PNG) is carried as the HEADER. Search results get it through
 * `creative.searchFromHeader`, which places the same library asset in both slots — copying it to
 * search.png as well would be a second file for `diff` to track that can only ever be the same bytes.
 */
const CREATIVE_SOURCES = {
  header: { image: ["appstore-header.png", "appstore-universal.png"], video: ["appstore-header.mp4", "appstore-header-video.mp4"] },
  search: { image: ["appstore-search.png"], video: ["appstore-search.mp4", "appstore-search-video.mp4"] },
};
const CREATIVE_TARGETS = { "appstore-header": "header", "appstore-universal": "header", "appstore-search": "search" };
const CREATIVE_REELS = { "appstore-header-video": "header", "appstore-search-video": "search" };
const VIDEO_FILE = /\.(mp4|m4v|mov)$/i;

// A directory under `out` that is shaped like a locale code. Everything zdymak writes at that level is
// either an output directory or a locale, and the old rule — "not a known target, therefore a locale" —
// turned every `dir:` override into a phantom locale (`play-phone-plain`, `appstore-iphone-6.9-dark`)
// that then failed to resolve and was reported as falling back to the primary listing.
const LOCALE_SHAPED = /^[a-z]{2,3}(-[A-Za-z]{2,4}|-[0-9]{3})?$/;

const dirsIn = (p) => (fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
const imagesIn = (p) => (fs.existsSync(p) ? fs.readdirSync(p).filter((f) => IMAGE_FILE.test(f)).sort() : []);

/**
 * What zdymak is configured to write: its `out`, and every directory name it produces.
 *
 * Read from the app's own zdymak.config.mjs so the two tools cannot disagree about the layout. Absent
 * or unreadable is fine — the directory names are then discovered from disk instead, which is enough
 * for the common case and only loses the ability to tell a `dir:` override apart from a locale by
 * anything other than its shape.
 */
async function readZdymak(config) {
  const out = {
    root: config.bridge?.out || "./store-assets",
    knownDirs: new Set(),
    fromConfig: false,
    // Creative slot -> { image: [relative path…], video: [file…] } that THIS config writes, beyond the
    // conventional names; and whether it declares any creative output at all (which decides ownership).
    creative: { header: { image: [], video: [] }, search: { image: [], video: [] } },
    declaresCreative: false,
  };
  const file = path.resolve("zdymak.config.mjs");
  if (!fs.existsSync(file)) return out;
  let cfg;
  try {
    cfg = (await import(pathToFileURL(file).href)).default;
  } catch (e) {
    // A config that imports `zdymak` in a project where zdymak is not installed is the likeliest cause,
    // and "Cannot find package 'zdymak'" on its own does not suggest a fix.
    console.log(yellow(`bridge: could not read zdymak.config.mjs (${e.message.split("\n")[0]})`));
    console.log("  Falling back to directory names on disk. Install zdymak, or set `bridge.out` in vydanne.config.mjs.");
    return out;
  }
  if (!cfg) return out;
  out.fromConfig = true;
  if (!config.bridge?.out && cfg.out) out.root = cfg.out;
  const devices = Array.isArray(cfg.devices) ? cfg.devices : Object.values(cfg.devices || {});
  for (const d of devices) {
    for (const s of d?.screenshots || []) {
      if (!s?.target) continue;
      // Icons and feature graphics are written as `<target>.png` at the root, ignoring `dir` — see
      // zdymak/src/screenshots.mjs. Both spellings are recorded so neither can be mistaken for a locale.
      out.knownDirs.add(s.dir || s.target);
      out.knownDirs.add(s.target);
      const slot = CREATIVE_TARGETS[s.target];
      if (slot) {
        out.creative[slot].image.push(path.join(s.dir || "", `${s.target}.png`));
        out.declaresCreative = true;
      }
    }
  }
  // Reels, named the way zdymak names them: `name`, else `reel` alone or `reel-<n>` among several.
  const reels = (Array.isArray(cfg.reel) ? cfg.reel : cfg.reel ? [cfg.reel] : []).filter((r) => r?.segments?.length);
  reels.forEach((r, i) => {
    const name = r.name || (reels.length > 1 ? `reel-${i + 1}` : "reel");
    const slot = CREATIVE_REELS[r.destination] || CREATIVE_REELS[name];
    if (!slot) return;
    out.creative[slot].video.push(`${name}.mp4`);
    out.declaresCreative = true;
  });
  return out;
}

/**
 * Which files under one output folder feed each creative slot: `{ header: [abs…], search: [abs…] }`.
 * More than one for a slot is a conflict the caller refuses — a placement holds one asset, and choosing
 * between a header image and a header video on the app's behalf is how the wrong one ships.
 *
 * `bridge.creative.<slot>` names the file to carry (relative to the folder) when zdymak renders more than
 * one — and only where it EXISTS. The usual case is a header video for the primary listing beside a
 * header image in every locale: the video is not localized, so naming it must not cost the translated
 * folders their own images. A folder without the named file falls back to the default rule.
 */
function creativeFiles(from, zd, config, { videos }) {
  const present = (list) => [...new Set(list)]
    .filter((c) => videos || !VIDEO_FILE.test(c))
    .map((c) => path.join(from, c))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  const found = {};
  for (const slot of Object.keys(CREATIVE_SOURCES)) {
    const override = config.bridge?.creative?.[slot];
    const chosen = override ? present([override].flat()) : [];
    found[slot] = chosen.length
      ? chosen
      : present([...CREATIVE_SOURCES[slot].image, ...zd.creative[slot].image, ...CREATIVE_SOURCES[slot].video, ...zd.creative[slot].video]);
  }
  return found;
}

/** First candidate directory that exists under `from`, or null. */
const pick = (from, candidates) => candidates.find((c) => fs.existsSync(path.join(from, c))) ?? null;

/** Empty a directory, keeping the directory itself. */
function reset(p) {
  fs.rmSync(p, { recursive: true, force: true });
  fs.mkdirSync(p, { recursive: true });
}

export async function run(config) {
  const dryRun = process.argv.includes("--dry-run");
  const zd = await readZdymak(config);
  const SRC = path.resolve(zd.root);
  if (!fs.existsSync(SRC)) {
    console.error(red(`bridge: no ${path.relative(process.cwd(), SRC)} — run \`zdymak screenshots\` (or \`zdymak build\`) first.`));
    return false;
  }

  const appleSlots = { ...APPLE_SLOTS, ...(config.bridge?.apple || {}) };
  const macSlots = Object.fromEntries(
    Object.entries({ ...MAC_SLOT, ...(config.bridge?.apple || {}) }).filter(([t]) => t in MAC_DEVICE),
  );
  const iosSlots = Object.fromEntries(Object.entries(appleSlots).filter(([t]) => t in IOS_DEVICE));
  const playSources = { ...PLAY_SOURCES, ...(config.bridge?.play || {}) };

  const APPLE = path.resolve(screenshotBase("IOS", config));
  const APPLE_MAC = path.resolve(screenshotBase("MAC_OS", config));
  const CREATIVE = path.resolve(creativeBase(config));

  // ── PLAN FIRST, WRITE SECOND ────────────────────────────────────────────────────────────────────
  // Nothing below touches the disk. The old shape reset the destination at the top and discovered it
  // had nothing to put there at the bottom — so an empty `store-assets` emptied the screenshots folder
  // and *then* reported failure, and a `--dry-run` could not check the files a real run would refuse
  // because they had not been copied yet. Planning first makes the dry run exact and the failure paths
  // non-destructive, at the cost of one array.
  const plan = []; // { from, to, store: 'apple' | 'play' | 'creative' }
  const creativeConflicts = [];
  const creativeLocales = new Set();
  const noListing = [];
  const noLanguage = [];
  const ignored = [];
  const carried = new Set();
  const written = new Set();

  // ── Apple ───────────────────────────────────────────────────────────────────────────────────────
  // The root of store-assets holds the untranslated (primary) set; a locale-shaped directory beside it
  // is a translated one.
  // Everything the bridge itself knows how to read counts as a known output, whether or not
  // zdymak.config.mjs was readable — otherwise a project with no zdymak config has each of its own
  // source directories reported as "neither an output nor a locale" while being bridged correctly.
  const knownDirs = new Set([
    ...zd.knownDirs,
    ...Object.values(appleSlots).flatMap(slotDirs),
    ...Object.values(macSlots).flatMap(slotDirs),
    ...Object.values(playSources).flat(),
  ]);
  // A merged slot with an order nobody implemented is refused here, before any planning: silently falling
  // back to "display" would ship an order the config says it did not ask for.
  for (const [slot, value] of Object.entries(appleSlots)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!Array.isArray(value.dirs) || !value.dirs.length) {
        console.error(red(`bridge: bridge.apple.${slot} must name its directories — { dirs: [...], order: "display" | "scene" }`));
        return false;
      }
      if (value.order && !["display", "scene"].includes(value.order)) {
        console.error(red(`bridge: bridge.apple.${slot}.order is '${value.order}' — expected "display" or "scene"`));
        return false;
      }
    }
  }
  const localeDirs = dirsIn(SRC).filter((d) => {
    if (knownDirs.has(d)) return false;
    if (LOCALE_SHAPED.test(d)) return true;
    ignored.push(d);
    return false;
  });

  for (const source of [null, ...localeDirs]) {
    const from = source ? path.join(SRC, source) : SRC;
    const asc = source ? toAsc(source, config.localeMap) : config.primaryLocale;
    // A code with no App Store language (Belarusian) is skipped — a locale with no folder falls back
    // to the primary listing, which is the intent.
    if (!asc) { noLanguage.push(source); continue; }

    // Only ship screenshots for a locale that also has LISTING TEXT. Uploading them alone makes fill
    // create the App Store localization to attach them to, and a created localization stops falling
    // back to the primary one — the store would show a page with pictures and an empty description
    // instead of the primary text it shows today. Silent, and worse than not translating at all. When
    // the copy for a locale lands, this picks its screenshots up with no edit here.
    if (!fs.existsSync(path.join(config.metadataDir, asc))) { noListing.push(asc); continue; }

    for (const [root, slots] of [[APPLE, iosSlots], [APPLE_MAC, macSlots]]) {
      for (const [slot, candidates] of Object.entries(slots)) {
        if (candidates && typeof candidates === "object" && !Array.isArray(candidates)) {
          const present = candidates.dirs.filter((d) => fs.existsSync(path.join(from, d)));
          const labels = dirLabels(candidates.dirs);
          for (const dir of present) {
            const rank = candidates.dirs.indexOf(dir);
            for (const img of imagesIn(path.join(from, dir))) {
              plan.push({ from: path.join(from, dir, img), to: path.join(root, asc, mergedName(slot, rank, labels[rank], img, candidates.order)), store: "apple", slot });
              carried.add(dir);
              written.add(asc);
            }
          }
          continue;
        }
        const dir = pick(from, [candidates].flat());
        if (!dir) continue;
        for (const img of imagesIn(path.join(from, dir))) {
          // fill selects the display type off the token before the first underscore, so an unprefixed
          // copy would be a file it silently ignores, in the folder where it looks.
          plan.push({ from: path.join(from, dir, img), to: path.join(root, asc, `${slot}_${img}`), store: "apple", slot });
          carried.add(dir);
          written.add(asc);
        }
      }
    }

    // The iOS 27 header and search asset, into `<creative.dir>/<locale>/header.<ext>` / `search.<ext>` —
    // the layout `vydanne creative` reads. Held back with the screenshots above for a locale with no
    // listing text, for the same reason and because `creative` places only on an existing localization.
    const found = creativeFiles(from, zd, config, { videos: !source });
    for (const [slot, files] of Object.entries(found)) {
      if (files.length > 1) {
        creativeConflicts.push(`${asc}: ${files.map((p) => path.relative(process.cwd(), p)).join(" and ")} — ${files.length === 2 ? "both" : "all"} for the ${CREATIVE_SLOTS[slot].label}, which holds one`);
        continue;
      }
      if (!files.length) continue;
      plan.push({ from: files[0], to: path.join(CREATIVE, asc, `${slot}${path.extname(files[0]).toLowerCase()}`), store: "creative", slot });
      creativeLocales.add(asc);
    }
  }

  // ── Play ────────────────────────────────────────────────────────────────────────────────────────
  // Only the untranslated root is carried: Play graphics default to one set at `defaultLocale`, and an
  // app that opts into per-language art (`google.imageLocales`) points `fill` at the subdirectories it
  // maintains itself.
  const playDest = Object.fromEntries(playImages(config).map(([type, src, kind]) => [type, { src, kind }]));
  const playDirs = new Set();
  const playCarried = new Set();
  for (const [type, candidates] of Object.entries(playSources)) {
    const dest = playDest[type];
    if (!dest) continue; // a type this app's images table doesn't have — nothing reads it, so skip it
    if (dest.kind === "file") {
      const file = [candidates].flat().map((c) => path.join(SRC, c)).find((p) => fs.existsSync(p));
      if (!file) continue;
      plan.push({ from: file, to: path.resolve(dest.src), store: "play" });
      playCarried.add(path.basename(file));
      continue;
    }
    const dir = pick(SRC, [candidates].flat());
    // Owned when zdymak produces it, and ALSO when it merely still exists from a previous run — that
    // second half is the point: a form factor dropped from zdymak.config.mjs must stop being uploaded,
    // and "no new files" is exactly when the old ones would otherwise survive forever. A slot with
    // neither is a slot this app does not use, and creating an empty directory for it would only
    // invent a set for `fill` to report on.
    if (dir || fs.existsSync(dest.src)) playDirs.add(path.resolve(dest.src));
    if (!dir) continue;
    for (const img of imagesIn(path.join(SRC, dir))) {
      plan.push({ from: path.join(SRC, dir, img), to: path.resolve(dest.src, img), store: "play" });
      playCarried.add(dir);
    }
  }

  const appleCount = plan.filter((p) => p.store === "apple").length;
  const playCount = plan.filter((p) => p.store === "play").length;
  const creativeCount = plan.filter((p) => p.store === "creative").length;

  if (creativeConflicts.length) {
    console.error(red("bridge: more than one zdymak output for one creative slot:"));
    for (const c of creativeConflicts) console.error(`  ${c}`);
    console.error("  Drop one from zdymak.config.mjs, or name the one to carry, relative to its folder:");
    console.error("  bridge: { creative: { header: \"<file>\" } }  (a folder without that file keeps the default rule)");
    console.error("  Nothing was copied; every destination is untouched.");
    return false;
  }

  if (!appleCount && !playCount && !creativeCount) {
    console.error(red("bridge: nothing was bridged — check that zdymak actually wrote store-assets."));
    if (ignored.length) console.error(`  neither a zdymak output nor a locale: ${ignored.join(", ")}`);
    console.error("  Nothing was removed; every destination is untouched.");
    return false;
  }

  // ── Apple rejects alpha, so catch it on the SOURCES, before anything is copied ──────────────────
  // Checked here rather than after the copy for two reasons: a dry run can now report the refusal a
  // real run would hit, and a real run no longer leaves the rejected file sitting in the folder `fill`
  // uploads from — where the next run would send it to Apple and collect the rejection anyway.
  //
  // The same pass checks the two other things Apple refuses a set for, against its own catalog (the
  // snapshot here — `bridge` has no client): a size the slot does not take, and more than the slot holds.
  // The second is new with Duo: one store set now draws on several capture folders, so three sets of six
  // scenes is eighteen files for a set of ten, and `fill` would upload ten and fail on the eleventh.
  const appleFiles = plan.filter((p) => p.store === "apple");
  if (appleFiles.length) {
    const { default: sharp } = await import("sharp");
    const withAlpha = [];
    const wrongSize = [];
    for (const p of appleFiles) {
      const meta = await sharp(p.from).metadata();
      if (meta.hasAlpha) withAlpha.push(path.relative(process.cwd(), p.from));
      const specs = SNAPSHOT_CATALOG.screenshotSpecs(IOS_DEVICE[p.slot] || MAC_DEVICE[p.slot]);
      if (specs.length && !specs.some((s) => !mismatch(s, { width: meta.width, height: meta.height, hasAlpha: false }, { ext: path.extname(p.from).toLowerCase(), bytes: 0 }))) {
        wrongSize.push(`${path.relative(process.cwd(), p.from)}  ${meta.width}×${meta.height} — ${p.slot} takes ${specs.map(describeSize).join(", ")}`);
      }
    }
    const perSet = new Map();
    for (const p of appleFiles) {
      const key = `${path.relative(process.cwd(), path.dirname(p.to))}\u0000${p.slot}`;
      perSet.set(key, (perSet.get(key) || 0) + 1);
    }
    const overfull = [...perSet].map(([key, n]) => {
      const [dir, slot] = key.split("\u0000");
      const max = SNAPSHOT_CATALOG.screenshotLimit(IOS_DEVICE[slot] || MAC_DEVICE[slot]);
      return max != null && n > max ? `${dir}: ${n} ${slot} files for a set of ${max}` : null;
    }).filter(Boolean);
    if (withAlpha.length || wrongSize.length || overfull.length) {
      if (withAlpha.length) {
        console.error(red("bridge: these carry an alpha channel and Apple will reject them:"));
        for (const p of withAlpha) console.error(`  ${p}`);
        console.error("  Flatten at the source (zdymak), or per file: VYDANNE_FLATTEN=<png> vydanne iap");
      }
      if (wrongSize.length) {
        console.error(red("bridge: these are a size their App Store slot does not take:"));
        for (const p of wrongSize) console.error(`  ${p}`);
      }
      if (overfull.length) {
        console.error(red("bridge: more screenshots than the App Store set holds:"));
        for (const p of overfull) console.error(`  ${p}`);
        console.error("  Name fewer directories in `bridge.apple.<slot>` (e.g. iphoneduo: { dirs: [outer, inner] }),");
        console.error("  or give those zdymak targets fewer scenes.");
      }
      console.error("  Nothing was copied; every destination is untouched.");
      return false;
    }
  }

  // ── The creative assets, against the same catalog `vydanne creative` checks them with ────────────
  // One function for both (assetCatalog.matchFile), so a file the bridge carries is a file `creative`
  // will accept: size, format, alpha, and for a video its length, frame rate and sound.
  const creativeBad = [];
  for (const p of plan.filter((x) => x.store === "creative")) {
    const { placementType, group } = CREATIVE_SLOTS[p.slot];
    const m = await matchFile(p.from, SNAPSHOT_CATALOG.specsFor(placementType, group));
    if (m.problem) creativeBad.push(`${path.relative(process.cwd(), p.from)} — ${m.problem}`);
  }
  if (creativeBad.length) {
    console.error(red("bridge: these would be refused for their creative slot:"));
    for (const p of creativeBad) console.error(`  ${p}`);
    console.error("  Nothing was copied; every destination is untouched.");
    return false;
  }

  // ── Write ───────────────────────────────────────────────────────────────────────────────────────
  // Ownership is per STORE: producing any Apple output means the bridge owns both Apple roots, so the
  // macOS one is emptied even on a run that wrote nothing into it. An app that bridges only Play never
  // has its hand-managed Apple screenshots touched, and vice versa.
  const mediaIn = (p) => (fs.existsSync(p) ? fs.readdirSync(p).filter((f) => IMAGE_FILE.test(f) || VIDEO_FILE.test(f)) : []);
  const countFiles = (root) => {
    if (!fs.existsSync(root)) return 0;
    let n = mediaIn(root).length;
    for (const d of dirsIn(root)) n += mediaIn(path.join(root, d)).length;
    return n;
  };
  // The creative root is owned when zdymak produced a creative file this run, or is CONFIGURED to — the
  // second half is what stops a header dropped upstream (its graphic or reel removed, its file left
  // behind) from being placed forever. A project whose zdymak config declares no creative output at all
  // keeps a hand-managed fastlane/creative untouched, whatever else the bridge carries.
  const owned = [
    ...(appleCount ? [APPLE, APPLE_MAC] : []),
    ...(playCount ? [...playDirs] : []),
    ...(creativeCount || zd.declaresCreative ? [CREATIVE] : []),
  ];
  const removals = owned.map((root) => [root, countFiles(root)]).filter(([, n]) => n);

  if (!dryRun) {
    for (const root of owned) reset(root);
    for (const p of plan) {
      fs.mkdirSync(path.dirname(p.to), { recursive: true });
      fs.copyFileSync(p.from, p.to);
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────────────────────────
  console.log(`▸ Apple → ${path.relative(process.cwd(), APPLE)}`);
  console.log(`    ${appleCount} files · ${written.size} locale(s) · ${[...carried].join(", ") || "nothing"}`);
  if (noLanguage.length) console.log(`    no App Store language, falls back to ${config.primaryLocale}: ${noLanguage.join(" ")}`);
  if (noListing.length) console.log(`    held back (screenshots ready, listing text missing): ${noListing.join(" ")}`);

  console.log(`▸ Creative → ${path.relative(process.cwd(), CREATIVE)}`);
  console.log(`    ${creativeCount} files · ${creativeLocales.size} locale(s)${creativeCount ? ` · ${plan.filter((p) => p.store === "creative").map((p) => path.relative(CREATIVE, p.to)).join(", ")}` : ""}`);
  // A universal header with no search asset of its own reaches search results only through
  // `creative.searchFromHeader` — said either way, so an empty search slot is never a surprise.
  const universalOnly = [...creativeLocales].filter((asc) => {
    const mine = plan.filter((p) => p.store === "creative" && path.basename(path.dirname(p.to)) === asc);
    return mine.some((p) => p.slot === "header" && path.basename(p.from) === "appstore-universal.png") && !mine.some((p) => p.slot === "search");
  });
  if (universalOnly.length) {
    console.log(config.creative?.searchFromHeader
      ? `    universal header, placed in search results too by \`vydanne creative\` (searchFromHeader): ${universalOnly.join(" ")}`
      : yellow(`    universal header with no search asset — set creative.searchFromHeader to place it there too: ${universalOnly.join(" ")}`));
  }

  console.log(`▸ Play → ${[...playDirs].map((d) => path.relative(process.cwd(), d)).join(", ") || "nothing"}`);
  console.log(`    ${playCount} files · ${[...playCarried].join(", ") || "nothing"}`);

  // Said every run, because "what the bridge is about to delete" is the one thing a dry run exists to
  // show — and because a destination emptied on purpose (its form factor dropped upstream) looks
  // exactly like one that was never filled.
  for (const [root, n] of removals) {
    console.log(yellow(`    ${dryRun ? "would replace" : "replaced"} ${n} existing file(s) in ${path.relative(process.cwd(), root)}`));
  }
  if (ignored.length) console.log(yellow(`    ignored (neither a zdymak output nor a locale): ${ignored.join(", ")}`));

  console.log(green(dryRun ? "✓ dry run — nothing written" : `✓ bridged — \`vydanne fill\`${creativeCount ? " and \`vydanne creative\`" : ""} can now find every set`));
  return true;
}
