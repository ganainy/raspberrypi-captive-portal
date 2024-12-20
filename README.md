# Raspberry Pi Captive Portal (Remote Login)

## Overview
This branch implements a captive portal on the Raspberry Pi that redirects users to a remote authentication server. Upon successful login, the user is granted internet access for one hour. This setup is more suitable for large businesses with centralized user data, where user management and authentication are handled remotely.

> **Note:** For local authentication without relying on a Hosting service (everything will be handled directly on the Raspberry Pi, making it more suitable for small businesses), check out the [`local-login`](../local-login/README.md) branch.

## Features
- **HTTP Interception & DNS Redirection**: Automatically detects and redirects users to the captive portal.
- **Remote User Login & Authentication**: Users authenticate via a remote web server.
- **SSH Reverse Tunnel**: Secure communication between the remote server and the Raspberry Pi.
- **Automatic Session Management**: Handles session durations and renewals for users.

## Prerequisites
- Raspberry Pi with Wi-Fi capability
- Ethernet connection for internet backhaul
- Any Ubuntu/Debian RPi distro
- AWS EC2 instance with elastic IP
- Registered domain name

## Quick Start
1. Clone the repository and switch to remote-login branch
2. Follow RPi setup instructions in [rpi-setup.md](rpi-setup.md)
3. Follow remote server setup instructions in [remote-server-setup.md](https://github.com/ganainy/raspberrypi-captive-portal/blob/remote-captive/remote-website/remote-server-setup.md)

4. Configure the remote server settings
5. Start the services
---
