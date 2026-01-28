# Firebase Setup Guide for Fairway Sniper Agent

## Current Status
✅ Firebase is already configured for your Flutter app
✅ Project ID: `na4qizroum13ep8ua6w67dmwt5cl8a`

## What You Need to Do

### Step 1: Get Firebase Admin SDK Credentials

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `na4qizroum13ep8ua6w67dmwt5cl8a`
3. Click the gear icon ⚙️ next to "Project Overview"
4. Select "Project settings"
5. Go to the "Service accounts" tab
6. Click "Generate new private key"
7. Download the JSON file (save it securely - don't commit to git!)

### Step 2: Extract Credentials from JSON

Open the downloaded JSON file and find these values:

```json
{
  "project_id": "na4qizroum13ep8ua6w67dmwt5cl8a",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@na4qizroum13ep8ua6w67dmwt5cl8a.iam.gserviceaccount.com"
}
```

### Step 3: Update Agent .env File

Edit `agent/.env` and fill in these values:

```env
# Firebase Project Configuration
FIREBASE_PROJECT_ID=na4qizroum13ep8ua6w67dmwt5cl8a
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@na4qizroum13ep8ua6w67dmwt5cl8a.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_FULL_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

**Important**: Keep the quotes around the private key and keep the `\n` characters.

### Step 4: Get FCM Server Key (for push notifications)

1. In Firebase Console → Project Settings
2. Go to "Cloud Messaging" tab
3. Find "Server key" under "Cloud Messaging API (Legacy)"
4. Copy the key
5. Add to `agent/.env`:

```env
FCM_SERVER_KEY=your_server_key_here
```

### Step 5: Enable Required Services

In Firebase Console, make sure these are enabled:

1. **Authentication**
   - Go to "Authentication" → "Sign-in method"
   - Enable "Email/Password"

2. **Firestore Database**
   - Go to "Firestore Database"
   - Click "Create database"
   - Choose "Start in production mode" (we'll adjust rules later)
   - Select your region (e.g., europe-west2)

3. **Cloud Messaging**
   - Should already be enabled for push notifications

### Step 6: Test the Connection

After updating `.env`, restart the agent:

```powershell
cd agent
.\start-agent.ps1
```

You should see:
```
✅ Firebase initialized successfully
```

Instead of:
```
⚠️ Firebase credentials not configured
```

## Quick Test Commands

```powershell
# Test agent health
Invoke-RestMethod http://localhost:3000/api/health

# Should return: {"status":"ok","authenticated":true,"firebase":true}
```

## Troubleshooting

### Error: "Firebase initialization failed"
- Check that private key is properly formatted with `\n` characters
- Ensure quotes are around the private key value
- Verify project ID matches exactly

### Error: "PERMISSION_DENIED"
- Go to Firestore → Rules
- Temporarily set to allow all (for testing):
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Security Notes

⚠️ **Never commit the service account JSON or .env file to git**
⚠️ Add to `.gitignore`:
```
agent/.env
*-firebase-adminsdk-*.json
```

## Next Steps

Once Firebase is connected, you can:
1. Create user accounts in the Flutter app
2. Create booking jobs
3. Agent will automatically detect and execute them
4. Receive push notifications on success/failure
