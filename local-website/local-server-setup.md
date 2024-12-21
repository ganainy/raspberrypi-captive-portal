# Guide: Setting Up Local Web Server

## SSL Configuration
### Create a self-signed certificate:
> Note: This will show a skipable browser warning because the certificate cannot be verified by CA, replace with real Domain and Letsencrypt SSL certificate to avoid this (See [`remote-login`](../remote-login/README.md))
```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/apache-selfsigned.key -out /etc/ssl/certs/apache-selfsigned.crt
```

## Server Configuration

### Initial Server Setup
1. Update system:
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
   sudo a2enmod headers
   sudo a2enmod rewrite
   sudo systemctl restart apache2
   ```

3. Create virtual hosts:
### Apache2 Virtual Host Configuration
1. Create virtual host for captive portal:
   ```bash
   sudo nano /etc/apache2/sites-available/[YOUR_CAPTIVE_DOMAIN].conf
   ```
   Add:
   ```apache
   # HTTPS Configuration with Self-Signed Certificate
<VirtualHost *:443>
    ServerAdmin webmaster@localhost
    ServerName localhost
    DocumentRoot /var/www/captive

    ErrorLog ${APACHE_LOG_DIR}/error.log
    CustomLog ${APACHE_LOG_DIR}/access.log combined

    # Enable SSL
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/apache-selfsigned.crt
    SSLCertificateKeyFile /etc/ssl/private/apache-selfsigned.key

    # Security Headers (Optional but Recommended)
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    Header always set X-Frame-Options SAMEORIGIN
    Header always set X-Content-Type-Options nosniff

    # Allow CORS for all origins
    <Directory /var/www/captive>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted

        Header set Access-Control-Allow-Origin "*"
        Header set Access-Control-Allow-Methods "GET, POST, OPTIONS, PUT, DELETE"
        Header set Access-Control-Allow-Headers "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    </Directory>
</VirtualHost>

# HTTP Configuration - Redirect to HTTPS
<VirtualHost *:80>
    ServerAdmin webmaster@localhost
    ServerName localhost
    DocumentRoot /var/www/captive

    ErrorLog ${APACHE_LOG_DIR}/error.log
    CustomLog ${APACHE_LOG_DIR}/access.log combined

    # Redirect all traffic to HTTPS
    Redirect permanent / https://[YOUR_CAPTIVE_DOMAIN]/
</VirtualHost>
   ```

Note: Replace `[YOUR_CAPTIVE_SUBDOMAIN]` with your actual local domain added to /etc/hosts.

4. Create web directories:
   ```bash
   sudo mkdir -p /var/www/captive
   ```

5. Set permissions:
   ```bash
   sudo chown -R www-data:www-data /var/www/captive
   ```

6. Copy website HTML files provided in ([`/local-website`](https://github.com/ganainy/raspberrypi-captive-portal/blob/local-captive/local-website)) to the directory
```bash
   cd /var/www/captive
   ```

# Node.js Auth API Setup Guide

## Steps

### 1. Create Project Directory
```bash
sudo mkdir /var/www/captive/backend
cd /var/www/captive/backend
```

### 2. Initialize Project
```bash
sudo npm init -y
```

### 3. Install Dependencies
```bash
sudo npm install dotenv sqlite3 bcryptjs cors express -y
```

### 4. Create API File
1. Create `auth_api.js`:
```bash
sudo nano auth_api.js
```
2. Copy the provided code from [`/auth-server/auth_api.js`](../auth-server/auth_api.js) into `auth_api.js`


### 5. Run the Auth Server
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
   ExecStart=/usr/bin/node /var/www/captive/backend/auth_api.js
   WorkingDirectory=/var/www/captive/backend
   Environment=NODE_ENV=production
   Restart=always
   User=root
   Group=root
   # Adjust permissions as needed

   [Install]
   WantedBy=multi-user.target
   ```

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

### 8. Test the API
```bash
curl http://[YOUR_CAPTIVE_DOMAIN]:5000/auth_api
```

Notes:
- The Auth server API will run on port 3000 by default
- Users table will be created automatically
- API endpoints:
  - POST `/login_api`
  - POST `/signup_api`

