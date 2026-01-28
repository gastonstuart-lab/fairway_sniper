# 🚀 Quick Start Guide - Fairway Sniper Agent

## Status: ✅ READY FOR FLUTTER INTEGRATION

All HTTP API endpoints are working and tested. Your Flutter app can now make booking requests!

---

## 1️⃣ Start the Agent

Open PowerShell and run:

```powershell
cd C:\Users\stuar\Projects\fairway_sniper\agent
$env:PORT=3000
node simple-agent.js
```

You should see:

```
🚀 Fairway Sniper Agent Started
   Port: 3000
   State file: C:\Users\stuar\Projects\fairway_sniper\automation\state.json
   State loaded: ✅
```

---

## 2️⃣ Verify Agent is Working

Run the test script in a new PowerShell window:

```powershell
cd C:\Users\stuar\Projects\fairway_sniper
pwsh -File .\TEST_AGENT_ENDPOINTS.ps1
```

Expected output:

```
✅ GET /api/health - SUCCESS
✅ POST /api/fetch-tee-times - SUCCESS (21 slots)
✅ POST /api/fetch-players - SUCCESS (767 players)
✅ POST /api/book-tee-time - SUCCESS
```

---

## 3️⃣ Connect Flutter App

### For Android Emulator:

```dart
// In your service class:
static const String baseUrl = 'http://10.0.2.2:3000';
```

### For iOS Simulator:

```dart
// In your service class:
static const String baseUrl = 'http://localhost:3000';
```

### For Physical Device:

```dart
// In your service class:
// Replace YOUR_IP with your computer's IP (e.g., 192.168.1.100)
static const String baseUrl = 'http://YOUR_IP:3000';

// Find your IP in PowerShell:
// ipconfig | findstr "IPv4"
```

---

## 4️⃣ Use the API

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

// Check if agent is running
bool isHealthy = await isAgentHealthy();

// Get available tee times for tomorrow
List<String> times = await fetchTeeTimes('2025-12-06');
// Result: ['08:31', '09:32', '09:40', '10:04', ...]

// Get players
List<String> players = await fetchPlayers();
// Result: ['Abernethy, Martin', 'Adams, Adrian', ...]

// Book a time
bool booked = await bookTeeTime(
  date: '2025-12-06',
  time: '10:04',
  player: 'Abernethy, Martin',
);
```

### Complete Service Class:

See `lib/services/agent_service.dart` - Copy from `AGENT_API_REFERENCE.md`

---

## 5️⃣ API Endpoints Summary

| Method | Endpoint               | Purpose                        |
| ------ | ---------------------- | ------------------------------ |
| GET    | `/api/health`          | Check agent is running         |
| POST   | `/api/fetch-tee-times` | Get available times for a date |
| POST   | `/api/fetch-players`   | Get player list                |
| POST   | `/api/book-tee-time`   | Book a tee time                |

---

## 📋 Checklist

- [x] Agent running on port 3000
- [x] All endpoints tested and verified
- [x] 21 available tee times for tomorrow
- [x] 767 players available
- [x] Booking endpoint working
- [ ] Flutter app connected to agent
- [ ] UI shows available times
- [ ] UI shows player list
- [ ] Booking works end-to-end

---

## 🆘 Troubleshooting

**Agent won't start:**

```powershell
# Kill existing Node processes
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
```

**Port 3000 in use:**

```powershell
# Find what's using port 3000
netstat -ano | findstr :3000

# Kill the process
Stop-Process -Id <PID> -Force
```

**Flutter can't connect:**

- Check agent is running
- Check firewall allows port 3000
- Check network connectivity
- Try from command line first: `Invoke-WebRequest http://YOUR_IP:3000/api/health`

**Stale authentication:**

- Session refreshes automatically
- If endpoints fail, check `automation/state.json` exists

---

## 📚 Full Documentation

- **API Reference**: `AGENT_API_REFERENCE.md`
- **Status Report**: `STATUS_REPORT_AGENT_API.md`
- **Test Script**: `TEST_AGENT_ENDPOINTS.ps1`

---

## Next: Flutter UI Implementation

Once connected, implement:

1. **Date Picker Screen**

   - Let user select date
   - Call `/api/fetch-tee-times`
   - Show available times

2. **Time Selection Screen**

   - Show available times from API
   - Let user select a time

3. **Player Selection Screen**

   - Show list from `/api/fetch-players`
   - Let user select a player

4. **Confirm & Book Screen**
   - Show selected date/time/player
   - Call `/api/book-tee-time`
   - Show success/error

---

## 🎉 You're Ready!

Your HTTP API is complete and working. Now just connect your Flutter UI to these endpoints!

Questions? Check the API reference or run `TEST_AGENT_ENDPOINTS.ps1` to verify everything is working.
