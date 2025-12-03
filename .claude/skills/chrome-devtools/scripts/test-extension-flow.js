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

async function testExtensionFlow() {
  const result = {
    success: false,
    steps: [],
    errors: [],
    consoleMessages: []
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
      result.consoleMessages.push({ type: msg.type(), text: msg.text() });
    });

    page.on('pageerror', err => {
      result.errors.push(`Page error: ${err.message}`);
    });

    await page.goto(popupUrl, { waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: `${screenshotDir}/01-welcome.png` });
    result.steps.push('1. Welcome page loaded');

    await clickButtonByText(page, 'Create New Wallet');
    await sleep(2000);
    result.steps.push('2. Create Wallet intro');

    await clickButtonByText(page, 'Generate Recovery Phrase');
    await sleep(3000);
    await page.screenshot({ path: `${screenshotDir}/03-backup-seed.png` });
    result.steps.push('3. Generated seed phrase');

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
    result.seedWords = seedWords;
    result.steps.push(`Captured ${seedWords.length} seed words`);

    await clickButtonByText(page, "I've Written It Down");
    await sleep(2000);
    await page.screenshot({ path: `${screenshotDir}/04-verify-seed.png` });
    result.steps.push('4. On verify seed page');

    const verifyInfo = await page.evaluate((words) => {
      const wordPositions = [];
      const labels = document.querySelectorAll('p, span, div');
      for (const label of labels) {
        const match = label.textContent?.match(/Word #(\d+)/);
        if (match) {
          wordPositions.push(parseInt(match[1]));
        }
      }

      const results = [];
      for (const pos of wordPositions) {
        const correctWord = words[pos - 1];
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.textContent?.trim() === correctWord) {
            btn.click();
            results.push({ pos, word: correctWord, clicked: true });
            break;
          }
        }
      }
      return { wordPositions, results };
    }, seedWords);
    result.verifyInfo = verifyInfo;
    result.steps.push(`Verified words: ${JSON.stringify(verifyInfo.results)}`);

    await sleep(1000);
    await clickButtonByText(page, 'Continue');
    await sleep(2000);
    await page.screenshot({ path: `${screenshotDir}/05-set-password.png` });
    result.steps.push('5. On set password page');

    const passwordInputs = await page.$$('input[type="password"]');
    result.steps.push(`Found ${passwordInputs.length} password inputs`);

    if (passwordInputs.length >= 2) {
      await passwordInputs[0].type('TestPassword123!');
      await passwordInputs[1].type('TestPassword123!');
      await sleep(500);
    }

    await page.screenshot({ path: `${screenshotDir}/06-password-filled.png` });

    await clickButtonByText(page, 'Create Wallet');
    await sleep(5000);
    await page.screenshot({ path: `${screenshotDir}/07-after-create.png` });
    result.steps.push('6. Wallet creation attempted');

    const pageText = await page.evaluate(() => document.body.innerText);
    result.pageText = pageText.substring(0, 600);

    const navBtns = await page.$$('nav button');
    result.steps.push(`Found ${navBtns.length} nav buttons`);

    if (navBtns.length >= 3) {
      await navBtns[2].click();
      await sleep(3000);
      await page.screenshot({ path: `${screenshotDir}/08-receive.png` });
      result.steps.push('7. Clicked Receive tab');

      const receiveText = await page.evaluate(() => document.body.innerText);
      result.receivePageText = receiveText.substring(0, 500);

      if (receiveText.includes('Could not load address')) {
        result.errors.push('ERROR: "Could not load address" displayed');
      } else if (receiveText.includes('Your tDUST Address')) {
        result.steps.push('SUCCESS: Address loaded!');
        result.success = true;
      }
    }

    await page.screenshot({ path: `${screenshotDir}/09-final.png` });
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    result.errors.push(err.message);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
  }
}

testExtensionFlow();
