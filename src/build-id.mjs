/**
 * The build-id check, shared by both upload commands.
 *
 * A build's own id (the `.aab` manifest's package, the `.ipa`'s CFBundleIdentifier) must equal the app
 * id the config names, so a debug, staging or other variant of the app (a different id) cannot be
 * uploaded by mistake. It runs before any network call, an id that cannot be read is refused too, and
 * nothing (flag, option, environment variable) skips it.
 */

/** Null when the build may go up; otherwise the refusal sentence. */
export function buildIdProblem(kind, actual, expected) {
  if (!actual) return `could not read this ${kind}'s id, so it cannot be shown to be the app this config uploads (${expected}).`;
  if (actual !== expected) return `this ${kind} is ${actual}, but this config uploads ${expected}.`;
  return null;
}
