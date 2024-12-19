require('dotenv').config();  // Load environment variables from .env file

const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const https = require('https');  // Import https module
const fs = require('fs');        // Import fs module to read certificates
const app = express();
const axios = require('axios');

// Use environment variable for port, default to 3000 if not set
const PORT = process.env.PORT || 3000;
console.log(`Using port: ${PORT}`);

// Enable CORS for all origins
app.use(cors());
app.use(express.json());  // Parse incoming JSON requests

// MySQL Database Connection Pool Configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10, // Maximum number of connections in the pool
  queueLimit: 0 // Unlimited queueing
});

// Use promise-based pool for cleaner async/await support
const db = pool.promise();

// Create users table if it doesn't exist
async function createUsersTable() {
  try {
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NULL DEFAULT NULL
      );
    `;
    await db.query(createUsersTable);
    console.log('Users table checked/created successfully.');
  } catch (err) {
    console.error('Error creating users table:', err);
  }
}

createUsersTable();

// Route for login
app.post('/login_api', async (req, res) => {
  const { username, password, cookieInfo } = req.body;

  // Validate that cookieInfo and necessary fields are present
  if (!cookieInfo || !cookieInfo.ip) {
    console.error(' Auth error: cookie has no IP');
    return res.status(400).json({ detail: 'Auth error: cookie has no IP' });
  }

  // Check each field and log if it's missing
  const requiredFields = ['mac', 'user_id', 'username', 'ip', 'agent', 'original_url', 'http_method', 'referer'];

  requiredFields.forEach(field => {
    if (!cookieInfo[field]) {
      console.log(`Field missing: ${field}, setting to empty string`);
      cookieInfo[field] = ''; // Set missing field to an empty string
    }
  });

  if (!username || !password) {
    console.error('Username and password are required');
    return res.status(400).json({ detail: 'Username and password are required' });
  }

  try {
    // Check if the user exists
    const [result] = await db.query('SELECT * FROM users WHERE username = ?', [username]);

    if (!result.length) {
      console.error('Invalid username or password');
      return res.status(401).json({ detail: 'Invalid username or password' });
    }

    const user = result[0];

    // Check if the password matches
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      console.error('Invalid username or password');
      return res.status(401).json({ detail: 'Invalid username or password' });
    }

    
    // Prepare session data to send to the /activate-session route
    const activateSessionData = {
      mac_address: cookieInfo.mac,
      user_id: user.user_id,
      username: user.username,
      ip: cookieInfo.ip,
      agent: cookieInfo.agent,
      original_url: cookieInfo.original_url,
      http_method: cookieInfo.http_method,
      referer: cookieInfo.referer,
    };

    // Send POST request to /activate-session on port 4000
    const response = await axios.post('http://localhost:4000/activate-session', activateSessionData);
    console.log('Session activation response:', response.data);

    // Handle response from session activation
    if (response.status === 200) {
      return res.json({
        message: 'Login successful and session activated on local machine successfully',
      });
    } else {
      console.error(`Session activation failed with status: ${response.status}`);
      return res.status(500).json({
        detail: `Session activation failed with status: ${response.status}`,
      });
    }
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({
      detail: `Internal server error: ${err.message}`,
    });
  }
});

// Route for signup
app.post('/signup_api', async (req, res) => {
  const { username, password, cookieInfo } = req.body;

  // Fallback for missing cookie values
  if (!cookieInfo.mac) {
    cookieInfo.mac = 'unknown';
  }
  if (!cookieInfo.ip) {
    console.error('Auth error: cookie has no IP');
    return res.status(400).json({ detail: 'Auth error: cookie has no IP' });
  }

  try {
    // Check if the username already exists
    const [result] = await db.query('SELECT username FROM users WHERE username = ?', [username]);

    if (result.length) {
      console.error(`Username ${username} already taken`);
      return res.status(400).json({ detail: 'Username already taken' });
    }

    // Hash the user's password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log(`Password for ${username} hashed successfully`);

    // Insert the user into the database (created_at will default to current timestamp)
    const insertQuery = `
      INSERT INTO users (username, password, created_at) 
      VALUES (?, ?, NOW())
    `;
    await db.query(insertQuery, [username, hashedPassword]);

    console.log(`User ${username} signed up successfully.`);
    return res.json({ message: 'Sign-up successful' });

  } catch (err) {
    console.error('MySQL Error during signup:', err);
    return res.status(500).json({ detail: 'Internal server error during signup' });
  }
});

// Route for retrieving registered users details for debugging only, remove in production
app.get('/users_api', async (req, res) => {
  createUsersTable();
  try {
    // Query to select all columns from the 'users' table
    const query = `
      SELECT user_id, username, created_at 
      FROM users
    `;
    const [result] = await db.query(query);
    return res.json(result);
  } catch (err) {
    console.error('MySQL Error during retrieving users:', err);
    return res.status(500).json({ detail: `Internal server error during retrieving users: ${err.message}` });
  }
});

// Test endpoint for debugging only, remove in production
app.get('/hello_api', (req, res) => {
  console.log('Hello API accessed');
  res.json({ message: 'Authentication API up and running...' });
});

// Read the SSL certificates
const privateKey = fs.readFileSync('/etc/letsencrypt/live/ganainy.online/privkey.pem', 'utf8');
const certificate = fs.readFileSync('/etc/letsencrypt/live/ganainy.online/fullchain.pem', 'utf8');
const credentials = { key: privateKey, cert: certificate };

// Start the HTTPS server
https.createServer(credentials, app).listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});
