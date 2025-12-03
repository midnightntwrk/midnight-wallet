#!/usr/bin/env node
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../../../packages/extension/dist');
const screenshotDir = path.resolve(__dirname, '../../../docs/screenshots');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function clickButtonByText(page, text) {
  return await page.evaluate((t) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent?.includes(t));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
}

async function testDebug() {
  const result = {
    success: false,
    steps: [],
    errors: [],
    consoleMessages: [],
    networkErrors: []
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

    await sleep(2000);

    const targets = await browser.targets();
    const extensionTarget = targets.find(t =>
      t.type() === 'service_worker' && t.url().includes('chrome-extension://')
    );

    if (!extensionTarget) {
      throw new Error('Extension service worker not found');
    }

    const extensionId = extensionTarget.url().split('/')[2];
    const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;

    const page = await browser.newPage();

    page.on('console', msg => {
      const text = msg.text();
      result.consoleMessages.push({ type: msg.type(), text });
      if (text.includes('error') || text.includes('Error') || text.includes('fail')) {
        console.log(`Console ${msg.type()}: ${text}`);
      }
    });

    page.on('pageerror', err => {
      result.errors.push(`Page error: ${err.message}`);
      console.log(`Page error: ${err.message}`);
    });

    page.on('response', async response => {
      if (!response.ok()) {
        result.networkErrors.push({
          url: response.url(),
          status: response.status()
        });
      }
    });

    await page.goto(popupUrl, { waitUntil: 'networkidle2' });
    await sleep(1000);
    result.steps.push('1. Welcome page');

    await clickButtonByText(page, 'Create New Wallet');
    await sleep(2000);

    await clickButtonByText(page, 'Generate Recovery Phrase');
    await sleep(3000);
    result.steps.push('2. Generated seed');

    const seedWords = await page.evaluate(() => {
      const spans = document.querySelectorAll('span');
      const words = [];
      let foundNumber = false;
      for (const span of spans) {
        const text = span.textContent?.trim();
        if (text && /^\d+\.$/.test(text)) {
          foundNumber = true;
        } else if (foundNumber && text && text.length > 1 && !/^\d/.test(text)) {
          words.push(text);
          foundNumber = false;
        }
      }
      return words;
    });

    await clickButtonByText(page, "I've Written It Down");
    await sleep(2000);
    result.steps.push('3. Verify seed page');

    await page.evaluate((words) => {
      const labels = document.querySelectorAll('p, span, div');
      for (const label of labels) {
        const match = label.textContent?.match(/Word #(\d+)/);
        if (match) {
          const pos = parseInt(match[1]);
          const correctWord = words[pos - 1];
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent?.trim() === correctWord) {
              btn.click();
              break;
            }
          }
        }
      }
    }, seedWords);

    await sleep(1000);
    await clickButtonByText(page, 'Continue');
    await sleep(2000);
    result.steps.push('4. Set password page');

    const passwordInputs = await page.$$('input[type="password"]');
    if (passwordInputs.length >= 2) {
      await passwordInputs[0].type('TestPassword123!');
      await passwordInputs[1].type('TestPassword123!');
    }

    await clickButtonByText(page, 'Create Wallet');
    await sleep(5000);
    result.steps.push('5. Wallet created');

    const stateResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
          resolve(response);
        });
      });
    });
    result.walletState = stateResult;
    result.steps.push(`State: ${JSON.stringify(stateResult)}`);

    const addressResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
          resolve(response);
        });
      });
    });
    result.addressResult = addressResult;
    result.steps.push(`Address result: ${JSON.stringify(addressResult)}`);

    if (addressResult?.success) {
      result.success = true;
      result.address = addressResult.data;
    } else {
      result.errors.push(`GET_ADDRESS failed: ${addressResult?.error || 'Unknown error'}`);
    }

    await page.screenshot({ path: `${screenshotDir}/debug-final.png` });
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    result.errors.push(err.message);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
  }
}

testDebug();
