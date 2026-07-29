import { green, yellow, red } from "../util.mjs";

/**
 * The two app-level facts that block **Add for Review** and nothing else in vydanne could set.
 *
 *   You must select a primary category for your app.
 *   You must set up Content Rights Information in App Information.
 *
 * Both are one API call each and were simply never wired, so a release that was green everywhere —
 * metadata filled, screenshots uploaded, build attached, preflight clean — still stopped dead at the
 * last screen with two errors nobody could act on from a terminal. That is the worst place to
 * discover missing automation: after the work, in a web form, with no record of what the right
 * answer was last time.
 *
 * Deliberately its OWN command rather than folded into `prepare`. `prepare` is about a version; these
 * are about the app, and they outlive every version — setting them once is normal and re-running is a
 * no-op. Keeping them separate also means a failure here names itself instead of failing a step whose
 * name says "version".
 */

/**
 * Apple's category vocabulary is a fixed set of ids, and `GAMES` is the only one with subcategories.
 * Listed rather than free-typed because a wrong id returns a 409 that names neither the field nor the
 * legal values, and the guess someone makes from that ("Puzzle", "games") is wrong twice over — the
 * ids are upper snake case and game subcategories are prefixed.
 */
const CATEGORIES = new Set([
  "BOOKS", "BUSINESS", "DEVELOPER_TOOLS", "EDUCATION", "ENTERTAINMENT", "FINANCE", "FOOD_AND_DRINK",
  "GAMES", "GRAPHICS_AND_DESIGN", "HEALTH_AND_FITNESS", "LIFESTYLE", "MAGAZINES_AND_NEWSPAPERS",
  "MEDICAL", "MUSIC", "NAVIGATION", "NEWS", "PHOTO_AND_VIDEO", "PRODUCTIVITY", "REFERENCE",
  "SHOPPING", "SOCIAL_NETWORKING", "SPORTS", "TRAVEL", "UTILITIES", "WEATHER",
]);

const GAME_SUBCATEGORIES = new Set([
  "GAMES_ACTION", "GAMES_ADVENTURE", "GAMES_BOARD", "GAMES_CARD", "GAMES_CASINO", "GAMES_CASUAL",
  "GAMES_FAMILY", "GAMES_MUSIC", "GAMES_PUZZLE", "GAMES_RACING", "GAMES_ROLE_PLAYING",
  "GAMES_SIMULATION", "GAMES_SPORTS", "GAMES_STRATEGY", "GAMES_TRIVIA", "GAMES_WORD",
]);

/** Apple's own two values, stated as a question so a config cannot get the polarity backwards. */
const RIGHTS = {
  true: "USES_THIRD_PARTY_CONTENT",
  false: "DOES_NOT_USE_THIRD_PARTY_CONTENT",
};

function validate(config) {
  const c = config.categories;
  if (!c) return { problem: "appinfo: no `categories` in the config — set at least { primary: 'GAMES' }." };
  const bad = [];
  if (!CATEGORIES.has(c.primary)) bad.push(`primary '${c.primary}' is not an Apple category id (e.g. GAMES, PUZZLE is a SUBcategory)`);
  if (c.secondary && !CATEGORIES.has(c.secondary)) bad.push(`secondary '${c.secondary}' is not an Apple category id`);
  for (const k of ["primarySubcategoryOne", "primarySubcategoryTwo", "secondarySubcategoryOne", "secondarySubcategoryTwo"]) {
    if (c[k] && !GAME_SUBCATEGORIES.has(c[k])) bad.push(`${k} '${c[k]}' is not a game subcategory id (they are GAMES_*)`);
  }
  // Apple allows subcategories only under GAMES; sending them otherwise is a 409 that reads as a
  // generic relationship error.
  if (c.primarySubcategoryOne && c.primary !== "GAMES") bad.push("subcategories are only valid when primary is GAMES");
  if (config.contentRights !== undefined && typeof config.contentRights !== "boolean") {
    bad.push("contentRights must be true (uses third-party content) or false (does not)");
  }
  return bad.length ? { problem: `appinfo: ${bad.join("; ")}` } : {};
}

const rel = (id) => (id ? { data: { type: "appCategories", id } } : { data: null });

export async function run(config, client) {
  const { problem } = validate(config);
  if (problem) { console.error(red(problem)); return false; }

  await client.findApp(config.bundleId);
  // Same refusal as age-rating, and for the same reason: the LIVE app info's category is not ours to
  // aim a write at, and appInfo() returning the live record instead of null once made that write look
  // like it had worked.
  const info = await client.appInfo();
  if (!info) {
    console.error(red("appinfo: no editable app info — refusing to write to the live record."));
    console.error("  `vydanne prepare --apply` starts the next version, which makes app info editable again.");
    return false;
  }

  const c = config.categories;
  const relationships = {
    primaryCategory: rel(c.primary),
    primarySubcategoryOne: rel(c.primarySubcategoryOne),
    primarySubcategoryTwo: rel(c.primarySubcategoryTwo),
    secondaryCategory: rel(c.secondary),
    secondarySubcategoryOne: rel(c.secondarySubcategoryOne),
    secondarySubcategoryTwo: rel(c.secondarySubcategoryTwo),
  };
  const shown = [c.primary, c.primarySubcategoryOne, c.primarySubcategoryTwo, c.secondary]
    .filter(Boolean).join(" · ");
  console.log(`  categories: ${shown}`);

  const r = await client.patch(`/v1/appInfos/${info.id}`, {
    data: { type: "appInfos", id: info.id, relationships },
  });
  if (r.status >= 300) {
    console.error(red(`appinfo: categories ${r.status}`));
    for (const e of r.json?.errors || []) console.error(`    ${e.title}: ${e.detail}`);
    return false;
  }
  console.log(client.dryRun ? yellow(`  WOULD set categories`) : green(`  categories set`));

  // Content rights is on the APP, not the app info — a different resource, which is most of why it
  // was missed. Skipped entirely when undeclared, so an app that has already answered in the UI is
  // not overwritten by a default nobody chose.
  if (config.contentRights === undefined) {
    console.log(yellow("  contentRights not declared — Add for Review needs it; set `contentRights: false` if the app uses no third-party content."));
    return true;
  }
  const declaration = RIGHTS[String(config.contentRights)];
  const a = await client.patch(`/v1/apps/${client.appId}`, {
    data: { type: "apps", id: client.appId, attributes: { contentRightsDeclaration: declaration } },
  });
  if (a.status >= 300) {
    console.error(red(`appinfo: content rights ${a.status}`));
    for (const e of a.json?.errors || []) console.error(`    ${e.title}: ${e.detail}`);
    return false;
  }
  console.log(client.dryRun
    ? yellow(`  WOULD set content rights -> ${declaration}`)
    : green(`  content rights -> ${declaration}`));
  return true;
}
