#!/usr/bin/env -S node  --experimental-specifier-resolution=node

import * as KeyManagement from "@cardano-sdk/key-management"

const mnemonics = [
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'abandon',
    'absurd',
    'fetch'
  ];

  const seed = KeyManagement.util.mnemonicWordsToEntropy(mnemonics)
  console.log(seed);

  const seed2 = '0000000000000000000000000000000000000000000000000000000000000001';
  const mnemonics2 = KeyManagement.util.entropyToMnemonicWords(seed2);
  console.log(mnemonics2);
