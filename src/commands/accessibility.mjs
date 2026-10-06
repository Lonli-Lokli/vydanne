import { green, yellow, red } from "../util.mjs";

/**
 * Accessibility Nutrition Labels.
 *
 * These used to come from a hardcoded matrix that said the same thing for every app the tool was
 * pointed at. That is the wrong shape for this one command. Everything else vydanne writes is a
 * FACT about an app — its name, its price, the data it collects — but this is a CLAIM about
 * behaviour, made to Apple, and the tool had no way of knowing whether it was true. It asserted
 * VoiceOver, Voice Control and Larger Text support for apps nobody had audited, and at least one
 * of them did not honour Larger Text at all: its board glyphs scaled twice and grew off the
 * high-contrast disc drawn behind them.
 *
 * So the app declares it, feature by feature, in `vydanne.config.mjs`. Silence is not consent — an
 * app with no `accessibility` block gets an error, not a default, because "nobody wrote this down"
 * must never become "supports everything".
 *
 * Apple's platform caveats are still applied here, because they are facts about the platforms
 * rather than about any app: Larger Text does not exist on macOS and Voice Control does not exist
 * on watchOS, so those are forced false regardless of what an app claims.
 *
 * A declaration that does not exist yet is CREATED, for each device family the app ships on
 * (`devices`, or IPHONE + IPAD for an iOS app and MAC for a macOS one). Apple holds none until
 * someone makes one: this command used to update only the families it found, so on an app nobody
 * had set up by hand it printed "no IPHONE declaration" for every family and reported success,
 * and four of the portfolio's five apps had no labels at all (2026-10-05).
 */

/** Config key -> the ASC attribute it sets. */
const FEATURES = {
  voiceover: "supportsVoiceover",
  voiceControl: "supportsVoiceControl",
  largerText: "supportsLargerText",
  sufficientContrast: "supportsSufficientContrast",
  darkInterface: "supportsDarkInterface",
  differentiateWithoutColorAlone: "supportsDifferentiateWithoutColorAlone",
  reducedMotion: "supportsReducedMotion",
  captions: "supportsCaptions",
  audioDescriptions: "supportsAudioDescriptions",
};

/** Features Apple does not offer on a device family — never sent, whatever the app declares. */
const UNAVAILABLE = {
  IPHONE: [],
  IPAD: [],
  MAC: ["largerText"],
  APPLE_WATCH: ["voiceControl"],
};

const EXAMPLE = `  accessibility: {
    voiceover: true,
    voiceControl: true,
    largerText: true,
    sufficientContrast: true,
    darkInterface: true,
    differentiateWithoutColorAlone: true,
    reducedMotion: true,
    captions: false,
    audioDescriptions: false,
  },`;

/** The device families an app ships on: `devices` when declared, else what its platforms imply. */
export function familiesFor(config) {
  if (Array.isArray(config.accessibility?.devices)) return config.accessibility.devices;
  const platforms = config.platforms || ["IOS"];
  return [
    ...(platforms.includes("IOS") ? ["IPHONE", "IPAD"] : []),
    ...(platforms.includes("MAC_OS") ? ["MAC"] : []),
  ];
}

/** Turn the app's declaration into the attributes for one device family. */
function attributesFor(declared, family) {
  const out = {};
  for (const [key, attribute] of Object.entries(FEATURES)) {
    out[attribute] = UNAVAILABLE[family].includes(key) ? false : declared[key] === true;
  }
  return out;
}

/** Returns a human-readable problem, or null when the declaration is usable. */
export function validate(config) {
  const declared = config.accessibility;
  if (!declared || typeof declared !== "object") {
    return [
      "accessibility: missing.",
      "This command publishes CLAIMS about your app's behaviour to Apple, so it will not guess.",
      "Declare what you have actually verified:",
      "",
      EXAMPLE,
    ].join("\n");
  }
  const unknown = Object.keys(declared).filter((k) => !(k in FEATURES) && k !== "devices");
  if (unknown.length) {
    return `accessibility: unknown feature(s) ${unknown.join(", ")}. Known: ${Object.keys(FEATURES).join(", ")}`;
  }
  if ("devices" in declared) {
    const families = Object.keys(UNAVAILABLE);
    if (!Array.isArray(declared.devices) || !declared.devices.length || declared.devices.some((d) => !families.includes(d))) {
      return `accessibility.devices: a non-empty list of ${families.join(", ")} (the families the app ships on).`;
    }
  }
  const missing = Object.keys(FEATURES).filter((k) => typeof declared[k] !== "boolean");
  if (missing.length) {
    return [
      `accessibility: ${missing.join(", ")} must be declared true or false.`,
      "Every feature is stated explicitly — an omission would read as a quiet 'no', which is just",
      "as unverified as a quiet 'yes'.",
    ].join("\n");
  }
  return null;
}

export async function run(config, client) {
  const problem = validate(config);
  if (problem) {
    console.error(red(problem));
    return false;
  }
  const declared = config.accessibility;

  await client.findApp(config.bundleId);
  const publish = process.env.VYDANNE_A11Y_PUBLISH === "1";
  const { json } = await client.get(`/v1/apps/${client.appId}/accessibilityDeclarations?limit=50`);
  // Per family: the DRAFT to edit, and the PUBLISHED one it would replace. Apple refuses any change to a
  // published declaration (409, "can only be modified while in a 'DRAFT' state"): a correction is a new
  // draft, and publishing it replaces the old one. Found correcting Niva's Larger Text, 2026-10-05.
  const drafts = {};
  const published = {};
  for (const d of json.data || []) {
    const { deviceFamily, state } = d.attributes;
    if (state === "DRAFT") drafts[deviceFamily] = d;
    else if (state === "PUBLISHED") published[deviceFamily] = d;
  }

  const claimed = Object.keys(FEATURES).filter((k) => declared[k]);
  console.log(`  declaring: ${claimed.length ? claimed.join(", ") : "(nothing)"}`);
  const wanted = familiesFor(config);

  let gated = false;
  // A PATCH that Apple refuses is a claim that never reached the store. Both failure paths below used
  // to print red and `continue`, and the command still returned true — so `push` treated a family whose
  // declaration never saved as a completed step. The `continue`s stay (one refused family must not hide
  // the other three); the verdict now travels out with the return.
  const failures = [];
  for (const family of Object.keys(UNAVAILABLE)) {
    let id = drafts[family]?.id;
    const attributes = attributesFor(declared, family);
    const live = published[family];
    // A family the app does not ship on has nothing to declare, unless Apple already holds one for it.
    if (!id && !live && !wanted.includes(family)) continue;
    // Already what Apple shows, and no draft waiting: nothing to send.
    if (!id && live && Object.entries(attributes).every(([k, v]) => live.attributes[k] === v)) {
      console.log(green(`  ${family}: published labels already match`));
      continue;
    }
    if (!id) {
      const c = await client.post(`/v1/accessibilityDeclarations`, {
        data: {
          type: "accessibilityDeclarations",
          attributes: { deviceFamily: family, ...attributes },
          relationships: { app: { data: { type: "apps", id: client.appId } } },
        },
      });
      if (c.status >= 300) {
        const detail = c.json?.errors?.[0]?.detail || c.text?.slice(0, 200) || "";
        console.error(red(`  ${family} create ${c.status} ${detail}`));
        failures.push(`${family}: declaration not created (${c.status}${detail ? `: ${detail}` : ""})`);
        continue;
      }
      id = c.json.data.id;
      const what = live ? "draft to replace the published labels" : "declaration";
      console.log(green(`  ${family}: ${what} ${c.dryRun ? "would be created" : "created"}`));
    } else {
      const r = await client.patch(`/v1/accessibilityDeclarations/${id}`, {
        data: { type: "accessibilityDeclarations", id, attributes },
      });
      if (r.status >= 300) {
        const detail = r.json?.errors?.[0]?.detail || r.text?.slice(0, 200) || "";
        console.error(red(`  ${family} draft ${r.status} ${detail}`));
        failures.push(`${family}: draft not saved (${r.status}${detail ? `: ${detail}` : ""})`);
        continue;
      }
    }
    if (publish) {
      const p = await client.patch(`/v1/accessibilityDeclarations/${id}`, {
        data: { type: "accessibilityDeclarations", id, attributes: { publish: true } },
      });
      if (p.status < 300) {
        console.log(green(`  ${family}: PUBLISHED`));
      } else if (JSON.stringify(p.json).includes("CANNOT_PUBLISH_APP_MUST_BE_AVAILABLE")) {
        gated = true;
        console.log(yellow(`  ${family}: draft saved — publish deferred (app not live yet)`));
      } else {
        console.error(red(`  ${family} publish ${p.status}`));
        failures.push(`${family}: publish refused (${p.status})`);
      }
    } else {
      console.log(green(`  ${family}: draft saved`));
    }
  }
  if (failures.length) {
    console.error(red(`accessibility: ${failures.length} declaration(s) did not save:`));
    for (const f of failures) console.error(`  ${red("x")} ${f}`);
    return false;
  }
  console.log(
    gated
      ? yellow("accessibility staged (DRAFT); re-run with VYDANNE_A11Y_PUBLISH=1 once the app is live")
      : "accessibility done",
  );
  return true;
}
