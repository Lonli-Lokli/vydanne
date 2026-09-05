import { commitOrder, commitForBuild, tagsAt } from "../../buildCommit.mjs";
import { green, yellow } from "../../util.mjs";

const LIFECYCLE = {
  RELEASE_LIFECYCLE_STATE_PUBLISHED: "published",
  RELEASE_LIFECYCLE_STATE_IN_REVIEW: "in review",
  RELEASE_LIFECYCLE_STATE_DRAFT: "draft",
  RELEASE_LIFECYCLE_STATE_HALTED: "halted",
};

/**
 * **What each track is serving, resolved to the commit it was built from.**
 *
 * The overlap with `inspect --store google` is deliberate and small: that command answers "what
 * state is this listing in", this one answers "what do I tag". Same source of truth — the non-edit
 * `tracks/<t>/releases` endpoint, because the edit's own view is the last thing WRITTEN rather than
 * what is serving — plus the commit and tag columns.
 *
 * ### Play cannot give you a history, and pretending otherwise would be the bug
 *
 * `tracks/<t>/releases` returns what a track carries NOW. There is no endpoint for superseded
 * production releases, so a game that pushed several of them under one version name has no record of
 * the earlier ones — Niva did exactly that, which is why its `marketingVersion` comment exists at
 * all. `edits.bundles` lists every versionCode ever uploaded and is shown below for that reason, but
 * uploaded is not released and a tag must never be minted from it.
 *
 * So: tag as you release. This command can confirm what is out there today and cannot reconstruct
 * what was out there last year.
 *
 * ### No out-of-sequence check here, and that is Google's doing rather than an omission
 *
 * The Apple command needs [outOfSequence] because App Store Connect accepted a build numbered `1`
 * above a `131` — a build-number fallback firing silently. Play refuses that upload outright:
 * a versionCode must exceed every code already used for the package, enforced at `edits.bundles`.
 * The invariant the whole commit mapping rests on is therefore guaranteed on this store and merely
 * hoped for on the other, which is worth knowing when a build number looks wrong.
 */
export async function run(config, client) {
  const g = config.google;
  console.log(`PLAY ${g.packageName}`);

  const order = commitOrder();
  if (!order) console.log(yellow("  not a git checkout — commit and tag columns unavailable"));

  const editId = await client.newEdit();
  let uploaded = [];
  const rows = [];
  // Tracks that could not be read. A command whose job is "what still needs a tag" must never let a
  // transient failure read as "nothing else to tag" — the releases endpoint is quota-limited ("The
  // service is currently unavailable", "Listing releases quota exceeded") and a normal day reaches
  // it, so a missing row is a state to announce rather than one to quietly skip.
  const unreadable = [];
  try {
    const edited = (await client.listTracks(editId)).json.tracks || [];
    for (const t of edited) {
      const res = await client.trackReleases(t.track);
      // 404 = never shipped to this track. 204 = the track exists and carries nothing, with no body
      // to report. Both are "no rows", not failures; reporting 204 as unreadable put a yellow
      // warning on every app with an empty `beta` track, which is most of them.
      if (res.status === 404 || res.status === 204) continue;
      if (res.status !== 200) {
        unreadable.push(`${t.track} (${res.json?.error?.message || `HTTP ${res.status}`})`);
        continue;
      }
      for (const rel of res.json.releases || []) {
        for (const art of rel.activeArtifacts || []) {
          rows.push({
            track: t.track,
            code: art.versionCode,
            name: rel.releaseName || "-",
            state: LIFECYCLE[rel.releaseLifecycleState] || rel.releaseLifecycleState || "?",
          });
        }
      }
    }
    uploaded = ((await client.req("GET", `/edits/${editId}/bundles`)).json.bundles || [])
      .map((b) => b.versionCode).sort((a, b) => a - b);
  } finally {
    await client.deleteEdit(editId);
  }

  if (unreadable.length) {
    console.log(yellow(`  INCOMPLETE — could not read: ${unreadable.join(", ")}`));
    console.log(yellow("  Re-run before concluding anything is untagged; this is usually a quota blip."));
  }
  if (!rows.length) {
    console.log(unreadable.length ? "  no readable track carries a release" : "  nothing published — no track carries a release");
  } else {
    console.log(`  ${"track".padEnd(12)}${"code".padEnd(7)}${"name".padEnd(13)}${"state".padEnd(11)}${"commit".padEnd(11)}tag`);
    const untagged = [];
    for (const row of rows) {
      let commit = "-";
      let tag = "-";
      let note = "";
      const got = commitForBuild(order, row.code);
      if (got.sha) {
        commit = got.sha.slice(0, 9);
        const tags = tagsAt(got.sha);
        tag = tags.length ? tags.join(" ") : yellow("(untagged)");
        // Only `production` is a release to users. A closed track is a test, and a tag claiming
        // otherwise is worse than no tag — this portfolio ships to `alpha` before every promotion,
        // so nagging about those would nag on every single release.
        if (!tags.length && row.track === "production" && row.state === "published") {
          untagged.push([`play/${row.name}+${row.code}`, got.sha.slice(0, 9)]);
        }
      } else {
        note = yellow(got.why);
      }
      const live = row.track === "production" && row.state === "published";
      console.log(
        `  ${row.track.padEnd(12)}${String(row.code).padEnd(7)}${row.name.padEnd(13)}` +
        `${cell(row.state, 11, live ? green : null)}${commit.padEnd(11)}${tag}${note ? "  " + note : ""}`,
      );
    }
    if (untagged.length) {
      console.log(`\n  ${untagged.length} production release(s) carry no tag${unreadable.length ? " (of the tracks that could be read)" : ""}:`);
      for (const [name, sha] of untagged) console.log(`    git tag -a ${name} ${sha} -m "…"`);
    }
  }

  if (uploaded.length) {
    console.log(`\n  bundles uploaded (${uploaded.length}): ${uploaded.join(", ")}`);
    console.log("  Uploaded is NOT released — never tag from this line. Superseded production");
    console.log("  releases are not retrievable from the Play API at all, so tag as you release.");
  }
  return true;
}

/** Pad to [width] on the plain text, then colour — `padEnd` counts ANSI escapes as characters. */
function cell(text, width, colour) {
  const padded = String(text).padEnd(width);
  return colour ? colour(String(text)) + padded.slice(String(text).length) : padded;
}
