import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { resolveLocales } from "./locales.mjs";
import { resolveCredentials } from "./credentials.mjs";

// The public config surface — the drift guards assert each key is documented (README/SKILL) and typed
// (types/index.d.ts). Add a config knob → document + type it, or the guards fail before publish.
export const CONFIG_KEYS = ["bundleId", "primaryLocale", "asc", "platforms", "uiLocales", "metadataDir", "rating", "privacy", "iaps", "previews", "export", "google"];

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
  const c = {
    raw,
    credentials: creds,
    bundleId: need("bundleId"),
    primaryLocale: need("primaryLocale"),
    keyId: creds.keyId,
    issuerId: creds.issuerId,
    uiLocales: raw.uiLocales || [],
    platforms: raw.platforms || ["IOS"],
    rating: raw.rating || "4+",
    privacy: raw.privacy || { collected: ["CRASH_DATA", "PERFORMANCE_DATA"], tracking: false },
    iaps: raw.iaps || [],
    metadataDir: raw.metadataDir || "fastlane/metadata",
    previews: raw.previews || null,
    export: raw.export || { encryption: "standard" },
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

        }
      : null,
  };
  c.resolvedLocales = resolveLocales(c.uiLocales);
  return c;
}
