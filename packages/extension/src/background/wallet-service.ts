import * as bip39 from '@scure/bip39'
import { wordlist as english } from '@scure/bip39/wordlists/english'
import { ZswapSecretKeys } from '@midnight-ntwrk/ledger-v6'
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format'
import { encryptSeed } from './crypto-service'
import {
  saveWallet,
  getWallet,
  generateWalletId,
} from './storage-service'
import type { EncryptedWallet } from './types'

const NETWORK_ID = 'test'
const ENCRYPTION_PK_PREFIX = Buffer.from([0x03, 0x00])

export function generateMnemonic(): string[] {
  const mnemonic = bip39.generateMnemonic(english, 256)
  return mnemonic.split(' ')
}

export function validateMnemonic(words: string[]): boolean {
  const mnemonic = words.join(' ')
  return bip39.validateMnemonic(mnemonic, english)
}

export async function mnemonicToSeed(words: string[]): Promise<Uint8Array> {
  const mnemonic = words.join(' ')
  return bip39.mnemonicToSeed(mnemonic)
}

export async function mnemonicToSeedHex(words: string[]): Promise<string> {
  const mnemonic = words.join(' ')
  const fullSeed = await bip39.mnemonicToSeed(mnemonic)
  const seed32 = fullSeed.slice(0, 32)
  return Buffer.from(seed32).toString('hex')
}

export async function createWallet(
  password: string,
  name: string
): Promise<{ id: string; mnemonic: string[] }> {
  const mnemonic = generateMnemonic()
  const seedPhrase = mnemonic.join(' ')

  const { encryptedSeed, salt } = await encryptSeed(seedPhrase, password)

  const wallet: EncryptedWallet = {
    id: await generateWalletId(),
    name,
    encryptedSeed,
    salt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await saveWallet(wallet)

  return { id: wallet.id, mnemonic }
}

export async function importWallet(
  mnemonic: string[],
  password: string,
  name: string
): Promise<string> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic phrase')
  }

  const seedPhrase = mnemonic.join(' ')
  const { encryptedSeed, salt } = await encryptSeed(seedPhrase, password)

  const wallet: EncryptedWallet = {
    id: await generateWalletId(),
    name,
    encryptedSeed,
    salt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  await saveWallet(wallet)
  return wallet.id
}

export async function deriveAccount(
  seedPhrase: string,
  _accountIndex: number
): Promise<{ address: string; coinPublicKey: string; encryptionPublicKey: string }> {
  const words = seedPhrase.split(' ')
  const fullSeed = await bip39.mnemonicToSeed(words.join(' '))
  const seed32 = fullSeed.slice(0, 32)

  const zswapSecretKeys = ZswapSecretKeys.fromSeed(seed32)

  const coinPublicKey = new ShieldedCoinPublicKey(
    Buffer.from(zswapSecretKeys.coinPublicKey, 'hex')
  )

  const encryptionPKWithPrefix = Buffer.concat([
    ENCRYPTION_PK_PREFIX,
    Buffer.from(zswapSecretKeys.encryptionPublicKey, 'hex')
  ])
  const encryptionPublicKey = new ShieldedEncryptionPublicKey(encryptionPKWithPrefix)

  const shieldedAddress = new ShieldedAddress(coinPublicKey, encryptionPublicKey)
  const address = ShieldedAddress.codec.encode(NETWORK_ID, shieldedAddress).asString()

  return {
    address,
    coinPublicKey: zswapSecretKeys.coinPublicKey,
    encryptionPublicKey: zswapSecretKeys.encryptionPublicKey,
  }
}

export async function deriveMultipleAccounts(
  seedPhrase: string,
  count: number
): Promise<Array<{ index: number; address: string }>> {
  const accounts: Array<{ index: number; address: string }> = []

  for (let i = 0; i < count; i++) {
    const { address } = await deriveAccount(seedPhrase, i)
    accounts.push({ index: i, address })
  }

  return accounts
}

export async function exportSeed(
  walletId: string,
  decryptedSeed: string
): Promise<string[]> {
  const wallet = await getWallet(walletId)
  if (!wallet) {
    throw new Error('Wallet not found')
  }

  return decryptedSeed.split(' ')
}
