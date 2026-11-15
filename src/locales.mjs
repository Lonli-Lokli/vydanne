// App Store locale handling — the #1 gotcha: deliver/ASC folder codes must match Apple's exact list, and a
// short UI code (`de`, `ar`) that isn't valid aborts a whole upload. A code with no App Store language
// (e.g. Belarusian `be`) must fall back to the primary listing.
export const VALID = new Set([
  "ar-SA", "bn-BD", "ca", "cs", "da", "de-DE", "el", "en-AU", "en-CA", "en-GB", "en-US", "es-ES", "es-MX",
  "fi", "fr-CA", "fr-FR", "gu-IN", "he", "hi", "hr", "hu", "id", "it", "ja", "kn-IN", "ko", "ml-IN", "mr-IN",
  "ms", "nl-NL", "no", "or-IN", "pa-IN", "pl", "pt-BR", "pt-PT", "ro", "ru", "sk", "sl-SI", "sv", "ta-IN",
  "te-IN", "th", "tr", "uk", "ur-PK", "vi", "zh-Hans", "zh-Hant",
]);

// Short UI code -> App Store code. `nb` and `iw` are Android's spellings of Norwegian and Hebrew: a
// project that names its resource folders the Android way (values-nb, values-iw) would otherwise have
// both locales resolve to "no App Store language" and fall back to the primary listing — a silently
// missing translation for a language Apple does support under a different code.
export const UI_TO_ASC = {
  ar: "ar-SA", bn: "bn-BD", de: "de-DE", es: "es-ES", fr: "fr-FR", nl: "nl-NL",
  pt: "pt-BR", ur: "ur-PK", zh: "zh-Hans", en: "en-US",
  nb: "no", iw: "he", in: "id", ji: "he",
};

/**
 * `code` as every App Store locale it fills, in order: none when Apple has no listing language for it.
 *
 * `extra` is the app's own `localeMap` — the extension point this table lacked. Apple's list moves, and
 * projects spell locales in whatever their UI framework uses; neither is a reason to need a vydanne
 * release. An app can map its code onto a VALID one, and only onto a VALID one: an override pointing at
 * a language Apple does not have would fail at upload instead of here. An entry may name several
 * (`es: ["es-ES", "es-MX"]`): an app with one Spanish UI and two Spanish listings would otherwise leave
 * the second listing with no screenshots, or with ones copied by hand that nothing rebuilds.
 */
export const toAscAll = (code, extra) => {
  if (VALID.has(code)) return [code];
  const mapped = [extra?.[code] ?? UI_TO_ASC[code] ?? []].flat();
  return [...new Set(mapped.filter((c) => VALID.has(c)))];
};

/** `code` as one App Store locale (the first `toAscAll` gives), or null when Apple has no listing language for it. */
export const toAsc = (code, extra) => toAscAll(code, extra)[0] ?? null;

export function resolveLocales(uiCodes = [], extra) {
  const supported = {};
  const targets = {};
  const unsupported = [];
  const invalid = [];
  for (const c of uiCodes) {
    const all = toAscAll(c, extra);
    if (all.length) { supported[c] = all[0]; targets[c] = all; }
    // An override that names a code Apple doesn't have is a config mistake, not a missing language —
    // kept apart so the report can say which it is instead of blaming the locale. One bad folder in a
    // list is reported too, though the good ones still resolve.
    const bad = VALID.has(c) ? [] : [extra?.[c] ?? []].flat().filter((t) => !VALID.has(t));
    for (const t of bad) invalid.push(`${c} -> ${t}`);
    if (!all.length && !bad.length) unsupported.push(c);
  }
  return { supported, targets, unsupported, invalid };
}
