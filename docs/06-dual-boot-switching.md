# 06 双系统启动与切换

Android 在 eMMC 的 **a 槽**，OpenWrt 在 TF 卡上、由 **b 槽**的 boot 镜像引导。
选择哪个槽由 `misc` 分区偏移 0x800（2048）处的 32 字节 `bootloader_control` 决定，
布局与 AOSP 一致：

```
[0..3]   slot_suffix[4]      "_a\0\0" 等
[4..7]   magic              0x42414342 ("BCAB")
[8]      version            1
[9]      bitfields          nb_slot:3 | recovery_tries:3 | merge_status:3
[10]     reserved0
[12..19] slot_info[4]       每槽 2 字节：priority:4 | tries:3 | successful:1 | reserved:9
[20..27] reserved1[8]
[28..31] crc32_le
```

每槽状态字节示例：`0x9e = prio14|tries1|successful1`、`0x6f = prio15|tries6|successful0`（b 槽试验启动）、
`0x9f = prio15|tries1|successful1`（a 槽正常）、`0x1e = prio14|tries1|successful0`（b 槽回退）。

## 两种典型状态（本机实测）

| 状态 | misc[0x800] 的 32 字节（hex） | mu300-next-boot 输出 |
|---|---|---|
| 默认启动 OpenWrt | `5f62000042434142010200009e006f000000000000000000000000006a0fed2c` | `default boot: linux` |
| 默认启动 Android | `5f61000042434142010200009f001e000000000000000000000000000be17146` | `default boot: android` |

`mu300-next-boot linux` 会把 b 槽设为 prio15/tries6（“试验启动，失败 5 次回 Android”），
并更新 CRC；该状态**跨重启保持**（实测多次重启仍默认 OpenWrt）。

## OpenWrt 侧（Linux）命令

```sh
mu300-next-boot                 # 查看当前引导状态
mu300-next-boot linux           # 把 OpenWrt 设为默认启动（持久）
mu300-next-boot android         # 下次启动 Android（并改默认）
mu300-os                        # 查看/切换默认系统
mu300-update                    # 升级 OpenWrt/内核
```

状态文件在 TF 卡：`/mnt/mu300-disk/.mu300/`（`boot-os`、`boot-attempts`、`boot-tries`、`bootchain/`）。

## Android 侧（本项目的桌面脚本）

Windows 上双击即可：

| 脚本 | 作用 |
|---|---|
| `scripts/F50-切到Android.cmd` | 在 OpenWrt 运行时：通过 Linux adb 先把默认启动状态保存到 `misc-linux.bin`，再 `mu300-next-boot android` + `reboot` |
| `scripts/F50-切到OpenWrt.cmd` | 在 Android 运行时：SMB 触发 root 通道，把 `misc-linux.bin` 写回 `misc`，重启进 OpenWrt；启动后通过 Linux adb 执行 `mu300-next-boot linux` 重新固定默认系统 |

脚本要点（也是手工操作步骤）：

1. 切 Android：`adb -s MU300LINUX-... shell mu300-next-boot linux` → 读取 `misc` 32 字节保存 → `mu300-next-boot android` → `reboot`。
2. 切 OpenWrt：`net use \\192.168.0.1\F50 /user:guest ""` 触发 root → 连接 `192.168.0.1:4444` → 把保存的 32 字节写回 `misc`（`dd ... bs=1 seek=2048 conv=notrunc`）→ `reboot`。
3. 回到 OpenWrt 后：`adb -s MU300LINUX-... shell mu300-next-boot linux` 固定默认启动。

## 怎么区分当前在哪个系统

```
adb devices
  MU300LINUX-<serial>-312624d4   device    # Linux（OpenWrt）
  <device-serial>                        device    # Android（裸序列号）
```

USB 网络地址：Android = `192.168.0.1`，OpenWrt = `192.168.77.1`。

## 兜底行为

- 默认 OpenWrt 时，连续 **5 次**启动失败（例如 TF 卡损坏/拔出）会自动回到 Android。
- 计数在成功启动一次后清零；可在 OpenWrt 里用 `mu300-next-boot attempts N` 调整（1-6）。
- 手边没有电脑时，也可以在 OpenWrt 启动过程中连续断电 5 次强制回 Android。

## 实测记录

| 测试 | 结果 |
|---|---|
| OpenWrt 默认启动，重启 2 次 | 均进入 OpenWrt，状态保持 `default boot: linux` |
| 桌面脚本切到 Android | 约 75 秒后 `http://192.168.0.1/` = 200，adb 显示裸序列号 |
| 桌面脚本切回 OpenWrt | 约 75 秒后 `http://192.168.77.1/` = 200，adb 显示 MU300LINUX-... |
| 切回后再次重启 | 仍进入 OpenWrt（默认系统已被脚本重新固定） |
