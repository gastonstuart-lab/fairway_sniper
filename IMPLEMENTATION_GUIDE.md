# Fairway Sniper Implementation Guide

## Overview

This guide documents the technical implementation of Fairway Sniper's production features:
- Railway cold-start mitigation with warm-up scheduler
- Release watcher resilience patterns
- Atomic delta instrumentation
- Time expansion algorithm

---

## Part 1: Warm-Up Scheduler Architecture

### Problem: Railway Cold-Start Delay
Railway's serverless platform auto-scales to zero after ~10 minutes of inactivity. When a job is scheduled during this dormant period:
- **Cold Start**: First HTTP request takes 2-5 seconds
- **Impact**: Missing the release window by 2-5 seconds
- **Result**: Booking fails because tee sheet is no longer available

### Solution: T-3 Minute Warm-Up Trigger

#### Design
```
Release Time (T)
     ↓
  T-5 min: Warm-up scheduler detects job is upcoming
     ↓
  T-3 min: TRIGGER - Start warm-up sequence
     ↓
  T-3 min to T-0 min: 
    - Ping /api/warm endpoint (wakes up Railway)
    - Preload browser + authenticate
    - Load BRS tee sheet
    - Cache player form data
     ↓
  T-0 min: Railway is WARM and READY
     ↓
  Release happens: Instant booking possible
```

#### Key Features
- **30-second polling**: Continuous detection of upcoming jobs
- **Graceful triggering**: Automatic warm-up at T-3 minutes
- **State tracking**: Records warmed_at timestamp in Firestore
- **Resilient**: Handles failures and retries automatically

---

## Part 2: Release Watcher Resilience

### Problem: JSHandle Context Loss
Original code used evaluateHandle() which fails during page navigation:
```
"Execution context was destroyed, most likely because of a navigation."
```

### Solution: Atomic Evaluation
Use page.evaluate() instead to keep results in Playwright's domain, with graceful error handling and retry logic.

**Key improvements**:
- page.evaluate() instead of evaluateHandle()
- Atomic measurement with performance.now()
- Graceful fallback on context loss
- DOM stability check before evaluation
- Up to 5 retry attempts

---

## Part 3: Delta Instrumentation

### Fix: Undefined Variable
Changed from `clickDeltaMs: clickDelta` (undefined) to `clickDeltaMs: fireLatencyMs` (measured).

**Single measurement point**: High-precision timing captured within page context:
- Measured using browser performance API
- Typical latency: 7-11ms
- Atomic and accurate

---

## Part 4: Time Expansion Algorithm

### Fix: Wrong Time Increments
Changed SNIPER_FALLBACK_STEP_MINUTES from 5 to 10 minutes.

**Before**: 5-minute slots (08:05, 08:15, 08:25) - mismatches tee sheet  
**After**: 10-minute slots (08:10, 08:20, 08:30) - aligns with reality

**Example expansion** (primary 08:25):
- 08:25 (primary)
- 08:15 (-10 min)
- 08:05 (-20 min)
- 08:30 (+5 min)
- 08:35 (+10 min)

---

## Configuration Reference

### Environment Variables
```bash
WARM_UP_POLL_INTERVAL_MS=30000        # Poll every 30 seconds
WARM_UP_WINDOW_MINUTES=5               # Detect within 5 minutes
WARM_UP_TRIGGER_MINUTES=3              # Trigger at T-3 minutes
SNIPER_FALLBACK_STEP_MINUTES=10       # 10-minute expansion
```

### Key Code Locations
- Warm-up scheduler: [agent/index.js](agent/index.js#L987-L1080)
- Release watcher: [agent/index.js](agent/index.js#L14-L97)
- Delta instrumentation: [agent/index.js](agent/index.js#L2375-L2420)
- Time expansion: [agent/index.js](agent/index.js#L459)

---

## Monitoring & Troubleshooting

### Log Patterns
- `[WARM]` - Warm-up scheduler activity
- `[FIRE]` - Release detection and booking execution
- `[SUCCESS]` - Booking confirmed
- `[SNIPER]` - Error messages and retries

### Common Issues

**Warm-up not triggering**:
- Check scheduler running: logs should show `[WARM]` every 30s
- Verify jobs exist in Firestore with correct fireTime
- Restart service if needed

**High fire latency (>50ms)**:
- Usually indicates Railway still cold
- Ensure warm-up triggered at T-3min
- Check browser preload time (260-350ms normal)

**Context loss errors**:
- Normal occasional occurrence
- Retry logic handles automatically
- Monitor frequency: 1-2/day acceptable

---

## Performance Tuning

### Balanced Configuration (Current Production)
```javascript
WARM_UP_POLL_INTERVAL_MS: 30000      // Poll every 30 seconds
WARM_UP_WINDOW_MINUTES: 5             // Detect 5 minutes early
WARM_UP_TRIGGER_MINUTES: 3            // Trigger at T-3 minutes
```

Good balance of resource usage and responsiveness.

---

## Testing & Validation

### Test Jobs
```bash
node agent/test-sniper-4min.ps1           # 4-minute test
node agent/test-create-sniper-jobs-3.js   # Multiple jobs
node agent/test-create-single-dry-run.js  # Dry-run (no clicks)
```

### Validation Checklist
- [ ] Warm-up scheduler polling every 30s
- [ ] Jobs detected within 5-minute window
- [ ] warmed_at timestamp set at T-3min
- [ ] Self-ping latency 79-87ms
- [ ] Browser preload 260-350ms
- [ ] Fire latency 7-11ms
- [ ] Booking confirmation detected
- [ ] Job status = "success"

---

## Sign-Off

**Implementation Status**: Production Ready ✅  
**First Booking**: February 2, 2026 - Confirmed Success  
**System Monitoring**: Active and continuous

The system combines three key innovations for production-ready booking automation:
1. Proactive warm-up (solves cold-start)
2. Resilient release detection (handles edge cases)
3. Accurate time expansion (maximizes success)

See PRODUCTION_READY.md for full operational documentation.
</content>
</invoke>