import { green, red, yellow, LIMITS, VERSION_FIELDS } from "../util.mjs";
import { reportCrossStore } from "../crossStore.mjs";
import path from "node:path";
import { localScreenshots, remoteScreenshots, compareShots, localScreenshotLocales, unknownScreenshotDirs, screenshotBase, duoRequired, DUO_REQUIRED_FROM, IPHONE_TYPES } from "../screenshots.mjs";
import { centreColours, BLANK_BELOW } from "../blankShot.mjs";
import { loadCatalog, matchFile, SNAPSHOT_DATE } from "../assetCatalog.mjs";
import { checkCreative, compareCreative, creativeBase } from "../creative.mjs";
import { placementsOn } from "../assetLibrary.mjs";

// Verify a listing is submission-complete the CORRECT way — each localization read by id (not the sparse
// list), char limits, primary-locale coverage, per-platform — and warn on the gotchas before ASC does.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const problems = [], notes = [];
  // Apple's own specifications, read live (a GET) — what sizes each screenshot set and creative slot
  // takes, and how many files a set holds. The snapshot answers when the API does not, and says so.
  const catalog = await loadCatalog(client);
  if (catalog.source !== "live") notes.push(`Apple's asset reference data was not readable (${catalog.why || "no client"}) — sizes checked against the snapshot of ${SNAPSHOT_DATE}`);
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

    let primaryShots = null; // { local, remote } for the primary locale — the Duo rule below reads it
    for (const code of shotLocales) {
      const loc = locs.find((l) => l.attributes.locale === code);
      if (!loc) continue; // a missing primary localization is already a blocker above
      const remote = await remoteScreenshots(client, loc.id);
      if (code === config.primaryLocale) primaryShots = { local: localScreenshots(platform, code, config), remote };
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

        // THE SIZE AND THE COUNT, against Apple's catalog. Neither was checked before: a wrong size came back
        // as a processing failure after upload, and an eleventh file as a refused reservation mid-`fill`,
        // with the first ten already sent. Duo made both likelier — four accepted sizes, two of them
        // landscape, and one set of ten shared by two screens.
        const specs = catalog.screenshotSpecs(dt);
        if (specs.length) {
          for (const name of L.keys()) {
            const m = await matchFile(path.join(screenshotBase(platform, config), code, name), specs);
            if (m.problem) problems.push(`${platform}/${code}: screenshot ${slot}/${name} — ${m.problem}`);
          }
        }
        const max = catalog.screenshotLimit(dt);
        if (max != null && L.size > max) problems.push(`${platform}/${code}: screenshots ${slot} has ${L.size} files for a set of ${max} — \`fill\` refuses the set; keep ${max} at most`);

        const c = compareShots(L, remote[dt] || new Map());
        if (!c) continue;
        if (c.kind === "count") problems.push(`${platform}/${code}: screenshots ${slot} local ${c.local} / remote ${c.remote} — the store set is not the local one (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else if (c.kind === "renamed") problems.push(`${platform}/${code}: screenshots ${slot} ${c.names.length} local file(s) not on the store by name (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else if (c.kind === "stale") problems.push(`${platform}/${code}: screenshots ${slot} STALE — ${c.names.length} of ${c.of} differ in content; green would ship the old art (\`fill\`, VYDANNE_REPLACE=1 to replace)`);
        else notes.push(`${platform}/${code}: screenshots ${slot} present, checksum not reported by Apple — content unverified`);
      }
    }

    if (platform === "IOS") {
      // IPHONE DUO. Optional today; Apple requires the set from April 2027 for an app built with the iOS
      // 27.1 SDK or later. So until then a listing that ships on iPhone without one is TOLD rather than
      // blocked, and from then on it is blocked, because that is what App Store Connect will do — unless
      // the app says it still builds with an older SDK (VYDANNE_DUO_OPTIONAL=1), which vydanne cannot see.
      const has = (set, t) => Boolean(set?.[t]?.size);
      const shots = primaryShots || { local: localScreenshots(platform, config.primaryLocale, config), remote: {} };
      const onIphone = IPHONE_TYPES.some((t) => has(shots.local, t) || has(shots.remote, t));
      const duo = has(shots.local, "APP_IPHONE_DUO") || has(shots.remote, "APP_IPHONE_DUO");
      if (onIphone && !duo) {
        const where = `${screenshotBase(platform, config)}/${config.primaryLocale}/iphoneduo_*.png (outer 1398×2034, inner 2007×2853 or 2853×2007; one set of up to ten)`;
        if (duoRequired() && process.env.VYDANNE_DUO_OPTIONAL !== "1") {
          problems.push(`${platform}/${config.primaryLocale}: no iPhone Duo screenshots — required since ${DUO_REQUIRED_FROM} for apps built with the iOS 27.1 SDK or later: ${where}. An app on an older SDK: VYDANNE_DUO_OPTIONAL=1`);
        } else {
          notes.push(`${platform}/${config.primaryLocale}: no iPhone Duo screenshots — optional until ${DUO_REQUIRED_FROM}, then required for apps built with the iOS 27.1 SDK or later: ${where}`);
        }
      }

      await creativeChecks(config, client, catalog, locs, problems, notes);
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

/**
 * The iOS 27 product page header and search results asset. Optional — an empty slot is a note, never a
 * blocker — but a local file that is invalid, or that the store does not show, is a blocker on the same
 * terms as a screenshot: green has to mean the store matches the folder.
 */
async function creativeChecks(config, client, catalog, locs, problems, notes) {
  const { local, plan, problems: invalid } = await checkCreative(config, catalog);
  for (const p of invalid) problems.push(`IOS/creative ${p}`);
  if (local.strays.length) notes.push(`IOS/creative: folder(s) in ${local.base} that are not App Store locale codes, never placed: ${local.strays.join(", ")}`);
  if (!plan.length) {
    if (!invalid.length) notes.push(`IOS: product page header and search results asset not set (optional; shown on iOS 27 and later) — ${creativeBase(config)}/<locale>/header.png|.mp4 and search.png|.mp4, then \`vydanne creative\``);
    return;
  }
  for (const locale of [...new Set(plan.map((p) => p.locale))]) {
    const loc = locs.find((l) => l.attributes.locale === locale);
    if (!loc) { problems.push(`IOS/${locale}: creative assets ready but the version has no ${locale} localization — \`fill\` creates it`); continue; }
    const placements = await placementsOn(client, loc.id);
    if (!placements) { notes.push(`IOS/${locale}: the Asset Library placements were not readable with this key — creative assets unchecked`); continue; }
    for (const f of compareCreative(plan.filter((p) => p.locale === locale), placements)) {
      const label = f.slot === "header" ? "product page header" : "search results asset";
      if (f.kind === "missing") problems.push(`IOS/${locale}: ${label} ${path.basename(f.file)} is not on the store (\`vydanne creative --apply\`)`);
      else if (f.kind === "stale") problems.push(`IOS/${locale}: ${label} STALE — the store shows ${f.name || "another file"}, not ${path.basename(f.file)} (\`creative --apply\`, VYDANNE_REPLACE=1)`);
      else if (f.kind === "failed") problems.push(`IOS/${locale}: ${label} failed Apple's processing — replace the file`);
      else if (f.kind === "unverified") notes.push(`IOS/${locale}: ${label} shows ${f.name || "an asset"} placed outside vydanne — content unverified`);
      else if (f.kind === "remoteOnly") notes.push(`IOS/${locale}: ${label} shows ${f.name || "an asset"} with no local file — left as it is`);
    }
  }
}
