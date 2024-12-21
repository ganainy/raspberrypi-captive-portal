# Raspberry Pi Captive Portal

## Overview
This branch implements a captive portal on the Raspberry Pi that redirects users to a local web server. Upon successful login, the user is granted internet access for one hour. This setup is more suitable for small businesses, where everything needed is hosted on the RPi.

> **Note:** For remote authentication using a Hosting service (more suitable for large businesses with cerntralized databases), check out the [`remote-login`](../remote-login/README.md) branch.

## Features
- **HTTP Interception & DNS Redirection**: Automatically detects and redirects users to the captive portal.
- **User Login & Authentication**: Users authenticate via a local web server.
- **Automatic Session Management**: Handles session durations and renewals for users.

## Prerequisites
- Raspberry Pi with Wi-Fi capability
- Ethernet connection for internet backhaul
- Any Ubuntu/Debian RPi distro

## Quick Start
1. Clone the repository and switch to local-login branch
2. Follow RPi setup instructions in [rpi-setup.md](rpi-setup.md)
3. Follow local server setup instructions in [local-server-setup.md](https://github.com/ganainy/raspberrypi-captive-portal/blob/local-captive/local-website/local-server-setup.md)
4. Start the services
---
