import { commitOrder, commitForBuild, outOfSequence, tagsAt } from "../buildCommit.mjs";
import { green, yellow } from "../util.mjs";

/**
 * **Every version this app has ever had on the App Store, with the build each one shipped.**
 *
 * `inspect` cannot answer this and never could: it reports the version in preparation, or the live
 * one, and nothing behind them. That gap has a cost on the record — three of Niva's release tags
 * carry messages saying so in their own words, *"Not confirmed against App Store Connect:
 * historical build numbers are not exposed by vydanne inspect"* — and all three turned out to be
 * wrong, by 9, 3 and 23 commits. They had been tagged at the commits that bumped
 * `MARKETING_VERSION`, which is the intuitive place and the wrong one, because the build is archived
 * days later.
 *
 * The history was never actually unavailable. `inspect` just does not ask for it:
 * `appStoreVersions?include=build` returns every version with the build attached to it. This command
 * is that one request, plus the two columns that make it actionable.
 *
 * ### Read-only, and the reason it is a command rather than a note
 *
 * Tagging a release is the one job here that has to be right months later and cannot be checked by
 * looking. A wrong tag is not a wrong label — it silently sends whoever is chasing a crash report to
 * a tree that never shipped, and nothing about it looks wrong.
 */
export async function run(config, client) {
  await client.findApp(config.bundleId);
  console.log(`APP ${client.app.attributes.name} (${config.bundleId})  id=${client.appId}`);

  const r = await client.get(`/v1/apps/${client.appId}/appStoreVersions?include=build&limit=200`);
  if (r.status >= 300) {
    console.log(yellow(`  could not read versions — HTTP ${r.status}`));
    return false;
  }
  const builds = Object.fromEntries(
    (r.json.included || []).filter((i) => i.type === "builds").map((b) => [b.id, b.attributes.version]),
  );
  const versions = (r.json.data || []).filter((v) => config.platforms.includes(v.attributes.platform));
  if (!versions.length) {
    console.log("  no versions on this app");
    return true;
  }

  const order = commitOrder();
  if (!order) console.log(yellow("  not a git checkout — commit and tag columns unavailable"));

  // Newest first: the question is almost always about the last one or two.
  versions.sort((a, b) => String(b.attributes.createdDate).localeCompare(String(a.attributes.createdDate)));

  // The highest build seen among versions OLDER than each row, so a build that went backwards can be
  // recognised. Computed oldest-first, then the table prints newest-first.
  const priorMax = new Map();
  let running = null;
  for (const v of [...versions].reverse()) {
    priorMax.set(v.id, running);
    const b = Number(builds[v.relationships?.build?.data?.id]);
    if (Number.isInteger(b)) running = running == null ? b : Math.max(running, b);
  }

  console.log(`  ${"version".padEnd(9)}${"state".padEnd(23)}${"date".padEnd(12)}${"build".padEnd(7)}${"commit".padEnd(11)}tag`);
  const untagged = [];
  for (const v of versions) {
    const a = v.attributes;
    const build = builds[v.relationships?.build?.data?.id];
    const shipped = a.appStoreState === "READY_FOR_SALE";
    let commit = "-";
    let tag = "-";
    let note = "";
    const backwards = build == null ? null : outOfSequence(build, priorMax.get(v.id));
    if (build == null) {
      note = "no build attached yet";
    } else if (backwards) {
      note = yellow(backwards);
    } else {
      const got = commitForBuild(order, build);
      if (got.sha) {
        commit = got.sha.slice(0, 9);
        const tags = tagsAt(got.sha);
        tag = tags.length ? tags.join(" ") : yellow("(untagged)");
        // Only a version actually on sale earns a nag. One in review has not shipped, and a tag
        // saying it has is worse than no tag — tag it when it goes live.
        if (!tags.length && shipped) untagged.push([`ios/${a.versionString}+${build}`, got.sha.slice(0, 9)]);
      } else {
        note = yellow(got.why);
      }
    }
    // Padded on the PLAIN text, then coloured. `padEnd` counts ANSI escapes as characters, so
    // colouring first silently shortens every highlighted cell and the columns stop lining up.
    console.log(
      `  ${a.versionString.padEnd(9)}${cell(a.appStoreState, 23, shipped ? green : null)}` +
      `${String(a.createdDate).slice(0, 10).padEnd(12)}${String(build ?? "-").padEnd(7)}` +
      `${commit.padEnd(11)}${tag}${note ? "  " + note : ""}`,
    );
  }

  if (untagged.length) {
    console.log(`\n  ${untagged.length} shipped version(s) carry no tag:`);
    for (const [name, sha] of untagged) console.log(`    git tag -a ${name} ${sha} -m "…"`);
  }
  return true;
}

/** Pad to [width] on the plain text, then colour — see the note at the call site. */
function cell(text, width, colour) {
  const padded = String(text).padEnd(width);
  return colour ? colour(String(text)) + padded.slice(String(text).length) : padded;
}
