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
  | 'fill'
  | 'age-rating'
  | 'review-contact'
  | 'accessibility'
  | 'privacy'
  | 'previews'
  | 'iap'
  | 'compliance'
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
  /** Testing track for `prerelease`: 'internal' (default) | 'alpha' | 'beta'. 'production' is refused. */
  track?: "internal" | "alpha" | "beta";
}

export interface ExportConfig {
  /** 'standard' → self-classify (ECCN 5D002, ENC 740.17(b)(1)); else no compliance doc is generated. */
  encryption: string;
  /** Generate/expect the France ANSSI declaration for the France territory. */
  france?: boolean;
  appName?: string;
  version?: string;
  teamId?: string;
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
  metadataDir?: string;
  /** e.g. '4+'. */
  rating?: string;
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
  editVersion(platform: Platform): Promise<any>;
  appInfo(): Promise<any>;
  versionLocalizations(versionId: string): Promise<any[]>;
  localization(id: string, kind?: string): Promise<Record<string, unknown>>;
}

export declare function loadConfig(path?: string): Promise<VydanneConfig & { resolvedLocales: { supported: Record<string, string>; unsupported: string[] } }>;
export declare function makeToken(opts: { keyId: string; issuerId: string; keyPath?: string }): string;
export declare function resolveLocales(uiCodes: string[]): { supported: Record<string, string>; unsupported: string[] };
export declare function toAsc(code: string): string | null;
export declare const VALID: Set<string>;
export declare const CONFIG_KEYS: readonly string[];
export declare const COMMAND_NAMES: readonly CommandName[];
/** `writes` marks a command that mutates the STORE — those are dry-run unless the CLI gets `--apply`. */
export declare const COMMANDS: Record<string, { mod: string; client: boolean; writes?: boolean }>;

export default VydanneConfig;
