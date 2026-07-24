import fs from "node:fs";
import path from "node:path";
import { green, red, yellow } from "../../util.mjs";

// [Play listing attribute, local metadata filename] — supply's convention under fastlane/metadata/android.
const FIELDS = [["title", "title"], ["shortDescription", "short_description"], ["fullDescription", "full_description"]];
const norm = (s) => (s == null ? null : String(s).replace(/\r/g, "").replace(/\n+$/, "").trim());

// Show what differs between local Play sources (fastlane/metadata/android/<locale>/*.txt) and the live Play
// listing — a dry-run of `fill --store google`.
export async function run(config, client) {
  const g = config.google;
  const editId = await client.newEdit();
  let actionable = 0;
  try {
    const listings = (await client.getListings(editId)).json.listings || [];
    const remote = Object.fromEntries(listings.map((l) => [l.language, l]));
    const dir = g.metadataDir;
    const localLangs = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

    if (!localLangs.length) {
      console.log(yellow(`  no local listing folders under ${dir} (Android Phase 2 — nothing to push yet)`));
    }
    for (const lang of localLangs) {
      const read = (f) => { const p = path.join(dir, lang, `${f}.txt`); return fs.existsSync(p) ? norm(fs.readFileSync(p, "utf8")) : null; };
      const R = remote[lang] || {};
      const out = [];
      if (!remote[lang]) { out.push(yellow("[fill would create]")); }
      for (const [attr, file] of FIELDS) {
        const L = read(file), Rv = norm(R[attr]);
        if (L == null && (Rv == null || Rv === "")) continue;
        if (L == null) out.push(`${file} ${yellow("[remote-only]")}`);
        else if (!Rv) out.push(`${file} ${green("[local-only]")}`);
        else if (L !== Rv) { out.push(`${file} ${red("differs")}`); actionable++; }
      }
      if (out.length) console.log(`  ${lang}: ${out.join(" · ")}`);
    }
    const localSet = new Set(localLangs);
    const extra = listings.map((l) => l.language).filter((x) => !localSet.has(x));
    if (extra.length) console.log(`  ${yellow("Play-only languages")} (no local folder): ${extra.join(", ")}`);
  } finally {
    await client.deleteEdit(editId);
  }
  console.log();
  console.log(actionable ? yellow(`${actionable} actionable difference(s) — run \`fill --store google\` to sync`) : green("in sync — local matches Play"));
  return true;
}
