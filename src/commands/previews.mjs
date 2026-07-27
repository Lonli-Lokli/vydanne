import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { uploadAsset, setPreviewPoster } from "../upload.mjs";

// Upload App Preview videos natively (reserve → chunked PUT → commit → poll processing → poster frame).
// config.previews: [{ platform, type, file, poster, locales }]. Skips locales that already have a preview.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const specs = config.previews || defaultSpecs(config);
  for (const s of specs) {
    const v = await client.editVersion(s.platform);
    if (!v) { console.error(red(`  ${s.platform}: no version`)); continue; }
    const locs = await client.versionLocalizations(v.id);
    for (const code of s.locales || [config.primaryLocale]) {
      const loc = locs.find((l) => l.attributes.locale === code);
      if (!loc) continue;
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
          continue;
        }
        console.log(`  ${s.platform}/${code}/${s.type}: ${client.dryRun ? "would upload" : "uploading"} ${path.basename(file)}...`);
        const id = await uploadAsset(client, { type: "appPreviews", setType: "appPreviewSet", setId: set.id, filePath: file });
        await setPreviewPoster(client, id, s.poster);
        if (!client.dryRun) console.log(green(`    done ${s.platform}/${code}/${s.type}`));
      } catch (e) {
        console.error(red(`    error ${s.platform}/${code}/${s.type}: ${e.message}`));
      }
    }
  }
  return true;
}

function defaultSpecs(config) {
  return [
    { platform: "IOS", type: "IPHONE_67", file: "marketing/out/appstore-preview.mp4", poster: "00:00:05:00", locales: [config.primaryLocale, "en-US"] },
    { platform: "MAC_OS", type: "DESKTOP", file: "marketing/out/mac-appstore-preview-mac.mp4", poster: "00:00:03:00", locales: [config.primaryLocale, "en-US"] },
  ].filter((s) => config.platforms.includes(s.platform) && fs.existsSync(path.resolve(s.file)));
}
