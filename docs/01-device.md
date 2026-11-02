# 01 设备与固件信息

## 硬件

| 项目 | 值 |
|---|---|
| 型号 | ZTE F50 / MU300，外壳型号 MU3350S |
| SoC | 紫光展锐 Unisoc UMS9620（T760），aarch64 |
| 开发板代号 | `ums9620_2h10_feimao`（`androidboot.hardware`） |
| eMMC | 64 GB（可用 58.3 GiB，122159104 扇区），`/dev/block/mmcblk0` |
| TF 卡 | 256 GB（`/dev/block/mmcblk1`，238.2 GiB），用于 OpenWrt |
| 屏幕 | 无（`lcd_name=lcd_dummy_mipi_hd`，854x480 dummy） |
| 电池 | 无，USB 供电，拔线即断电 |
| SIM | 纯 eSIM 版本（无 nano-SIM 卡槽） |

## 软件（原厂 B04）

```
ro.build.display.id     ZTE/MU300/MU300:13/TPA1.220624.014/20260604.170108:user/release-keys
固件版本                F50_ST_ESIMV1.0.0B04 / MU300_STESIMV1.0.0B04
Android                13 (SDK 33)
安全补丁               2026-04-05
ro.build.type          user
ro.debuggable          0
ro.adb.secure          1
ro.boot.verifiedbootstate  green
ro.boot.flash.locked       1
ro.boot.slot_suffix        _a      （A/B 槽，Android 在 a 槽）
动态分区                super / product / system_ext / vendor / odm ...
分区布局                /dev/block/by-name/（boot_a/b, trustos_a/b, sml_a/b, uboot_a/b, super, userdata ...）
```

完整 `getprop` 存档见 [`artifacts/device/props-B04-W1.txt`](../artifacts/device/props-B04-W1.txt)（开机 ADB 窗口内抓取）。

## USB 模式观察（重要）

设备 USB 枚举会随状态变化，识别这些 PID 对排障很关键：

| VID:PID | 含义 |
|---|---|
| `19D2:1352` | 开机调试窗口中的 **ADB** 设备（WinUSB），窗口约 10 秒，之后消失 |
| `19D2:0246` | Android 正常运行：RNDIS 网卡（192.168.0.1）+ MTP |
| `19D2:1353` | Android 的 CDC-ECM 模式（Windows 无驱动，工具 `aaadddbbb.exe` 会切到这里） |
| `1782:4D00` | 展锐 FDL（下载模式），安装 SPRD 串口驱动后显示为 `SPRD U2S Diag (COMx)` |

另外：`svc usb setFunctions` 在本机型上无效，ZTE 的 USB 服务会强制保持 `rndis,mtp`；
Web 管理页面的“USB端口”开关（`usb_port_switch`）打开后会在开机时出现 10 秒 ADB 窗口，但连续切换它
可能导致 USB 完全不枚举（需要拔插一次复位）。
