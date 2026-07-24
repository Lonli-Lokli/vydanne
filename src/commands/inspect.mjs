// Read-only snapshot of what's in App Store Connect now, per platform.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  console.log(`APP ${client.app.attributes.name} (${config.bundleId})  id=${client.appId}  primary=${client.app.attributes.primaryLocale}`);
  for (const platform of config.platforms) {
    const v = await client.editVersion(platform);
    if (!v) { console.log(`  ${platform}: no editable version`); continue; }
    const locs = await client.versionLocalizations(v.id);
    console.log(`  ${platform}: v${v.attributes.versionString}  ${v.attributes.appStoreState}  localizations=${locs.length}`);
    const primary = locs.find((l) => l.attributes.locale === config.primaryLocale) || locs[0];
    if (!primary) continue;
    const ss = await client.get(`/v1/appStoreVersionLocalizations/${primary.id}/appScreenshotSets?include=appScreenshots&limit=50`);
    const sets = (ss.json.data || []).map((s) => `${s.attributes.screenshotDisplayType.replace("APP_", "")}=${(s.relationships?.appScreenshots?.data || []).length}`);
    if (sets.length) console.log(`     screenshots (${primary.attributes.locale}): ${sets.join("  ")}`);
    const pp = await client.get(`/v1/appStoreVersionLocalizations/${primary.id}/appPreviewSets?include=appPreviews&limit=50`);
    const psets = (pp.json.data || []).map((s) => `${s.attributes.previewType}=${(s.relationships?.appPreviews?.data || []).length}`).filter((x) => !x.endsWith("=0"));
    if (psets.length) console.log(`     previews (${primary.attributes.locale}): ${psets.join("  ")}`);
  }
  return true;
}
