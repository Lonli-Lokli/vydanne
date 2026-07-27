import fs from "node:fs";
import path from "node:path";
import { green, yellow, red } from "../../util.mjs";
import { readAabVersionCode } from "../aab.mjs";

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

  // The bundle declares its own versionCode, so read it HERE — before the multi-megabyte upload — and
  // resolve the changelogs against it while there is still time to fix them. In repos that derive the
  // code from `git rev-list --count HEAD` it is unknowable in advance, so nobody can pre-name
  // `<versionCode>.txt`; the fallback used to win silently and the first place the real number ever
  // appeared was Play's upload response. A null here (unreadable bundle) degrades to exactly that old
  // behaviour: Play's answer after upload stays the authority either way.
  const declared = readAabVersionCode(aab);
  if (declared != null) console.log(`  versionCode ${declared} (read from the bundle's manifest)`);
  let notes = declared != null ? readNotes(g.metadataDir, declared, g.defaultLocale) : null;

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

    if (declared != null && declared !== versionCode) {
      // Play's answer is derived from the same manifest, so a disagreement means OUR parser misread the
      // bundle — say so and re-resolve the notes against the truth rather than shipping the wrong file.
      console.log(yellow(`  bundle parse said ${declared} but Play says ${versionCode} — trusting Play (please report this)`));
      notes = null;
    }
    if (!notes) notes = readNotes(g.metadataDir, versionCode, g.defaultLocale);

    // One complete release object: Play replaces the track's releases wholesale.
    const release = { status: "completed", versionCodes: [String(versionCode)] };
    if (notes.entries.length) release.releaseNotes = notes.entries;
    const name = process.env.VYDANNE_RELEASE_NAME;
    if (name) release.name = name;

    const put = await client.putTrack(editId, track, [release]);
    if (put.status >= 300) throw new Error(`tracks.update ${put.status}: ${JSON.stringify(put.json).slice(0, 300)}`);

    if (client.dryRun) {
      await client.deleteEdit(editId);
      console.log(yellow(`\n  DRY RUN — edit discarded, nothing changed. Re-run with --apply to publish to "${track}".`));
      return true;
    }
    const res = await client.commit(editId);
    if (res.status >= 300) throw new Error(`edits.commit ${res.status}: ${JSON.stringify(res.json).slice(0, 300)}`);
    console.log(green(`\n  committed — versionCode ${versionCode} is live on "${track}".`));
    archiveNextNotes(notes, versionCode);
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
 * Release notes per locale — supply's layout, plus a convention that breaks the naming circularity:
 *
 *   <metadataDir>/<play-locale>/changelogs/<versionCode>.txt   exact — supply's own convention
 *                                          next.txt            THIS release, named before its code exists
 *                                          default.txt         evergreen fallback ("bug fixes")
 *
 * `next.txt` exists because `<versionCode>.txt` cannot be written in advance when the code is derived
 * from the commit count: every commit moves the number, so the only file you could name ahead of time
 * was `default.txt` — which then also serves every FUTURE release, silently. Write this release's
 * notes as `next.txt`; after a real commit they are archived as `<versionCode>.txt` (the code is known
 * by then), so the next release cannot inherit them by accident.
 *
 * Which file won is reported per source, and the default.txt fallback is a WARNING — it used to be
 * indistinguishable from an exact match, which is how a release ships with last release's notes.
 */
function readNotes(metadataDir, versionCode, defaultLocale) {
  const entries = [];
  const bySource = { [`${versionCode}.txt`]: 0, "next.txt": 0, "default.txt": 0 };
  const nextFiles = [];
  const empty = [];
  if (!metadataDir || !fs.existsSync(metadataDir)) return { entries, nextFiles };
  for (const language of fs.readdirSync(metadataDir)) {
    const dir = path.join(metadataDir, language, "changelogs");
    if (!fs.existsSync(dir)) continue;
    const file = [`${versionCode}.txt`, "next.txt", "default.txt"].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (!file) continue;
    const text = fs.readFileSync(file, "utf8").trim();
    // An empty file would otherwise drop the locale without a word — name it below instead.
    if (!text) { empty.push(`${language}/${path.basename(file)}`); continue; }
    bySource[path.basename(file)]++;
    if (path.basename(file) === "next.txt") nextFiles.push(file);
    // Play caps release notes at 500 chars and rejects the whole edit if any locale is over.
    if (text.length > 500) {
      console.log(yellow(`  ${language}: release notes ${text.length}/500 chars — truncated`));
      entries.push({ language, text: text.slice(0, 500) });
    } else {
      entries.push({ language, text });
    }
  }
  // Keep the default locale first purely so the log reads sensibly.
  entries.sort((a, b) => (a.language === defaultLocale ? -1 : b.language === defaultLocale ? 1 : 0));

  if (!entries.length) {
    console.log(yellow(`  no release notes found under ${notesPattern(metadataDir, versionCode)}`));
  } else {
    const parts = Object.entries(bySource).filter(([, n]) => n).map(([f, n]) => `${n} from ${f}`);
    console.log(`  release notes for versionCode ${versionCode}: ${entries.length} locale(s) — ${parts.join(" · ")}`);
    if (bySource["default.txt"]) {
      console.log(yellow(`  ${bySource["default.txt"]} locale(s) fell back to default.txt — no ${versionCode}.txt or next.txt.`));
      console.log(yellow("  If those notes describe an older release, write this one's as changelogs/next.txt."));
    }
  }
  if (empty.length) console.log(yellow(`  empty changelog file(s), locale dropped: ${empty.join(", ")}`));
  return { entries, nextFiles };
}

const notesPattern = (dir, code) => `${dir}/<locale>/changelogs/{${code},next,default}.txt`;

/**
 * After a REAL commit, park each next.txt under the versionCode it just shipped as. Renaming (not
 * copying) is the point: a `next.txt` that lingered would be picked up by the NEXT release too, and
 * "this release's notes" quietly becoming "every release's notes" is the exact failure default.txt
 * already has. The rename also lands on supply's own `<versionCode>.txt` convention, so the history
 * of what shipped with what stays greppable.
 */
function archiveNextNotes(notes, versionCode) {
  for (const file of notes.nextFiles) {
    const to = path.join(path.dirname(file), `${versionCode}.txt`);
    try {
      fs.renameSync(file, to);
      console.log(`  archived ${path.relative(process.cwd(), file)} -> ${versionCode}.txt`);
    } catch (e) {
      console.log(yellow(`  could not archive ${file}: ${e.message} — rename it to ${versionCode}.txt yourself, or the next release reuses it`));
    }
  }
}
