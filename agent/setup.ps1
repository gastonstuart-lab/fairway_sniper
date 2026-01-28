# Fairway Sniper Agent - Quick Setup Wizard
# This script will help you configure the agent step-by-step

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Fairway Sniper - Setup Wizard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$agentDir = $PSScriptRoot
Set-Location -Path $agentDir

# Check if .env already exists
if (Test-Path ".env") {
    Write-Host "⚠️  A .env file already exists" -ForegroundColor Yellow
    Write-Host ""
    $overwrite = Read-Host "Do you want to overwrite it? (y/N)"
    if ($overwrite -ne 'y' -and $overwrite -ne 'Y') {
        Write-Host "Setup cancelled. Your existing .env file was not modified." -ForegroundColor Gray
        exit 0
    }
    Write-Host ""
}

Write-Host "This wizard will help you configure the agent." -ForegroundColor White
Write-Host "You'll need:" -ForegroundColor White
Write-Host "  1. Your BRS Golf login credentials (required)" -ForegroundColor Gray
Write-Host "  2. Firebase credentials (optional - for full app integration)" -ForegroundColor Gray
Write-Host ""
Write-Host "Let's get started!" -ForegroundColor Green
Write-Host ""

# Step 1: BRS Golf Credentials
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Step 1: BRS Golf Login Credentials" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "These are your credentials for https://members.brsgolf.com/galgorm" -ForegroundColor Gray
Write-Host ""

$brsUsername = Read-Host "Enter your BRS Golf username (e.g., 12345678)"
$brsPassword = Read-Host "Enter your BRS Golf password" -AsSecureString
$brsPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($brsPassword))

Write-Host ""
Write-Host "✅ BRS Golf credentials saved" -ForegroundColor Green
Write-Host ""

# Step 2: Firebase (Optional)
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Step 2: Firebase Configuration (Optional)" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Firebase is needed for:" -ForegroundColor White
Write-Host "  - Flutter app integration (creating jobs via the app)" -ForegroundColor Gray
Write-Host "  - Push notifications" -ForegroundColor Gray
Write-Host "  - Storing booking history" -ForegroundColor Gray
Write-Host ""
Write-Host "You can skip this for now and test the booking manually." -ForegroundColor Yellow
Write-Host ""

$useFirebase = Read-Host "Do you want to configure Firebase now? (y/N)"

$firebaseProjectId = ""
$firebaseClientEmail = ""
$firebasePrivateKey = ""
$fcmServerKey = ""

if ($useFirebase -eq 'y' -or $useFirebase -eq 'Y') {
    Write-Host ""
    Write-Host "You'll need your Firebase service account credentials." -ForegroundColor White
    Write-Host "Get them from: https://console.firebase.google.com" -ForegroundColor Gray
    Write-Host "  → Project Settings → Service Accounts → Generate New Private Key" -ForegroundColor Gray
    Write-Host ""
    
    $firebaseProjectId = Read-Host "Enter your Firebase Project ID"
    $firebaseClientEmail = Read-Host "Enter your Firebase Client Email"
    Write-Host ""
    Write-Host "For the private key, paste the entire key including the BEGIN/END lines:" -ForegroundColor Yellow
    $firebasePrivateKey = Read-Host "Enter your Firebase Private Key"
    Write-Host ""
    $fcmServerKey = Read-Host "Enter your FCM Server Key (optional, press Enter to skip)"
    
    Write-Host ""
    Write-Host "✅ Firebase configuration saved" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "⏭️  Skipping Firebase configuration" -ForegroundColor Yellow
    Write-Host "   You can add it later by editing the .env file" -ForegroundColor Gray
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Creating .env file..." -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Create .env file
$envContent = @"
# BRS Golf Login Credentials
CLUB_LOGIN_URL=https://members.brsgolf.com/galgorm/login
BRS_USERNAME=$brsUsername
BRS_PASSWORD=$brsPasswordPlain

# Firebase Project Configuration
FIREBASE_PROJECT_ID=$firebaseProjectId
FIREBASE_CLIENT_EMAIL=$firebaseClientEmail
FIREBASE_PRIVATE_KEY="$firebasePrivateKey"

# Firebase Cloud Messaging
FCM_SERVER_KEY=$fcmServerKey

# Optional: Third-party CAPTCHA solver
CAPTCHA_API_KEY=

# Timezone
TZ_LONDON=Europe/London
"@

$envContent | Out-File -FilePath ".env" -Encoding utf8

Write-Host "✅ .env file created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Next Steps" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Test your credentials:" -ForegroundColor White
Write-Host "   cd automation" -ForegroundColor Gray
Write-Host "   npx playwright test login.spec.ts --headed" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Run a DRY_RUN booking test:" -ForegroundColor White
Write-Host "   .\test-booking.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Or start the Flutter app:" -ForegroundColor White
Write-Host "   cd .." -ForegroundColor Gray
Write-Host "   flutter run -d chrome" -ForegroundColor Gray
Write-Host ""
Write-Host "Setup complete! 🎉" -ForegroundColor Green
Write-Host ""
