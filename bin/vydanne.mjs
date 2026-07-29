#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";
import { Client } from "../src/client.mjs";
import { COMMANDS, PLAY_COMMANDS } from "../src/registry.mjs";
import { yellow } from "../src/util.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const i = argv.indexOf("--config");
const cfgPath = i >= 0 ? argv[i + 1] : undefined;
const si = argv.indexOf("--store");
const store = si >= 0 ? argv[si + 1] : "apple";
// Validated, because the dispatch below only tests `store === "google"`: a typo (`--store goole`) or a
// missing value (`--store --apply`) would otherwise fall through to the APPLE branch and aim the command
// at the other store — the worst possible reading of a mistyped argument, and a silent one, since every
// Apple command runs happily from a repo configured for both.
if (store !== "apple" && store !== "google") {
  console.error(`\x1b[31mvydanne: unknown --store '${store}' (expected: apple, google)\x1b[0m`);
  process.exit(1);
}

// SAFE BY DEFAULT. Every store-mutating command is a dry run unless `--apply` is passed. The Play half
// always worked this way (VYDANNE_COMMIT=1, enforceable because an Edit can be discarded); the Apple half
// did not, and wrote the moment it was invoked — including from a mistyped `vydanne fill --help`, which
// is not a hypothetical. One flag now means the same thing on both stores.
//
// VYDANNE_COMMIT=1 stays as an alias so the existing `play:internal` / `play:closed` scripts in the games
// keep working unchanged; `--apply` is what the docs teach.
const apply = argv.includes("--apply") || process.env.VYDANNE_COMMIT === "1";

try {
  if (["version", "-v", "--version"].includes(cmd)) {
    console.log(`vydanne ${VERSION}`);
  } else if (cmd === "auth") {
    // "Why isn't it picking up my key?" — answered, without ever printing a secret.
    const cr = (await loadConfig(cfgPath)).credentials;
    const mask = (v) => (v ? `${String(v).slice(0, 4)}…${String(v).slice(-4)}` : null);
    const row = (label, value, key, shown) =>
      console.log(value
        ? `  \x1b[32m✓\x1b[0m ${label.padEnd(20)} ${String(shown ?? mask(value)).padEnd(26)} ← ${cr.sources[key]}`
        : `  \x1b[31m✗\x1b[0m ${label.padEnd(20)} \x1b[31mnot found\x1b[0m`);
    console.log("Credentials — environment > .env cascade > user config (never the committed config):");
    row("ASC_KEY_ID", cr.keyId, "ASC_KEY_ID", cr.keyId);
    row("ASC_ISSUER_ID", cr.issuerId, "ASC_ISSUER_ID");
    row("PLAY_JSON_KEY_FILE", cr.playJsonKeyFile, "PLAY_JSON_KEY_FILE", cr.playJsonKeyFile);
    if (cr.keyId) {
      const p = path.join(os.homedir(), ".appstoreconnect", "private_keys", `AuthKey_${cr.keyId}.p8`);
      console.log(existsSync(p)
        ? `  \x1b[32m✓\x1b[0m ${"signing key".padEnd(20)} ${p}`
        : `  \x1b[31m✗\x1b[0m ${"signing key".padEnd(20)} \x1b[31mmissing\x1b[0m — ${p}`);
    }
    console.log(cr.userFile ? `\nuser config: ${cr.userFile}` : `\nuser config: none found. Looked in:\n${cr.candidates.map((c) => `  ${c}`).join("\n")}`);
    if (!cr.keyId || !cr.issuerId) {
      const target = cr.userFile || cr.candidates[cr.candidates.length - 1];
      console.log(`\nSet once for EVERY app, no secrets in any repo:\n  ${target}\n  { "keyId": "ABCD123456", "issuerId": "69a6de70-…" }\n  chmod 600 ${target}`);
      process.exit(1);
    }
  } else if (cmd === "locales") {
    const r = (await loadConfig(cfgPath)).resolvedLocales;
    console.log(`supported (${Object.keys(r.supported).length}):`);
    for (const [ui, asc] of Object.entries(r.supported)) console.log(`  ${ui} -> ${asc}`);
    console.log(`unsupported (${r.unsupported.length}) [no App Store language -> fall back to primary]: ${r.unsupported.join(", ")}`);
    // A localeMap entry pointing at a code Apple does not have is a config mistake, not a missing
    // language — it would otherwise be indistinguishable from the line above.
    if (r.invalid?.length) console.log(`\x1b[31minvalid localeMap (${r.invalid.length}) [not an App Store code]: ${r.invalid.join(", ")}\x1b[0m`);
  } else if (store === "google") {
    const cfg = await loadConfig(cfgPath);
    if (!cfg.google) throw new Error("vydanne: no `google` block in config — add packageName + a service-account key");
    if (!PLAY_COMMANDS[cmd]) throw new Error(`vydanne: '${cmd}' isn't available for --store google (try: ${Object.keys(PLAY_COMMANDS).join(", ")})`);
    if (!cfg.google.serviceAccountKey) throw new Error("vydanne: set PLAY_JSON_KEY_FILE (or google.serviceAccountKey) to the Play service-account JSON");
    const { PlayClient } = await import("../src/play/client.mjs");
    const spec = PLAY_COMMANDS[cmd];
    const dryRun = Boolean(spec.writes) && !apply;
    // Play needs no request-level gate: every mutation happens inside an Edit, and an Edit that is never
    // committed changes nothing. So a dry run here VALIDATES for real against Google, then discards.
    const client = await PlayClient.create({ keyPath: cfg.google.serviceAccountKey, packageName: cfg.google.packageName, dryRun });
    if (dryRun) console.log(yellow(`DRY RUN — '${cmd} --store google' validates against Play and discards the edit. Add --apply to commit.`));
    const { run } = await import(`../src/play/commands/${spec.mod}.mjs`);
    const ok = await run(cfg, client);
    if (ok === false) process.exit(1);
  } else if (COMMANDS[cmd]) {
    const cfg = await loadConfig(cfgPath);
    const spec = COMMANDS[cmd];
    const { run } = await import(`../src/commands/${spec.mod}.mjs`);
    const dryRun = Boolean(spec.writes) && !apply;
    const client = spec.client ? new Client({ keyId: cfg.keyId, issuerId: cfg.issuerId, dryRun }) : null;
    if (dryRun) console.log(yellow(`DRY RUN — '${cmd}' will not change App Store Connect. Add --apply to write.`));
    // altool authenticates on its own rather than through our JWT, so it needs the raw ids.
    const ok = await run(cfg, client, spec.credentials ? { keyId: cfg.keyId, issuerId: cfg.issuerId } : undefined);
    // The count is the point: "nothing happened" is not the same as "nothing would happen", and only the
    // second one means the local state already matches the store.
    if (dryRun && client) {
      const n = client.planned.length;
      console.log(yellow(n
        ? `DRY RUN — ${n} store write(s) withheld. Re-run with --apply to perform them.`
        : "DRY RUN — nothing to write; the store already matches local."));
    }
    if (ok === false) process.exit(1);
  } else {
    console.error(usage());
    process.exit(1);
  }
} catch (e) {
  console.error(`\x1b[31m${e.message}\x1b[0m`);
  process.exit(1);
}

function usage() {
  return `vydanne ${VERSION} — App Store Connect + Play prep (companion to zdymak). Ships builds to
testers; never submits for review.
usage: vydanne <command> [--apply] [--config vydanne.config.mjs]

  --apply         PERFORM the writes. Without it every store-mutating command below (marked ✎) runs
                  as a DRY RUN: it reads the store, reports exactly what it would change, and sends
                  nothing. Read-only commands ignore the flag.
✎ prepare         create/reuse the editable App Store version and attach the uploaded build.
                  Run this FIRST on an app that already has a version on sale — until it has,
                  there is no draft for \`fill\` to write into. Never submits; VYDANNE_VERSION=<x>
                  to name the version instead of reading it off the newest build.
✎ push            the whole pipeline, in order: prepare → fill → previews → age-rating →
                  review-contact → accessibility → preflight. Stops at the first failure.
                  --skip <step>[,<step>] drops steps that don't apply (prepare/preflight can't be
                  skipped); every skip is reported again at the end, so green still means green.
                  Ends at a green preflight — Add to Review + Submit stay yours, in the web UI.
✎ fill            metadata + screenshots + previews (native; iOS & macOS separate)
✎ appinfo         App Store category + the content-rights answer — the two app-level facts that
                  block Add for Review and belong to no single release. 'categories' takes Apple's
                  ids (GAMES, GAMES_PUZZLE — not display names); 'contentRights: false' for an app
                  showing no third-party content. Set once; re-running is a no-op.
✎ age-rating      set the age rating (AppInfo declaration)
✎ review-contact  App Review contact from the gitignored files
✎ accessibility   Accessibility Nutrition Labels (draft; VYDANNE_A11Y_PUBLISH=1 to publish once live)
  privacy         write the record + print the ASC-UI answers (API can't reach iris)
✎ previews        upload App Preview videos (native chunked upload)
  iap             validate IAP fields; VYDANNE_FLATTEN=<png> flattens a screenshot to RGB
  compliance      generate the US encryption self-classification PDF
  bridge          map zdymak's store-assets output onto the folders \`fill\` reads (locale codes,
                  device prefixes, Play paths). Local files only; --dry-run previews.
  inspect         read-only ASC state
  diff            show what differs between local (metadata/screenshots/previews) and ASC
  preflight       verify submission-completeness (the gotcha checker)
✎ prerelease      upload the build for testers — .ipa to TestFlight (internal groups only),
                  or --store google: the .aab to a closed track. Refuses production/review.
  locales         UI -> ASC locale mapping + unsupported
  auth            which credentials resolved, and from where (masked) — run this on a 401
credentials: env > .env cascade (.env, .env.<mode>, .env.local, .env.<mode>.local) > user config
  (\$VYDANNE_CONFIG_HOME, %APPDATA%\\vydanne or \$XDG_CONFIG_HOME/vydanne, ~/.appstoreconnect).
  NEVER the committed vydanne.config.mjs — run \`vydanne auth\` to see what resolved.
toggles: VYDANNE_SKIP_METADATA / VYDANNE_SKIP_SCREENSHOTS (fill), VYDANNE_REPLACE=1 (fill/previews:
         replace populated slots), VYDANNE_VERSION (prepare), VYDANNE_A11Y_PUBLISH (accessibility),
         VYDANNE_PROFILE (named profile), VYDANNE_ENV (.env mode),
         VYDANNE_COMMIT=1 (legacy alias for --apply — prefer the flag)`;
}
