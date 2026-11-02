#!/bin/sh
# apply / remove mihomo TPROXY rules
case "$1" in
start)
  ip rule show | grep -q "fwmark 0x1 lookup 100" || ip rule add fwmark 0x1 lookup 100
  ip route show table 100 2>/dev/null | grep -q "local 0.0.0.0/0" || ip route add local 0.0.0.0/0 dev lo table 100
  nft delete table inet mihomo 2>/dev/null
  nft -f /etc/mihomo/tproxy.nft
  ;;
stop)
  nft delete table inet mihomo 2>/dev/null
  ip rule del fwmark 0x1 lookup 100 2>/dev/null
  ip route flush table 100 2>/dev/null
  ;;
esac
exit 0
