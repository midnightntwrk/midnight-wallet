import * as bip39 from '@scure/bip39'
import { wordlist as english } from '@scure/bip39/wordlists/english'
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd'
import { encryptSeed } from './crypto-service'
import {
  saveWallet,
  getWallet,
  generateWalletId,
} from './storage-service'
import type { EncryptedWallet } from './types'

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
  accountIndex: number
): Promise<{ address: string; publicKey: Uint8Array }> {
  const words = seedPhrase.split(' ')
  const seed = await mnemonicToSeed(words)

  const result = HDWallet.fromSeed(seed)
  if (result.type !== 'seedOk') {
    throw new Error('Failed to create HD wallet from seed')
  }

  const hdWallet = result.hdWallet
  const accountKey = hdWallet.selectAccount(accountIndex)
  const roleKey = accountKey.selectRole(Roles.NightExternal)
  const derivation = roleKey.deriveKeyAt(0)

  if (derivation.type !== 'keyDerived') {
    throw new Error('Failed to derive key')
  }

  const publicKey = derivation.key
  const address = formatAddress(publicKey)

  hdWallet.clear()

  return { address, publicKey }
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

function formatAddress(publicKey: Uint8Array): string {
  const hex = Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex}`
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
