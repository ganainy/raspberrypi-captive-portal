<?php
// Enable error reporting for debugging
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Database configuration
if (file_exists(__DIR__ . '/.env')) {
    $env = parse_ini_file(__DIR__ . '/.env');
    define('DB_HOST', $env['DB_HOST'] ?? 'localhost');
    define('DB_NAME', $env['DB_NAME'] ?? '');
    define('DB_USER', $env['DB_USER'] ?? '');
    define('DB_PASS', $env['DB_PASSWORD'] ?? '');
} else {
    error_log("No .env file found in the same directory");
    exit(1);
}

// Set response headers
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");


// Function to convert millisecond timestamp to MySQL datetime format
function convertTimestampToMysql($timestamp) {
    if (strlen($timestamp) == 13) {
        $timestamp = floor($timestamp / 1000);
    }
    return date('Y-m-d H:i:s', $timestamp);
}

if (strpos($request_uri, '/upload/report') !== false) {
    try {
        $db = getDbConnection();
        
        $jsonData = file_get_contents('php://input');
        $data = json_decode($jsonData, true);
        
        if (json_last_error() !== JSON_ERROR_NONE) {
            sendResponse(false, "Invalid JSON data: " . json_last_error_msg(), 400, [
                'received_data' => $jsonData
            ]);
        }

        $db->beginTransaction();

        // Save/Update network session if present
        if (isset($data['session'])) {
            $session = $data['session'];
            $fields = [];
            $values = [];
            $updateParts = [];
            
            $possibleFields = [
                'sessionId', 'ssid', 'bssid', 'timestamp', 'captivePortalUrl',
                'ipAddress', 'gatewayAddress', 'securityType', 'isCaptiveLocal'
            ];

            foreach ($possibleFields as $field) {
                if (isset($session[$field])) {
                    $fields[] = $field;
                    if ($field === 'isCaptiveLocal') {
                        $value = $session[$field] ? 1 : 0;
                    } elseif ($field === 'timestamp') {
                        $value = convertTimestampToMysql($session[$field]);
                    } else {
                        $value = $session[$field];
                    }
                    $values[] = $value;
                    if ($field !== 'sessionId') { // Don't update the primary key
                        $updateParts[] = "$field = ?";
                    }
                }
            }

            if (!empty($fields)) {
                // Use REPLACE INTO for network_sessions
                $query = "REPLACE INTO network_sessions (" . 
                         implode(', ', $fields) . 
                         ") VALUES (" . 
                         implode(', ', array_fill(0, count($fields), '?')) . ")";
                $stmt = $db->prepare($query);
                $stmt->execute($values);
            }
        }

        // Delete existing requests for this session before inserting new ones
        if (isset($data['requests']) && is_array($data['requests']) && !empty($data['requests'])) {
            $sessionId = $data['requests'][0]['sessionId'];
            $stmt = $db->prepare("DELETE FROM custom_webview_request WHERE sessionId = ?");
            $stmt->execute([$sessionId]);
            
            // Insert new requests
            $stmtRequests = $db->prepare("
                INSERT INTO custom_webview_request (
                    sessionId, type, url, method, body, domain, headers
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ");
            
            foreach ($data['requests'] as $request) {
                $stmtRequests->execute([
                    getValueOrNull($request, 'sessionId'),
                    getValueOrNull($request, 'type'),
                    getValueOrNull($request, 'url'),
                    getValueOrNull($request, 'method'),
                    getValueOrNull($request, 'body'),
                    getValueOrNull($request, 'domain'),
                    getValueOrNull($request, 'headers')
                ]);
            }
        }

        // Update screenshots - use REPLACE INTO
        if (isset($data['screenshots']) && is_array($data['screenshots'])) {
            $stmtScreenshots = $db->prepare("
                REPLACE INTO screenshots (
                    screenshotId, sessionId, timestamp, path, size, url
                ) VALUES (?, ?, ?, ?, ?, ?)
            ");
            
            foreach ($data['screenshots'] as $screenshot) {
                $timestampValue = isset($screenshot['timestamp']) ? 
                    convertTimestampToMysql($screenshot['timestamp']) : 
                    null;
                
                $stmtScreenshots->execute([
                    getValueOrNull($screenshot, 'screenshotId'),
                    getValueOrNull($screenshot, 'sessionId'),
                    $timestampValue,
                    getValueOrNull($screenshot, 'path'),
                    getValueOrNull($screenshot, 'size'),
                    getValueOrNull($screenshot, 'url')
                ]);
            }
        }

        // Update webpage content - delete existing and insert new
        if (isset($data['webpageContent']) && is_array($data['webpageContent']) && !empty($data['webpageContent'])) {
            $sessionId = $data['webpageContent'][0]['sessionId'];
            $stmt = $db->prepare("DELETE FROM webpage_content WHERE sessionId = ?");
            $stmt->execute([$sessionId]);
            
            $stmtWebpage = $db->prepare("
                INSERT INTO webpage_content (
                    sessionId, url, html, javascript, timestamp
                ) VALUES (?, ?, ?, ?, ?)
            ");
            
            foreach ($data['webpageContent'] as $content) {
                $timestampValue = isset($content['timestamp']) ? 
                    convertTimestampToMysql($content['timestamp']) : 
                    null;
                
                $stmtWebpage->execute([
                    getValueOrNull($content, 'sessionId'),
                    getValueOrNull($content, 'url'),
                    getValueOrNull($content, 'html'),
                    getValueOrNull($content, 'javascript'),
                    $timestampValue
                ]);
            }
        }

        $db->commit();
        sendResponse(true, "Report data updated successfully");

    } catch (Exception $e) {
        if (isset($db)) {
            $db->rollBack();
        }
        error_log($e->getMessage());
        sendResponse(false, "Failed to save report data: " . $e->getMessage(), 500);
    }
} elseif (strpos($request_uri, '/upload/image') !== false) {
    try {
        // Validate image file
        if (!isset($_FILES['image'])) {
            sendResponse(false, "No image file provided", 400);
        }

        $image = $_FILES['image'];
        $sessionId = $_POST['sessionId'] ?? 'unknown_session';
        $screenshotId = $_POST['screenshotId'] ?? 'unknown_screenshot_' . time();

        // Validate upload
        if ($image['error'] !== UPLOAD_ERR_OK) {
            sendResponse(false, "Image upload error: " . $image['error'], 400);
        }

        // Create upload directory
        $uploadDir = "uploads/$sessionId";
        if (!file_exists($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        // Get original file extension
        $ext = pathinfo($image['name'], PATHINFO_EXTENSION);
        $targetPath = $uploadDir . '/' . $screenshotId . '.' . $ext;

        // Move the uploaded file
        if (move_uploaded_file($image['tmp_name'], $targetPath)) {
            sendResponse(true, "Image uploaded successfully");
        } else {
            throw new Exception("Failed to save image file");
        }

    } catch (Exception $e) {
        error_log($e->getMessage());
        sendResponse(false, "Failed to process image upload: " . $e->getMessage(), 500);
    }
} else {
    sendResponse(false, "Invalid endpoint", 404);
}
?>