#!/system/bin/sh
# F50-MU3350S-OpenWRT: device-side root channel setup.
# Run as root on the Android side (the host wrapper scripts/setup-device-root.mjs sends
# this file through the already-open root shell; see docs/04-root-channel.md).
#
# It installs:
#   /data/local/tmp/root.sh        Samba `root preexec` target: starts the socat root shell,
#                                  bind-mounts the `su` shim over /odm/bin, re-arms adb over TCP
#   /data/local/tmp/rootbin/su     `su` replacement: forwards to the root shell on 127.0.0.1:4444
#   /odm/bin                       bind-mounted from /data/local/tmp/rootbin (PATH has /odm/bin)
#   socat TCP 4444                 root shell (needs /data/local/tmp/socat, see docs)
set +e
LOG=/data/local/tmp/root.log
echo "[$(date)] setup start" >> "$LOG"
if [ ! -x /data/local/tmp/socat ]; then
  echo "F50-SETUP-NEEDS-SOCAT"
  echo "push the socat binary to /data/local/tmp/socat first (see docs/04-root-channel.md)" >&2
  exit 1
fi
chmod 755 /data/local/tmp/socat
mkdir -p /data/local/tmp/rootbin

cat > /data/local/tmp/root.sh <<'RSEOF'
#!/system/bin/sh
LOG=/data/local/tmp/root.log
echo "[$(date)] root.sh start" >> $LOG
chmod 755 /data/local/tmp/socat 2>/dev/null
if ! pidof socat >/dev/null 2>&1; then nohup /data/local/tmp/socat TCP-LISTEN:4444,reuseaddr,fork EXEC:/system/bin/sh >> $LOG 2>&1 & fi
if [ -x /data/local/tmp/rootbin/su ]; then mount --bind /data/local/tmp/rootbin /odm/bin 2>>$LOG; fi
setprop service.adb.tcp.port 5555 2>>$LOG
setprop persist.service.adb.tcp.port 5555 2>>$LOG
echo "[$(date)] root.sh done" >> $LOG
exit 0
RSEOF
chmod 755 /data/local/tmp/root.sh

cat > /data/local/tmp/rootbin/su <<'SUEOF'
#!/system/bin/sh
# su shim: forwards to the root shell socket on localhost:4444.
if [ "$1" = "-c" ]; then shift; CMD="$1"; else CMD="$*"; fi
TMP=/data/local/tmp/.su.$$
{ printf '{ %s ; } 2>&1; echo "__SU_RC__$?"; exit\n' "$CMD"; } | /data/local/tmp/socat - TCP:127.0.0.1:4444 2>/dev/null > "$TMP"
RC=$(sed -n 's/^__SU_RC__//p' "$TMP" | tail -1)
sed '/^__SU_RC__/d' "$TMP"
rm -f "$TMP"
case "$RC" in ''|*[!0-9]*) exit 0 ;; *) exit "$RC" ;; esac
SUEOF
chmod 755 /data/local/tmp/rootbin/su
cp -f /odm/bin/fm_tools /data/local/tmp/rootbin/ 2>/dev/null
mount --bind /data/local/tmp/rootbin /odm/bin 2>>"$LOG"
sh /data/local/tmp/root.sh
echo "F50-SETUP-DONE"
exit 0
