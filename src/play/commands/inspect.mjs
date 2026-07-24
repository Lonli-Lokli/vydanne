const IMAGE_TYPES = ["phoneScreenshots", "sevenInchScreenshots", "tenInchScreenshots", "wearScreenshots", "tvScreenshots", "featureGraphic", "icon", "promoGraphic"];

// Read-only snapshot of the Play listing — languages, contact details, image counts. Everything reads
// through one throwaway edit (deleted, never committed), the same as the ASC `inspect`.
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
  } finally {
    await client.deleteEdit(editId);
  }
  return true;
}
