# Fairway Sniper - Quick Reference Guide

## 🚀 System Status
- **Status**: ✅ LIVE & PRODUCTION READY
- **Platform**: Railway (https://fairwaysniper-production.up.railway.app)
- **Last Deploy**: February 2, 2026 (commit 5efb3d7)
- **Latest Version**: Warm-up scheduler + resilience fixes + time expansion

---

## 📋 Before Release Window (Do This 15 Minutes Before)

1. **Verify Railway is Active**
   ```
   curl https://fairwaysniper-production.up.railway.app/api/health
   # Should return: {"status":"ready"}
   ```

2. **Check Warm-Up Scheduler**
   - Go to Railway dashboard → Service Logs
   - Should see `[WARM]` messages every 30 seconds
   - If not: System may need restart

3. **Verify Firestore Connection**
   - Check Firebase console → Firestore Database
   - Should see 'jobs' collection with active jobs
   - If empty: Create test job to verify

4. **Test Booking Flow** (Optional but recommended)
   ```bash
   # Create a test job for 4 minutes from now
   node agent/test-sniper-4min.ps1
   # Watch logs for [WARM] and [FIRE] messages
   ```

---

## 📡 During Release Window (Continuous Monitoring)

1. **Open Railway Logs** (Dashboard → Service Logs)
2. **Watch for these patterns**:
   ```
   [WARM] Warming up job...       ← Good, warm-up triggered at T-3min
   [FIRE] Click executed at...    ← Good, booking starting
   [SUCCESS] ✅ Booking confirmed ← Perfect, booking succeeded
   ```

3. **If you see errors**:
   ```
   Execution context was destroyed → Normal, system will retry
   Release watcher error (attempt 1/5) → Still recovering
   Release watcher max retries exceeded → Problem, needs investigation
   ```

4. **Verify on BRS Website**
   - Log into your GolfNow account
   - Check if booking appears under your upcoming bookings
   - Confirm tee time matches what was requested

---

## 🔍 After Booking (Verification)

1. **Check Job Record in Firestore**
   - Go to: Firebase Console → Firestore → jobs collection
   - Filter for latest job
   - Should show: `status: "success"` and `booked: true`

2. **Review Metrics**
   ```json
   {
     "fireLatencyMs": 8,        // Should be 7-11ms (good timing)
     "warm_up_latency_ms": 87,   // Should be 79-87ms (normal)
     "browser_preload_ms": 289   // Should be 260-350ms (normal)
   }
   ```

3. **Confirm on BRS**
   - Tee time should appear in your booking list
   - Confirmation email should arrive
   - Status should show "Booked"

---

## 🔧 Troubleshooting Quick Fixes

### Problem: Warm-up scheduler not running
**Signs**: No `[WARM]` messages in logs  
**Fix**: Restart service in Railway console (Projects → fairwaysniper-production → Restart)

### Problem: High fire latency (>50ms)
**Signs**: `[SNIPER] High fire latency detected: 67ms`  
**Fix**: Probably cold-start despite warm-up. Try warm-up endpoint: `curl https://fairwaysniper-production.up.railway.app/api/warm`

### Problem: Release watcher context loss
**Signs**: `Execution context was destroyed` messages  
**Fix**: Normal, system retries automatically. Monitor retry count (should succeed within 1-2 attempts)

### Problem: Booking shows failed but it actually went through
**Signs**: Job status = "failed" but booking appears in BRS account  
**Fix**: Check Firestore for the actual error. May need to manually update job status to "success"

### Problem: No booking, no errors in logs
**Signs**: Silent failure  
**Fix**: 
1. Check Firestore job record for error details
2. Verify BRS website is responding (manual test)
3. Check if form selectors changed
4. Review full agent logs: `railway logs --tail 100`

---

## 📚 Quick Reference Links

**Documentation**:
- [PRODUCTION_READY.md](PRODUCTION_READY.md) - Full operational guide
- [IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md) - Technical deep dive
- [SESSION_COMPLETION_SUMMARY.md](SESSION_COMPLETION_SUMMARY.md) - What was done

**Code**:
- [agent/index.js](agent/index.js) - Main booking engine (warm-up: lines 987-1080)
- [agent/warm_session.js](agent/warm_session.js) - Browser preload logic
- [agent/Dockerfile](agent/Dockerfile) - Container config

**Monitoring**:
- [Railway Dashboard](https://railway.app) - Service logs & status
- [Firebase Console](https://console.firebase.google.com) - Firestore jobs collection
- [GitHub Repo](https://github.com/gastonstuart-lab/fairway_sniper) - Code & deployment history

---

## 🎯 Critical Commands

```bash
# View last 10 commits
git log --oneline -10

# Check latest code version
git log --oneline main -1

# View current branch
git status

# Restart Railway service
# (Use Railway console, no CLI command available)

# Test health endpoint
curl https://fairwaysniper-production.up.railway.app/api/health

# Warm-up ping (if needed)
curl https://fairwaysniper-production.up.railway.app/api/warm

# Create test job (for testing)
node agent/test-sniper-4min.ps1
```

---

## ⚠️ Critical Alerts

| Alert | Severity | Action |
|-------|----------|--------|
| No [WARM] messages for >2 min | 🔴 HIGH | Restart service immediately |
| Fire latency > 100ms | 🟡 MEDIUM | Investigate network/Railway |
| Max retries exceeded | 🔴 HIGH | Check error logs, may need code fix |
| Booking failed but no error | 🟡 MEDIUM | Check Firestore job record |
| Service unreachable | 🔴 HIGH | Check Railway console for crashes |

---

## 📊 Healthy System Indicators

✅ `[WARM]` messages every 30 seconds in logs  
✅ Fire latency 7-11ms  
✅ Browser preload 260-350ms  
✅ Self-ping latency 79-87ms  
✅ Job status = "success" after booking  
✅ Confirmation text detected automatically  
✅ Tee time appears in BRS account  
✅ No "Execution context destroyed" errors (or only 1-2)

---

## 🛑 When to Escalate

1. **Service crashes repeatedly**
   - Check Railway logs for error patterns
   - Verify Firebase credentials
   - Check if BRS website changed

2. **Bookings consistently fail**
   - Review BRS website structure (may have changed)
   - Check player data validation logic
   - Verify credentials are correct

3. **High latency (>100ms consistently)**
   - Railway may need scaling
   - Network latency to BRS/GolfNow
   - Browser preload may need optimization

4. **Lost Firebase connection**
   - Verify service account credentials in Railway env
   - Check Firebase project is accessible
   - Restart service to reconnect

---

## 📞 Support Contacts

For issues:
1. Check documentation files (linked above)
2. Review logs in Railway dashboard
3. Check Firestore job records for error details
4. Review GitHub commit history for recent changes

---

## 🎓 Learning Resources

- **Warm-up Scheduler**: See lines 987-1080 in [agent/index.js](agent/index.js)
- **Release Watcher**: See lines 14-97 in [agent/index.js](agent/index.js)
- **Time Expansion**: See line 459 in [agent/index.js](agent/index.js)
- **Configuration**: See CONFIG object around line 450 in [agent/index.js](agent/index.js)

---

## ✅ Session Complete

**System Status**: 🟢 LIVE & MONITORING  
**Ready for**: Immediate booking operations  
**Last Update**: February 2, 2026  

**All 4 required tasks completed**:
1. ✅ Merged to production
2. ✅ Documented implementation
3. ✅ Set up monitoring
4. ✅ Prepared for future bookings

**Next Step**: Monitor first release window for successful booking confirmation.
