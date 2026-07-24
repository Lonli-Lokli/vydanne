import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Credential resolution, so nobody has to paste `ASC_KEY_ID=… ASC_ISSUER_ID=…` in front of every command.
 *
 * CREDENTIALS NEVER COME FROM `vydanne.config.mjs`. That file is committed, and a repo may be public —
 * so the config carries no keyId, no issuerId, no key paths. It may only name an `asc.profile`, which is
 * a label, not a secret. If credentials ARE found there we refuse them and say so.
 *
 * Sources, highest priority first:
 *   1. process.env       — CI secrets and one-off overrides. Always wins.
 *   2. the .env cascade  — per-repo, the usual local-dev idiom (see ENV_FILES).
 *   3. the user file     — the ACCOUNT-level default, outside every repo (see CONFIG_CANDIDATES).
 *
 * (3) is the answer for a portfolio: one App Store Connect account, many repos. Write it once and every
 * consumer picks it up with zero per-repo setup and nothing secret in any repo:
 *
 *   { "keyId": "ABCD123456", "issuerId": "69a6de70-…", "playJsonKeyFile": "~/.config/play/sa.json" }
 *
 * Shipping under more than one account? Use named profiles, selected with `VYDANNE_PROFILE`, or pinned
 * per app via `asc: { profile: "client-x" }` — a name, still not a secret:
 *
 *   { "default": "kupalinka",
 *     "profiles": { "kupalinka": { "keyId": "…", "issuerId": "…" },
 *                   "client-x":  { "keyId": "…", "issuerId": "…" } } }
 *
 * The .p8 is never read here — it stays at ~/.appstoreconnect/private_keys/AuthKey_<keyId>.p8 (jwt.mjs),
 * so the private key is never pasted into a repo, a CI variable, or a shell history.
 */

/**
 * Where the account-level file may live, best-match first. There is no single cross-platform home for
 * this, so all three are honoured rather than forcing one on everybody:
 *
 *  - `$VYDANNE_CONFIG_HOME/config.json` — explicit escape hatch (shared drives, a secrets mount, tests).
 *  - The OS config dir — `%APPDATA%\vydanne\` on Windows, `$XDG_CONFIG_HOME` (default `~/.config`)
 *    elsewhere. This is what a Windows or Linux user expects; `~/.appstoreconnect` is neither.
 *  - `~/.appstoreconnect/config.json` — beside the keys. Apple's own tooling (and fastlane) already put
 *    the .p8 in `~/.appstoreconnect/private_keys` on every platform, so credentials and key sit together.
 */
export function configCandidates(env = process.env, home = os.homedir()) {
  const out = [];
  if (env.VYDANNE_CONFIG_HOME) out.push(path.join(env.VYDANNE_CONFIG_HOME, "config.json"));
  const osConfigDir = process.platform === "win32"
    ? env.APPDATA || path.join(home, "AppData", "Roaming")
    : env.XDG_CONFIG_HOME || path.join(home, ".config");
  out.push(path.join(osConfigDir, "vydanne", "config.json"));
  out.push(path.join(home, ".appstoreconnect", "config.json"));
  return out;
}

/** The first candidate that exists, or null. */
export function findConfigFile(env = process.env, home = os.homedir()) {
  return configCandidates(env, home).find((p) => fs.existsSync(p)) || null;
}

/**
 * The standard `.env` cascade, lowest priority first — the same shape Vite/Next users already know, so
 * `.env` stays COMMITTABLE (shared, non-secret defaults) and only `*.local` holds secrets. That is why
 * only `*.local` belongs in .gitignore; ignoring `.env` outright fights the convention.
 *
 * `mode` comes from VYDANNE_ENV (or NODE_ENV) and is optional — with none set this is just
 * `.env` then `.env.local`.
 */
export function envFiles(cwd, mode) {
  const files = [".env"];
  if (mode) files.push(`.env.${mode}`);
  files.push(".env.local");
  if (mode) files.push(`.env.${mode}.local`);
  return files.map((f) => path.join(cwd, f));
}

/** Expand a leading `~` so the user file can hold portable paths. */
export function expandHome(p, home = os.homedir()) {
  if (!p || typeof p !== "string") return p;
  return p.startsWith("~/") || p === "~" ? path.join(home, p.slice(1)) : p;
}

/** Read the account-level file, resolving the profile if it uses the named-profile form. */
function readUserConfig(file, profile, env, warn) {
  if (!file) return {};
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    warn(`${file} is not valid JSON (${e.message}) — ignored`);
    return {};
  }
  let values = json;
  if (json.profiles) {
    const name = profile || env.VYDANNE_PROFILE || json.default;
    if (!name) {
      warn(`${file} has profiles but no "default" — set one, or pass VYDANNE_PROFILE`);
      return {};
    }
    values = json.profiles[name];
    if (!values) {
      warn(`${file} has no profile "${name}" (have: ${Object.keys(json.profiles).join(", ")})`);
      return {};
    }
  }
  // A credentials file readable by anyone on the machine is worth one line of noise. POSIX only —
  // Windows ACLs don't map onto the mode bits, so checking there would just produce false alarms.
  try {
    if (process.platform !== "win32" && fs.statSync(file).mode & 0o004) {
      warn(`${file} is world-readable — run: chmod 600 ${file}`);
    }
  } catch { /* a stat failure is not worth failing the run over */ }
  return values || {};
}

/**
 * Resolve every credential, recording WHERE each value came from so `vydanne auth` can explain itself —
 * "it isn't picking up my key" is otherwise pure guesswork.
 */
export function resolveCredentials(raw = {}, cwd = process.cwd(), env = process.env, home = os.homedir()) {
  const warnings = [];
  const warn = (m) => warnings.push(m);

  // Parsed, NOT loaded into process.env: dotenv.config() would mutate the environment and quietly
  // destroy the precedence order below. Later files win, per the cascade.
  const mode = env.VYDANNE_ENV || env.NODE_ENV || "";
  const dotenvValues = {};
  const dotenvFrom = {};
  for (const file of envFiles(cwd, mode)) {
    if (!fs.existsSync(file)) continue;
    const parsed = dotenv.parse(fs.readFileSync(file));
    for (const [k, v] of Object.entries(parsed)) {
      dotenvValues[k] = v;
      dotenvFrom[k] = path.relative(cwd, file) || path.basename(file);
    }
  }

  const userFile = findConfigFile(env, home);
  const user = readUserConfig(userFile, raw.asc?.profile, env, warn);

  // Secrets in the committed config are refused, not silently honoured — otherwise the one machine that
  // "works" is the one leaking them, and nobody notices until the repo goes public.
  if (raw.asc?.keyId || raw.asc?.issuerId || raw.google?.serviceAccountKey) {
    warn(`credentials found in vydanne.config.mjs (that file is committed) — IGNORED. Move them to ${userFile || configCandidates(env, home)[0]} or .env.local`);
  }

  const sources = {};
  const pick = (envKey, userKey) => {
    if (env[envKey]) return (sources[envKey] = "environment"), env[envKey];
    if (dotenvValues[envKey]) return (sources[envKey] = dotenvFrom[envKey]), dotenvValues[envKey];
    if (user[userKey]) return (sources[envKey] = userFile), user[userKey];
    sources[envKey] = null;
    return undefined;
  };

  return {
    keyId: pick("ASC_KEY_ID", "keyId"),
    issuerId: pick("ASC_ISSUER_ID", "issuerId"),
    playJsonKeyFile: expandHome(pick("PLAY_JSON_KEY_FILE", "playJsonKeyFile"), home),
    sources,
    warnings,
    userFile,
    candidates: configCandidates(env, home),
  };
}
