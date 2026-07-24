#!/usr/bin/env node
/**
 * Type-sync guard — the `.d.ts` sibling of check-docs.mjs.
 *
 * Every config field (`CONFIG_KEYS`) must be DECLARED (`name?: T`) and every command (`COMMAND_NAMES`)
 * must appear as a string-literal member in types/index.d.ts. Add a public knob/command without typing it
 * and this fails, so consumers' configs can't silently lose coverage. Runs via `npm run check:types`
 * (after `tsc --noEmit`) and on `prepublishOnly`.
 *
 *   node scripts/check-types.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_KEYS } from "../src/config.mjs";
import { COMMAND_NAMES } from "../src/registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dts = fs.readFileSync(path.join(root, "types/index.d.ts"), "utf8");

/** A config key counts as typed only if it's DECLARED (`name?: T` / `name: T`), not just mentioned. */
const declares = (name) => new RegExp(`^\\s*${name}\\??\\s*:`, "m").test(dts);
/** A command counts as typed if it appears as a string-literal union member (either quote style). */
const hasLiteral = (id) => dts.includes(`'${id}'`) || dts.includes(`"${id}"`);

const missing = [
  ...CONFIG_KEYS.filter((k) => !declares(k)).map((n) => ({ n, kind: "config field" })),
  ...COMMAND_NAMES.filter((k) => !hasLiteral(k)).map((n) => ({ n, kind: "command" })),
];

if (missing.length) {
  console.error("✗ types out of sync with the code — not declared in types/index.d.ts:");
  for (const { n, kind } of missing) console.error(`   • ${n}  (${kind})`);
  console.error("\n  Declare each in the .d.ts (or rename/remove it), then re-run.");
  process.exit(1);
}
console.log(`✓ types in sync — ${CONFIG_KEYS.length} config fields + ${COMMAND_NAMES.length} commands all declared.`);
