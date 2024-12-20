# Raspberry Pi Captive Portal (Remote Login)

## Overview
This branch implements a captive portal on Raspberry Pi that redirects users to a remote authentication server. All authentication logic is handled on a remote AWS EC2 instance, making this setup ideal for centralized user management.

## Features
- Redirects all HTTP traffic to remote authentication server
- DNS redirection for captive portal detection
- Remote user authentication and management
- SSH reverse tunnel for secure communication
- Automatic session management

## Architecture
1. **Traffic Interception**: Using `dnsmasq` and `iptables`
2. **Authentication**: Remote server at `captive.example.com`
3. **Communication**: SSH reverse tunnel for secure data exchange
4. **Session Management**: Node.js service for handling user sessions

## Prerequisites
- Raspberry Pi with Wi-Fi capability
- Ethernet connection for internet backhaul
- Parrot OS 6.2 (RPi Edition)
- AWS EC2 instance with elastic IP
- Registered domain name

## Quick Start
1. Clone the repository and switch to remote-login branch
2. Follow setup instructions in [rpi-setup.md](rpi-setup.md)
3. Configure the remote server settings
4. Start the services

## Alternative Approach
For local authentication without AWS dependency, check out the [`local-login`](../local-login/README.md) branch.

---
