# IPTables Blocking Rules Setup

This script manages the network traffic rules for the captive portal by configuring iptables on the Raspberry Pi.

## Purpose
The script will add iptables rules for a given range of IP addresses to:
- Block HTTPS traffic for unauthenticated users
- Redirect HTTP traffic to port `8080` where a Node.js proxy will be listening
- Manage traffic for IPs in the range `192.168.1.2` to `192.168.1.11`

## Setup Instructions

1. Copy the script content to your Raspberry Pi:
   ```bash
   sudo nano iptables_blocking_rules.sh
   ```
   Then paste the contents of `iptables_blocking_rules.sh` into the editor

2. Make the script executable:
   ```bash
   sudo chmod +x iptables_blocking_rules.sh
   ```

3. Run the script:
   ```bash
   sudo ./iptables_blocking_rules.sh
   ```

## What the Script Does

The script loops through the configured IP range and for each IP address:

1. Creates a DNAT rule to redirect HTTP traffic (port 80) to the local proxy server (port 8080)
2. Creates a rule to reject HTTPS traffic (port 443)
3. Checks for existing rules to avoid duplicates
4. Provides feedback about which rules are being added

## Note
Make sure to run this script with sudo privileges as it requires root access to modify iptables rules.

## Removing Rules
If you need to remove all the iptables rules created by this script, you can run the unblock script:
```bash
sudo ./iptables_unblock_rules.sh
```
This will remove all DNAT and reject rules that were previously added for the IP range.