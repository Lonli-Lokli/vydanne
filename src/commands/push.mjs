import { green, yellow, red } from "../util.mjs";
import { run as prepare } from "./prepare.mjs";
import { run as fill } from "./fill.mjs";
import { run as previews } from "./previews.mjs";
import { run as ageRating } from "./ageRating.mjs";
import { run as reviewContact } from "./reviewContact.mjs";
import { run as accessibility } from "./accessibility.mjs";
import { run as preflight } from "./preflight.mjs";

/**
 * The whole Apple release pipeline, in the one order that works.
 *
 * WHY A COMMAND AND NOT A PARAGRAPH. Shipping an update takes seven commands in a specific order —
 * `prepare` first (or nothing has a version to write into), `preflight` last (or green is measured
 * before the writes it is meant to bless) — and that ordering lived in nobody's head. The near-miss
 * that proved it: with the order forgotten, `fill` was pointed at an app whose only version was ON
 * SALE, and only the editVersion() fix stood between the dry run and a rewritten live listing. A
 * README section can teach the order; only a command can make it impossible to run out of order.
 *
 * WHAT IT IS. A sequencer, nothing more: each step is the same `run` its standalone command uses, on
 * the same client, so `push` can do nothing a step couldn't. The first failure stops the run — a step
 * that cannot proceed says why and names its fix (that is each command's own contract), and continuing
 * past it would let a green `preflight` at the end bless a release with a known hole in it.
 *
 * SKIPPING IS EXPLICIT AND LOUD. `--skip <step>[,<step>]` (or `push: { skip: [...] }`) drops a step
 * from the run. This exists because a pipeline with no way out is a pipeline that stops working the
 * moment one step legitimately does not apply to an app: `accessibility` refuses when no block is
 * declared — correctly, it publishes claims — so an app that has not audited its accessibility could
 * not complete `push` at all, and neither could one with no App Review PII on disk. The skip is named
 * on every line of the report and again at the end, because the whole value of the last step is that
 * green means green: a run that skipped something must never read like a run that did everything.
 *
 * WHAT IT IS NOT. It never submits — the pipeline ends at `preflight`, and Add to Review + Submit
 * stay in App Store Connect, human-only, exactly as every step's own refusals already guarantee.
 * `prerelease` (the build upload) is deliberately not a step: it is macOS-only, shells out to altool,
 * and belongs wherever the archive is produced. Run it whenever the build is ready — before or after
 * `push`; `prepare` attaches the newest build either way.
 *
 * Dry-run composes: without --apply the shared client refuses every mutation, each step reports its
 * plan, and bin/ prints the withheld-write count at the end. The one case a dry run cannot preview
 * past is an app with no editable version — the draft the later steps target does not exist until
 * `prepare` is APPLIED — so that is said up front rather than discovered as a refusal mid-run.
 */
const STEPS = [
  ["prepare", prepare],
  ["fill", fill],
  ["previews", previews],
  ["age-rating", ageRating],
  ["review-contact", reviewContact],
  ["accessibility", accessibility],
  ["preflight", preflight],
];

/** Steps named by `--skip a,b` and/or `push.skip` in the config, validated against the real step list. */
function resolveSkips(config) {
  const flag = process.argv.find((a) => a.startsWith("--skip="))?.slice("--skip=".length)
    ?? (process.argv.includes("--skip") ? process.argv[process.argv.indexOf("--skip") + 1] : null);
  const named = [
    ...(flag ? String(flag).split(",") : []),
    ...(config.push?.skip || []),
  ].map((s) => s.trim()).filter(Boolean);
  const names = STEPS.map(([n]) => n);
  const unknown = named.filter((s) => !names.includes(s));
  return { skip: new Set(named.filter((s) => names.includes(s))), unknown };
}

export async function run(config, client) {
  await client.findApp(config.bundleId);
  const { skip, unknown } = resolveSkips(config);
  if (unknown.length) {
    console.error(red(`push: --skip named step(s) that do not exist: ${unknown.join(", ")}`));
    console.error(`  Steps: ${STEPS.map(([n]) => n).join(", ")}`);
    return false;
  }
  // Skipping the last step would make the command's own promise unverifiable, and skipping the first
  // leaves every later step writing into a version that may not exist. Both are refusals rather than
  // warnings: there is no reading of "push, but don't check the result" that is worth supporting.
  for (const required of ["prepare", "preflight"]) {
    if (skip.has(required)) {
      console.error(red(`push: \`${required}\` cannot be skipped — run the other steps individually if that is what you want.`));
      return false;
    }
  }

  const platform = (config.platforms && config.platforms[0]) || "IOS";
  if (client.dryRun && !(await client.editVersion(platform))) {
    console.log(yellow("push: no editable App Store version exists, so this dry run will stop where the draft is needed."));
    console.log("  `vydanne prepare --apply` creates it — a draft, not a submission — then re-run `vydanne push`");
    console.log("  to preview the rest of the pipeline.");
  }

  const skipped = [];
  for (const [name, step] of STEPS) {
    if (skip.has(name)) {
      console.log(yellow(`\n▸ push: ${name} — SKIPPED (--skip)`));
      skipped.push(name);
      continue;
    }
    console.log(green(`\n▸ push: ${name}`));
    const ok = await step(config, client);
    if (ok === false) {
      console.error(red(`\npush: stopped at \`${name}\` — fix what it reported above, then re-run \`vydanne push\`.`));
      console.error("  Every completed step is idempotent, so re-running repeats nothing destructive.");
      if (name === "age-rating" && !config.ageRating && config.rating !== "4+") {
        console.error(`  For a '${config.rating}' rating, declare the content descriptors in \`ageRating\` — see the message above.`);
      }
      console.error(`  Or drop this step for now: \`vydanne push --apply --skip ${name}\``);
      return false;
    }
  }

  console.log(green("\npush done — the release is staged and preflight is green."));
  // Repeated at the end on purpose. The one thing this command sells is that its last line means the
  // release is ready; a skipped step is precisely the case where that would otherwise overstate it.
  if (skipped.length) console.log(yellow(`  NOT green for: ${skipped.join(", ")} — skipped, never run. Run them before you submit.`));
  console.log(yellow("  Submitting stays yours: App Store Connect → the prepared version → Add to Review → Submit."));
  return true;
}
