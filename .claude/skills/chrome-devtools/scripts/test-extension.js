#!/usr/bin/env node
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../../../packages/extension/dist');

async function testExtension() {
  const result = {
    success: false,
    logs: [],
    errors: [],
    screenshots: []
  };

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
      ],
      defaultViewport: { width: 400, height: 650 }
    });

    await new Promise(r => setTimeout(r, 2000));

    const targets = await browser.targets();
    const extensionTarget = targets.find(t =>
      t.type() === 'service_worker' && t.url().includes('chrome-extension://')
    );

    if (!extensionTarget) {
      result.errors.push('Extension service worker not found');
      result.success = false;
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const extensionUrl = extensionTarget.url();
    const extensionId = extensionUrl.split('/')[2];
    result.extensionId = extensionId;
    result.logs.push(`Found extension: ${extensionId}`);

    const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;
    result.logs.push(`Opening popup: ${popupUrl}`);

    const page = await browser.newPage();

    const consoleMessages = [];
    page.on('console', msg => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text()
      });
    });

    page.on('pageerror', err => {
      result.errors.push(`Page error: ${err.message}`);
    });

    await page.goto(popupUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const screenshotPath = path.resolve(__dirname, '../../../docs/screenshots/extension-test.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshots.push(screenshotPath);
    result.logs.push(`Screenshot saved: ${screenshotPath}`);

    const pageContent = await page.evaluate(() => {
      return {
        title: document.title,
        bodyText: document.body?.innerText?.substring(0, 500),
        url: window.location.href
      };
    });
    result.pageContent = pageContent;

    result.consoleMessages = consoleMessages;
    result.success = true;

    console.log(JSON.stringify(result, null, 2));

    await new Promise(r => setTimeout(r, 5000));

  } catch (err) {
    result.errors.push(err.message);
    result.success = false;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
  }
}

testExtension();
