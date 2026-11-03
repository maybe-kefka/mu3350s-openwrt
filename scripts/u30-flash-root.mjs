#!/usr/bin/env node
// U30 Air (U30AirV1.0.0B33) root-package flasher over the BROM/FDL2 download mode.
//
// Writes (active slot a) from a third-party one-key-root package:
//   trustos_a <- trustos.bin  (AVB bypass patch; offset write, the image is shorter than the 6 MiB partition)
//   boot_a    <- boot.bin     (Magisk + adb-over-IP overlay, exactly 64 MiB)
// Every write is read back and compared; on mismatch the tool stops before writing the next one.
// --rollback writes the files from a partition backup directory instead (recovery).
//
// The device must ALREADY be in download mode. On this firmware the easiest way is to let an
// installer kick attempt fail: spd_dump prints "kick reboot timeout" and the device stays in BROM
// (VID_1782&PID_4D00, "SPRD U2S Diag"). Then start this tool; it connects with exec_addr + FDL1/FDL2
// (CVE-2022-38694) and drives the FDL2 console. Pressing power while plugging also works.
//
// Example (Windows):
//   node u30-flash-root.mjs --spd ..\part-tool\bin\spd_dump.exe --fdl1 ..\part-tool\bin\fdl1-dl.bin \
//        --fdl2 ..\part-tool\bin\fdl2-dl.bin --pkg ..\part-tool\data --work ..\work\u30-flash-tmp
//   node u30-flash-root.mjs ... --rollback --backup C:\f50-work\u30-backup
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const argv = process.argv.slice(2);
function take(name, def) { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; }
const SPD = take("--spd", "spd_dump.exe");
const FDL1 = take("--fdl1", "fdl1-dl.bin");
const FDL2 = take("--fdl2", "fdl2-dl.bin");
const PKG = take("--pkg", "data");
const WORK = take("--work", path.join(process.cwd(), "u30-flash-tmp"));
const BACKUP = take("--backup", "");
const ROLLBACK = argv.includes("--rollback");
const ADDR_EXEC = take("--exec-addr", "0x65012f48");
const ADDR_FDL1 = take("--fdl1-addr", "0x65000800");
const ADDR_FDL2 = take("--fdl2-addr", "0xb4fffe00");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const log = (...a) => console.log(...a);

if (ROLLBACK && !BACKUP) { console.error("--rollback needs --backup <dir>"); process.exit(2); }
const trustosSrc = ROLLBACK ? path.join(BACKUP, "trustos_a.bin") : path.join(PKG, "trustos.bin");
const bootSrc = ROLLBACK ? path.join(BACKUP, "boot_a.bin") : path.join(PKG, "boot.bin");
for (const f of [trustosSrc, bootSrc]) if (!fs.existsSync(f)) { console.error("missing file: " + f); process.exit(2); }
const trustos = fs.readFileSync(trustosSrc);
const boot = fs.readFileSync(bootSrc);
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
log("[" + (ROLLBACK ? "rollback" : "flash") + "] trustos " + trustos.length + " B, boot " + boot.length + " B");

const spd = spawn(SPD, ["--wait", "30", "--verbose", "1", "exec_addr", ADDR_EXEC,
  "fdl", FDL1, ADDR_FDL1, "fdl", FDL2, ADDR_FDL2, "exec"],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
let buf = ""; let exited = false;
spd.stdout.on("data", (d) => { buf += d.toString(); });
spd.stderr.on("data", (d) => { buf += d.toString(); });
spd.on("exit", () => { exited = true; });
const waitPrompt = async (timeout, from) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const seg = buf.slice(from);
    const m = seg.match(/FDL[12]\s*>/);
    if (m) return { ok: true, out: seg.slice(0, m.index + m[0].length) };
    if (exited) return { ok: false, reason: "exited", out: seg };
    if (seg.includes("Press any key")) { try { spd.stdin.write("\n"); } catch {} }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, reason: "timeout", out: buf.slice(from) };
};
const send = async (cmd, timeout, label) => {
  const from = buf.length;
  try { spd.stdin.write(cmd + "\n"); } catch {}
  const r = await waitPrompt(timeout, from);
  const out = String(r.out ?? "").replace(/\r/g, "");
  log("[" + label + "] " + (r.ok ? "ok" : "FAILED (" + r.reason + ")") + (out ? "\n" + out.trim().slice(-400) : ""));
  return r;
};
const readBack = async (part, timeout) => {
  await send("path " + WORK, 20000, "path");
  await send("r " + part, timeout, "r " + part);
  const f = path.join(WORK, part + ".bin");
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
};

const conn = await waitPrompt(60000, 0);
if (!conn.ok) { log("cannot reach FDL2: " + conn.reason + " (is the device in BROM/download mode?)"); process.exit(3); }
log("[connect] FDL2 ready");
await send("verbose 1", 20000, "verbose");
await send("size_part trustos_a", 20000, "size trustos_a");
await send("size_part boot_a", 20000, "size boot_a");

await send("wof trustos_a 0 " + trustosSrc, 240000, "wof trustos_a");
let rb = await readBack("trustos_a", 180000);
const okT = rb && rb.length >= trustos.length && rb.subarray(0, trustos.length).equals(trustos);
log("[verify] trustos_a read-back: " + (okT ? "MATCH" : "MISMATCH") + " (" + (rb ? rb.length : 0) + " B)");
if (!okT) {
  log("stopping: trustos_a does not match; boot_a is NOT written.");
  try { spd.kill(); } catch {}
  process.exit(4);
}
await send("w boot_a " + bootSrc, 360000, "w boot_a");
const rbB = await readBack("boot_a", 300000);
const okB = rbB && rbB.length === boot.length && rbB.equals(boot);
log("[verify] boot_a read-back: " + (okB ? "MATCH sha256 " + sha(rbB) : "MISMATCH"));
await send("reset", 30000, "reset");
await new Promise((r) => setTimeout(r, 2000));
try { spd.kill(); } catch {}
if (okB) log("[done] written. The device restarts into rooted Android; adb-over-IP listens on port 5555.");
else log("[done] boot_a mismatch - run again with --rollback --backup <dir> to restore the partition.");
