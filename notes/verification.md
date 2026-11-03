# 验证记录（脱敏）

设备：ZTE F50 / MU3350S（eSIM 版），固件 F50_ST_ESIMV1.0.0B04，Android 13。

| 检查项 | 方法 | 结果 |
|---|---|---|
| 原 boot_a 未被修改 | `sha256sum /dev/block/by-name/boot_a` 与备份对比 | `59c365b0…` 一致 ✅ |
| trustos_a 为补丁版 | 读取前 5,178,856 字节 sha256 | `3dbf07e2…` 一致 ✅ |
| 补丁镜像可复现 | 由备份运行 `gen-trustos-patched.mjs` | 生成物哈希一致 ✅ |
| OpenWrt 启动 | `uname -r` / `/etc/openwrt_release` | 7.3.1 / 25.12.6 ✅ |
| LuCI / SSH | HTTP 200 / 端口 22 | 正常 ✅ |
| 5G 上网 | ping 223.5.5.5、HTTP 200 | 正常 ✅ |
| 默认启动持久性 | 多次重启后 `mu300-next-boot` | `default boot: linux` ✅ |
| Android 切换 | 脚本切 Android → 再切回 OpenWrt | 双向成功 ✅ |
| 热点客户端上网 | 真实手机 + USB 客户端 | 正常（经代理）✅ |
| 代理分流 | 国内直连 / 海外节点出口 | 符合规则 ✅ |
| 断电重连 | 设备断电再上电 | 热点、代理、规则自动恢复 ✅ |

说明：原始日志包含设备序列号、MAC、WiFi 密码等信息，未纳入本仓库。

## 2026-11-03 · ZTE U30 Air（U30AirHW1.0 / U30AirV1.0.0B33，32 GB 版，无卡槽）

| 检查项 | 方法 | 结果 |
|---|---|---|
| BROM 进入 | spd_dump 直连/kick 失败后设备停在 `1782:4D00` | 稳定可用 ✅ |
| 全分区备份 | `r all`（73 分区，含 super/fulldumpdb） | 5.29 GB，SHA-256 清单入库 ✅ |
| trustos_a 写入 | `wof trustos_a 0 trustos.bin`，回读前缀比对 | 一致（5,178,856 B）✅ |
| boot_a 写入 | `w boot_a boot.bin`（64 MiB），回读 SHA-256 | 一致 ✅ |
| 无线 ADB | 重启后 `adb connect 192.168.0.1:5555` | 无需授权即可 shell（uid 2000）✅ |
| Samba root | smb.conf `root preexec` + socat 4444 | `uid=0(root) context=u:r:su:s0`，SELinux Permissive ✅ |
| su 兼容层 | `adb shell su -c id`（/odm/bin bind mount） | root ✅ |
| GPT 收缩 | 安装器 reset 路径：userdata 23.27→15.27 GiB，划出 8 GiB | 写入并回读校验 ✅ |
| Android recovery 重置 | misc BCB `--wipe_data` | **未执行**：设备直接回 Android，f2fs 回滚到旧检查点（数据不一致）⚠️ |
| 事务恢复安装 | 第二次运行安装器 | 校验通过，安装继续 ✅ |
| 启动链同步 | uboot/sml/teecfg a→b | 备份 + 回读校验 ✅ |
| OpenWrt 启动 | uname / LuCI / SSH | 7.3.1 / HTTP 200 / 22 open ✅ |
| 5G 上网 | ping 223.5.5.5 | 0% loss ✅ |
| 热点 | `iwinfo` | 5 GHz ch36 VHT80，SSID 可改 ✅ |
| mihomo | 订阅/节点/分流 | google 204 走节点，baidu 直连，Auto 88 ms ✅ |

