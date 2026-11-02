# 07 过程时间线与经验总结

## 阶段

| 时间（2026-11-02） | 事件 |
|---|---|
| 下午 | 通过 WiFi Web 管理界面（`http://192.168.0.1`）确认设备信息、登录算法（SHA256 大写 + LD/AD 令牌） |
| 傍晚 | 发现开机 10 秒 ADB 窗口（`19D2:1352`），用后台抓取器在窗口内执行 `adb shell reboot autoloader` 进入 FDL |
| 19:15 | 用 `toolkit\bin\spd_dump.exe` 完成 60 个关键分区完整备份（约 1.21 GB） |
| 19:30 | 分析官方 B03 eSIM Root 包：定位 trustos 的 4 字节补丁；确认 B04/B09 trustos 载荷一致；离线生成 B04 合并镜像 |
| 19:26-19:40 | 尝试社区 `aaadddbbb.exe`（临时无线 ADB）：步骤 1-5 成功，步骤 6 验证失败；设备被切到 CDC-ECM（`19D2:1353`），Windows 无驱动 |
| 19:40-20:50 | 反复开启/关闭 Web UI 的“USB端口”调试开关：10 秒 ADB 窗口可用，但连续切换会导致 USB 完全不枚举（需拔插复位）；期间做过一次 FDL 写入尝试，设备停在 FDL2 后通过断电恢复 |
| 21:29 | 突破：发现 `/data/samba/etc/smb.conf` 为 `rwxrwxrwx shell:shell`，`smbd` 以 root 运行；注入 `root preexec`，通过 SMB 连接触发，获得 `192.168.0.1:4444` root shell |
| 21:33 | `chattr +i` 锁定 smb.conf；root 通道持久化 |
| 21:35 | 制作 `su` 兼容层（bind-mount `/odm/bin`），解决安装器脚本直接调用 `adb shell su` 的问题 |
| 21:35-21:50 | 改造 mu300 安装器（RootSock、$HOME、禁用自更新/USB 切换），以无人值守答案把 OpenWrt 装到 TF 卡 |
| 21:50 | 设备重启进入 OpenWrt 25.12.6 / 内核 7.3.1，LuCI、SSH、5G、WiFi 热点全部正常 |
| 21:55-22:10 | 双系统切换双向实测通过；生成桌面一键切换脚本与说明 |
| 22:10 | 建立本项目目录（`~/projects/f50-mu3350s-openwrt`） |

## 走过的弯路（供以后参考）

- **`aaadddbbb.exe` 无线 ADB 工具**：会先把 USB 切到 CDC-ECM（Windows 无驱动），再等待“无线 ADB 验证”；
  在本机固件上步骤 6 始终失败。它修改过 USB 配置，需要 Web UI 里把 `usb_network_protocal=0` 再重启恢复。
- **`svc usb setFunctions adb`**：无效，ZTE 的 USB 服务会强制 `rndis,mtp`。
- **修改 adbd 二进制/`ro.secure` 属性取 root adb**：adbd 位于 APEX、判定逻辑不在字符串里，未成功；
  最终也不需要（安装器已改为走 root socket）。
- **在开机窗口用 `nohup` 延时启动 UFI-TOOLS 应用**：窗口内 `/data` 尚未就绪、脚本未执行，未走通。
- **eMMC 安装**：本机 userdata 占满 58.3 GiB，无空闲空间，必须缩容（会清数据/多次重启）；
  而目标是 TF 卡，直接选 SD 模式，避开风险。
- **直接用 B03/B09 的 Magisk boot 镜像**：内核版本不同（B03 g661ab vs B04 g35e7b），未采用；
  最终不需要 Magisk（root 由 Samba 通道提供）。

## 关键经验

1. ZTE 设备的 Web UI 登录：`SHA256(SHA256(password) + LD)`，大写十六进制；设置请求还需 `AD` 令牌。
2. 该机型 `usb_port_switch=1` 会给出 10 秒开机 ADB 窗口；连续切换容易让 USB 不枚举，需要拔插复位。
3. **Samba root preexec** 是本机最稳的 root 入口：`smb.conf` 可写 + `smbd` 以 root 运行 + 可 `chattr +i` 固化。
4. 安装器（Python 部分）直接调用 `adb shell su`，需要设备端有 `su`；用 PATH 内 bind-mount 一个转发脚本即可。
5. 双系统启动完全由 `misc` 的 32 字节 `bootloader_control` 决定；保存/恢复这 32 字节即可自由切换。
6. 所有关键分区有完整备份 + FDL 工具链，整个改造过程可回滚。

## 验证清单（全部通过）

| 检查项 | 结果 |
|---|---|
| Android 原 boot_a 未被修改 | sha256 = `59c365b0...`（与备份一致） |
| trustos_a 已替换为补丁版 | 前 5,178,856 字节 sha256 = `3dbf07e2...` |
| Android 可正常启动 | 切换后 Web UI 200、adb 裸序列号可见 |
| OpenWrt 可正常启动 | 内核 7.3.1、LuCI 200、SSH 22 |
| 默认启动状态持久 | 多次重启仍 `default boot: linux` |
| WiFi 热点 | `F50-OpenWrt` 5GHz VHT80 |
| 5G 上网 | ping 223.5.5.5 33ms、HTTP 200 |
| 双系统切换脚本 | 双向各测 2 次，均成功 |
