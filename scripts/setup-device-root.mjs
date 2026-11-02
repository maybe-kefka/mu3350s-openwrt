#!/usr/bin/env node
// Host wrapper: set up (or re-apply) the root channel on a running Android side.
// It triggers the root shell through Samba if needed, checks for socat, sends the
// device-side setup script (scripts/device/setup-device-root.sh) and verifies it.
//
// Usage: node setup-device-root.mjs

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootShell = path.join(here, "f50-root-shell.mjs");
const deviceScript = path.join(here, "device", "setup-device-root.sh");

function run(args) {
  return execFileSync(process.execPath, [rootShell, ...args], { encoding: "utf8", timeout: 120000 });
}

try { run(["trigger"]); } catch (e) { console.error("[!] cannot open the root shell: " + e.message); process.exit(1); }
const socat = run(["exec", "[ -x /data/local/tmp/socat ] && echo SOCAT-OK || echo SOCAT-MISSING"]).trim();
if (!socat.includes("SOCAT-OK")) {
  console.error("[!] /data/local/tmp/socat is missing on the device.");
  console.error("    Push a static arm64 socat there first, e.g.:");
  console.error("      adb push <extracted UFI-TOOLS apk>/assets/shell/socat /data/local/tmp/socat");
  console.error("    (see docs/04-root-channel.md for where that binary comes from)");
  process.exit(2);
}
const out = run(["send", deviceScript]);
process.stdout.write(out);
if (!out.includes("F50-SETUP-DONE")) { console.error("[!] setup did not report F50-SETUP-DONE"); process.exit(3); }
const verify = run(["exec", "id; /odm/bin/su -c 'id -u'"]).trim();
console.log(verify);
