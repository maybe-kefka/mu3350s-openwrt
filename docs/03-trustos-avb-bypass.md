# 03 TrustOS AVB 绕过补丁（B04 专用）

## 为什么需要

设备引导链是锁定的（`ro.boot.flash.locked=1`，`verifiedbootstate=green`）。
mu300-linux 的 Linux 内核/引导镜像没有展锐签名，必须让 TrustOS 跳过 AVB 校验，
否则会启动失败并自动退回 Android。官方 B03 eSIM Root 包里的 `trustos.bin` 正是这种补丁版。

## 关键发现

1. **B04 与 B09 的 trustos 载荷完全相同**（逐字节 diff = 0），只是分区尾部证书/填充不同。
2. 官方 B03 eSIM Root 包的 `trustos.bin` 是“SML + 补丁版 trustos”合并镜像；
   与 B04 原厂 trustos 对比，**只有一处 4 字节不同**：

   ```
   文件偏移 0x774d4（载荷偏移 0x772d4）
   原厂:  e0 03 14 2a   (0x2a1403e0)
   补丁:  00 00 80 52   (0x52800000,  mov w0, #0)
   ```

3. 结构（DHTB）：头部 0x200 字节；`mImgSize` @0x30；SIMGHDR 尾部位于 `0x200+mImgSize`，
   字段 `payload_size`@0x10、`payload_offset`@0x18、`cert_size`@0x20、`cert_offset`@0x28。

## 合并算法（等价于 spreadtrum_flash 的 `bsp_cve_2img`）

```
out            = sml_header(0x200) + patched_trustos_payload(mImgSize) + sml_payload_remainder
sml_header.mImgSize        += modified_size
img_hdr.payload_offset     += modified_size
img_hdr.cert_offset        += modified_size
modified_size = trustos.mImgSize（0x4cd000）
```

另外先用 `bsp_chsize()` 把 1 MB 的 `sml_a.bin` 截到真实体积（本机 144,872 字节）。

## 生成与验证

```
node scripts/gen-trustos-patched.mjs --backup C:\f50-work\backup1 --out trustos_a_patched_merged.bin
```

本机输出（已归档到 [`artifacts/trustos_a_patched_merged.bin`](../artifacts/trustos_a_patched_merged.bin)）：

```
size   5,178,856
sha256 3dbf07e20e123c25944615d2220964052f15c43dc045f8c81a0899daa85d5b30
```

结构自检：与官方 B03 包完全一致（size/mImgSize/payload_size/payload_offset/cert_offset 全部相同）。

## 写入方式（本机实际做法）

通过已拿到的 root 通道：

```sh
# 先把镜像放到 /sdcard（例如 SMB 拷贝到 DCIM），再：
dd if=/mnt/sdcard/DCIM/trustos_a_patched_merged.bin of=/dev/block/by-name/trustos_a bs=1M
sync
```

Android 侧 a 槽原 boot 镜像不变仍能启动（补丁只放宽校验）；Linux 侧由 mu300 安装器把 a 槽 bootchain
复制到 b 槽（trustos_b 同步为补丁版），这样 b 槽的 Linux 才能启动。

## 验证

- 刷入后 Android 正常启动（实测）。
- `trustos_a` 前 5,178,856 字节 sha256 = `3dbf07e2...`。
- Linux 侧可正常用主线内核 7.3.1 启动（说明 AVB 确实被绕过）。
