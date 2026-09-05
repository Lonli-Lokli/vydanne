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

    // Tracks, newest release first within each. A track with no releases is omitted rather than
    // printed empty: Play returns every track it knows about, including ones this app has never
    // shipped to, and listing those as blank rows buries the two lines that matter.
    const tracks = (await client.listTracks(editId)).json.tracks || [];
    const rows = [];
    for (const t of tracks) {
      for (const rel of t.releases || []) {
        const codes = rel.versionCodes || [];
        if (!codes.length) continue;
        // `userFraction` is only present on a staged rollout; absent means the release is at 100%.
        const staged = rel.userFraction != null ? `  ${Math.round(rel.userFraction * 100)}% rollout` : "";
        rows.push(`    ${t.track.padEnd(12)} ${codes.join(",").padEnd(8)} ${(rel.name || "-").padEnd(12)} ${rel.status}${staged}`);
      }
    }
    if (rows.length) {
      console.log(`  tracks (${rows.length}):`);
      console.log(`    ${"track".padEnd(12)} ${"code".padEnd(8)} ${"name".padEnd(12)} status`);
      for (const r of rows) console.log(r);
    } else {
      console.log("  tracks: (nothing published — no track carries a release)");
    }
  } finally {
    await client.deleteEdit(editId);
  }
  return true;
}
