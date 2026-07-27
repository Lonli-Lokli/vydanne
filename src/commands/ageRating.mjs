import { green, yellow, red } from "../util.mjs";

// Set the age rating via the AppInfo age-rating declaration. v1: "4+" — every content descriptor NONE.
// (PATCH is partial; Apple recomputes 4+ from these.) app-info fetched from the full list (survives
// READY_FOR_REVIEW).
export async function run(config, client) {
  if (config.rating !== "4+") { console.error(yellow(`age-rating: only '4+' (all-NONE) implemented; config=${config.rating}`)); return false; }
  await client.findApp(config.bundleId);
  const info = await client.appInfo();
  if (!info) { console.error(red("age-rating: no editable app info")); return false; }
  const { json } = await client.get(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
  const id = json.data?.id;
  if (!id) { console.error(red("age-rating: no declaration")); return false; }
  const N = "NONE";
  // Apple's 2025 age-rating schema. A PATCH must include ALL required fields (a partial set 409s),
  // and `ageRatingOverride` (deprecated) cannot be sent alongside `ageRatingOverrideV2` — so we send
  // only V2. Content descriptors are enums (NONE); capability questions are booleans (false). All
  // benign here → 4+.
  const attributes = {
    advertising: false, alcoholTobaccoOrDrugUseOrReferences: N, contests: N, gambling: false,
    gamblingSimulated: N, gunsOrOtherWeapons: N, healthOrWellnessTopics: false, kidsAgeBand: null,
    lootBox: false, medicalOrTreatmentInformation: N, messagingAndChat: false, parentalControls: false,
    profanityOrCrudeHumor: N, ageAssurance: false, sexualContentGraphicAndNudity: N, sexualContentOrNudity: N,
    socialMedia: false, socialMediaAgeRestricted: false, horrorOrFearThemes: N, matureOrSuggestiveThemes: N,
    unrestrictedWebAccess: false, userGeneratedContent: false, violenceCartoonOrFantasy: N,
    violenceRealisticProlongedGraphicOrSadistic: N, violenceRealistic: N, ageRatingOverrideV2: N,
    koreaAgeRatingOverride: N,
  };
  const r = await client.patch(`/v1/ageRatingDeclarations/${id}`, { data: { type: "ageRatingDeclarations", id, attributes } });
  if (r.status >= 300) { console.error(red(`age-rating: ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`)); return false; }
  console.log(client.dryRun ? yellow("age rating WOULD be set -> 4+") : green("age rating set -> 4+"));
  return true;
}
