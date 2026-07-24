// Type definitions for vydanne — App Store Connect submission prep (companion to zdymak).
// Author a config with:  /** @type {import('vydanne').VydanneConfig} */ export default { … }

export type Platform = 'IOS' | 'MAC_OS';

/** Every vydanne CLI command (kept in sync with src/registry.mjs by scripts/check-types.mjs). */
export type CommandName =
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

export interface GoogleConfig {
  /** Play package name (usually the same as the iOS bundle id). */
  packageName: string;
  /** Path to the Play service-account JSON. Prefer the PLAY_JSON_KEY_FILE env over committing a path. */
  serviceAccountKey?: string;
  /** Listing-text folders, supply convention. Default 'fastlane/metadata/android'. */
  metadataDir?: string;
  defaultLocale?: string;
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
  /** Prefer ASC_KEY_ID / ASC_ISSUER_ID env over putting these in the config. */
  asc?: { keyId?: string; issuerId?: string };
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
  /** Google Play (`--store google`): listings, screenshots, feature graphic via the Edits API. */
  google?: GoogleConfig;
}

/** Thin ASC REST client (native fetch + ES256 JWT). */
export declare class Client {
  constructor(opts: { keyId: string; issuerId: string });
  token: string;
  appId?: string;
  app?: unknown;
  findApp(bundleId: string): Promise<unknown>;
  get(path: string, opts?: { iris?: boolean }): Promise<{ status: number; json: any }>;
  post(path: string, body: unknown): Promise<{ status: number; json: any }>;
  patch(path: string, body: unknown): Promise<{ status: number; json: any }>;
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
export declare const COMMANDS: Record<string, { mod: string; client: boolean }>;

export default VydanneConfig;
