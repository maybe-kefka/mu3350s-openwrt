#!/usr/bin/env node
// Patch the mu300-linux Windows installer (install.ps1) so that it can be driven through
// the root channel of this device instead of Magisk `su`, and so that it runs in a
// PowerShell session with an empty environment (e.g. when started by an agent).
//
// Changes (all idempotent):
//   1. adds RootSock(), a TCP client for the device root shell on 192.168.0.1:4444
//   2. SuDo()        -> RootSock instead of `adb shell "su -c '...'"`
//   3. SuDoToFile()  -> RootSock + adb pull
//   4. $HOME         -> $env:USERPROFILE (PowerShell sets $HOME from the environment)
//   5. the optional `adb shell su -v` progress probe is neutralised (no su on this device)
//
// Usage: node patch-mu300-installer.mjs --installer <path-to-install.ps1> [--dry-run]

import fs from "node:fs";

const argv = process.argv.slice(2);
function take(name, def) { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; }
const file = take("--installer", "");
const dry = argv.includes("--dry-run");
if (!file || !fs.existsSync(file)) { console.error("usage: node patch-mu300-installer.mjs --installer <install.ps1> [--dry-run]"); process.exit(2); }
let s = fs.readFileSync(file, "utf8");
const before = s;
const notes = [];

if (!s.includes("function RootSock")) {
  const lines = [
    "function RootSock([string]$cmd) {",
    "    $client = $null",
    "    try {",
    "        $client = New-Object System.Net.Sockets.TcpClient",
    "        $client.Connect('192.168.0.1', 4444)",
    "        $client.ReceiveTimeout = 3600000",
    "        $stream = $client.GetStream()",
    "        $ms = New-Object System.IO.MemoryStream",
    "        $devcmd = 'export PATH=/sbin:/system/sbin:/system/bin:/system/xbin:/odm/bin:/vendor/bin:$PATH; { ' + $cmd + ' ; } 2>&1; echo __MU300_RC__$?'",
    "        $send = [System.Text.Encoding]::UTF8.GetBytes($devcmd + [char]10)",
    "        $stream.Write($send, 0, $send.Length)",
    "        $stream.Flush()",
    "        $buf = New-Object byte[] 65536",
    "        while ($true) {",
    "            $n = $stream.Read($buf, 0, $buf.Length)",
    "            if ($n -le 0) { break }",
    "            $ms.Write($buf, 0, $n)",
    "            if ([System.Text.Encoding]::UTF8.GetString($ms.ToArray()).Contains('__MU300_RC__')) { break }",
    "        }",
    "        $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())",
    "        $idx = $text.IndexOf('__MU300_RC__')",
    "        if ($idx -ge 0) { $text = $text.Substring(0, $idx) }",
    "        return $text.Replace([string][char]13, '').TrimEnd([char]10)",
    "    } catch { return '' } finally { if ($client) { try { $client.Close() } catch {} } }",
    "}",
    ""
  ].join("\n");
  s = s.replace("function SuDo($cmd) {", lines + "function SuDo($cmd) {");
  notes.push("added RootSock()");
}
const suBefore = s;
s = s.replace(/function SuDo\(\$cmd\) \{\r?\n[\s\S]*?\r?\n\}/, "function SuDo($cmd) {\n    return (RootSock $cmd)\n}");
if (s !== suBefore) notes.push("SuDo -> RootSock");
const sufBefore = s;
s = s.replace(/function SuDoToFile\(\$cmd, \$path\) \{\r?\n[\s\S]*?\r?\n\}/, "function SuDoToFile($cmd, $path) {\n    $dev = '/data/local/tmp/mu300-pull.bin'\n    [void](RootSock \"$cmd > $dev\")\n    Quiet { adb pull $dev \"$path\" } | Out-Null\n    [void](RootSock \"rm -f $dev\")\n}");
if (s !== sufBefore) notes.push("SuDoToFile -> RootSock + adb pull");
if (s.includes("Join-Path $HOME 'mu300-backups'")) {
  s = s.split("Join-Path $HOME 'mu300-backups'").join("Join-Path $env:USERPROFILE 'mu300-backups'");
  s = s.split("Join-Path $HOME '.android'").join("Join-Path $env:USERPROFILE '.android'");
  notes.push("$HOME -> $env:USERPROFILE");
}
if (s.includes("(Quiet { adb shell su -v })")) { s = s.replace("(Quiet { adb shell su -v })", "'socketsu'"); notes.push("neutralised su -v probe"); }

if (notes.length === 0) { console.log("[=] " + file + " is already patched"); process.exit(0); }
if (dry) { console.log("[dry-run] would apply: " + notes.join("; ")); process.exit(0); }
fs.writeFileSync(file + ".orig", before, "utf8");
fs.writeFileSync(file, s, "utf8");
console.log("[ok] patched " + file);
for (const n of notes) console.log("     - " + n);
console.log("     original kept as " + file + ".orig");
