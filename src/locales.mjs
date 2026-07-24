// App Store locale handling — the #1 gotcha: deliver/ASC folder codes must match Apple's exact list, and a
// short UI code (`de`, `ar`) that isn't valid aborts a whole upload. A code with no App Store language
// (e.g. Belarusian `be`) must fall back to the primary listing.
export const VALID = new Set([
  "ar-SA", "bn-BD", "ca", "cs", "da", "de-DE", "el", "en-AU", "en-CA", "en-GB", "en-US", "es-ES", "es-MX",
  "fi", "fr-CA", "fr-FR", "gu-IN", "he", "hi", "hr", "hu", "id", "it", "ja", "kn-IN", "ko", "ml-IN", "mr-IN",
  "ms", "nl-NL", "no", "or-IN", "pa-IN", "pl", "pt-BR", "pt-PT", "ro", "ru", "sk", "sl-SI", "sv", "ta-IN",
  "te-IN", "th", "tr", "uk", "ur-PK", "vi", "zh-Hans", "zh-Hant",
]);

export const UI_TO_ASC = {
  ar: "ar-SA", bn: "bn-BD", de: "de-DE", es: "es-ES", fr: "fr-FR", nl: "nl-NL",
  pt: "pt-BR", ur: "ur-PK", zh: "zh-Hans", en: "en-US",
};

export const toAsc = (code) => (VALID.has(code) ? code : UI_TO_ASC[code] || null);

export function resolveLocales(uiCodes = []) {
  const supported = {};
  const unsupported = [];
  for (const c of uiCodes) {
    const asc = toAsc(c);
    asc ? (supported[c] = asc) : unsupported.push(c);
  }
  return { supported, unsupported };
}
