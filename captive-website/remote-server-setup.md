# Guide: Setting Up Domain, EC2, and Web Servers

## Getting a domain with Spaceship (or any domain seller)
1. Create an account on Spaceship (spaceship.com)
2. Complete the domain purchase and registration

## AWS Setup

### Create EC2 Instance (to host the login website & auth api & database)
1. Log into AWS Console
2. Navigate to EC2 Dashboard
3. Click "Launch Instance"
4. Choose "Ubuntu Server" (latest LTS version)
5. Select instance type (t2.micro for free tier)
6. Configure security groups:
   - Allow HTTP (port 80)
   - Allow HTTPS (port 443)
   - Allow SSH (port 22)
   - Allow TCP (port 3000 & 4000)
7. Create or select existing key pair
8. Launch instance

### Elastic IP Setup (for having a persistent IP to link to the domain purchased)
1. Navigate to "Elastic IPs" in EC2 Dashboard
2. Click "Allocate Elastic IP address"
3. Select the allocated IP
4. Click "Actions" → "Associate IP address"
5. Select your EC2 instance
6. Complete association

### Route53 Setup (link domain & subdomains to the server ip)
1. Go to Route53 Dashboard
2. Create a hosted zone for "yourdomain.com"
3. Important: update nameservers at Spaceship with Route53 nameservers
4. Create A records:
   ```
   [YOUR_CAPTIVE_SUBDOMAIN] → [Your Elastic IP]
   ```

## Server Configuration

### Initial Server Setup
1. SSH into your EC2 instance:
   ```bash
   ssh -i your-key.pem ubuntu@your-elastic-ip
   ```

2. Update system:
   ```bash
   sudo apt update
   sudo apt upgrade -y
   ```

### Apache2 Installation and Setup
1. Install Apache2:
   ```bash
   sudo apt install apache2 -y
   ```

2. Enable required modules:
   ```bash
   sudo a2enmod proxy
   sudo a2enmod proxy_http
   sudo a2enmod ssl
   sudo a2enmod rewrite
   ```

3. Create virtual hosts:
### Apache2 Virtual Host Configuration
1. Create virtual host for captive portal:
   ```bash
   sudo nano /etc/apache2/sites-available/[YOUR_CAPTIVE_SUBDOMAIN].conf
   ```
   Copy the contents from `captive-website/server/apache-config.example.conf` into this new file.
   **Important:** Remember to replace placeholders like `your.domain.com` with your actual domain/subdomain and update the paths to your SSL certificate files (`SSLCertificateFile` and `SSLCertificateKeyFile`).

2. Enable additional required Apache modules:
   ```bash
   sudo a2enmod ssl
   sudo a2enmod headers
   sudo a2enmod proxy
   sudo a2enmod proxy_http
   sudo a2enmod rewrite
   ```

Note: Replace `[YOUR_CAPTIVE_SUBDOMAIN]` with your actual domain name in the SSL certificate paths. Also ensure that you have already obtained SSL certificates using Certbot (see Wildcard SSL Certificate Setup with DNS Challenge below) before activating these configurations.

4. Create web directories:
   ```bash
   sudo mkdir -p /var/www/captive/client
   ```

5. Set permissions:
   ```bash
   sudo chown -R www-data:www-data /var/www/captive/client
   ```

### Enable Sites and Restart Apache
1. Enable virtual hosts:
   ```bash
   sudo a2ensite [YOUR_CAPTIVE_SUBDOMAIN].conf
   ```

2. Disable default site:
   ```bash
   sudo a2dissite 000-default.conf
   ```

3. Test configuration:
   ```bash
   sudo apache2ctl configtest
   ```

4. Restart Apache:
   ```bash
   sudo systemctl restart apache2
   ```

### SSL Setup 
1. Install Certbot:
   ```bash
   sudo apt install certbot python3-certbot-apache -y
   ```

# Wildcard SSL Certificate Setup with DNS Challenge

## Steps

### 1. Install Certbot
```bash
sudo apt update
sudo apt install certbot python3-certbot-apache
```

### 2. Request Certificate
```bash
sudo certbot certonly --manual --preferred-challenges dns \
  -d [YOUR_DOMAIN] \
  -d *.[YOUR_DOMAIN]
```

### 3. Add DNS Records
1. Certbot will provide a TXT record value
2. Go to your DNS provider (e.g., Route53)
3. Add TXT record with:
   - Name: `_acme-challenge.[YOUR_DOMAIN]`
   - Value: (provided by Certbot)
4. Wait 5-10 minutes for DNS propagation
5. Press Enter in Certbot to continue

### 4. Verify Certificate
```bash
sudo ls /etc/letsencrypt/live/[YOUR_DOMAIN]/
```
Should show:
- fullchain.pem
- privkey.pem
- cert.pem
- chain.pem

### 5. Configure Certificate Paths
Use in Apache configs:
- Certificate: `/etc/letsencrypt/live/[YOUR_DOMAIN]/fullchain.pem`
- Private key: `/etc/letsencrypt/live/[YOUR_DOMAIN]/privkey.pem`

### 6. Restart Apache
```bash
sudo systemctl restart apache2
```

Notes:
- Certificate valid for 90 days
- Manual renewal needed (no auto-renewal with DNS challenge)


# Node.js Auth API Setup Guide (to receive login request from the remote website)

## Prerequisites
- Node.js installed
- SSL certificates already set up
- MySQL server installed

## Steps

### 1. Create Project Directory
```bash
# Example: Create a directory to hold the server-side code on the EC2 instance
sudo mkdir -p /opt/captive-portal/server 
cd /opt/captive-portal/server 
```

### 2. Initialize Project
```bash
# Initialize npm project within the server directory
npm init -y
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Create Configuration Files
1. Create `.env` file in the server project directory:
```bash
sudo nano /opt/captive-portal/server/.env 
```
Add the required variables based on `captive-website/server/.env.example`:
```env
PORT=4000 # Or your desired port
DB_HOST=localhost
DB_USER=[YOUR_MYSQL_USER]
DB_PASSWORD=[YOUR_MYSQL_PASSWORD]
DB_NAME=[YOUR_DATABASE_NAME]
HTTPS_KEY_PATH=/etc/letsencrypt/live/[YOUR_DOMAIN]/privkey.pem
HTTPS_CERT_PATH=/etc/letsencrypt/live/[YOUR_DOMAIN]/fullchain.pem
```
*Make sure to replace placeholders with actual values.*

### 5. Create API File
1. Create `auth_api.js` in your server project directory (e.g., `/opt/captive-portal/server/auth_api.js`):
```bash
sudo nano /opt/captive-portal/server/auth_api.js
```
2. Copy the code from `captive-website/server/auth_api.js` into this file.
*Note: The code reads configuration from the `.env` file.*

### 6. Create MySQL Database and User
```bash
sudo mysql -u root -p
CREATE DATABASE [YOUR_DATABASE_NAME];
CREATE USER '[YOUR_MYSQL_USER]'@'localhost' IDENTIFIED BY '[YOUR_MYSQL_PASSWORD]';
GRANT ALL PRIVILEGES ON [YOUR_DATABASE_NAME].* TO '[YOUR_MYSQL_USER]'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```
*The `auth_api.js` script will create the necessary `users` table automatically.*

### 7. Run the Auth Server as a Service (systemd)
1. **Create a systemd service file**:
   ```bash
   sudo nano /etc/systemd/system/captiveportal-server-api.service
   ```

2. **Add the following content**:
   ```ini
   [Unit]
   Description=Captive Portal Server Auth API
   After=network.target mysql.service # Ensure network and DB are up

   [Service]
   ExecStart=/usr/bin/node /var/www/captive-website/server/auth_api.js
   WorkingDirectory=/var/www/captive-website/server
   Restart=always
   User=root
   Group=root
   Environment=NODE_ENV=production
   EnvironmentFile=/var/www/captive-website/server/.env
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=captiveportal-server-api

   [Install]
   WantedBy=multi-user.target
   ```
   *Replace paths and user/group as needed for your setup.*

3. **Reload systemd, enable and start the service**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable captiveportal-server-api.service
   sudo systemctl start captiveportal-server-api.service
   ```

4. **Check the service status**:
   ```bash
   sudo systemctl status captiveportal-server-api.service
   ```
   *Check logs using `journalctl -fu captiveportal-server-api.service`.*

### 8. Apache Reverse Proxy Update
Ensure your Apache virtual host for `[YOUR_CAPTIVE_SUBDOMAIN]` correctly proxies requests starting with `/api/` to the Node.js auth server running on the port defined in your `.env` file (default `4000`):
   ```apache
   # ... inside <VirtualHost *:443> for [YOUR_CAPTIVE_SUBDOMAIN] ...
   ProxyPass /api/ https://127.0.0.1:4000/
   ProxyPassReverse /api/ https://127.0.0.1:4000/
   # ... rest of config ...
   ```
   *Restart Apache after changes: `sudo systemctl restart apache2`*

### 9. Test the API
```bash
curl https://[YOUR_CAPTIVE_SUBDOMAIN]/api/hello_api
```

Notes:
- The Auth server API will run on port 4000 by default
- Users table will be created automatically
- API endpoints:
  - POST `/api/login_api`
  - POST `/api/signup_api`
  - GET `/api/users_api` (debug only, delete from `captive-website/server/auth_api.js` code if used in production)
  - GET `/api/hello_api` (debug only)
