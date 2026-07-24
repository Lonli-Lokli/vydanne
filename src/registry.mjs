// The canonical command registry — the single source of vydanne's public commands. bin/ dispatches from
// this, and the drift guards (scripts/check-docs.mjs, scripts/check-types.mjs) assert every command is
// documented in README/SKILL and typed in types/index.d.ts. Add a command here → the guards force it into
// the docs + types before publish.  name -> { mod: <file in src/commands>, client: needs an ASC client }
export const COMMANDS = {
  fill: { mod: "fill", client: true },
  "age-rating": { mod: "ageRating", client: true },
  "review-contact": { mod: "reviewContact", client: true },
  accessibility: { mod: "accessibility", client: true },
  privacy: { mod: "privacy", client: false },
  previews: { mod: "previews", client: true },
  iap: { mod: "iap", client: false },
  compliance: { mod: "compliance", client: false },
  inspect: { mod: "inspect", client: true },
  diff: { mod: "diff", client: true },
  preflight: { mod: "preflight", client: true },
};

// Commands available for `--store google` (Google Play). Same names as the Apple ones, different backend
// (src/play/commands/). Store-specific commands (Apple accessibility/iap; Play data-safety) aren't shared.
export const PLAY_COMMANDS = {
  inspect: { mod: "inspect" },
  preflight: { mod: "preflight" },
  diff: { mod: "diff" },
  fill: { mod: "fill" },
};

// Full public command surface (the module-dispatched ones above + the three handled inline in bin/).
export const COMMAND_NAMES = [...Object.keys(COMMANDS), "auth", "locales", "version"];
