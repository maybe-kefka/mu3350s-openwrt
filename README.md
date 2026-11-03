# ZTE F50 / MU3350S & U30 Air — OpenWrt 双系统 + mihomo 透明代理

> 展锐 **UMS9620 / T760** 平台中兴随身 WiFi 的完整改造记录：保留原厂 Android，把 **OpenWrt**
> 装成第二系统（F50 装 TF 卡；U30 Air 装收缩出的内置 eMMC 区域），默认从 Linux 启动、
> 连续启动失败自动回 Android；内置 **mihomo + nftables TPROXY** 透明代理，热点 / USB 客户端零配置分流。

A complete, reproducible procedure for two ZTE UMS9620 MiFi models: OpenWrt dual-boot with the
stock Android kept, plus a built-in mihomo / TPROXY split-routing proxy for hotspot clients.

- ✅ **F50 / MU3350S** 真机验证：2026-11-02，`F50_ST_ESIMV1.0.0B04`（纯 eSIM）
- ✅ **U30 Air** 真机验证：2026-11-03，`U30AirV1.0.0B33`（32 GB 版，无卡槽）
- ⚠️ 仅针对上述机型/固件；其他版本请先完整备份并自行评估
- 📦 本仓库**不含**厂商固件或二进制：补丁镜像由脚本从你自己的分区备份生成，root 包请自行准备并核对哈希

---

## 支持机型与安装路径

| 机型 | 已验证固件 | 安装位置 | 入口文档 |
|---|---|---|---|
| ZTE F50 / MU3350S（eSIM） | `F50_ST_ESIMV1.0.0B04` | TF 卡 ext4（label `mu300sd`），**不改 Android 数据** | [docs/01](docs/01-device.md)–[09](docs/09-quickstart.md) |
| ZTE U30 Air（32 GB，无卡槽） | `U30AirV1.0.0B33` | 内置 eMMC：收缩 userdata 划出 **8 GiB**（**会清 Android 数据**，实验性） | **[docs/10](docs/10-u30-air.md)** |

两条路径的差别只在“怎么拿到 root / Linux 放哪里”；Samba root 通道、安装器补丁、mihomo 方案两边完全复用。

## 特性

| 能力 | F50 / MU3350S | U30 Air（B33） |
|---|---|---|
| 双系统 | Android 在 a 槽不动；Linux 跑 TF 卡，b 槽引导；默认 Linux，5 次失败回 Android | 同左，但 Linux 在内置 eMMC 的 `mu300root` 区域 |
| 免 Magisk root | 开机 ADB 窗口 → Samba `root preexec` | **BROM 刷 one-key-root 包**（自带无线 ADB）→ Samba `root preexec` |
| 锁 BL 启动 Linux | 离线生成 B04 专用 TrustOS AVB 补丁（SHA-256 可复现） | 第三方 root 包内的 patched trustos + Magisk boot（刷前核对哈希/解包审计） |
| OpenWrt | 25.12.6（LuCI）+ 主线内核 7.3.1 | 同左 |
| 存储 | TF 卡约 237 GiB | 内置 eMMC 8 GiB（userdata 15.3 GiB 留给 Android） |
| 5G | 原厂 eSIM / 5G 保留，Linux 经 `sipa_eth0` 上网 | 同左 |
| WiFi 热点 | 继承原厂热点名/密码（5 GHz），可自定义 | 同左 |
| 内置代理 | mihomo + TPROXY + fake-ip DNS；国内直连、海外走订阅节点 | 同左（[一键安装脚本](scripts/install-mihomo.mjs)） |
| 面板 | metacubexd：`http://192.168.77.1:9090/ui/` | `http://192.168.78.1:9090/ui/` |
| 回滚 | 完整分区备份 + 展锐 FDL 刷回 | 73 分区备份（5.3 GB）+ FDL 刷回 |

## 架构

**F50 / MU3350S（TF 卡）**

```
  TF card ext4 (mu300sd)                 eMMC (64 GB)
  ┌──────────────────────┐      ┌────────────────────────────────┐
  │ OpenWrt rootfs       │      │ a 槽: Android 13（原厂，未动）  │
  │ /etc/mihomo          │ 引导  │ b 槽: Linux boot 镜像           │
  │ .mu300/ 引导状态      │ ◄──► │ trustos: AVB 补丁版             │
  └──────────────────────┘      │ misc: bootloader_control        │
                                └────────────────────────────────┘
  客户端 ─ WiFi/USB ─► br-lan 192.168.77.1 ─ nft TPROXY ─► mihomo ─► 5G(sipa) ─► 节点
```

**U30 Air（B33，内置 eMMC）**

```
  eMMC 29.1 GiB
  ┌───────────────┬──────────────────┬──────────────────────┐
  │ Android 分区   │ userdata 15.3 GiB │ mu300root ext4 8 GiB │
  │ （boot_a 已换   │ （Android 数据）  │ ← OpenWrt 根文件系统   │
  │  Magisk+adbip）│                  │                      │
  └───────────────┴──────────────────┴──────────────────────┘
  boot_b = Linux boot；trustos_a = 补丁版；misc 32 B 控制默认启动
  客户端 ─ WiFi/USB ─► br-lan 192.168.78.1 ─ nft TPROXY ─► mihomo ─► 5G(sipa) ─► 节点
```

## 快速开始

### 0. 通用准备

- Windows PC（脚本以 Windows 为主）、能传数据的 USB 线
- Python 3.8+（mu300-linux 安装器需要，`lz4` 模块安装器会装）
- [mu300-linux](https://github.com/dikeckaan/mu300-linux) 源码（安装器）
- 展锐 FDL 工具：`spd_dump.exe` + `fdl1-dl.bin` / `fdl2-dl.bin` + SPRD 串口驱动
- **先完整备份所有关键分区**（见 [docs/02](docs/02-backup-and-recovery.md)）

### 路径 A：F50 / MU3350S（TF 卡）

```powershell
# 1) 备份（FDL 直插模式，只读）
spd_dump.exe --wait 300 --kickto 2 exec path C:\f50-work\backup1 r all reset

# 2) root 通道：socat 推到 /data/local/tmp/socat
node scripts/f50-root-shell.mjs trigger
node scripts/setup-device-root.mjs

# 3) 生成并写入 B04 补丁版 trustos
node scripts/gen-trustos-patched.mjs --backup C:\f50-work\backup1 --out trustos_a_patched_merged.bin
#   设备端：dd if=trustos_a_patched_merged.bin of=/dev/block/by-name/trustos_a bs=1M && sync

# 4) 安装器打补丁 + 安装（答案文件见 answers/mu300-answers.example.txt）
node scripts/patch-mu300-installer.mjs --installer C:\f50-work\mu300-src\install.ps1
powershell -ExecutionPolicy Bypass -File scripts\installer\install-openwrt.ps1 -SrcDir C:\f50-work\mu300-src

# 5) 切换系统（或设备上 mu300-next-boot android|openwrt-luci）
scripts\F50-切到Android.cmd    /    scripts\F50-切到OpenWrt.cmd

# 6) mihomo 透明代理
node scripts/install-mihomo.mjs --sub "https://…?clashmeta=1" --secret "change-me" --lan-cidr 192.168.77.0/24
```

细节：[01 设备](docs/01-device.md) · [02 备份](docs/02-backup-and-recovery.md) · [03 AVB 补丁](docs/03-trustos-avb-bypass.md) · [04 root 通道](docs/04-root-channel.md) · [05 安装](docs/05-openwrt-install.md) · [06 切换](docs/06-dual-boot-switching.md) · [08 代理](docs/08-vpn-proxy.md)。

### 路径 B：U30 Air / U30AirV1.0.0B33（BROM + 内置 eMMC）

```powershell
# 1) 全分区备份（73 个分区，约 5.3 GB，只读）
scripts\U30-备份.cmd

# 2) 进 BROM：spd_dump 直插/kick 失败后设备会停在下载模式（1782:4D00，SPRD U2S Diag）
#    （也可关机后按住电源键 ~5–8 秒插线；热重启抓不到 boot_diag）

# 3) 刷 root 包：trustos_a（AVB 补丁）→ boot_a（Magisk + 自动无线 ADB），全部回读校验
node scripts/u30-flash-root.mjs --pkg C:\f50-work\part-tool\data `
     --spd C:\f50-work\part-tool\bin\spd_dump.exe `
     --fdl1 C:\f50-work\part-tool\bin\fdl1-dl.bin --fdl2 C:\f50-work\part-tool\bin\fdl2-dl.bin

# 4) 重启进 rooted Android（无线 ADB 5555 自动开启）→ Samba root（共享名 "U30 Air"）
adb connect 192.168.0.1:5555
node scripts/f50-root-shell.mjs trigger        # 自动尝试 F50 / U30 Air 共享名
node scripts/setup-device-root.mjs             # /odm/bin/su 兼容层 + adbd TCP 持久化

# 5) 安装器（32 GB 版：收缩 userdata 划出 8 GiB；答案见 answers/u30air-internal-answers.example.txt）
powershell -ExecutionPolicy Bypass -File scripts\installer\install-openwrt.ps1 `
  -SrcDir C:\f50-work\mu300-src -AnswersFile answers\u30air-internal-answers.txt

# 6) mihomo 透明代理
node scripts/install-mihomo.mjs --sub "https://…?clashmeta=1" --secret "change-me" --lan-cidr 192.168.78.0/24
```

> ⚠️ U30 Air 的 reset 路径在真机上有一个已知偏差：Android recovery 的 wipe BCB 没有执行，
> Android 数据不一致（详见 [docs/10](docs/10-u30-air.md)）。Linux 安装不受影响；如要继续用 Android，请手动恢复出厂。

## 目录结构

```
mu3350s-openwrt/
├─ docs/
│  ├─ 01-device.md … 09-quickstart.md     F50 流程
│  └─ 10-u30-air.md                       U30 Air 完整流程
├─ scripts/
│  ├─ gen-trustos-patched.mjs   F50：由备份生成 B04 补丁版 trustos
│  ├─ f50-root-shell.mjs        root 通道客户端（SMB 触发 + TCP 4444；共享名自动识别）
│  ├─ setup-device-root.mjs     Android 上部署/恢复 root 通道与 su 兼容层
│  ├─ patch-mu300-installer.mjs 给官方安装器打补丁（RootSock / $HOME / su 探测）
│  ├─ installer/                Windows 安装器一键封装
│  ├─ u30-flash-root.mjs        U30 Air：BROM 下写 trustos_a + boot_a（回读校验/回滚）
│  ├─ u30-backup.ps1            U30 Air：全分区备份（只读）
│  ├─ U30-备份.cmd / U30-刷Root.cmd   双击封装
│  ├─ install-mihomo.mjs        mihomo + metacubexd + TPROXY 一键安装（F50/U30 Air 通用）
│  ├─ proxy/                    配置示例、nftables 规则（含 U30 Air 版）、init.d
│  ├─ device/                   设备端 root 通道脚本
│  └─ F50-切到*.ps1/.cmd        双系统切换（可配置路径）
├─ answers/
│  ├─ mu300-answers.example.txt             F50（TF 卡）答案模板
│  └─ u30air-internal-answers.example.txt   U30 Air（内置存储）答案模板
├─ artifacts/
│  ├─ backup-manifest.sha256                F50 分区备份 SHA-256
│  └─ u30air-backup-manifest.sha256         U30 Air 73 分区备份 SHA-256
└─ notes/verification.md                    验证记录（脱敏）
```

## 文档

| 文档 | 内容 | 机型 |
|---|---|---|
| [01 设备信息](docs/01-device.md) | 硬件、固件、USB 模式、分区布局 | F50 |
| [02 备份与恢复](docs/02-backup-and-recovery.md) | 分区清单、FDL 刷回；含 U30 Air 章节 | 两者 |
| [03 TrustOS AVB 绕过](docs/03-trustos-avb-bypass.md) | 4 字节补丁、合并算法、可复现哈希 | F50 |
| [04 Root 通道](docs/04-root-channel.md) | Samba `root preexec`、socat、su 兼容层、安全注意 | 两者 |
| [05 OpenWrt 安装](docs/05-openwrt-install.md) | 安装器改造、无人值守答案、过程；含 U30 Air 章节 | 两者 |
| [06 双系统切换](docs/06-dual-boot-switching.md) | misc `bootloader_control`、切换命令、失败回退 | 两者 |
| [07 时间线与经验](docs/07-timeline-and-findings.md) | 走过的弯路、关键发现（含 B33 的 9 条） | 两者 |
| [08 内置代理](docs/08-vpn-proxy.md) | mihomo + TPROXY + fake-ip 分流、面板；含 U30 Air 实测 | 两者 |
| [09 日常使用](docs/09-quickstart.md) | 切换/访问/维护/排障速查 | 两者 |
| [10 U30 Air](docs/10-u30-air.md) | BROM 刷 root、32 GB 收缩 userdata、mihomo、回滚 | U30 Air |

## 与 [mu300-linux](https://github.com/dikeckaan/mu300-linux) 的关系

**mu300-linux 是安装器/系统层，不是 root 工具**。它的 README 明确写着：
*Rooting, unlocking, patching and recovery are not part of this project.*
安装器默认设备**已经 root**（有 Magisk `su`），并且 boot chain 已经能启动未签名内核。

对锁 BL、没 root 的出厂机，直接跑 mu300-linux 会在 `pull` 阶段失败（`/system/bin/sh: su: inaccessible or not found`）。
本项目补上的正是这些前置环节：

| 环节 | mu300-linux | 本项目额外做的 |
|---|---|---|
| Root | 假定已有 Magisk `su` | Samba `root preexec` 免 Magisk root（带 su 兼容层、adbd TCP、重启自动恢复）；U30 Air 先经 BROM 刷 one-key-root 包获得无线 ADB |
| 锁 BL 启动 Linux | 不负责 AVB/解锁 | F50：离线生成 B04 专用 TrustOS 补丁；U30 Air：校验并刷入第三方 root 包的 patched trustos |
| 安装器跑法 | 假设 USB adb + `su` | `RootSock` 替换 `SuDo`/`SuDoToFile`、修 `$HOME`、禁自更新与 USB 模式切换；另修了新 adb 的 stderr + PowerShell 5.1 问题 |
| 双系统操作 | 提供 `mu300-next-boot` / `mu300-os` | Android↔OpenWrt 一键切换脚本、misc 32 字节状态备份/恢复、失败回退验证 |
| 代理/VPN | 独立模块 [mu300-linux-vpn](https://github.com/dikeckaan/mu300-linux-vpn) | 自建轻量方案：mihomo + nftables TPROXY + fake-ip DNS + metacubexd 面板 + 一键安装脚本；两种方案可二选一 |

**一句话**：设备已 root/解锁时 mu300-linux 可以直接用；锁 BL 的出厂机需要本项目这套 root + AVB/启动包 + 安装器适配。

## 已验证项目

**F50 / MU3350S（2026-11-02）**

| 检查 | 结果 |
|---|---|
| Android 原 `boot_a` 未改动 | sha256 与备份一致 ✅ |
| `trustos_a` 为补丁版 | 前 5,178,856 B sha256 可复现 ✅ |
| Android / OpenWrt 双向切换 | 实测通过，重启仍进 OpenWrt ✅ |
| OpenWrt / 内核 | 25.12.6 / 7.3.1；LuCI 200、SSH 22 ✅ |
| 5G、热点客户端 | ping/HTTP 正常，手机 + USB 客户端可上网 ✅ |
| mihomo 分流 | 国内直连、海外走节点 ✅ |
| 重启持久化 | 断电重连后热点与代理自动恢复 ✅ |

**U30 Air（2026-11-03，`U30AirV1.0.0B33` 32 GB）**

| 检查 | 结果 |
|---|---|
| BROM / FDL2 连接 | `1782:4D00`，`exec_addr 0x65012f48` + FDL1/FDL2 ✅ |
| 全分区备份 | 73 分区 / 5.29 GB，SHA-256 清单见 `artifacts/` ✅ |
| `trustos_a` 写入 | `wof` 偏移写 + 回读前缀比对一致 ✅ |
| `boot_a` 写入 | 64 MiB 整写 + 回读 SHA-256 一致 ✅ |
| 无线 ADB | 重启后 `192.168.0.1:5555` 免授权 shell ✅ |
| Samba root + su 兼容层 | `uid=0(root)`，`adb shell su -c id` → root ✅ |
| userdata 收缩 | 23.27 → 15.27 GiB，划出 8 GiB 区域 ✅（recovery wipe 未执行 ⚠️） |
| OpenWrt / 5G / mihomo | 7.3.1 启动、ping 通、google 走节点 / baidu 直连 ✅ |

## 已知限制与风险

- **U30 Air 的 Android 数据**：32 GB 版安装器走的 reset 路径依赖 recovery 的 `--wipe_data`，该机没有执行，
  userdata 已缩小但 f2fs 回滚到旧检查点 → Android 能启动但数据不一致。Linux 不受影响；继续用 Android 前建议手动恢复出厂（见 [docs/10](docs/10-u30-air.md)）。
- **进 BROM 必须物理操作**：关机 + 按键/插线（或短接）；没有远程进入方式。设备没有可用的 recovery/降级通道，
  出问题只能靠完整分区备份 + FDL 恢复。
- **F50 依赖 TF 卡**：卡丢失/损坏 = Linux 系统丢失（boot_b 仍指向卡）。
- **5G 流量**：代理与热点客户端都走内置 5G，注意套餐；不用代理时可 `/etc/init.d/mihomo stop`。
- 刷机有风险：可能无法开机、丢数据或失去保修。请先完成完整备份。

## 安全与合规

- **仅供本人设备研究使用**，请勿用于未授权设备。
- Samba `root preexec`、adb over USB 等属于对设备固件特性的利用；使用后建议移除相关文件并恢复默认。
- 本仓库不附带厂商固件、签名数据或可执行破解物；所有镜像由用户从自己的设备/备份生成或自行准备并核对哈希。

## 致谢

- [mu300-linux](https://github.com/dikeckaan/mu300-linux)：OpenWrt/Ubuntu 安装器、内核与引导方案
- [spreadtrum_flash](https://github.com/TomKing062/spreadtrum_flash)：`spd_dump`、CVE-2022-38694、DHTB 处理
- [mihomo](https://github.com/MetaCubeX/mihomo) / [metacubexd](https://github.com/MetaCubeX/metacubexd)：代理内核与面板
- [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)：分流规则集
- 社区 issue 的经验与反馈（mu300-linux #386、UFI-TOOLS #146 等）

## License

MIT（见 [LICENSE](LICENSE)）。文档与脚本可自由参考/修改/分发，请保留出处。

---

### English TL;DR

This repository documents how to run **OpenWrt (LuCI, kernel 7.3.1) in dual-boot** with the stock
Android on two ZTE UMS9620 MiFi models, plus a **mihomo / nftables TPROXY** transparent proxy
with rule-based split routing and a metacubexd dashboard. Everything is reversible with FDL
flash mode and full partition backups.

- **F50 / MU3350S**: OpenWrt lives on a TF card (`mu300sd`); Android data is untouched. Root comes
  from the vendor Samba `root preexec` (no Magisk), and a locally generated B04 TrustOS patch lets
  the locked bootloader start unsigned Linux images. The official mu300-linux installer is patched
  to use the root channel instead of `su`.
- **U30 Air (B33, 32 GB, no SD slot)**: no software path to ADB exists on this firmware, so a
  third-party one-key-root package (patched TrustOS + Magisk boot with adb-over-IP) is flashed over
  BROM; then the same Samba root channel and patched installer shrink `userdata` to make an 8 GiB
  internal region for OpenWrt. Note: the Android factory-reset step of that path did not execute on
  the test unit (see docs/10) - Linux is unaffected, but Android data should be reset manually.
