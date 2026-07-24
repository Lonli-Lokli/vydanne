#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
    const ok = await run(cfg, client);
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
  return `vydanne ${VERSION} — App Store Connect submission prep (companion to zdymak). Never submits.
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
  locales         UI -> ASC locale mapping + unsupported
toggles: VYDANNE_SKIP_METADATA / VYDANNE_SKIP_SCREENSHOTS (fill), VYDANNE_A11Y_PUBLISH (accessibility)`;
}
