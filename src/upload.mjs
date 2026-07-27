import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

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
  for (const op of asset.attributes.uploadOperations || []) {
    const headers = {};
    for (const h of op.requestHeaders || []) headers[h.name] = h.value;
    const r = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (r.status >= 300) throw new Error(`upload op ${r.status} for ${path.basename(filePath)}`);
  }
  const commit = await client.patch(`/v1/${type}/${asset.id}`, {
    data: { type, id: asset.id, attributes: { uploaded: true, sourceFileChecksum: md5(bytes) } },
  });
  if (commit.status >= 300) throw new Error(`commit ${type} ${commit.status}: ${JSON.stringify(commit.json).slice(0, 200)}`);
  return asset.id;
}

// Previews process asynchronously — poll until Apple exposes videoUrl, then set the poster frame.
export async function setPreviewPoster(client, previewId, frameTimeCode, { tries = 30, delayMs = 15000 } = {}) {
  // In a dry run the preview was never created, so `previewId` is a synthetic `dry-run-<n>` and this would
  // poll a 404 for seven and a half minutes before giving up.
  if (client.dryRun) return true;
  for (let i = 0; i < tries; i++) {
    const { json } = await client.get(`/v1/appPreviews/${previewId}`);
    if (json.data?.attributes?.videoUrl) {
      await client.patch(`/v1/appPreviews/${previewId}`, {
        data: { type: "appPreviews", id: previewId, attributes: { previewFrameTimeCode: frameTimeCode } },
      });
      return true;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}
