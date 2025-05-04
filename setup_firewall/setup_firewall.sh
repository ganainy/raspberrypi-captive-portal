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
sudo iptables -P FORWARD DROP  # Default to DROP for better security
sudo iptables -P OUTPUT ACCEPT

# Allow established connections and related traffic
sudo iptables -A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
sudo iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT

# Allow loopback traffic
sudo iptables -A INPUT -i lo -j ACCEPT

# Allow SSH access for management
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow incoming connections to the local Node.js services
sudo iptables -A INPUT -p tcp --dport 4001 -j ACCEPT  # Listener service
sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT  # HTTP proxy

# Basic NAT - Enable internet connection sharing
sudo iptables -t nat -A POSTROUTING -o $ETH_INTERFACE -j MASQUERADE

# --- Client authentication rules ---

# 1. Allow all clients to access DNS (port 53) for name resolution
sudo iptables -A FORWARD -i $WLAN_INTERFACE -p udp --dport 53 -j ACCEPT
sudo iptables -A FORWARD -i $WLAN_INTERFACE -p tcp --dport 53 -j ACCEPT

# 2. Allow all clients to access the remote auth server (CRITICAL)
sudo iptables -A FORWARD -i $WLAN_INTERFACE -d $AUTH_SERVER_IP -j ACCEPT

# 3. Block all other HTTPS traffic from unauthenticated clients
# (This will be modified by the Node.js listener for authenticated clients)
for IP in $(seq -f "$DHCP_RANGE_START" 1 "$DHCP_RANGE_END"); do
    sudo iptables -A FORWARD -i $WLAN_INTERFACE -s $IP -p tcp --dport 443 -j REJECT --reject-with icmp-port-unreachable
done

# 4. Redirect all HTTP traffic to the captive portal
# (These rules will be removed by the Node.js listener for authenticated clients)
for IP in $(seq -f "$DHCP_RANGE_START" 1 "$DHCP_RANGE_END"); do
    sudo iptables -t nat -A PREROUTING -i $WLAN_INTERFACE -p tcp -s $IP --dport 80 -j DNAT --to-destination $LOCAL_IP:$CAPTIVE_PORTAL_PORT
done

# Save the rules
sudo iptables-save | sudo tee /etc/iptables/rules.v4