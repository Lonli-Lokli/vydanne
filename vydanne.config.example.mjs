// vydanne — one ESM file describes an app for App Store Connect (like zdymak.config.mjs). Copy to
// `vydanne.config.mjs` and edit. Secrets never live here: ASC key at
// ~/.appstoreconnect/private_keys/AuthKey_<id>.p8 + ASC_KEY_ID / ASC_ISSUER_ID env; review-contact PII in
// the gitignored fastlane/metadata/review_information/.
export default {
  bundleId: "com.example.app",
  primaryLocale: "en-GB", // fallback for every locale without its own listing — MUST be populated
  platforms: ["IOS", "MAC_OS"], // macOS is a SEPARATE platform; its listing text is NOT shared with iOS

  // asc: { keyId: "…", issuerId: "…" },   // prefer ASC_KEY_ID / ASC_ISSUER_ID env

  // The app's UI locales. vydanne maps each to its ASC App Store code (de -> de-DE, ar -> ar-SA …) and
  // flags any with no App Store language (e.g. Belarusian `be`) so you never abort an upload on a bad name.
  uiLocales: ["en", "de", "es", "fr", "ja", "zh-Hans"],
  metadataDir: "fastlane/metadata",

  rating: "4+",

  // Honest, minimal privacy — "accesses" is not "collects"; E2EE content the developer can't read is not
  // collected. Declare only what actually leaves the device to you.
  privacy: { collected: ["CRASH_DATA", "PERFORMANCE_DATA"], tracking: false },

  iaps: [
    {
      productId: "com.example.app.unlock",
      type: "non_consumable",
      price: 19.99,
      displayName: "Unlock App", // <= 30 chars (App Store facing)
      description: "Unlock the full app forever. Buy once.", // <= 45 chars
      reviewNote: "Non-consumable buy-once unlock; free to try, then unlocks forever. No account; reviewer can test via StoreKit sandbox.",
    },
  ],

  // App Preview videos (from zdymak). type per Apple's PreviewType (IPHONE_67 = 6.9", DESKTOP = Mac).
  previews: [
    { platform: "IOS", type: "IPHONE_67", file: "marketing/out/appstore-preview.mp4", poster: "00:00:05:00", locales: ["en-GB", "en-US"] },
  ],

  export: { encryption: "standard", france: true, appName: "Example", version: "1.0", teamId: "ABCDE12345" },

  // Google Play (optional). Add this block + set PLAY_JSON_KEY_FILE to the service-account JSON, then run
  // any command with `--store google`. Package-SCOPED: vydanne only ever touches THIS packageName — a
  // shared account key can never mutate another app. The listing lives in <metadataDir>/<play-locale>/ as
  // title.txt (<=30) / short_description.txt (<=80) / full_description.txt (<=4000). Play uses its OWN
  // locale codes (de-DE, es-ES, zh-CN, iw-IL, ar, ur, be … — NOT Apple's), so each folder is named for the
  // Play code. Store graphics come from zdymak, auto-skipped when absent:
  //   brand/icons/play/icon-512.png (512 icon) · marketing/out/play-feature-graphic.png (1024x500) ·
  //   play-phone-plain/ · play-tablet7-plain/ (7") · play-tablet-plain/ (10"). The AAB binary stays with
  //   fastlane; the promo video is a YouTube URL (set in Play Console). `fill --store google` is DRY unless
  //   VYDANNE_COMMIT=1.
  google: {
    packageName: "com.example.app",
    metadataDir: "fastlane/metadata/android",
    defaultLocale: "en-GB",
  },
};
