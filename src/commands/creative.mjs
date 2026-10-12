import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { CREATIVE_SLOTS, describeSize, loadCatalog } from "../assetCatalog.mjs";
import { checkCreative } from "../creative.mjs";
import { assetLibrary, creativeAssetsByMd5, md5FromReference, place, placementsOn, referenceFor, uploadToLibrary, waitProcessed } from "../assetLibrary.mjs";

/**
 * Place the product page header and the search results asset (iOS / iPadOS 27) on the version being
 * prepared, from `<creative.dir>/<locale>/header.*` and `search.*`.
 *
 * WHY THROUGH THE ASSET LIBRARY. These two slots exist nowhere else in the API — there is no "header
 * set" — so this is the one command that uploads the new way: once into the app's library, then a
 * placement per localization. See assetLibrary.mjs for the model and why the md5 rides in the asset's
 * reference name.
 *
 * THE SAME CONTRACT AS `fill`. Everything is checked against Apple's catalog before anything is sent, and
 * a single invalid file refuses the whole run (a header that fails processing after the version is in
 * review costs a review cycle). A slot that already shows something else is skipped and said, unless
 * VYDANNE_REPLACE=1 — the same flag `fill` and `previews` use. A slot already showing this exact file is
 * left alone, so re-running does nothing. Dry run without --apply: the client records every write.
 *
 * WHAT STAYS MANUAL, AND WHY. Placements are created only on an EDITABLE version (Apple refuses one on an
 * approved surface), so the assets travel through review with that version. Two routes App Store Connect
 * offers have no API in 4.5.1 — submitting library assets for review on their own, and publishing an
 * approved asset onto the version already on sale — and this command prints those steps rather than
 * pretending to do them.
 */
export async function run(config, client) {
  await client.findApp(config.bundleId);
  if (!(config.platforms || ["IOS"]).includes("IOS")) {
    console.log(yellow("  creative assets are for iOS and iPadOS 27 product pages — this app lists no IOS platform; nothing to do."));
    return true;
  }
  const catalog = await loadCatalog(client);
  if (catalog.source !== "live") console.log(yellow(`  Apple's reference data was not readable (${catalog.why || "no client"}) — validating against the ${catalog.source} of 2026-10-12`));
  const { local, plan, problems } = await checkCreative(config, catalog);
  if (local.strays.length) console.log(yellow(`  folder(s) in ${local.base} that are not App Store locale codes, skipped: ${local.strays.join(", ")}`));
  if (local.unknown.length) console.log(yellow(`  file(s) that are not header.* or search.*, skipped: ${local.unknown.join(", ")}`));
  if (!plan.length && !problems.length) {
    console.log(yellow(`  no creative assets in ${local.base}/<locale>/ — nothing to place. Both slots are optional.`));
    return true;
  }
  if (problems.length) {
    console.error(red(`creative: refusing — ${problems.length} file(s) Apple would not accept:`));
    for (const p of problems) console.error(`  ${red("x")} ${p}`);
    console.error("  Nothing was sent.");
    return false;
  }

  const v = await client.editVersion("IOS");
  if (!v) {
    console.error(red("creative: no editable iOS version — placements can only be added to a version being prepared."));
    printManualRoute(plan);
    return false;
  }
  const lib = await assetLibrary(client);
  if (!lib.id) {
    console.error(red(`creative: this key cannot read the app's Asset Library (HTTP ${lib.status}) — it needs the Admin or App Manager role.`));
    printManualRoute(plan);
    return false;
  }
  console.log(green(`creative IOS -> ${v.attributes.versionString} ${v.attributes.appStoreState} (catalog: ${catalog.source})`));

  const locs = await client.versionLocalizations(v.id);
  const library = await creativeAssetsByMd5(client, lib.id);
  const failures = [];
  const uploaded = [];
  const placedOn = new Map(); // locale -> placements, read once each

  for (const item of plan) {
    const { placementType, group, label } = CREATIVE_SLOTS[item.slot];
    const where = `${item.locale}/${item.slot}`;
    const loc = locs.find((l) => l.attributes.locale === item.locale);
    if (!loc) {
      console.error(red(`  ${where}: the version has no ${item.locale} localization — run \`fill\` first, which creates it`));
      failures.push(`${where}: no localization`);
      continue;
    }
    if (!placedOn.has(item.locale)) placedOn.set(item.locale, (await placementsOn(client, loc.id)) || []);
    const current = placedOn.get(item.locale).filter((p) => p.placementType === placementType);
    const describe = `${path.basename(item.file)} (${item.kind}, ${describeSize(item.spec)}${item.fromHeader ? ", the header's asset" : ""})`;

    if (current.length === 1 && md5FromReference(current[0].asset?.referenceName) === item.md5) {
      console.log(`  ${where}: already shows ${path.basename(item.file)} — in sync`);
      continue;
    }
    if (current.length && process.env.VYDANNE_REPLACE !== "1") {
      const what = current.map((p) => p.asset?.fileName || p.asset?.id || p.id).join(", ");
      console.log(yellow(`  ${where}: the ${label} already shows ${what}, skipping (set VYDANNE_REPLACE=1 to replace it)`));
      continue;
    }
    try {
      for (const p of current) {
        // A slot holds one, and a placement cannot be edited, so the old one goes first. Its asset stays in
        // the library: it may be placed on another localization, and deleting it there is not ours to do.
        await client.del(`/v1/appAssetLibraryPlacements/${p.id}`);
        console.log(yellow(`  ${where}: ${client.dryRun ? "would remove" : "removed"} the placement showing ${p.asset?.fileName || p.id}`));
      }
      let asset = library.get(item.md5);
      if (asset?.state === "REJECTED") {
        console.error(red(`  ${where}: App Review rejected this exact file before (library asset ${asset.id}) — change it rather than resubmit it`));
        failures.push(`${where}: rejected before`);
        continue;
      }
      if (asset && ["FAILED", "AWAITING_UPLOAD", "ARCHIVED"].includes(asset.state)) asset = null; // not placeable — upload afresh
      if (asset) {
        console.log(`  ${where}: reusing library asset ${asset.id} (${asset.state}) — ${describe}`);
      } else {
        console.log(`  ${where}: ${client.dryRun ? "would upload" : "uploading"} ${describe}`);
        const id = await uploadToLibrary(client, {
          libId: lib.id, file: item.file, kind: item.kind, category: "CREATIVE_ASSETS",
          referenceName: referenceFor(item.file, item.md5), previewFrameTimeCode: config.creative?.poster,
        });
        asset = { id, kind: item.kind, state: "UPLOAD_COMPLETE" };
        library.set(item.md5, asset); // the next locale with the same bytes places this one, not a copy
        uploaded.push({ where, kind: item.kind, id, spec: item.spec });
      }
      // Allowed while the asset is still processing — the placement starts in ASSET_PROCESSING — so there
      // is no need to wait here; the wait below reports a file Apple could not process.
      await place(client, { placementType, group, kind: item.kind, assetId: asset.id, locId: loc.id });
      console.log(green(`  ${where}: ${client.dryRun ? "would place" : "placed"} as the ${label}`));
    } catch (e) {
      console.error(red(`  ${where}: ${e.message}`));
      failures.push(`${where}: ${e.message}`);
    }
  }

  // Processing is asynchronous; a file that fails it leaves a FAILED placement that would only surface in
  // review. Wait for each new asset and compare the spec Apple matched with the one checked above.
  for (const u of uploaded) {
    const a = await waitProcessed(client, u.kind, u.id, u.kind === "video" ? { tries: 40, delayMs: 15000 } : {});
    if (!a) {
      if (!client.dryRun) console.log(yellow(`  ${u.where}: still processing — \`vydanne preflight\` reports how it ends`));
      continue;
    }
    if (a.state === "FAILED") {
      const why = (a.stateDetails || []).map((d) => d.code || d.detail).join("; ") || "no reason given";
      console.error(red(`  ${u.where}: Apple could not process it — ${why}`));
      failures.push(`${u.where}: processing failed`);
    } else if (a.specId && a.specId !== u.spec.specId) {
      console.log(yellow(`  ${u.where}: Apple matched it to spec ${a.specId}, not ${u.spec.shortName} — check it is the slot you meant`));
    }
  }

  if (failures.length) {
    console.error(red(`creative: ${failures.length} failed — nothing above was silently skipped:`));
    for (const f of failures) console.error(`  ${red("x")} ${f}`);
    return false;
  }
  return true;
}

/** The App Store Connect route, for the cases the API does not cover. */
function printManualRoute(plan) {
  console.log("  By hand in App Store Connect, until there is a version to place them on:");
  console.log("    1. Apps → the app → Asset Library → + → Upload Creative Assets, and upload:");
  for (const p of plan.filter((x) => !x.fromHeader)) console.log(`         ${p.file}  (${p.locale}, ${CREATIVE_SLOTS[p.slot].label})`);
  console.log("    2. Submit them from Asset Library on their own if you want them approved ahead of a version.");
  console.log("    3. On the live version: Product Page Information → Header and Search Results → Header (or");
  console.log("       Search Results) → Browse Assets → an approved asset → Publish. Per localization: pick");
  console.log("       the language at the top right first.");
}
