/**
 * This file establishes a connection to the backend authentication server hosted remotely via an SSH tunnel.
 * Any traffic sent to port 4000 on the authentication server is forwarded to port 4001 on the local Raspberry Pi hosting this file.
 * The received data, including the IP address of the authenticated device, is used to manage the user's internet access.
 * 
 * This server listens for incoming HTTP requests from the remote server, 
 * activates or updates a session in the local SQLite database, and 
 * allows internet access for the device associated with the session.
 * 
 * It also periodically checks for inactive sessions and revokes internet access 
 * for those sessions after one hour.
 */


const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const { exec } = require("child_process");

const app = express();
const port = 4001;

// Middleware
app.use(bodyParser.json());

// Local SQLite Database Setup
const db = new sqlite3.Database("./local.db", (err) => {
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
              function(err) {
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
              function(err) {
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
      
      // Create a new session with login_timestamp set to now and logout_timestamp set to one hour later
      const loginTimestamp = new Date().toISOString();
      const logoutTimestamp = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour later

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


setInterval(() => {
  console.log("Checking for inactive sessions...");
  const currentTime = new Date().toISOString(); // Get the current system time

  db.all(`
    SELECT user_id, ip, logout_timestamp 
    FROM sessions 
    WHERE status = 'active' AND logout_timestamp < ?
  `, [currentTime], (err, sessions) => {
    if (err) {
      console.error('Error fetching sessions:', err);
      return;
    }

    sessions.forEach(session => {
      deactivateSession(session.user_id, session.ip);
    });
  });
}, 30000);




// Endpoint for testing the connection between RPi and remote server
app.get('/test', (req, res) => {
  console.log("Testing connection...");
  res.status(200).json({ message: 'Connection between RPi and server is up' });
});
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

  // Check if the rule exists before adding it
  try {
    const httpRuleCheck = `sudo iptables -t nat -L PREROUTING -v -n --line-numbers | grep '${clientIp}' | grep 'DNAT'`;
    const httpsRuleCheck = `sudo iptables -L FORWARD -v -n --line-numbers | grep '${clientIp}' | grep 'REJECT'`;

    const [httpExists, httpsExists] = await Promise.all([ruleExists(httpRuleCheck), ruleExists(httpsRuleCheck)]);

    // Add the rule if it doesn't exist
    if (!httpExists) {
      exec(`sudo iptables -t nat -A PREROUTING -i wlan0 -p tcp -s ${clientIp} --dport 80 -j DNAT --to-destination 192.168.1.1:8080`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing allowInternetAccess (HTTP): ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }
        console.log(`stdout: ${stdout}`);
      });
    }

    if (!httpsExists) {
      exec(`sudo iptables -A FORWARD -i wlan0 -p tcp -s ${clientIp} --dport 443 -j REJECT --reject-with icmp-port-unreachable`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing allowInternetAccess (HTTPS): ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }
        console.log(`stdout: ${stdout}`);
      });
    }

  } catch (err) {
    console.error(`Error checking or adding rules: ${err}`);
  }
}

// Function to revoke internet access via iptables
async function revokeInternetAccess(clientIp) {
  console.log(`Revoking internet access for IP: ${clientIp}`);

  // Check if the rule exists before deleting it
  try {
    const httpRuleCheck = `sudo iptables -t nat -L PREROUTING -v -n --line-numbers | grep '${clientIp}' | grep 'DNAT'`;
    const httpsRuleCheck = `sudo iptables -L FORWARD -v -n --line-numbers | grep '${clientIp}' | grep 'REJECT'`;

    const [httpExists, httpsExists] = await Promise.all([ruleExists(httpRuleCheck), ruleExists(httpsRuleCheck)]);

    // Remove the rule if it exists
    if (httpExists) {
      exec(`sudo iptables -t nat -D PREROUTING -i wlan0 -p tcp -s ${clientIp} --dport 80 -j DNAT --to-destination 192.168.1.1:8080`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing revokeInternetAccess (HTTP): ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }
        console.log(`stdout: ${stdout}`);
      });
    }

    if (httpsExists) {
      exec(`sudo iptables -D FORWARD -i wlan0 -p tcp -s ${clientIp} --dport 443 -j REJECT --reject-with icmp-port-unreachable`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing revokeInternetAccess (HTTPS): ${error.message}`);
          return;
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
          return;
        }
        console.log(`stdout: ${stdout}`);
      });
    }

  } catch (err) {
    console.error(`Error checking or removing rules: ${err}`);
  }
}

// Start the server
app.listen(port, () => {
  console.log(`API listener server running at http://localhost:${port}`);
});

