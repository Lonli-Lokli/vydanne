import fs from "node:fs";
import path from "node:path";
import { putUploadOperations } from "./upload.mjs";

/**
 * The App Asset Library (App Store Connect API 4.5.1) — the calls vydanne makes on it.
 *
 * WHY A SECOND UPLOAD PATH. The product page header and the search results asset exist ONLY here: there
 * is no screenshot-set equivalent, so the set-based `uploadAsset` in upload.mjs cannot reach them. The
 * library's model is different in three ways that shape this file:
 *
 *   1. An asset is uploaded ONCE into the app's library, then PLACED on each surface (a version
 *      localization). The same file on twenty localizations is one upload and twenty placements.
 *   2. Commits carry no checksum, and assets report none back — so the library cannot say whether its
 *      copy is the file on disk. vydanne puts the md5 into the asset's `referenceName` instead
 *      ("header.png · vydanne md5 <hex>"), which is how `diff`/`preflight` compare by content and how a
 *      re-run finds the asset it already uploaded instead of uploading it again.
 *   3. Placements are immutable and a slot holds one, so a new header means deleting the old placement
 *      and creating another — the asset itself stays in the library (it may be placed elsewhere).
 *
 * Every write goes through the same `client` as the rest of vydanne, so a dry run records each POST,
 * PATCH and DELETE instead of sending it.
 */

export const referenceFor = (file, sum) => `${path.basename(file)} · vydanne md5 ${sum}`;
export const md5FromReference = (name) => /vydanne md5 ([0-9a-f]{32})\b/.exec(name || "")?.[1] ?? null;

const KIND = {
  image: { type: "appAssetLibraryImages", rel: "image" },
  video: { type: "appAssetLibraryVideos", rel: "video" },
};

/** The app's library id, or `{ id: null, status }` when the key cannot see it (wrong role, older account). */
export async function assetLibrary(client) {
  const r = await client.get(`/v1/apps/${client.appId}/assetLibrary`);
  return { id: r.status < 300 ? r.json?.data?.id ?? null : null, status: r.status };
}

/**
 * The placements on one version localization, with their assets: `[{ id, placementType, placementGroup,
 * state, kind, asset: { id, fileName, referenceName, state, specId } | null }]`. Read once per locale and
 * filtered locally — a localization carries a few dozen at most.
 */
export async function placementsOn(client, locId) {
  const { status, json } = await client.get(`/v1/appStoreVersionLocalizations/${locId}/placements?include=image,video&sort=placementGroupPosition&limit=200`);
  if (status >= 300) return null;
  const assets = new Map((json.included || []).map((r) => [`${r.type}/${r.id}`, { id: r.id, ...(r.attributes || {}) }]));
  return (json.data || []).map((p) => {
    const image = p.relationships?.image?.data;
    const video = p.relationships?.video?.data;
    const ref = image || video;
    return {
      id: p.id,
      ...p.attributes,
      kind: image ? "image" : video ? "video" : null,
      asset: ref ? assets.get(`${ref.type}/${ref.id}`) || { id: ref.id } : null,
    };
  });
}

/**
 * The creative assets already in the library, by the md5 vydanne wrote into their reference names.
 * Assets without one (uploaded through the web UI) are not in the map: their content is unknown.
 */
export async function creativeAssetsByMd5(client, libId) {
  const byMd5 = new Map();
  for (const kind of ["image", "video"]) {
    const { status, json } = await client.get(`/v1/appAssetLibraries/${libId}/${kind}s?filter[category]=CREATIVE_ASSETS&limit=200`);
    if (status >= 300) continue;
    for (const a of json.data || []) {
      const sum = md5FromReference(a.attributes?.referenceName);
      if (sum) byMd5.set(sum, { id: a.id, kind, ...a.attributes });
    }
  }
  return byMd5;
}

/**
 * Reserve, upload and commit one file into the library. Returns the asset id.
 *
 * The commit is `uploaded: true` and nothing else: the library has no `sourceFileChecksum` attribute, and
 * Apple validates the transfer against the `fileSize` declared in the reservation instead.
 */
export async function uploadToLibrary(client, { libId, file, kind, category, referenceName, previewFrameTimeCode }) {
  const { type } = KIND[kind];
  const bytes = fs.readFileSync(file);
  const attributes = { fileName: path.basename(file), fileSize: bytes.length, category, referenceName };
  if (kind === "video" && previewFrameTimeCode) attributes.previewFrameTimeCode = previewFrameTimeCode;
  const reserve = await client.post(`/v1/${type}`, {
    data: { type, attributes, relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: libId } } } },
  });
  if (reserve.status >= 300) throw new Error(`reserve ${type} ${reserve.status}: ${JSON.stringify(reserve.json).slice(0, 200)}`);
  const asset = reserve.json.data;
  await putUploadOperations(asset.attributes?.uploadOperations, bytes, path.basename(file));
  const commit = await client.patch(`/v1/${type}/${asset.id}`, { data: { type, id: asset.id, attributes: { uploaded: true } } });
  if (commit.status >= 300) throw new Error(`commit ${type} ${commit.status}: ${JSON.stringify(commit.json).slice(0, 200)}`);
  return asset.id;
}

/** Put a library asset on one version localization. Returns the placement id. */
export async function place(client, { placementType, group, kind, assetId, locId }) {
  const { type, rel } = KIND[kind];
  const r = await client.post("/v1/appAssetLibraryPlacements", {
    data: {
      type: "appAssetLibraryPlacements",
      attributes: { placementType, placementGroup: group },
      relationships: {
        [rel]: { data: { type, id: assetId } },
        appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: locId } },
      },
    },
  });
  if (r.status >= 300) {
    const e = r.json?.errors?.[0];
    throw new Error(`place ${placementType} ${r.status}: ${e?.detail || e?.title || JSON.stringify(r.json).slice(0, 200)}`);
  }
  return r.json.data.id;
}

/**
 * Wait for processing to finish. Returns the asset's attributes once it leaves AWAITING_UPLOAD /
 * UPLOAD_COMPLETE (so `state` is PREPARE_FOR_SUBMISSION, FAILED, …), or null if it never did in time.
 * A dry run returns at once: there is nothing on Apple's side to wait for.
 */
export async function waitProcessed(client, kind, id, { tries = 40, delayMs = 5000 } = {}) {
  if (client.dryRun) return null;
  for (let i = 0; i < tries; i++) {
    const { json } = await client.get(`/v1/${KIND[kind].type}/${id}`);
    const a = json?.data?.attributes;
    if (a && !["AWAITING_UPLOAD", "UPLOAD_COMPLETE"].includes(a.state)) return a;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
