import fs from "node:fs";
import path from "node:path";
import { md5 } from "./upload.mjs";
import { VALID } from "./locales.mjs";

// Screenshot filename prefix -> ASC display type, plus the base paths. ONE copy, used by three commands:
// `fill` uploads by these, `diff` and `preflight` judge freshness by them. They used to be pasted into
// fill.mjs and diff.mjs separately, which is one edit away from `fill` uploading a set that `diff` then
// can't see — the same drift this module's callers exist to catch in other people.
// Apple accepts JPEG as well as PNG for screenshots. The `.png`-only filter this replaces made a `.jpg`
// set invisible to fill, diff AND preflight at once: nothing uploaded, nothing compared, preflight green.
export const IMAGE_FILE = /\.(png|jpe?g)$/i;

// `iphoneduo` -> APP_IPHONE_DUO, the foldable iPhone, and ONE set for both of its screens.
//
// The display type is not in Apple's published OpenAPI (4.5.1 still lists only the older ones), but the
// live API creates a set with it (HTTP 201, rorkai/App-Store-Connect-CLI#2926, 2026-10-06), and the same
// change saw a simulator capture at 1398×2034 and 2034×1398 uploaded into it, processed COMPLETE with
// matching checksums, and shown in App Store Connect's Duo gallery. The inner-screen sizes were never
// uploaded there, so the evidence that they share the set is Apple's own catalog instead: the Asset
// Library reference data lists all four sizes under one placement group, IPHONE_DUO_PROFILE, with one
// limit of ten (see SCREENSHOT_GROUP in assetCatalog.mjs). Outer and inner therefore go into this one
// set, ten files between them, in filename order — `bridge` names them so the order is the one asked for.
export const IOS_DEVICE = { iphone69: "APP_IPHONE_67", iphone65: "APP_IPHONE_65", ipad13: "APP_IPAD_PRO_3GEN_129", iphoneduo: "APP_IPHONE_DUO", watch: "APP_WATCH_ULTRA" };
export const MAC_DEVICE = { macos: "APP_DESKTOP" };
export const deviceMap = (platform) => (platform === "MAC_OS" ? MAC_DEVICE : IOS_DEVICE);

/**
 * iPhone Duo screenshots: optional now, required from April 2027 for an app built with the iOS 27.1 SDK
 * or later (Apple's screenshot specifications, read 2026-10-12).
 *
 * A function of the date rather than a constant, so the day the rule changes needs no release: before
 * it, a listing without them is told they are coming; from it, `preflight` treats them as missing, which
 * is what App Store Connect will do. vydanne cannot see which SDK a build used, so an app that genuinely
 * still ships on an older SDK says so with VYDANNE_DUO_OPTIONAL=1 rather than being told it is fine.
 */
export const DUO_REQUIRED_FROM = "2027-04-01";
export const duoRequired = (now = new Date()) => now.getTime() >= Date.parse(`${DUO_REQUIRED_FROM}T00:00:00Z`);

/** The iPhone display types whose presence means the listing ships on iPhone — and so will need a Duo set. */
export const IPHONE_TYPES = ["APP_IPHONE_67", "APP_IPHONE_65"];

// fastlane's supply convention, which is what most repos already have — but a DEFAULT now, not a law.
// These two paths were hardcoded, and the docs said so out loud ("symlink them if your layout differs"),
// which is an honest way to describe a tool that cannot be pointed at your repo. `metadataDir` was always
// configurable; there was never a reason for its sibling not to be.
export const DEFAULT_SCREENSHOT_BASE = { IOS: "fastlane/screenshots", MAC_OS: "fastlane/screenshots-macos" };

/** Where this platform's screenshots live: `screenshots` in the config, else the supply convention. */
export const screenshotBase = (platform, config) =>
  config?.screenshots?.[platform] ?? DEFAULT_SCREENSHOT_BASE[platform] ?? DEFAULT_SCREENSHOT_BASE.IOS;

/**
 * Locales with a local screenshot folder for this platform.
 *
 * Filtered through `VALID` for the same reason `fill` filters its upload loop through it: a folder named
 * `de` instead of `de-DE` is not a locale Apple knows, and treating it as one would compare a real store
 * localization against nothing. The caller reports what was dropped — see `unknownScreenshotDirs`.
 */
export function localScreenshotLocales(platform, config) {
  const base = screenshotBase(platform, config);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && VALID.has(d.name))
    .map((d) => d.name)
    .sort();
}

/** Screenshot folders that are NOT App Store locale codes — reported, never silently ignored. */
export function unknownScreenshotDirs(platform, config) {
  const base = screenshotBase(platform, config);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !VALID.has(d.name))
    .map((d) => d.name)
    .sort();
}

/** The local set for one locale: displayType -> Map(fileName -> md5 of the bytes). */
export function localScreenshots(platform, locale, config) {
  const dir = path.join(screenshotBase(platform, config), locale);
  const dev = deviceMap(platform);
  const local = {};
  if (!fs.existsSync(dir)) return local;
  for (const f of fs.readdirSync(dir).filter((f) => IMAGE_FILE.test(f)).sort()) {
    const dt = dev[f.split("_")[0]];
    if (dt) (local[dt] ||= new Map()).set(f, md5(fs.readFileSync(path.join(dir, f))));
  }
  return local;
}

/**
 * What the store holds for one localization: displayType -> Map(fileName -> sourceFileChecksum|null).
 *
 * `include=appScreenshots` returns the shots as full resources in `included`; the set's relationships
 * carry ids only, so the attributes (fileName, sourceFileChecksum) have to be picked up from there. A
 * null checksum means Apple reported the file but not its content — present, and unverifiable.
 */
export async function remoteScreenshots(client, locId) {
  const { json: sets } = await client.get(`/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets?include=appScreenshots&limit=50`);
  const shotsById = new Map((sets.included || []).filter((r) => r.type === "appScreenshots").map((r) => [r.id, r.attributes || {}]));
  const remote = {};
  for (const s of sets.data || []) {
    const m = new Map();
    for (const ref of s.relationships?.appScreenshots?.data || []) {
      const a = shotsById.get(ref.id);
      let key = a ? a.fileName : ref.id; // not included — treat as present but unverifiable
      // The same name twice in one set is a duplicate on the store, and it has to COUNT. Keyed by name
      // alone, the second copy overwrote the first: Vinto 1.4's 6.9" set held nine screenshots, three of
      // them repeats, and `diff` and `preflight` both read it as the six local files and called it in sync.
      // A suffixed key keeps the extra copy visible, so the comparison reports "local 6 / remote 9".
      for (let n = 2; m.has(key); n++) key = `${a ? a.fileName : ref.id} (copy ${n})`;
      m.set(key, a ? a.sourceFileChecksum ?? null : null);
    }
    remote[s.attributes.screenshotDisplayType] = m;
  }
  return remote;
}

/**
 * One display type, local vs store — by CONTENT, not by count. Counting was actively misleading:
 * re-rendering every screenshot leaves three-local-vs-three-remote, so a count check says "in sync"
 * about a listing showing the old images. The checksum is there to compare against: `upload.mjs`
 * commits md5(bytes) as `sourceFileChecksum`.
 *
 * Returns null on a verified match, else one finding — the kinds need different actions, so they are
 * kept apart rather than collapsed into a boolean:
 *   count      the sets aren't even the same size
 *   renamed    same size, but local names the store doesn't have
 *   stale      same names, different bytes — the store is showing old art
 *   unverified Apple returned no checksum, so a match was never established (say so, don't claim it)
 */
export function compareShots(L, R) {
  if (L.size !== R.size) return { kind: "count", local: L.size, remote: R.size };
  const renamed = [...L.keys()].filter((name) => !R.has(name));
  if (renamed.length) return { kind: "renamed", names: renamed };
  const stale = [...L].filter(([name, sum]) => R.get(name) !== null && R.get(name) !== sum).map(([name]) => name);
  if (stale.length) return { kind: "stale", names: stale, of: L.size };
  const unverified = [...L.keys()].filter((name) => R.get(name) === null);
  if (unverified.length) return { kind: "unverified", names: unverified };
  return null;
}
