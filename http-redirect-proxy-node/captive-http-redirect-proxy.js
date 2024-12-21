const httpProxy = require("http-proxy");
const http = require("http");
const { exec } = require("child_process");

// Create a proxy server
const proxy = httpProxy.createProxyServer({});

// Define the target server for the captive portal
const captivePortalTarget = "http://192.168.1.1";

// Start an HTTP server
const server = http.createServer(async (req, res) => {
  try {
    const hostHeader = req.headers.host; // Get the Host header
    const clientIp = getNormalizedClientIp(getClientIp(req));
    const userAgent = getUserAgent(req);
    const originalUrl = req.url;
    const referer = req.headers.referer || ""; // Capture the HTTP referer (if available)
    const httpMethod = req.method; // Capture the HTTP method (GET, POST, etc.)

    let clientMac = await getClientMac(clientIp); // Retrieve the MAC address
    if (!clientMac) clientMac = "unknown"; // Fallback if MAC address is unavailable

    if (hostHeader === "captive.local") {
      // Build query parameters for captive portal target
      const params = new URLSearchParams();
      params.set("ip", clientIp);
      params.set("mac", clientMac);
      params.set("agent", userAgent);
      params.set("original_url", encodeURIComponent(originalUrl));
      params.set("http_method", httpMethod);
      params.set("referer", encodeURIComponent(referer));

      // Proxy the request to the captive portal
      console.log(`Forwarding to captive portal: ${captivePortalTarget}?${params.toString()}`);
      proxy.web(req, res, { target: `${captivePortalTarget}?${params.toString()}` });
    } else {
      // Redirect to captive.ganainy.online
      console.log(`Redirecting: ${hostHeader} -> captive.local`);
      const params = new URLSearchParams();
      params.set("ip", clientIp);
      params.set("mac", clientMac);
      params.set("agent", userAgent);
      params.set("original_url", encodeURIComponent(originalUrl));
      params.set("http_method", httpMethod);
      params.set("referer", encodeURIComponent(referer));

      res.writeHead(302, { Location: `http://captive.local?${params.toString()}` });
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
function getClientMac(ipAddress) {
  return new Promise((resolve, reject) => {
    if (!ipAddress) {
      return resolve(null);
    }

    const normalizedIp = ipAddress.replace(/^::ffff:/, "");

    exec(`ip neigh show dev wlan0 | grep "${normalizedIp}"`, (error, stdout) => {
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

server.listen(8080, "0.0.0.0", () => {
  console.log("Proxy server is running locally on all interfaces port 8080");
});
