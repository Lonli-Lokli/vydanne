const IMAGE_TYPES = ["phoneScreenshots", "sevenInchScreenshots", "tenInchScreenshots", "wearScreenshots", "tvScreenshots", "featureGraphic", "icon", "promoGraphic"];

// Read-only snapshot of the Play listing — languages, contact details, image counts, and WHAT IS
// PUBLISHED WHERE. Everything reads through one throwaway edit (deleted, never committed), the same
// as the ASC `inspect`.
//
// The tracks half was missing until 2026-09-05, and its absence was the difference between "the
// upload command said it worked" and knowing. `inspect` reported the listing beautifully and could
// not answer the only question anyone asks after a release — which build is on which track, under
// what version name — so that had to be worked out by hand against the raw androidpublisher API.
// A read-only command that cannot show you the state you just changed is half a command.
export async function run(config, client) {
  const g = config.google;
  const editId = await client.newEdit();
  try {
    const details = (await client.getDetails(editId)).json;
    const listings = (await client.getListings(editId)).json.listings || [];
    console.log(`PLAY ${g.packageName}  default=${details.defaultLanguage}  contact=${details.contactEmail || "-"}`);
    console.log(`  listings (${listings.length}): ${listings.map((l) => l.language).join(", ") || "(none)"}`);
    const lang = details.defaultLanguage || g.defaultLocale;
    const counts = [];
    for (const t of IMAGE_TYPES) {
      const imgs = (await client.listImages(editId, lang, t)).json.images || [];
      if (imgs.length) counts.push(`${t}=${imgs.length}`);
    }
    console.log(`  images (${lang}): ${counts.join("  ") || "(none)"}`);

    // What is actually ON each track, which is NOT what the edit says is on it.
    //
    // The edit's own `tracks` gives the desired state — the last thing written — so straight after
    // an upload it happily reports the new build and nothing else. The track's `releases` endpoint
    // reports reality: the build in review AND the older one still serving testers underneath it,
    // because a new build does not reach anyone until review passes. Reporting the edit view alone
    // said a release was live when nobody had it (measured on Niva, 2026-09-05).
    //
    // So the edit is used only to enumerate track NAMES; every state below comes from the
    // non-edit endpoint.
    const LIFECYCLE = {
      RELEASE_LIFECYCLE_STATE_PUBLISHED: "published",
      RELEASE_LIFECYCLE_STATE_IN_REVIEW: "in review",
      RELEASE_LIFECYCLE_STATE_DRAFT: "draft",
      RELEASE_LIFECYCLE_STATE_HALTED: "halted",
      RELEASE_LIFECYCLE_STATE_UNSPECIFIED: "unspecified",
    };
    const names = ((await client.listTracks(editId)).json.tracks || []).map((t) => t.track);
    const rows = [];
    for (const name of names) {
      // A track the app has never shipped to answers 404 here. That is information, not an error:
      // it is the difference between "empty" and "does not exist", and neither is worth a row.
      const res = await client.trackReleases(name).catch(() => null);
      for (const rel of res?.json?.releases || []) {
        const codes = (rel.activeArtifacts || []).map((a) => a.versionCode).join(",") || "-";
        const state = LIFECYCLE[rel.releaseLifecycleState] || rel.releaseLifecycleState || "?";
        const staged = rel.userFraction != null ? `  ${Math.round(rel.userFraction * 100)}% rollout` : "";
        rows.push(`    ${name.padEnd(12)} ${codes.padEnd(8)} ${(rel.releaseName || "-").padEnd(12)} ${state}${staged}`);
      }
    }
    if (rows.length) {
      console.log(`  tracks (${rows.length} release(s)):`);
      console.log(`    ${"track".padEnd(12)} ${"code".padEnd(8)} ${"name".padEnd(12)} state`);
      for (const r of rows) console.log(r);
    } else {
      console.log("  tracks: (nothing published — no track carries a release)");
    }
  } finally {
    await client.deleteEdit(editId);
  }
  return true;
}
