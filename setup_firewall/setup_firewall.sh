#!/bin/bash

# Define variables
WLAN_INTERFACE="wlan0"
ETH_INTERFACE="eth0"
LOCAL_IP="192.168.1.1"
CAPTIVE_PORTAL_PORT="8080"
AUTH_SERVER_DOMAIN="captive.ganainy.online"
AUTH_SERVER_IP="13.61.79.152"
DHCP_RANGE_START="192.168.1.2"
DHCP_RANGE_END="192.168.1.11"

# Clear existing rules
sudo iptables -F
sudo iptables -t nat -F
sudo iptables -X

# Set default policies
sudo iptables -P INPUT ACCEPT
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT

# Allow established/related connections
sudo iptables -A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
sudo iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT

# Allow loopback
sudo iptables -A INPUT -i lo -j ACCEPT

# Allow SSH and local services
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 4001 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT

# Enable NAT (internet sharing)
sudo iptables -t nat -A POSTROUTING -o $ETH_INTERFACE -j MASQUERADE

# Allow DNS for clients
sudo iptables -A FORWARD -i $WLAN_INTERFACE -p udp --dport 53 -j ACCEPT
sudo iptables -A FORWARD -i $WLAN_INTERFACE -p tcp --dport 53 -j ACCEPT

# Allow access to remote auth server
sudo iptables -A FORWARD -i $WLAN_INTERFACE -d $AUTH_SERVER_IP -j ACCEPT

# Extract IP range for loop
IFS=. read i1 i2 i3 start <<< "${DHCP_RANGE_START}"
IFS=. read _ _ _ end <<< "${DHCP_RANGE_END}"

# For each possible client IP
for i in $(seq $start $end); do
  IP="$i1.$i2.$i3.$i"
  
  # Drop all HTTPS traffic (cleaner than REJECT, no error message sent back)
  sudo iptables -A FORWARD -i $WLAN_INTERFACE -s $IP -p tcp --dport 443 -j DROP
  
  # Redirect HTTP to captive portal
  sudo iptables -t nat -A PREROUTING -i $WLAN_INTERFACE -p tcp -s $IP --dport 80 -j DNAT --to-destination $LOCAL_IP:$CAPTIVE_PORTAL_PORT
done

# Save rules
sudo iptables-save | sudo tee /etc/iptables/rules.v4
