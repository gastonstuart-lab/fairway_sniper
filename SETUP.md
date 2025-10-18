# Fairway Sniper - Setup Guide

## 🎯 Quick Setup Steps

### 1. Firebase Connection (Required)

1. **In Dreamflow**, open the **Firebase panel** (left sidebar)
2. Click **"Connect to Firebase"**
3. Follow the guided setup to link your Firebase project
4. Ensure these services are enabled:
   - ✅ Firestore Database
   - ✅ Authentication (Email/Password provider)
   - ✅ Cloud Messaging

### 2. Deploy Firestore Security Rules

Copy the rules from `agent/firebase.rules` to your Firebase Console:
- Firebase Console → Firestore Database → Rules
- Paste the rules and publish

### 3. Configure the Node.js Agent

1. Navigate to the `agent/` directory
2. Copy `.env.example` to `.env`
3. Fill in your credentials:
   - BRS Golf username/password
   - Firebase service account credentials
   - FCM server key

4. Install dependencies:
   ```bash
   cd agent
   npm install
   ```

5. Test the agent:
   ```bash
   npm run test
   ```

### 4. Run the Flutter App

The app is ready to use! Just ensure Firebase is connected in Dreamflow.

---

## 📱 How to Use

1. **Sign Up**: Create an account in the app
2. **Create Job**: Tap the + button to configure your booking
3. **Wait**: The agent will automatically attempt booking at release time
4. **Get Notified**: Receive push notifications of booking results

---

## 🚨 Important Notes

- The Node.js agent needs **actual DOM selectors** from the BRS Golf site (see `agent/README.md`)
- CAPTCHA solving is a **placeholder** - integrate your own service if needed
- Deploy the agent to a **UK region** for best performance
- Test thoroughly with `--dry-run` before going live

---

For full documentation, see `agent/README.md`
