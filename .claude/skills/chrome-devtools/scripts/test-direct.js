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

async function testDirect() {
  const result = {
    success: false,
    steps: [],
    errors: []
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
    await page.goto(popupUrl, { waitUntil: 'networkidle2' });
    await sleep(1000);

    const genResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GENERATE_MNEMONIC' }, (response) => {
          resolve(response);
        });
      });
    });
    result.steps.push(`Generated mnemonic: ${genResult.success}`);

    if (!genResult.success) {
      throw new Error(`Failed to generate mnemonic: ${genResult.error}`);
    }

    const mnemonic = genResult.data;
    result.mnemonic = mnemonic;

    const createResult = await page.evaluate(async (seed) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'CREATE_WALLET',
          payload: {
            name: 'Test Wallet',
            password: 'TestPassword123!',
            seedPhrase: seed.join(' ')
          }
        }, (response) => {
          resolve(response);
        });
      });
    }, mnemonic);
    result.steps.push(`Created wallet: ${createResult.success}`);
    result.createResult = createResult;

    if (!createResult.success) {
      throw new Error(`Failed to create wallet: ${createResult.error}`);
    }

    const walletId = createResult.data.id;

    const unlockResult = await page.evaluate(async (id, pwd) => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'UNLOCK',
          payload: { password: pwd, walletId: id }
        }, (response) => {
          resolve(response);
        });
      });
    }, walletId, 'TestPassword123!');
    result.steps.push(`Unlocked: ${unlockResult.success}`);
    result.unlockResult = unlockResult;

    if (!unlockResult.success) {
      throw new Error(`Failed to unlock: ${unlockResult.error}`);
    }

    const stateResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
          resolve(response);
        });
      });
    });
    result.steps.push(`State: isLocked=${stateResult.data?.isLocked}`);
    result.stateResult = stateResult;

    const addressResult = await page.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_ADDRESS' }, (response) => {
          resolve(response);
        });
      });
    });
    result.steps.push(`Address: ${addressResult.success ? addressResult.data : addressResult.error}`);
    result.addressResult = addressResult;

    if (addressResult.success) {
      result.success = true;
      result.address = addressResult.data;
      result.steps.push('SUCCESS - Address derived correctly!');
    } else {
      result.errors.push(`GET_ADDRESS failed: ${addressResult.error}`);
    }

    await page.screenshot({ path: `${screenshotDir}/direct-test.png` });
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    result.errors.push(err.message);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
  }
}

testDirect();
