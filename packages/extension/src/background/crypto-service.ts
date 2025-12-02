import type { EncryptedData } from './types'

function arrayToBase64(array: ArrayBuffer | Uint8Array): string {
  const bytes = array instanceof Uint8Array ? array : new Uint8Array(array)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return arrayToBase64(bytes)
}

export async function deriveKey(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 600000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encrypt(
  data: string,
  key: CryptoKey
): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(data)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )

  return {
    iv: arrayToBase64(iv),
    ciphertext: arrayToBase64(ciphertext),
  }
}

export async function decrypt(
  encryptedData: EncryptedData,
  key: CryptoKey
): Promise<string> {
  const iv = base64ToArray(encryptedData.iv)
  const ciphertext = base64ToArray(encryptedData.ciphertext)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  )

  return new TextDecoder().decode(decrypted)
}

export async function encryptSeed(
  seedPhrase: string,
  password: string
): Promise<{ encryptedSeed: EncryptedData; salt: string }> {
  const salt = generateSalt()
  const key = await deriveKey(password, salt)
  const encryptedSeed = await encrypt(seedPhrase, key)

  return {
    encryptedSeed,
    salt: arrayToBase64(salt),
  }
}

export async function decryptSeed(
  encryptedSeed: EncryptedData,
  salt: string,
  password: string
): Promise<string> {
  const saltBytes = base64ToArray(salt)
  const key = await deriveKey(password, saltBytes)
  return decrypt(encryptedSeed, key)
}

export function saltToBase64(salt: Uint8Array): string {
  return arrayToBase64(salt)
}

export function base64ToSalt(base64: string): Uint8Array {
  return base64ToArray(base64)
}
