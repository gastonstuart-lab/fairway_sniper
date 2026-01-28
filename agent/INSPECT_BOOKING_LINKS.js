import { chromium } from '@playwright/test';
import 'dotenv/config';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Login
  await page.goto('https://members.brsgolf.com/galgorm/login');
  await page.fill('#username', '12390624');
  await page.fill('#password', 'cantona7777');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  
  // Go to tee sheet
  await page.goto('https://members.brsgolf.com/galgorm/tee-sheet/1/2026/01/29');
  await page.waitForTimeout(3000);
  
  // Find ALL links on the page
  const links = await page.locator('a').evaluateAll(links => 
    links.map(l => ({ text: l.textContent?.trim(), href: l.href }))
  );
  
  console.log('\n🔍 ALL LINKS ON PAGE:');
  links.filter(l => l.text?.match(/\d{2}:\d{2}/)).forEach(l => {
    console.log(`  ${l.text} -> ${l.href}`);
  });
  
  console.log('\n⏸️  Browser will stay open - inspect the page manually');
  console.log('Press Ctrl+C when done');
  
  await new Promise(() => {}); // Keep browser open
})();
