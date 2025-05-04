/**
 * This file establishes a connection to the backend authentication server hosted remotely via an SSH tunnel.
 * Any traffic sent to port 4000 on the authentication server is forwarded to port 4001 on the local Raspberry Pi hosting this file.
 * The received data, including the IP address of the authenticated device, is used to manage the user's internet access.
 * 
 * This server listens for incoming HTTP requests from the remote server, 
 * activates or updates a session in the local SQLite database, and 
 * allows internet access for the device associated with the session.
 */

require('dotenv').config(); // Load environment variables from .env file

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const { exec } = require("child_process");

// Environment variable checks
const requiredEnvVarsListener = [
  'LISTENER_PORT',
  'DB_PATH',
  'WLAN_INTERFACE',
  'REDIRECT_TARGET_IP',
  'REDIRECT_TARGET_PORT'
];
for (const varName of requiredEnvVarsListener) {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is not set. Please define it in the .env file.`);
    process.exit(1);
  }
}

const app = express();
// Use environment variable for port
const port = process.env.LISTENER_PORT;

// Middleware
app.use(bodyParser.json());

// Local SQLite Database Setup
// Use environment variable for DB path
const dbPath = process.env.DB_PATH;
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("SQLite database connected.");
  }
});

// Create Tables in SQLite (sessions)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INT,
      username VARCHAR(255) NOT NULL,
      mac_address VARCHAR(17),
      login_timestamp TIMESTAMP NULL DEFAULT NULL,
      logout_timestamp TIMESTAMP NULL DEFAULT NULL,
      status TEXT DEFAULT 'active',
      ip VARCHAR(15),
      agent TEXT,
      original_url TEXT,
      http_method VARCHAR(10),
      referer TEXT
    )
  `);
  console.log("Sessions table ensured.");
});

/**
 * Route to receive data from remote server
 * Activates a session or creates a new session and allows internet access for the device.
 */
const validateSessionFields = (req, res, next) => {
  // Fields that must have non-empty values
  const mandatoryFields = ['user_id', 'ip'];

  // Fields that are optional but should log a warning if empty
  const optionalFields = ['mac_address', 'username', 'agent', 'original_url', 'http_method', 'referer'];

  // Check mandatory fields (must not be empty)
  for (let field of mandatoryFields) {
    if (!req.body[field]) {
      console.log(`Missing or empty mandatory field: ${field}`);
      return res.status(400).json({ detail: `Missing or empty ${field}` });
    }
  }

  // Check optional fields (log warning if empty)
  for (let field of optionalFields) {
    if (req.body[field] === '') {
      console.log(`Warning: ${field} is an empty field: ${req.body[field]}`);
    }
    if (!req.body[field]) {
      console.log(`Warning: ${field} is missing or empty`);
    }
  }

  next();
};

const activateOrUpdateSession = async (user_id, mac_address, ip, agent, original_url, http_method, referer, username) => {
  return new Promise((resolve, reject) => {
    try {
      console.log("Checking if session already exists...");
      // Check if the session already exists
      db.get(
        'SELECT * FROM sessions WHERE user_id = ?',
        [user_id],
        (err, existingSession) => {
          if (err) {
            console.error('Error during DB query:', err);
            return reject(new Error(`Session check failed: ${err.message}`));
          }

          if (existingSession) {
            console.log("Updating existing session...");
            // Update the existing session
            db.run(
              `UPDATE sessions 
               SET mac_address = ?, login_timestamp = CURRENT_TIMESTAMP, ip = ?, agent = ?, original_url = ?, http_method = ?, referer = ?, username = ? 
               WHERE session_id = ?`,
              [mac_address, ip, agent, original_url, http_method, referer, username, existingSession.session_id],
              function (err) {
                if (err) {
                  console.error('Error updating session:', err);
                  return reject(new Error(`Session update failed: ${err.message}`));
                }
                resolve(existingSession.session_id);
              }
            );
          } else {
            console.log("Creating new session...");
            // Create a new session
            db.run(
              `INSERT INTO sessions (user_id, username, mac_address, login_timestamp, status, ip, agent, original_url, http_method, referer) 
               VALUES (?, ?, ?, CURRENT_TIMESTAMP, "active", ?, ?, ?, ?, ?)`,
              [user_id, username, mac_address, ip, agent, original_url, http_method, referer],
              function (err) {
                if (err) {
                  console.error('Error creating session:', err);
                  return reject(new Error(`Session creation failed: ${err.message}`));
                }
                resolve(this.lastID); // returns the inserted session ID
              }
            );
          }
        }
      );
    } catch (error) {
      console.error("Error activating or updating session:", error);
      reject(new Error(`Session activation failed: ${error.message}`));
    }
  });
};

// In the route
app.post('/activate-session', validateSessionFields, async (req, res) => {
  const { mac_address, user_id, username, ip, agent, original_url, http_method, referer } = req.body;

  console.log('=== ACTIVATE SESSION REQUEST ===');
  console.log('Time:', new Date().toISOString());
  console.log('User ID:', user_id);
  console.log('Username:', username);
  console.log('IP Address:', ip);
  console.log('MAC Address:', mac_address || 'Not provided');
  console.log('User Agent:', agent || 'Not provided');
  console.log('Original URL:', original_url || 'Not provided');
  console.log('HTTP Method:', http_method || 'Not provided');
  console.log('Referer:', referer || 'Not provided');

  try {
    console.log("Activating session...");
    const sessionId = await activateOrUpdateSession(
      user_id,
      mac_address,
      ip,
      agent,
      original_url,
      http_method,
      referer,
      username
    );

    console.log(`Session activated successfully with ID: ${sessionId}`);
    console.log("Allowing internet access for IP:", ip);
    await allowInternetAccess(ip);
    console.log(`Internet access granted successfully for IP: ${ip}`);

    console.log('=== ACTIVATE SESSION COMPLETE ===');
    res.status(200).json({
      message: 'Session activated successfully',
      sessionId,
    });
  } catch (err) {
    console.error('=== ACTIVATE SESSION ERROR ===');
    console.error('Time:', new Date().toISOString());
    console.error('Error during session activation:', err);
    console.error('Request details:', { user_id, ip, username });
    console.error('========================');

    res.status(500).json({
      error: 'Failed to activate or create session',
      details: err.message,
    });
  }
});

// Route to deactivate a session and revoke internet access
const deactivateSession = (userId, ip) => {
  console.log(`Deactivating session for user ${userId}...`);

  // Delete the active session for the user
  db.run(`
    DELETE FROM sessions 
    WHERE user_id = ?
  `, [userId], async (err) => {
    if (err) {
      console.error('Error deleting session:', err);
    } else {
      console.log(`Active session for user ${userId} deleted.`);

      // Create a new session with login_timestamp set to now and logout_timestamp set based on SESSION_DURATION_MS
      const loginTimestamp = new Date().toISOString();
      const logoutTimestamp = new Date(Date.now() + sessionDurationMs).toISOString(); // Use configured duration

      db.run(`
        INSERT INTO sessions (user_id, status, login_timestamp, logout_timestamp) 
        VALUES (?, 'active', ?, ?)
      `, [userId, loginTimestamp, logoutTimestamp], async (err) => {
        if (err) {
          console.error('Error creating new session:', err);
        } else {
          console.log(`New session for user ${userId} created.`);
          await revokeInternetAccess(ip);
        }
      });
    }
  });
};

// Route for manual session deactivation
app.post('/deactivate-session', validateSessionFields, async (req, res) => {
  const { user_id, ip, username } = req.body;

  console.log('=== DEACTIVATE SESSION REQUEST ===');
  console.log('Time:', new Date().toISOString());
  console.log('User ID:', user_id);
  console.log('IP Address:', ip);
  console.log('Username:', username || 'Not provided');

  try {
    console.log("Deactivating session...");
    await deactivateSession(user_id, ip);
    console.log("Session deactivated successfully");
    console.log("Revoking internet access for IP:", ip);
    await revokeInternetAccess(ip);
    console.log(`Internet access revoked successfully for IP: ${ip}`);
    console.log('=== DEACTIVATE SESSION COMPLETE ===');

    res.status(200).json({
      message: 'Session deactivated successfully'
    });
  } catch (err) {
    console.error('=== DEACTIVATE SESSION ERROR ===');
    console.error('Time:', new Date().toISOString());
    console.error('Error during session deactivation:', err);
    console.error('Request details:', { user_id, ip, username });
    console.error('========================');

    res.status(500).json({
      error: 'Failed to deactivate session',
      details: err.message,
    });
  }
});

// Endpoint for testing the connection between RPi and remote server
app.get('/test', (req, res) => {
  console.log("Testing connection...");
  res.status(200).json({ message: 'Connection between RPi and server is up' });
});

// Use environment variables for iptables configuration
const wlanInterface = process.env.WLAN_INTERFACE;
const redirectTargetIp = process.env.REDIRECT_TARGET_IP;
const redirectTargetPort = process.env.REDIRECT_TARGET_PORT;

// Helper function to check if a rule exists in iptables
function ruleExists(ruleType, clientIp) {
  return new Promise((resolve, reject) => {
    const command = ruleType === 'http' ?
      `sudo iptables -t nat -C PREROUTING -i ${wlanInterface} -p tcp -s ${clientIp} --dport 80 -j DNAT --to-destination ${redirectTargetIp}:${redirectTargetPort}` :
      `sudo iptables -C FORWARD -i ${wlanInterface} -p tcp -s ${clientIp} --dport 443 -j REJECT --reject-with icmp-port-unreachable`;

    exec(command, (error) => {
      // If command exits with non-zero status, rule doesn't exist (which is normal)
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// Function to allow internet access via iptables
async function allowInternetAccess(clientIp) {
  console.log(`Allowing internet access for IP: ${clientIp}`);

  try {
    // Always add explicit ALLOW rules first (at the beginning of chains)
    console.log(`Step 1: Adding explicit ALLOW rules for ${clientIp}...`);

    // Add an explicit ALLOW rule for all traffic at the beginning of FORWARD chain
    await executeCommand(`sudo iptables -I FORWARD 1 -i ${wlanInterface} -s ${clientIp} -j ACCEPT`);

    // Give the system a moment to process the rule
    await new Promise(resolve => setTimeout(resolve, 100));

    // Step 2: Remove any blocking rules
    console.log(`Step 2: Removing any existing blocking rules for ${clientIp}...`);

    // Try removing HTTP redirection rule (multiple times if needed)
    for (let i = 0; i < 3; i++) {
      await executeCommand(`sudo iptables -t nat -D PREROUTING -i ${wlanInterface} -p tcp -s ${clientIp} --dport 80 -j DNAT --to-destination ${redirectTargetIp}:${redirectTargetPort}`);
    }

    // Try removing HTTPS blocking rule (multiple times if needed)
    for (let i = 0; i < 3; i++) {
      await executeCommand(`sudo iptables -D FORWARD -i ${wlanInterface} -p tcp -s ${clientIp} --dport 443 -j REJECT --reject-with icmp-port-unreachable`);
    }

    // Debug: List current rules to verify
    console.log(`Step 3: Verifying current rules...`);
    const forwardRules = await executeCommand('sudo iptables -L FORWARD -n --line-numbers');
    console.log(`Current FORWARD rules:\n${forwardRules}`);

    const natRules = await executeCommand('sudo iptables -t nat -L PREROUTING -n --line-numbers');
    console.log(`Current NAT PREROUTING rules:\n${natRules}`);

    console.log(`Internet access fully enabled for ${clientIp}`);
    return true;
  } catch (err) {
    console.error(`Error allowing internet access: ${err}`);
    return false;
  }
}

// Function to revoke internet access via iptables
async function revokeInternetAccess(clientIp) {
  console.log(`Revoking internet access for IP: ${clientIp}`);

  try {
    // Remove any explicit ALLOW rule for the client
    console.log(`Removing any explicit ALLOW rule for ${clientIp}...`);
    await executeCommand(`sudo iptables -D FORWARD -i ${wlanInterface} -s ${clientIp} -j ACCEPT`);

    // Check if HTTP redirection rule exists before adding
    const httpRuleExists = await ruleExists('http', clientIp);
    if (!httpRuleExists) {
      console.log(`Adding HTTP redirection rule for ${clientIp}...`);
      await executeCommand(`sudo iptables -t nat -A PREROUTING -i ${wlanInterface} -p tcp -s ${clientIp} --dport 80 -j DNAT --to-destination ${redirectTargetIp}:${redirectTargetPort}`);
    }

    // Check if HTTPS blocking rule exists before adding
    const httpsRuleExists = await ruleExists('https', clientIp);
    if (!httpsRuleExists) {
      console.log(`Adding HTTPS blocking rule for ${clientIp}...`);
      await executeCommand(`sudo iptables -A FORWARD -i ${wlanInterface} -p tcp -s ${clientIp} --dport 443 -j REJECT --reject-with icmp-port-unreachable`);
    }

    console.log(`Internet access restricted for ${clientIp}`);
    return true;
  } catch (err) {
    console.error(`Error revoking internet access: ${err}`);
    return false;
  }
}

// Execute a command and return a promise
function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error && !error.message.includes('No chain/target/match by that name')) {
        console.error(`Command error: ${error.message}`);
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

// Start the server
app.listen(port, () => {
  console.log(`API listener server running at http://localhost:${port}`);
});