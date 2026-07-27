import fs from "node:fs";
import path from "node:path";
import { md5 } from "./upload.mjs";

// Screenshot filename prefix -> ASC display type, plus the two hardcoded base paths. ONE copy, used by
// three commands: `fill` uploads by these, `diff` and `preflight` judge freshness by them. They used to
// be pasted into fill.mjs and diff.mjs separately, which is one edit away from `fill` uploading a set
// that `diff` then can't see — the same drift this module's callers exist to catch in other people.
export const IOS_DEVICE = { iphone69: "APP_IPHONE_67", iphone65: "APP_IPHONE_65", ipad13: "APP_IPAD_PRO_3GEN_129", watch: "APP_WATCH_ULTRA" };
export const MAC_DEVICE = { macos: "APP_DESKTOP" };
export const deviceMap = (platform) => (platform === "MAC_OS" ? MAC_DEVICE : IOS_DEVICE);
export const screenshotBase = (platform) => (platform === "MAC_OS" ? "fastlane/screenshots-macos" : "fastlane/screenshots");

/** The local set for one locale: displayType -> Map(fileName -> md5 of the bytes). */
export function localScreenshots(platform, locale) {
  const dir = path.join(screenshotBase(platform), locale);
  const dev = deviceMap(platform);
  const local = {};
  if (!fs.existsSync(dir)) return local;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort()) {
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
      if (a) m.set(a.fileName, a.sourceFileChecksum ?? null);
      else m.set(ref.id, null); // not included — treat as present but unverifiable
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
