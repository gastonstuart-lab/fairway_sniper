import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const state = JSON.parse(readFileSync('./automation/state.json', 'utf8'));

const browser = await chromium.launch();
const context = await browser.createBrowserContext({
  storageState: { cookies: state.cookies },
});
const page = await context.newPage();

await page.goto('https://members.brsgolf.com/galgorm/tee-sheet/1/2025/12/10');
await page.waitForTimeout(3000); // Wait for Vue to render

// Get all visible Book buttons (times)
const buttons = await page.locator('a[href*="/bookings/book/"]').all();
console.log(`\n📌 FOUND ${buttons.length} BOOK BUTTONS\n`);

for (let i = 0; i < Math.min(5, buttons.length); i++) {
  const btn = buttons[i];
  const href = await btn.getAttribute('href');
  const text = await btn.innerText();

  console.log(`\nButton ${i + 1}:`);
  console.log(`  Href: ${href}`);
  console.log(`  Text: ${text}`);

  // Get parent elements to understand structure
  const row = await btn.evaluate((el) => {
    let parent = el;
    for (let i = 0; i < 5; i++) {
      parent = parent.parentElement;
      if (parent.tagName === 'TR' || parent.className.includes('row')) break;
    }
    return {
      html: parent.innerHTML.substring(0, 800),
      className: parent.className,
      tag: parent.tagName,
      text: parent.innerText.substring(0, 200),
    };
  });

  console.log(`  Parent: ${row.tag} (class: ${row.className})`);
  console.log(`  Parent text: ${row.text}`);
  console.log(`  Parent HTML: ${row.html}`);
}

// Save full page HTML
const fullHtml = await page.content();
import { writeFileSync } from 'fs';
writeFileSync('./agent/output/full-page-2025-12-10.html', fullHtml);
console.log('\n✅ Full HTML saved to agent/output/full-page-2025-12-10.html');

await browser.close();
