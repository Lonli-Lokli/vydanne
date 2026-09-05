// The canonical command registry — the single source of vydanne's public commands. bin/ dispatches from
// this, and the drift guards (scripts/check-docs.mjs, scripts/check-types.mjs) assert every command is
// documented in README/SKILL and typed in types/index.d.ts. Add a command here → the guards force it into
// the docs + types before publish.
//
//   name -> { mod: <file in src/commands>, client: needs an ASC client, writes: mutates the STORE }
//
// `writes` is what makes a command dry-run unless `--apply` is passed, so it is a safety declaration, not
// a label: mark a new command `writes: true` the moment it can change anything on the store side. It means
// the STORE specifically — `privacy` and `compliance` write local files (a record, a PDF) and are not
// marked, because a dry run that refused to produce a local artefact would just be broken.
export const COMMANDS = {
  // Creates the editable version everything below writes INTO, so it comes first in more than
  // listing order: on an app with a version already on sale, `fill` has nothing valid to target
  // until this has run once.
  prepare: { mod: "prepare", client: true, writes: true },
  // The pipeline in its one working order — prepare → fill → previews → age-rating → review-contact →
  // accessibility → preflight — because that order lived in nobody's head, and a release nearly got
  // written to a live listing while everyone re-derived it. Stops at the first failure; never submits.
  push: { mod: "push", client: true, writes: true },
  fill: { mod: "fill", client: true, writes: true },
  appinfo: { mod: "appInfo", client: true, writes: true },
  "age-rating": { mod: "ageRating", client: true, writes: true },
  "review-contact": { mod: "reviewContact", client: true, writes: true },
  accessibility: { mod: "accessibility", client: true, writes: true },
  privacy: { mod: "privacy", client: false },
  previews: { mod: "previews", client: true, writes: true },
  iap: { mod: "iap", client: false },
  compliance: { mod: "compliance", client: false },
  // Maps zdymak's output layout onto the folders `fill` reads. Local files only (like privacy and
  // compliance above), so it is not marked `writes` — it has its own `--dry-run` instead.
  bridge: { mod: "bridge", client: false },
  inspect: { mod: "inspect", client: true },
  // Version HISTORY, which `inspect` structurally cannot show — it reports the version in
  // preparation or the live one and nothing behind them. Read-only, and the reason it exists is on
  // the record: three of Niva's release tags say in their own messages that they could not be
  // confirmed "because historical build numbers are not exposed by vydanne inspect", and all three
  // were wrong. The data was always one query away.
  releases: { mod: "releases", client: true },
  diff: { mod: "diff", client: true },
  preflight: { mod: "preflight", client: true },
  // Uploads the .ipa to TestFlight. Needs the credentials as well as the client: the REST API
  // cannot carry a binary, so this one shells out to `xcrun altool`, which authenticates itself.
  prerelease: { mod: "prerelease", client: true, credentials: true, writes: true },
};

// Commands available for `--store google` (Google Play). Same names as the Apple ones, different backend
// (src/play/commands/). Store-specific commands (Apple accessibility/iap; Play data-safety) aren't shared.
export const PLAY_COMMANDS = {
  inspect: { mod: "inspect" },
  releases: { mod: "releases" },
  preflight: { mod: "preflight" },
  diff: { mod: "diff" },
  fill: { mod: "fill", writes: true },
  prerelease: { mod: "prerelease", writes: true },
};

// Full public command surface (the module-dispatched ones above + the three handled inline in bin/).
export const COMMAND_NAMES = [...Object.keys(COMMANDS), "auth", "locales", "version"];
