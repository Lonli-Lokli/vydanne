import { green, red, yellow, LIMITS, VERSION_FIELDS } from "../util.mjs";
import { reportCrossStore } from "../crossStore.mjs";
import path from "node:path";
import { localScreenshots, remoteScreenshots, compareShots, localScreenshotLocales, unknownScreenshotDirs, screenshotBase } from "../screenshots.mjs";
import { centreColours, BLANK_BELOW } from "../blankShot.mjs";

// Verify a listing is submission-complete the CORRECT way — each localization read by id (not the sparse
// list), char limits, primary-locale coverage, per-platform — and warn on the gotchas before ASC does.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const problems = [], notes = [];
  const res = config.resolvedLocales;
  if (res.unsupported.length) notes.push(`UI locales with no App Store listing (fall back to ${config.primaryLocale}): ${res.unsupported.join(", ")}`);
  if (res.invalid?.length) problems.push(`localeMap points at code(s) Apple does not have: ${res.invalid.join(", ")}`);

  // name/subtitle live on the APP-INFO record, not the version, which is why they were never checked
  // here — LIMITS has carried a 30-char limit for each since the beginning and nothing read it, while
  // the README listed them among the limits "checked before upload". Read-only, so `allowLive` is
  // right: on an app with nothing in preparation the live record is the only one to measure.
  const info = await client.appInfo({ allowLive: true });

  // ── The fields no LOCAL file drives ─────────────────────────────────────────────────────────────
  //
  // Everything else here compares local metadata against the store, which is the right question for
  // anything `fill` uploads and the wrong one for the half-dozen fields set by their own standalone
  // command. Those are invisible to a local-vs-remote diff: there is nothing local to differ from, so
  // a field that was NEVER SET reads exactly like one that matches.
  //
  // Reported from the field: a listing reached PREPARE_FOR_SUBMISSION with an empty copyright and no
  // App Review contact at all, while this command printed "no blockers". `prepare` sets the first and
  // `review-contact` the second; neither is part of `fill`, and neither had ever been run. Preflight
  // was not wrong so much as asked the wrong question — so it now also asks whether the listing is
  // SUBMITTABLE, which only the store can answer.
  const rights = client.app?.attributes?.contentRightsDeclaration;
  if (!rights) problems.push("content rights not declared — `vydanne appinfo --apply`");
  if (info) {
    if (!info.attributes.appStoreAgeRating) problems.push("age rating not declared — `vydanne age-rating --apply`");
    const primary = (await client.get(`/v1/appInfos/${info.id}/primaryCategory`)).json?.data?.id;
    if (!primary) problems.push("primary category not set — `vydanne appinfo --apply`");
  }

  if (info) {
    const infoLocs = (await client.get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`)).json.data || [];
    for (const il of infoLocs) {
      const a = await client.localization(il.id, "appInfoLocalizations");
      for (const f of ["name", "subtitle"]) {
        const val = (a[f] || "").toString();
        if (!val) { if (f === "name" && il.attributes.locale === config.primaryLocale) problems.push(`${il.attributes.locale}: name EMPTY`); continue; }
        if (val.length > LIMITS[f]) problems.push(`${il.attributes.locale}: ${f} ${val.length}>${LIMITS[f]}`);
      }
    }
  }

  for (const platform of config.platforms) {
    // A blocker, and now reachable: this guard existed before but editVersion() handed back the LIVE
    // version instead of null, so preflight validated the shipped listing and called it submittable.
    const v = await client.editVersion(platform);
    if (!v) {
      problems.push(`${platform}: no editable version — run \`vydanne prepare --apply\` to create one`);
      continue;
    }
    console.log(`  ${platform}: version ${v.attributes.versionString} (${v.attributes.appStoreState})`);

    // Required, and set by `prepare` from <metadataDir>/copyright.txt — not by `fill`.
    if (!v.attributes.copyright) {
      problems.push(`${platform}: copyright EMPTY — set ${config.metadataDir}/copyright.txt, then \`vydanne prepare --apply\``);
    }

    // The App Review contact. Apple will not take a submission without one, and it is per-VERSION, so
    // a contact set on a previous version does not carry forward on its own.
    const detail = (await client.get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`)).json?.data?.attributes;
    const CONTACT = ["contactFirstName", "contactLastName", "contactPhone", "contactEmail"];
    const missing = detail ? CONTACT.filter((f) => !detail[f]) : CONTACT;
    if (missing.length) {
      problems.push(`${platform}: App Review contact ${detail ? `missing ${missing.join(", ")}` : "not set"} — \`vydanne review-contact --apply\``);
    } else if (detail.demoAccountRequired && !detail.demoAccountName) {
      // The rejection `review-contact` exists to avoid, arriving by the door of nobody running it.
      problems.push(`${platform}: demoAccountRequired is true but no demo account is set — Apple rejects this`);
    }
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

    // EVERY locale with a local screenshot folder, not just the primary one.
    //
    // By CONTENT, not by count — the same comparison `diff` runs (src/screenshots.mjs), so the two
    // cannot disagree about what "in sync" means. The count-only check that replaced called a STALE
    // set green: a full local recapture left three-local-vs-three-remote, preflight said "no blockers",
    // and the submission would have shipped the old art — which is precisely the state Niva sat in with
    // store screenshots still showing a three-tier selector the app no longer had.
    //
    // Restricting that to `primaryLocale` left the same hole open one locale over, and `bridge` widened
    // it: it populates a folder per translated locale, so a de-DE set re-rendered upstream but never
    // re-uploaded passed green while the primary one was checked in full.
    const shotLocales = [...new Set([config.primaryLocale, ...localScreenshotLocales(platform, config)])];
    const strays = unknownScreenshotDirs(platform, config);
    if (strays.length) notes.push(`${platform}: screenshot folder(s) that are not App Store locale codes, never uploaded: ${strays.join(", ")}`);

    for (const code of shotLocales) {
      const loc = locs.find((l) => l.attributes.locale === code);
      if (!loc) continue; // a missing primary localization is already a blocker above
      const remote = await remoteScreenshots(client, loc.id);
      const count = Object.values(remote).reduce((n, m) => n + m.size, 0);
      // Only the primary listing MUST have screenshots — Apple falls back to it for any locale without.
      if (!count && code === config.primaryLocale) problems.push(`${platform}/${code}: no screenshots`);

      // Freshness is judged only where a local set exists: no local screenshots means there is nothing
      // to compare against, not that the store's are wrong. A display type the store has and local
      // lacks is likewise left alone — `fill` never deletes by omission, so this does not flag it.
      for (const [dt, L] of Object.entries(localScreenshots(platform, code, config))) {
        const slot = dt.replace("APP_", "");

        // IS THERE A SCREEN IN THE SCREENSHOT? Every other check here is about presence, naming and
        // freshness, and a blank file passes all three perfectly — which is how Palon uploaded a
        // device frame containing pure white and an iOS status bar to a version that reached App
        // Store review. zdymak photographs whatever the app draws and reports success, the bridge
        // copies what it is handed, `fill` uploads it. This is the only place in the chain that
        // looks at the pixels. It runs before the comparison below on purpose: a blank file that
        // matches the store is worse news than one that does not.
        for (const name of L.keys()) {
          const colours = centreColours(path.join(screenshotBase(platform, config), code, name));
          if (colours !== null && colours < BLANK_BELOW) {
            problems.push(
              `${platform}/${code}: screenshot ${slot}/${name} is BLANK — ${colours} distinct ` +
              "colours in the middle of the frame, so the app drew nothing. Re-capture it; " +
              "uploading this ships a white rectangle to the store.",
            );
          }
        }

        const c = compareShots(L, remote[dt] || new Map());
        if (!c) continue;
        if (c.kind === "count") problems.push(`${platform}/${code}: screenshots ${slot} local ${c.local} / remote ${c.remote} — the store set is not the local one (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else if (c.kind === "renamed") problems.push(`${platform}/${code}: screenshots ${slot} ${c.names.length} local file(s) not on the store by name (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else if (c.kind === "stale") problems.push(`${platform}/${code}: screenshots ${slot} STALE — ${c.names.length} of ${c.of} differ in content; green would ship the old art (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else notes.push(`${platform}/${code}: screenshots ${slot} present, checksum not reported by Apple — content unverified`);
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
