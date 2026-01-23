/**
 * Playwright script to capture screenshots of the app for UI/UX analysis
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Pages to capture
const PAGES = [
  { name: 'home', path: '/', waitFor: 'networkidle' },
  { name: 'dashboard', path: '/dashboard', waitFor: 'networkidle' },
  { name: 'documents', path: '/dashboard/documents', waitFor: 'networkidle' },
  { name: 'knowledge-graph', path: '/dashboard/knowledge-graph', waitFor: 'networkidle' },
  { name: 'query', path: '/dashboard/query', waitFor: 'networkidle' },
];

async function captureScreenshots() {
  // Create screenshots directory
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Launching browser...\n');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  for (const pageInfo of PAGES) {
    const url = `${BASE_URL}${pageInfo.path}`;
    console.log(`Capturing: ${pageInfo.name} (${url})`);

    try {
      await page.goto(url, {
        waitUntil: pageInfo.waitFor || 'networkidle',
        timeout: 30000
      });

      // Wait a bit for any animations/loading
      await page.waitForTimeout(2000);

      const screenshotPath = path.join(SCREENSHOT_DIR, `${pageInfo.name}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });
      console.log(`  Saved: ${screenshotPath}`);
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
  }

  // Also capture mobile view of home page
  console.log('\nCapturing mobile views...');
  await context.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, // iPhone 14 size
  });
  const mobilePage = await mobileContext.newPage();

  try {
    await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await mobilePage.waitForTimeout(2000);
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, 'home-mobile.png'),
      fullPage: true
    });
    console.log('  Saved: home-mobile.png');
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }

  await browser.close();
  console.log('\nScreenshots saved to:', SCREENSHOT_DIR);
}

captureScreenshots().catch(console.error);
