#!/usr/bin/env node
// Install mihomo (Clash Meta) + metacubexd + nftables TPROXY on a mu300-linux OpenWrt device
// (U30 Air verified; same idea works on the F50, only --lan-cidr differs).
//
// Usage:
//   node scripts/install-mihomo.mjs --sub "https://provider/link/xxx?clashmeta=1" \
//        --secret "change-me" [--serial MU300LINUX-...] [--lan-cidr 192.168.78.0/24] \
//        [--mirror https://gh-proxy.com] [--adb adb] [--skip-ui]
//
// What it does, over adb (USB or TCP):
//   1. downloads mihomo arm64 (GitHub release, via a mirror when GitHub is blocked) and metacubexd
//   2. writes /etc/mihomo/{config.yaml,tproxy.nft,apply-tproxy.sh,ui/}, /usr/bin/mihomo, /etc/init.d/mihomo
//   3. points dnsmasq at mihomo DNS (127.0.0.1#1053) and enables the service (S95mihomo)
//   4. starts it and verifies: proxy HTTP 204, API delay of the Auto group
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
function take(name, def) { const i = argv.indexOf(name); if (i < 0) return def; const v = argv[i + 1]; argv.splice(i, 2); return v; }
const SUB = take("--sub", "");
const SECRET = take("--secret", "mihomo-secret");
const SERIAL = take("--serial", "");
const LAN = take("--lan-cidr", "192.168.78.0/24");
const MIRROR = take("--mirror", "https://gh-proxy.com");
const ADB = take("--adb", "adb");
const SKIP_UI = argv.includes("--skip-ui");
const MIHOMO_VER = take("--mihomo-version", "v1.19.33");
const UI_VER = take("--ui-version", "v1.274.3");
if (!SUB) { console.error("usage: node install-mihomo.mjs --sub <subscription-url> [--secret ...]"); process.exit(2); }

const run = (args, opts = {}) => execFileSync(ADB, args, { encoding: "utf8", timeout: 300000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...opts });
const sh = (cmd) => run(["-s", serial, "shell", cmd]);
let serial = SERIAL;
if (!serial) {
  const out = run(["devices"]);
  const m = out.split(/\r?\n/).find((l) => /^MU300LINUX\S+\s+device/.test(l));
  if (!m) { console.error("no MU300LINUX adb device found (USB adb of the Linux side). Pass --serial."); process.exit(2); }
  serial = m.split(/\s+/)[0];
}
console.log("[device] " + serial);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mu300-mihomo-"));
async function download(url, out) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length < 50000) throw new Error("too small: " + b.length);
      fs.writeFileSync(out, b);
      return;
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
const gh = (repo, file) => MIRROR.replace(/\/$/, "") + "/https://github.com/" + repo + "/releases/download/" + file;
console.log("[download] mihomo " + MIHOMO_VER);
await download(gh("MetaCubeX/mihomo", MIHOMO_VER + "/mihomo-linux-arm64-" + MIHOMO_VER + ".gz"), path.join(tmp, "mihomo.gz"));
const bin = zlib.gunzipSync(fs.readFileSync(path.join(tmp, "mihomo.gz")));
fs.writeFileSync(path.join(tmp, "mihomo"), bin);
if (bin.readUInt32BE(0) !== 0x7f454c46 || bin.readUInt16LE(18) !== 183) { console.error("downloaded file is not an aarch64 ELF"); process.exit(3); }
console.log("[download] mihomo " + bin.length + " B (aarch64)");

const cfg = [
  "# mihomo (Clash Meta) - installed by mu3350s-openwrt/scripts/install-mihomo.mjs",
  "mixed-port: 7890",
  "tproxy-port: 7895",
  "allow-lan: true",
  "bind-address: \"*\"",
  "mode: rule",
  "log-level: info",
  "ipv6: false",
  "",
  "external-controller: 0.0.0.0:9090",
  "secret: \"" + SECRET + "\"",
  "external-ui: /etc/mihomo/ui",
  "",
  "profile:",
  "  store-selected: true",
  "  store-fake-ip: true",
  "unified-delay: true",
  "tcp-concurrent: true",
  "tun:",
  "  enable: false",
  "",
  "dns:",
  "  enable: true",
  "  ipv6: false",
  "  listen: 0.0.0.0:1053",
  "  enhanced-mode: fake-ip",
  "  fake-ip-range: 198.18.0.1/16",
  "  fake-ip-filter:",
  "    - \"*.lan\"",
  "    - \"*.local\"",
  "    - \"+.msftconnecttest.com\"",
  "    - \"+.msftncsi.com\"",
  "  default-nameserver:",
  "    - 223.5.5.5",
  "    - 119.29.29.29",
  "  nameserver:",
  "    - https://dns.alidns.com/dns-query",
  "    - https://doh.pub/dns-query",
  "    - 223.5.5.5",
  "    - 119.29.29.29",
  "",
  "proxy-providers:",
  "  provider:",
  "    type: http",
  "    url: \"" + SUB + "\"",
  "    interval: 3600",
  "    path: ./providers/provider.yaml",
  "    health-check:",
  "      enable: true",
  "      url: https://www.gstatic.com/generate_204",
  "      interval: 300",
  "",
  "proxy-groups:",
  "  - name: Proxy",
  "    type: select",
  "    use: [provider]",
  "    proxies: [Auto, DIRECT]",
  "  - name: Auto",
  "    type: url-test",
  "    use: [provider]",
  "    url: https://www.gstatic.com/generate_204",
  "    interval: 300",
  "    tolerance: 50",
  "",
  "rule-providers:",
  "  lan:",
  "    type: http",
  "    behavior: ipcidr",
  "    url: https://gh-proxy.com/https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/lancidr.txt",
  "    path: ./ruleset/lan.yaml",
  "    interval: 86400",
  "  cncidr:",
  "    type: http",
  "    behavior: ipcidr",
  "    url: https://gh-proxy.com/https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/cncidr.txt",
  "    path: ./ruleset/cncidr.yaml",
  "    interval: 86400",
  "  direct:",
  "    type: http",
  "    behavior: domain",
  "    url: https://gh-proxy.com/https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/direct.txt",
  "    path: ./ruleset/direct.yaml",
  "    interval: 86400",
  "",
  "rules:",
  "  - RULE-SET,lan,DIRECT",
  "  - RULE-SET,cncidr,DIRECT",
  "  - RULE-SET,direct,DIRECT",
  "  - MATCH,Proxy",
  ""
].join("\n");
fs.writeFileSync(path.join(tmp, "config.yaml"), cfg, "utf8");

const tproxy = [
  "table inet mihomo {",
  "  chain prerouting {",
  "    type filter hook prerouting priority mangle; policy accept;",
  "    iifname != \"br-lan\" return",
  "    ip daddr " + LAN + " return",
  "    ip daddr { 127.0.0.0/8, 255.255.255.255 } return",
  "    ip daddr 224.0.0.0/4 return",
  "    udp dport { 67, 68 } return",
  "    udp sport { 67, 68 } return",
  "    meta l4proto tcp meta mark set 1 tproxy to :7895",
  "    meta l4proto udp meta mark set 1 tproxy to :7895",
  "  }",
  "  chain dns {",
  "    type nat hook prerouting priority dstnat; policy accept;",
  "    iifname != \"br-lan\" return",
  "    udp dport 53 redirect to :1053",
  "    tcp dport 53 redirect to :1053",
  "  }",
  "}",
  ""
].join("\n");
fs.writeFileSync(path.join(tmp, "tproxy.nft"), tproxy, "utf8");
const apply = ["#!/bin/sh", "case \"$1\" in", "start)",
  "  ip rule show | grep -q \"fwmark 0x1 lookup 100\" || ip rule add fwmark 0x1 lookup 100",
  "  ip route show table 100 2>/dev/null | grep -q \"local 0.0.0.0/0\" || ip route add local 0.0.0.0/0 dev lo table 100",
  "  nft delete table inet mihomo 2>/dev/null",
  "  nft -f /etc/mihomo/tproxy.nft", "  ;;", "stop)",
  "  nft delete table inet mihomo 2>/dev/null",
  "  ip rule del fwmark 0x1 lookup 100 2>/dev/null",
  "  ip route flush table 100 2>/dev/null", "  ;;", "esac", "exit 0", ""].join("\n");
fs.writeFileSync(path.join(tmp, "apply-tproxy.sh"), apply, "utf8");
const initd = ["#!/bin/sh /etc/rc.common", "USE_PROCD=1", "START=95", "STOP=10", "", "PROG=/usr/bin/mihomo", "CONF=/etc/mihomo/config.yaml", "",
  "start_service() {", "  /etc/mihomo/apply-tproxy.sh start", "  procd_open_instance",
  "  procd_set_param command \"$PROG\" -d /etc/mihomo -f \"$CONF\"",
  "  procd_set_param respawn 3600 5 0", "  procd_set_param stdout 1", "  procd_set_param stderr 1",
  "  procd_set_param limits core=\"unlimited\" nofile=\"65535\"",
  "  procd_set_param env TZ=Asia/Shanghai", "  procd_close_instance", "}", "",
  "stop_service() {", "  /etc/mihomo/apply-tproxy.sh stop", "}", "",
  "service_triggers() {", "  procd_add_reload_trigger \"network\"", "}", ""].join("\n");
fs.writeFileSync(path.join(tmp, "init.d-mihomo"), initd, "utf8");

const sh2 = (cmd) => run(["-s", serial, "shell", cmd]);
sh2("mkdir -p /etc/mihomo/providers /etc/mihomo/ruleset /etc/mihomo/ui");
run(["-s", serial, "push", path.join(tmp, "mihomo"), "/tmp/mihomo"]);
run(["-s", serial, "push", path.join(tmp, "config.yaml"), "/tmp/config.yaml"]);
run(["-s", serial, "push", path.join(tmp, "tproxy.nft"), "/tmp/tproxy.nft"]);
run(["-s", serial, "push", path.join(tmp, "apply-tproxy.sh"), "/tmp/apply-tproxy.sh"]);
run(["-s", serial, "push", path.join(tmp, "init.d-mihomo"), "/tmp/init.d-mihomo"]);
console.log(sh2("cp -f /tmp/mihomo /usr/bin/mihomo && chmod 755 /usr/bin/mihomo && /usr/bin/mihomo -v"));
console.log(sh2("cp -f /tmp/config.yaml /etc/mihomo/config.yaml && cp -f /tmp/tproxy.nft /etc/mihomo/tproxy.nft && cp -f /tmp/apply-tproxy.sh /etc/mihomo/apply-tproxy.sh && chmod 755 /etc/mihomo/apply-tproxy.sh && cp -f /tmp/init.d-mihomo /etc/init.d/mihomo && chmod 755 /etc/init.d/mihomo && rm -f /tmp/mihomo /tmp/config.yaml /tmp/tproxy.nft /tmp/apply-tproxy.sh /tmp/init.d-mihomo && echo INSTALL-OK"));

if (!SKIP_UI) {
  console.log("[download] metacubexd " + UI_VER);
  await download(gh("MetaCubeX/metacubexd", UI_VER + "/compressed-dist.tgz"), path.join(tmp, "ui.tgz"));
  run(["-s", serial, "push", path.join(tmp, "ui.tgz"), "/tmp/ui.tgz"]);
  console.log(sh2("rm -rf /etc/mihomo/ui/* && tar -xzf /tmp/ui.tgz -C /etc/mihomo/ui && rm -f /tmp/ui.tgz && ls /etc/mihomo/ui | head -3"));
}

console.log(sh2("if ! uci get dhcp.@dnsmasq[0].server 2>/dev/null | grep -q 127.0.0.1; then uci add_list dhcp.@dnsmasq[0].server=127.0.0.1#1053; fi; uci set dhcp.@dnsmasq[0].noresolv=1; uci commit dhcp; /etc/init.d/dnsmasq restart >/dev/null 2>&1; echo DNSMASQ-OK"));
console.log(sh2("/etc/init.d/mihomo enable; /etc/init.d/mihomo restart >/dev/null 2>&1; sleep 12; /etc/init.d/mihomo status 2>&1 | head -2; pgrep -f \"/usr/bin/mihomo\" >/dev/null && echo RUNNING"));
console.log(sh2("curl -s -o /dev/null -w 'proxy-http=%{http_code}\n' --max-time 20 -x http://127.0.0.1:7890 https://www.gstatic.com/generate_204"));
console.log(sh2("curl -s --max-time 20 -H 'Authorization: Bearer " + SECRET + "' 'http://127.0.0.1:9090/proxies/Auto/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=8000'"));
console.log("[done] panel: http://<device-lan-ip>:9090/ui/  (API <ip>:9090, secret " + SECRET + ")");
