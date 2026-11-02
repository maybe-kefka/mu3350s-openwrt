#!/bin/sh
ip netns add c1 2>/dev/null
ip link add veth-h type veth peer name veth-c1 2>/dev/null
ip link set veth-h master br-lan 2>/dev/null
ip link set veth-h up
ip link set veth-c1 netns c1 2>/dev/null
ip netns exec c1 ip link set lo up
ip netns exec c1 ip link set veth-c1 up
ip netns exec c1 udhcpc -q -n -i veth-c1 -t 3 -T 2 >/dev/null 2>&1
echo '-- after dhcp:'; ip netns exec c1 ip -4 addr show veth-c1 | grep inet
GW=$(ip netns exec c1 ip route | awk '/default/{print $3}' | head -1)
echo "-- gateway: $GW"
echo '-- dns fake-ip:'; ip netns exec c1 nslookup www.google.com $GW 2>&1 | tail -3
GOOG=$(ip netns exec c1 nslookup www.google.com $GW 2>/dev/null | awk '/^Address: /{print $2}' | tail -1)
BAIDU=$(ip netns exec c1 nslookup www.baidu.com $GW 2>/dev/null | awk '/^Address: /{print $2}' | tail -1)
echo "-- fake-ip baidu=$BAIDU google=$GOOG"
echo '-- baidu:'; ip netns exec c1 curl -4 -s -o /dev/null -w 'code=%{http_code} t=%{time_total}\n' --max-time 15 --resolve www.baidu.com:80:$BAIDU http://www.baidu.com/
echo '-- google:'; ip netns exec c1 curl -4 -s -o /dev/null -w 'code=%{http_code} t=%{time_total}\n' --max-time 20 --resolve www.google.com:443:$GOOG https://www.google.com/
echo '-- egress ip:'; ip netns exec c1 curl -4 -s -k --max-time 15 https://1.1.1.1/cdn-cgi/trace | grep '^ip='
ip netns del c1 2>/dev/null
ip link del veth-h 2>/dev/null
echo DONE