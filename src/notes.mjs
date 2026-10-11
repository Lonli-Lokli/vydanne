import fs from "node:fs";
import path from "node:path";

/**
 * The App Store's "What's New" for one locale folder: `release_notes/<version>.txt`, named after the App Store
 * version being prepared ("1.6"), then the classic `release_notes.txt`. Null when neither exists.
 *
 * Named by version for the same reasons as Play's `changelogs/<versionName>.txt`: known before the build, never
 * renamed, and the file's git history is exactly how this version's notes changed (owner, 2026-10-11). Each
 * store keys its notes by its OWN marketing version — an app's iOS and Android versions are independent.
 */
export function appStoreNotesFile(localeFolder, version) {
  const named = version ? path.join(localeFolder, "release_notes", `${version}.txt`) : null;
  if (named && fs.existsSync(named)) return named;
  const classic = path.join(localeFolder, "release_notes.txt");
  return fs.existsSync(classic) ? classic : null;
}
