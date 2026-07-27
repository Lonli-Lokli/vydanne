import { green, red, yellow, LIMITS, VERSION_FIELDS } from "../util.mjs";
import { reportCrossStore } from "../crossStore.mjs";
import { localScreenshots, remoteScreenshots, compareShots } from "../screenshots.mjs";

// Verify a listing is submission-complete the CORRECT way — each localization read by id (not the sparse
// list), char limits, primary-locale coverage, per-platform — and warn on the gotchas before ASC does.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const problems = [], notes = [];
  const res = config.resolvedLocales;
  if (res.unsupported.length) notes.push(`UI locales with no App Store listing (fall back to ${config.primaryLocale}): ${res.unsupported.join(", ")}`);

  for (const platform of config.platforms) {
    // A blocker, and now reachable: this guard existed before but editVersion() handed back the LIVE
    // version instead of null, so preflight validated the shipped listing and called it submittable.
    const v = await client.editVersion(platform);
    if (!v) {
      problems.push(`${platform}: no editable version — run \`vydanne prepare --apply\` to create one`);
      continue;
    }
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
      // By CONTENT, not by count — the same comparison `diff` runs (src/screenshots.mjs), so the two
      // cannot disagree about what "in sync" means. The count-only check this replaces called a STALE
      // set green: a full local recapture left three-local-vs-three-remote, preflight said "no
      // blockers", and the submission would have shipped the old art — which is precisely the state
      // Niva sat in with store screenshots still showing a three-tier selector the app no longer had.
      const remote = await remoteScreenshots(client, primary.id);
      const count = Object.values(remote).reduce((n, m) => n + m.size, 0);
      if (!count) problems.push(`${platform}/${config.primaryLocale}: no screenshots`);
      // Freshness is judged only where a local set exists: no local screenshots means there is nothing
      // to compare against, not that the store's are wrong. A display type the store has and local
      // lacks is likewise left alone — `fill` never deletes by omission, so this does not flag it.
      for (const [dt, L] of Object.entries(localScreenshots(platform, config.primaryLocale))) {
        const c = compareShots(L, remote[dt] || new Map());
        if (!c) continue;
        const slot = dt.replace("APP_", "");
        if (c.kind === "count") problems.push(`${platform}/${config.primaryLocale}: screenshots ${slot} local ${c.local} / remote ${c.remote} — the store set is not the local one (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else if (c.kind === "renamed") problems.push(`${platform}/${config.primaryLocale}: screenshots ${slot} ${c.names.length} local file(s) not on the store by name (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else if (c.kind === "stale") problems.push(`${platform}/${config.primaryLocale}: screenshots ${slot} STALE — ${c.names.length} of ${c.of} differ in content; green would ship the old art (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else notes.push(`${platform}/${config.primaryLocale}: screenshots ${slot} present, checksum not reported by Apple — content unverified`);
      }
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
