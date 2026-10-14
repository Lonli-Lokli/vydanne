import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Exported because `diff` compares against it: the checksum committed here is the only thing that lets
// a local file be compared to what Apple actually holds, rather than to how MANY things it holds.
export const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

// Native ASC asset upload (what spaceship does internally): reserve the asset (returns pre-signed
// uploadOperations) -> PUT each chunk -> commit with uploaded:true + the MD5 checksum.
// `type` = "appScreenshots" | "appPreviews"; `setType` = "appScreenshotSet" | "appPreviewSet".
export async function uploadAsset(client, { type, setType, setId, filePath }) {
  const bytes = fs.readFileSync(filePath);
  const reserve = await client.post(`/v1/${type}`, {
    data: {
      type,
      attributes: { fileSize: bytes.length, fileName: path.basename(filePath) },
      relationships: { [setType]: { data: { type: `${setType}s`, id: setId } } },
    },
  });
  if (reserve.status >= 300) throw new Error(`reserve ${type} ${reserve.status}: ${JSON.stringify(reserve.json).slice(0, 200)}`);
  const asset = reserve.json.data;
  await putUploadOperations(asset.attributes.uploadOperations, bytes, path.basename(filePath));
  const commit = await client.patch(`/v1/${type}/${asset.id}`, {
    data: { type, id: asset.id, attributes: { uploaded: true, sourceFileChecksum: md5(bytes) } },
  });
  if (commit.status >= 300) throw new Error(`commit ${type} ${commit.status}: ${JSON.stringify(commit.json).slice(0, 200)}`);
  return asset.id;
}

/**
 * Send the bytes to the pre-signed URLs a reservation handed back. Shared by the set-based upload above
 * and the Asset Library one (assetLibrary.mjs): the reservation and the commit differ, this step does not.
 * The URLs are unauthenticated and time-limited, so this is plain `fetch` rather than the ASC client — and
 * a dry run never gets here with any, because a withheld reservation returns no operations.
 */
export async function putUploadOperations(ops, bytes, label) {
  for (const op of ops || []) {
    const headers = {};
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    const r = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (r.status >= 300) throw new Error(`upload op ${r.status} for ${label}`);
  }
}

/**
 * Wait for uploaded App Previews to finish processing, set each one's poster frame where `poster` asks for one, and
 * wait for Apple's poster IMAGE before calling it done. App Store Connect shows a preview with no image as a tile that
 * never loads: Niva's 1.7 previews sat like that in four languages after their poster was set to 8 s, each reading
 * `COMPLETE` with a 0×0 image, while the one language whose poster was never set had Apple's own frame and an image
 * (2026-10-14). A preview with no `poster` keeps Apple's frame (about 5 s in) and is only waited on.
 *
 * All the uploads are waited on together, because Apple processes them in parallel; waiting on each before the next
 * upload kept a 21-language run going long enough to be cut off after five languages.
 *
 * `items` are `{ id, label, poster? }`; returns one `{ ...item, ok, why?, frame? }` each.
 */
export async function finishPreviews(client, items, { deadlineMs = 30 * 60_000, posterWaitMs = 6 * 60_000, delayMs = 15000, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const t0 = now();
  const left = new Map(items.map((it) => [it.id, { ...it, phase: "processing" }]));
  const done = [];
  const finish = (it, result) => { left.delete(it.id); done.push({ id: it.id, label: it.label, poster: it.poster, ...result }); };
  while (left.size) {
    for (const it of [...left.values()]) {
      const { json } = await client.get(`/v1/appPreviews/${it.id}`);
      const a = json?.data?.attributes ?? {};
      const delivery = a.assetDeliveryState?.state;
      if (delivery === "FAILED") {
        const errs = (a.assetDeliveryState.errors || []).map((e) => e.description || e.code).join("; ");
        finish(it, { ok: false, why: `Apple could not process it${errs ? `: ${errs}` : ""}` });
        continue;
      }
      if (!a.videoUrl) continue; // still processing
      const image = a.previewImage?.width > 0 ? a.previewImage.templateUrl : null;
      if (it.poster && it.phase === "processing") {
        const r = await client.patch(`/v1/appPreviews/${it.id}`, {
          data: { type: "appPreviews", id: it.id, attributes: { previewFrameTimeCode: it.poster } },
        });
        if (r.status >= 300) {
          finish(it, { ok: false, why: `poster ${it.poster} refused (${r.status}): ${JSON.stringify(r.json?.errors?.[0]?.detail ?? r.json).slice(0, 160)}` });
          continue;
        }
        // The image Apple had before belongs to its own frame; only a new one is the poster that was asked for.
        Object.assign(it, { phase: "poster", before: image, posterAt: now() });
        continue;
      }
      const isNew = it.phase !== "poster" || image !== it.before;
      if (image && isNew && (!it.poster || a.previewFrameTimeCode === it.poster)) {
        finish(it, { ok: true, frame: a.previewFrameTimeCode });
        continue;
      }
      if (it.phase === "poster" && now() - it.posterAt > posterWaitMs) {
        finish(it, {
          ok: false,
          why: `no poster image ${Math.round(posterWaitMs / 60_000)} min after its poster was set to ${it.poster} `
            + `(Apple reports the frame ${a.previewFrameImage?.state?.state ?? "unknown"}, image ${a.previewImage?.width ?? 0}×${a.previewImage?.height ?? 0}), `
            + "so App Store Connect shows a tile that never loads. Leave `poster` out to keep Apple's own frame, and upload again with VYDANNE_REPLACE=1.",
        });
      }
    }
    if (!left.size) break;
    if (now() - t0 > deadlineMs) {
      for (const it of [...left.values()]) {
        finish(it, { ok: false, why: `${it.phase === "poster" ? "no poster image" : "still processing"} after ${Math.round(deadlineMs / 60_000)} min` });
      }
      break;
    }
    await sleep(delayMs);
  }
  return done;
}
