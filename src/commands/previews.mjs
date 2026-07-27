import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { uploadAsset, setPreviewPoster } from "../upload.mjs";

// Upload App Preview videos natively (reserve → chunked PUT → commit → poll processing → poster frame).
// config.previews: [{ platform, type, file, poster, locales }]. Skips locales that already have a preview.
//
// EVERY failure below is recorded, not just printed. This command used to `return true` unconditionally:
// each error path printed red and `continue`d, so a rejected upload was indistinguishable from a clean
// run to the one caller that asks — `push`, which promises to stop at the first failing step. It didn't:
// previews could fail loudly, push would carry on through age-rating/review-contact/accessibility, and
// preflight (which never inspects previews) would sign the whole thing off as green. The `continue`s are
// still right — one missing video must not hide the state of the rest — but the verdict has to survive
// them, so the loop keeps going and the RETURN carries the failure out.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const specs = config.previews || defaultSpecs(config);
  const failures = [];
  // defaultSpecs filters to files that exist, so with no `previews` config and no video on disk this
  // command used to print NOTHING and exit 0 — indistinguishable from a successful upload in a CI log.
  // Not a failure: an app with no previews is a normal app, and `push` must not stall on one.
  if (!specs.length) console.log(yellow("  no previews configured and none found at the default paths — nothing to upload."));
  for (const s of specs) {
    const v = await client.editVersion(s.platform);
    if (!v) {
      console.error(red(`  ${s.platform}: no editable version — nothing to upload previews to.`));
      console.error("  `vydanne prepare --apply` creates the version being submitted, then re-run this.");
      failures.push(`${s.platform}: no editable version`);
      continue;
    }
    const locs = await client.versionLocalizations(v.id);
    for (const code of s.locales || [config.primaryLocale]) {
      const loc = locs.find((l) => l.attributes.locale === code);
      // A configured locale the version doesn't have must be said, not skipped — the spec NAMES this
      // locale, so silence here reports success for a preview that never left the disk.
      if (!loc) {
        console.error(red(`  ${s.platform}/${code}: no App Store localization — preview skipped (run \`fill\` to create it)`));
        failures.push(`${s.platform}/${code}: no App Store localization`);
        continue;
      }
      try {
        const { json: sets } = await client.get(`/v1/appStoreVersionLocalizations/${loc.id}/appPreviewSets?include=appPreviews&limit=50`);
        let set = (sets.data || []).find((x) => x.attributes.previewType === s.type);
        const existing = set?.relationships?.appPreviews?.data || [];
        if (existing.length && process.env.VYDANNE_REPLACE !== "1") {
          console.log(yellow(`  ${s.platform}/${code}/${s.type}: already has a preview, skipping (set VYDANNE_REPLACE=1 to replace it)`)); continue;
        }
        for (const p of existing) { // VYDANNE_REPLACE: drop the old preview so the new upload takes its place
          await client.del(`/v1/appPreviews/${p.id}`);
          console.log(yellow(`  ${s.platform}/${code}/${s.type}: ${client.dryRun ? "would remove" : "removed"} old preview ${p.id}`));
        }
        if (!set) {
          const c = await client.post(`/v1/appPreviewSets`, { data: { type: "appPreviewSets", attributes: { previewType: s.type }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } });
          set = c.json.data;
        }
        const file = path.resolve(s.file);
        // A configured preview whose file is missing is the whole reason this is checked here: the
        // upload would throw ENOENT mid-run, and in a DRY run it would otherwise look like a plan that
        // works. Name it and move on, so one missing video doesn't hide the rest of the report.
        if (!fs.existsSync(file)) {
          console.error(red(`  ${s.platform}/${code}/${s.type}: ${path.relative(process.cwd(), file)} does not exist — nothing to upload`));
          failures.push(`${s.platform}/${code}/${s.type}: ${path.relative(process.cwd(), file)} missing`);
          continue;
        }
        console.log(`  ${s.platform}/${code}/${s.type}: ${client.dryRun ? "would upload" : "uploading"} ${path.basename(file)}...`);
        const id = await uploadAsset(client, { type: "appPreviews", setType: "appPreviewSet", setId: set.id, filePath: file });
        await setPreviewPoster(client, id, s.poster);
        if (!client.dryRun) console.log(green(`    done ${s.platform}/${code}/${s.type}`));
      } catch (e) {
        console.error(red(`    error ${s.platform}/${code}/${s.type}: ${e.message}`));
        failures.push(`${s.platform}/${code}/${s.type}: ${e.message}`);
      }
    }
  }
  if (failures.length) {
    console.error(red(`previews: ${failures.length} failed — nothing above was silently skipped:`));
    for (const f of failures) console.error(`  ${red("x")} ${f}`);
    return false;
  }
  return true;
}

function defaultSpecs(config) {
  return [
    { platform: "IOS", type: "IPHONE_67", file: "marketing/out/appstore-preview.mp4", poster: "00:00:05:00", locales: [config.primaryLocale, "en-US"] },
    { platform: "MAC_OS", type: "DESKTOP", file: "marketing/out/mac-appstore-preview-mac.mp4", poster: "00:00:03:00", locales: [config.primaryLocale, "en-US"] },
  ].filter((s) => config.platforms.includes(s.platform) && fs.existsSync(path.resolve(s.file)));
}
