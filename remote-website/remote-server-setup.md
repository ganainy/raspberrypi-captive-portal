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
   [YOUR_AUTH_SUBDOMAIN]→ [Your Elastic IP]
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
   Add:
   ```apache
   <VirtualHost *:443>
       ServerAdmin webmaster@localhost
       ServerName [YOUR_CAPTIVE_SUBDOMAIN]
       DocumentRoot /var/www/captive
       ErrorLog ${APACHE_LOG_DIR}/error.log
       CustomLog ${APACHE_LOG_DIR}/access.log combined
       SSLEngine on
       SSLCertificateFile /etc/letsencrypt/live/[YOUR_DOMAIN]/fullchain.pem
       SSLCertificateKeyFile /etc/letsencrypt/live/[YOUR_DOMAIN]/privkey.pem
       <FilesMatch "\.(?:cgi|shtml|phtml|php)$">
           SSLOptions +StdEnvVars
       </FilesMatch>
       <Directory /usr/lib/cgi-bin>
           SSLOptions +StdEnvVars
       </Directory>
       # Allow CORS for all origins
       <Directory /var/www/captive>
           Header set Access-Control-Allow-Origin "*"
           Header set Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, DELETE"
           Header set Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization"
       </Directory>
   </VirtualHost>

   <VirtualHost *:80>
       ServerAdmin webmaster@localhost
       ServerName [YOUR_CAPTIVE_SUBDOMAIN]
       # Redirect HTTP traffic to HTTPS
       Redirect permanent / https://[YOUR_CAPTIVE_SUBDOMAIN]/
       ErrorLog ${APACHE_LOG_DIR}/error.log
       CustomLog ${APACHE_LOG_DIR}/access.log combined
   </VirtualHost>
   ```

2. Create virtual host for auth server:
   ```bash
   sudo nano /etc/apache2/sites-available/[YOUR_AUTH_SUBDOMAIN].conf
   ```
   Add:
   ```apache
   <VirtualHost *:80>
       ServerName [YOUR_AUTH_SUBDOMAIN]
       # Redirect HTTP to HTTPS
       RewriteEngine On
       RewriteRule ^(.*)$ https://[YOUR_AUTH_SUBDOMAIN]$1 [R=301,L]
   </VirtualHost>

   <VirtualHost *:443>
       ServerName [YOUR_AUTH_SUBDOMAIN]
       # Enable SSL for the reverse proxy
       SSLProxyEngine On
       # SSL Configuration
       SSLEngine On
       SSLCertificateFile /etc/letsencrypt/live/[YOUR_DOMAIN]/fullchain.pem
       SSLCertificateKeyFile /etc/letsencrypt/live/[YOUR_DOMAIN]/privkey.pem
       # Proxy configuration
       ProxyPreserveHost On
       ProxyPass / http://127.0.0.1:4000/
       ProxyPassReverse / http://127.0.0.1:4000/
       # Allow CORS for all origins
       <Directory /var/www/captive>
           Header set Access-Control-Allow-Origin "*"
           Header set Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, DELETE"
           Header set Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization"
       </Directory>
       ErrorLog ${APACHE_LOG_DIR}/auth_error.log
       CustomLog ${APACHE_LOG_DIR}/auth_access.log combined
   </VirtualHost>
   ```

3. Enable additional required Apache modules:
   ```bash
   sudo a2enmod ssl
   sudo a2enmod headers
   sudo a2enmod proxy
   sudo a2enmod proxy_http
   sudo a2enmod rewrite
   ```

Note: Replace `[YOUR_DOMAIN],[YOUR_AUTH_SUBDOMAIN],[YOUR_CAPTIVE_SUBDOMAIN]` with your actual domain name in the SSL certificate paths. Also ensure that you have already obtained SSL certificates using Certbot (see Wildcard SSL Certificate Setup with DNS Challenge below) before activating these configurations.

4. Create web directories:
   ```bash
   sudo mkdir -p /var/www/captive
   sudo mkdir -p /var/www/auth
   ```

5. Set permissions:
   ```bash
   sudo chown -R www-data:www-data /var/www/captive
   sudo chown -R www-data:www-data /var/www/auth
   ```

### SQLite Setup
1. Install SQLite:
   ```bash
   sudo apt install sqlite3 -y
   ```

3. Create users database:
   ```bash
   sudo sqlite3 /var/www/auth/users.db
   ```

### Enable Sites and Restart Apache
1. Enable virtual hosts:
   ```bash
   sudo a2ensite [YOUR_CAPTIVE_SUBDOMAIN].conf
   sudo a2ensite [YOUR_AUTH_SUBDOMAIN].conf
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
mkdir auth_api
cd auth_api
```

### 2. Initialize Project
```bash
npm init -y
```

### 3. Install Dependencies
```bash
npm install express mysql2 bcryptjs cors dotenv axios
```

### 4. Create Configuration Files
1. Create `.env` file:
```bash
sudo nano .env # Or place it in the project directory: /path/to/your/project/.env
```
Add the required variables based on `remote-auth-server/.env.example`:
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
1. Create `auth_api.js` in your project directory (e.g., `/opt/captive-portal-auth-api/auth_api.js`):
```bash
sudo mkdir -p /opt/captive-portal-auth-api # Example directory
sudo nano /opt/captive-portal-auth-api/auth_api.js
```
2. Copy the code from [`remote-auth-server/auth_api.js`](https://github.com/ganainy/raspberrypi-captive-portal/blob/remote-captive/remote%20auth%20server/auth_api.js) into `auth_api.js`.
*Note: The code now reads configuration from the `.env` file.*

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
   sudo nano /etc/systemd/system/captiveportal-auth-api.service
   ```

2. **Add the following content**:
   ```ini
   [Unit]
   Description=Captive Portal Auth API Server
   After=network.target mysql.service # Ensure network and DB are up

   [Service]
   ExecStart=/usr/bin/node /opt/captive-portal-auth-api/auth_api.js
   WorkingDirectory=/opt/captive-portal-auth-api
   Restart=always
   User=ubuntu # Or another non-root user if preferred
   Group=www-data # Or the group that owns the project files
   Environment=NODE_ENV=production
   # Optionally load .env file if placed in WorkingDirectory
   # EnvironmentFile=/opt/captive-portal-auth-api/.env 
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=captiveportal-auth-api

   [Install]
   WantedBy=multi-user.target
   ```
   *Replace paths and user/group as needed for your setup.*

3. **Reload systemd, enable and start the service**:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable captiveportal-auth-api.service
   sudo systemctl start captiveportal-auth-api.service
   ```

4. **Check the service status**:
   ```bash
   sudo systemctl status captiveportal-auth-api.service
   ```
   *Check logs using `journalctl -fu captiveportal-auth-api.service`.*

### 8. Apache Reverse Proxy Update
Ensure your Apache virtual host for `[YOUR_AUTH_SUBDOMAIN]` correctly proxies requests to the port defined in your `.env` file (default `4000`):
   ```apache
   # ... inside <VirtualHost *:443> for [YOUR_AUTH_SUBDOMAIN] ...
   ProxyPass / http://127.0.0.1:4000/ 
   ProxyPassReverse / http://127.0.0.1:4000/
   # ... rest of config ...
   ```
   *Restart Apache after changes: `sudo systemctl restart apache2`*

### 9. Test the API
```bash
curl https://[YOUR_AUTH_SUBDOMAIN]/hello_api
```

Notes:
- The Auth server API will run on port 4000 by default
- Users table will be created automatically
- API endpoints:
  - POST `/login_api`
  - POST `/signup_api`
  - GET `/users_api` (debug only, delete fron [`remote-auth-server/auth_api.js`](https://github.com/ganainy/raspberrypi-captive-portal/blob/remote-captive/remote%20auth%20server/auth_api.js) code if used in production)
  - GET `/hello_api` (debug only)
