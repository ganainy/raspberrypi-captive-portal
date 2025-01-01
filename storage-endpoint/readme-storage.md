# Backend Setup Guide for Storing Data on AWS EC2 Instance

This guide provides a step-by-step process to replicate the backend setup used for storing data on an AWS EC2 instance. Follow each step to ensure the backend is functional and secure.

## Prerequisites

1. **AWS Account**: Ensure you have an active AWS account.
2. **EC2 Instance**: Launch an EC2 instance running a Linux-based operating system (e.g., Ubuntu).
3. **MySQL Database**: Set up a MySQL database (either on the same EC2 instance or a separate database server).
4. **PHP Environment**: Install and configure PHP on the EC2 instance.
5. **Web Server**: Install and configure a web server (e.g., Apache or Nginx).

---

## Steps to Replicate the Backend

### 1. Launch and Set Up the EC2 Instance
1. Log in to the AWS Management Console and navigate to the EC2 dashboard.
2. Launch an EC2 instance:
   - Choose an appropriate AMI (e.g., Ubuntu Server 22.04 LTS).
   - Select an instance type (e.g., t2.micro for free tier).
   - Configure security groups to allow HTTP (port 80) and MySQL (port 3306) access.
   - Add a key pair for SSH access.
3. SSH into the instance using your terminal:
   ```bash
   ssh -i /path/to/your-key.pem ubuntu@<your-ec2-public-ip>
   ```

### 2. Install Required Software

#### Update Packages
```bash
sudo apt update && sudo apt upgrade -y
```

#### Install Apache
```bash
sudo apt install apache2 -y
sudo systemctl start apache2
sudo systemctl enable apache2
```

#### Install PHP
```bash
sudo apt install php libapache2-mod-php php-mysql -y
```

#### Install MySQL Server
```bash
sudo apt install mysql-server -y
sudo mysql_secure_installation
```
Follow the prompts to secure your MySQL installation.

---

### 3. Set Up the Database

#### Log in to MySQL
```bash
sudo mysql -u root -p
```

#### Create a New Database and User
```sql
CREATE DATABASE your_database_name;
CREATE USER 'your_user'@'localhost' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON your_database_name.* TO 'your_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

#### Import Tables
1. Create tables in the database for `network_sessions`, `custom_webview_request`, `screenshots`, and `webpage_content`.
2. Use the following structure as an example:

> Note: those tables should mirror the schema you created on the client side (in our case it is an android application)

```sql
CREATE TABLE network_sessions (
    sessionId VARCHAR(255) PRIMARY KEY,
    ssid VARCHAR(255),
    bssid VARCHAR(255),
    timestamp TIMESTAMP,
    captivePortalUrl TEXT,
    ipAddress VARCHAR(255),
    gatewayAddress VARCHAR(255),
    securityType VARCHAR(255),
    isCaptiveLocal BOOLEAN
);

CREATE TABLE custom_webview_request (
    sessionId VARCHAR(255),
    type VARCHAR(255),
    url TEXT,
    method VARCHAR(10),
    body TEXT,
    domain VARCHAR(255),
    headers TEXT
);

CREATE TABLE screenshots (
    screenshotId VARCHAR(255),
    sessionId VARCHAR(255),
    timestamp TIMESTAMP,
    path TEXT,
    size VARCHAR(255),
    url TEXT
);

CREATE TABLE webpage_content (
    sessionId VARCHAR(255),
    url TEXT,
    html LONGTEXT,
    javascript LONGTEXT,
    timestamp TIMESTAMP
);
```

---

### 4. Configure the Backend Script

1. **Upload the Backend Script**:
   - Create a directory for the backend files:
     ```bash
     sudo mkdir -p /var/www/storage
     ```
   - Upload the provided `upload.php` script to the `/var/www/storage` directory.

2. **Create a `.env` File**:
   - In the same directory as the backend script, create a `.env` file to store database credentials securely:
     ```bash
     nano /var/www/storage/.env
     ```
   - Add the following content:
     ```
     DB_HOST=localhost
     DB_NAME=your_database_name
     DB_USER=your_user
     DB_PASS=your_password
     ```

3. **Set Permissions**:
   ```bash
   sudo chown -R www-data:www-data /var/www/storage
   sudo chmod -R 755 /var/www/storage
   ```

---

### 5. Configure Apache

1. **Enable Rewrite Module**:
   ```bash
   sudo a2enmod rewrite
   sudo systemctl restart apache2
   ```

2. **Create a Virtual Host Configuration**:
   ```bash
   sudo nano /etc/apache2/sites-available/storage.conf
   ```
   - Add the following content:
     ```
     <VirtualHost *:80>
         ServerName your-server-domain-or-ip
         DocumentRoot /var/www/storage

         <Directory /var/www/storage>
             Options Indexes FollowSymLinks
             AllowOverride All
             Require all granted
         </Directory>

         ErrorLog ${APACHE_LOG_DIR}/error.log
         CustomLog ${APACHE_LOG_DIR}/access.log combined
     </VirtualHost>
     ```

3. **Enable the Site**:
   ```bash
   sudo a2ensite storage.conf
   sudo systemctl reload apache2
   ```

---

### 6. Test the Backend
1. Use `curl` or a REST client (e.g., Postman) to send a POST request to the backend endpoints:
   - `/upload/report`
   - `/upload/image`

2. Example `curl` command:
   ```bash
   curl -X POST -H "Content-Type: application/json" -d @sample.json http://<your-ec2-public-ip>/upload/report
   ```

---

### 7. Monitor Logs
1. Check Apache logs:
   ```bash
   sudo tail -f /var/log/apache2/error.log
   ```
2. Check PHP errors (if any are logged).

---

