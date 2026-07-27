import { green, yellow, red } from "../util.mjs";

/**
 * Set the age rating via the AppInfo age-rating declaration.
 *
 * `rating: "4+"` stays the shorthand it always was: every content descriptor NONE, every capability
 * question false, which is what Apple recomputes 4+ from. Anything else is declared feature by feature
 * in `ageRating`, merged over that all-NONE base — so an app with fantasy violence sets one key rather
 * than restating twenty-seven.
 *
 * This used to refuse outright for any rating but 4+, which made the whole command — and `push`, which
 * runs it as a step — unusable for any app with violence, gambling, chat or user-generated content.
 * The base was always the general thing; only the door was missing.
 */

const N = "NONE";

// Apple's 2025 age-rating schema. A PATCH must include ALL required fields (a partial set 409s), and
// `ageRatingOverride` (deprecated) cannot be sent alongside `ageRatingOverrideV2` — so we send only V2.
// Content descriptors are enums (NONE/INFREQUENT_OR_MILD/FREQUENT_OR_INTENSE); capability questions are
// booleans. All benign here → 4+.
const BASE = {
  advertising: false, alcoholTobaccoOrDrugUseOrReferences: N, contests: N, gambling: false,
  gamblingSimulated: N, gunsOrOtherWeapons: N, healthOrWellnessTopics: false, kidsAgeBand: null,
  lootBox: false, medicalOrTreatmentInformation: N, messagingAndChat: false, parentalControls: false,
  profanityOrCrudeHumor: N, ageAssurance: false, sexualContentGraphicAndNudity: N, sexualContentOrNudity: N,
  socialMedia: false, socialMediaAgeRestricted: false, horrorOrFearThemes: N, matureOrSuggestiveThemes: N,
  unrestrictedWebAccess: false, userGeneratedContent: false, violenceCartoonOrFantasy: N,
  violenceRealisticProlongedGraphicOrSadistic: N, violenceRealistic: N, ageRatingOverrideV2: N,
  koreaAgeRatingOverride: N,
};

/** Values Apple accepts for a content descriptor. `kidsAgeBand` and the overrides are checked separately. */
const DESCRIPTOR_VALUES = new Set([N, "INFREQUENT_OR_MILD", "FREQUENT_OR_INTENSE"]);

/**
 * The attributes to send, or a human-readable problem.
 *
 * A declaration is validated against the schema BEFORE it reaches Apple, because the failure otherwise
 * is a 409 naming a field the operator did not know existed. An unknown key is a typo — and a typo in
 * this table means a descriptor silently stayed NONE, which is a rating that understates the app.
 */
export function resolveAttributes(config) {
  const declared = config.ageRating;
  if (!declared) {
    if (config.rating === "4+") return { attributes: { ...BASE } };
    return {
      problem: [
        `age-rating: rating is '${config.rating}', but nothing describes what makes it that.`,
        "'4+' is the only rating that needs no detail (every descriptor NONE). For anything else,",
        "declare the content Apple asks about — it computes the rating from these, you don't set it:",
        "",
        "  ageRating: {",
        "    violenceCartoonOrFantasy: 'INFREQUENT_OR_MILD',",
        "    userGeneratedContent: false,",
        "  },",
        "",
        `Known keys: ${Object.keys(BASE).join(", ")}`,
      ].join("\n"),
    };
  }
  const unknown = Object.keys(declared).filter((k) => !(k in BASE));
  if (unknown.length) {
    return { problem: `age-rating: unknown key(s) ${unknown.join(", ")}. Known: ${Object.keys(BASE).join(", ")}` };
  }
  const bad = [];
  for (const [k, v] of Object.entries(declared)) {
    if (k === "kidsAgeBand") continue; // null | FIVE_AND_UNDER | SIX_TO_EIGHT | NINE_TO_ELEVEN
    if (typeof BASE[k] === "boolean" && typeof v !== "boolean") bad.push(`${k} must be true or false`);
    else if (typeof BASE[k] === "string" && !DESCRIPTOR_VALUES.has(v)) bad.push(`${k} must be one of ${[...DESCRIPTOR_VALUES].join(" / ")}`);
  }
  if (bad.length) return { problem: `age-rating: ${bad.join("; ")}` };
  return { attributes: { ...BASE, ...declared } };
}

export async function run(config, client) {
  const { attributes, problem } = resolveAttributes(config);
  if (problem) { console.error(red(problem)); return false; }
  await client.findApp(config.bundleId);
  // No allowLive: this PATCHes the age-rating declaration, and the live app-info's declaration is not
  // ours to aim a write at. The refusal below used to be unreachable — appInfo() handed back the live
  // record instead of null, so the write was planned against it and Apple's INVALID_STATE was the
  // first anyone heard of it.
  const info = await client.appInfo();
  if (!info) {
    console.error(red("age-rating: no editable app info — refusing to write to the live record."));
    console.error("  `vydanne prepare --apply` starts the next version, which makes app info editable again.");
    return false;
  }
  const { json } = await client.get(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
  const id = json.data?.id;
  if (!id) { console.error(red("age-rating: no declaration")); return false; }

  // What is actually being asserted, printed before it is sent. Apple computes the rating from these,
  // so the declared non-defaults ARE the rating — worth seeing in the log of the run that set them.
  const declared = Object.entries(attributes).filter(([k, v]) => v !== BASE[k] || (v !== false && v !== N && v !== null));
  console.log(`  declaring: ${declared.length ? declared.map(([k, v]) => `${k}=${v}`).join(", ") : "everything NONE (4+)"}`);

  const r = await client.patch(`/v1/ageRatingDeclarations/${id}`, { data: { type: "ageRatingDeclarations", id, attributes } });
  if (r.status >= 300) { console.error(red(`age-rating: ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`)); return false; }
  // Apple decides the band from the descriptors; naming config.rating here reports what was ASKED for,
  // which is the only thing this command controls.
  const label = config.ageRating ? `${config.rating} (from the declared descriptors)` : "4+";
  console.log(client.dryRun ? yellow(`age rating WOULD be set -> ${label}`) : green(`age rating set -> ${label}`));
  return true;
}
