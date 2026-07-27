import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { green, red, yellow } from "../../util.mjs";
import { playImages, imageLocales } from "../images.mjs";

// [Play listing attribute, local metadata filename] — supply's convention under fastlane/metadata/android.
const FIELDS = [["title", "title"], ["shortDescription", "short_description"], ["fullDescription", "full_description"]];
const norm = (s) => (s == null ? null : String(s).replace(/\r/g, "").replace(/\n+$/, "").trim());
const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex");

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

    // Images, by CONTENT. This command compared nothing here at all, so "in sync" was a claim about the
    // text only — a full recapture of every screenshot reported nothing to do, which is the same bug the
    // Apple diff had with counts, one step worse. Play's images.list returns the sha1 of what it holds
    // (the comparison supply itself uses to skip identical uploads), so local bytes can be checked
    // against the store without downloading anything. Only types with a LOCAL asset are judged, and a
    // remote-only type is left unflagged — mirroring fill, which never deletes by omission.
    // Every locale `fill` would upload to, so the two commands agree on what "in sync" covers. With the
    // default (no `google.imageLocales`) that is the one `defaultLocale` this always compared.
    for (const lang of imageLocales(g, localLangs)) {
      for (const [type, src, kind] of playImages(config)) {
        const localized = path.join(src, lang);
        const from = kind === "dir" && fs.existsSync(localized) ? localized : src;
        if (!fs.existsSync(from)) continue;
        const files = kind === "dir" ? fs.readdirSync(from).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(from, f)) : [from];
        const label = `  ${yellow("images")} ${type}`;
        // A dir that exists but is empty means the local set was deliberately cleared — `fill` will not
        // touch the live one (never-delete-by-omission), so if the store still holds images they are
        // stale and only Play Console can remove them. Reported, not counted as actionable, because no
        // vydanne command would change it.
        if (!files.length) {
          const held = ((await client.listImages(editId, lang, type)).json.images || []).length;
          if (held) console.log(`${label}: local dir empty, store holds ${held} — stale; only Play Console can remove them  (@${lang})`);
          continue;
        }
        const local = files.map((f) => sha1(fs.readFileSync(f)));
        const remote = ((await client.listImages(editId, lang, type)).json.images || []).map((i) => i.sha1);
        if (local.length !== remote.length) {
          actionable++;
          console.log(`${label}: local ${local.length} / remote ${remote.length}  (@${lang})`);
        } else if (JSON.stringify([...local].sort()) !== JSON.stringify([...remote].sort())) {
          const changed = local.filter((s) => !remote.includes(s)).length;
          actionable++;
          console.log(`${label}: ${changed} of ${local.length} differ in content  (@${lang})`);
        }
      }
    }
  } finally {
    await client.deleteEdit(editId);
  }
  console.log();
  console.log(actionable ? yellow(`${actionable} actionable difference(s) — run \`fill --store google\` to sync`) : green("in sync — local matches Play"));
  return true;
}
