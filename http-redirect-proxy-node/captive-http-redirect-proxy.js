/* 
This Node.js HTTP proxy listens for HTTP traffic on port 8080, which is redirected from the Raspberry Pi's port 80. The redirection is accomplished using iptables. 
It then adds some query parameters to the request and forwards it to the captive portal server. If the request is already for the captive portal,
 it forwards it directly. If the request is for any other domain, it redirects it to the captive portal."
*/

require('dotenv').config(); // Load environment variables from .env file

const httpProxy = require("http-proxy");
const http = require("http");
const { exec } = require("child_process");

// Environment variable checks
const requiredEnvVarsProxy = [
  'CAPTIVE_BACKEND_TARGET', // Renamed from CAPTIVE_PORTAL_TARGET_URL for clarity
  'CAPTIVE_DOMAIN',
  'PROXY_LISTEN_IP',
  'PROXY_LISTEN_PORT',
  'WLAN_INTERFACE' // Added for MAC lookup
];
for (const varName of requiredEnvVarsProxy) {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is not set. Please define it in the .env file.`);
    process.exit(1);
  }
}

// Create a proxy server
const proxy = httpProxy.createProxyServer({});

// Define the target server for the captive portal from environment variable
const captiveBackendTarget = process.env.CAPTIVE_BACKEND_TARGET;
// Define the captive domain from environment variable
const captiveDomain = process.env.CAPTIVE_DOMAIN;
// Define the WLAN interface from environment variable
const wlanInterface = process.env.WLAN_INTERFACE;

// Start an HTTP server
const server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host; // Get the Host header
    const clientIp = getNormalizedClientIp(getClientIp(req));
    const userAgent = getUserAgent(req);
    const originalUrl = req.url;
    const referer = req.headers.referer || ""; // Capture the HTTP referer (if available)
    const httpMethod = req.method; // Capture the HTTP method (GET, POST, etc.)

    let clientMac = await getClientMac(clientIp, wlanInterface); // Pass wlanInterface to getClientMac
    if (!clientMac) clientMac = "unknown"; // Fallback if MAC address is unavailable

    // Use configured captive domain for check
    if (hostHeader === captiveDomain) {
      // Build query parameters for captive portal target
      const params = new URLSearchParams();
      params.set("ip", clientIp);
      params.set("mac", clientMac);
      params.set("agent", userAgent);
      params.set("original_url", encodeURIComponent(originalUrl));
      params.set("http_method", httpMethod);
      params.set("referer", encodeURIComponent(referer));

      // Proxy the request to the configured captive backend target
      console.log(`Forwarding to captive portal backend: ${captiveBackendTarget}?${params.toString()}`);
      // Construct target URL correctly
      const targetUrl = new URL(captiveBackendTarget);
      targetUrl.search = params.toString(); // Append params correctly
      proxy.web(req, res, { target: targetUrl.toString(), changeOrigin: true }); // Added changeOrigin for robustness
    } else {
      // Redirect to the configured captive domain
      console.log(`Redirecting: ${hostHeader} -> ${captiveDomain}`);
      const params = new URLSearchParams();
      params.set("ip", clientIp);
      params.set("mac", clientMac);
      params.set("agent", userAgent);
      params.set("original_url", encodeURIComponent(originalUrl));
      params.set("http_method", httpMethod);
      params.set("referer", encodeURIComponent(referer));

      res.writeHead(302, { Location: `http://${captiveDomain}?${params.toString()}` });
      res.end();
    }
  } catch (err) {
    console.error("Error processing request:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});

/**
 * Get the client's IP address.
 */
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"] || // For clients behind a proxy
    req.connection.remoteAddress || // Remote address from the connection
    req.socket.remoteAddress || // Remote address from the socket
    (req.connection.socket ? req.connection.socket.remoteAddress : null)
  );
}

/**
 * Normalize the client's IP address.
 */
function getNormalizedClientIp(ipAddress) {
  return ipAddress ? ipAddress.replace(/^::ffff:/, "") : null;
}

/**
 * Get the User-Agent string.
 */
function getUserAgent(req) {
  return req.headers["user-agent"] || "";
}

/**
 * Get the MAC address for a given IP.
 */
function getClientMac(ipAddress, interfaceName) { // Accept interface name as argument
  return new Promise((resolve, reject) => {
    if (!ipAddress) {
      return resolve(null);
    }

    const normalizedIp = ipAddress.replace(/^::ffff:/, "");

    // Use the provided interface name in the command
    exec(`ip neigh show dev ${interfaceName} | grep "${normalizedIp}"`, (error, stdout) => {
      if (error) {
        console.error(`Error retrieving MAC address: ${error.message}`);
        return resolve(null);
      }

      const match = stdout.match(/lladdr\s+([0-9a-fA-F:]+)/);
      if (match) {
        resolve(match[1].toLowerCase());
      } else {
        console.warn(`MAC address not found for IP: ${normalizedIp}`);
        resolve(null);
      }
    });
  });
}

// Use environment variables for listening IP and Port
const listenIp = process.env.PROXY_LISTEN_IP;
const listenPort = parseInt(process.env.PROXY_LISTEN_PORT, 10);

// Validate parsed port
if (isNaN(listenPort)) {
  console.error('Error: PROXY_LISTEN_PORT must be a valid number.');
  process.exit(1);
}

server.listen(listenPort, listenIp, () => {
  console.log(`Proxy server is running on http://${listenIp}:${listenPort}`);
});
