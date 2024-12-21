require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const bodyParser = require('body-parser');
const { exec } = require('child_process');

// Constants
const PORT = process.env.PORT || 5000;
const CHECK_INTERVAL = 10000; // 10 seconds

// Express app setup
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Database setup
class Database {
  constructor() {
    this.db = new sqlite3.Database('./storage.db', (err) => {
      if (err) {
        console.error('Error opening database:', err.message);
      } else {
        console.log('Database connected successfully');
        this.initializeTables();
      }
    });
  }

  async initializeTables() {
    const tables = {
      users: `
        CREATE TABLE IF NOT EXISTS users (
          user_id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
      sessions: `
        CREATE TABLE IF NOT EXISTS sessions (
          session_id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          username TEXT NOT NULL,
          mac_address TEXT,
          login_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          logout_timestamp TIMESTAMP,
          status TEXT DEFAULT 'active',
          ip TEXT NOT NULL,
          agent TEXT,
          original_url TEXT,
          http_method TEXT,
          referer TEXT,
          FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
      `
    };

    for (const [tableName, query] of Object.entries(tables)) {
      try {
        await this.run(query);
        console.log(`${tableName} table initialized`);
      } catch (err) {
        console.error(`Error creating ${tableName} table:`, err);
      }
    }
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

const db = new Database();

// Middleware
const validateSession = (req, res, next) => {
  const requiredFields = ['user_id', 'ip'];
  const optionalFields = ['mac_address', 'username', 'agent', 'original_url', 'http_method', 'referer'];

  for (const field of requiredFields) {
    if (!req.body[field]) {
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  for (const field of optionalFields) {
    if (!req.body[field]) {
      console.warn(`Warning: Optional field "${field}" is missing`);
      req.body[field] = '';
    }
  }

  next();
};


// Network access control
class NetworkController {
  static async allowAccess(ip) {
    try {
      // Try to delete existing rules, ignore errors if they don't exist
      await this.executeCommandSafe(`sudo iptables -t nat -D PREROUTING -i wlan0 -p tcp -s ${ip} --dport 80 -j DNAT --to-destination 192.168.1.1:8080`);
      await this.executeCommandSafe(`sudo iptables -D FORWARD -i wlan0 -p tcp -s ${ip} --dport 443 -j REJECT --reject-with icmp-port-unreachable`);
      console.log(`Internet access allowed for IP: ${ip}`);
    } catch (err) {
      console.error('Error allowing network access:', err);
      throw err;
    }
  }

  static async revokeAccess(ip) {
    try {
      // Try to delete existing rules first to avoid duplicates
      await this.executeCommandSafe(`sudo iptables -t nat -D PREROUTING -i wlan0 -p tcp -s ${ip} --dport 80 -j DNAT --to-destination 192.168.1.1:8080`);
      await this.executeCommandSafe(`sudo iptables -D FORWARD -i wlan0 -p tcp -s ${ip} --dport 443 -j REJECT --reject-with icmp-port-unreachable`);
      
      // Add new rules
      await this.executeCommand(`sudo iptables -t nat -A PREROUTING -i wlan0 -p tcp -s ${ip} --dport 80 -j DNAT --to-destination 192.168.1.1:8080`);
      await this.executeCommand(`sudo iptables -A FORWARD -i wlan0 -p tcp -s ${ip} --dport 443 -j REJECT --reject-with icmp-port-unreachable`);
      console.log(`Internet access revoked for IP: ${ip}`);
    } catch (err) {
      console.error('Error revoking network access:', err);
      throw err;
    }
  }

  static executeCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) reject(error);
        else if (stderr) reject(new Error(stderr));
        else resolve(stdout);
      });
    });
  }

  static executeCommandSafe(command) {
    return new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        // Ignore errors and stderr, always resolve
        resolve(stdout || '');
        
        // Log errors for debugging but don't fail
        if (error) {
          console.log(`Note: Command produced error (safely ignored): ${error.message}`);
        }
        if (stderr) {
          console.log(`Note: Command produced stderr (safely ignored): ${stderr}`);
        }
      });
    });
  }
}

// Session management
class SessionManager {
  static async createOrUpdate(sessionData) {
    await db.run('BEGIN TRANSACTION');
    
    try {
      const { user_id, username, mac_address, ip, agent, original_url, http_method, referer } = sessionData;
      
      // First deactivate any existing active sessions for this user
      await this.deleteExistingSessions(user_id);

      // Create new session
      const result = await db.run(
        `INSERT INTO sessions (
            user_id, username, mac_address, ip, agent, 
            original_url, http_method, referer, login_timestamp, logout_timestamp, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, '+1 hour'), 'active')`, // Set logout_timestamp to 1 hour after login_timestamp
        [user_id, username, mac_address, ip, agent, original_url, http_method, referer]
      );
      

      // Allow network access
      await NetworkController.allowAccess(ip);
      
      await db.run('COMMIT');
      return result.lastID;
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }

  static async deleteExistingSessions(userId) {
    const activeSessions = await db.all(
      'SELECT ip FROM sessions WHERE user_id = ?',
      [userId]
    );
  
    for (const session of activeSessions) {
      await NetworkController.revokeAccess(session.ip);
    }
  
    // Delete the session if the user_id matches
    await db.run(
      `DELETE FROM sessions 
       WHERE user_id = ?`,
      [userId]
    );
  }
  

  static async deactivate(userId, ip) {
    await db.run(
      `UPDATE sessions 
       SET status = 'inactive'
       WHERE user_id = ? AND status = 'active'`,
      [userId]
    );
    await NetworkController.revokeAccess(ip);
  }

  static async cleanupInactiveSessions() {
    await db.run('BEGIN TRANSACTION');
    
    try {
      
      // Get active sessions older than one hour
      const expiredSessions = await db.all(`
        SELECT DISTINCT user_id, ip 
        FROM sessions 
        WHERE status = 'active' 
        AND CURRENT_TIMESTAMP > logout_timestamp
      `);
      

      for (const session of expiredSessions) {
        await this.deactivate(session.user_id, session.ip);
      }
      
      await db.run('COMMIT');
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
  }
}

// Routes
app.post('/login_api', async (req, res) => {
  try {
    const { username, password, cookieInfo } = req.body;

    if (!username || !password || !cookieInfo?.ip) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sessionId = await SessionManager.createOrUpdate({
      user_id: user.user_id,
      username: user.username,
      ...cookieInfo
    });

    res.json({ message: 'Login successful', sessionId });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/signup_api', async (req, res) => {
  try {
    const { username, password, cookieInfo } = req.body;

    if (!username || !password || !cookieInfo?.ip) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingUser = await db.get('SELECT username FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );

    res.json({ message: 'Signup successful', userId: result.lastID });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Session cleanup interval
setInterval(() => {
  SessionManager.cleanupInactiveSessions()
    .catch(err => console.error('Session cleanup error:', err));
}, CHECK_INTERVAL);

// SSL configuration and server startup
try {
  const credentials = {
    key: fs.readFileSync('/etc/ssl/private/apache-selfsigned.key', 'utf8'),
    cert: fs.readFileSync('/etc/ssl/certs/apache-selfsigned.crt', 'utf8')
  };

  https.createServer(credentials, app)
    .listen(PORT, "captive.local", () => {
      console.log(`HTTPS server running on https://captive.local:${PORT}`);
    });
} catch (err) {
  console.error('SSL configuration error:', err);
  process.exit(1);
}