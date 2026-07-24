import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { VALID } from "../locales.mjs";

// [asc attribute, local metadata filename, isLongText]
const VERSION_FIELDS = [
  ["description", "description", true], ["keywords", "keywords", false], ["promotionalText", "promotional_text", false],
  ["whatsNew", "release_notes", true], ["marketingUrl", "marketing_url", false], ["supportUrl", "support_url", false],
];
const INFO_FIELDS = [["name", "name", false], ["subtitle", "subtitle", false]];
const IOS_DEVICE = { iphone69: "APP_IPHONE_67", iphone65: "APP_IPHONE_65", ipad13: "APP_IPAD_PRO_3GEN_129", watch: "APP_WATCH_ULTRA" };
const MAC_DEVICE = { macos: "APP_DESKTOP" };

const norm = (s) => (s == null ? null : String(s).replace(/\r/g, "").replace(/\n+$/, "").trim());
const short = (s, n = 24) => { s = String(s).replace(/\n/g, " "); return s.length > n ? s.slice(0, n) + "…" : s; };

// Show what's different between the local sources (metadata folders, screenshots, previews) and App Store
// Connect — i.e. what `fill` / `previews` would change. Reads each localization by id (list is sparse).
export async function run(config, client) {
  await client.findApp(config.bundleId);
  const info = await client.appInfo();
  const infoLocs = info ? (await client.get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`)).json.data || [] : [];
  let actionable = 0; // differences `fill`/`previews` would actually change (release_notes on a 1.0 is benign)

  for (const platform of config.platforms) {
    const v = await client.editVersion(platform);
    if (!v) { console.log(red(`${platform}: no editable version`)); continue; }
    console.log(`${platform}  v${v.attributes.versionString} ${v.attributes.appStoreState}`);
    const verLocs = await client.versionLocalizations(v.id);
    const localDirs = fs.existsSync(config.metadataDir)
      ? fs.readdirSync(config.metadataDir, { withFileTypes: true }).filter((d) => d.isDirectory() && VALID.has(d.name)).map((d) => d.name)
      : [];

    const presence = {}; // field -> { localOnly:[], remoteOnly:[] }  (systematic — aggregated, not per-locale)
    for (const code of localDirs) {
      const folder = path.join(config.metadataDir, code);
      const readL = (f) => { const p = path.join(folder, `${f}.txt`); return fs.existsSync(p) ? norm(fs.readFileSync(p, "utf8")) : null; };
      const vl = verLocs.find((l) => l.attributes.locale === code);
      const il = infoLocs.find((l) => l.attributes.locale === code);
      const vAttrs = vl ? await client.localization(vl.id) : {};
      const iAttrs = il ? await client.localization(il.id, "appInfoLocalizations") : {};
      const content = []; // per-locale value differences (the ones you usually care about)
      const record = (file, L, R, long) => {
        const c = cmp(L, R, long);
        if (!c) return;
        if (c.kind === "diff") { content.push(`${file} ${red("differs")} ${c.detail}`); actionable++; return; }
        const arr = (presence[file] ||= { localOnly: [], remoteOnly: [] });
        if (c.kind === "local-only") { arr.localOnly.push(code); if (file !== "release_notes") actionable++; }
        else { arr.remoteOnly.push(code); actionable++; }
      };
      if (!vl) { content.unshift(yellow("[fill would create localization]")); actionable++; }
      for (const [attr, file, long] of VERSION_FIELDS) record(file, readL(file), norm(vAttrs[attr]), long);
      for (const [attr, file, long] of INFO_FIELDS) record(file, readL(file), norm(iAttrs[attr]), long);
      if (content.length) console.log(`  ${code}: ${content.join(" · ")}`);
    }
    for (const [file, p] of Object.entries(presence)) {
      const hint = file === "release_notes" ? "  (What's New — N/A on a first version)" : "";
      if (p.localOnly.length) console.log(`  ${green(`${file} local-only`)} in ${p.localOnly.length} locale(s)${hint}`);
      if (p.remoteOnly.length) console.log(`  ${yellow(`${file} remote-only`)} in ${p.remoteOnly.length} locale(s)`);
    }

    const localSet = new Set(localDirs);
    const extra = verLocs.map((l) => l.attributes.locale).filter((c) => !localSet.has(c));
    if (extra.length) console.log(`  ${yellow("remote-only locales")} (no local folder): ${extra.join(", ")}`);

    actionable += await mediaDiff(config, client, platform, verLocs);
  }

  console.log();
  console.log(actionable ? yellow(`${actionable} actionable difference(s) — run \`fill\` / \`previews\` to sync`) : green("in sync — local matches App Store Connect"));
  return true;
}

function cmp(L, R, long) {
  if (L == null && (R == null || R === "")) return null;
  if (L == null) return { kind: "remote-only" };
  if (R == null || R === "") return { kind: "local-only" };
  if (L === R) return null;
  return { kind: "diff", detail: long ? `(local ${L.length} / remote ${R.length} ch)` : `local="${short(L)}" remote="${short(R)}"` };
}

async function mediaDiff(config, client, platform, verLocs) {
  const primary = verLocs.find((l) => l.attributes.locale === config.primaryLocale);
  if (!primary) return 0;
  let diffs = 0;
  const dev = platform === "MAC_OS" ? MAC_DEVICE : IOS_DEVICE;
  const base = platform === "MAC_OS" ? "fastlane/screenshots-macos" : "fastlane/screenshots";
  const localDir = path.join(base, config.primaryLocale);
  const local = {};
  if (fs.existsSync(localDir)) for (const f of fs.readdirSync(localDir).filter((f) => f.endsWith(".png"))) { const dt = dev[f.split("_")[0]]; if (dt) local[dt] = (local[dt] || 0) + 1; }
  const { json: sets } = await client.get(`/v1/appStoreVersionLocalizations/${primary.id}/appScreenshotSets?include=appScreenshots&limit=50`);
  const remote = {};
  for (const s of sets.data || []) remote[s.attributes.screenshotDisplayType] = (s.relationships?.appScreenshots?.data || []).length;
  for (const dt of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const L = local[dt] || 0, R = remote[dt] || 0;
    if (L !== R) { diffs++; console.log(`  ${yellow("screenshots")} ${dt.replace("APP_", "")}: local ${L} / remote ${R}  (@${config.primaryLocale})`); }
  }
  const { json: psets } = await client.get(`/v1/appStoreVersionLocalizations/${primary.id}/appPreviewSets?include=appPreviews&limit=50`);
  const remotePrev = {};
  for (const s of psets.data || []) remotePrev[s.attributes.previewType] = (s.relationships?.appPreviews?.data || []).length;
  for (const spec of (config.previews || []).filter((s) => s.platform === platform && (s.locales || []).includes(config.primaryLocale))) {
    const L = fs.existsSync(path.resolve(spec.file)) ? 1 : 0, R = remotePrev[spec.type] || 0;
    if (L !== R) { diffs++; console.log(`  ${yellow("preview")} ${spec.type}: local ${L} / remote ${R}  (@${config.primaryLocale})`); }
  }
  return diffs;
}
