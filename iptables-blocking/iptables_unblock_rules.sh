#!/bin/bash

# Define the IP range and interface
IP_START=2
IP_END=11
INTERFACE="wlan0"

# Define the first rule variables
PROTO_TCP="tcp"
PORT_80=80
DEST_IP="192.168.1.1"
DEST_PORT=8080

# Define the second rule variables
PORT_443=443
REJECT_TYPE="icmp-port-unreachable"

# Loop through the IP range
for i in $(seq $IP_START $IP_END); do
    SOURCE_IP="192.168.1.$i"

    # Check if the first rule exists and remove it
    iptables -t nat -C PREROUTING -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_80 -j DNAT --to-destination $DEST_IP:$DEST_PORT 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "Removing DNAT rule for $SOURCE_IP:$PORT_80"
        iptables -t nat -D PREROUTING -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_80 -j DNAT --to-destination $DEST_IP:$DEST_PORT
    else
        echo "Rule for $SOURCE_IP:$PORT_80 does not exist."
    fi

    # Check if the second rule exists and remove it
    iptables -C FORWARD -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_443 -j REJECT --reject-with $REJECT_TYPE 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "Removing reject rule for $SOURCE_IP:$PORT_443"
        iptables -D FORWARD -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_443 -j REJECT --reject-with $REJECT_TYPE
    else
        echo "Rule for $SOURCE_IP:$PORT_443 does not exist."
    fi
done