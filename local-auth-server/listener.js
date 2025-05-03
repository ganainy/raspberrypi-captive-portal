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
  'SESSION_DURATION_MS',
  'CHECK_INTERVAL_MS',
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

// Use environment variables for session duration and check interval
const sessionDurationMs = parseInt(process.env.SESSION_DURATION_MS, 10);
const checkIntervalMs = parseInt(process.env.CHECK_INTERVAL_MS, 10);

// Validate parsed numbers
if (isNaN(sessionDurationMs) || isNaN(checkIntervalMs)) {
  console.error('Error: SESSION_DURATION_MS and CHECK_INTERVAL_MS must be valid numbers.');
  process.exit(1);
}

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

    console.log("Allowing internet access for IP:", ip);
    allowInternetAccess(ip);

    res.status(200).json({
      message: 'Session activated successfully',
      sessionId,
    });
  } catch (err) {
    console.error('Error during session activation:', err);
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
  `, [userId], (err) => {
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
      `, [userId, loginTimestamp, logoutTimestamp], (err) => {
        if (err) {
          console.error('Error creating new session:', err);
        } else {
          console.log(`New session for user ${userId} created.`);
          revokeInternetAccess(ip);
        }
      });
    }
  });
};

// Route for manual session deactivation
app.post('/deactivate-session', validateSessionFields, async (req, res) => {
  const { user_id, ip } = req.body;

  try {
    console.log("Manually deactivating session...");
    deactivateSession(user_id, ip);

    res.status(200).json({
      message: 'Session deactivated successfully'
    });
  } catch (err) {
    console.error('Error during session deactivation:', err);
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
function ruleExists(ruleCheckCommand) {
  return new Promise((resolve, reject) => {
    exec(ruleCheckCommand, (error, stdout, stderr) => {
      if (error) {
        reject(`Error checking rule existence: ${error.message}`);
        return;
      }
      if (stderr) {
        reject(`stderr: ${stderr}`);
        return;
      }
      resolve(stdout.includes('DNAT') || stdout.includes('REJECT'));
    });
  });
}

// Function to allow internet access via iptables
async function allowInternetAccess(clientIp) {
  console.log(`Allowing internet access for IP: ${clientIp}`);

  try {
    // First, remove any existing blocking rules
    console.log('Step 1: Removing any existing blocking rules...');

    // Remove HTTP redirection rule if it exists
    exec(`sudo iptables -t nat -D PREROUTING -i ${wlanInterface} -p tcp -s ${clientIp} --dport 80 -j DNAT --to-destination ${redirectTargetIp}:${redirectTargetPort}`, (error, stdout, stderr) => {
      if (error && !error.message.includes('No chain/target/match by that name')) {
        console.log(`[HTTP Rule Remove] Error: ${error.message}`);
      } else {
        console.log('[HTTP Rule Remove] Successfully removed if existed');
      }
    });

    // Remove HTTPS blocking rule if it exists
    exec(`sudo iptables -D FORWARD -i ${wlanInterface} -p tcp -s ${clientIp} --dport 443 -j REJECT --reject-with icmp-port-unreachable`, (error, stdout, stderr) => {
      if (error && !error.message.includes('No chain/target/match by that name')) {
        console.log(`[HTTPS Rule Remove] Error: ${error.message}`);
      } else {
        console.log('[HTTPS Rule Remove] Successfully removed if existed');
      }
    });

    // Add specialized logging to verify rules are being executed correctly
    console.log('Step 2: Checking current iptables rules...');
    exec('sudo iptables -L FORWARD -v -n --line-numbers', (error, stdout, stderr) => {
      if (!error) {
        console.log('[Debug] Current FORWARD chain rules:\n', stdout);
      }
    });
    exec('sudo iptables -t nat -L PREROUTING -v -n --line-numbers', (error, stdout, stderr) => {
      if (!error) {
        console.log('[Debug] Current PREROUTING chain rules:\n', stdout);
      }
    });

  } catch (err) {
    console.error(`Error managing iptables rules: ${err}`);
  }
}

// Function to revoke internet access via iptables
async function revokeInternetAccess(clientIp) {
  console.log(`Revoking internet access for IP: ${clientIp}`);

  try {
    console.log('Step 1: Adding blocking rules...');

    // Add HTTP redirection rule
    exec(`sudo iptables -t nat -A PREROUTING -i ${wlanInterface} -p tcp -s ${clientIp} --dport 80 -j DNAT --to-destination ${redirectTargetIp}:${redirectTargetPort}`, (error, stdout, stderr) => {
      if (error) {
        console.log(`[HTTP Rule Add] Error: ${error.message}`);
      } else {
        console.log('[HTTP Rule Add] Successfully added');
      }
    });

    // Add HTTPS blocking rule
    exec(`sudo iptables -A FORWARD -i ${wlanInterface} -p tcp -s ${clientIp} --dport 443 -j REJECT --reject-with icmp-port-unreachable`, (error, stdout, stderr) => {
      if (error) {
        console.log(`[HTTPS Rule Add] Error: ${error.message}`);
      } else {
        console.log('[HTTPS Rule Add] Successfully added');
      }
    });

    // Add specialized logging to verify rules are being executed correctly
    console.log('Step 2: Verifying rules were added...');
    exec('sudo iptables -L FORWARD -v -n --line-numbers', (error, stdout, stderr) => {
      if (!error) {
        console.log('[Debug] Current FORWARD chain rules:\n', stdout);
      }
    });
    exec('sudo iptables -t nat -L PREROUTING -v -n --line-numbers', (error, stdout, stderr) => {
      if (!error) {
        console.log('[Debug] Current PREROUTING chain rules:\n', stdout);
      }
    });

  } catch (err) {
    console.error(`Error managing iptables rules: ${err}`);
  }
}

// Start the server
app.listen(port, () => {
  console.log(`API listener server running at http://localhost:${port}`);
});

