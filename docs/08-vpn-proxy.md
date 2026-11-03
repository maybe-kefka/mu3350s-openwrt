# 08 内置 VPN 代理（mihomo / Clash Meta + TPROXY 分流）

让连接 F50 热点的所有设备自动走订阅节点（国内直连、海外代理），并可在 Web 面板选择节点。
类似 iStoreOS 上的 Nikki：一次配置，客户端零设置。

## 架构

```
WiFi/USB 客户端 (192.168.77.x)
   │  DHCP → dnsmasq (192.168.77.1)
   │  DNS  → nftables redirect 53 → mihomo DNS :1053 (fake-ip)
   │  TCP/UDP → nftables TPROXY → mihomo :7895
   ▼
mihomo (Clash Meta v1.19.33)
   ├─ proxy-providers: 订阅节点（自动更新，44 个节点）
   ├─ proxy-groups: Proxy(select) / Auto(url-test 自动测速)
   ├─ rules: LAN 直连 / CN CIDR 直连 / CN 域名直连 / 其余走节点
   └─ 出口: sipa_eth0（5G）→ 节点服务器
```

路由器自身流量**不走代理**（只处理来自 `br-lan` 的转发流量），避免影响 F50 的 5G 管理与系统更新。

## 关键组件（设备上）

| 路径 | 作用 |
|---|---|
| `/usr/bin/mihomo` | mihomo v1.19.33 linux-arm64 静态二进制（57 MB） |
| `/etc/mihomo/config.yaml` | 订阅、分组、规则、DNS、TPROXY 配置 |
| `/etc/mihomo/tproxy.nft` | nftables 规则（prerouting mangle + dns dstnat） |
| `/etc/mihomo/apply-tproxy.sh` | 启停时应用/清理 TPROXY 规则与策略路由 |
| `/etc/init.d/mihomo` | procd 服务，开机自启（S95） |
| `/etc/mihomo/ui/` | metacubexd 面板静态文件 |
| `/etc/mihomo/providers/milou.yaml` | 订阅节点缓存 |
| `/etc/mihomo/ruleset/*.yaml` | 分流规则集（cncidr / direct / lan） |

## 面板（选节点）

- 浏览器打开 **http://192.168.77.1:9090/ui/**（需先连 F50 热点或 USB 网络）
- 密码（secret）：**`YOUR_SECRET`**
- **Proxy** 组内点选节点即可立即生效；**Auto** 组自动测速选最快
- 选择会持久化（`profile.store-selected: true`），重启后保留

## 分流规则

```yaml
rules:
  - RULE-SET,lan,DIRECT      # 私有网段直连
  - RULE-SET,cncidr,DIRECT   # 中国 IP 直连
  - RULE-SET,direct,DIRECT   # 中国域名直连（fake-ip 域名匹配）
  - MATCH,Proxy              # 其它全部走节点
```

规则集来自 `Loyalsoldier/clash-rules`（jsDelivr），每天自动更新。

## 关键 nftables 规则（易错点）

```nft
table inet mihomo {
  chain prerouting { type filter hook prerouting priority mangle; policy accept;
    iifname != "br-lan" return          # 只处理 LAN 转发流量
    ip daddr 192.168.77.0/24 return     # 本地网段直连（含路由器服务）
    ip daddr { 127.0.0.0/8, 255.255.255.255 } return
    ip daddr 224.0.0.0/4 return
    udp dport { 67, 68 } return         # 必须放行 DHCP，否则客户端拿不到 IP
    udp sport { 67, 68 } return
    meta l4proto tcp meta mark set 1 tproxy to :7895
    meta l4proto udp meta mark set 1 tproxy to :7895
  }
  chain dns { type nat hook prerouting priority dstnat; policy accept;
    iifname != "br-lan" return
    udp dport 53 redirect to :1053
    tcp dport 53 redirect to :1053
  }
}
```

策略路由（`apply-tproxy.sh` 负责）：

```sh
ip rule add fwmark 0x1 lookup 100
ip route add local 0.0.0.0/0 dev lo table 100
```

**踩坑记录**：最初 TPROXY 规则没有排除 DHCP（UDP 67/68），导致客户端连上 WiFi 后拿不到 IP，
表现为手机「正在连接…超时放弃」。加入 67/68 与广播地址排除后正常。

## 其他系统改动

- 关闭 LAN IPv6（防泄漏）：`dhcp.lan.ra/dhcpv6/ndp=disabled`，`odhcpd` 停止并禁用，
  `firewall` 增加 `Block-LAN-IPv6`（src lan, family ipv6, DROP）
- 关闭软件流量卸载（flow offloading），避免绕过 TPROXY
- `br-lan` 上不跑 DNS 代理：设备自身的 `/etc/resolv.conf` 仍走运营商 DNS（真实 IP），
  只有客户端 DNS 被重定向到 mihomo（fake-ip）

## TUN 模式为何放弃

本机内核（mu300 7.3.1）上 mihomo 的 TUN `auto-route` 能建接口、能收到 UDP，
但 TCP 转发到 tun 后 mihomo 收不到包（webget 直接 EPERM / 连接被拒），
连带热点客户端全部无法上网。改用内核原生 **TPROXY**（`CONFIG_NFT_TPROXY=y`）后一切正常。

## 验证结果（设备内模拟客户端 + 真实手机）

| 项目 | 结果 |
|---|---|
| DHCP 获取 IP | 192.168.77.185 ✓ |
| DNS fake-ip | www.google.com → 198.18.0.41 ✓ |
| 国内直连 | baidu 200，日志 `RuleSet(cncidr) using DIRECT` ✓ |
| 海外代理 | google 200/302，日志 `using Proxy[...]` ✓ |
| 出口 IP | 节点 IP（如 95.40.2.191 / 42.200.230.24）✓ |
| 真实手机 | OPPO Find X9 Ultra（192.168.77.195）正常上网 ✓ |
| 重启持久化 | 断电重连后热点、代理、规则全部自动恢复 ✓ |

## 常用操作

```sh
/etc/init.d/mihomo stop      # 临时关闭代理（热点变回直连）
/etc/init.d/mihomo start     # 重新开启
/etc/init.d/mihomo restart   # 改了 config.yaml 后重启
```

改配置：`/etc/mihomo/config.yaml` → `mihomo restart`。
想看实时连接日志：`logread -e mihomo -f`。

## 在 U30 Air（OpenWrt 25.12.6 / 内核 7.3.1）上安装（2026-11-03 实测通过）

Linux 侧只有一条内置 eMMC 上的 8 GiB 区域，没有 TF 卡；deploy 方式与 F50 相同，差别只有 LAN 网段
（`192.168.78.0/24`）和设备串号前缀（`MU300LINUX-…`）。

```powershell
node scripts/install-mihomo.mjs --sub "https://…/link/…?clashmeta=1" --secret "change-me"
# F50: 加 --lan-cidr 192.168.77.0/24；GitHub 被墙时默认 --mirror https://gh-proxy.com
```

脚本完成的事情：

- 下载 mihomo arm64（v1.19.x）+ metacubexd，安装到 `/usr/bin/mihomo`、`/etc/mihomo/{config.yaml,ui}`
- 写 `/etc/mihomo/tproxy.nft`（`br-lan` 的 TCP/UDP → 7895，DNS 53 → 1053）与 `apply-tproxy.sh`（fwmark 0x1 + table 100）
- 安装 `/etc/init.d/mihomo`（S95，procd respawn）并 enable
- dnsmasq：`server=127.0.0.1#1053` + `noresolv=1`，fake-ip（`198.18.0.0/16`）
- 规则集走 `gh-proxy.com` 镜像（国内拉不到 jsdelivr 时更稳）

实测（客户端 = USB 网络的 192.168.78.200）：

| 请求 | 结果 | mihomo 日志命中 |
|---|---|---|
| google.com/generate_204 | 204 | `Match → Proxy[香港-SDWAN]` |
| youtube.com | 200 | `Match → Proxy` |
| github.com | 200 | `Match → Proxy` |
| baidu.com | 200 | `RuleSet(cncidr) using DIRECT` |

面板：`http://192.168.78.1:9090/ui/`（API 端口 9090，secret 为安装参数）。

> 注意：USB 网卡会拿到设备的默认网关（`192.168.78.1`），电脑会优先走 5G；不想要时拔 USB 或调整网卡优先级。

