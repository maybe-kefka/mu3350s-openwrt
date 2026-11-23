#!/bin/bash
# Linux 宿主机：设备在 Android 时，一步切回 OpenWrt 并保持
#   - 需要：smbclient、nc；设备的 root 通道可用（SMBCLIENT_TRIGGER 触发的 root preexec 或等价实现）
#   - misc-linux.bin：切到 Android 之前，在 OpenWrt 里从 /run/mu300/misc-bc-linux-trial.bin 复制出来
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${MISC_LINUX_BIN:-$HERE/misc-linux.bin}"
ANDROID_IP="${ANDROID_IP:-192.168.0.1}"
SHARE="${SHARE:-//$ANDROID_IP/F50}"
PORT="${F50_PORT:-4444}"
[ -f "$BIN" ] || { echo "缺少 $BIN（从 OpenWrt 的 /run/mu300/misc-bc-linux-trial.bin 复制过来）"; exit 1; }

ping -c1 -W2 "$ANDROID_IP" >/dev/null 2>&1 || {
  echo "$ANDROID_IP 不在线。若设备在 OpenWrt（192.168.77.1），改用："
  echo "    adb shell 'mu300-next-boot android; sync; reboot -f'"
  exit 1; }

echo "1/3 上传 32 字节引导块"
smbclient "$SHARE" -N -c "put $BIN misc-linux.bin" >/dev/null 2>&1 || { echo "上传失败（root 通道触发失败？）"; exit 1; }

echo "2/3 写 misc + 改 default-boot"
printf '%s\nexit\n' '
  dd if=/mnt/sdcard/DCIM/misc-linux.bin of=/dev/block/by-name/misc bs=1 seek=2048 conv=notrunc 2>/dev/null
  sync
  mkdir -p /data/local/tmp/mu
  if mount -t ext4 -o rw /dev/block/mmcblk1p1 /data/local/tmp/mu 2>/dev/null; then
    echo linux > /data/local/tmp/mu/openwrt-luci/etc/mu300/default-boot
    sync; umount /data/local/tmp/mu
    echo "  default-boot = linux"
  else
    echo "  警告：挂载失败，只写了 misc —— 进 OpenWrt 后补一条 mu300-next-boot linux"
  fi
  echo -n "  misc 回读: "
  dd if=/dev/block/by-name/misc bs=1 skip=2048 count=32 2>/dev/null | od -An -tx1 | head -1
' | timeout 60 nc "$ANDROID_IP" "$PORT"

echo "3/3 完成。重启后进入 OpenWrt。"
