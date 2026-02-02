# Fairway Sniper: Launch Checklist

**Goal**: Get release-time sniper working in production  
**Timeline**: 2-3 hours total

---

## Phase 1: Local Testing (30 minutes)

### ✅ Firebase Verification
Your Firebase is **already configured**:
- ✅ Flutter app has `firebase_options.dart`
- ✅ Agent has `.env` with credentials
- ✅ Firestore rules are set up correctly
- ✅ Collections: `jobs`, `runs`, `users`

**Action**: Test Firebase connection
```powershell
# In Flutter app - check if jobs save
flutter run -d chrome
# Create a test sniper job
# Check Firebase console: https://console.firebase.google.com/project/[your-project]/firestore
```

### ✅ Agent Daemon Test
```powershell
cd agent
$env:AGENT_RUN_MAIN='true'
node index.js
```

**Expected output**:
```
[RUNNER] Sniper job runner started
LISTENING :3000
```

**Then in Flutter app**:
1. Create sniper job (target date 7+ days future)
2. Watch agent logs - should see:
   ```
   [RUNNER] Job detected sniper-xxxxx
   [RUNNER] Job claimed sniper-xxxxx
   [RUNNER] Fire time resolved: 2026-02-XX 19:20:00
   ```

### ✅ Quick Sniper Test (4 minutes from now)
```powershell
# In agent directory
$env:BRS_TARGET_DATE='2026-02-10'  # Future date
$env:FIRE_MINUTES='4'              # 4 minutes from now
node test-create-sniper-job.js
```

Watch logs - booking should fire in 4 minutes.

---

## Phase 2: Cleanup Unused Files (15 minutes)

You have **90+ markdown files** from development. Archive them:

```powershell
# Create archive folder
New-Item -ItemType Directory -Path "_archive_docs" -Force

# Move all status/handoff docs
Move-Item "*.md" "_archive_docs/" -Exclude "README.md","LAUNCH_CHECKLIST.md","BUILD_REVIEW_COMPREHENSIVE.md"

# Keep only essential docs in root
# - README.md (main docs)
# - LAUNCH_CHECKLIST.md (this file)
# - BUILD_REVIEW_COMPREHENSIVE.md (reference)
```

**Files to archive** (not needed for production):
- `ACTION_PLAN_*.md`
- `CHATGPT_*.md`
- `STATUS_REPORT*.md`
- `HANDOFF*.md`
- `SESSION_*.md`
- `PHASE*.md`
- All other `.md` except README

**Test scripts to keep** (in agent/):
- `test-sniper-*.ps1` - Useful for testing
- `prove-*.ps1` - Validation scripts
- `START_AGENT.ps1` - Production startup

---

## Phase 3: Oracle Cloud Deployment (1-2 hours)

### Why Oracle Cloud? ✅ BEST Free Option

**Oracle Cloud Free Tier** (Forever Free):
- 2 x AMD VM (1GB RAM, 1/8 OCPU) - PERMANENT
- 4 x ARM VM (24GB RAM total) - PERMANENT
- 200GB storage
- 10TB bandwidth/month

**vs Competitors**:
- AWS: 12 months free, then $10-15/month
- GCP: 12 months free, then $10-15/month
- Azure: 12 months free, then $10-15/month
- **Oracle: FOREVER FREE** ✅

### Oracle Cloud Setup

**1. Create Account**
- Go to: https://www.oracle.com/cloud/free/
- Sign up (requires credit card for verification, but won't charge)
- Verify email

**2. Create VM Instance**
```
Shape: VM.Standard.E2.1.Micro (AMD, 1GB RAM) - ALWAYS FREE
OS: Ubuntu 22.04 Minimal
```

**3. SSH Setup**
Download your SSH key during instance creation, then:
```powershell
ssh -i your-key.pem ubuntu@[your-instance-ip]
```

**4. Install Node.js + Dependencies**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Playwright dependencies
sudo apt install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxfixes3 libxrandr2 libgbm1 libasound2

# Install PM2 (process manager for 24/7 uptime)
sudo npm install -g pm2
```

**5. Deploy Agent**
```bash
# On your local machine, zip the agent folder
cd C:\Users\stuar\Projects\fairway_sniper
Compress-Archive -Path agent -DestinationPath agent.zip

# Copy to Oracle instance
scp -i your-key.pem agent.zip ubuntu@[your-ip]:~/

# On Oracle instance
ssh -i your-key.pem ubuntu@[your-ip]
unzip agent.zip
cd agent
npm install
npx playwright install chromium
```

**6. Configure Environment**
```bash
# Create .env file with your Firebase credentials
nano .env
```

Paste:
```
AGENT_RUN_MAIN=true
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

**7. Start with PM2**
```bash
# Start agent
pm2 start index.js --name fairway-sniper

# Save PM2 config
pm2 save

# Auto-start on reboot
pm2 startup
# Copy and run the command it outputs

# View logs
pm2 logs fairway-sniper

# Check status
pm2 status
```

**8. Open Firewall**
In Oracle Cloud Console:
- Go to your instance → Virtual Cloud Network → Security List
- Add Ingress Rule:
  - Source: 0.0.0.0/0
  - Port: 3000
  - Protocol: TCP

Then in Ubuntu:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

**9. Update Flutter App**
In your Flutter app, update agent base URL:
```dart
// lib/services/agent_base_url.dart
String defaultAgentBaseUrl() {
  return 'http://[your-oracle-ip]:3000'; // Production
}
```

---

## Phase 4: Production Testing (30 minutes)

### Test 1: Agent Health
```powershell
# From your local machine
curl http://[your-oracle-ip]:3000/api/health
```

Expected: `{"status":"ok","service":"fairway-sniper-agent"}`

### Test 2: Create Sniper Job
1. Open Flutter app
2. Create sniper job for next Tuesday (target date 6+ days)
3. Check Oracle logs:
```bash
pm2 logs fairway-sniper
```

Should see:
```
[RUNNER] Job detected sniper-xxxxx
[RUNNER] Job claimed
[RUNNER] Scheduled for 2026-02-XX 19:20:00
```

### Test 3: Monitor Until Release Time
- Set calendar reminder for 19:15 on release day
- Watch PM2 logs starting 19:18
- Verify booking executes at exactly 19:20:00

---

## Phase 5: Monitoring & Maintenance

### Daily Checks
```bash
ssh ubuntu@[your-ip]
pm2 status      # Check if agent running
pm2 logs --lines 50  # Recent logs
```

### If Agent Crashes
PM2 auto-restarts, but to manually restart:
```bash
pm2 restart fairway-sniper
```

### View All Jobs in Firebase
Firebase Console → Firestore → `jobs` collection

### Update Agent Code
```bash
# On local machine
cd agent
git pull  # If using git
Compress-Archive -Path . -DestinationPath agent-update.zip -Force

# Copy to Oracle
scp -i key.pem agent-update.zip ubuntu@[ip]:~/

# On Oracle
ssh ubuntu@[ip]
cd agent
rm -rf node_modules  # Clear old deps
unzip -o ../agent-update.zip
npm install
pm2 restart fairway-sniper
```

---

## Alternative: Docker Deployment (Advanced)

If you want cleaner isolation:

```dockerfile
# agent/Dockerfile already exists
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
RUN npx playwright install --with-deps chromium

COPY . .

ENV AGENT_RUN_MAIN=true
CMD ["node", "index.js"]
```

Deploy:
```bash
# On Oracle instance
docker build -t fairway-sniper .
docker run -d --restart unless-stopped \
  --name fairway-agent \
  -p 3000:3000 \
  --env-file .env \
  fairway-sniper

# View logs
docker logs -f fairway-agent
```

---

## Troubleshooting Guide

### Agent won't start
```bash
# Check logs
pm2 logs fairway-sniper --lines 100

# Common issues:
# 1. Missing .env file
# 2. Invalid Firebase credentials
# 3. Port 3000 already in use
```

### Jobs not being claimed
```bash
# Check Firebase connection
curl http://localhost:3000/api/health

# Verify AGENT_RUN_MAIN=true in .env
cat .env | grep AGENT_RUN_MAIN

# Check Firestore for jobs
# Firebase Console → jobs collection → check status='active'
```

### Booking fails at release time
```bash
# Check warm session logs
pm2 logs | grep "Warm"

# Verify credentials work
# Create test normal-mode booking first
```

---

## Cost Analysis

**Oracle Cloud Free Tier**:
- VM: $0/month (forever)
- Bandwidth: $0/month (under 10TB)
- Storage: $0/month (under 200GB)
- **Total: $0/month** ✅

**Alternatives**:
- Raspberry Pi at home: $35 one-time + electricity (~$2/month)
- DigitalOcean: $6/month
- AWS after free tier: $10-15/month

**Recommendation**: Start with Oracle Cloud Free Tier. It's perfect for this use case.

---

## Security Checklist

- [ ] Firebase credentials in `.env` (not committed to git)
- [ ] `.env` file in `.gitignore`
- [ ] Firestore rules restrict access to owner UIDs
- [ ] BRS passwords encrypted in Firebase
- [ ] Oracle VM has firewall rules (only port 3000 open)
- [ ] SSH key-based auth (no password login)
- [ ] Regular security updates: `sudo apt update && sudo apt upgrade`

---

## Success Criteria

✅ Agent runs 24/7 on Oracle Cloud  
✅ PM2 auto-restarts on crash  
✅ Sniper jobs claimed automatically  
✅ Booking fires at exactly 19:20:00 UTC  
✅ Dashboard shows job status updates  
✅ Firebase logs all runs  
✅ Zero monthly cost

---

## Next Steps (Right Now)

1. **Test agent daemon locally** (15 min)
   ```powershell
   cd agent
   $env:AGENT_RUN_MAIN='true'
   node index.js
   ```

2. **Archive old docs** (5 min)
   ```powershell
   New-Item "_archive_docs" -ItemType Directory
   Move-Item "*.md" "_archive_docs/" -Exclude "README.md","LAUNCH_CHECKLIST.md"
   ```

3. **Sign up for Oracle Cloud** (30 min)
   - https://www.oracle.com/cloud/free/
   - Create account
   - Set up VM instance

4. **Deploy to Oracle** (45 min)
   - Follow Phase 3 instructions above

5. **Create first real sniper job** (5 min)
   - Target: Next Tuesday
   - Monitor at 19:20 on release day

---

## Timeline to Production

- **Today**: Local testing + Oracle signup (1 hour)
- **Tomorrow**: Deploy to Oracle + test (1 hour)
- **Next Tuesday**: First real sniper booking! 🎯

You're ready to go live! 🚀
