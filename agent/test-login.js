import { chromium } from 'playwright';

// Test BRS Golf login with actual credentials
async function testLogin() {
  console.log('🔍 Testing BRS Golf login...');

  const browser = await chromium.launch({
    headless: false, // Show the browser
    slowMo: 1000, // Slow down actions so we can see them
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  try {
    // Navigate to login page
    console.log('Navigating to login page...');
    await page.goto('https://members.brsgolf.com/galgorm/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('Current URL:', page.url());
    console.log('Page title:', await page.title());

    // Take screenshot
    await page.screenshot({
      path: './test-login-1-initial.png',
      fullPage: true,
    });
    console.log('Screenshot 1 saved: test-login-1-initial.png');

    // Wait a moment for page to fully load
    await page.waitForTimeout(2000);

    // Find and fill username
    console.log('Looking for username field...');
    const userInput = page
      .locator(
        'input[name="username"], input[name="user"], input[name="login"], input[placeholder*="username"], input[placeholder*="GUI"], input[placeholder*="ILGU"], input[id*="user"], input[id*="login"]',
      )
      .first();

    if (await userInput.isVisible().catch(() => false)) {
      console.log('✅ Username field found');
      await userInput.fill('12390624');
      console.log('✅ Username filled');
    } else {
      console.log('❌ Username field NOT found');
      console.log('Page HTML:', await page.content());
    }

    // Find and fill password
    console.log('Looking for password field...');
    const passInput = page
      .locator(
        'input[type="password"], input[placeholder*="password"], input[id*="pass"]',
      )
      .first();

    if (await passInput.isVisible().catch(() => false)) {
      console.log('✅ Password field found');
      await passInput.fill('cantona7777');
      console.log('✅ Password filled');
    } else {
      console.log('❌ Password field NOT found');
    }

    // Take screenshot after filling
    await page.screenshot({
      path: './test-login-2-filled.png',
      fullPage: true,
    });
    console.log('Screenshot 2 saved: test-login-2-filled.png');

    // Find and click submit
    console.log('Looking for submit button...');
    const submit = page
      .locator(
        'button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in"), button[type="submit"], input[type="submit"]',
      )
      .first();

    if (await submit.isVisible().catch(() => false)) {
      console.log('✅ Submit button found');
      await submit.click();
      console.log('✅ Submit clicked');
    } else {
      console.log('❌ Submit button NOT found');
    }

    // Wait for navigation or error
    await page.waitForTimeout(3000);

    console.log('After submit - URL:', page.url());
    console.log('After submit - Title:', await page.title());

    // Take screenshot after submit
    await page.screenshot({
      path: './test-login-3-after-submit.png',
      fullPage: true,
    });
    console.log('Screenshot 3 saved: test-login-3-after-submit.png');

    // Check for error messages
    const errorVisible = await page
      .locator('text=/invalid|incorrect|error|failed/i')
      .first()
      .isVisible()
      .catch(() => false);
    console.log('Error message visible:', errorVisible);

    // Check for logout button (indicates success)
    const logoutVisible = await page
      .locator(
        'button:has-text("Logout"), a:has-text("Logout"), a:has-text("Log out"), [href*="logout"]',
      )
      .first()
      .isVisible()
      .catch(() => false);
    console.log('Logout button visible:', logoutVisible);

    // Check if URL changed
    const urlChanged = !page.url().includes('/login');
    console.log('URL changed from login:', urlChanged);

    if (logoutVisible || urlChanged) {
      console.log('✅ LOGIN SUCCESSFUL!');

      // Try to navigate to tee sheet
      console.log('Navigating to tee sheet for tomorrow...');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const y = tomorrow.getFullYear();
      const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
      const d = String(tomorrow.getDate()).padStart(2, '0');
      const teeUrl = `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${d}`;

      console.log('Tee sheet URL:', teeUrl);
      await page.goto(teeUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);

      console.log('Tee sheet URL:', page.url());
      console.log('Tee sheet title:', await page.title());

      await page.screenshot({
        path: './test-login-4-teesheet.png',
        fullPage: true,
      });
      console.log('Screenshot 4 saved: test-login-4-teesheet.png');

      // Look for bookable times
      const bookButtons = await page
        .locator('button:has-text("Book"), button:has-text("Book Now")')
        .count();
      console.log('Found', bookButtons, 'Book/Book Now buttons');

      // Look for time slots
      const timePattern = /\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/;
      const times = await page.locator(`text=${timePattern}`).count();
      console.log('Found', times, 'time elements on page');
    } else {
      console.log('❌ LOGIN FAILED');

      // Get page text to see error
      const bodyText = await page.locator('body').innerText();
      console.log('Page body text:', bodyText.substring(0, 500));
    }

    // Keep browser open for 30 seconds so you can inspect
    console.log(
      '\n⏳ Browser will stay open for 30 seconds for manual inspection...',
    );
    await page.waitForTimeout(30000);
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
    console.log('✅ Test complete');
  }
}

testLogin().catch(console.error);
