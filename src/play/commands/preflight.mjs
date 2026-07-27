import { green, red, yellow } from "../../util.mjs";
import { reportCrossStore } from "../../crossStore.mjs";

// Play listing limits.
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

// Verify the Play listing is submission-complete: default-language title/short/full present + within limits,
// the required feature graphic, and >=2 phone screenshots. Reads via a throwaway edit.
export async function run(config, client) {
  const g = config.google;
  const editId = await client.newEdit();
  const problems = [];
  try {
    const details = (await client.getDetails(editId)).json;
    const lang = details.defaultLanguage || g.defaultLocale;
    console.log(`  PLAY ${g.packageName}  default=${lang}`);
    const listings = (await client.getListings(editId)).json.listings || [];
    const dl = listings.find((l) => l.language === lang);
    if (!dl) problems.push(`default language ${lang}: no listing`);
    else {
      for (const [f, lim] of Object.entries(LIMITS)) {
        const v = (dl[f] || "").trim();
        if (!v) problems.push(`${lang}: ${f} empty`);
        else if (v.length > lim) problems.push(`${lang}: ${f} ${v.length}>${lim}`);
      }
    }
    const fg = (await client.listImages(editId, lang, "featureGraphic")).json.images || [];
    if (!fg.length) problems.push(`${lang}: feature graphic missing (required)`);
    const ph = (await client.listImages(editId, lang, "phoneScreenshots")).json.images || [];
    if (ph.length < 2) problems.push(`${lang}: needs >=2 phone screenshots (have ${ph.length})`);
  } finally {
    await client.deleteEdit(editId);
  }
  if (!reportCrossStore("google", g.metadataDir, config.allowCrossStoreTerms)) {
    problems.push("listing text references another app store (see above)");
  }

  console.log();
  if (!problems.length) console.log(green("preflight: no blockers"));
  else { console.log(red(`preflight: ${problems.length} blocker(s)`)); problems.forEach((p) => console.log(`  ${red("x")} ${p}`)); }
  return problems.length === 0;
}
