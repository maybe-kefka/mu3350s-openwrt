# 05 OpenWrt 安装（SD 卡，双系统）

## 项目与版本

- 安装器项目：`dikeckaan/mu300-linux`（Windows 用 `install.ps1`，Linux/macOS 用 `install.sh`）
- 使用的发布版本：**v2026.11.02.1**
- 安装目标：TF 卡（`MU300_STORAGE=sd`），系统 OpenWrt + LuCI（`openwrt-luci`），内核 **7.3**
- 本机源码目录：`C:\f50-work\mu300-src`（下载 main 分支 zip 解压）

## 为什么装 SD 而不是 eMMC

check 模式实测：

```
eMMC：58.3 GiB（122159104 扇区），分区结束于 58.2 GiB（122155008），其后空闲：0.0 GiB
SD 卡：/dev/block/mmcblk1p1，238.2 GiB，已有 mu300sd 文件系统：否
结果：eMMC 上的空闲空间不足以安装 Linux；安装程序将改为提供 SD 卡选项（无需重新分区）
```

所以选择 SD 安装，不 shrinking userdata、不破坏 Android 数据。

## 对官方 install.ps1 的必要修改

见 [`scripts/patch-mu300-installer.mjs`](../scripts/patch-mu300-installer.mjs)（幂等，保留 `.orig`）：

1. 新增 `RootSock()`：通过 192.168.0.1:4444 的 root shell 执行命令；
2. `SuDo()` 改为 `RootSock`（不再需要 `su`）；
3. `SuDoToFile()` 改为 `RootSock` + `adb pull`；
4. 两处 `$HOME` 改为 `$env:USERPROFILE`（PowerShell 从环境变量初始化 `$HOME`，空环境启动时会导致 `Join-Path` 报错）；
5. 中和进度信息里的 `adb shell su -v`（设备无 su）。

此外运行时设置：

```
MU300_USB_ADB_ONLY=0    # 不做 USB 模式切换（会断掉 USB 网络和 root 通道）
MU300_NO_SELF_UPDATE=1  # 不自动更新（否则会覆盖打过补丁的 install.ps1）
ANDROID_SERIAL=192.168.0.1:5555
```

## 无人值守答案

[`answers/mu300-answers.example.txt`](../answers/mu300-answers.example.txt)：

```
MU300_LANG=zh
MU300_STORAGE=sd
MU300_ANS_SYSTEMS=2          # 只装 OpenWrt
MU300_OPENWRT=luci
MU300_ANS_KERNEL=7.3
MU300_ANS_ERASE_SD=ERASE
MU300_ANS_DEFAULT_LINUX=yes
MU300_ANS_BOOT_ATTEMPTS=5
MU300_ANS_HOTSPOT=yes
MU300_ANS_GPU=yes
MU300_ANS_VPN=no
MU300_ANS_ADB=yes
MU300_ANS_PASSWORD=<OpenWrt root / LuCI 密码>
MU300_ANS_CONFIRM=INSTALL
```

安装器依赖 Python 3.8+（含 `lz4`），会自动安装；本机已装 Python 3.12.10 到用户目录。

## 运行

```powershell
# 先确保 root 通道在线（Android 侧）：
node scripts/f50-root-shell.mjs trigger
# 打补丁（一次性）：
node scripts/patch-mu300-installer.mjs --installer C:\f50-work\mu300-src\install.ps1
# 只读检查：
powershell -ExecutionPolicy Bypass -File scripts\installer\install-openwrt.ps1 -SrcDir C:\f50-work\mu300-src -Check
# 正式安装：
powershell -ExecutionPolicy Bypass -File scripts\installer\install-openwrt.ps1 -SrcDir C:\f50-work\mu300-src
```

## 安装过程（阶段与结果）

日志见 [`notes/install-success.log`](../notes/install-success.log)。阶段：
`preflight → storage → choices → pull → download → vendor → bootimage → confirm → copy → device → boot → switch → done`。

成功输出（节选）：

```
[device] creating ext4 mu300sd on /dev/block/mmcblk1p1
[device] boot chain: trustos_b <- trustos_a, verified
[device] installing openwrt-luci
[device] openwrt-luci: adb over USB on, only for YOUR-HOME-WIFI@YOUR-PC
[device] hotspot: SSID F50-OpenWrt imported (passphrase 8 chars)
[device] installed: openwrt-luci boot-os=openwrt-luci default-linux=1
MU300-INSTALL-OK
@@mu300 {"event":"done","result":"ok","boot_os":"openwrt-luci","ip":"192.168.77.1",
         "release":"v2026.11.02.1","kernel":"7.3"}
```

写入了什么：

- TF 卡：新建 ext4 文件系统（label `mu300sd`），解压 OpenWrt LuCI rootfs + 内核 + Android 厂商文件；
- eMMC：只写 b 槽的 boot 分区、bootchain 的 b 槽副本、`misc` 的 32 字节引导控制；
  **boot_a、GPT、userdata 完全未动**（boot_a sha256 仍为原厂值）。

## 首次启动后验证

```
uname -r                7.3.1
OpenWrt                 25.12.6 r33311-981c978eff
rootfs                   /dev/mmcblk1p1 (ext4, 237.1G) mounted on /
LuCI                     http://192.168.77.1  -> 200
SSH (dropbear)           22 open
WiFi AP                  F50-OpenWrt / YOUR_WIFI_PASSWORD (5GHz ch36 VHT80)
5G 上网                  ping 223.5.5.5 OK, sipa_eth0 = 10.213.102.102
adb over USB             MU300LINUX-...-... device (root)
```
