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
  // Only for codes the built-in table doesn't cover — e.g. if your resource folders use Android's
  // spellings. Merged over the defaults, and an entry naming a code Apple doesn't have is reported.
  // localeMap: { nb: "no", iw: "he" },
  metadataDir: "fastlane/metadata",
  // Defaults to fastlane's supply convention; set it if your repo puts them somewhere else.
  // screenshots: { IOS: "fastlane/screenshots", MAC_OS: "fastlane/screenshots-macos" },

  rating: "4+",
  // Only needed when `rating` is above 4+. Describe the CONTENT — Apple computes the band from it.
  // Merged over an all-NONE base, so declare just what applies. Enum keys take
  // NONE | INFREQUENT_OR_MILD | FREQUENT_OR_INTENSE; the rest are booleans.
  // ageRating: { violenceCartoonOrFantasy: "INFREQUENT_OR_MILD", userGeneratedContent: false },

  // App Review contact. The PII stays in the gitignored fastlane/metadata/review_information/*.txt —
  // including demo_user.txt / demo_password.txt, which is how vydanne decides whether a demo account is
  // required. Set this only to disagree with what's on disk.
  // reviewContact: { demoAccountRequired: false },

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

  // Export compliance. `algorithms` and `statement` are REQUIRED when encryption is "standard" — this
  // generates a US export-compliance PDF that makes factual claims, so it will not guess them for you.
  // `filed` stays false until you have actually emailed the report to BIS and the NSA; while it is
  // false the PDF does not claim it was submitted.
  export: {
    encryption: "standard",
    france: true,
    appName: "Example",
    version: "1.0",
    teamId: "ABCDE12345",
    algorithms: [
      ["Transport", "TLS 1.2 / 1.3", "standard"],
    ],
    statement:
      "The product uses TLS for network transport only. It is a mass-market consumer application " +
      "distributed through public app stores, uses only standard published algorithms, and qualifies " +
      "for export under License Exception ENC, EAR 740.17(b)(1), ECCN 5D002.",
    filed: false,
  },

  // `bridge` maps zdymak's output onto the folders `fill` reads. Defaults cover zdymak's own directory
  // names; override only when a `dir:` in zdymak.config.mjs makes the folder name differ from the
  // target name (e.g. Play's 7" slot, which can only exist as `{ target: 'play-tablet', dir: … }`).
  // bridge: {
  //   out: "./store-assets",
  //   apple: { iphone69: "appstore-iphone-6.9" },
  //   play: { sevenInchScreenshots: "play-tablet7-plain" },
  // },

  // Pipeline steps this app never runs. `--skip` adds to it per invocation; either way every skip is
  // reported at the end, so a green `push` never overstates what it checked.
  // push: { skip: ["accessibility"] },

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
    // 'internal' (default), 'alpha', 'beta', or the name of any closed track you made in Play Console.
    // Only 'production' is refused.
    // track: "internal",
    // Play image type -> local source. Merged over the defaults, so override only what differs.
    // images: { icon: "brand/icons/play/icon-512.png", phoneScreenshots: "marketing/out/play-phone-plain" },
    // Play holds graphics PER LANGUAGE. Default is one set at `defaultLocale`; list locales (or "*")
    // to localize them, and put per-language files in `<source>/<lang>/`.
    // imageLocales: ["en-GB", "de-DE"],
  },
};
