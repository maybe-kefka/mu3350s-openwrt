#!/usr/bin/env node
// F50 root-channel client.
//
// The Android side of the device runs its own Samba service as root; a line in
// /data/samba/etc/smb.conf ("root preexec = /system/bin/sh /data/local/tmp/root.sh")
// makes smbd start /data/local/tmp/root.sh as root whenever a client opens the share.
// root.sh starts `socat TCP-LISTEN:4444,reuseaddr,fork EXEC:/system/bin/sh`, so any
// connection to port 4444 is a root shell on the device.
//
// Usage (Windows host, while Android is running):
//   node f50-root-shell.mjs trigger          # SMB connect -> starts the root shell
//   node f50-root-shell.mjs ping             # trigger if needed, then `id -u`
//   node f50-root-shell.mjs exec "id -u"     # run a command as root, print output
//   node f50-root-shell.mjs send script.sh   # send a script as root (raw shell input)
//
// Options: --host <ip> (default 192.168.0.1)  --port <n>  --timeout <ms>

import net from "node:net";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
function take(name, def) {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
const HOST = take("--host", "192.168.0.1");
const PORT = Number(take("--port", "4444"));
const TIMEOUT = Number(take("--timeout", "180000"));
const mode = argv.shift() || "ping";
const MARK = "__F50_RC__";

function sambaTrigger() {
  const netExe = "C:\\Windows\\System32\\net.exe";
  const share = "\\\\" + HOST + "\\F50";
  for (const a of [["use", share, "/delete", "/y"], ["use", share, "/user:guest", ""]]) {
    try { execFileSync(netExe, a, { encoding: "utf8", timeout: 30000, windowsHide: true }); } catch (_) { }
  }
}

function open() {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: HOST, port: PORT });
    s.setTimeout(TIMEOUT);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
    s.once("timeout", () => { s.destroy(); reject(new Error("timeout")); });
  });
}

async function waitPort(deadlineMs) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try { const s = await open(); s.destroy(); return true; } catch (_) { await new Promise(r => setTimeout(r, 500)); }
  }
  return false;
}

function talk(script, raw) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: HOST, port: PORT });
    let out = "";
    let settled = false;
    const finish = (err) => { if (settled) return; settled = true; try { s.destroy(); } catch (_) { } err ? reject(err) : resolve(out); };
    s.setTimeout(TIMEOUT, () => finish(new Error("timeout waiting for the device")));
    s.on("error", (e) => finish(e));
    s.on("data", (d) => {
      out += d.toString("utf8");
      if (!raw && out.includes(MARK)) {
        const i = out.indexOf(MARK);
        const tail = out.slice(i + MARK.length).split("\n")[0].trim();
        out = out.slice(0, i);
        finish();
      } else if (raw && out.includes("F50-SETUP-DONE")) {
        finish();
      }
    });
    s.on("close", () => finish());
    s.on("connect", () => {
      const text = raw ? script + "\n" : "{ " + script + " ; } 2>&1; echo " + MARK + "$?\n";
      s.write(text);
    });
  });
}

(async () => {
  if (mode === "trigger" || mode === "ping") {
    const already = await waitPort(800);
    if (!already) {
      console.log("[*] triggering the root shell through SMB ...");
      sambaTrigger();
      if (!(await waitPort(25000))) { console.error("[!] port " + PORT + " did not open; is Android running and is Samba on?"); process.exit(2); }
    }
    if (mode === "ping") {
      const out = await talk("id -u; id", false);
      console.log(out.trim());
    } else {
      console.log("[ok] root shell is up on " + HOST + ":" + PORT);
    }
    return;
  }
  if (mode === "exec") {
    const cmd = argv.join(" ");
    if (!cmd) { console.error("usage: node f50-root-shell.mjs exec \"<command>\""); process.exit(2); }
    const out = await talk(cmd, false);
    process.stdout.write(out);
    return;
  }
  if (mode === "send") {
    const file = argv.shift();
    if (!file) { console.error("usage: node f50-root-shell.mjs send <script-file>"); process.exit(2); }
    const out = await talk(fs.readFileSync(file, "utf8"), true);
    process.stdout.write(out);
    return;
  }
  console.error("unknown mode: " + mode);
  process.exit(2);
})().catch((e) => { console.error("[!] " + e.message); process.exit(1); });
