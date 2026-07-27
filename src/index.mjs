// Programmatic entry (the CLI is bin/vydanne.mjs). `import { runCommand, loadConfig } from "vydanne"`.
//
// This used to export a client, a config loader and the command REGISTRY — a table of `{ mod: "fill" }`
// filenames that nothing outside the package could resolve, because `exports` maps only ".". So a
// consumer could see that `fill` existed and had no way to run it. `runCommand` is that missing half:
// the same dispatch bin/ performs, minus the argv parsing and the process.exit.
import { Client } from "./client.mjs";
import { loadConfig } from "./config.mjs";
import { COMMANDS, PLAY_COMMANDS } from "./registry.mjs";

export { Client } from "./client.mjs";
export { PlayClient } from "./play/client.mjs";
export { loadConfig, CONFIG_KEYS } from "./config.mjs";
export { COMMANDS, PLAY_COMMANDS, COMMAND_NAMES } from "./registry.mjs";
export { resolveLocales, toAsc, VALID, UI_TO_ASC } from "./locales.mjs";
export { makeToken } from "./jwt.mjs";
export { DEFAULT_SCREENSHOT_BASE, IOS_DEVICE, MAC_DEVICE, screenshotBase } from "./screenshots.mjs";
export { DEFAULT_PLAY_IMAGES, PLAY_IMAGE_KIND, playImages } from "./play/images.mjs";

/**
 * Run one command, the way the CLI runs it.
 *
 * `apply` is the same safety gate the `--apply` flag drives, and it defaults to FALSE here for the same
 * reason it does there: a caller that forgets it gets a dry run, never a write. A command that writes
 * to the store receives a client already refusing mutations, so "dry run" is enforced in the client
 * rather than trusted to each command.
 *
 * Returns `{ ok, planned }` — `planned` being the writes a dry run withheld, which is the machine-
 * readable form of what the CLI prints as "N store write(s) withheld".
 *
 * @param {string} name    a key of COMMANDS (or of PLAY_COMMANDS when store is "google")
 * @param {object} [opts]
 * @param {object} [opts.config]     a loaded config; loaded from disk when omitted
 * @param {string} [opts.configPath] path to vydanne.config.mjs, when loading from disk
 * @param {"apple"|"google"} [opts.store]
 * @param {boolean} [opts.apply]     perform store writes (default false — dry run)
 */
export async function runCommand(name, opts = {}) {
  const { store = "apple", apply = false, configPath } = opts;
  if (store !== "apple" && store !== "google") throw new Error(`vydanne: unknown store '${store}' (expected: apple, google)`);

  const config = opts.config || (await loadConfig(configPath));
  const table = store === "google" ? PLAY_COMMANDS : COMMANDS;
  const spec = table[name];
  if (!spec) throw new Error(`vydanne: unknown command '${name}' for store '${store}' (try: ${Object.keys(table).join(", ")})`);

  const dryRun = Boolean(spec.writes) && !apply;

  if (store === "google") {
    if (!config.google) throw new Error("vydanne: no `google` block in config — add packageName + a service-account key");
    if (!config.google.serviceAccountKey) throw new Error("vydanne: set PLAY_JSON_KEY_FILE (or google.serviceAccountKey) to the Play service-account JSON");
    const { PlayClient } = await import("./play/client.mjs");
    const client = await PlayClient.create({ keyPath: config.google.serviceAccountKey, packageName: config.google.packageName, dryRun });
    const { run } = await import(`./play/commands/${spec.mod}.mjs`);
    return { ok: (await run(config, client)) !== false, planned: [] };
  }

  const client = spec.client ? new Client({ keyId: config.keyId, issuerId: config.issuerId, dryRun }) : null;
  const { run } = await import(`./commands/${spec.mod}.mjs`);
  // altool authenticates on its own rather than through our JWT, so it needs the raw ids.
  const ok = await run(config, client, spec.credentials ? { keyId: config.keyId, issuerId: config.issuerId } : undefined);
  return { ok: ok !== false, planned: client?.planned ?? [] };
}
