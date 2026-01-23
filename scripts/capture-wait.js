/**
 * Playwright script - launches Chrome and waits 3 minutes for login
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const USER_EMAIL = 'onlyjus@live.com';

const PAGES = [
  { name: 'dashboard-v2', path: '/dashboard' },
];

async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Launching Chrome...');
  console.log('You have 3 MINUTES to complete login.\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Navigate to app
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  // Try to start login flow
  const signInButton = await page.$('button:has-text("Sign In")');
  if (signInButton) {
    const emailInput = await page.$('input[placeholder*="contoso"]');
    if (emailInput) {
      await emailInput.fill(USER_EMAIL);
      console.log('Filled email on app login page');
    }
    await signInButton.click();
    console.log('Clicked Sign In button');
    await page.waitForTimeout(3000);

    // Fill Microsoft login email if on that page
    try {
      const msEmailInput = await page.$('input[name="loginfmt"]');
      if (msEmailInput) {
        await msEmailInput.fill(USER_EMAIL);
        console.log('Filled email on Microsoft login page');
        await page.waitForTimeout(500);
        const nextBtn = await page.$('input[type="submit"]');
        if (nextBtn) {
          await nextBtn.click();
          console.log('Clicked Next button');
        }
      }
    } catch (e) {
      // Ignore if already past email entry
    }
  }

  console.log('\n==========================================');
  console.log('COMPLETE YOUR LOGIN NOW!');
  console.log('Enter password and complete MFA if needed.');
  console.log('==========================================\n');

  // Wait up to 3 minutes for user to reach dashboard
  try {
    await page.waitForURL('**/dashboard**', { timeout: 180000 });
    console.log('Login successful! Detected dashboard URL.\n');
  } catch (e) {
    const currentUrl = page.url();
    if (currentUrl.includes('/dashboard')) {
      console.log('On dashboard page.\n');
    } else {
      console.log('Timeout waiting for login. Current URL:', currentUrl);
      console.log('Attempting to capture anyway...\n');
    }
  }

  // Extra wait for page to stabilize
  await page.waitForTimeout(3000);

  console.log('Capturing screenshots...\n');

  for (const pageInfo of PAGES) {
    const url = `${BASE_URL}${pageInfo.path}`;
    console.log(`Capturing: ${pageInfo.name}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2500);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${pageInfo.name}.png`),
        fullPage: true
      });
      console.log(`  Saved: ${pageInfo.name}.png`);
    } catch (e) {
      console.log(`  Error: ${e.message.substring(0, 50)}`);
    }
  }

  console.log('\n=== DONE ===');
  console.log('Screenshots saved to:', SCREENSHOT_DIR);

  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch(console.error);
