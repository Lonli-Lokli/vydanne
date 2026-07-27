#!/usr/bin/env node
/**
 * Load-sync guard — the third sibling of check-docs.mjs and check-types.mjs.
 *
 * Those two assert every `CONFIG_KEYS` entry is DOCUMENTED and TYPED. Neither asserts it is actually
 * READ, and `loadConfig()` builds its result from a hand-written object literal — so a key could be
 * documented, typed, and still silently dropped on the floor.
 *
 * That is not hypothetical: `ios` and `accessibility` were both in CONFIG_KEYS, both documented, both
 * typed, and neither was ever assigned. `config.ios` was therefore always undefined, so `prerelease`
 * reported "no .ipa found — set `ios.ipa` in the config" while `ios.ipa` sat correctly in the config
 * (the message names the very knob being ignored, which is what made it so hard to see), and
 * `accessibility` refused to run with "accessibility: missing." against a fully declared block. Both
 * cost a debugging session; both would have failed this guard the moment the key was added.
 *
 *   node scripts/check-config.mjs        (or: npm run check:config)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_KEYS } from "../src/config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src/config.mjs"), "utf8");

/**
 * Keys the loader legitimately never copies onto its result, with the reason. Anything else missing is
 * a bug — keep this list a list of decisions, not a place to silence a failure.
 *
 *   asc — credential SELECTION only (`asc: { profile }`). resolveCredentials() reads it off `raw` and
 *         returns resolved ids; copying the selector through would invite reading it instead of them.
 */
const RAW_ONLY = new Map([["asc", "read from `raw` by resolveCredentials()"]]);

// The literal `loadConfig` returns, from `const c = {` to its closing `};`. Scoping to it matters: every
// one of these names also appears in this file as `raw.<key>`, so a whole-file search always passes.
const start = src.indexOf("const c = {");
const end = src.indexOf("\n  };", start);
if (start < 0 || end < 0) {
  console.error("✗ could not find loadConfig's returned object literal in src/config.mjs");
  console.error("  This guard reads that literal by shape; if it was refactored, update the guard.");
  process.exit(1);
}
const literal = src.slice(start, end);

/** Assigned only if it appears as a KEY in that literal (`name:`), not merely mentioned. */
const assigns = (name) => new RegExp(`^\\s*${name}\\s*:`, "m").test(literal);

const missing = CONFIG_KEYS.filter((k) => !RAW_ONLY.has(k) && !assigns(k));

if (missing.length) {
  console.error("✗ config keys documented and typed but never LOADED — `config.<key>` will be undefined:");
  for (const n of missing) console.error(`   • ${n}`);
  console.error("\n  Assign each in loadConfig's returned object in src/config.mjs (or, if a command is");
  console.error("  meant to read it off `raw`, add it to RAW_ONLY here with the reason), then re-run.");
  process.exit(1);
}
const noted = [...RAW_ONLY.keys()].join(", ");
console.log(`✓ config in sync — ${CONFIG_KEYS.length - RAW_ONLY.size} keys loaded (raw-only: ${noted}).`);
