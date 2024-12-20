# Setting up a Captive Portal on Raspberry Pi

## This was originally developed for a Raspberry Pi but could theoretically work on any Linux device with WLAN capabilities.

## Prerequisites
1. **Operating System**: Parrot OS 6.2 (RPi Edition) or any Ubuntu/Debian RPi distro
2. **Network Setup**: Ethernet cable connection on `eth0`

## Step 1: Install Required Packages
```bash
sudo apt update
sudo apt upgrade
sudo apt install -y net-tools iptables iptables-persistent dnsmasq tcpdump nodejs
```

## Step 2: Configure `dnsmasq`

### Edit the `dnsmasq` configuration file:
```bash
sudo nano /etc/dnsmasq.conf
```

Add the following lines:
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
sudo iptables -A INPUT -d <SERVER_IP>/32 -p tcp -m tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp -m tcp --dport 443 -j REJECT --reject-with icmp-port-unreachable
```

### Forwarding rules:
```bash
sudo iptables -A FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
sudo iptables -A FORWARD -i lo -j ACCEPT
sudo iptables -A FORWARD -i eth0 -j ACCEPT
sudo iptables -A FORWARD -d <SERVER_IP>/32 -p tcp -m tcp --dport 443 -j ACCEPT
```

### NAT rules:
```bash
sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
```

## Step 6: Blocking and Redirecting Traffic

### Blocking and redirecting:
Run a script to add the following rules for each IP in the range `192.168.1.2 - 192.168.1.100`:
```bash
sudo iptables -t nat -A PREROUTING -i wlan0 -p tcp -s $UNAUTHENTICATED_DEVICE_IP --dport 80 -j DNAT --to-destination 192.168.1.1:8080
sudo iptables -A FORWARD -i wlan0 -p tcp -s $UNAUTHENTICATED_DEVICE_IP --dport 443 -j REJECT --reject-with icmp-port-unreachable
```

### Allow authenticated users:
```bash
sudo iptables -t nat -D PREROUTING -i wlan0 -p tcp -s $AUTHENTICATED_DEVICE_IP --dport 80 -j DNAT --to-destination 192.168.1.1:8080
sudo iptables -D FORWARD -i wlan0 -p tcp -s $AUTHENTICATED_DEVICE_IP --dport 443 -j REJECT --reject-with icmp-port-unreachable
```

### Save changes:
```bash
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

## Step 7: SSH Reverse Tunnel

### Allow connections on port 4000:
```bash
sudo iptables -A INPUT -p tcp --dport 4000 -j ACCEPT
```

### Generate SSH key pair:
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
```

### Add the public key to the remote server:
Copy the contents of `~/.ssh/id_ed25519.pub` to the `~/.ssh/authorized_keys` file on the remote server.

### Establish the SSH tunnel:
```bash
ssh -R 4000:localhost:4001 root@<SERVER_IP>
```

### Install `autossh` for persistent connections:
```bash
sudo apt-get install autossh
autossh -M 0 -f -N -R 4000:localhost:4001 root@<SERVER_IP>
```

## Step 8: Node.js Services

### Node Listener Service

#### Responsibilities
1. Listens on port `4001` for requests from the remote server (port `4000`) through a reverse SSH tunnel.
2. Creates/updates user sessions for authenticated users.
3. Grants or denies internet access based on session state.
4. Periodically disconnects users after 1 hour of internet access.

#### Steps to Set Up
1. **Copy Code to a file**
  - Create a file and paste the contents of [`listener.js`](../local-auth-server/listener.js) into it.
  ```bash
   sudo nano /opt/captive-portal-listener-node/listener.js
   ```
2. **Install Dependencies**
   ```bash
   cd /opt/captive-portal-listener-node
   npm install
   ```
3. **Create a Systemd Service**
   ```bash
   sudo nano /etc/systemd/system/node-listener.service
   ```
   **Service Configuration:**
   ```ini
   [Unit]
   Description=Node.js Listener Service
   After=network.target

   [Service]
   ExecStart=/usr/bin/node /opt/captive-portal-listener-node/listener.js
   WorkingDirectory=/opt/captive-portal-listener-node
   Restart=always
   User=root
   Group=root
   Environment=NODE_ENV=production
   Environment=PORT=4001
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=node-listener

   [Install]
   WantedBy=multi-user.target
   ```
4. **Start and Enable the Service**
   ```bash
   sudo systemctl enable node-listener.service
   sudo systemctl start node-listener.service
   ```

### Captive Portal Proxy Service

#### Description
A Node.js service that creates a proxy server to intercept HTTP requests and redirect users to a captive portal. The service captures client information (IP, MAC address, user agent) and sends it to the remote server.

#### Key Features
- HTTP request interception
- Automatic client redirection to captive portal
- Client information tracking (IP, MAC, User Agent)


#### Installation & Setup

1. **Copy Code to a file**
   - Create a file and paste the contents of [`captive-http-redirect-proxy.js`](../http-redirect-proxy-node/captive-http-redirect-proxy.js) into it.

   ```bash
   sudo nano /opt/http-redirect-proxy-node/captive-http-redirect-proxy.js
   ```

2. **Install Dependencies**
   ```bash
   npm install
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
   ExecStart=/usr/bin/node /path/to/your/proxy-server.js
   WorkingDirectory=/path/to/your/directory
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

#### Configuration
- Default port: 8080
- Default IP: 192.168.1.1
- Captive portal target: http://[YOUR_CAPTIVE_SUBDOMAIN]

### Helpful SQLite Commands
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