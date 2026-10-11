/**
 * The testing tracks one `prerelease --store google` writes, from `google.track` or VYDANNE_TRACK.
 *
 * One name, a comma-separated list ("alpha,internal"), or an array. Several tracks get the SAME bundle and
 * the SAME release notes in ONE edit, committed once: either every track has the build or none does. Two
 * separate runs could not promise that. They also drift: the first run archives `next.txt` as
 * `<versionCode>.txt`, so the second finds no notes of its own (and a repo's notes gate refuses it), and a
 * run of `play:build` between them uploads a different versionCode to each track.
 */

/** The one track `prerelease` refuses: that release is a human's to make, in Play Console. */
export const PRODUCTION = "production";

/** Trimmed, de-duplicated track names in the order given; empty entries dropped. */
export function parseTracks(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const out = [];
  for (const raw of list) {
    const track = String(raw).trim();
    if (track && !out.includes(track)) out.push(track);
  }
  return out;
}

/** `"alpha"` or `"alpha", "internal"`, for messages. */
export function describeTracks(tracks) {
  return tracks.map((t) => `"${t}"`).join(", ");
}
