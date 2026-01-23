/**
 * Interactive Playwright script - waits for user input
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const USER_EMAIL = 'onlyjus@live.com';

const PAGES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'documents', path: '/dashboard/documents' },
  { name: 'graph', path: '/dashboard/graph' },
  { name: 'query', path: '/dashboard/query' },
  { name: 'upload', path: '/dashboard/upload' },
  { name: 'settings', path: '/dashboard/settings' },
];

function waitForEnter(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Launching Chrome...\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Navigate to app
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);

  // Try to click sign in and fill email
  const signInButton = await page.$('button:has-text("Sign In")');
  if (signInButton) {
    const emailInput = await page.$('input[placeholder*="contoso"]');
    if (emailInput) {
      await emailInput.fill(USER_EMAIL);
    }
    await signInButton.click();
    await page.waitForTimeout(2000);

    // Fill Microsoft login email
    const msEmailInput = await page.$('input[name="loginfmt"]');
    if (msEmailInput) {
      await msEmailInput.fill(USER_EMAIL);
      const nextBtn = await page.$('input[type="submit"]');
      if (nextBtn) await nextBtn.click();
    }
  }

  console.log('========================================');
  console.log('Browser is open. Please log in now.');
  console.log('========================================\n');

  await waitForEnter('Press ENTER here after you have logged in and see the dashboard...');

  console.log('\nCapturing screenshots...\n');

  for (const pageInfo of PAGES) {
    const url = `${BASE_URL}${pageInfo.path}`;
    console.log(`Capturing: ${pageInfo.name}`);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${pageInfo.name}-auth.png`),
        fullPage: true
      });
      console.log(`  Done`);
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  console.log('\nScreenshots saved to:', SCREENSHOT_DIR);
  await browser.close();
}

main().catch(console.error);
