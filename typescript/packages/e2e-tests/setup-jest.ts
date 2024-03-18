import { webcrypto } from 'crypto';
import { AllureJestApi } from 'allure-jest/dist/AllureJestApi';

// @ts-expect-error: It's needed to make Scala.js and WASM code able to use cryptography
globalThis.crypto = webcrypto;

// for allure annotations
declare global {
  const allure: AllureJestApi;
}
