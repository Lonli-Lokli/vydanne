import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { green, yellow, red } from "../util.mjs";

const run_ = promisify(execFile);

/**
 * Upload a build to App Store Connect, for TestFlight.
 *
 * The Play side has had this since the beginning; Apple did not, so the one step that actually
 * moves a binary had to be done by hand for iOS while Android was a command. This closes that,
 * with the same refusals.
 *
 * **The REST API cannot carry a binary.** Everything else vydanne does is ASC REST over a JWT it
 * mints itself, but Apple has never exposed binary upload there — `altool` and Transporter are the
 * only supported paths. So this shells out to `xcrun altool`, which is not a departure from "no
 * fastlane/Ruby": altool ships with Xcode, and you already needed Xcode to produce the .ipa this
 * command uploads. It does mean the command is macOS-only, which is checked up front rather than
 * discovered as a confusing spawn error.
 *
 * WHAT IT REFUSES, mirroring `--store google`:
 *  - it does not submit for App Store review. That release is a human's to make, and there is no
 *    arrangement of arguments here that reaches the public.
 *  - it does not touch EXTERNAL TestFlight groups. External testing needs Beta App Review, which
 *    is a submission by another name. Internal groups only — the exact parallel of Play's
 *    `internal` track, and for the same practical reason: on a PAID app, internal testers are the
 *    ones who install without buying it.
 *
 * Apple assigns nothing: the build number comes from the archive's own CFBundleVersion, so build
 * numbering stays with the build, and re-uploading one Apple already holds fails loudly instead of
 * silently replacing a binary.
 *
 * WHAT IT ALSO DOES: points the version you are preparing AT the build it just uploaded. That is
 * the loop this command exists to serve — ship a build to testers, find something, fix it, upload
 * again — and without it the version keeps whatever build was attached first while TestFlight
 * quietly moves on. Re-running simply re-points: the relationship is a single build, so the newest
 * upload replaces the old one and there is nothing to clean up.
 *
 * It will not re-point a version that is no longer editable (in review, or already released),
 * because Apple would need that version withdrawn first — a decision with reviewer-facing
 * consequences, and therefore the operator's.
 */

/** How long to watch processing before handing back. Apple is usually minutes, occasionally not. */
const PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_MS = 20 * 1000;

/** Newest `.ipa` in a directory, or the file itself. Mirrors how `google.aab` is resolved. */
export function resolveIpa(spec) {
  const target = process.env.VYDANNE_IPA || spec;
  if (!target) return null;
  if (!fs.existsSync(target)) return null;
  if (fs.statSync(target).isFile()) return target.endsWith(".ipa") ? path.resolve(target) : null;
  const ipas = fs
    .readdirSync(target)
    .filter((f) => f.endsWith(".ipa"))
    .map((f) => path.join(target, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return ipas.length ? path.resolve(ipas[0]) : null;
}

async function altool(args, credentials) {
  // altool finds the key itself, in the same ~/.appstoreconnect/private_keys location vydanne
  // already resolves for its JWT — so a working `vydanne auth` is a working upload.
  const full = ["altool", ...args, "--apiKey", credentials.keyId, "--apiIssuer", credentials.issuerId];
  return run_("xcrun", full, { maxBuffer: 32 * 1024 * 1024 });
}

/**
 * **The highest build number this app has, which is not the same as the newest.**
 *
 * [newestBuild] sorts by upload date, and that is the wrong baseline for a gate: on 2026-09-04
 * Vodar's newest upload WAS the broken one, a build numbered `1` sitting above a `131`, so
 * comparing against it would have compared 1 with 1 and waved it through. The invariant is about
 * the maximum, so read the maximum.
 */
async function appBuilds(client) {
  const { json } = await client.get(
    `/v1/builds?filter[app]=${client.appId}&sort=-uploadedDate&limit=200&fields[builds]=version,processingState`,
  );
  let highest = null;
  const held = new Map();
  for (const b of json.data || []) {
    const raw = b.attributes?.version;
    held.set(String(raw), b);
    const n = Number(raw);
    if (Number.isFinite(n) && (highest == null || n > highest)) highest = n;
  }
  return { highest, held };
}

/**
 * The CFBundleVersion inside the .ipa, read before anything is uploaded.
 *
 * The Play side has always read the versionCode out of the bundle before the transfer; Apple's did
 * not, so the first place a build number became visible was App Store Connect — after the upload,
 * which is after it is too late. macOS-only tools are fine here: this command already requires
 * `xcrun altool`.
 */
async function ipaBuildNumber(ipa) {
  try {
    const { stdout } = await run_(
      "/bin/sh",
      ["-c", `unzip -p ${JSON.stringify(ipa)} 'Payload/*.app/Info.plist' | plutil -convert json -o - -`],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return JSON.parse(stdout).CFBundleVersion ?? null;
  } catch {
    return null;
  }
}

/** The newest build Apple has for this app, if any. */
async function newestBuild(client) {
  const { json } = await client.get(
    `/v1/builds?filter[app]=${client.appId}&sort=-uploadedDate&limit=1` +
      `&fields[builds]=version,processingState,uploadedDate`,
  );
  return json.data?.[0] ?? null;
}

export async function run(config, client, credentials) {
  const ios = config.ios || {};

  if (process.platform !== "darwin") {
    console.error(red("prerelease: uploading to App Store Connect needs `xcrun altool`, which is macOS-only."));
    console.error("  Apple has never exposed binary upload over the REST API — altool or Transporter only.");
    return false;
  }

  const ipa = resolveIpa(ios.ipa);
  if (!ipa) {
    console.error(red("prerelease: no .ipa found — set `ios.ipa` in the config, or pass VYDANNE_IPA=<path>."));
    console.error("  It may be a file or a directory; a directory takes its newest .ipa.");
    return false;
  }

  await client.findApp(config.bundleId);
  const before = await newestBuild(client);
  const size = (fs.statSync(ipa).size / 1e6).toFixed(1);
  console.log(green("prerelease → App Store Connect (TestFlight)"));
  console.log(`  archive: ${path.relative(process.cwd(), ipa) || ipa}  (${size} MB)`);

  // THE BUILD NUMBER GATE. Read from the archive, checked before the transfer.
  //
  // Apple does not enforce this: CFBundleVersion only has to be unique within a marketing version,
  // so a build numbered `1` uploaded above a `131` is accepted in silence. That happened on
  // 2026-09-04 — a build-number fallback fired when git was unavailable at archive time, nothing
  // failed anywhere, and the result is a binary that cannot be traced to a commit, tagged, or
  // symbolicated. Google refuses the equivalent upload outright; this is the missing half.
  //
  // Refusing costs a re-archive. Accepting costs a permanently untraceable release.
  const declared = await ipaBuildNumber(ipa);
  const { highest, held } = await appBuilds(client);
  // Already on the app? Then this is not a new upload, it is the second half of one — the archive
  // went up earlier and the version it was meant for was locked in review at the time. That is the
  // exact shape `withdraw` creates, and re-uploading is both impossible (Apple refuses a repeated
  // build number) and unnecessary. Skip to attaching it.
  const alreadyUp = declared != null && held.has(String(declared));
  if (declared == null) {
    console.log(yellow("  build ?  — could not read CFBundleVersion from the archive; not gated"));
  } else {
    console.log(`  build ${declared} (CFBundleVersion, read from the archive)`);
    if (alreadyUp) {
      console.log(green("  already uploaded — skipping the transfer, attaching it below"));
    } else if (highest != null && Number(declared) <= highest) {
      // Not above the highest, and not one Apple holds: the number went BACKWARDS. That is a
      // build-number fallback firing, not a re-run, and the two are worth telling apart — the
      // first version of this gate refused both and made the legitimate case impossible.
      console.error(red(`  refusing: build ${declared} is not above ${highest}, which this app already has.`));
      console.error("  A build number that did not grow is almost always a fallback firing — check that");
      console.error("  the archive was made where git works, or pass BUILD_NUMBER=<n> deliberately.");
      console.error("  Apple would accept this upload; it is not recoverable afterwards.");
      return false;
    }
  }

  // Validate before uploading. A rejected upload has already cost the transfer; altool's validation
  // catches the common refusals (entitlements, missing icons, bad version) in seconds.
  if (!alreadyUp) try {
    await altool(["--validate-app", "-f", ipa, "-t", "ios"], credentials);
    console.log(green("  validated"));
  } catch (e) {
    console.error(red("  validation failed — Apple would reject this archive:"));
    console.error(indent(e.stdout || e.stderr || e.message));
    return false;
  }

  // The binary upload is the one mutation that does NOT go through the ASC client, so the client-level
  // dry-run gate cannot see it — it has to be refused here, or a dry run would ship a build to TestFlight.
  // Validation above has already run, which is the useful half: exactly Play's "validate, then discard".
  //
  // Only when there IS an upload, though. With the build already on the app the rest of this command
  // is ordinary client calls, which the client's own dry run already plans and withholds — returning
  // here would hide the re-point that is the entire remaining point of the run.
  if (client.dryRun && !alreadyUp) {
    console.log(yellow("  DRY RUN — archive validated, NOT uploaded. Re-run with --apply to send it to TestFlight."));
    return true;
  }

  if (!alreadyUp) try {
    await altool(["--upload-app", "-f", ipa, "-t", "ios"], credentials);
    console.log(green("  uploaded"));
  } catch (e) {
    const text = `${e.stdout || ""}${e.stderr || ""}` || e.message;
    // The one refusal worth naming: re-uploading a build number Apple already holds. It is the
    // right answer for an accident and a dead end for a re-run, so say which it is.
    if (/already exists|redundant binary|previously uploaded/i.test(text)) {
      console.error(red("  Apple already holds this build number."));
      console.error("  Bump CFBundleVersion (the build number, not the marketing version) and re-archive.");
    } else {
      console.error(red("  upload failed:"));
      console.error(indent(text));
    }
    return false;
  }

  const build = alreadyUp ? held.get(String(declared)) : await waitForProcessing(client, before);
  if (!build) {
    console.log(yellow("  build not visible yet — Apple is still ingesting it."));
    console.log("  It will appear in TestFlight shortly; nothing further is needed here.");
    return true;
  }
  console.log(green(`  build ${build.attributes.version}: ${build.attributes.processingState}`));

  if (build.attributes.processingState === "FAILED") {
    console.error(red("  Apple failed to process this build — check the email it sent for the reason."));
    return false;
  }

  if (ios.testFlightGroup) {
    await assignToInternalGroup(client, build, ios.testFlightGroup);
  }

  await pointVersionAtBuild(client, config, build);

  console.log("prerelease done — the build is in TestFlight.");
  console.log(yellow("  Submitting for App Store review stays manual, by design."));
  return true;
}

async function waitForProcessing(client, before) {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  let announced = false;
  while (Date.now() < deadline) {
    const build = await newestBuild(client);
    // "New" means a different build than the one that was newest before the upload. Comparing ids
    // rather than timestamps avoids any assumption about clock skew between here and Apple.
    if (build && build.id !== before?.id) {
      if (build.attributes.processingState !== "PROCESSING") return build;
      if (!announced) {
        console.log("  processing…");
        announced = true;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

/**
 * Add the build to an INTERNAL TestFlight group.
 *
 * External groups are refused: distributing to them requires Beta App Review, which is a
 * submission, and this tool does not submit.
 */
async function assignToInternalGroup(client, build, groupName) {
  const { json } = await client.get(
    `/v1/apps/${client.appId}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup`,
  );
  const groups = json.data || [];
  const group = groups.find((g) => g.attributes.name === groupName);
  if (!group) {
    const names = groups.map((g) => `${g.attributes.name}${g.attributes.isInternalGroup ? "" : " (external)"}`);
    console.error(yellow(`  no TestFlight group named "${groupName}" — have: ${names.join(", ") || "none"}`));
    return;
  }
  if (!group.attributes.isInternalGroup) {
    console.error(red(`  "${groupName}" is an EXTERNAL group — refusing.`));
    console.error("  External testing needs Beta App Review, which is a submission by another name.");
    return;
  }
  const r = await client.post(`/v1/betaGroups/${group.id}/relationships/builds`, {
    data: [{ type: "builds", id: build.id }],
  });
  if (r.status < 300) console.log(green(`  added to internal group "${groupName}"`));
  else console.error(yellow(`  could not add to "${groupName}" (${r.status})`));
}

/** Versions Apple will not let us re-point without the operator withdrawing them first. Exported
 *  because `prepare` needs the same answer about the same states — two lists would drift. */
export const LOCKED_STATES = new Set([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_DEVELOPER_RELEASE",
  "PENDING_APPLE_RELEASE",
  "READY_FOR_SALE",
  "REPLACED_WITH_NEW_VERSION",
  // Both removed-from-sale states are shipped versions that Apple will not reopen for editing.
  // client.mjs has always treated them as dead for `editVersion()`; leaving them out here meant
  // `prepare` would "reuse" one and hand every later step a version whose first write Apple refuses —
  // the refusal arriving as an opaque INVALID_STATE instead of the sentence below it.
  "REMOVED_FROM_SALE",
  "DEVELOPER_REMOVED_FROM_SALE",
]);

/**
 * Attach [build] to the version being prepared, replacing whatever was there.
 *
 * This is what makes "upload a fix and try again" one command rather than a trip to the web UI:
 * the version → build relationship holds exactly one build, so a PATCH re-points it.
 *
 * [known] is the version to attach to, when the caller has already resolved it. `prepare` passes the
 * draft it just found or created, because `editVersion()` cannot tell a fresh draft from the live
 * record on an app that already has a version on sale — it returns whichever the list yields first.
 */
export async function pointVersionAtBuild(client, config, build, known = null) {
  const platform = (config.platforms && config.platforms[0]) || "IOS";
  const version = known || (await client.editVersion(platform));
  if (!version) {
    console.log(yellow("  no editable App Store version — build uploaded, nothing to attach it to."));
    console.log("  `vydanne prepare --apply` creates the version to attach it to, then re-run this.");
    return;
  }
  const state = version.attributes.appStoreState;
  const versionString = version.attributes.versionString;
  if (LOCKED_STATES.has(state)) {
    console.log(yellow(`  version ${versionString} is ${state} — leaving its build alone.`));
    console.log("  Re-pointing it would mean withdrawing that submission, which is your call.");
    return;
  }

  // What it currently points at, so a no-op re-run says so rather than looking like a change.
  const { json: current } = await client.get(
    `/v1/appStoreVersions/${version.id}/build?fields[builds]=version`,
  );
  const was = current.data?.attributes?.version ?? current.data?.id ?? null;
  if (current.data?.id === build.id) {
    console.log(green(`  version ${versionString} already points at build ${build.attributes.version}`));
    return;
  }

  const r = await client.patch(`/v1/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: "builds", id: build.id },
  });
  if (r.status < 300) {
    const from = was ? `build ${was} -> ` : "";
    console.log(green(`  version ${versionString}: ${from}build ${build.attributes.version}`));
  } else {
    console.error(yellow(`  could not attach the build to version ${versionString} (${r.status})`));
  }
}

const indent = (text) =>
  String(text)
    .trim()
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
