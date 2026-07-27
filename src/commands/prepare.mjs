import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { pointVersionAtBuild, LOCKED_STATES } from "./prerelease.mjs";

/**
 * Create — or reuse — the App Store version you are preparing, and point it at a build.
 *
 * THE GAP THIS CLOSES. Every other Apple command edits *the version being prepared*, which it finds
 * through `client.editVersion()`. On an app whose only version is already on sale there is nothing
 * editable to return, so that call falls back to the live record — and then `fill` aims its
 * description/whatsNew PATCHes at the version customers are looking at, while `prerelease` declines
 * to attach the build it just uploaded ("no editable App Store version — build uploaded, nothing to
 * attach it to"). Neither command can recover on its own, because the thing that is missing is a
 * *version*, and nothing in vydanne ever created one. So preparing a second release always started
 * with a trip to the App Store Connect web UI — exactly the manual step this tool exists to delete.
 *
 * WHAT IT IS NOT. Creating a version is not submitting one. The record this POSTs lands in
 * PREPARE_FOR_SUBMISSION: an editable draft, and the state `fill`, `previews` and `review-contact`
 * all need before they can write anything. `releaseType: MANUAL` then keeps the release itself a
 * human act even after Apple approves it. Add to Review and Submit stay exactly where they were —
 * with you. There is no argument to this command that reaches a reviewer or the public.
 *
 * WHERE THE NUMBER COMES FROM. The newest build Apple holds, read off its preReleaseVersion — which
 * is the archive's own CFBundleShortVersionString. The marketing version therefore travels with the
 * binary, the same way `prerelease` already lets the build number travel with it: Apple assigns
 * nothing and neither do we, so there is no second place to keep the number in step. Preparing a
 * version *before* its build exists is the one case that needs telling, hence VYDANNE_VERSION.
 *
 * RE-RUNNING IS THE POINT. Find-or-create means the command is idempotent: run it before the build
 * exists to get an empty draft, run it again after `prerelease` to attach the binary, run it a third
 * time and it reports that everything already matches. And once the draft exists, `prerelease`
 * attaches to it unaided — `editVersion()` starts finding a real editable version, so the "nothing
 * to attach it to" dead end disappears for every future release too.
 */

/** How the CLI is meant to be driven, printed wherever the command can't finish the job itself. */
const NEXT_STEPS = [
  "  next: `vydanne fill --apply` for metadata, then Add to Review + Submit in App Store Connect.",
];

/** Every version Apple holds for this platform. Deliberately NOT `editVersion()`, which collapses the
 *  list to a single guess — finding a specific versionString is the whole job here. */
async function versionsFor(client, platform) {
  const { json } = await client.get(
    `/v1/apps/${client.appId}/appStoreVersions?filter[platform]=${platform}&limit=200` +
      `&fields[appStoreVersions]=versionString,appStoreState`,
  );
  return json.data || [];
}

/** The newest build, together with the marketing version its archive declares. */
async function newestBuildWithVersion(client) {
  const { json } = await client.get(
    `/v1/builds?filter[app]=${client.appId}&sort=-uploadedDate&limit=1` +
      `&fields[builds]=version,processingState&include=preReleaseVersion` +
      `&fields[preReleaseVersions]=version`,
  );
  const build = json.data?.[0] ?? null;
  const marketing =
    json.included?.find((r) => r.type === "preReleaseVersions")?.attributes?.version ?? null;
  return { build, marketing };
}

/** `<metadataDir>/copyright.txt`, the same supply convention `fill` reads listing text from. */
function readCopyright(config) {
  if (!config.metadataDir) return null;
  const p = path.join(config.metadataDir, "copyright.txt");
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").trim() || null;
}

/**
 * Is `a` a higher marketing version than `b`?
 *
 * Compared component-wise as NUMBERS, because Apple refuses a versionString that does not exceed the
 * one on sale and a string compare gets the interesting case backwards: "1.10" < "1.9" as text, and
 * 1.10 > 1.9 as a version. Worth a pre-check rather than a 409 the operator has to decode.
 */
export function isHigherVersion(a, b) {
  const pa = String(a).split(".").map((n) => Number(n) || 0);
  const pb = String(b).split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Find the version called `versionString`, or create it. Returns the version record, or null when it
 * exists but Apple has locked it — a state only the operator can leave, by withdrawing in the UI.
 */
export async function ensureVersion(client, config, platform, versionString) {
  const existing = (await versionsFor(client, platform)).find(
    (v) => v.attributes.versionString === versionString,
  );

  if (existing) {
    const state = existing.attributes.appStoreState;
    // Reusing prerelease's LOCKED_STATES rather than enumerating the editable states here: one list
    // to keep right, and it is already the list that decides whether a build may be re-pointed.
    if (LOCKED_STATES.has(state)) {
      console.error(red(`  version ${versionString} is ${state} — Apple will not let it be edited.`));
      // Two locked cases, two different fixes — telling someone to "withdraw" a version that is ON
      // SALE is advice they cannot take. Shipped once already means the next release needs a HIGHER
      // number, which is the everyday case: the newest build still declares the shipped version
      // because MARKETING_VERSION was never bumped after release.
      if (state === "READY_FOR_SALE" || state === "REPLACED_WITH_NEW_VERSION") {
        console.error(`  That version has shipped; the next release needs a higher number. Bump`);
        console.error(`  MARKETING_VERSION and re-archive — or name it now: VYDANNE_VERSION=<next> vydanne prepare --apply`);
      } else {
        console.error("  Withdrawing that submission has reviewer-facing consequences, so it stays your");
        console.error("  call: withdraw it in App Store Connect, then re-run this.");
      }
      return null;
    }
    console.log(green(`  version ${versionString} already exists (${state}) — reusing it`));
    return existing;
  }

  const attributes = { platform, versionString, releaseType: "MANUAL" };
  // Set at creation because it is a version-level field: nothing else in vydanne writes `copyright`,
  // and a version submitted without one is a metadata rejection waiting to happen.
  const copyright = readCopyright(config);
  if (copyright) attributes.copyright = copyright;

  const r = await client.post(`/v1/appStoreVersions`, {
    data: {
      type: "appStoreVersions",
      attributes,
      relationships: { app: { data: { type: "apps", id: client.appId } } },
    },
  });

  if (r.status >= 300) {
    console.error(red(`  could not create version ${versionString} (${r.status})`));
    for (const e of r.json?.errors || []) console.error(`    ${e.title}: ${e.detail}`);
    return null;
  }

  const how = copyright ? ", copyright set" : "";
  // Said in the tense that happened. A dry run reported "created version 1.2" in green immediately
  // after saying it would POST one — two lines that contradict each other, and the green one is the
  // one people remember.
  console.log(client.dryRun
    ? yellow(`  WOULD create version ${versionString} — PREPARE_FOR_SUBMISSION, releaseType MANUAL${how}`)
    : green(`  created version ${versionString} — PREPARE_FOR_SUBMISSION, releaseType MANUAL${how}`));
  return r.json.data;
}

export async function run(config, client) {
  await client.findApp(config.bundleId);
  // EVERY declared platform. iOS and macOS are separate App Store versions with separate records, and
  // preparing only `platforms[0]` left the second one with nothing editable — so `fill MAC_OS` refused
  // ("no editable version") on an app whose iOS draft had just been created, and `push` stopped there.
  // `fill`, `previews` and `preflight` have always looped; this is the command that creates what they
  // loop over.
  let ok = true;
  for (const platform of config.platforms) {
    if (!(await prepareOne(config, client, platform))) ok = false;
  }
  if (!ok) return false;

  console.log("prepare done — the version is editable.");
  for (const line of NEXT_STEPS) console.log(line);
  console.log(yellow("  Submitting for App Store review stays manual, by design."));
  return true;
}

async function prepareOne(config, client, platform) {
  console.log(green(`prepare → App Store version (${platform})`));

  const { build, marketing } = await newestBuildWithVersion(client);
  const target = process.env.VYDANNE_VERSION || marketing;

  if (!target) {
    console.error(red("prepare: nothing tells me which version to prepare."));
    console.error("  Apple holds no build to read a marketing version from. Either upload one —");
    console.error("  `vydanne prerelease --apply` — or name the version yourself:");
    console.error("    VYDANNE_VERSION=1.2 vydanne prepare --apply");
    return false;
  }

  const source = process.env.VYDANNE_VERSION ? "VYDANNE_VERSION" : `build ${build?.attributes?.version}`;
  console.log(`  preparing ${target}  (from ${source})`);

  // The version on sale is the floor Apple enforces. Checking it here turns an opaque 409 into a
  // sentence, and catches the likelier mistake: forgetting to bump MARKETING_VERSION before archiving.
  const versions = await versionsFor(client, platform);
  const live = versions.find((v) => v.attributes.appStoreState === "READY_FOR_SALE");
  if (live && live.attributes.versionString !== target && !isHigherVersion(target, live.attributes.versionString)) {
    console.error(red(`  ${target} does not exceed ${live.attributes.versionString}, which is on sale.`));
    console.error("  Apple only accepts a higher version. Bump MARKETING_VERSION, re-archive, re-upload.");
    return false;
  }
  if (live) console.log(`  on sale: ${live.attributes.versionString}`);

  const version = await ensureVersion(client, config, platform, target);
  if (!version) return false;

  if (!build) {
    console.log(yellow("  no build uploaded yet — the version is ready for one."));
    console.log("  `vydanne prerelease --apply` will upload it and attach it to this version.");
  } else if (marketing && marketing !== target) {
    // The newest build belongs to a DIFFERENT marketing version — almost always because the archive for
    // this one has not been uploaded yet, and VYDANNE_VERSION named the version ahead of its binary.
    // Attaching it would put the previous release's binary behind the new version's number: Apple rejects
    // that at submission, and it is a confusing thing to debug from the reviewer's message.
    console.log(yellow(`  build ${build.attributes.version} declares ${marketing}, not ${target} — not attaching it.`));
    console.log(`  Archive ${target} and upload it (\`vydanne prerelease --apply\`); this version is waiting.`);
  } else if (build.attributes.processingState === "PROCESSING") {
    console.log(yellow(`  build ${build.attributes.version} is still PROCESSING — not attaching it yet.`));
    console.log("  Re-run once Apple finishes, or let `vydanne prerelease --apply` attach it.");
  } else {
    await pointVersionAtBuild(client, config, build, version);
  }
  return true;
}
