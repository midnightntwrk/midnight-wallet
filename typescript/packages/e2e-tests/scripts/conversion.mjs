#!/usr/bin/env -S node  --experimental-specifier-resolution=node
/* eslint-disable import/no-extraneous-dependencies */

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

  const seed2 = '0000000000000000000000000000000000000000000000000000000000000002';
  const mnemonics2 = KeyManagement.util.entropyToMnemonicWords(seed2);
  console.log(mnemonics2);
