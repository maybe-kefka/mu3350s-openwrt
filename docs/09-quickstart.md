# 09 日常使用与排障速查

## 1. 当前在哪个系统？

```
adb devices
  MU300LINUX-<serial>-...   device   → OpenWrt
  <device-serial>                  device   → Android（裸序列号）
```

USB 网络地址：Android = `192.168.0.1`，OpenWrt = `192.168.77.1`。

## 2. 系统切换

| 方向 | 方法 |
|---|---|
| OpenWrt → Android | 电脑运行 `scripts\F50-切到Android.cmd`；或设备 SSH 后 `mu300-next-boot android && reboot` |
| Android → OpenWrt | 电脑运行 `scripts\F50-切到OpenWrt.cmd`（依赖已部署的 root 通道）；或设备 root 通道内写回 misc 后重启 |

切换脚本会在切走前保存 `misc` 引导状态到 `%F50_WORK_DIR%\misc-linux.bin`，切回时写回并重启。

## 3. 访问 OpenWrt

- **LuCI**: http://192.168.77.1 （用户名 `root`，密码为安装时设置）
- **SSH**: `ssh root@192.168.77.1`
- **WiFi**: 原厂热点名/密码（安装时导入），5 GHz
- **USB**: 插线后电脑多一块网卡，设备地址 192.168.77.1

## 4. 热点代理（内置 Clash Meta）

- 连接热点的设备**自动走代理**：国内直连、海外走订阅节点，DNS 为 fake-ip
- 节点面板: `http://192.168.77.1:9090/ui/`，secret 见 `scripts/proxy/config.example.yaml` 中你设置的值
  - **Proxy** 组手动选节点；**Auto** 组自动测速
  - 选择会持久化，重启保留
- 订阅每天自动更新（`proxy-providers.interval: 86400`）

```sh
/etc/init.d/mihomo stop     # 临时关闭代理（热点回到直连）
/etc/init.d/mihomo start    # 重新开启
/etc/init.d/mihomo restart  # 修改 /etc/mihomo/config.yaml 后
logread -e mihomo -f        # 实时日志
```

## 5. 维护

```sh
mu300-next-boot              # 查看引导状态（默认系统/剩余尝试次数）
mu300-os                     # 查看/切换默认系统
mu300-update                 # 升级 OpenWrt 用户空间（按项目说明）
df -h                        # TF 卡空间（根文件系统在 /dev/mmcblk1p1）
```

备份建议：

- 原厂分区备份（一次性）：FDL 直连模式，见 [02](02-backup-and-recovery.md)
- OpenWrt 配置：`tar -czf /mnt/mu300-disk/openwrt-config-backup.tgz /etc /root`

## 6. 故障排查

| 现象 | 排查 |
|---|---|
| 手机连热点一直「正在连接」 | 先确认 DHCP 未被代理规则拦截：`nft list table inet mihomo` 中应有 `udp dport { 67, 68 } return`；否则热点客户端拿不到 IP |
| 热点连上但无外网 | `ps | grep mihomo`、`nft list table inet mihomo`、`ip rule show`；`logread -e mihomo` 看规则匹配 |
| USB 完全不枚举 | 拔插 USB 线；或 Web 管理页把 `usb_port_switch` 关闭后重启（见 [01](01-device.md)） |
| adb 找不到设备 | OpenWrt 侧 adb 走 USB gadget（`MU300LINUX-` 前缀）；Android 侧裸序列号 |
| 误切到 Android 想回 OpenWrt | 用 `F50-切到OpenWrt.cmd`；或 Android root 通道写回 misc（见 [06](06-dual-boot-switching.md)） |
| 连续 5 次启动失败 | 自动回 Android；检查 TF 卡是否插好/损坏 |

## 7. 回滚

- 单次回 Android：`mu300-next-boot android` + 重启
- 完全回原厂：FDL 直连模式刷回备份分区（[02](02-backup-and-recovery.md)）
- 恢复前建议保留 `misc` 原始备份，避免引导槽状态混乱

## 8. 安全建议

- Android 侧的 Samba root 通道、adb TCP 5555 仅在需要时开启，用完建议移除：
  `chattr -i /data/samba/etc/smb.conf`、删除 `/data/local/tmp/root*`、`setprop persist.service.adb.tcp.port ''`
- OpenWrt 侧不要长期暴露 9090 控制面板到不可信网络（仅热点内网使用）
- 更换/转卖设备前，恢复原厂固件并清除个人配置
