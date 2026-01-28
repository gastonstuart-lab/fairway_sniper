# Fairway Sniper API Reference

## Core Endpoint: `/api/snipe`

**Mode**: POST  
**Purpose**: Unified snipe endpoint for both Normal and Sniper app modes

### Request Body

```json
{
  "username": "12390624",           // BRS login username (required)
  "password": "cantona7777",        // BRS login password (required)
  "targetDate": "2026-01-29",       // YYYY-MM-DD format (required)
  "preferredTimes": ["07:56", "08:04"],  // Preferred tee times (optional, for snipe mode)
  "players": ["John Doe", "Jane Smith"],  // Player 2-4 names (optional, for snipe mode only)
  "checkOnly": false                 // true = check availability only, false = auto-book (optional, default: false)
}
```

### Response (Check-Only Mode: `checkOnly: true`)

```json
{
  "success": true,
  "available": true,
  "slots": 30,                       // Number of available slots on this date
  "times": ["08:30", "08:40", "08:50", ...],  // List of available times
  "date": "2026-01-29"
}
```

### Response (Auto-Book Mode: `checkOnly: false` or omitted)

**If slots available and booking succeeds:**
```json
{
  "success": true,
  "booked": true,
  "result": { ... },                 // Booking confirmation details
  "error": null,
  "slots": 30,
  "timestamp": "2026-01-28T10:30:00Z"
}
```

**If no slots available:**
```json
{
  "success": false,
  "available": false,
  "slots": 0,
  "times": [],
  "error": "No available slots on this date",
  "date": "2026-01-29"
}
```

**If booking fails:**
```json
{
  "success": false,
  "available": true,
  "slots": 30,
  "error": "Failed to click confirmation button",
  "timestamp": "2026-01-28T10:30:00Z"
}
```

## Supporting Endpoints

### `/api/fetch-tee-times`
Check availability for a single date (doesn't auto-book)

**Request**: `{ "date": "2026-01-29", "username": "...", "password": "..." }`  
**Response**: `{ "success": true, "times": [...], "slots": 30 }`

### `/api/fetch-tee-times-range`
Check availability across multiple days

**Request**: `{ "startDate": "2026-01-29", "days": 7, "username": "...", "password": "..." }`  
**Response**: `{ "success": true, "days": [ { "date": "2026-01-29", "times": [...], "slots": 30 }, ... ], "count": 7 }`

### `/api/book-now`
Legacy immediate booking endpoint (deprecated in favor of `/api/snipe`)

## App Integration

### Normal Mode
```
1. User selects target date (today/tomorrow)
2. App calls: POST /api/snipe { checkOnly: true, ... }
3. App displays available times + slots count
4. User manually selects time + players
5. App calls: POST /api/snipe { checkOnly: false, ... }
   OR manual booking through BRS UI
```

### Sniper Mode
```
1. User schedules snipe for future date + preferred times
2. At release time, Sniper app calls: POST /api/snipe { checkOnly: false, ... }
3. Agent checks availability → if slots found, auto-fills players → auto-confirms
4. User is first (automated instant response)
```

## Key Features

✅ **Multi-day scanning**: Automatically hops forward if target date has no slots  
✅ **Dialog auto-accept**: Handles all BRS popup dialogs  
✅ **SPA-safe navigation**: Uses `domcontentloaded` + UI signals (no networkidle hangs)  
✅ **Player auto-fill**: Fills Player 2-4 names automatically  
✅ **Auto-confirm**: Clicks confirm button without user intervention  
✅ **Slot availability reporting**: Returns accurate count of available slots  

## Error Handling

- `400 Bad Request`: Missing required fields (username, password, targetDate)
- `401 Unauthorized`: Invalid BRS credentials
- `500 Server Error`: Playwright automation failed (check logs)

## Deployment

**Agent URL**: `http://localhost:3000` (local) or production URL  
**Expected endpoints**:
- `POST /api/snipe` → Main endpoint for app
- `POST /api/fetch-tee-times` → Check availability only
- `GET /api/health` → Server status
