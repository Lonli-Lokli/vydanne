import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { resolveLocales } from "./locales.mjs";
import { resolveCredentials } from "./credentials.mjs";
import { DEFAULT_SCREENSHOT_BASE } from "./screenshots.mjs";
import { DEFAULT_PLAY_IMAGES } from "./play/images.mjs";

// The public config surface — the drift guards assert each key is documented (README/SKILL) and typed
// (types/index.d.ts). Add a config knob → document + type it, or the guards fail before publish.
export const CONFIG_KEYS = ["bundleId", "primaryLocale", "asc", "platforms", "uiLocales", "localeMap", "metadataDir", "screenshots", "rating", "ageRating", "categories", "contentRights", "privacy", "iaps", "previews", "export", "ios", "google", "accessibility", "bridge", "push", "reviewContact", "allowCrossStoreTerms"];

// One `vydanne.config.mjs` per app (ESM, like zdymak.config.mjs) — nothing hard-coded. Secrets stay out:
// credentials resolve from the environment, a gitignored .env, or ~/.appstoreconnect/config.json (see
// credentials.mjs) and are REFUSED if found in this committed file; review-contact PII stays gitignored.
export async function loadConfig(p) {
  const file = path.resolve(p || process.env.VYDANNE_CONFIG || "vydanne.config.mjs");
  if (!fs.existsSync(file)) throw new Error(`vydanne: config not found at ${file}`);
  const mod = await import(pathToFileURL(file).href);
  const raw = mod.default || mod;
  const need = (k) => {
    if (raw[k] == null) throw new Error(`vydanne: config missing '${k}'`);
    return raw[k];
  };
  const creds = resolveCredentials(raw, path.dirname(file));
  for (const w of creds.warnings) console.warn(`\x1b[33mvydanne: ${w}\x1b[0m`);
  // No `raw` passthrough, deliberately. It was assigned here and read by nothing — an attractive
  // nuisance rather than dead weight: while `config.ios` sat unassigned (the bug check-config.mjs now
  // guards), `config.raw.ios` WAS populated, so "fixing" a caller by reading through `raw` would have
  // entrenched the dropped key instead of exposing it. Everything a command may read is an explicit
  // key below, where the guard can see it.
  const c = {
    credentials: creds,
    bundleId: need("bundleId"),
    primaryLocale: need("primaryLocale"),
    keyId: creds.keyId,
    issuerId: creds.issuerId,
    uiLocales: raw.uiLocales || [],
    // App code -> App Store locale, for codes Apple spells differently or does not know yet. Merged over
    // the built-in table rather than replacing it, so an app declares only its exceptions.
    localeMap: raw.localeMap || null,
    platforms: raw.platforms || ["IOS"],
    rating: raw.rating || "4+",
    // Content descriptors for a rating above 4+. Null means "the 4+ shorthand", which `age-rating`
    // expands to an all-NONE declaration; anything else must be declared, never guessed.
    ageRating: raw.ageRating || null,
    // App Store category, and whether the app shows third-party content. Both block Add for Review
    // and neither has a safe default: a category guessed on the app's behalf is a shelf it did not
    // choose, and a content-rights answer guessed on its behalf is a DECLARATION TO APPLE nobody
    // made. So both stay null/undefined until declared, and `appinfo` refuses rather than assumes.
    categories: raw.categories || null,
    contentRights: raw.contentRights,
    privacy: raw.privacy || { collected: ["CRASH_DATA", "PERFORMANCE_DATA"], tracking: false },
    iaps: raw.iaps || [],
    metadataDir: raw.metadataDir || "fastlane/metadata",
    // Where each platform's screenshots live. fastlane's supply convention by default — the same
    // relationship `metadataDir` has always had to it, and for the same reason: a convention worth
    // defaulting to is not a reason to be unable to point the tool at your own repo.
    screenshots: raw.screenshots
      ? { IOS: raw.screenshots.IOS || DEFAULT_SCREENSHOT_BASE.IOS, MAC_OS: raw.screenshots.MAC_OS || DEFAULT_SCREENSHOT_BASE.MAC_OS }
      : null,
    // App Review contact overrides. The PII itself still comes from the gitignored
    // `<metadataDir>/review_information/*.txt` — this is only for what isn't a secret.
    reviewContact: raw.reviewContact || null,
    // `push: { skip: [...] }` — steps this app never runs. `--skip` adds to it per invocation; both are
    // reported on every run, because a skipped step must never read as a completed one.
    push: raw.push ? { skip: raw.push.skip || [] } : null,
    // `bridge`: where zdymak wrote, and which of its output directories feed which store slot. Both
    // default to zdymak's own conventions; both must be overridable, because `dir:` overrides in
    // zdymak.config.mjs mean the directory name and the target name are not the same thing.
    bridge: raw.bridge
      ? { out: raw.bridge.out || null, apple: raw.bridge.apple || null, play: raw.bridge.play || null }
      : null,
    // Terms the cross-store check must not flag for this app (see src/crossStore.mjs).
    allowCrossStoreTerms: raw.allowCrossStoreTerms || [],
    previews: raw.previews || null,
    export: raw.export || { encryption: "standard" },
    // What the app claims to support, for the Accessibility Nutrition Labels. Passed through RAW and
    // deliberately NOT defaulted: `accessibility` validates its own block and must be able to tell
    // "declared nothing" from "declared everything false" — a default here would turn a missing block
    // into a silent set of claims, which is the one thing that command exists to refuse.
    accessibility: raw.accessibility || null,
    // iOS build upload (`prerelease`). Normalised like `google` below so the shape is stable whether or
    // not the block is present.
    ios: raw.ios
      ? {
          ipa: raw.ios.ipa || null, // VYDANNE_IPA overrides, resolved in prerelease.resolveIpa
          testFlightGroup: raw.ios.testFlightGroup || null, // internal groups only; external is refused
        }
      : null,
    // Google Play. serviceAccountKey resolves from PLAY_JSON_KEY_FILE env first (keep the secret path out
    // of the committed config). metadataDir follows fastlane supply's convention (fastlane/metadata/android).
    google: raw.google
      ? {
          packageName: raw.google.packageName || raw.bundleId,
          serviceAccountKey: creds.playJsonKeyFile,
          metadataDir: raw.google.metadataDir || "fastlane/metadata/android",
          defaultLocale: raw.google.defaultLocale || raw.primaryLocale,
          aab: raw.google.aab || null,
          track: raw.google.track || "internal", // testing only — `prerelease` refuses production
          // What state a new release is created in: draft | inProgress | halted | completed.
          // Left null so `prerelease` keeps its own default ("completed"). The one case that needs
          // it is an app that has never been published — Play calls that a "draft app" and refuses
          // a completed release on any track but internal, so the first closed or open rollout has
          // to be created as "draft" and started by a person in Console.
          releaseStatus: raw.google.releaseStatus || null,
          // Play image type -> local source path. Merged over the defaults so an app overrides only the
          // slots whose layout differs; the default for `icon` points at znachok's output, which is a
          // sensible default for this portfolio and a mystery to anyone else, so it is overridable.
          images: { ...DEFAULT_PLAY_IMAGES, ...(raw.google.images || {}) },
          // Play supports per-language graphics. Uploading only to `defaultLocale` is a choice, not a
          // platform limit — list locales here (or "*" for every local listing folder) to localize them.
          imageLocales: raw.google.imageLocales || null,
        }
      : null,
  };
  c.resolvedLocales = resolveLocales(c.uiLocales, c.localeMap);
  return c;
}
