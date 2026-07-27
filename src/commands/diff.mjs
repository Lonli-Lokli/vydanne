import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../util.mjs";
import { VALID } from "../locales.mjs";
import { md5 } from "../upload.mjs";

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
    // allowLive: comparing local against the version ON SALE is a legitimate question and often the
    // reason to run this before preparing a release. The state is printed below, so it is never unclear
    // WHICH version the comparison is against — and `fill` no longer targets a live one either way.
    const v = await client.editVersion(platform, { allowLive: true });
    if (!v) { console.log(red(`${platform}: no version at all`)); continue; }
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
  // Compared by CONTENT, not by count. Counting was actively misleading: re-rendering every screenshot
  // leaves three-local-vs-three-remote, so `diff` said "in sync" about a listing showing the old images —
  // and `fill` skipped the populated slots, so both commands agreed there was nothing to do. The checksum
  // is already there to compare against: `upload.mjs` commits md5(bytes) as `sourceFileChecksum`.
  const local = {};
  if (fs.existsSync(localDir)) {
    for (const f of fs.readdirSync(localDir).filter((f) => f.endsWith(".png")).sort()) {
      const dt = dev[f.split("_")[0]];
      if (dt) (local[dt] ||= new Map()).set(f, md5(fs.readFileSync(path.join(localDir, f))));
    }
  }
  const { json: sets } = await client.get(`/v1/appStoreVersionLocalizations/${primary.id}/appScreenshotSets?include=appScreenshots&limit=50`);
  // `include=appScreenshots` returns the shots as full resources in `included`; the set's relationships
  // carry ids only, so the attributes (fileName, sourceFileChecksum) have to be picked up from there.
  const shotsById = new Map((sets.included || []).filter((r) => r.type === "appScreenshots").map((r) => [r.id, r.attributes || {}]));
  const remote = {};
  for (const s of sets.data || []) {
    const m = new Map();
    for (const ref of s.relationships?.appScreenshots?.data || []) {
      const a = shotsById.get(ref.id);
      if (a) m.set(a.fileName, a.sourceFileChecksum ?? null);
      else m.set(ref.id, null); // not included — treat as present but unverifiable
    }
    remote[s.attributes.screenshotDisplayType] = m;
  }
  for (const dt of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const L = local[dt] || new Map();
    const R = remote[dt] || new Map();
    const label = `  ${yellow("screenshots")} ${dt.replace("APP_", "")}`;
    if (L.size !== R.size) {
      diffs++;
      console.log(`${label}: local ${L.size} / remote ${R.size}  (@${config.primaryLocale})`);
      continue;
    }
    // Same count — so the only thing that can distinguish them is what the bytes are.
    const changed = [...L].filter(([name, sum]) => R.has(name) && R.get(name) !== null && R.get(name) !== sum).map(([name]) => name);
    const renamed = [...L.keys()].filter((name) => !R.has(name));
    const unverifiable = [...L].filter(([name]) => R.has(name) && R.get(name) === null).map(([name]) => name);
    if (renamed.length) {
      diffs++;
      console.log(`${label}: ${renamed.length} not on the store by name (${renamed.slice(0, 3).join(", ")})  (@${config.primaryLocale})`);
    } else if (changed.length) {
      diffs++;
      console.log(`${label}: ${changed.length} of ${L.size} differ in content (${changed.slice(0, 3).join(", ")})  (@${config.primaryLocale})`);
    } else if (unverifiable.length) {
      // Apple did not give a checksum back. Say so rather than reporting a match we did not establish.
      console.log(`${label}: ${unverifiable.length} present, checksum not reported by Apple — content unverified`);
    }
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
