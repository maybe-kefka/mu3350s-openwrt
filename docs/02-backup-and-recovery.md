# 02 分区备份与恢复

## 已完成的备份

64 个文件、约 1.21 GB，保存在 `C:\f50-work\backup1`。
项目内附完整 SHA-256 清单：[`artifacts/backup-manifest.sha256`](../artifacts/backup-manifest.sha256)。

关键分区（原厂值）：

| 分区 | 文件 | SHA-256 |
|---|---|---|
| boot_a / boot_b | `boot_a.bin` / `boot_b.bin` | `59c365b0f78bff78b374cc9560f033529768080ed4d5228c8f71cfdfcd2b8f42` |
| trustos_a / trustos_b | `trustos_a.bin` / `trustos_b.bin` | `b064502e9ac1e3e4c87278489adb6fbffa9c9cc6eea75389ac222446ed7849c9` |
| sml_a / sml_b | `sml_a.bin` / `sml_b.bin` | 见清单 |
| splloader | `splloader.bin` | 见清单 |
| vbmeta* / dtbo / vendor_boot / init_boot / misc / miscdata / prodnv / ztepersist / nr_* | 均有 | 见清单 |

读取方式：展锐 FDL（`toolkit\bin\spd_dump.exe`），单个会话读约 23 MB/s；
`spd_dump --wait 300 --kickto 2 exec path <dir> r <partition> ... reset`。

## 恢复（回滚到原厂）

1. 关闭设备（拔掉 USB 线）。
2. 以管理员安装好 SPD 驱动（`toolkit\drivers\Win10`，或 `pnputil /add-driver sprdvcom.inf /install`）。
3. 运行 FDL 直连模式：
   ```bat
   toolkit\bin\spd_dump.exe --wait 300 --kickto 2 exec path C:\f50-work\backup1 ^
     w trustos_a trustos_a.bin w boot_a boot_a.bin reset
   ```
   （按需增加其它分区；`w <分区名> <文件>`，结束后 `reset`）
4. 设备重启回 Android。

> 注意：`backup1` 中 `trustos_a.bin`/`boot_a.bin` 是**刷机前原厂**镜像；刷入过的补丁版
> trustos 是 `artifacts/trustos_a_patched_merged.bin`，恢复时不要混用。

## 另一层保护

- mu300 安装器在 `mu300-src\work\bootchain\<时间戳>\` 另存了一份 bootchain 备份（trustos 双槽）。
- 本项目的双系统结构本身带 5 次启动失败自动回 Android 的兜底。
- 只要 TF 卡不损坏，Android 的 a 槽始终可启动（切回方法见 06）。
