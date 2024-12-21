# Setting up a Captive Portal on Raspberry Pi

> Note: While designed for Raspberry Pi, this implementation is compatible with any Linux system featuring WLAN capabilities.

## Prerequisites
1. **Operating System**: Parrot OS 6.2 (RPi Edition) or any Ubuntu/Debian RPi distro
2. **Network Setup**: Ethernet cable connection (in RPi case on interface `eth0`)

## Step 1: Install Required Packages
```bash
sudo apt update
sudo apt upgrade
sudo apt install -y iptables iptables-persistent dnsmasq tcpdump nodejs npm apache2
```
---

#### Use a Custom Local Domain
##### Point domain to the RPi ip of wlan0 interface (192.168.1.1)
   ```bash
   sudo nano /etc/hosts
   ```
   Add this line:
   ```
   192.168.1.1 captive.local
   ```

## Step 2: Configure `dnsmasq`

### Edit the `dnsmasq` configuration file:
```bash
sudo nano /etc/dnsmasq.conf
```

Add the following lines:
> Note: Replace <SERVER_IP> with the ip you added in /etc/hosts
```conf
# Disable re-directing DNS requests
no-resolv

# Specify custom DNS servers
server=1.1.1.1
server=8.8.8.8

# Set the IP range for connected devices
dhcp-range=192.168.1.2,192.168.1.100,12h

# Set domains to resolve locally
address=/captive.example.com/<SERVER_IP>

# Captive portal detection domains
address=/connectivitycheck.android.com/<SERVER_IP>
address=/www.android.com/<SERVER_IP>
address=/clients3.google.com/<SERVER_IP>
address=/connectivitycheck.gstatic.com/<SERVER_IP>

# Apple devices
address=/captive.apple.com/<SERVER_IP>
address=/www.apple.com/<SERVER_IP>
address=/ipv6.apple.com/<SERVER_IP>

# Windows
address=/msftncsi.com/<SERVER_IP>
address=/www.msftncsi.com/<SERVER_IP>
```

### Restart `dnsmasq` to apply changes:
```bash
sudo systemctl restart dnsmasq
```

### Disable `systemd-resolved`:
```bash
sudo systemctl stop systemd-resolved
sudo systemctl disable systemd-resolved
```
---
## Step 3: Configure `NetworkManager`

### Edit `NetworkManager.conf`:
```bash
sudo nano /etc/NetworkManager/NetworkManager.conf
```
Add or modify the following lines:
```conf
[main]
plugins=ifupdown,keyfile
#dns=dnsmasq

[ifupdown]
managed=true
```

### Create a Hotspot using `nmcli`:
1. **Create the base connection:**
```bash
sudo nmcli connection add \
    type wifi \
    ifname wlan0 \
    con-name Hotspot \
    autoconnect yes \
    ssid CaptivePortal \
    mode ap \
    ipv4.method shared
```

2. **Set IP address and network settings:**
```bash
sudo nmcli connection modify Hotspot \
    ipv4.method manual \
    ipv4.addresses 192.168.1.1/24 \
    ipv4.gateway 192.168.1.1 \
    ipv4.never-default yes
```

3. **Add Wi-Fi security (optional):**
```bash
sudo nmcli connection modify Hotspot \
    wifi-sec.key-mgmt wpa-psk \
    wifi-sec.psk "<YOUR_PASSWORD>"
```

4. **Disable DNS settings:**
```bash
sudo nmcli connection modify Hotspot \
    ipv4.dns "" \
    ipv4.dns-search "" \
    ipv4.ignore-auto-dns yes
```

5. **Bring the hotspot online:**
```bash
sudo nmcli connection up Hotspot
```
---
## Step 4: Enable IP Forwarding

### Edit `sysctl.conf`:
```bash
sudo nano /etc/sysctl.conf
```
Uncomment the following line:
```conf
net.ipv4.ip_forward=1
```

### Apply changes:
```bash
sudo sysctl -p
```
---
## Step 5: Setup Firewall Rules

### Default policies:
```bash
sudo iptables -P INPUT ACCEPT
sudo iptables -P FORWARD ACCEPT
sudo iptables -P OUTPUT ACCEPT
```

### Basic rules:
```bash
sudo iptables -A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT
sudo iptables -A INPUT -i lo -j ACCEPT 
sudo iptables -A INPUT -p tcp -m tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -i eth0 -j ACCEPT
sudo iptables -A INPUT -d 192.168.1.1 -p tcp -m tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp -m tcp --dport 443 -j REJECT --reject-with icmp-port-unreachable
sudo iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
sudo iptables -A FORWARD -i lo -j ACCEPT
sudo iptables -A FORWARD -i eth0 -j ACCEPT
sudo iptables -A FORWARD -i wlan0 -d captive.local -j ACCEPT
sudo iptables -A FORWARD -d 192.168.1.1 -p tcp -m tcp --dport 443 -j ACCEPT
```

### NAT rules:
```bash
sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
sudo iptables -t nat -A PREROUTING -i wlan0 -p tcp --dport 80 -j DNAT --to-destination 192.168.1.1:8080
```
---
## Step 6: Blocking (HTTPS) and Redirecting (HTTP) Traffic

### Blocking and redirecting:
#### We will run a script ([`iptables-blocking/iptables_blocking_rules.sh`](https://github.com/ganainy/raspberrypi-captive-portal/blob/local-login/iptables-blocking/iptables_blocking_rules.sh) to add the following rules for each IP in the range `192.168.1.2 - 192.168.1.100`:
```bash
sudo iptables -t nat -A PREROUTING -i wlan0 -p tcp -s $UNAUTHENTICATED_DEVICE_IP --dport 80 -j DNAT --to-destination 192.168.1.1:8080
sudo iptables -A FORWARD -i wlan0 -p tcp -s $UNAUTHENTICATED_DEVICE_IP --dport 443 -j REJECT --reject-with icmp-port-unreachable
```

### Allow authenticated users:
#### This will be done automatically when the local auth server [`/auth-server/auth_api.js`](https://github.com/ganainy/raspberrypi-captive-portal/blob/local-login/auth-server/auth_api.js) gets a request from the server to log in an authenticated device
```bash
sudo iptables -t nat -D PREROUTING -i wlan0 -p tcp -s $AUTHENTICATED_DEVICE_IP --dport 80 -j DNAT --to-destination 192.168.1.1:8080
sudo iptables -D FORWARD -i wlan0 -p tcp -s $AUTHENTICATED_DEVICE_IP --dport 443 -j REJECT --reject-with icmp-port-unreachable
```

### Save changes:
```bash
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```
---
### Captive Portal Proxy Service
#### Description
A Node.js service that creates a proxy server to intercept HTTP requests and redirect users to a captive portal. The service captures client information (IP, MAC address, user agent) and sends it to the server.

#### Key Features
- HTTP request interception
- Automatic client redirection to captive portal
- Client information tracking (IP, MAC, User Agent)


#### Installation & Setup

1. **Copy Code to a file**
   - Copy content of this folder to RPi [`http-redirect-proxy-node/`](https://github.com/ganainy/raspberrypi-captive-portal/blob/local-login/http-redirect-proxy-node/captive-http-redirect-proxy.js) into it.

   ```bash
   sudo mkdir /opt/http-redirect-proxy-node/
   cd /opt/http-redirect-proxy-node/
   ```

2. **Install Dependencies**
   ```bash
   sudo npm init -y
   sudo npm install http-proxy -y
   ```

3. **Create Systemd Service**
   ```bash
   sudo nano /etc/systemd/system/captive-portal.service
   ```

   Add the following configuration:
   ```ini
   [Unit]
   Description=Captive Portal Proxy Service
   After=network.target

   [Service]
   ExecStart=/usr/bin/node /opt/http-redirect-proxy-node/captive-http-redirect-proxy.js
   WorkingDirectory=/opt/http-redirect-proxy-node
   Restart=always
   User=root
   Group=root
   Environment=NODE_ENV=production
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=captive-portal

   [Install]
   WantedBy=multi-user.target
   ```

4. **Enable and Start the Service**
   ```bash
   sudo systemctl enable captive-portal
   sudo systemctl start captive-portal
   ```

5. **Check Service Status**
   ```bash
   sudo systemctl status captive-portal
   ```



---
### Step 9:(Optional: helpful SQLite Commands to see the Sessions database) 
- Open the database:
  ```bash
  sqlite3 /path-to-db/[DB_NAME].db
  ```
- Enable better formatting:
  ```sql
  .headers on
  .mode column
  ```
- View tables:
  ```sql
  .tables
  ```
- Show table schema:
  ```sql
  .schema <table_name>
  ```
- View table content:
  ```sql
  SELECT * FROM <table_name>;
  ```
- Exit SQLite:
  ```sql
  .exit
  ```