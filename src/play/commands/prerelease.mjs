import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../../util.mjs";

/** Tracks this command will write. `production` is deliberately absent — see below. */
const TESTING_TRACKS = new Set(["internal", "alpha", "beta"]);

/**
 * Upload an .aab to a CLOSED TESTING track, with release notes.
 *
 * Why testing-only: shipping to everyone is a judgement call with no undo — a staged rollout can be
 * halted but not un-shipped, and the reviewer-facing consequences are the operator's to own. So this
 * mirrors the Apple side, which never submits: `production` is REFUSED, not gated behind a flag, so
 * there is no arrangement of arguments that ships to the public by accident.
 *
 * For a PAID app, `internal` is usually the only track you want: it is the one where testers install
 * without buying. Closed/open testers must purchase it like anyone else.
 *
 * Play assigns the versionCode from the bundle's own manifest, so build numbering stays with the build,
 * and re-uploading the same code fails loudly rather than silently replacing a binary.
 *
 * Everything happens inside one edit transaction: nothing is live until commit, and any throw leaves the
 * edit uncommitted — i.e. the track untouched.
 */
export async function run(config, client) {
  const g = config.google;
  const track = process.env.VYDANNE_TRACK || g.track || "internal";

  if (track === "production") {
    console.error(red("prerelease: refusing to write the production track — that release is a human's to make."));
    console.error("  Promote the tested build in Play Console when you're ready.");
    return false;
  }
  if (!TESTING_TRACKS.has(track)) {
    console.error(red(`prerelease: unknown track "${track}" (expected: ${[...TESTING_TRACKS].join(", ")})`));
    return false;
  }

  const aab = resolveAab(g.aab);
  if (!aab) {
    console.error(red("prerelease: no .aab found — set `google.aab` in the config, or pass VYDANNE_AAB=<path>."));
    return false;
  }
  console.log(green(`prerelease → track "${track}"`));
  console.log(`  bundle: ${path.relative(process.cwd(), aab) || aab}  (${(fs.statSync(aab).size / 1e6).toFixed(1)} MB)`);

  const editId = await client.newEdit();
  try {
    // Upload, or REUSE. Play rejects a versionCode it already holds, which is the right answer for an
    // accidental re-upload but wrong for the common case of promoting a build you already pushed to one
    // testing track onto another. The API names the code in its refusal, so take it and carry on — the
    // bytes are already up there, and a bundle is immutable, so reusing it can't diverge from the file.
    let versionCode;
    try {
      const bundle = await client.uploadBundle(editId, aab);
      versionCode = bundle.versionCode;
      if (!versionCode) throw new Error(`upload returned no versionCode: ${JSON.stringify(bundle).slice(0, 200)}`);
      console.log(green(`  uploaded versionCode ${versionCode}`));
    } catch (e) {
      const used = /Version code (\d+) has already been used/.exec(e.message);
      if (!used) throw e;
      versionCode = Number(used[1]);
      console.log(yellow(`  versionCode ${versionCode} already uploaded — reusing that bundle`));
    }

    const releaseNotes = readNotes(g.metadataDir, versionCode, g.defaultLocale);
    if (releaseNotes.length) {
      console.log(`  release notes: ${releaseNotes.length} locale(s) — ${releaseNotes.map((n) => n.language).join(", ")}`);
    } else {
      console.log(yellow(`  no release notes found under ${g.metadataDir}/<locale>/changelogs/{${versionCode},default}.txt`));
    }

    // One complete release object: Play replaces the track's releases wholesale.
    const release = { status: "completed", versionCodes: [String(versionCode)] };
    if (releaseNotes.length) release.releaseNotes = releaseNotes;
    const name = process.env.VYDANNE_RELEASE_NAME;
    if (name) release.name = name;

    const put = await client.putTrack(editId, track, [release]);
    if (put.status >= 300) throw new Error(`tracks.update ${put.status}: ${JSON.stringify(put.json).slice(0, 300)}`);

    if (process.env.VYDANNE_COMMIT !== "1") {
      await client.deleteEdit(editId);
      console.log(yellow(`\n  DRY RUN — edit discarded, nothing changed. Re-run with VYDANNE_COMMIT=1 to publish to "${track}".`));
      return true;
    }
    const res = await client.commit(editId);
    if (res.status >= 300) throw new Error(`edits.commit ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
    console.log(green(`\n  committed — versionCode ${versionCode} is live on "${track}".`));
    console.log("  Production stays manual: promote it in Play Console when you're ready.");
    return true;
  } catch (e) {
    // Abandon the edit so a failed run leaves the track exactly as it was.
    await client.deleteEdit(editId).catch(() => {});
    console.error(red(`prerelease: ${e.message}`));
    return false;
  }
}

/** `google.aab` may be a file or a directory; a directory takes its newest .aab. */
function resolveAab(configured) {
  const p = process.env.VYDANNE_AAB || configured;
  if (!p) return null;
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return null;
  if (!fs.statSync(abs).isDirectory()) return abs;
  const files = fs.readdirSync(abs).filter((f) => f.endsWith(".aab"))
    .map((f) => path.join(abs, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

/**
 * Release notes per locale, following fastlane supply's layout so an existing repo needs no migration:
 * `<metadataDir>/<play-locale>/changelogs/<versionCode>.txt`, falling back to `default.txt`.
 */
function readNotes(metadataDir, versionCode, defaultLocale) {
  const out = [];
  if (!metadataDir || !fs.existsSync(metadataDir)) return out;
  for (const language of fs.readdirSync(metadataDir)) {
    const dir = path.join(metadataDir, language, "changelogs");
    if (!fs.existsSync(dir)) continue;
    const file = [path.join(dir, `${versionCode}.txt`), path.join(dir, "default.txt")].find((f) => fs.existsSync(f));
    if (!file) continue;
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) continue;
    // Play caps release notes at 500 chars and rejects the whole edit if any locale is over.
    if (text.length > 500) {
      console.log(yellow(`  ${language}: release notes ${text.length}/500 chars — truncated`));
      out.push({ language, text: text.slice(0, 500) });
    } else {
      out.push({ language, text });
    }
  }
  // Keep the default locale first purely so the log reads sensibly.
  return out.sort((a, b) => (a.language === defaultLocale ? -1 : b.language === defaultLocale ? 1 : 0));
}
