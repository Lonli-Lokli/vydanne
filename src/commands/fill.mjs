import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { VALID } from "../locales.mjs";
import { uploadAsset } from "../upload.mjs";

// Version-localization fields (attr -> metadata filename) and AppInfo fields (name/subtitle, shared).
const VERSION_TXT = { description: "description", keywords: "keywords", promotionalText: "promotional_text", whatsNew: "release_notes", marketingUrl: "marketing_url", supportUrl: "support_url" };
const INFO_TXT = { name: "name", subtitle: "subtitle" };
const IOS_DEVICE = { iphone69: "APP_IPHONE_67", iphone65: "APP_IPHONE_65", ipad13: "APP_IPAD_PRO_3GEN_129", watch: "APP_WATCH_ULTRA" };
const MAC_DEVICE = { macos: "APP_DESKTOP" };

// Push metadata (native PATCH — works at any editable state, incl. READY_FOR_REVIEW, unlike deliver) +
// screenshots (native chunked upload; skips sets that already have shots so it never duplicates).
// iOS and macOS are separate platforms. Toggles: VYDANNE_SKIP_METADATA / VYDANNE_SKIP_SCREENSHOTS.
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const skipMeta = process.env.VYDANNE_SKIP_METADATA === "1";
  const skipShots = process.env.VYDANNE_SKIP_SCREENSHOTS === "1";
  const info = await client.appInfo();
  const infoLocs = info ? (await client.get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`)).json.data || [] : [];

  for (const platform of config.platforms) {
    const v = await client.editVersion(platform);
    if (!v) { console.error(red(`fill ${platform}: no editable version`)); continue; }
    console.log(green(`fill ${platform} (metadata=${!skipMeta} screenshots=${!skipShots})...`));
    const verLocs = await client.versionLocalizations(v.id);

    if (!skipMeta) {
      const dirs = fs.readdirSync(config.metadataDir, { withFileTypes: true }).filter((d) => d.isDirectory() && VALID.has(d.name)).map((d) => d.name);
      for (const code of dirs) {
        const folder = path.join(config.metadataDir, code);
        const read = (f) => { const p = path.join(folder, `${f}.txt`); return fs.existsSync(p) ? fs.readFileSync(p, "utf8").replace(/\n+$/, "") : null; };
        // version localization (description/keywords/promo/whatsNew/urls)
        let vl = verLocs.find((l) => l.attributes.locale === code);
        if (!vl) { const c = await client.post(`/v1/appStoreVersionLocalizations`, { data: { type: "appStoreVersionLocalizations", attributes: { locale: code }, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: v.id } } } } }); vl = c.json.data; verLocs.push(vl); }
        const vattrs = {};
        for (const [k, f] of Object.entries(VERSION_TXT)) { const t = read(f); if (t != null) vattrs[k] = t; }
        if (Object.keys(vattrs).length) await client.patch(`/v1/appStoreVersionLocalizations/${vl.id}`, { data: { type: "appStoreVersionLocalizations", id: vl.id, attributes: vattrs } });
        // app-info localization (name/subtitle — shared across platforms). Apple REQUIRES `name` when
        // CREATING a localization (409 ATTRIBUTE.REQUIRED otherwise), so build the attrs first and send
        // them in the POST; only PATCH when the localization already exists.
        if (info) {
          const iattrs = {};
          for (const [k, f] of Object.entries(INFO_TXT)) { const t = read(f); if (t != null) iattrs[k] = t; }
          let il = infoLocs.find((l) => l.attributes.locale === code);
          if (!il) {
            const c = await client.post(`/v1/appInfoLocalizations`, { data: { type: "appInfoLocalizations", attributes: { locale: code, ...iattrs }, relationships: { appInfo: { data: { type: "appInfos", id: info.id } } } } });
            il = c.json.data;
            if (il) infoLocs.push(il);
            else console.error(`  appInfo ${code}: create failed — ${JSON.stringify(c.json?.errors?.[0]?.detail || c.json)}`);
          } else if (Object.keys(iattrs).length) {
            await client.patch(`/v1/appInfoLocalizations/${il.id}`, { data: { type: "appInfoLocalizations", id: il.id, attributes: iattrs } });
          }
        }
      }
      console.log(green(`  metadata: ${dirs.length} locales`));
    }

    if (!skipShots) await uploadScreenshots(config, client, platform, verLocs);
  }
  return true;
}

async function uploadScreenshots(config, client, platform, verLocs) {
  const base = platform === "MAC_OS" ? "fastlane/screenshots-macos" : "fastlane/screenshots";
  const DEV = platform === "MAC_OS" ? MAC_DEVICE : IOS_DEVICE;
  if (!fs.existsSync(base)) return;
  for (const code of fs.readdirSync(base).filter((d) => VALID.has(d))) {
    const loc = verLocs.find((l) => l.attributes.locale === code);
    if (!loc) continue;
    const files = fs.readdirSync(path.join(base, code)).filter((f) => f.endsWith(".png")).sort();
    const byDev = {};
    for (const f of files) { const dt = DEV[f.split("_")[0]]; if (dt) (byDev[dt] ||= []).push(f); }
    const { json: sets } = await client.get(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?include=appScreenshots&limit=50`);
    for (const [dt, list] of Object.entries(byDev)) {
      let set = (sets.data || []).find((s) => s.attributes.screenshotDisplayType === dt);
      if (set && (set.relationships?.appScreenshots?.data || []).length) continue; // never duplicate
      if (!set) { const c = await client.post(`/v1/appScreenshotSets`, { data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: dt }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } } }); set = c.json.data; }
      for (const f of list) await uploadAsset(client, { type: "appScreenshots", setType: "appScreenshotSet", setId: set.id, filePath: path.join(base, code, f) });
      console.log(green(`    ${code}/${dt}: ${list.length} screenshots`));
    }
  }
}
