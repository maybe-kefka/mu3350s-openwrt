# 11 Linux 宿主机：不改安装器 + 无 Magisk 回切

本篇补充 05/06 没覆盖的两个场景，都是在另一台 F50 上实测的：

- 宿主机是 **Linux**（05 记的是 Windows + 打过补丁的 install.ps1）
- 设备 **没有 Magisk**，但有别的 root 通道

## 一、方向先确认：这台和 05 正好相反

| | 05 记的那台 | 本篇这台 |
|---|---|---|
| Android 所在槽 | a | **b** |
| Linux 装到 | b | **a** |
| TrustOS 补丁在 | a（Android 槽） | **a（Linux 槽）** |

方向决定启动链同步的后果，见第三节。开工前先 `--check` 看一眼
`Android 从槽位 X 运行；Linux 将安装到槽位 Y（boot_Y）`。

## 二、Linux 宿主机不用给安装器打补丁

Windows 那边必须打补丁，是因为 `install.ps1` 的 `SuDo()` 依赖设备的 `su`。
Linux 侧的 `install.sh` 只做一件事：

    su_do() { adb shell "su -c '$1'" </dev/null | tr -d '\r'; }

所以只要设备上"有 su"，**安装器原样可用，一行都不用改**。造 su 的两步：

    # 设备侧，root 执行：只监听回环的常驻 shell
    /system/bin/nc -L -p 4444 -s 127.0.0.1 /system/bin/sh &
    mount --bind /data/local/tmp/rootbin /odm/bin

`/odm/bin/su` 内容见 `scripts/su.shim`。要点：**不要加 `nc -q`**。
第一版写成 `nc -q 1`，长命令（读分区表、拉厂商文件）的输出会被截断，
安装器报"读不到分区表（是否已授予 su 权限？）"，其实是本地 shim 把输出掐了。

## 三、两个环境变量必须显式设置

| 变量 | 值 | 不设的后果 |
|---|---|---|
| `MU300_USB_ADB_ONLY` | `0` | 安装器开跑先把 USB 切成"仅 adb"；如果 adb 是 TCP over USB 网络，ecm 一断，网络、adb、root 通道同时消失，卡在"设备没有重新出现在 adb 上" |
| `MU300_SYNC_BOOTCHAIN` | `0` | 见下 |

`MU300_SYNC_BOOTCHAIN` 为什么这台必须关：

上游默认把 Android 槽的启动链复制到 Linux 槽。05 那台正好是"打过补丁的槽 → 新槽"，
补丁被顺带复制过去；这台是反的：

- Android 在 b、Linux 在 a，默认同步方向是 **b→a**
- b 槽的 trustos 是原厂未打补丁的
- 一同步，a 槽的补丁被覆盖 → 安装报告成功，重启永远回 Android，且没有任何提示

两槽差异实测（前 6MB 对比）：

| 分区 | 差异字节数 |
|---|---|
| trustos | 81,112 |
| uboot | 434,828 |
| sml | 512 |
| teecfg | 512 |
| vbmeta | 0 |

差异量级说明两槽是不同固件版本，补丁不能跨槽套用。所以选择不动启动链：
a 槽保持它自己那套自洽组合（原厂 uboot/sml/teecfg + 打过补丁的 trustos）。

## 四、回切：一步到位，不用等进 OpenWrt 再补一条命令

06 的做法是：Android 里写回 misc → 重启进 OpenWrt → 再用 adb 执行 `mu300-next-boot linux` 固定默认。
这一步不能省，因为只写 misc 只买**一次**启动：开机成功后 `mu300-boot-ok` 按
`/etc/mu300/default-boot` 的配置又把 misc 改回 Android 槽。

Linux 宿主机可以在 Android 里直接把那份配置改掉，省掉第二次连：

    mkdir -p /data/local/tmp/mu
    mount -t ext4 -o rw /dev/block/mmcblk1p1 /data/local/tmp/mu
    echo linux > /data/local/tmp/mu/openwrt-luci/etc/mu300/default-boot
    sync
    umount /data/local/tmp/mu

实测：写入后 `umount`，重新挂载回读一致（不是页缓存）。
`scripts/F50-switch-to-linux.sh` 就是这条 + 写 misc 合成一步。

## 五、两个实测坑

1. **OpenWrt 的 adbd 不支持 `adb reboot`**：返回 `error: closed`，设备纹丝不动，
   `/proc/uptime` 不会归零。要用 `adb shell 'sync; reboot -f'`。
2. **判断有没有真重启，看 `/proc/uptime`，别看 ping**。网络断几秒不代表重启。

## 实测记录

| 项 | 结果 |
|---|---|
| Linux 宿主机安装（未改 install.sh） | ✅ `MU300-INSTALL-OK` |
| 装完补丁留存 | ✅ Linux 里读 a 槽 trustos 前 5,178,856 字节 sha256 未变 |
| 无 Magisk 回切（脚本） | ✅ 重启进 OpenWrt，`default boot: linux` 保持 |
| 回切后复验 | ✅ 5G 通、补丁未变、`mu300-next-boot status` 正常 |
