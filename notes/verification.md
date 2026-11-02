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
