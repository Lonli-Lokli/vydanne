import fs from "node:fs";
import path from "node:path";
import { red, yellow, green } from "./util.mjs";

/**
 * Refuse to send one store a listing that talks about the other one.
 *
 * WHY THIS IS IN THE TOOL AND NOT IN A CHECKLIST. Both stores forbid it, both enforce it by
 * REJECTING a submission, and it is the single easiest thing to do by accident — because the two
 * listings are written from the same source copy, by the same person, often by a translator who was
 * handed an English master that happened to say "also on Google Play". Apple's App Review guideline
 * 2.3.10 is explicit ("does not include names, icons, or imagery of other mobile platforms"), and
 * Google Play's Store Listing and Promotion policy is the mirror of it. Nobody discovers this while
 * writing the copy; they discover it days later, from a rejection, in one locale out of twenty.
 *
 * So it is checked HERE, against the local files that are about to be uploaded, before anything is
 * sent. That is the only place it can be caught for free.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not flag a store's own platform — "Android" belongs in
 * a Play listing and "iPhone" belongs in an App Store one. And it does not flag the bare word
 * "Play", which is a verb every game listing on earth uses; only the store's actual name.
 *
 * Findings come in two tiers, because the certainty differs:
 *   block — unambiguous: a store name, a store URL, a competing platform's device name.
 *   warn  — a word that is usually a reference but sometimes just a word ("apple" in a game about
 *           fruit). Reported, never fatal, and silenceable per app.
 *
 * An app with a genuine exception sets `allowCrossStoreTerms: ["..."]` in its vydanne config.
 */

/** Terms that must not appear in a listing for [store]. Ordered longest-first so the report names
 *  the most specific match rather than a fragment of it. */
const FOREIGN = {
  apple: [
    { term: "play.google.com", re: /play\.google\.com/i, level: "block" },
    { term: "Google Play", re: /google\s*play/i, level: "block" },
    { term: "Play Store", re: /\bplay[- ]?store\b/i, level: "block" },
    { term: "Play Market", re: /\bplay[- ]?market\b/i, level: "block" },
    { term: "Android", re: /\bandroid\b/i, level: "block" },
    { term: "安卓", re: /安卓/, level: "block" },
    { term: "アンドロイド", re: /アンドロイド/, level: "block" },
    { term: "안드로이드", re: /안드로이드/, level: "block" },
    { term: "Андроид/Андроїд", re: /андро[иї]д/i, level: "block" },
    { term: "أندرويد", re: /أندرويد/, level: "block" },
    { term: "אנדרואיד", re: /אנדרואיד/, level: "block" },
    { term: "एंड्रॉइड", re: /एंड्रॉ?इड/, level: "block" },
    { term: "APK", re: /\bapk\b/i, level: "warn" },
    { term: "Chromebook", re: /\bchromebook\b/i, level: "warn" },
  ],
  google: [
    { term: "apps.apple.com", re: /apps\.apple\.com/i, level: "block" },
    { term: "App Store", re: /\bapp[- ]?store\b/i, level: "block" },
    { term: "TestFlight", re: /\btestflight\b/i, level: "block" },
    { term: "iPhone", re: /\biphone\b/i, level: "block" },
    { term: "iPad", re: /\bipad(os)?\b/i, level: "block" },
    { term: "iOS", re: /\bios\b/i, level: "block" },
    { term: "Apple Arcade", re: /\bapple\s+arcade\b/i, level: "block" },
    { term: "苹果", re: /苹果/, level: "block" },
    { term: "애플", re: /애플/, level: "block" },
    { term: "アップル", re: /アップル/, level: "block" },
    // Sometimes a fruit, so it is reported rather than fatal.
    { term: "Apple", re: /\bapple\b/i, level: "warn" },
  ],
};

/** Local text a store actually uploads. Keys are the file basenames each fill() reads. */
const APPLE_FILES = [
  "name", "subtitle", "description", "keywords", "promotional_text",
  "release_notes", "marketing_url", "support_url",
];
const PLAY_FILES = ["title", "short_description", "full_description"];

/** One short line of context so a finding can be found and fixed without opening the file blind. */
function excerpt(text, match) {
  const at = text.toLowerCase().indexOf(match.toLowerCase());
  if (at < 0) return "";
  const from = Math.max(0, at - 28);
  const to = Math.min(text.length, at + match.length + 28);
  return `${from ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`;
}

/**
 * Scan the local metadata tree for [store].
 *
 * @returns {{findings: Array, scanned: number}} findings carry {level, locale, field, term, excerpt}
 */
export function scanCrossStore(store, metadataDir, allow = []) {
  const rules = FOREIGN[store].filter((r) => !allow.some((a) => a.toLowerCase() === r.term.toLowerCase()));
  const files = store === "apple" ? APPLE_FILES : PLAY_FILES;
  const findings = [];
  let scanned = 0;
  if (!metadataDir || !fs.existsSync(metadataDir)) return { findings, scanned };

  for (const entry of fs.readdirSync(metadataDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const field of files) {
      const p = path.join(metadataDir, entry.name, `${field}.txt`);
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, "utf8");
      scanned++;
      for (const rule of rules) {
        const m = text.match(rule.re);
        if (!m) continue;
        findings.push({
          level: rule.level,
          locale: entry.name,
          field,
          term: rule.term,
          excerpt: excerpt(text, m[0]),
        });
      }
    }
  }
  return { findings, scanned };
}

/** The other store's human name, for the message. */
const OTHER = { apple: "Google Play / Android", google: "the App Store / iOS" };
const GUIDELINE = {
  apple: "App Review guideline 2.3.10 — metadata must not name other mobile platforms.",
  google: "Google Play Store Listing and Promotion policy — no references to other app stores.",
};

/**
 * Report findings. Returns false when something BLOCKING was found, so callers can refuse to upload.
 *
 * Printing every locale rather than the first is the point: this fails one translation at a time,
 * and knowing it is 3 locales and not 20 is the difference between a fix and a re-translation.
 */
export function reportCrossStore(store, metadataDir, allow = []) {
  const { findings, scanned } = scanCrossStore(store, metadataDir, allow);
  if (!scanned) return true;

  const blocking = findings.filter((f) => f.level === "block");
  const warnings = findings.filter((f) => f.level === "warn");

  if (blocking.length) {
    console.log(red(`  cross-store: ${blocking.length} reference(s) to ${OTHER[store]} in listing text`));
    console.log(`    ${GUIDELINE[store]}`);
    for (const f of blocking) {
      console.log(`    ${red("x")} ${f.locale}/${f.field}: "${f.term}"  ${f.excerpt}`);
    }
  }
  for (const f of warnings) {
    console.log(`    ${yellow("!")} ${f.locale}/${f.field}: "${f.term}" — check this is not a platform reference  ${f.excerpt}`);
  }
  if (!blocking.length && !warnings.length) {
    console.log(green(`  cross-store: clean (${scanned} files)`));
  }
  return blocking.length === 0;
}
