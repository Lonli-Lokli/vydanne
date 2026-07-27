import { green, red, yellow, LIMITS, VERSION_FIELDS } from "../util.mjs";
import { reportCrossStore } from "../crossStore.mjs";

// Verify a listing is submission-complete the CORRECT way — each localization read by id (not the sparse
// list), char limits, primary-locale coverage, per-platform — and warn on the gotchas before ASC does.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const problems = [], notes = [];
  const res = config.resolvedLocales;
  if (res.unsupported.length) notes.push(`UI locales with no App Store listing (fall back to ${config.primaryLocale}): ${res.unsupported.join(", ")}`);

  for (const platform of config.platforms) {
    const v = await client.editVersion(platform);
    if (!v) { problems.push(`${platform}: no editable version`); continue; }
    console.log(`  ${platform}: version ${v.attributes.versionString} (${v.attributes.appStoreState})`);
    const locs = await client.versionLocalizations(v.id);
    const ascLocales = [...new Set([config.primaryLocale, ...Object.values(res.supported)])];

    for (const code of ascLocales) {
      const loc = locs.find((l) => l.attributes.locale === code);
      if (!loc) { if (code === config.primaryLocale) problems.push(`${platform}/${code}: localization missing`); continue; }
      const a = await client.localization(loc.id);
      for (const [f, key] of Object.entries(VERSION_FIELDS)) {
        const val = (a[key] || "").toString();
        if (!val) (code === config.primaryLocale ? problems : notes).push(`${platform}/${code}: ${f} EMPTY`);
        else if (LIMITS[f] && val.length > LIMITS[f]) problems.push(`${platform}/${code}: ${f} ${val.length}>${LIMITS[f]}`);
      }
    }

    const primary = locs.find((l) => l.attributes.locale === config.primaryLocale);
    if (primary) {
      const { json } = await client.get(`/v1/appStoreVersionLocalizations/${primary.id}/appScreenshotSets?include=appScreenshots&limit=50`);
      const count = (json.data || []).reduce((n, s) => n + (s.relationships?.appScreenshots?.data || []).length, 0);
      if (!count) problems.push(`${platform}/${config.primaryLocale}: no screenshots`);
    }
  }

  // Local copy that is about to be uploaded, checked before it can earn a rejection.
  if (!reportCrossStore("apple", config.metadataDir, config.allowCrossStoreTerms)) {
    problems.push("listing text references another mobile platform (see above)");
  }

  console.log();
  if (!problems.length) console.log(green("preflight: no blockers"));
  else { console.log(red(`preflight: ${problems.length} blocker(s)`)); problems.forEach((p) => console.log(`  ${red("x")} ${p}`)); }
  notes.forEach((n) => console.log(`  ${yellow("!")} ${n}`));
  return problems.length === 0;
}
