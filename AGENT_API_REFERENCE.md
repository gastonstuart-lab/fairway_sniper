# Fairway Sniper Agent - API Reference

## Overview

The Fairway Sniper Agent is a lightweight HTTP wrapper around Playwright automation. It provides REST endpoints for the Flutter app to control tee time bookings.

**Base URL**: `http://localhost:3000` (or your agent server URL)

---

## Endpoints

### 1. Health Check

**GET** `/api/health`

Check if the agent is running and authenticated.

**Response** (200 OK):

```json
{
  "status": "ok",
  "service": "fairway-sniper-agent",
  "authenticated": true,
  "state_file": "loaded"
}
```

**Usage**:

```dart
final response = await http.get(Uri.parse('http://localhost:3000/api/health'));
// {"status":"ok","service":"fairway-sniper-agent","authenticated":true,"state_file":"loaded"}
```

---

### 2. Fetch Available Tee Times

**POST** `/api/fetch-tee-times`

Get all available booking times for a specific date at a golf club.

**Request Body**:

```json
{
  "date": "2025-12-06",
  "club": "galgorm"
}
```

**Parameters**:

- `date` (required): Date in YYYY-MM-DD format
- `club` (optional): Golf club code, defaults to "galgorm"

**Response** (200 OK):

```json
{
  "success": true,
  "date": "2025-12-06",
  "times": ["08:31", "09:32", "09:40", "09:48", "10:04", "10:12"],
  "count": 21
}
```

**Error Response** (401, 400, 500):

```json
{
  "success": false,
  "error": "Date parameter required (YYYY-MM-DD)"
}
```

**Usage in Dart**:

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<List<String>> fetchTeeTimes(String date) async {
  final response = await http.post(
    Uri.parse('http://localhost:3000/api/fetch-tee-times'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'date': date,
      'club': 'galgorm'
    }),
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return List<String>.from(data['times'] ?? []);
  } else {
    throw Exception('Failed to fetch tee times: ${response.body}');
  }
}
```

---

### 3. Fetch Player Directory

**POST** `/api/fetch-players`

Get the list of available players to book as.

**Request Body**:

```json
{
  "club": "galgorm"
}
```

**Parameters**:

- `club` (optional): Golf club code, defaults to "galgorm"

**Response** (200 OK):

```json
{
  "success": true,
  "players": [
    "Abernethy, Martin",
    "Adams, Adrian",
    "Adams, Andrew",
    "Adams, Avril",
    "Adams, Harry"
  ],
  "count": 767,
  "source": "cached",
  "scrapedAt": "2025-12-05T04:11:32.105Z"
}
```

**Usage in Dart**:

```dart
Future<List<String>> fetchPlayers() async {
  final response = await http.post(
    Uri.parse('http://localhost:3000/api/fetch-players'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({'club': 'galgorm'}),
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return List<String>.from(data['players'] ?? []);
  } else {
    throw Exception('Failed to fetch players: ${response.body}');
  }
}
```

---

### 4. Book a Tee Time

**POST** `/api/book-tee-time`

Book a tee time for a specific date, time, and player.

**Request Body**:

```json
{
  "date": "2025-12-06",
  "time": "10:04",
  "players": ["Abernethy, Martin"],
  "club": "galgorm"
}
```

**Parameters**:

- `date` (required): Date in YYYY-MM-DD format
- `time` (required): Time in HH:MM format
- `players` (required): Array with at least one player name
- `club` (optional): Golf club code, defaults to "galgorm"

**Response** (200 OK):

```json
{
  "success": true,
  "message": "Time 10:04 is available - booking logic ready to implement",
  "date": "2025-12-06",
  "time": "10:04",
  "player": "Abernethy, Martin",
  "status": "ready_to_book",
  "note": "Full booking modal interaction implemented in phase 2"
}
```

**Error Response** (400, 500):

```json
{
  "success": false,
  "error": "Time slot 14:00 not available or not found"
}
```

**Usage in Dart**:

```dart
Future<bool> bookTeeTime(String date, String time, String player) async {
  final response = await http.post(
    Uri.parse('http://localhost:3000/api/book-tee-time'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({
      'date': date,
      'time': time,
      'players': [player],
      'club': 'galgorm'
    }),
  );

  if (response.statusCode == 200) {
    final data = jsonDecode(response.body);
    return data['success'] == true;
  } else {
    throw Exception('Failed to book tee time: ${response.body}');
  }
}
```

---

## Complete Flutter Integration Example

```dart
// lib/services/agent_service.dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class AgentService {
  static const String baseUrl = 'http://localhost:3000';

  /// Check if agent is running and authenticated
  static Future<bool> isHealthy() async {
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/api/health'),
        headers: {'Content-Type': 'application/json'},
      ).timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['authenticated'] == true;
      }
      return false;
    } catch (e) {
      print('Agent health check failed: $e');
      return false;
    }
  }

  /// Fetch available tee times for a date
  static Future<List<String>> fetchTeeTimes(String date) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/fetch-tee-times'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'date': date,
          'club': 'galgorm'
        }),
      ).timeout(const Duration(seconds: 30));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return List<String>.from(data['times'] ?? []);
      }
      throw Exception('Status: ${response.statusCode}');
    } catch (e) {
      print('Error fetching tee times: $e');
      rethrow;
    }
  }

  /// Fetch available players
  static Future<List<String>> fetchPlayers() async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/fetch-players'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'club': 'galgorm'}),
      ).timeout(const Duration(seconds: 15));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return List<String>.from(data['players'] ?? []);
      }
      throw Exception('Status: ${response.statusCode}');
    } catch (e) {
      print('Error fetching players: $e');
      rethrow;
    }
  }

  /// Book a tee time
  static Future<bool> bookTeeTime({
    required String date,
    required String time,
    required String player,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/book-tee-time'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'date': date,
          'time': time,
          'players': [player],
          'club': 'galgorm'
        }),
      ).timeout(const Duration(seconds: 45));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        return data['success'] == true;
      }
      throw Exception('Status: ${response.statusCode}');
    } catch (e) {
      print('Error booking tee time: $e');
      rethrow;
    }
  }
}
```

---

## Setup Instructions

### 1. Start the Agent

```powershell
cd C:\Users\stuar\Projects\fairway_sniper\agent
$env:PORT=3000
node simple-agent.js
```

Or use PowerShell background job:

```powershell
Start-Job -ScriptBlock {
    cd "C:\Users\stuar\Projects\fairway_sniper\agent"
    $env:PORT=3000
    node simple-agent.js
} -Name AgentServer
```

### 2. Update Flutter App Configuration

In your Flutter project, update the base URL:

```dart
// Replace http://localhost:3000 with your actual agent URL
// For Android emulator: http://10.0.2.2:3000
// For iOS simulator: http://localhost:3000
// For physical device: http://<your-computer-ip>:3000
```

### 3. Test Connectivity

```dart
void main() {
  runApp(MyApp());

  // Test agent connection on startup
  AgentService.isHealthy().then((isHealthy) {
    print('Agent connected: $isHealthy');
  });
}
```

---

## Error Handling

Always handle potential errors:

```dart
try {
  final times = await AgentService.fetchTeeTimes('2025-12-06');
  // Use times...
} on SocketException {
  // Network error - agent not running or network unreachable
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('Cannot connect to booking agent')),
  );
} catch (e) {
  // Other error
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text('Error: $e')),
  );
}
```

---

## Testing

Run the provided test script:

```powershell
cd C:\Users\stuar\Projects\fairway_sniper
pwsh -File .\TEST_AGENT_ENDPOINTS.ps1
```

Expected output:

```
✅ GET /api/health - SUCCESS
✅ POST /api/fetch-tee-times - SUCCESS
✅ POST /api/fetch-players - SUCCESS
✅ POST /api/book-tee-time - SUCCESS
```

---

## Notes

- The agent requires `automation/state.json` with valid BRS Golf authentication credentials
- All player names are cached from a previous scrape (767 players)
- Tee times are fetched live from the BRS Golf website
- Full booking modal automation is planned for Phase 2
