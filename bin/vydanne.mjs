#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";
import { Client } from "../src/client.mjs";
import { COMMANDS, PLAY_COMMANDS } from "../src/registry.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;

const argv = process.argv.slice(2);
const cmd = argv.shift();
const i = argv.indexOf("--config");
const cfgPath = i >= 0 ? argv[i + 1] : undefined;
const si = argv.indexOf("--store");
const store = si >= 0 ? argv[si + 1] : "apple";

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
  } else if (store === "google") {
    const cfg = await loadConfig(cfgPath);
    if (!cfg.google) throw new Error("vydanne: no `google` block in config — add packageName + a service-account key");
    if (!PLAY_COMMANDS[cmd]) throw new Error(`vydanne: '${cmd}' isn't available for --store google (try: ${Object.keys(PLAY_COMMANDS).join(", ")})`);
    if (!cfg.google.serviceAccountKey) throw new Error("vydanne: set PLAY_JSON_KEY_FILE (or google.serviceAccountKey) to the Play service-account JSON");
    const { PlayClient } = await import("../src/play/client.mjs");
    const client = await PlayClient.create({ keyPath: cfg.google.serviceAccountKey, packageName: cfg.google.packageName });
    const { run } = await import(`../src/play/commands/${PLAY_COMMANDS[cmd].mod}.mjs`);
    const ok = await run(cfg, client);
    if (ok === false) process.exit(1);
  } else if (COMMANDS[cmd]) {
    const cfg = await loadConfig(cfgPath);
    const spec = COMMANDS[cmd];
    const { run } = await import(`../src/commands/${spec.mod}.mjs`);
    const client = spec.client ? new Client({ keyId: cfg.keyId, issuerId: cfg.issuerId }) : null;
    // altool authenticates on its own rather than through our JWT, so it needs the raw ids.
    const ok = await run(cfg, client, spec.credentials ? { keyId: cfg.keyId, issuerId: cfg.issuerId } : undefined);
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
usage: vydanne <command> [--config vydanne.config.mjs]
  fill            metadata + screenshots + previews (native; iOS & macOS separate)
  age-rating      set the age rating (AppInfo declaration)
  review-contact  App Review contact from the gitignored files
  accessibility   Accessibility Nutrition Labels (draft; VYDANNE_A11Y_PUBLISH=1 to publish once live)
  privacy         write the record + print the ASC-UI answers (API can't reach iris)
  previews        upload App Preview videos (native chunked upload)
  iap             validate IAP fields; VYDANNE_FLATTEN=<png> flattens a screenshot to RGB
  compliance      generate the US encryption self-classification PDF
  inspect         read-only ASC state
  diff            show what differs between local (metadata/screenshots/previews) and ASC
  preflight       verify submission-completeness (the gotcha checker)
  prerelease      upload the build for testers — .ipa to TestFlight (internal groups only),
                  or --store google: the .aab to a closed track. Refuses production/review.
  locales         UI -> ASC locale mapping + unsupported
  auth            which credentials resolved, and from where (masked) — run this on a 401
credentials: env > .env cascade (.env, .env.<mode>, .env.local, .env.<mode>.local) > user config
  (\$VYDANNE_CONFIG_HOME, %APPDATA%\\vydanne or \$XDG_CONFIG_HOME/vydanne, ~/.appstoreconnect).
  NEVER the committed vydanne.config.mjs — run \`vydanne auth\` to see what resolved.
toggles: VYDANNE_SKIP_METADATA / VYDANNE_SKIP_SCREENSHOTS (fill), VYDANNE_A11Y_PUBLISH (accessibility),
         VYDANNE_PROFILE (named profile), VYDANNE_ENV (.env mode)`;
}
