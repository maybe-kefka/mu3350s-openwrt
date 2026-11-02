#!/usr/bin/env node
// Generate the AVB-bypass TrustOS image for this device family (F50 / MU300, B04 eSIM).
//
// Background (see docs/03-trustos-avb-bypass.md):
//   * the official B03 eSIM root package carries a patched trustos.bin; compared with the
//     stock B04 trustos_a it differs in exactly one instruction:
//       file offset 0x774d4 (payload 0x772d4): 0x2a1403e0 -> 0x52800000  ("mov w0, #0")
//     which makes TrustOS skip signature verification (AVB) of the boot images.
//   * a patched trustos still has to be accepted by SPL.  The official package wraps it
//     the same way `bsp_cve_2img()` does in TomKing062/spreadtrum_flash: the SML image
//     header/certificate is reused and its payload becomes the patched trustos payload.
//
// This script does both offline, from the original partition dumps:
//   node gen-trustos-patched.mjs --backup <dir with sml_a.bin + trustos_a.bin> --out <file>
//
// Verified outputs for the B04 eSIM backup of this device:
//   size   5,178,856 bytes
//   sha256 3dbf07e20e123c25944615d2220964052f15c43dc045f8c81a0899daa85d5b30

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const argv = process.argv.slice(2);
function take(name, def) { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; }
const backupDir = take("--backup", "C:\\f50-work\\backup1");
const outFile = take("--out", "trustos_a_patched_merged.bin");
const PATCH_OFFSET = 0x774d4;
const PATCH_VALUE = 0x52800000;
const EXPECTED_SHA = "3dbf07e20e123c25944615d2220964052f15c43dc045f8c81a0899daa85d5b30";

function u32(b, o) { return b.readUInt32LE(o); }
function u64(b, o) { return Number(b.readBigUInt64LE(o)); }
function w32(b, o, v) { b.writeUInt32LE(v >>> 0, o); }
function w64(b, o, v) { b.writeBigUInt64LE(BigInt(v), o); }

// dhtb_data_size() + bsp_chsize() from TomKing062/spreadtrum_flash: the real footprint of a
// DHTB image, including its SIMGHDR footer and certificates.
function dhtbDataSize(base, mImgSize, maxRel) {
  const rawEnd = 0x200 + mImgSize;
  if (rawEnd + 0x60 > maxRel) return rawEnd;
  let maxEnd = rawEnd + 0x60;
  const check = (sOff, oOff) => {
    const s = u64(base, rawEnd + sOff), o = u64(base, rawEnd + oOff);
    if (s && o && o + s > maxEnd && o + s <= maxRel) maxEnd = o + s;
  };
  check(0x20, 0x28); check(0x30, 0x38); check(0x50, 0x58);
  return maxEnd;
}
function bspChsize(buf) {
  const size = buf.length;
  const mImgSize = u32(buf, 0x30), mPostromOffset = u32(buf, 0x58);
  let withPostrom = 0;
  if (mPostromOffset && mPostromOffset + 0x200 < size) {
    const pmagic = u32(buf, mPostromOffset);
    const pImgSize = u32(buf, mPostromOffset + 0x30);
    if ((pmagic === 0x42544844 || pmagic === 0x50534844) && pImgSize && mPostromOffset + 0x200 + pImgSize <= size) {
      withPostrom = mPostromOffset + dhtbDataSize(buf.subarray(mPostromOffset), pImgSize, size - mPostromOffset);
    }
  }
  if (!mImgSize) throw new Error("broken Sprd trusted firmware (mImgSize == 0)");
  return buf.subarray(0, Math.max(dhtbDataSize(buf, mImgSize, size), withPostrom));
}

// bsp_cve_2img(): signed_img (SML) header + modified trustos payload + signed_img remainder.
function bspCve2img(smlIn, tosIn) {
  const sml = bspChsize(Buffer.from(smlIn));
  const tos = Buffer.from(tosIn);
  let modifiedSize = Math.ceil(tos.length / 16) * 16;
  let modified = tos;
  const origModified = u32(tos, 0x30);
  if (u32(tos, 0) === 0x42544844 && origModified) {
    modifiedSize = origModified;
    modified = tos.subarray(0x200);
  }
  const signedRemain = sml.length - 0x200;
  const hdr = Buffer.from(sml.subarray(0, 0x200));
  const mImg = u32(hdr, 0x30);
  w32(hdr, 0x30, mImg + modifiedSize);
  const rest = Buffer.from(sml.subarray(0x200));
  const ih = mImg + 0x200 - 0x200;
  w64(rest, ih + 0x18, u64(rest, ih + 0x18) + modifiedSize);
  w64(rest, ih + 0x28, u64(rest, ih + 0x28) + modifiedSize);
  const out = Buffer.alloc(0x200 + modifiedSize + signedRemain);
  hdr.copy(out, 0);
  modified.copy(out, 0x200);
  rest.copy(out, 0x200 + modifiedSize);
  return out;
}

const smlPath = path.join(backupDir, "sml_a.bin");
const tosPath = path.join(backupDir, "trustos_a.bin");
for (const p of [smlPath, tosPath]) { if (!fs.existsSync(p)) { console.error("[!] missing " + p + " (dump the partitions first, see docs/02-backup-and-recovery.md)"); process.exit(2); } }
const sml = fs.readFileSync(smlPath);
const trustos = fs.readFileSync(tosPath);
const old = u32(trustos, PATCH_OFFSET);
console.log("[*] backup dir : " + backupDir);
console.log("[*] sml_a.bin  : " + sml.length + " bytes");
console.log("[*] trustos_a  : " + trustos.length + " bytes, mImgSize 0x" + u32(trustos, 0x30).toString(16));
console.log("[*] instruction at 0x" + PATCH_OFFSET.toString(16) + " = 0x" + old.toString(16));
if (old !== 0x2a1403e0) {
  console.error("[!] unexpected instruction; this generator matches the B04 eSIM trustos of this device (sha256 b064502e...). Refusing to patch a different image.");
  process.exit(3);
}
const patchedTos = Buffer.from(trustos);
w32(patchedTos, PATCH_OFFSET, PATCH_VALUE);
const merged = bspCve2img(sml, patchedTos);
fs.writeFileSync(outFile, merged);
const sha = crypto.createHash("sha256").update(merged).digest("hex");
console.log("[ok] wrote " + outFile);
console.log("     size   : " + merged.length);
console.log("     sha256 : " + sha);
if (sha === EXPECTED_SHA) console.log("     matches the verified image used on this device.");
else console.log("     NOTE: differs from the reference image (expected only if the input backup is not the B04 eSIM one).");
