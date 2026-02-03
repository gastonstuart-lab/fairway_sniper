// ensureTeeSelected.js
// Helper for robust tee selection in Playwright

/**
 * Ensure the correct tee (1ST TEE or 10TH TEE) is selected on the page.
 * @param {import('playwright').Page} page - Playwright page instance
 * @param {number} tee - 1 or 10 (integer)
 */
export async function ensureTeeSelected(page, tee) {
  const desiredLabel = tee === 10 ? '10TH TEE' : '1ST TEE';
  // Detect current tee from top bar label
  const teeBar = page.getByRole('button', { name: /1ST TEE|10TH TEE/i });
  if (await teeBar.count() === 0) {
    throw new Error('Tee selection bar/button not found');
  }
  const topBarButton = teeBar.first();
  const currentLabel = (await topBarButton.textContent() || '').trim().toUpperCase();
  if (currentLabel.includes(desiredLabel)) return; // Already correct

  // Click to open modal
  await topBarButton.click();
  // Wait for modal to appear
  const modalBtn = page.getByRole('button', { name: desiredLabel });
  await modalBtn.waitFor({ state: 'visible', timeout: 4000 });
  await modalBtn.click();

  // Wait for the TOP BAR tee button itself to update to desired tee
  const topBarHandle = await topBarButton.elementHandle();
  if (topBarHandle) {
    await page.waitForFunction(
      (btn, label) => (btn?.textContent || '').trim().toUpperCase().includes(label),
      topBarHandle,
      desiredLabel,
      { timeout: 6000 }
    );
    await topBarHandle.dispose();
  } else {
    await page.waitForFunction(
      (label) => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => /1ST TEE|10TH TEE/i.test((b.textContent||'')));
        if (!btn) return false;
        return (btn.textContent || '').trim().toUpperCase().includes(label);
      },
      desiredLabel,
      { timeout: 6000 }
    );
  }
  // Wait for a time label to appear using getByText
  const timeRegex = /\b([01]\d|2[0-3]):[0-5]\d\b/;
  await page.getByText(timeRegex).first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
}
