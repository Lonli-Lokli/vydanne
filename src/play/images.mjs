/**
 * Play listing images: the type vocabulary, and where each one is read from by default.
 *
 * ONE table, imported by `fill --store google` (which uploads them), `diff --store google` (which
 * compares them) and `bridge` (which fills the folders they read). A second copy would let the three
 * disagree about which files are even part of the listing — the same drift src/screenshots.mjs exists
 * to prevent on the Apple side.
 *
 * The DEFAULTS are this portfolio's layout and are meant to be overridden: `google.images` in
 * vydanne.config.mjs is merged over them, slot by slot. The icon default in particular points at
 * znachok's output directory, which is an obvious path if you use znachok and a mystery otherwise.
 *
 * `wearScreenshots` and the TV slots have no historical default because nothing here shipped them yet;
 * they are listed so a Wear OS or Android TV release is a config line rather than a code change. A type
 * whose local source does not exist is skipped, so listing them costs nothing.
 */

/** Play image type -> whether its local source is a single file or a directory of images. */
export const PLAY_IMAGE_KIND = {
  icon: "file",
  featureGraphic: "file",
  tvBanner: "file",
  phoneScreenshots: "dir",
  sevenInchScreenshots: "dir",
  tenInchScreenshots: "dir",
  wearScreenshots: "dir",
  tvScreenshots: "dir",
};

/** Play image type -> default local source path. */
export const DEFAULT_PLAY_IMAGES = {
  icon: "brand/icons/play/icon-512.png",
  featureGraphic: "marketing/out/play-feature-graphic.png",
  phoneScreenshots: "marketing/out/play-phone-plain",
  sevenInchScreenshots: "marketing/out/play-tablet7-plain",
  tenInchScreenshots: "marketing/out/play-tablet-plain",
  wearScreenshots: "marketing/out/play-wear",
};

/**
 * The resolved table for one app: [type, localSource, kind][].
 *
 * Shaped as tuples because that is what the callers iterate; an unknown type defaults to "dir", which
 * is the only guess that cannot lose data — a directory source that is really a file simply won't exist.
 */
export function playImages(config) {
  const table = config?.google?.images ?? DEFAULT_PLAY_IMAGES;
  return Object.entries(table).map(([type, src]) => [type, src, PLAY_IMAGE_KIND[type] ?? "dir"]);
}

/**
 * Which locales get graphics.
 *
 * Play holds images PER LANGUAGE; uploading only to `defaultLocale` was this portfolio's choice (one
 * untranslated set for every market), not a platform limit, and the code asserted it as though it were
 * one. `google.imageLocales` opts into localized art: a list of language codes, or "*" for every local
 * listing folder. The default stays one set at `defaultLocale`, so nothing changes for an app that never
 * asks. Shared by `fill` and `diff` so they cannot disagree about which locales are even being compared.
 */
export function imageLocales(g, localLangs = []) {
  const want = g?.imageLocales;
  if (!want) return [g.defaultLocale];
  if (want === "*" || (Array.isArray(want) && want.includes("*"))) {
    return localLangs.length ? localLangs : [g.defaultLocale];
  }
  return Array.isArray(want) ? want : [want];
}
