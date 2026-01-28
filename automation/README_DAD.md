# ⛳ Fairway Sniper - Automated Tee Time Booking

**For Dad: Your complete guide to automated BRS Golf tee time booking.**

## 🎯 What This Does

Fairway Sniper automatically books tee times at Galgorm Castle (BRS Golf system) every Saturday (or whenever you want).

- ✅ **Automated**: Runs on a schedule (you set it up once)
- ✅ **Safe**: Dry-run mode lets you test before real bookings
- ✅ **Smart**: Picks your preferred tee time automatically
- ✅ **Flexible**: Book any day, time, or number of days ahead

## 🚀 Quick Start (5 minutes)

### 1. Check Your Setup

Before running anything, make sure:
- Node.js 18+ is installed
- You're in the automation folder

```bash
cd C:\Users\stuar\Projects\fairway_sniper\automation
node --version  # should be 18+
```

### 2. Configure Your Preferences

Edit `.env` file with your details:

```env
# Your BRS login
FS_USERNAME=12390624
FS_PASSWORD=cantona7777

# When to book (pick ONE):
# Option A: Next Saturday (default)
FS_DATE_MODE=next-saturday

# Option B: Days from now
# FS_DATE_MODE=days-ahead
# FS_DAYS_AHEAD=7

# Option C: Specific date
# FS_DATE_MODE=specific-date
# FS_TARGET_DATE=2026-02-07

# What time you want
FS_TARGET_TIMES=07:56,08:04

# Safety mode (always start with true!)
FS_DRY_RUN=true
```

### 3. Test It (Dry Run)

**This won't actually book—just shows what it WOULD do:**

```bash
npm run book
```

You'll see:
- Browser opens automatically
- Logs in to BRS
- Navigates to tee sheet
- Finds your preferred time
- Shows what it would book

Check the console output. If you see "✅" everywhere, you're good!

### 4. Actually Book (Live Run)

**Only run this when you're confident:**

```bash
npm run book:live
```

This time it WILL actually book. Watch the browser to confirm.

## ⚙️ Configuration Guide

### Date Selection

Three modes for when to book:

| Mode | Config | Example |
| --- | --- | --- |
| **Next Saturday** | `FS_DATE_MODE=next-saturday` | Always books the coming Saturday |
| **Days Ahead** | `FS_DATE_MODE=days-ahead` + `FS_DAYS_AHEAD=7` | 7 days from today |
| **Specific Date** | `FS_DATE_MODE=specific-date` + `FS_TARGET_DATE=2026-02-07` | Always 2026-02-07 |

### Preferred Times

List multiple times in order of preference:

```env
FS_TARGET_TIMES=07:56,08:04,08:12
```

If 07:56 is unavailable, it tries 08:04, then 08:12.

### Fallback Search

If your preferred day has no slots, search forward:

```env
FS_SEARCH_DAYS=14  # look up to 14 days ahead
```

### Dry Run vs Live

```env
# Test mode (safe, never books)
FS_DRY_RUN=true

# Live mode (actually books!)
FS_DRY_RUN=false
```

Always test with `FS_DRY_RUN=true` first.

## 📅 Common Scenarios

### "Book every Saturday at 08:00"

```env
FS_DATE_MODE=next-saturday
FS_TARGET_TIMES=08:00
FS_DRY_RUN=false
```

Then use Windows Task Scheduler to run `npm run book:live` every Saturday at 7:59 AM.

### "Book 7 days ahead at 07:56"

```env
FS_DATE_MODE=days-ahead
FS_DAYS_AHEAD=7
FS_TARGET_TIMES=07:56
FS_DRY_RUN=false
```

### "Try 08:00, then 08:30, then any time in next 14 days"

```env
FS_DATE_MODE=next-saturday
FS_TARGET_TIMES=08:00,08:30
FS_SEARCH_DAYS=14
FS_CLICK_WAITLIST=true
```

## 🤖 Automation (Windows Task Scheduler)

To run automatically every Saturday:

1. Open **Task Scheduler**
2. Click **Create Task**
3. Name: "Fairway Sniper"
4. Trigger: **Weekly > Saturday > 7:59 AM**
5. Action:
   - Program: `powershell.exe`
   - Arguments: `-Command "cd C:\Users\stuar\Projects\fairway_sniper\automation; npm run book:live"`

Leave it running in the background—it'll book automatically!

## 🆘 Troubleshooting

### "Error: page.waitFor Timeout"
Browser couldn't find tee sheet. BRS might have changed their UI.
- Try dry run first: `npm run book`
- Check browser logs for clues
- Verify credentials in `.env`

### "No tee times found"
Your preferred day/time truly isn't available, or search radius is too small.
- Increase `FS_SEARCH_DAYS` to 21 or more
- Lower your preferred time to earlier (7am instead of 8am)
- Enable `FS_CLICK_WAITLIST=true` to book waitlist

### "Login fails"
Wrong credentials or BRS changed login form.
- Verify `FS_USERNAME` and `FS_PASSWORD` in `.env`
- Try manual login at https://members.brsgolf.com/galgorm

### "It booked the wrong time"
Check your `FS_TARGET_TIMES` preference order.

## 📝 File Layout

```
automation/
├── .env                    ← Your config (don't share!)
├── package.json            ← Scripts (npm run book)
├── config.ts               ← Date logic
├── selectors.ts            ← BRS UI selectors
├── tests/
│   ├── book_slot.spec.ts   ← Main booking test
│   └── helpers.ts          ← Shared utilities
└── README.md               ← This file
```

## 🔒 Security Notes

- **Never commit `.env`** (has your password)
- Don't share the output logs (contain credentials)
- `FS_DRY_RUN=true` is safe to test on shared computers
- Always manually verify the first live booking

## ✅ Safety Checklist

Before each automated run:

- [ ] `.env` has correct credentials
- [ ] `FS_TARGET_TIMES` set to your preferred times
- [ ] `FS_DRY_RUN=true` for first test
- [ ] Browser shows correct tee sheet
- [ ] Logs show "✅" checks passing
- [ ] Manual verify one live booking before automation
- [ ] Task Scheduler set to off-peak hours (avoid clashes)

## 📞 Support

If something breaks:

1. Run dry run: `npm run book`
2. Check console output for exact error
3. Try updating selectors if BRS changed UI
4. Verify credentials still work manually

## 🎉 You're All Set!

Your automated tee booking is ready. Enjoy your guaranteed Saturday slots!

**Commands:**
```bash
npm run book       # Test mode (safe)
npm run book:live  # Actually book
```

---

**Last updated:** January 28, 2026  
**Status:** Production Ready
