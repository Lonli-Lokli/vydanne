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

// The CLI's own usage text is checked SEPARATELY, and only for commands.
//
// Documenting a command in the README is not the same as making it findable: `appinfo` shipped in
// 0.8.0 registered, typed, and written up in both docs — and absent from `--help`, so the only place
// anyone actually looks for a command never mentioned it. This guard passed, because it was reading
// the prose rather than the tool. A command nobody can discover from the terminal is a command that
// does not exist.
const help = fs.readFileSync(path.join(root, "bin/vydanne.mjs"), "utf8");

const surface = [
  ...CONFIG_KEYS.map((name) => ({ name, kind: "config field" })),
  ...COMMAND_NAMES.map((name) => ({ name, kind: "command" })),
];
const missing = surface.filter(({ name }) => !docs.includes(name));
const unlisted = COMMAND_NAMES.filter((name) => !help.includes(name));

if (missing.length) {
  console.error("✗ docs out of sync with the code — not documented in README.md / SKILL.md:");
  for (const { name, kind } of missing) console.error(`   • ${name}  (${kind})`);
  console.error("\n  Document each (or rename/remove it) so the docs match the public surface, then re-run.");
  process.exit(1);
}
if (unlisted.length) {
  console.error("✗ command(s) missing from `vydanne --help` (bin/vydanne.mjs):");
  for (const name of unlisted) console.error(`   • ${name}`);
  console.error("\n  A command absent from --help is one nobody will find. Add a usage line, then re-run.");
  process.exit(1);
}
console.log(`✓ docs in sync — ${CONFIG_KEYS.length} config fields + ${COMMAND_NAMES.length} commands documented, and all ${COMMAND_NAMES.length} listed in --help.`);
