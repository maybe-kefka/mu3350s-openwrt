# ZTE F50 / MU3350S — OpenWrt on the SD card with Android dual-boot

> 中兴 F50（型号 **MU3350S**，展锐 **UMS9620 / T760**）eSIM 版：保留原厂 Android 与 eSIM/5G，
> 把 **OpenWrt** 安装到 TF 卡，实现 Android / OpenWrt 双系统启动，并内置 **Clash Meta (mihomo) 透明代理**，
> 让连接热点的所有设备自动走机场订阅节点。

This repository documents a **complete, working procedure** to install OpenWrt on the
ZTE F50 / MU3350S (Unisoc UMS9620) while keeping the stock Android + eSIM, plus a built-in
mihomo/TPROXY split-routing VPN for hotspot clients.

- ✅ 已在真机上完成并验证（2026-11-02，F50_ST_ESIMV1.0.0B04，纯 eSIM 版）
- ⚠️ 仅针对该机型该固件；其他版本请先完整备份并自行评估
- 📦 本仓库**不包含**任何厂商固件/二进制：补丁镜像由脚本从你自己的分区备份生成

---

## 特性 / Features

| | |
|---|---|
| 双系统 | Android（eMMC a 槽）保持原样，OpenWrt 跑在 TF 卡（b 槽引导），默认启动 OpenWrt，5 次失败自动回 Android |
| 免 Magisk root | 利用 ZTE 自带 Samba 服务的 `root preexec` 获得持久的 root 执行通道（`192.168.0.1:4444`） |
| TrustOS AVB 绕过 | 离线生成 B04 专用补丁版 trustos（与官方 B03 root 包结构一致，SHA-256 可复现） |
| OpenWrt | 25.12.6（LuCI），主线内核 7.3.1，TF 卡 ext4（约 237 GiB 可用） |
| 5G / eSIM | 完全保留，OpenWrt 通过内置 5G 上网 |
| WiFi | 继承原厂热点名/密码（5 GHz），可自定义 |
| 内置代理 | mihomo + nftables TPROXY + fake-ip DNS：国内直连、海外走订阅节点；热点/USB 客户端零配置 |
| 节点选择 | 内置 metacubexd 面板（`http://192.168.77.1:9090/ui/`），可选节点、看连接、自动测速 |
| 回滚 | 完整分区备份 + 展锐 FDL 直连刷回原厂 |

## 架构

```
        TF card (256 GB)                          eMMC (64 GB)
  ┌──────────────────────────┐          ┌──────────────────────────┐
  │ ext4  mu300sd            │          │ a 槽: Android 13 (B04)   │
  │  ├─ OpenWrt 根文件系统    │  引导     │ b 槽: Linux boot 镜像     │
  │  ├─ /etc/mihomo (代理)    │ ◄──────► │ misc: bootloader_control │
  │  └─ .mu300/ (引导状态)    │          │ trustos: AVB 补丁版       │
  └──────────────────────────┘          └──────────────────────────┘

  客户端 ──WiFi/USB──► br-lan 192.168.77.1 ──nft TPROXY──► mihomo ──► 5G (sipa) ──► 节点
```

## 快速开始（复现指南）

### 0. 准备

- Windows PC（本项目脚本以 Windows 为主）、USB 数据线
- Python 3.8+（`lz4` 模块，安装器会自动装）
- [mu300-linux](https://github.com/dikeckaan/mu300-linux) 源码（安装器）
- 展锐 FDL 工具（如 [spreadtrum_flash](https://github.com/TomKing062/spreadtrum_flash) / `spd_dump`）与 SPRD 串口驱动
- **先完整备份所有关键分区**（见 [docs/02](docs/02-backup-and-recovery.md)）

### 1. 备份原厂分区

```bat
spd_dump.exe --wait 300 --kickto 2 exec path C:\f50-work\backup1 r splloader r trustos_a r sml_a r boot_a ... reset
```

### 2. 生成补丁版 TrustOS（离线，可复现）

```bash
node scripts/gen-trustos-patched.mjs --backup C:\f50-work\backup1 --out trustos_a_patched_merged.bin
# 期望 sha256: 3dbf07e20e123c25944615d2220964052f15c43dc045f8c81a0899daa85d5b30
```

### 3. 取得 root 通道（无需 Magisk）

```bash
# 把 socat 推到设备 /data/local/tmp/socat，然后：
node scripts/f50-root-shell.mjs trigger        # 通过 SMB 触发 root preexec
node scripts/setup-device-root.mjs             # 部署 su 兼容层 / adb TCP / 持久化
```

原理与安全说明见 [docs/04](docs/04-root-channel.md)。

### 4. 写入补丁版 trustos + 安装 OpenWrt

```powershell
# 设备端（root 通道内）:
# dd if=/sdcard/DCIM/trustos_a_patched_merged.bin of=/dev/block/by-name/trustos_a bs=1M && sync

# 主机端：给安装器打补丁并运行
node scripts/patch-mu300-installer.mjs --installer C:\f50-work\mu300-src\install.ps1
powershell -ExecutionPolicy Bypass -File scripts\installer\install-openwrt.ps1 -SrcDir C:\f50-work\mu300-src
```

### 5. 切换系统

```
OpenWrt → Android:  scripts\F50-切到Android.cmd   （或设备上 mu300-next-boot android && reboot）
Android → OpenWrt:  scripts\F50-切到OpenWrt.cmd
```

### 6. （可选）内置代理

见 [docs/08](docs/08-vpn-proxy.md)，或直接把 `scripts/proxy/` 下的文件部署到设备 `/etc/mihomo/`。

## 目录结构

```
mu3350s-openwrt/
├─ docs/                      完整文档（设备信息/备份/AVB/root/安装/双系统/时间线/代理）
├─ scripts/
│  ├─ gen-trustos-patched.mjs 生成 B04 补丁版 trustos
│  ├─ f50-root-shell.mjs      root 通道客户端（SMB 触发 + TCP 4444）
│  ├─ setup-device-root.mjs   在 Android 上部署/恢复 root 通道与 su 兼容层
│  ├─ patch-mu300-installer.mjs  给官方安装器打补丁
│  ├─ installer/              Windows 安装器一键封装
│  ├─ proxy/                  mihomo 配置示例、nftables 规则、启动脚本
│  ├─ device/                 设备端 root 通道脚本
│  └─ F50-切到*.ps1/.cmd      双系统切换（可配置路径）
├─ answers/                   mu300 安装器答案模板
├─ artifacts/                 分区备份 SHA-256 清单
└─ notes/                     验证记录（脱敏）
```

## 文档

| 文档 | 内容 |
|---|---|
| [01 设备信息](docs/01-device.md) | 硬件、固件、USB 模式 |
| [02 备份与恢复](docs/02-backup-and-recovery.md) | 分区清单、FDL 刷回 |
| [03 TrustOS AVB 绕过](docs/03-trustos-avb-bypass.md) | 4 字节补丁、合并算法、可复现哈希 |
| [04 Root 通道](docs/04-root-channel.md) | Samba root preexec、su 兼容层、安全注意 |
| [05 OpenWrt 安装](docs/05-openwrt-install.md) | 安装器改造、无人值守答案、过程 |
| [06 双系统切换](docs/06-dual-boot-switching.md) | misc bootloader_control、切换命令 |
| [07 时间线与经验](docs/07-timeline-and-findings.md) | 走过的弯路、关键发现 |
| [08 内置代理](docs/08-vpn-proxy.md) | mihomo + TPROXY + fake-ip 分流、面板 |
| [09 日常使用](docs/09-quickstart.md) | 切换/访问/维护/排障速查 |

## 与 [mu300-linux](https://github.com/dikeckaan/mu300-linux) 的关系

**mu300-linux 是安装器/系统层，不是 root 工具**。它的 README 明确写着：
*Rooting, unlocking, patching and recovery are not part of this project.*
安装器默认你的设备**已经 root**（有 Magisk 的 `su`），并且 boot chain 已经能启动未签名内核。

对一台**锁 BL、没 root、B04 eSIM 固件的出厂 MU3350S**，直接跑 mu300-linux 会在 `pull` 阶段失败：

```
/system/bin/sh: su: inaccessible or not found
```

本项目补上的正是它不负责的前置环节：

| 环节 | mu300-linux | 本项目额外做的 |
|---|---|---|
| Root | 假定已有 Magisk `su` | 利用 ZTE Samba `root preexec` 取得 root，无需 Magisk；带 su 兼容层、adbd TCP、重启自动恢复 |
| 锁 BL 启动 Linux | 明确不负责 AVB/解锁 | 离线生成 **B04 专用 TrustOS AVB 绕过镜像**（只取官方 B03 包里 4 字节补丁的规律，用本机 sml_a + trustos_a 重新合成，SHA-256 可复现） |
| 安装器跑法 | 假设 USB adb + `su` | RootSock 替换 SuDo/SuDoToFile、修 `$HOME`、禁用自更新与 USB 模式切换，走 TCP adb + root socket |
| eSIM / 5G | 安装器不刷 modem | 不刷 B09、不换 Magisk boot，boot_a 保持原厂，eSIM 与 5G 完整保留 |
| 双系统操作 | 提供 `mu300-next-boot` / `mu300-os` | 补上 Android↔OpenWrt 一键切换脚本、misc 32 字节状态备份/恢复、失败回退验证 |
| 代理/VPN | 有独立模块 [mu300-linux-vpn](https://github.com/dikeckaan/mu300-linux-vpn)（Xray/sing-box/mihomo 引擎、订阅、kill switch、面板） | 本项目给的是**自建轻量方案**：mihomo + nftables TPROXY + fake-ip DNS + metacubexd 面板，并修复了 DHCP 被 TPROXY 拦截、LAN IPv6 泄漏等细节；两种方案可二选一 |

**一句话**：设备如果已经是 root/解锁状态，mu300-linux 可以直接用；
而锁 BL 的 B04 eSIM 出厂机，需要本项目这套 root + AVB 补丁 + 安装器适配之后，才能用上 mu300-linux 的安装器。

## 已验证项目

| 检查 | 结果 |
|---|---|
| Android 原 boot_a 未改动 | sha256 = `59c365b0…`（与备份一致） |
| trustos_a 为补丁版 | 前 5,178,856 B sha256 = `3dbf07e2…` |
| Android / OpenWrt 双向切换 | 实测通过，切换后重启仍进 OpenWrt |
| OpenWrt | 25.12.6 / 内核 7.3.1 / LuCI 200 / SSH 22 |
| 5G 上网 | ping 通、HTTP 200 |
| 热点客户端 | 真实手机 + USB 客户端正常上网（经代理） |
| 代理分流 | 国内直连 / 海外走节点，出口为节点 IP |
| 重启持久化 | 断电重连后热点与代理自动恢复 |

## 安全与合规

- **仅供本人设备研究使用**。请勿用于未授权设备。
- Samba `root preexec`、adb over USB 等属于对设备固件特性的利用；使用后建议移除相关文件并恢复默认。
- 本仓库不附带厂商固件、签名数据或可执行破解物；trustos 补丁由用户从自己的备份生成。
- 刷机有风险，可能导致设备无法开机、数据丢失或失去保修。请先完成完整备份。

## 致谢

- [mu300-linux](https://github.com/dikeckaan/mu300-linux)：OpenWrt/Ubuntu 安装器、内核与引导方案
- [spreadtrum_flash](https://github.com/TomKing062/spreadtrum_flash)：`bsp_cve_2img` / `dhtb_data_size` 参考
- [mihomo](https://github.com/MetaCubeX/mihomo) / [metacubexd](https://github.com/MetaCubeX/metacubexd)：代理内核与面板
- [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)：分流规则集

## License

MIT（见 [LICENSE](LICENSE)）。文档与脚本可自由参考/修改/分发，请保留出处。

---

### English TL;DR

Install OpenWrt (LuCI, kernel 7.3) on the TF card of a ZTE F50 / MU3350S (Unisoc UMS9620)
while keeping stock Android + eSIM. Root is obtained without Magisk through the vendor Samba
`root preexec`, a patched TrustOS disables AVB so unsigned Linux images boot, and the mu300-linux
installer is patched to use the root channel instead of `su`. A built-in mihomo/TPROXY setup routes
hotspot clients through a Clash-Meta subscription with rule-based split routing and a web dashboard.
Everything is reversible with FDL flash mode and full partition backups.
