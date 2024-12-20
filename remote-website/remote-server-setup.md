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
       ProxyPass / https://127.0.0.1:3000/
       ProxyPassReverse / https://127.0.0.1:3000/
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
nano .env
```
Add:
```env
PORT=3000
DB_HOST=localhost
DB_USER=[YOUR_MYSQL_USER]
DB_PASSWORD=[YOUR_MYSQL_PASSWORD]
DB_NAME=[YOUR_DATABASE_NAME]
```

### 5. Create API File
1. Create `auth_api.js`:
```bash
nano auth_api.js
```
2. Copy the provided code from [`auth_api.js`](../remote-website/auth_api.js) into `auth_api.js`
3. Replace `[YOUR_DOMAIN]` with your actual domain in the SSL paths

### 6. Create MySQL Database
```bash
mysql -u root -p
CREATE DATABASE [YOUR_DATABASE_NAME];
```

### 7. Run the Auth Server
1. **Create a systemd service file**:
   Create a new service file in `/etc/systemd/system/`:

   ```bash
   sudo nano /etc/systemd/system/auth-api.service
   ```

2. **Add the following content** to the service file:

   ```ini
   [Unit]
   Description=Auth API Server
   After=network.target

   [Service]
   ExecStart=/usr/bin/node /path/to/auth_api.js
   WorkingDirectory=/path/to/your/project
   Environment=NODE_ENV=production
   Restart=always
   User=your_user
   Group=your_group
   # Adjust permissions as needed

   [Install]
   WantedBy=multi-user.target
   ```

   Replace `/path/to/auth_api.js` with the actual path to your `auth_api.js` file and `your_user` and `your_group` with the appropriate user and group for the server process.

3. **Reload systemd and enable the service**:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable auth-api.service
   sudo systemctl start auth-api.service
   ```

4. **Check the service status** to ensure it is running:

   ```bash
   sudo systemctl status auth-api.service
   ```

This will ensure that your `auth_api.js` server runs as a background service and restarts automatically if it crashes or if the system reboots.

### 8. Test the API
```bash
curl https://[YOUR_AUTH_SUBDOMAIN]/hello_api
```

Notes:
- The Auth server API will run on port 3000 by default
- Users table will be created automatically
- API endpoints:
  - POST `/login_api`
  - POST `/signup_api`
  - GET `/users_api` (debug only, delete if used in production)
  - GET `/hello_api` (debug only)
