# Changing Internet Source for the Raspberry Pi

This guide explains how to change the device providing internet to your Raspberry Pi and ensure the captive portal continues working properly.

## Steps to Change Internet Source

### 1. Configure the New Internet Source Device

#### For Windows:
- Enable internet connection sharing in the Network Adapter settings for the adapter that provides internet
- Select the Ethernet adapter connected to the RPi as the adapter to share with

#### For Linux:
```bash
# Enable IP forwarding
sudo sysctl -w net.ipv4.ip_forward=1

# Add masquerade rule
sudo iptables -t nat -A POSTROUTING -o <internet_interface> -j MASQUERADE
```

### 2. Reboot the Raspberry Pi
This will allow it to obtain a new local IP (typically in the 192.168.137.x range)

### 3. Verify Services
```bash
# Check if all 3 captive portal services are running
systemctl list-units --type=service --state=running

# Restart and check dnsmasq specifically
sudo systemctl restart dnsmasq
sudo systemctl status dnsmasq
```

## Troubleshooting
If the captive portal is not working after changing the internet source:

1. Check that the RPi received a valid IP address
2. Verify all three captive portal services are running:
   ```bash
   systemctl list-units --type=service | grep captiveportal
   ```
3. Check the services logs for any errors:
   ```bash
   sudo journalctl -fu captiveportal-listener.service captiveportal-proxy.service captiveportal-ssh-tunnel.service
   ```