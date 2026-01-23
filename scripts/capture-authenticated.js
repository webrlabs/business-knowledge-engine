/**
 * Playwright script to capture authenticated screenshots
 * Launches visible Chrome so user can complete login manually
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const USER_EMAIL = 'onlyjus@live.com';

// Pages to capture after authentication
const PAGES = [
  { name: 'dashboard', path: '/dashboard', waitFor: 'networkidle' },
  { name: 'documents', path: '/dashboard/documents', waitFor: 'networkidle' },
  { name: 'graph', path: '/dashboard/graph', waitFor: 'networkidle' },
  { name: 'query', path: '/dashboard/query', waitFor: 'networkidle' },
  { name: 'upload', path: '/dashboard/upload', waitFor: 'networkidle' },
  { name: 'settings', path: '/dashboard/settings', waitFor: 'networkidle' },
];

async function captureAuthenticatedScreenshots() {
  // Create screenshots directory
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Launching Chrome (visible mode)...');
  console.log('Please complete the login when the browser opens.\n');

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome', // Use installed Chrome
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  try {
    // Navigate to the app
    console.log('Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // Wait a moment for the page to load
    await page.waitForTimeout(2000);

    // Check if we're on the login page
    const signInButton = await page.$('button:has-text("Sign In with Entra ID")');

    if (signInButton) {
      // Fill in email if there's an input field
      const emailInput = await page.$('input[type="email"], input[placeholder*="contoso"]');
      if (emailInput) {
        await emailInput.fill(USER_EMAIL);
        console.log('Filled in email address');
      }

      // Click sign in button
      console.log('Clicking Sign In button...');
      await signInButton.click();

      // Wait for Microsoft login page
      await page.waitForTimeout(3000);

      // Try to fill email on Microsoft login page
      const msEmailInput = await page.$('input[type="email"], input[name="loginfmt"]');
      if (msEmailInput) {
        await msEmailInput.fill(USER_EMAIL);
        console.log('Filled email on Microsoft login page');

        // Click Next button
        const nextButton = await page.$('input[type="submit"], button[type="submit"]');
        if (nextButton) {
          await nextButton.click();
          console.log('Clicked Next button');
        }
      }

      // Wait for user to complete authentication
      console.log('\n===========================================');
      console.log('Please complete the login in the browser.');
      console.log('Enter your password and complete any MFA.');
      console.log('===========================================\n');

      // Wait until we're redirected back to the dashboard (max 2 minutes)
      console.log('Waiting for authentication to complete...');
      await page.waitForURL('**/dashboard**', { timeout: 120000 });
      console.log('Authentication successful!\n');

      // Wait for dashboard to fully load
      await page.waitForTimeout(3000);
    }

    // Now capture all pages
    console.log('Capturing screenshots of all pages...\n');

    for (const pageInfo of PAGES) {
      const url = `${BASE_URL}${pageInfo.path}`;
      console.log(`Capturing: ${pageInfo.name} (${url})`);

      try {
        await page.goto(url, {
          waitUntil: pageInfo.waitFor || 'networkidle',
          timeout: 30000
        });

        // Wait for content to render
        await page.waitForTimeout(2000);

        const screenshotPath = path.join(SCREENSHOT_DIR, `${pageInfo.name}-auth.png`);
        await page.screenshot({
          path: screenshotPath,
          fullPage: true
        });
        console.log(`  Saved: ${screenshotPath}`);
      } catch (error) {
        console.log(`  Error: ${error.message}`);
      }
    }

    console.log('\n=== Screenshots captured successfully! ===');
    console.log('Screenshots saved to:', SCREENSHOT_DIR);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    console.log('\nClosing browser in 5 seconds...');
    await page.waitForTimeout(5000);
    await browser.close();
  }
}

captureAuthenticatedScreenshots().catch(console.error);
