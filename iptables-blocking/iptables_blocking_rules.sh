

#-------------steps to execute this script on the RPi-------------------

#	1-copy content to a file on the RPi with .sh extension  ->    sudo nano iptables_blocking_rules.sh
#	2- Make it executable     ->    sudo chmod +x iptables_blocking_rules.sh
#	3- Run it     ->  sudo ./iptables_blocking_rules.sh



#!/bin/bash

# Define the IP range and interface
IP_START=2
IP_END=100
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

    # Check if the first rule already exists
    iptables -t nat -C PREROUTING -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_80 -j DNAT --to-destination $DEST_IP:$DEST_PORT 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "Adding rule to DNAT traffic from $SOURCE_IP:$PORT_80 to $DEST_IP:$DEST_PORT"
        iptables -t nat -A PREROUTING -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_80 -j DNAT --to-destination $DEST_IP:$DEST_PORT
    else
        echo "Rule for $SOURCE_IP:$PORT_80 already exists."
    fi

    # Check if the second rule already exists
    iptables -C FORWARD -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_443 -j REJECT --reject-with $REJECT_TYPE 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "Adding rule to reject traffic from $SOURCE_IP:$PORT_443 with $REJECT_TYPE"
        iptables -A FORWARD -i $INTERFACE -p $PROTO_TCP -s $SOURCE_IP --dport $PORT_443 -j REJECT --reject-with $REJECT_TYPE
    else
        echo "Rule for $SOURCE_IP:$PORT_443 already exists."
    fi

done
