#!/usr/bin/env node
/**
 * Progressive Raven drone (load time, 2026-11-06, user: "use low textures first, then replace them with the full ones").
 * Splits public/assets/models/raven_hexa.glb (kept, the source) into
 *   - raven_hexa-lite.glb             same JSON/geometry (Draco untouched), each 1024 map as a 256 JPEG preview
 *   - raven-hexa-maps/<i>-<name>.jpg   the original maps, losslessly re-packed by jpegtran (-optimize, progressive if
 *                                     smaller): the same DCT data, so every decoded pixel is identical (checked below;
 *                                     the source bytes are kept if jpegtran is missing or anything differs). ~15% smaller.
 * Each lite image carries `extras.full` (its original's URL); scene/hd-assets.ts swaps the originals in after the
 * reveal, so the final drone is the same bytes as before.  Re-run after every rebuild of raven_hexa.glb:
 *   node scripts/split-raven-hexa.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { readGlb, writeGlb } from "./lib/glb.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODELS = path.join(ROOT, "public/assets/models");
const SRC = path.join(MODELS, "raven_hexa.glb");
const OUT_GLB = path.join(MODELS, "raven_hexa-lite.glb"); // site ships raven_hexa-lite-q.glb: this output re-Draco-ed (gltf-transform draco --quantize-position 12 --quantize-normal 10 --quantize-texcoord 10)
const MAP_DIR = path.join(MODELS, "raven-hexa-maps");
const PREVIEW = 256;

/** Smallest lossless jpegtran re-pack of `bytes` whose decoded pixels equal the original's; else `bytes`. */
async function losslessJpeg(bytes) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "raven-jpeg-"));
  try {
    const src = path.join(tmp, "in.jpg");
    fs.writeFileSync(src, bytes);
    const ref = await sharp(bytes).raw().toBuffer();
    let best = bytes;
    for (const flags of [["-optimize"], ["-optimize", "-progressive"]]) {
      const out = path.join(tmp, "out.jpg");
      try {
        execFileSync("jpegtran", ["-copy", "none", ...flags, "-outfile", out, src]);
      } catch {
        return bytes; // jpegtran not installed: keep the source bytes
      }
      const candidate = fs.readFileSync(out);
      if (candidate.length < best.length && (await sharp(candidate).raw().toBuffer()).equals(ref)) best = candidate;
    }
    return best;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const { json, view } = readGlb(SRC);
fs.rmSync(MAP_DIR, { recursive: true, force: true });
fs.mkdirSync(MAP_DIR, { recursive: true });
const replace = new Map();
let full = 0;
let lite = 0;
for (const [i, image] of json.images.entries()) {
  if (image.mimeType !== "image/jpeg") throw new Error(`image ${i}: expected JPEG, got ${image.mimeType}`);
  const bytes = view(image.bufferView);
  const name = `${String(i).padStart(2, "0")}-${(image.name || "map").replace(/[^a-z0-9_-]/gi, "_")}.jpg`;
  const packed = await losslessJpeg(bytes);
  fs.writeFileSync(path.join(MAP_DIR, name), packed);
  const preview = await sharp(bytes).resize(PREVIEW, PREVIEW, { kernel: "lanczos3" }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  replace.set(image.bufferView, preview);
  image.extras = { ...(image.extras ?? {}), full: `/assets/models/raven-hexa-maps/${name}` };
  full += packed.length;
  lite += preview.length;
}
writeGlb(OUT_GLB, json, view, replace);
console.log(
  `${path.relative(ROOT, OUT_GLB)} ${(fs.statSync(OUT_GLB).size / 1024) | 0} KB (maps ${(lite / 1024) | 0} KB), ` +
    `${json.images.length} originals ${(full / 1024) | 0} KB in ${path.relative(ROOT, MAP_DIR)}/ (pixel-identical)`,
);
