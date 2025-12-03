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

async function testUIFull() {
  const result = { success: false, steps: [], errors: [] };
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

    if (!extensionTarget) throw new Error('Extension not found');

    const extensionId = extensionTarget.url().split('/')[2];
    const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;

    const page = await browser.newPage();
    await page.goto(popupUrl, { waitUntil: 'networkidle2' });
    await sleep(1000);
    await page.screenshot({ path: `${screenshotDir}/ui-01-welcome.png` });
    result.steps.push('1. Welcome page');

    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent.includes('Create New Wallet')) b.click();
      });
    });
    await sleep(2000);
    await page.screenshot({ path: `${screenshotDir}/ui-02-create.png` });
    result.steps.push('2. Create wallet page');

    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent.includes('Generate Recovery Phrase')) b.click();
      });
    });
    await sleep(3000);
    await page.screenshot({ path: `${screenshotDir}/ui-03-seed.png` });
    result.steps.push('3. Seed phrase generated');

    const seedWords = await page.evaluate(() => {
      const text = document.body.innerText;
      const lines = text.split('\n');
      const words = [];
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(\d+)\.\s*$/);
        if (match && lines[i + 1]) {
          const word = lines[i + 1].trim();
          if (word && !word.includes('.') && word.length > 1) {
            words.push(word);
          }
        }
      }
      if (words.length !== 24) {
        const allText = text.replace(/\n/g, ' ');
        const wordMatches = allText.match(/\d+\.\s*(\w+)/g);
        if (wordMatches) {
          return wordMatches.map(m => m.replace(/\d+\.\s*/, ''));
        }
      }
      return words;
    });
    result.seedWords = seedWords;
    result.steps.push(`Captured ${seedWords.length} words`);

    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent.includes("I've Written It Down")) b.click();
      });
    });
    await sleep(2000);
    await page.screenshot({ path: `${screenshotDir}/ui-04-verify.png` });
    result.steps.push('4. Verify page');

    for (let attempt = 0; attempt < 3; attempt++) {
      const verifyResult = await page.evaluate((words) => {
        const results = [];
        const sections = document.querySelectorAll('p, div, span');
        const positions = [];

        sections.forEach(el => {
          const match = el.textContent.match(/Word #(\d+)/);
          if (match) positions.push(parseInt(match[1]));
        });

        const uniquePositions = [...new Set(positions)];

        for (const pos of uniquePositions) {
          const correctWord = words[pos - 1];
          if (!correctWord) continue;

          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const btnText = btn.textContent.trim();
            if (btnText === correctWord && !btn.classList.contains('bg-violet-100')) {
              btn.click();
              results.push({ pos, word: correctWord });
              break;
            }
          }
        }
        return results;
      }, seedWords);

      result.steps.push(`Verify attempt ${attempt + 1}: ${JSON.stringify(verifyResult)}`);
      await sleep(500);
    }

    await page.screenshot({ path: `${screenshotDir}/ui-05-verify-done.png` });

    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent.includes('Continue') && !b.disabled) b.click();
      });
    });
    await sleep(2000);
    await page.screenshot({ path: `${screenshotDir}/ui-06-password.png` });
    result.steps.push('5. Password page');

    const pageText = await page.evaluate(() => document.body.innerText);
    result.currentPage = pageText.substring(0, 300);

    const passwordInputs = await page.$$('input[type="password"]');
    result.steps.push(`Found ${passwordInputs.length} password fields`);

    if (passwordInputs.length >= 2) {
      await passwordInputs[0].type('TestPassword123!');
      await passwordInputs[1].type('TestPassword123!');
      await sleep(500);
      await page.screenshot({ path: `${screenshotDir}/ui-07-password-filled.png` });
      result.steps.push('6. Password filled');

      await page.evaluate(() => {
        document.querySelectorAll('button').forEach(b => {
          if (b.textContent.includes('Create Wallet') && !b.disabled) b.click();
        });
      });
      await sleep(5000);
      await page.screenshot({ path: `${screenshotDir}/ui-08-home.png` });
      result.steps.push('7. Home page');

      const homeText = await page.evaluate(() => document.body.innerText);
      result.homePage = homeText.substring(0, 400);

      if (homeText.includes('tDUST') || homeText.includes('Balance')) {
        result.steps.push('Home page loaded with balance!');

        const navButtons = await page.$$('nav button');
        if (navButtons.length >= 3) {
          await navButtons[2].click();
          await sleep(3000);
          await page.screenshot({ path: `${screenshotDir}/ui-09-receive.png` });
          result.steps.push('8. Receive page');

          const receiveText = await page.evaluate(() => document.body.innerText);
          result.receivePage = receiveText.substring(0, 400);

          if (receiveText.includes('Could not load address')) {
            result.errors.push('FAIL: "Could not load address" still showing');
          } else if (receiveText.includes('mn_dust_testnet') || receiveText.includes('tDUST Address')) {
            result.success = true;
            result.steps.push('SUCCESS: Address displayed!');

            const address = await page.evaluate(() => {
              const text = document.body.innerText;
              const match = text.match(/mn_dust_testnet\w+/);
              return match ? match[0] : null;
            });
            result.address = address;
          }
        }
      }
    }

    await page.screenshot({ path: `${screenshotDir}/ui-10-final.png` });
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    result.errors.push(err.message);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) {
      await sleep(3000);
      await browser.close();
    }
  }
}

testUIFull();
