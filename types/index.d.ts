// Type definitions for vydanne — App Store Connect submission prep (companion to zdymak).
// Author a config with:  /** @type {import('vydanne').VydanneConfig} */ export default { … }

export type Platform = 'IOS' | 'MAC_OS';

/** Every vydanne CLI command (kept in sync with src/registry.mjs by scripts/check-types.mjs). */
export type CommandName =
  /**
   * Create (or reuse) the App Store version being prepared and attach the newest build to it.
   * Lands in PREPARE_FOR_SUBMISSION with `releaseType: MANUAL` — it does not submit for review.
   * Required first on an app with a version already on sale: only then does a draft exist for
   * `fill` to write into. Override the version with VYDANNE_VERSION.
   */
  | 'prepare'
  /**
   * The whole release pipeline in its one working order: prepare → fill → previews → age-rating →
   * review-contact → accessibility → preflight. Dry-run without --apply; stops at the first failure;
   * never submits — Add to Review and Submit stay manual.
   */
  | 'push'
  | 'fill'
  /**
   * The two app-level facts that block **Add for Review** and belong to no single release: the App
   * Store category, and whether the app shows third-party content. Set once; re-running is a no-op.
   */
  | 'appinfo'
  | 'age-rating'
  | 'review-contact'
  | 'accessibility'
  | 'privacy'
  | 'previews'
  | 'iap'
  | 'compliance'
  /**
   * Map zdymak's output (`store-assets/<locale>/<target>/NN-name.png`) onto the folders `fill`
   * uploads from — ASC locale codes, device-slot filename prefixes, and the Play read paths.
   * Local files only; `--dry-run` previews. Run after `zdymak screenshots`/`build`, before `fill`.
   */
  | 'bridge'
  | 'inspect'
  | 'diff'
  | 'preflight'
  /**
   * Upload the build for testers: an .ipa to TestFlight (internal groups only), or with
   * `--store google` an .aab to a closed track. Refuses App Store review and `production`.
   */
  | 'prerelease'
  | 'auth'
  | 'locales'
  | 'version';

export interface IapConfig {
  productId: string;
  /** 'non_consumable' | 'consumable' | 'auto_renewable' … */
  type: string;
  price: number;
  /** App Store facing — max 30 chars. */
  displayName: string;
  /** App Store facing — max 45 chars. */
  description: string;
  reviewNote?: string;
}

export interface PreviewSpec {
  platform: Platform;
  /** Apple PreviewType, e.g. 'IPHONE_67' (6.9") | 'IPHONE_65' | 'IPAD_PRO_3GEN_129' | 'DESKTOP'. */
  type: string;
  /** Path to the .mp4 (from zdymak). */
  file: string;
  /** Poster frame, 'HH:MM:SS:FF'. */
  poster?: string;
  /** ASC locale codes to attach the preview to; defaults to the primary locale. */
  locales?: string[];
}

/**
 * Apple's category ids, not display names: upper snake case, and game subcategories are `GAMES_*`
 * ('GAMES_PUZZLE', never 'Puzzle'). Apple takes up to two subcategories per category.
 */
export interface CategoriesConfig {
  primary: string;
  primarySubcategoryOne?: string;
  primarySubcategoryTwo?: string;
  secondary?: string;
  secondarySubcategoryOne?: string;
  secondarySubcategoryTwo?: string;
}

export interface PrivacyConfig {
  /** ASC data-type ids, e.g. ['CRASH_DATA', 'PERFORMANCE_DATA']. */
  collected: string[];
  tracking: boolean;
}

/**
 * Accessibility Nutrition Labels — CLAIMS about your app's behaviour, published to Apple.
 *
 * Every feature is stated explicitly and none is optional: an omission would read as a quiet
 * "no", which is exactly as unverified as a quiet "yes". A missing block is an error rather than
 * a default, because "nobody wrote this down" must never become "supports everything".
 *
 * Apple's platform caveats are applied for you — Larger Text does not exist on macOS, Voice
 * Control does not exist on watchOS — so those are sent as false whatever you declare.
 */
export interface AccessibilityConfig {
  voiceover: boolean;
  voiceControl: boolean;
  largerText: boolean;
  sufficientContrast: boolean;
  darkInterface: boolean;
  differentiateWithoutColorAlone: boolean;
  reducedMotion: boolean;
  captions: boolean;
  audioDescriptions: boolean;
}

export interface IosConfig {
  /** `.ipa` for `prerelease` — a file, or a directory whose NEWEST .ipa is taken. Override: VYDANNE_IPA. */
  ipa?: string;
  /**
   * INTERNAL TestFlight group to add the uploaded build to. External groups are refused:
   * distributing to them requires Beta App Review, which is a submission by another name.
   */
  testFlightGroup?: string;
}

export interface GoogleConfig {
  /** Play package name (usually the same as the iOS bundle id). */
  packageName: string;
  /** Path to the Play service-account JSON. Prefer the PLAY_JSON_KEY_FILE env over committing a path. */
  serviceAccountKey?: string;
  /** Listing-text folders, supply convention. Default 'fastlane/metadata/android'. */
  metadataDir?: string;
  defaultLocale?: string;
  /** `.aab` for `prerelease` — a file, or a directory whose NEWEST .aab is taken. Override: VYDANNE_AAB. */
  aab?: string;
  /**
   * Testing track for `prerelease`. 'internal' (default), 'alpha', 'beta', or the name of any closed
   * track you created in Play Console. Only 'production' is refused — that release is a human's.
   */
  track?: string;
  /**
   * Play image type -> local source path. Merged over the defaults, so declare only what differs.
   * A type whose source does not exist is skipped; a missing local set never deletes the live one.
   */
  images?: Partial<Record<PlayImageType, string>>;
  /**
   * Locales to upload graphics to. Play holds images per language; the default is one set at
   * `defaultLocale`. Pass a list, or '*' for every local listing folder. A `<source>/<lang>`
   * subdirectory, when present, overrides the shared source for that language.
   */
  imageLocales?: string[] | "*";
}

/** Play listing image slots. */
export type PlayImageType =
  | "icon"
  | "featureGraphic"
  | "tvBanner"
  | "phoneScreenshots"
  | "sevenInchScreenshots"
  | "tenInchScreenshots"
  | "wearScreenshots"
  | "tvScreenshots";

/** Where `bridge` reads zdymak's output from, and which directory feeds which store slot. */
export interface BridgeConfig {
  /** zdymak's output root. Read from zdymak.config.mjs when absent; './store-assets' otherwise. */
  out?: string;
  /**
   * Screenshot slot token -> the zdymak output directory it comes from (a name, or names in
   * preference order). Defaults cover zdymak's own target names; override when `dir:` in
   * zdymak.config.mjs makes the directory name differ from the target name.
   */
  apple?: Record<string, string | string[]>;
  /** Play image type -> the zdymak output directory it comes from. Same shape and reason. */
  play?: Partial<Record<PlayImageType, string | string[]>>;
}

/** Overrides for the App Review contact. The PII itself stays in gitignored .txt files. */
export interface ReviewContactConfig {
  /**
   * Whether App Review needs a demo account. Inferred from the presence of
   * `<metadataDir>/review_information/demo_user.txt` when omitted — set it only to disagree.
   */
  demoAccountRequired?: boolean;
}

/** `push` defaults. `--skip` adds to this per invocation. */
export interface PushConfig {
  /** Steps this app never runs. 'prepare' and 'preflight' cannot be skipped. */
  skip?: CommandName[];
}

/**
 * Age-rating content descriptors, for any rating other than '4+'.
 *
 * Merged over an all-NONE base, so declare only what applies. Apple computes the rating band from
 * these — you describe the content, it decides the number. Enum keys take
 * 'NONE' | 'INFREQUENT_OR_MILD' | 'FREQUENT_OR_INTENSE'; the rest are booleans.
 */
export interface AgeRatingConfig {
  advertising?: boolean;
  alcoholTobaccoOrDrugUseOrReferences?: AgeRatingLevel;
  contests?: AgeRatingLevel;
  gambling?: boolean;
  gamblingSimulated?: AgeRatingLevel;
  gunsOrOtherWeapons?: AgeRatingLevel;
  healthOrWellnessTopics?: boolean;
  kidsAgeBand?: "FIVE_AND_UNDER" | "SIX_TO_EIGHT" | "NINE_TO_ELEVEN" | null;
  lootBox?: boolean;
  medicalOrTreatmentInformation?: AgeRatingLevel;
  messagingAndChat?: boolean;
  parentalControls?: boolean;
  profanityOrCrudeHumor?: AgeRatingLevel;
  ageAssurance?: boolean;
  sexualContentGraphicAndNudity?: AgeRatingLevel;
  sexualContentOrNudity?: AgeRatingLevel;
  socialMedia?: boolean;
  socialMediaAgeRestricted?: boolean;
  horrorOrFearThemes?: AgeRatingLevel;
  matureOrSuggestiveThemes?: AgeRatingLevel;
  unrestrictedWebAccess?: boolean;
  userGeneratedContent?: boolean;
  violenceCartoonOrFantasy?: AgeRatingLevel;
  violenceRealisticProlongedGraphicOrSadistic?: AgeRatingLevel;
  violenceRealistic?: AgeRatingLevel;
  ageRatingOverrideV2?: AgeRatingLevel;
  koreaAgeRatingOverride?: AgeRatingLevel;
}

export type AgeRatingLevel = "NONE" | "INFREQUENT_OR_MILD" | "FREQUENT_OR_INTENSE";

export interface ExportConfig {
  /** 'standard' → self-classify (ECCN 5D002, ENC 740.17(b)(1)); else no compliance doc is generated. */
  encryption: string;
  /** Generate/expect the France ANSSI declaration for the France territory. */
  france?: boolean;
  appName?: string;
  version?: string;
  teamId?: string;
  /**
   * The app's cryptography inventory: [purpose, algorithm, keySize] per row. REQUIRED when
   * `encryption` is 'standard' — `compliance` will not invent one, because the PDF it generates makes
   * factual claims to a US export authority.
   */
  algorithms?: Array<[string, string, string?]>;
  /** The statement paragraph, in your own words. REQUIRED when `encryption` is 'standard'. */
  statement?: string;
  /**
   * Set true only once the report has ACTUALLY been emailed to BIS and the NSA. When false (default)
   * the generated PDF does not claim it was submitted.
   */
  filed?: boolean;
}

/** The `vydanne.config.mjs` default export. */
export interface VydanneConfig {
  bundleId: string;
  /** Fallback for every locale without its own listing — must be populated. */
  primaryLocale: string;
  /**
   * Credential SELECTION only — never credentials. This file is committed, so a keyId/issuerId here is
   * refused at load with a warning. Values resolve from the environment, a gitignored `.env`, or
   * `~/.appstoreconnect/config.json`. `profile` picks one entry when that file uses named profiles.
   */
  asc?: { profile?: string };
  /** iOS and macOS are separate ASC platforms. */
  platforms?: Platform[];
  /** App UI locales; mapped to ASC codes (unsupported ones fall back to primary). */
  uiLocales?: string[];
  /**
   * App locale code -> App Store locale code, for codes Apple spells differently or does not know.
   * Merged over the built-in table, so declare only your exceptions. An override naming a code Apple
   * does not have is reported by `locales` and `preflight` rather than silently ignored.
   */
  localeMap?: Record<string, string>;
  metadataDir?: string;
  /**
   * Where each platform's screenshots live. Defaults to fastlane's supply convention
   * ('fastlane/screenshots' and 'fastlane/screenshots-macos'). Read by `fill`, `diff`, `preflight`
   * and written by `bridge`.
   */
  screenshots?: { IOS?: string; MAC_OS?: string };
  /** e.g. '4+'. Anything else needs `ageRating` to say what makes it that. */
  rating?: string;
  /** Content descriptors for a rating above '4+'. Merged over an all-NONE base. */
  ageRating?: AgeRatingConfig;
  /**
   * App Store category, written by `appinfo`. Apple blocks Add for Review without a primary one, and
   * subcategories are valid only under `'GAMES'`.
   */
  categories?: CategoriesConfig;
  /**
   * Does the app contain, show or access THIRD-PARTY content? Also blocks Add for Review. Left
   * undefined it is not written at all, so an answer already given in App Store Connect is never
   * overwritten by a default nobody chose — this is a declaration to Apple, not a preference.
   */
  contentRights?: boolean;
  privacy?: PrivacyConfig;
  iaps?: IapConfig[];
  previews?: PreviewSpec[];
  export?: ExportConfig;
  /** What the app actually supports, for the Accessibility Nutrition Labels. Required by that command. */
  accessibility?: AccessibilityConfig;
  /** iOS build upload (`prerelease`): where the .ipa is, and which internal TestFlight group. */
  ios?: IosConfig;
  /** Google Play (`--store google`): listings, screenshots, feature graphic via the Edits API. */
  google?: GoogleConfig;
  /** Where `bridge` reads zdymak's output from, and which directory feeds which store slot. */
  bridge?: BridgeConfig;
  /** `push` defaults — steps this app never runs. */
  push?: PushConfig;
  /** App Review contact overrides (the PII itself stays in gitignored .txt files). */
  reviewContact?: ReviewContactConfig;
  /**
   * Terms the cross-store check must not flag for this app.
   *
   * `preflight` and `fill` refuse listing text that names the OTHER mobile platform — App Review
   * guideline 2.3.10 and Google Play's Store Listing and Promotion policy both reject it. Use this
   * only for a word that genuinely belongs in your copy (a game about fruit really does say
   * "apple"); it is not a way to ship a store name.
   */
  allowCrossStoreTerms?: string[];
}

/** Thin ASC REST client (native fetch + ES256 JWT). */
export declare class Client {
  constructor(opts: { keyId: string; issuerId: string; dryRun?: boolean });
  token: string;
  appId?: string;
  app?: unknown;
  /** When true, no POST/PATCH/PUT/DELETE leaves the process — each is recorded in `planned` instead. */
  dryRun: boolean;
  /** The mutations a real run would have sent, in order. Populated only while `dryRun`. */
  planned: Array<{ method: string; path: string; attributes: Record<string, unknown> }>;
  findApp(bundleId: string): Promise<unknown>;
  get(path: string, opts?: { iris?: boolean }): Promise<{ status: number; json: any }>;
  post(path: string, body: unknown): Promise<{ status: number; json: any }>;
  patch(path: string, body: unknown): Promise<{ status: number; json: any }>;
  del(path: string): Promise<{ status: number; json: any }>;
  /**
   * The version being prepared, or null when none exists. `allowLive` (read-only commands only) falls
   * back to the version on sale; writes must never target it.
   */
  editVersion(platform: Platform, opts?: { allowLive?: boolean }): Promise<any>;
  /**
   * The app-info being prepared (name/subtitle, age rating), or null when none exists. `allowLive`
   * (read-only commands only) falls back to the live record; writes must never target it.
   */
  appInfo(opts?: { allowLive?: boolean }): Promise<any>;
  versionLocalizations(versionId: string): Promise<any[]>;
  localization(id: string, kind?: string): Promise<Record<string, unknown>>;
}

/** Play Developer Edits API client. Every mutation happens inside an Edit; an uncommitted Edit is a no-op. */
export declare class PlayClient {
  static create(opts: { keyPath: string; packageName: string; dryRun?: boolean }): Promise<PlayClient>;
  dryRun: boolean;
  newEdit(): Promise<string>;
  validate(editId: string): Promise<{ status: number; json: any }>;
  commit(editId: string): Promise<{ status: number; json: any }>;
  deleteEdit(editId: string): Promise<unknown>;
  getListings(editId: string): Promise<{ status: number; json: any }>;
  putListing(editId: string, lang: string, body: Record<string, unknown>): Promise<{ status: number; json: any }>;
  listImages(editId: string, lang: string, type: string): Promise<{ status: number; json: any }>;
  deleteAllImages(editId: string, lang: string, type: string): Promise<unknown>;
  uploadImage(editId: string, lang: string, type: string, file: string): Promise<unknown>;
}

export type Store = "apple" | "google";

/**
 * Run one command, the way the CLI runs it — minus argv parsing and process.exit.
 *
 * `apply` defaults to FALSE, the same safety gate `--apply` drives: a caller that forgets it gets a
 * dry run, never a write. `planned` is the machine-readable form of the writes a dry run withheld.
 */
export declare function runCommand(
  name: string,
  opts?: {
    config?: VydanneConfig;
    configPath?: string;
    store?: Store;
    apply?: boolean;
  },
): Promise<{ ok: boolean; planned: Array<{ method: string; path: string; attributes: Record<string, unknown> }> }>;

export declare function loadConfig(path?: string): Promise<ResolvedConfig>;
export declare function makeToken(opts: { keyId: string; issuerId: string; keyPath?: string }): string;
export declare function resolveLocales(uiCodes: string[], extra?: Record<string, string>): ResolvedLocales;
export declare function toAsc(code: string, extra?: Record<string, string>): string | null;
export declare const VALID: Set<string>;
export declare const UI_TO_ASC: Record<string, string>;
export declare const CONFIG_KEYS: readonly string[];
export declare const COMMAND_NAMES: readonly CommandName[];

/** Screenshot filename prefix -> ASC display type, per platform. */
export declare const IOS_DEVICE: Record<string, string>;
export declare const MAC_DEVICE: Record<string, string>;
export declare const DEFAULT_SCREENSHOT_BASE: { IOS: string; MAC_OS: string };
/** Where this platform's screenshots live: `screenshots` in the config, else the supply convention. */
export declare function screenshotBase(platform: Platform, config?: VydanneConfig): string;

export declare const DEFAULT_PLAY_IMAGES: Partial<Record<PlayImageType, string>>;
export declare const PLAY_IMAGE_KIND: Record<PlayImageType, "file" | "dir">;
/** The resolved Play image table for one app: [type, localSource, kind][]. */
export declare function playImages(config: VydanneConfig): Array<[string, string, "file" | "dir"]>;

/** `writes` marks a command that mutates the STORE — those are dry-run unless the CLI gets `--apply`.
 *  `credentials` marks the one command (prerelease) whose altool child authenticates itself. */
export declare const COMMANDS: Record<string, { mod: string; client?: boolean; credentials?: boolean; writes?: boolean }>;
/** The same, for `--store google`. Same names, different backend. */
export declare const PLAY_COMMANDS: Record<string, { mod: string; writes?: boolean }>;

export interface ResolvedLocales {
  supported: Record<string, string>;
  /** Codes with no App Store language — they fall back to the primary listing. */
  unsupported: string[];
  /** `localeMap` entries pointing at a code Apple does not have. A config mistake, not a missing language. */
  invalid: string[];
}

export type ResolvedConfig = VydanneConfig & { resolvedLocales: ResolvedLocales };

// NOTE: this is a TYPE-only default export — `import type cfg from "vydanne"`. There is no runtime
// default export, so `import cfg from "vydanne"` in JS gets undefined. Import the named values.
export default VydanneConfig;
