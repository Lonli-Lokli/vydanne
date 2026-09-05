import { green, yellow, red } from "../util.mjs";

/**
 * **Take a version back out of App Store review.**
 *
 * The gap this fills was a real one, found by hitting it: a version sits in `WAITING_FOR_REVIEW`
 * with something wrong in it — a blank screenshot, a build numbered by a fallback — and every
 * command that could fix it refuses, correctly, because Apple locks a submitted version. `prepare`
 * says *"withdraw it in App Store Connect, then re-run this"*. `prerelease` says *"re-pointing it
 * would mean withdrawing that submission, which is your call."* Three files said the same thing and
 * none of them could do it, so the one step between a known defect and its fix was a web form.
 *
 * ### It is the mirror of Play's production refusal, not a new kind of power
 *
 * `prerelease --store google` refuses the `production` track outright — not behind a flag —
 * because *"that release is a human's to make"*. This is the same rule pointed the other way: it
 * will take back something that is **waiting**, and it will not touch what customers already have.
 * A version in `READY_FOR_SALE` is refused, flatly, the way `production` is.
 *
 * And it stays on the safe side of the line vydanne draws everywhere else: this UNDOES a
 * submission, it never makes one. Submitting for review remains the human's click.
 *
 * ### Withdrawing is not free, so the states are enumerated rather than filtered
 *
 * `WAITING_FOR_REVIEW` costs a place in the queue and nothing else — the review has not begun.
 * `IN_REVIEW` costs a review already in progress and starts it over, which is a different decision,
 * so it is allowed but announced. Everything else is refused with the reason, because a state this
 * command cannot help with is worth naming: `PENDING_DEVELOPER_RELEASE` is *approved* and waiting
 * for you, and throwing that away to change a screenshot is almost never what anyone means.
 */

/** States where a submission exists and taking it back is what the operator meant. */
const WITHDRAWABLE = {
  WAITING_FOR_REVIEW: "queued but not yet picked up — withdrawing costs the place in the queue",
  IN_REVIEW: "ALREADY BEING REVIEWED — withdrawing discards a review in progress and starts over",
};

/** States where there is nothing to withdraw, each with the reason it is not an error. */
const NOTHING_TO_DO = {
  PREPARE_FOR_SUBMISSION: "not submitted — it is already editable",
  DEVELOPER_REJECTED: "already withdrawn",
  REJECTED: "already out of review (Apple rejected it)",
  METADATA_REJECTED: "already out of review (metadata rejected)",
  INVALID_BINARY: "already out of review (invalid binary)",
};

export async function run(config, client) {
  await client.findApp(config.bundleId);
  console.log(green(`withdraw → ${client.app.attributes.name} (${config.bundleId})`));

  const versions = await client.get(
    `/v1/apps/${client.appId}/appStoreVersions?limit=10&fields[appStoreVersions]=versionString,appStoreState,platform`,
  );
  const mine = (versions.json.data || []).filter((v) => config.platforms.includes(v.attributes.platform));
  if (!mine.length) {
    console.log("  no versions on this app");
    return true;
  }
  const version = mine[0];
  const state = version.attributes.appStoreState;
  const label = `${version.attributes.versionString} (${state})`;

  // LIVE IS REFUSED, and this is the whole safety of the command. Play's side will not write the
  // production track; this will not touch the version customers are downloading. Same rule, and
  // neither is behind a flag.
  if (state === "READY_FOR_SALE") {
    console.error(red(`  refusing: ${label} is the version customers have.`));
    console.error("  This command takes a version out of REVIEW. Removing a live version from sale");
    console.error("  is a different act with a different blast radius, and it is not this tool's.");
    return false;
  }
  if (NOTHING_TO_DO[state]) {
    console.log(`  ${label}: ${NOTHING_TO_DO[state]} — nothing to withdraw`);
    return true;
  }
  if (!WITHDRAWABLE[state]) {
    console.error(red(`  refusing: ${label} is not a state this command can take back.`));
    console.error("  Withdrawable states are WAITING_FOR_REVIEW and IN_REVIEW. A version that is");
    console.error("  approved and waiting on you, or mid-processing, is a decision to make in the UI.");
    return false;
  }

  // The submission, not the version, is what gets cancelled — a review submission can carry more
  // than the app version (in-app purchases, for one), and Apple takes the whole thing back at once.
  const subs = await client.get(`/v1/apps/${client.appId}/reviewSubmissions?limit=10`);
  const open = (subs.json.data || []).find((s) => WITHDRAWABLE[s.attributes.state]);
  if (!open) {
    console.log(yellow(`  ${label} says it is in review, but no open submission was found.`));
    console.log("  Nothing was changed. This is worth looking at in App Store Connect.");
    return false;
  }

  console.log(`  version ${label}`);
  console.log(`  submission ${open.id}  submitted ${String(open.attributes.submittedDate).slice(0, 19)}`);
  console.log(yellow(`  ${WITHDRAWABLE[state]}`));

  const r = await client.patch(`/v1/reviewSubmissions/${open.id}`, {
    data: { type: "reviewSubmissions", id: open.id, attributes: { canceled: true } },
  });
  if (r.status >= 300) {
    console.error(red(`  cancel failed — HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`));
    return false;
  }
  // In a dry run the client records the PATCH instead of sending it, so the CLI's own
  // "N store write(s) withheld" summary stays accurate — an early return here would have reported
  // zero writes and printed "the store already matches local", which is the opposite of true.
  if (client.dryRun) {
    console.log(yellow("  DRY RUN — the submission is untouched. Re-run with --apply to withdraw it."));
    return true;
  }
  console.log(green(`  cancelled — submission is ${r.json.data.attributes.state}`));

  // Apple moves through CANCELING before the version becomes editable, and a command that returned
  // at "CANCELING" would send the operator straight into a `fill` that fails on a locked version.
  // Waiting the few seconds is the difference between a command that worked and one that appeared to.
  for (let i = 0; i < 10; i++) {
    const v = await client.get(`/v1/appStoreVersions/${version.id}?fields[appStoreVersions]=appStoreState`);
    const now = v.json.data?.attributes?.appStoreState;
    if (now && now !== state) {
      console.log(green(`  version ${version.attributes.versionString} is now ${now} — editable again`));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.log(yellow("  cancelled, but the version has not left review yet — re-check in a moment."));
  return true;
}
