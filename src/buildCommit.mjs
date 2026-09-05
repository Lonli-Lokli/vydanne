import { execFileSync } from "node:child_process";

/**
 * **Which commit a shipped build number names** — for repos whose build number is a commit count.
 *
 * That is the convention across the kupalinka portfolio: Android's `versionCode` comes from
 * `git rev-list --count HEAD` in `composeApp/build.gradle.kts`, and iOS's `CURRENT_PROJECT_VERSION`
 * from a `Scripts/build-number.sh` that runs the same command. It makes a store's build number a
 * REVERSIBLE fact, which is the only reason a release tag is worth anything: symbolicating a crash
 * or reproducing a store binary needs the tree the archive was cut from, and a version string does
 * not identify one.
 *
 * ### Nothing here assumes the convention holds — it VERIFIES it, per build
 *
 * vydanne is pointed at apps that do not build this way, so a mapping that trusted the convention
 * would confidently name the wrong commit for them. Every answer below is checked
 * (`rev-list --count` on the candidate must equal the build number) and an unverifiable one comes
 * back as a stated reason rather than a guess.
 *
 * The check is not ceremony even where the convention does hold. `rev-list --reverse` is ORDERED,
 * not counted: on a history with merges the Nth line is not necessarily the commit with N
 * ancestors, so indexing alone is right only by luck on a linear repo.
 *
 * It has already caught a real one — a build numbered `1` sitting in App Store Connect above a 131,
 * which is a `getOrDefault(1)` fallback firing when the git count failed at archive time. That
 * binary is not traceable to a commit by any means, and the honest output is to say so.
 */

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * The repo's commits oldest-first, or null when this is not a git checkout.
 *
 * Read once and passed around: resolving each build separately would re-walk the whole history per
 * version, and a listing command should not cost more than the API call it is annotating.
 */
export function commitOrder() {
  try {
    return git(["rev-list", "--reverse", "HEAD"]).split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

/** Every tag pointing at [sha], dereferenced so annotated tags are found too. */
export function tagsAt(sha) {
  try {
    return git(["tag", "--points-at", sha]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve one build number.
 *
 * Returns `{ sha }` when the count checks out, or `{ why }` naming what stopped it — which is the
 * useful half. "This build has no commit" is a finding about the release, not a gap in the tool.
 */
export function commitForBuild(order, build) {
  const n = Number(build);
  if (!order) return { why: "not a git checkout" };
  if (!Number.isInteger(n) || n < 1) return { why: `build "${build}" is not a number` };
  if (n > order.length) {
    return { why: `build ${n} is past HEAD (${order.length} commits) — built elsewhere, or on an unmerged branch` };
  }
  const sha = order[n - 1];
  let count;
  try {
    count = Number(git(["rev-list", "--count", sha]));
  } catch {
    return { why: "git rev-list failed" };
  }
  if (count !== n) {
    return { why: `commit ${sha.slice(0, 9)} has ${count} ancestors, not ${n} — build number is not a commit count here` };
  }
  return { sha };
}

/**
 * **A build number that did not grow is not a commit count**, whatever `rev-list` says about it.
 *
 * This exists because the count check alone is not enough, and the hole is not hypothetical: Vodar's
 * pending 1.2 is attached to a build numbered `1`, sitting in App Store Connect above a 131. One
 * genuinely IS the ancestor count of the repo's first commit, so [commitForBuild] verified it and
 * cheerfully named a commit from the week the project started — a confident, wrong answer of exactly
 * the kind this module exists to refuse.
 *
 * A commit count only ever grows, so a build that is not greater than one already shipped cannot be
 * one. In practice it is a fallback firing when git was unavailable at archive time — `getOrDefault(1)`
 * in the gradle file, or the same default in `Scripts/build-number.sh` — and the binary it names
 * cannot be traced to a tree by any means.
 *
 * Flagging is the safe direction. Two releases whose builds were uploaded out of order would be
 * reported as suspect and are worth a look anyway; a silently wrong commit is not.
 */
export function outOfSequence(build, priorMax) {
  const n = Number(build);
  if (priorMax == null || !Number.isInteger(n)) return null;
  if (n > priorMax) return null;
  return `build ${n} is not above ${priorMax} from an earlier release — a commit count only grows, ` +
    "so this is a build-number fallback and the binary is not traceable to a commit";
}
