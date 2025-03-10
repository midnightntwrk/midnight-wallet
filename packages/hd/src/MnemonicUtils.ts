import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english';

export const mnemonicToWords: (mnemonic: string) => string[] = (mnemonic: string) => mnemonic.split(' ');

/** A wrapper around the bip39 package function, with default strength applied to produce 24 words */
export const generateMnemonicWords: (strength?: number) => string[] = (strength = 256) =>
  mnemonicToWords(bip39.generateMnemonic(english, strength));

export const joinMnemonicWords: (mnenomic: string[]) => string = (mnenomic: string[]) => mnenomic.join(' ');

export const generateRandomSeed = (strength = 256): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(Math.ceil(strength / 8)));
};

/** A wrapper around the bip39 package function */
export const validateMnemonic = (mnemonic: string): boolean => bip39.validateMnemonic(mnemonic, english);
