#!/usr/bin/env node
/**
 * Doc-sync guard — fails if the public surface has drifted from the docs.
 *
 * Every config field (`CONFIG_KEYS`) and every command (`COMMAND_NAMES`) must be mentioned verbatim in
 * README.md or SKILL.md. Add a public knob/command without documenting it and this fails, so the docs
 * can't silently fall behind the code. Runs on `prepublishOnly`.
 *
 *   node scripts/check-docs.mjs        (or: npm run check:docs)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_KEYS } from "../src/config.mjs";
import { COMMAND_NAMES } from "../src/registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = ["README.md", "SKILL.md"].map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");

const surface = [
  ...CONFIG_KEYS.map((name) => ({ name, kind: "config field" })),
  ...COMMAND_NAMES.map((name) => ({ name, kind: "command" })),
];
const missing = surface.filter(({ name }) => !docs.includes(name));

if (missing.length) {
  console.error("✗ docs out of sync with the code — not documented in README.md / SKILL.md:");
  for (const { name, kind } of missing) console.error(`   • ${name}  (${kind})`);
  console.error("\n  Document each (or rename/remove it) so the docs match the public surface, then re-run.");
  process.exit(1);
}
console.log(`✓ docs in sync — ${CONFIG_KEYS.length} config fields + ${COMMAND_NAMES.length} commands all documented.`);
