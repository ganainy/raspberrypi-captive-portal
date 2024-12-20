# IPTables Blocking Rules Script

## Description

This script uses `iptables` to:

- Block HTTPS traffic
- Redirect HTTP traffic to port `8080`, where a Node.js proxy will be listening
- Block IPs in the range `192.168.1.2` to `192.168.1.100`

## Instructions

1. Make the script executable:
   ```bash
   sudo chmod +x iptables_blocking_rules.sh
2. Run the script:
  ```bash
  sudo ./iptables_blocking_rules.sh