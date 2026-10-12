import fs from "node:fs";
import path from "node:path";
import { probeVideo } from "./mp4.mjs";

/**
 * **What does Apple accept for this slot?** Answered from Apple's own catalog, not from a table someone
 * typed in.
 *
 * App Store Connect API 4.5.1 (published with the App Asset Library, 2026-10) exposes the specifications
 * it validates uploads against as data: `GET /v1/appAssetLibraryRefData` returns every image and video
 * specification, which placement groups take which ones, and how many each group holds. Apple's own
 * guidance is to read it at runtime rather than hard-code it, because a new device family (iPhone Duo was
 * the first) appears there without an API version change. So every command that has a client reads it
 * live, and this module turns it into the three questions vydanne asks: which specs does a slot take,
 * how many files does it hold, and does this file match one of them.
 *
 * THE SNAPSHOT. `bridge` has no client and the tests have no network, and both still need an answer. They
 * get `assetCatalog.snapshot.json`: the same response, read 2026-10-12, reduced to the placement types and
 * groups vydanne uses. Same shape as the live attributes, so one code path serves both — and when the live
 * catalog is reachable it wins, which is how a correction on Apple's side reaches vydanne without a
 * release. Where Apple's help pages and its catalog disagree (the 21:9 header image is ".jpeg, .jpg or
 * .png" on the creative-assets specifications page and PNG-only in the catalog), the catalog is the one
 * the upload is processed against, so it is the one followed here.
 */
export const SNAPSHOT_DATE = "2026-10-12";
const SNAPSHOT = JSON.parse(fs.readFileSync(new URL("./assetCatalog.snapshot.json", import.meta.url), "utf8"));

/**
 * Screenshot display type (the deprecated set API's vocabulary, which `fill` still uploads through) ->
 * the Asset Library placement group the same images live in.
 *
 * Observed, not guessed: Apple migrated every existing screenshot set into the library, and on a real
 * listing the APP_IPHONE_67 set's files are placements in IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE, the
 * APP_IPHONE_65 set's in IPHONE_FACE_ID_LARGE_PROFILE and the iPad set's in IPAD_13_PROFILE, one for one.
 * Watch and Mac follow their display classes. APP_IPHONE_DUO is the one group that holds BOTH Duo screens:
 * the catalog lists all four sizes (outer 1398×2034 and 2034×1398, inner 2007×2853 and 2853×2007) under
 * IPHONE_DUO_PROFILE, with one limit of ten for the group.
 */
export const SCREENSHOT_GROUP = {
  APP_IPHONE_67: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE",
  APP_IPHONE_65: "IPHONE_FACE_ID_LARGE_PROFILE",
  APP_IPAD_PRO_3GEN_129: "IPAD_13_PROFILE",
  APP_WATCH_ULTRA: "WATCH_ULTRA_PROFILE",
  APP_DESKTOP: "MAC_PROFILE",
  APP_IPHONE_DUO: "IPHONE_DUO_PROFILE",
};

/** The two creative-asset slots on a product page (iOS / iPadOS 27 and later), keyed by their file stem. */
export const CREATIVE_SLOTS = {
  header: { placementType: "PRODUCT_PAGE_HEADER_ASSET", group: "DEFAULT_PROFILE", label: "product page header" },
  search: { placementType: "APP_STORE_SEARCH_RESULTS_ASSET", group: "DEFAULT_PROFILE", label: "search results" },
};

/** Apple's catalog, live or snapshot, with the lookups vydanne needs. */
export class Catalog {
  constructor(attributes, source = "snapshot") {
    this.attributes = attributes;
    /** "live" when read from the API this run, else "snapshot" — said in output, so a check is never mistaken for the other. */
    this.source = source;
    this.images = new Map((attributes.imageSpecs || []).map((s) => [s.specId, { ...s, kind: "image" }]));
    this.videos = new Map((attributes.videoSpecs || []).map((s) => [s.specId, { ...s, kind: "video" }]));
  }

  /** Every spec a placement type accepts in one group, images and videos both. Empty when unknown. */
  specsFor(placementType, group) {
    const type = (this.attributes.placementTypes || []).find((p) => p.placementTypeId === placementType);
    const mapping = type?.specMappings?.find((m) => m.placementGroupId === group);
    return (mapping?.specs || []).map((id) => this.images.get(id) || this.videos.get(id)).filter(Boolean);
  }

  /** The most files a group may hold for a placement type on an App Store version, or null when unknown. */
  limit(placementType, group, feature = "APP_STORE_VERSIONS") {
    const f = (this.attributes.features || []).find((x) => x.featureId === feature);
    const policy = f?.placementPolicies?.find((p) => p.placementType === placementType);
    return policy?.groupLimits?.find((g) => g.groupIds.includes(group))?.maxCount ?? null;
  }

  /** The image specs a screenshot display type accepts — empty for a display type vydanne cannot map. */
  screenshotSpecs(displayType) {
    const group = SCREENSHOT_GROUP[displayType];
    return group ? this.specsFor("APP_SCREENSHOT", group).filter((s) => s.kind === "image") : [];
  }

  screenshotLimit(displayType) {
    const group = SCREENSHOT_GROUP[displayType];
    return group ? this.limit("APP_SCREENSHOT", group) : null;
  }
}

export const SNAPSHOT_CATALOG = new Catalog(SNAPSHOT, "snapshot");

/**
 * The live catalog, or the snapshot with the reason it was not live.
 *
 * Read-only (a GET), so it runs in a dry run too. A failure is not fatal: the snapshot answers the same
 * questions as of its date, and the caller says which one it used.
 */
export async function loadCatalog(client) {
  if (!client) return SNAPSHOT_CATALOG;
  try {
    const r = await client.get("/v1/appAssetLibraryRefData");
    const attrs = r.status < 300 ? (r.json?.data?.[0] ?? r.json?.data)?.attributes : null;
    if (attrs?.placementTypes) return new Catalog(attrs, "live");
    return Object.assign(new Catalog(SNAPSHOT, "snapshot"), { why: `reference data answered HTTP ${r.status}` });
  } catch (e) {
    return Object.assign(new Catalog(SNAPSHOT, "snapshot"), { why: e.message });
  }
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg"]);
const VIDEO_EXT = new Set([".mp4", ".m4v", ".mov"]);
export const mediaKind = (file) => {
  const ext = path.extname(file).toLowerCase();
  return IMAGE_EXT.has(ext) ? "image" : VIDEO_EXT.has(ext) ? "video" : null;
};

/** "PT5S" / "PT1M30S" / "PT2.5S" -> seconds. */
export function isoSeconds(d) {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(d || ""));
  return m ? (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) : null;
}

/** "1920×1280" for a fixed spec, "1920–3840 × 1280–2560 (3:2)" for a range. */
export function describeSize(spec) {
  const d = spec.dimensions;
  if (d.minWidth === d.maxWidth && d.minHeight === d.maxHeight) return `${d.minWidth}×${d.minHeight}`;
  return `${d.minWidth}–${d.maxWidth} × ${d.minHeight}–${d.maxHeight} (${spec.aspectRatio})`;
}

/**
 * Does one probed file satisfy one spec? Returns null on a match, else the first reason it does not.
 *
 * The aspect ratio is checked only for a RANGE spec, and to half a percent: Apple's own fixed sizes are
 * not exact to their nominal ratios (5244×2950 is labelled 16:9 and is not quite), so for a fixed size the
 * pixel dimensions are the whole test, and for a range the ratio is what keeps 1920×2560 out of a 3:2 slot.
 * Frame rate gets the same half-a-frame of slack, so 29.97 counts as 30, which is what every encoder means.
 */
export function mismatch(spec, probe, { ext, bytes }) {
  if (spec.fileExtensions && !spec.fileExtensions.includes(ext)) return `${ext} is not accepted (${spec.fileExtensions.join(" ")})`;
  const d = spec.dimensions;
  const { width: w, height: h } = probe;
  if (w < d.minWidth || w > d.maxWidth || h < d.minHeight || h > d.maxHeight) return `${w}×${h} is not ${describeSize(spec)}`;
  if (d.minWidth !== d.maxWidth || d.minHeight !== d.maxHeight) {
    const [a, b] = String(spec.aspectRatio || "").split(":").map(Number);
    if (a && b && Math.abs((w / h) / (a / b) - 1) > 0.005) return `${w}×${h} is not ${spec.aspectRatio}`;
  }
  if (spec.kind === "image" && spec.alphaAllowed === false && probe.hasAlpha) return "has an alpha channel, which Apple rejects";
  if (spec.maxFileSize && bytes > spec.maxFileSize) return `${bytes} bytes is over Apple's ${spec.maxFileSize}`;
  if (spec.kind === "video") {
    if (probe.fps != null && spec.frameRates?.length
        && !spec.frameRates.some((r) => probe.fps >= r.minFps - 0.5 && probe.fps <= r.maxFps + 0.5)) {
      return `${probe.fps} fps is not ${spec.frameRates.map((r) => (r.minFps === r.maxFps ? r.minFps : `${r.minFps}–${r.maxFps}`)).join(" or ")} fps`;
    }
    const min = isoSeconds(spec.duration?.min);
    const max = isoSeconds(spec.duration?.max);
    if (min != null && probe.duration < min - 0.05) return `${probe.duration.toFixed(2)} s is shorter than ${min} s`;
    if (max != null && probe.duration > max + 0.05) return `${probe.duration.toFixed(2)} s is longer than ${max} s`;
    if (spec.audioRequired && !probe.hasAudio) return "has no audio track, which this slot requires";
  }
  return null;
}

/** Width, height, alpha (images) or duration, fps, audio (videos) of a local file; null when unreadable. */
export async function probe(file) {
  const kind = mediaKind(file);
  if (kind === "video") {
    const v = probeVideo(file);
    return v ? { kind, ...v } : null;
  }
  if (kind === "image") {
    try {
      const { default: sharp } = await import("sharp");
      const m = await sharp(file).metadata();
      return { kind, width: m.width, height: m.height, hasAlpha: Boolean(m.hasAlpha), format: m.format };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Match a local file against a list of specs. `{ spec }` when one accepts it, else `{ problem }` naming
 * why the CLOSEST kind of spec does not — "1920×1080 is not 3840×1646" is actionable, a list of every
 * reason every spec refused it is not. `probed` lets a caller that already read the file pass it in.
 */
export async function matchFile(file, specs, probed) {
  const p = probed ?? (await probe(file));
  if (!p) return { problem: `could not read ${path.basename(file)} as an image or an MP4/QuickTime video` };
  const ext = path.extname(file).toLowerCase();
  const bytes = fs.statSync(file).size;
  const sameKind = specs.filter((s) => s.kind === p.kind);
  if (!sameKind.length) {
    const kinds = [...new Set(specs.map((s) => s.kind))].join(" or ");
    return { problem: `${p.kind}s are not accepted here (${kinds || "nothing"} only)`, probe: p };
  }
  // The extension first, on its own: a .jpg in a PNG-only slot is one fix, and folding it into the size
  // report would bury it under sizes the file may already have.
  const takesExt = sameKind.filter((s) => !s.fileExtensions || s.fileExtensions.includes(ext));
  if (!takesExt.length) {
    const exts = [...new Set(sameKind.flatMap((s) => s.fileExtensions || []))].join(" ");
    return { problem: `${ext} is not accepted here (${exts})`, probe: p };
  }
  const reasons = [];
  for (const s of takesExt) {
    const why = mismatch(s, p, { ext, bytes });
    if (!why) return { spec: s, probe: p };
    reasons.push({ why, size: why.startsWith(`${p.width}×${p.height} is not`) });
  }
  // A size mismatch on every spec is best answered with the sizes that WOULD work; anything else (alpha,
  // a duration, a frame rate) is the reason that stopped a spec whose size did fit, so that one is said.
  const other = reasons.find((r) => !r.size);
  return { problem: other ? other.why : `${p.width}×${p.height} — accepted: ${takesExt.map(describeSize).join(", ")}`, probe: p };
}
